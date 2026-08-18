# Agent Note: Automatic durable vision fallback for explicitly text-only models

Status: implemented

English | [中文](2026-08-17-automatic-vision-fallback.zh.md)

## Problem

Durable image input and the [`read_image` tool](2026-08-10-minimal-read-image-tool.md) deliberately failed on text-only routes. That protected session history from an image block the selected adapter could not serialize, but it left DeepSeek and other strong text models unable to inspect a pasted screenshot or a video frame even when the deployment already had a separate visual model. Users had to switch the whole conversation to a visual route, manually run an external recognizer, or accept the failure shown by `read_image`.

The external `dsh-vision-recognizer` project demonstrated a useful product shape: keep DeepSeek responsible for reasoning and use a configurable visual model only to transcribe images. Its adapter proxy declares image input, replaces images with text inside `stream()`, and directly owns vendor HTTP protocols and a second credential/settings store. That mechanism cannot be copied into Harness core: the replacement text never enters the session log, so resume, fork, compaction, and request reconstruction cannot prove what the main model saw; duplicating OpenAI, Anthropic, Gemini, Qwen, Ollama, and gateway configuration also competes with the existing `llm-pi-ai`, Models, settings, and credentials owners.

The behavior must also distinguish three real model states. A model declaring `image` must keep its native path. A model explicitly declaring only text may use a helper. A model with absent modality metadata is unknown, not text-only; automatically exporting its images to another provider would turn missing metadata into an unannounced privacy and cost decision.

## Decision

`LlmRuntime` owns one optional, effect-scoped `LlmImageFallback` registration. `resolveImageInput(provider, model)` returns `native`, `fallback`, `unsupported`, or `unknown` from exact-model metadata plus current fallback availability. Native declarations win, explicit exclusion consults the provider, and absent metadata remains unknown. At the final adapter boundary, the runtime projects only requests that contain images and resolve to `fallback`; other routes receive their original messages. One registration avoids hidden provider precedence, and disposal immediately restores the normal adapter rejection path.

The opt-in `@deepseek-ai/dsh-vision-fallback` bundle inserts `@deepseek-ai/dsh-llm-vision-fallback` plus an inert Host row for the browser companion; the latter row's `dsh.client` declaration makes the Web module scanner contribute the Automatic vision tab. ApiProxy explicitly exposes the provider's `llm-vision-fallback` settings namespace to loopback configuration clients while retaining the closed Host allowlist: installing or registering another settings namespace does not expose it. The provider reuses an already-registered native visual route; provider endpoint, API key, model profile, and image modality remain owned by Models, credentials, and the selected adapter. Provider/model absence is the dormant installed state. A configured helper must explicitly declare `image`, so it cannot recurse into the fallback it provides.

Each distinct session attachment receives at most one completed transcription. Before dispatching the auxiliary route, the provider appends log-only `vision/fallback-request` with a branded request id, durable attachment reference, exact route, exact helper messages, and output cap. Only a complete text response appends `vision/fallback-result`, whose `text` is the exact JSON-framed, untrusted-data block substituted for the image. A failed, canceled, timed-out, tool-calling, image-producing, empty, or max-token response leaves no result. Later calls reuse the first completed result for that attachment regardless of current helper settings, preserving replay instead of silently changing historical model input.

The text projection recursively replaces direct and tool-result-nested image blocks while preserving message ids, roles, sources, block order, and every non-image block. A missing durable result fails with `VISION_FALLBACK_RESULT_MISSING`; images are never filtered. Auxiliary calls require a live `sessionId`, and their exact request is recorded before dispatch, applying the same model-visible/logged rule as session titles and DeepSeek search.

Concurrent calls coordinate per session and attachment. One owner performs the provider call, waiters observe its settlement, and a waiter may cancel without canceling the owner's work. If the owner fails, the next waiter retries with a new recorded request. The package invariant requires every request attachment to precede it in model-visible history, unique request ids, a positive cap and non-empty route, and at most one non-empty result for each prior request.

Web prompt admission and model selection, plus the strict `read_image` execution check, use `resolveImageInput()` instead of independently interpreting `inputModalities`. Web preserves its existing unknown-capability pass-through, while `read_image` preserves its stricter unknown refusal because committing a tool-result image would otherwise strand the route. A ready fallback permits both paths for an explicitly text-only target.

## Alternatives considered

### Register a visible “DeepSeek + Vision” proxy route

Rejected because users asked for automatic behavior based on the selected model, not another model-picker entry. A proxy also makes native visual routes pay an unnecessary wrapper and complicates model switching: every underlying text provider would need a duplicate public route.

### Transcribe only inside an adapter stream

Rejected because the helper request and replacement text would be process-local effects. A resumed or forked session could send different content, the agent-loop request invariant could only verify the pre-transform image list, and compaction could not reconstruct the helper input.

### Add a separate `recognize_image` tool

Rejected as the primary path because it does not handle pasted/uploaded images and requires a text model to choose a second tool after `read_image` fails. The existing `read_image` result remains the correct durable fact; automatic projection lets that same result serve native and text-only routes.

### Copy the reference project's provider catalog and HTTP clients

Rejected because Harness already owns multi-provider adapters, endpoint discovery, credential references, model metadata, retries, and settings. Reimplementing them creates a second security, timeout, compatibility, and UI authority and still cannot make an undeclared visual model safe to call automatically.

### Treat unknown modality as unsupported

Rejected because missing metadata is not negative capability. The adapter may support images for an unlisted or dynamic model, and silent fallback could export images and incur cost without an explicit deployment claim.

## Testing

LLM service tests pin native pass-through, explicit text-only projection, unknown pass-through, unavailable/disposed fallback behavior, frozen replacement messages, and public four-way resolution. Host and tool tests prove image upload, model selection, and `read_image` accept a ready fallback while retaining existing no-fallback refusals. Provider tests cover configuration bounds, direct and nested projection, request/result folding, native-helper validation, request-before-dispatch ordering, completed-result reuse, missing-result failure, and invariant rejection of unseen attachments and orphan results. A real Loader composition boots the exported namespace, performs a mock native visual call, persists both events, and proves the text-only adapter receives no image block. ApiProxy tests pin the namespace's explicit description and write access without weakening refusal of unlisted namespaces. Client tests cover visual-only catalog filtering, staged provider/model writes, invalid drafts, locale registration, lazy catalog loading, and teardown.

## Consequences

Text-only main models can consume pasted images and filesystem image results without claiming native multimodality or changing provider/model selection. Native image models retain their original bytes path, and unknown models retain adapter authority.

The first text-only use adds one visual request's latency, token cost, and privacy exposure per distinct session attachment. Reuse makes later requests stable and cheap, but the generic transcription does not receive the surrounding task and cannot later change OCR mode, crop, or interpretation without a new attachment.

The LLM service now has one additional provider extension and the session vocabulary has two required log-only events. This same-version build recognizes them through the generated persistence catalog; older builds refuse the required events rather than resuming without the text the model saw.

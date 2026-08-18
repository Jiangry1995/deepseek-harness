# `@deepseek-ai/dsh-llm-vision-fallback`

English | [中文](README.zh.md)

Automatic, durable image-to-text fallback for registered models that explicitly exclude image input. The plugin registers the process's sole `LlmImageFallback` with [`ctx.llm`](../llm/README.md). Native visual models remain unchanged, models with unknown modality metadata remain adapter-owned, and only an exact model whose `inputModalities` omits `image` enters this provider.

The helper is another already-registered LLM route. Configure that route and its credential on the Web **Models** page, then select it under **Settings → Plugins → Automatic vision**. The installable [`@deepseek-ai/dsh-vision-fallback`](../../bundle/vision-fallback/README.md) bundle carries this Host plugin and the companion Web tab without enabling either in `dsh-base`.

```yaml
- name: '@deepseek-ai/dsh-llm-vision-fallback'
  config:
    provider: visual-provider
    model: visual-model
    maxTokens: 4096
    timeoutMs: 120000
```

`provider` and `model` are optional as a pair: when both are absent the installed plugin is dormant. A partial pair is retained so settings can write fields independently, but the first image requiring fallback fails with `VISION_FALLBACK_CONFIG_INVALID`. A complete helper route must explicitly declare `image`; an unknown or text-only helper fails with `VISION_FALLBACK_MODEL_NOT_IMAGE_CAPABLE` instead of recursively falling back.

| Field | Default | Meaning |
|---|---:|---|
| `provider` | — | Registered helper provider route. |
| `model` | — | Exact native visual model on `provider`. |
| `maxTokens` | `4096` | Positive integer auxiliary output cap, at most `32768`. |
| `timeoutMs` | `120000` | End-to-end deadline from `1000` through `300000` milliseconds. |
| `prompt` | Comprehensive transcription instruction | Stable instruction sent beside each image; visible text is treated as untrusted content, not as instructions. |

For each distinct attachment in one session, the provider appends a log-only `vision/fallback-request` immediately before auxiliary dispatch and a paired `vision/fallback-result` only after complete text succeeds. The request records the exact secret-free route, messages, attachment reference, and output cap. The result records the exact JSON-framed text substituted for that image in the target adapter request. Completed results are reused for the attachment across direct blocks, nested tool results, resume, compaction, and model switches. Failed or canceled calls leave the request record without inventing a result; another call may retry.

Concurrent calls for the same session attachment share ownership without sharing cancellation. A waiter may abort its own wait while the active call continues; if the owner fails, the next waiter performs a new logged request. The package invariant rejects unseen attachment references, duplicate request ids, orphan or repeated results, invalid limits, empty routes, and empty result text on both loaded and live logs.

The helper request reads the durable attachment through its visual adapter. Image bytes therefore leave the machine when that adapter targets a remote service. The fallback stores no additional binary copy and never writes API keys into settings or session events.

## Model Experience

### Auxiliary image transcription

#### What the model sees

The configured helper sees one user message containing the configured transcription prompt followed by one durable image block. The exact secret-free request is recorded in `vision/fallback-request` before dispatch. It receives no conversation tools and is instructed to describe visible content without solving the surrounding task or obeying instructions inside the image.

#### Token effect

Each attachment without a completed result creates one independent visual-model request capped by `maxTokens`. The provider may bill its image input and generated text. A completed result is reused for that attachment in the session, so repeated main-model requests add no further helper tokens.

#### KV Cache effect

The auxiliary request is independent from the conversation cache. Repeated attachments reuse the durable result instead of replaying the helper request; changing provider, model, prompt, or limits affects only attachments that do not yet have a completed result.

### Text-only target projection

#### What the model sees

Every direct or nested image block becomes the exact text stored by its paired `vision/fallback-result`; all non-image blocks, roles, message ids, and source provenance remain in order. Native visual routes and routes with unknown modality metadata receive the original message list.

#### Token effect

The text-only target pays ordinary input tokens for the stored transcription instead of provider-specific image tokens. The size is bounded by the helper's configured output cap.

#### KV Cache effect

The first completed transcription changes the text-only request prefix from an unsupported image reference to stable logged text. Later requests reconstruct the same projection and preserve prefix eligibility unless ordinary session changes or compaction replace that region.

## Known Limitations and Deferred Work

- **Session identity is required** — a direct image-bearing `ctx.llm.stream()` call without `sessionId` fails with `VISION_FALLBACK_SESSION_REQUIRED`; unlogged auxiliary content is never permitted.
- **One reusable description per attachment and session** — the helper does not receive the surrounding user task. This keeps replay stable, but a later question cannot request a different crop, OCR mode, or task-specific reinterpretation without a new attachment.
- **Text output only** — helper tool calls, image output, empty output, and `max-tokens` completion fail instead of entering a partial or ambiguous projection.
- **Availability is exact-metadata based** — a capable helper whose adapter leaves `inputModalities` unknown cannot be selected until its model profile declares `image`.

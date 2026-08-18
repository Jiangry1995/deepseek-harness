# `@deepseek-ai/dsh-client-ui-settings-vision-fallback`

English | [中文](README.zh.md)

Web Settings companion for [`@deepseek-ai/dsh-llm-vision-fallback`](../../llm/llm-vision-fallback/README.md). It contributes the localized **Automatic vision** tab to `settings.plugins.tab`, binds the `llm-vision-fallback` settings namespace, and lazily reads `llm.models` after the tab mounts.

The provider and model selectors show only registered exact models whose catalog metadata includes `image`. API keys, endpoints, custom providers, and model-profile edits stay on the Models page; this tab owns only helper selection, maximum output tokens, timeout, and the transcription prompt. Catalog failures preserve successful providers, a missing catalog has a retry action, invalid numeric or partial-route drafts block saving, and a rejected write retains the draft. Host-pushed `llm/adapters-updated`, `settings/document-updated`, and `connection/reset` refresh a catalog that has already loaded without making activation perform a network read. Model-profile edits (including the image-input switch) do not re-register adapter routes, so the document event is what keeps this tab in sync with the Models page.

The form uses the existing Settings tokens and tab column: two columns above 640 pixels and one below, keyboard-native labels/selects, focus rings, 44-pixel mobile actions, explicit loading/empty/error/read-only states, and bilingual copy.

## Model Experience

None, as this package only edits Host settings and renders the registered model catalog in the browser.

#### KV Cache effect

None; it assembles and sends no provider request.

## Known Limitations and Deferred Work

- **Catalog declarations are authoritative** — a visual endpoint whose model metadata omits `image` is hidden even if the provider would accept it; declare the modality on the Models page.
- **No connection test in this tab** — helper validity is checked when Host availability resolves; provider credential and endpoint probes remain owned by the Models page.

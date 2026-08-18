# `@deepseek-ai/dsh-vision-fallback`

English | [中文](README.zh.md)

Optional installable bundle for automatic image recognition on explicitly text-only model routes. Its [`cordis.patch.yml`](cordis.patch.yml) inserts [`@deepseek-ai/dsh-llm-vision-fallback`](../../llm/llm-vision-fallback/README.md) plus an inert Host row for [`@deepseek-ai/dsh-client-ui-settings-vision-fallback`](../../client/ui-settings-vision-fallback/README.md), whose `dsh.client` declaration makes the Web module scanner contribute the browser tab.

```powershell
dsh plugin --profile web add @deepseek-ai/dsh-vision-fallback
```

After restart, select a registered native visual helper under **Settings → Plugins → Automatic vision**. The bundle stays dormant while provider/model are absent and is deliberately not part of `dsh-base`, so installing Harness does not silently send images to a second provider or incur auxiliary model cost.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-llm-vision-fallback`, when a configured text-only route receives image content.

#### KV Cache effect

The static bundle adds no request content; the provider package documents its conditional projection and cache effects.

## Known Limitations and Deferred Work

- **Profile installation is required** — the package is opt-in and does not alter existing Web or headless compositions until added to a profile.
- **Web UI follows the dependency scanner** — non-Web profiles receive Host fallback behavior from YAML settings but do not render the browser tab.

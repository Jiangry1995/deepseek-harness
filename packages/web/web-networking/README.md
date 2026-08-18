# @deepseek-ai/dsh-web-networking

English | [中文](README.zh.md)

Session-scoped availability policy for inherited `web_search` and `web_fetch`. The package owns the durable `web/networking` event, the `webNetworking` Client projection, the `/web` command, and the live `tools.restrict` disposer that masks or restores the two tools for one agent.

## Host behavior

Networking defaults to enabled when a session has no `web/networking` event. `/web off` appends `{ enabled: false }`; `/web` appends `{ enabled: true }`. The fold is last-event-wins, so replay reconstructs the preference without a separate settings store.

When an agent is created or the command changes the preference, `WebNetworkingController` aligns the live tool restriction with the folded value. It probes the agent's complete inherited tool view before restricting, so search-only compositions remain valid. Re-enabling calls the exact disposer created for that session. Agent disposal and plugin teardown release process-local restrictions; the event log remains the source used after resume.

The optional session-projection child exposes `{ enabled: boolean }` to Web Clients. The optional commands child owns `/web`; a headless composition can mount the policy without either surface.

## Model Experience

### Web tool visibility

#### What the model sees

When networking is enabled, the model receives the inherited `web_search` and/or `web_fetch` schemas supplied by the composition. When disabled, those schemas are absent for that session. This policy does not add or remove `dsh-tool-web` prompt sections.

#### Token effect

Disabling networking removes the enabled web tool schemas from each request; enabling restores their fixed schema cost. The durable event itself is mechanism state and is not rendered as a message.

#### KV Cache effect

Changing the preference may invalidate reuse from the first changed tool-schema token. Requests remain prefix-stable while the folded preference and inherited tool registrations are unchanged.

## Known Limitations and Deferred Work

- **Search and fetch move together** — the event and command do not represent independent tool preferences.
- **Inherited tool names are fixed** — this policy targets `web_search` and `web_fetch`; alternative consumer names need their own policy.
- **Live restrictions are process-local** — they are reconstructed from the session log when an agent is created rather than persisted as runtime objects.

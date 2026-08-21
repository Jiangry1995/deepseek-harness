# Use the Web UI

English | [中文](index.zh.md)

Start the Web UI through the [root README](../../../README.md#run); the command prints its URL. This guide begins after that server is running. The `dsh` process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.

## Configure a model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save it. The model route becomes usable immediately without restarting the server.

The [model configuration guide](./providers.md) covers other providers and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `dsh`, and select it. The session composer remains unavailable until a workspace is selected.

## Use the browser side assistant (optional)

The optional Chromium extension opens the complete Harness UI beside the current page and lets the agent read and operate tabs in the current browser window. When running from this repository:

1. Run `pnpm --filter @deepseek-ai/dsh-client-browser-extension bundle`.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `packages/client/browser-extension/extension`.
3. Click the extension toolbar action. Harness opens in the browser side panel and connects to `http://127.0.0.1:3080` by default; use the panel settings button when the Web profile uses another loopback port.
4. Ask the agent in the side panel to list the current tabs. A returned tab list confirms that the side-panel Web Client, extension bridge, and Host broker are connected.

After rebuilding the extension, click **Reload** on its `chrome://extensions` card before reopening the side panel. Windows packaging and companion-service instructions live in the [desktop application README](../../../DesktopApp/README.md); extension permissions and failure behavior live in the [extension README](../../../packages/client/browser-extension/README.md).

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.

## Continue

- [Configure models](./providers.md)
- [Use the Python SDK](./python-sdk.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
- [Understand browser-tab routing](../../subsystems/browser.md)

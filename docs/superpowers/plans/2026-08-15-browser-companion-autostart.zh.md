# 浏览器伴随程序自动启动实施计划

[English](2026-08-15-browser-companion-autostart.md) | 中文

> **供执行计划的 Agent 使用：** 在现有 browser-extension worktree 中执行本计划，因为它扩展的功能仍未在那里提交。未经用户请求，不得暂存、提交或推送。

**目标：** 安装一个在登录时启动 Harness Web profile 的 Windows 托盘伴随程序，让用户能够打开、停止、重启和检查服务；当登录启动未运行时，Chromium 侧栏还能启动伴随程序和 Web 服务完成恢复。

**架构：** `@deepseek-ai/dsh-client-browser-extension` 在 MV3 产物旁拥有一个 Windows 伴随可执行文件。当前用户的计划任务在交互式登录时启动托盘；Chrome Native Messaging 按需启动同一个可执行文件，并且只发送 `ensure-web`。托盘是其创建的 Web 进程的唯一所有者，使用关闭即终止的 Job Object 约束这些进程，公开仅限当前用户的命名管道命令通道，并把已经监听 3080 端口的服务器视为外部进程，因此不得停止它。

**技术栈：** Chromium MV3 TypeScript、Vitest/jsdom、C#/.NET Framework WinForms、Windows Job Object 与命名管道、PowerShell 7 安装／构建脚本、任务计划程序、HKCU Native Messaging 注册。

---

### 任务 1：先用测试固定扩展启动行为

**文件：**
- 修改：`packages/client/browser-extension/tests/extension-runtime.client.spec.ts`
- 修改：`packages/client/browser-extension/tests/sidepanel-runtime.client.spec.ts`
- 修改：`packages/client/browser-extension/extension/manifest.json`

- [ ] 添加后台监听器测试，证明只有扩展侧栏页面能够请求 `{ kind: 'ensure-local-harness', origin: 'http://127.0.0.1:3080' }`，请求会转发给 `com.deepseek.dsh_browser_companion`，格式错误的 origin 和回环 content page 无法访问 Native Messaging。
- [ ] 添加侧栏控制器测试，证明初次探测失败会进入 `starting`，只调用一次注入的启动器，原生响应成功后进行无循环重试，并在不隐藏原始连接问题的前提下报告安装／启动失败。
- [ ] 更新 manifest 期望，要求 `nativeMessaging` 和稳定的开发 `key`。
- [ ] 运行两个定向 Vitest 文件，观察缺少启动路径导致的失败。

### 任务 2：实现扩展到伴随程序的请求路径

**文件：**
- 修改：`packages/client/browser-extension/src/extension/runtime.ts`
- 修改：`packages/client/browser-extension/src/extension/background.ts`
- 修改：`packages/client/browser-extension/src/extension/sidepanel-runtime.ts`
- 修改：`packages/client/browser-extension/src/extension/sidepanel.ts`
- 修改：`packages/client/browser-extension/extension/sidepanel.html`
- 修改：`packages/client/browser-extension/extension/sidepanel.css`
- 修改：`packages/client/browser-extension/extension/manifest.json`

- [ ] 在 Service Worker 中添加封闭的原生请求／响应解析器。只接受精确的侧栏 sender URL，只规范化回环且仅含 origin 的 HTTP URL，调用 `runtime.sendNativeMessage`，并把 Chrome 的 host-not-found 或 host-exited 失败转换为简洁的中文 UI 诊断。
- [ ] 向 `SidePanelController` 注入 `ensureHarness(origin)`。只在网络／超时失败后尝试原生启动，不在收到 HTTP 响应后启动，并且每次连接尝试最多启动一次。
- [ ] 添加 `starting` 展示，保留设置入口并说明托盘伴随程序正在启动 Harness。
- [ ] 运行定向 Vitest 文件，确认新行为和现有浏览器标签页路径一起通过。

### 任务 3：围绕明确所有权构建 Windows 伴随程序

**文件：**
- 创建：`packages/client/browser-extension/windows/DeepSeekHarness.Companion.cs`
- 创建：`packages/client/browser-extension/windows/DeepSeekHarness.Companion.Tests.cs`
- 创建：`packages/client/browser-extension/windows/build.ps1`

- [ ] 从会抛出 `NotImplementedException` 的公共协议／配置／命令行桩开始，然后添加控制台测试可执行文件，覆盖 UTF-8 原生消息帧、封闭的 `ensure-web` 请求、origin／配置校验、Chrome 调用识别和响应序列化。运行测试并观察预期的失败断言。
- [ ] 使用 32 位小端字节长度和最多一条消息实现 Native Messaging 帧，只把诊断写入配置的日志或 stderr。
- [ ] 实现单实例 WinForms 托盘，菜单包含状态、打开 Harness、启动、重启、停止、日志和退出。即使服务启动失败，也要保留托盘图标。
- [ ] 实现仅限当前用户的命名管道命令服务器。Native Messaging 调用连接托盘；托盘不存在时先启动它，再发送 `ensure-web`，等待服务就绪并返回一条带帧结果。
- [ ] 从已安装的仓库根目录启动固定命令 `node --import tsx/esm apps/cli/src/bin.ts --profile web`，清理环境变量、隐藏窗口、限制就绪等待时间，并写入带时间戳的 UTF-8 日志。拒绝任意命令、参数、根目录、origin 和 profile。
- [ ] 把自有进程放入关闭即终止的 Windows Job Object。停止／重启会终止自有 job，等待进程退出和端口释放，绝不终止托盘未创建的健康进程。
- [ ] 通过 `windows/build.ps1 -RunTests` 运行 C# 控制台测试，确认所有断言通过。

### 任务 4：安装、卸载和修复当前用户集成

**文件：**
- 创建：`packages/client/browser-extension/windows/install.ps1`
- 创建：`packages/client/browser-extension/windows/uninstall.ps1`
- 修改：`packages/client/browser-extension/package.json`

- [ ] 安装时使用可用的 .NET Framework C# 编译器构建伴随程序，只把运行时产物复制到 `%LOCALAPPDATA%\DeepSeekHarness\BrowserCompanion`，写入 UTF-8 配置和 Native Messaging manifest 文件，并通过 manifest 公钥推导稳定的扩展 id。
- [ ] 注册 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.dsh_browser_companion` 和名为 `DeepSeek Harness Browser Companion` 的当前用户交互式登录计划任务。配置错过后补启动和有界重试，然后启动任务。
- [ ] 重复安装会替换自有任务、manifest、配置和可执行文件，但不会删除日志。替换前校验每个解析后的源路径与目标路径。
- [ ] 卸载会停止自有任务／进程，只注销精确的任务和 HKCU 键，并且只在校验路径后删除精确的伴随程序安装目录。绝不触碰不归伴随程序所有的 Harness Web 进程。
- [ ] 添加 `windows:build`、`windows:test`、`windows:install` 和 `windows:uninstall` 包脚本，并随扩展包发布 Windows 源码／脚本。

### 任务 5：记录持久行为并验证组装路径

**文件：**
- 修改：`packages/client/browser-extension/README.md`
- 修改：`packages/client/browser-extension/README.zh.md`
- 修改：`docs/user/guide/index.md`
- 修改：`docs/user/guide/index.zh.md`
- 修改：`docs/subsystems/browser.md`
- 修改：`docs/subsystems/browser.zh.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.zh.md`
- 重新记录：对应的 `.i18n.yaml` 文件。

- [ ] 在所属包 README 中记录一次性安装命令、稳定扩展重新加载要求、托盘操作、登录任务、Native Messaging 回退、日志位置、外部进程所有权规则、修复／重装命令和卸载命令；上层文档保持简洁并链接到这里。
- [ ] 更新现有 browser-extension Agent Note，不创建相互竞争的 owner。记录原生启动安全规则、进程所有权、任务／原生回退、替代方案和当前验证证据；审计相关 active note 是否被取代。
- [ ] 运行定向 Vitest、包 TypeScript 构建、扩展 bundle、定向 oxlint、C# 测试、文档配对／格式／预算检查和修改文件空白检查。
- [ ] 在当前 Windows 账户安装伴随程序，验证计划任务和 Native Messaging 注册表项，停止服务，调用真实原生 host 帧路径，并确认托盘拥有的 Web profile 在 127.0.0.1:3080 上恢复健康。
- [ ] 在有界面 Chromium 中加载／重载解压扩展，在 3080 停止时打开侧栏，验证它显示`正在启动`、启动托盘／Web 服务、嵌入 Harness Web UI，并保留现有真实 `list-tabs` 桥。

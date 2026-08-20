# DeepSeek Harness Desktop

[English](README.md) | 中文

`DesktopApp` 是这份检出的嵌套 Electron 壳。它不替换 Agent、会话、工具、配置和 Web 实现。打开 EXE 会在 `127.0.0.1:3080` 启动 `dsh web`；关闭最后一个窗口会停掉这棵由 EXE 拥有的 Host 进程树。Chrome 侧边助手和普通浏览器 H5 都连同一个 loopback origin。

## 开发

前置条件：仓库依赖已经安装，Node.js 满足根目录版本要求。首次进入本目录后安装桌面壳依赖：

```powershell
cd DesktopApp
pnpm install
```

启动桌面壳：

```powershell
pnpm start
```

开发模式优先使用当前仓库已经构建的 `apps/cli/lib/bin.js`；该文件不存在时，通过根目录的 `tsx` 从 `apps/cli/src/bin.ts` 启动。Harness 后端以用户的 Documents 目录为工作目录，并沿用默认 `DSH_HOME`，因此命令行版、H5 和桌面版共享会话、设置与凭据。若 `http://127.0.0.1:3080` 已经健康，`pnpm start` 会复用该 Host，而不会结束它。

## 验证

```powershell
pnpm test
```

测试覆盖就绪地址校验、分块输出恢复、占领端口、打包态与开发态生命周期，以及假后端的启动和停止。单元测试不会调用模型 API，也不会碰正在运行的 `3080` Host。

## 构建 Windows 绿色包

在仓库根目录执行：

```powershell
pnpm dist:win
```

若直接调用 `DesktopApp` 脚本，请先在仓库根目录执行 `pnpm run build`。随后根命令执行以下操作：

1. 构建当前检出（CLI、库、Web UI 和侧边助手资源）。
2. 构建并运行桌面壳测试。
3. 从 Node.js 官方发布地址下载固定的 Windows x64 Node 24 ZIP，并按官方 `SHASUMS256.txt` 校验 SHA-256。
4. 按仓库发布范围把当前检出的 DSH、vendored Cordis 和 Landlock 入口构建成 npm tarball。
5. 从这些本地 tarball 安装生产依赖闭包，然后检查 `dsh --version` 和已打包的 Web 前端入口。
6. 用临时端口对暂存后的 Web profile 做冒烟测试，避免打包过程占领开发者正在使用的 `3080` Host。
7. 复制现有伴随程序卸载脚本、生成应用图标，并构建 Windows x64 zip 绿色包。
8. 按解包后的实际资源布局再次冒烟测试，再把 `packages/client/browser-extension/extension` 打成 `DesktopApp/release/dsh-side-assistant.zip`。

输出位于 `DesktopApp/release/`。默认可分发文件是 `DeepSeek-Harness-<version>-win-x64.zip`：解压后双击 `DeepSeek Harness.exe`。压缩包内含独立 Node.js 运行时和这份检出的 Host，目标机器不需要安装 Node.js、pnpm 或源码仓库。Node 与 Harness 暂存内容位于被忽略的 `DesktopApp/.runtime/`，不会提交到 Git。

## 生命周期与安全

- 打包后的 EXE 始终绑定 `http://127.0.0.1:3080`。若该端口已被占用，会先结束占用者再启动自己的 Host。它不会挂到外部 Host 上。点关闭时会询问：最小化到托盘（Host 继续运行）或退出（停止本 EXE 拉起的 Host）。主动退出时不会把后端停止当成崩溃提示。
- 打包态每次启动会刷新桌面和开始菜单快捷方式，并在当前用户的「应用和功能」中登记卸载项。卸载脚本删除程序文件夹和快捷方式，不删除 `~/.dsh`。
- 首次打包启动会运行 `packages/client/browser-extension/windows/uninstall.ps1`，移除登录计划任务、Native Messaging Host 以及 `%LOCALAPPDATA%\DeepSeekHarness\BrowserCompanion`。
- Renderer 启用 Chromium 沙箱与 context isolation，并禁用 Node integration。
- 桌面窗口拒绝非后端 origin 的导航；普通 HTTP(S) 外链交给系统浏览器。
- 关闭窗口时会询问最小化到托盘还是退出。选择退出才会结束由本 EXE 拥有的完整后端进程树。Windows 使用系统 `taskkill /T /F`。
- 桌面壳不设置 `DSH_HOME`，因此沿用 Harness 的默认用户数据位置。
- Chrome 扩展 zip 是并列产物。从 zip 里加载未打包的 `extension` 目录；不要把扩展打进 asar。

## 首版限制

- 只构建 Windows x64 zip 绿色包。没有安装向导；快捷方式和卸载项在第一次运行 EXE 后出现。
- 不包含代码签名、自动更新、文件关联和自定义标题栏。
- 暂缓 Native Messaging「点插件启动 EXE」。没有 EXE 时侧边助手没有服务，这是预期行为。
- 这是复用浏览器 HTTP 载体的兼容壳，不是 `file://` 与 IPC Electron 客户端。
- 打包使用当前检出的 Harness 构建产物，并要求其版本与 `package.json` 的 `desktopRuntime.harnessVersion` 一致。

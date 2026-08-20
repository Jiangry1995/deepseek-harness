import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, nativeImage, shell, type NativeImage } from 'electron'
import {
  resolveBackendLaunch,
  startBackend,
  type BackendHandle,
  type BackendOutput,
} from './backend.js'
import { uninstallBrowserCompanion, resolveCompanionUninstallScript } from './companion.js'
import {
  PORTABLE_APP_USER_MODEL_ID,
  PORTABLE_PUBLISHER,
  installPortableShell,
} from './portable-shell.js'
import {
  HARNESS_ORIGIN,
  isHarnessHealthy,
  takeOverListeningPort,
} from './port.js'
import {
  shouldPromptOnWindowClose,
  shouldReportUnexpectedBackendExit,
} from './close-behavior.js'
import { promptWindowClose } from './close-prompt.js'
import {
  SESSION_IDLE_CHANNEL,
  sessionIdleNotificationBody,
  sessionIdlePageTitle,
  shouldShowSessionIdleNotification,
} from './session-notify.js'
import { prepareBackendLifecycle } from './session.js'

const APP_TITLE = 'DeepSeek Harness'
let mainWindow: BrowserWindow | undefined
let backend: BackendHandle | undefined
let backendOwned = false
let backendLogger: ReturnType<typeof createBackendLogger> | undefined
let tray: Tray | undefined
let idleNotification: Notification | undefined
let intentionalExit = false
let closePromptOpen = false
let backendStopped = false
let shutdown: Promise<void> | undefined

/** 生成可写入文件名的时间戳。 */
function timestampForFilename(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

/** 把后端 stdout/stderr 写到 Electron 日志目录，便于安装后排障。 */
function createBackendLogger(): { path: string; write(output: BackendOutput): void; close(): void } {
  const logDirectory = app.getPath('logs')
  mkdirSync(logDirectory, { recursive: true })
  const path = join(logDirectory, `desktop-backend-${timestampForFilename()}.log`)
  const stream = createWriteStream(path, { encoding: 'utf8', flags: 'wx' })
  return {
    path,
    write: ({ source, line }) => {
      stream.write(`${new Date().toISOString()} [${source}] ${line}\n`)
    },
    close: () => { stream.end() },
  }
}

/** 创建加载页窗口；图标缺失时不阻断启动。 */
function createWindow(): BrowserWindow {
  const icon = join(app.getAppPath(), 'resources', 'icon.ico')
  const window = new BrowserWindow({
    title: APP_TITLE,
    ...(existsSync(icon) ? { icon } : {}),
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(app.getAppPath(), 'resources', 'session-notify-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.setMenuBarVisibility(false)
  window.once('ready-to-show', () => { window.show() })
  window.on('focus', () => { window.flashFrame(false) })
  window.on('close', (event) => {
    if (intentionalExit) return
    event.preventDefault()
    if (!shouldPromptOnWindowClose({ intentionalExit, promptOpen: closePromptOpen })) return
    void confirmWindowClose()
  })
  void window.loadFile(join(app.getAppPath(), 'resources', 'loading.html'))
  return window
}

/** 解析托盘和图标用的应用图标，ico 不存在时回退到 svg。 */
function resolveAppIconImage(): NativeImage {
  const appPath = app.getAppPath()
  for (const name of ['icon.ico', 'icon.svg']) {
    const path = join(appPath, 'resources', name)
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createEmpty()
}

/** 把主窗口从托盘恢复到前台。 */
function showMainWindow(): void {
  if (mainWindow === undefined) return
  mainWindow.setSkipTaskbar(false)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 创建或复用托盘图标，供隐藏窗口后再次打开或退出。 */
function ensureTray(): void {
  if (tray !== undefined) return
  tray = new Tray(resolveAppIconImage())
  tray.setToolTip(APP_TITLE)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开', click: () => { showMainWindow() } },
    { label: '退出', click: () => { requestQuit() } },
  ]))
  tray.on('click', () => { showMainWindow() })
}

/** 销毁托盘，避免退出后图标残留。 */
function destroyTray(): void {
  tray?.destroy()
  tray = undefined
}

/** 隐藏窗口到托盘，Host 继续占用 3080。 */
function hideMainWindowToTray(): void {
  if (mainWindow === undefined) return
  ensureTray()
  mainWindow.setSkipTaskbar(true)
  mainWindow.hide()
}

/** 用户确认退出：先标记主动退出，再走统一停后端流程。 */
function requestQuit(): void {
  intentionalExit = true
  destroyTray()
  app.quit()
}

/** 任务完成时弹出系统通知，点击后回到窗口。 */
function showSessionIdleToast(pageTitle: string): void {
  if (mainWindow === undefined) return
  if (!shouldShowSessionIdleNotification({
    focused: mainWindow.isFocused(),
    visible: mainWindow.isVisible(),
  })) return
  if (!Notification.isSupported()) return
  idleNotification?.close()
  const notification = new Notification({
    title: APP_TITLE,
    body: sessionIdleNotificationBody(pageTitle, APP_TITLE),
    icon: resolveAppIconImage(),
  })
  notification.on('click', () => { showMainWindow() })
  notification.show()
  idleNotification = notification
  if (mainWindow.isVisible()) mainWindow.flashFrame(true)
}

/** 点关闭时询问最小化到托盘还是退出，取消则保持窗口打开。 */
async function confirmWindowClose(): Promise<void> {
  if (mainWindow === undefined || closePromptOpen || intentionalExit) return
  closePromptOpen = true
  try {
    const behavior = await promptWindowClose(
      mainWindow,
      join(app.getAppPath(), 'resources', 'close-prompt.html'),
    )
    if (behavior === 'tray') {
      hideMainWindowToTray()
      return
    }
    if (behavior === 'quit') requestQuit()
  } finally {
    closePromptOpen = false
  }
}

/** 判断 URL 是否为普通网页协议。 */
function isExternalWebUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** 把窗口导航锁在后端 origin，外链交给系统浏览器。 */
function lockNavigation(window: BrowserWindow, backendUrl: URL): void {
  const allowedOrigin = backendUrl.origin
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url) && new URL(url).origin !== allowedOrigin) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === allowedOrigin) return
    event.preventDefault()
    if (isExternalWebUrl(url)) void shell.openExternal(url)
  })
}

/** 关闭窗口时只停止本 EXE 拉起的 Host。一开始就标记主动退出，避免把 taskkill 当成崩溃。 */
async function stopApplication(): Promise<void> {
  intentionalExit = true
  shutdown ??= (async () => {
    try {
      if (backendOwned) await backend?.stop()
    } finally {
      backend = undefined
      backendOwned = false
      backendLogger?.close()
      backendLogger = undefined
      destroyTray()
      backendStopped = true
    }
  })()
  await shutdown
}

/** 开发态复用或打包态占领 3080 后加载 Web UI。 */
async function startApplication(): Promise<void> {
  app.setAppUserModelId(PORTABLE_APP_USER_MODEL_ID)
  const logger = createBackendLogger()
  backendLogger = logger
  mainWindow = createWindow()
  mainWindow.once('closed', () => {
    mainWindow = undefined
    if (tray !== undefined && !intentionalExit) return
    requestQuit()
  })

  try {
    if (app.isPackaged) {
      try {
        await installPortableShell({
          exePath: process.execPath,
          version: app.getVersion(),
          publisher: PORTABLE_PUBLISHER,
          desktopDir: app.getPath('desktop'),
          startMenuDir: join(
            app.getPath('appData'),
            'Microsoft',
            'Windows',
            'Start Menu',
            'Programs',
          ),
          writeShortcut: (path, details) => shell.writeShortcutLink(path, {
            target: details.target,
            cwd: details.cwd,
            icon: details.icon,
            iconIndex: details.iconIndex,
            description: details.description,
            appUserModelId: details.appUserModelId,
          }),
        })
      } catch (error: unknown) {
        console.error('安装桌面快捷方式或卸载项失败', error)
      }
    }
    const launch = resolveBackendLaunch({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      electronExecutable: process.execPath,
      cwd: app.getPath('documents'),
      env: process.env,
      onOutput: output => { logger.write(output) },
    })
    const session = await prepareBackendLifecycle({
      isPackaged: app.isPackaged,
      uninstallCompanion: async () => {
        await uninstallBrowserCompanion(resolveCompanionUninstallScript({
          isPackaged: true,
          resourcesPath: process.resourcesPath,
          repositoryRoot: dirname(app.getAppPath()),
        }))
      },
      takeOverPort: async () => {
        await takeOverListeningPort(Number(new URL(HARNESS_ORIGIN).port))
      },
      isHarnessHealthy: async () => await isHarnessHealthy(),
      startOwnedBackend: async () => await startBackend(launch),
    })
    backend = session.handle
    backendOwned = session.owned
    lockNavigation(mainWindow, backend.url)
    await mainWindow.loadURL(backend.url.href)
    void backend.exit.then((result) => {
      if (!shouldReportUnexpectedBackendExit({ intentionalExit, backendOwned })) return
      dialog.showErrorBox(
        'Harness 后端已退出',
        `后端进程意外退出（code=${String(result.code)}, signal=${String(result.signal)}）。\n日志：${logger.path}`,
      )
      requestQuit()
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('无法启动 DeepSeek Harness', `${message}\n日志：${logger.path}`)
    requestQuit()
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
  app.on('before-quit', (event) => {
    if (backendStopped) return
    event.preventDefault()
    void stopApplication().then(
      () => { app.quit() },
      (error: unknown) => {
        backendStopped = true
        dialog.showErrorBox('无法完全停止 Harness 后端', error instanceof Error ? error.message : String(error))
        app.quit()
      },
    )
  })
  app.on('window-all-closed', () => {
    if (tray !== undefined && !intentionalExit) return
    requestQuit()
  })
  ipcMain.on(SESSION_IDLE_CHANNEL, (_event, payload: unknown) => {
    showSessionIdleToast(sessionIdlePageTitle(payload, APP_TITLE))
  })
  void app.whenReady().then(startApplication)
}

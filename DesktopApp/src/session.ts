import type { BackendHandle } from './backend.js'
import { HARNESS_ORIGIN } from './port.js'

/** 桌面窗口将要加载的后端，以及关闭窗口时是否必须停掉它。 */
export interface DesktopBackendSession {
  handle: BackendHandle
  owned: boolean
}

/** 准备桌面后端时注入的副作用，便于单测覆盖占领/复用分支。 */
export interface BackendLifecycleHooks {
  isPackaged: boolean
  uninstallCompanion(): Promise<void>
  takeOverPort(): Promise<void>
  isHarnessHealthy(): Promise<boolean>
  startOwnedBackend(): Promise<BackendHandle>
  detachedUrl?: URL
}

/** 构造一个不归桌面进程所有的外部 Host 句柄，关闭窗口时不得停止它。 */
export function detachedBackendHandle(url: URL = new URL(`${HARNESS_ORIGIN}/`)): BackendHandle {
  return {
    url,
    exit: new Promise(() => {}),
    stop: async () => ({ code: null, signal: null }),
  }
}

/**
 * 打包 EXE 必须卸载旧伴随程序、占领 3080 并拉起自己的 Host。
 * 开发态发现 3080 已健康时复用，避免 `pnpm start` 杀掉正在跑的 `dsh web`。
 */
export async function prepareBackendLifecycle(
  hooks: BackendLifecycleHooks,
): Promise<DesktopBackendSession> {
  if (hooks.isPackaged) {
    await hooks.uninstallCompanion()
    await hooks.takeOverPort()
    return { handle: await hooks.startOwnedBackend(), owned: true }
  }
  if (await hooks.isHarnessHealthy()) {
    return {
      handle: detachedBackendHandle(hooks.detachedUrl ?? new URL(`${HARNESS_ORIGIN}/`)),
      owned: false,
    }
  }
  return { handle: await hooks.startOwnedBackend(), owned: true }
}

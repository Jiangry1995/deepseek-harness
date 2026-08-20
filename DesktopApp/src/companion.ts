import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runHiddenCommand } from './port.js'

/** 解析伴随程序卸载脚本时需要的 Electron 路径。 */
export interface CompanionUninstallPaths {
  isPackaged: boolean
  resourcesPath: string
  repositoryRoot: string
}

/** 按打包与否定位托盘伴随程序卸载脚本。 */
export function resolveCompanionUninstallScript(paths: CompanionUninstallPaths): string {
  if (paths.isPackaged) {
    return join(paths.resourcesPath, 'uninstall-companion.ps1')
  }
  return join(
    paths.repositoryRoot,
    'packages',
    'client',
    'browser-extension',
    'windows',
    'uninstall.ps1',
  )
}

/** 运行现有 Windows 伴随程序卸载脚本，去掉登录任务、Native Messaging 和安装目录。 */
export async function uninstallBrowserCompanion(
  scriptPath: string,
  run: (command: string, args: string[]) => Promise<string> = runHiddenCommand,
): Promise<string> {
  if (!existsSync(scriptPath)) {
    throw new Error(`找不到伴随程序卸载脚本：${scriptPath}`)
  }
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  return await run(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ])
}

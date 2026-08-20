import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runHiddenCommand } from './port.js'

/** 与 appId 对齐，供任务栏把快捷方式和窗口归到同一组。 */
export const PORTABLE_APP_USER_MODEL_ID = 'ai.deepseek.harness.desktop'

/** 「应用和功能」卸载项的注册表键名。 */
export const PORTABLE_UNINSTALL_REGISTRY_KEY = 'ai.deepseek.harness.desktop'

/** 桌面和开始菜单快捷方式文件名。 */
export const PORTABLE_SHORTCUT_BASENAME = 'DeepSeek Harness.lnk'

/** 解压根目录里的卸载脚本文件名。 */
export const PORTABLE_UNINSTALL_SCRIPT_NAME = 'uninstall.ps1'

/** 「应用和功能」里的发布者。个人开发署名，打包产物只允许用这个名字。 */
export const PORTABLE_PUBLISHER = '沭河'

/** 写入 .lnk 时需要的字段，避免测试依赖 Electron 类型。 */
export interface PortableShortcutDetails {
  target: string
  cwd: string
  icon: string
  iconIndex: number
  description: string
  appUserModelId: string
}

/** 创建或覆盖快捷方式。返回 false 表示系统拒绝写入。 */
export type ShortcutWriter = (path: string, details: PortableShortcutDetails) => boolean | void

/** 安装绿色包外壳（快捷方式 + 卸载项）所需的路径和元数据。 */
export interface PortableShellInstallInput {
  exePath: string
  version: string
  publisher: string
  desktopDir: string
  startMenuDir: string
  writeShortcut: ShortcutWriter
}

/** 桌面与开始菜单快捷方式的绝对路径。 */
export function portableShortcutPaths(desktopDir: string, startMenuDir: string): {
  desktop: string
  startMenu: string
} {
  return {
    desktop: join(desktopDir, PORTABLE_SHORTCUT_BASENAME),
    startMenu: join(startMenuDir, PORTABLE_SHORTCUT_BASENAME),
  }
}

/** 定位解压根目录中的卸载脚本。 */
export function resolvePortableUninstallScript(exePath: string): string {
  return join(dirname(exePath), PORTABLE_UNINSTALL_SCRIPT_NAME)
}

/** 组装指向当前 EXE 的快捷方式内容。 */
export function portableShortcutDetails(exePath: string): PortableShortcutDetails {
  return {
    target: exePath,
    cwd: dirname(exePath),
    icon: exePath,
    iconIndex: 0,
    description: 'DeepSeek Harness',
    appUserModelId: PORTABLE_APP_USER_MODEL_ID,
  }
}

/** 把 PowerShell 脚本编成 -EncodedCommand 使用的 UTF-16LE Base64。 */
export function encodePowershellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** 生成写入当前用户卸载项的 PowerShell 脚本。 */
export function buildUninstallRegistrationScript(input: {
  exePath: string
  uninstallScriptPath: string
  version: string
  publisher: string
}): string {
  const key = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PORTABLE_UNINSTALL_REGISTRY_KEY}`
  const uninstallCommand = [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    input.uninstallScriptPath,
    '-Silent',
  ].join(' ')
  const installDir = dirname(input.exePath)
  return [
    `$key = ${powershellSingleQuote(key)}`,
    'New-Item -Path $key -Force | Out-Null',
    `Set-ItemProperty -Path $key -Name DisplayName -Value ${powershellSingleQuote('DeepSeek Harness')}`,
    `Set-ItemProperty -Path $key -Name DisplayVersion -Value ${powershellSingleQuote(input.version)}`,
    `Set-ItemProperty -Path $key -Name Publisher -Value ${powershellSingleQuote(input.publisher)}`,
    `Set-ItemProperty -Path $key -Name DisplayIcon -Value ${powershellSingleQuote(`${input.exePath},0`)}`,
    `Set-ItemProperty -Path $key -Name InstallLocation -Value ${powershellSingleQuote(installDir)}`,
    `Set-ItemProperty -Path $key -Name UninstallString -Value ${powershellSingleQuote(uninstallCommand)}`,
    `Set-ItemProperty -Path $key -Name QuietUninstallString -Value ${powershellSingleQuote(uninstallCommand)}`,
    'Set-ItemProperty -Path $key -Name NoModify -Type DWord -Value 1',
    'Set-ItemProperty -Path $key -Name NoRepair -Type DWord -Value 1',
  ].join('\n')
}

/** 创建或刷新桌面、开始菜单快捷方式，指向当前解压位置。 */
export function installPortableShortcuts(input: PortableShellInstallInput): void {
  mkdirSync(input.startMenuDir, { recursive: true })
  const paths = portableShortcutPaths(input.desktopDir, input.startMenuDir)
  const details = portableShortcutDetails(input.exePath)
  for (const path of [paths.desktop, paths.startMenu]) {
    const written = input.writeShortcut(path, details)
    if (written === false) {
      throw new Error(`无法写入快捷方式：${path}`)
    }
  }
}

/** 把卸载项写进当前用户的「应用和功能」。脚本缺失时跳过，不阻断启动。 */
export async function registerPortableUninstall(
  input: PortableShellInstallInput,
  run: (command: string, args: string[]) => Promise<string> = runHiddenCommand,
): Promise<void> {
  const uninstallScriptPath = resolvePortableUninstallScript(input.exePath)
  if (!existsSync(uninstallScriptPath)) return
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const script = buildUninstallRegistrationScript({
    exePath: input.exePath,
    uninstallScriptPath,
    version: input.version,
    publisher: input.publisher,
  })
  await run(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowershellCommand(script),
  ])
}

/** 打包态安装绿色包的外壳：快捷方式 + 卸载项。开发态不要调用。 */
export async function installPortableShell(input: PortableShellInstallInput): Promise<void> {
  const errors: string[] = []
  try {
    installPortableShortcuts(input)
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  try {
    await registerPortableUninstall(input)
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

/** 把字符串编成 PowerShell 单引号字面量。 */
function powershellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

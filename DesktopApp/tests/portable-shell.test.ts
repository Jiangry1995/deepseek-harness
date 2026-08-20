import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  PORTABLE_APP_USER_MODEL_ID,
  PORTABLE_PUBLISHER,
  PORTABLE_SHORTCUT_BASENAME,
  PORTABLE_UNINSTALL_SCRIPT_NAME,
  buildUninstallRegistrationScript,
  encodePowershellCommand,
  installPortableShortcuts,
  portableShortcutDetails,
  portableShortcutPaths,
  registerPortableUninstall,
  resolvePortableUninstallScript,
} from '../src/portable-shell.js'

test('绿色包发布者署名是沭河', () => {
  assert.equal(PORTABLE_PUBLISHER, '沭河')
})

test('快捷方式指向当前 EXE，并带上 AppUserModelId', () => {
  const exe = 'D:\\Apps\\DeepSeek Harness\\DeepSeek Harness.exe'
  const details = portableShortcutDetails(exe)
  assert.equal(details.target, exe)
  assert.equal(details.cwd, 'D:\\Apps\\DeepSeek Harness')
  assert.equal(details.icon, exe)
  assert.equal(details.appUserModelId, PORTABLE_APP_USER_MODEL_ID)
  const paths = portableShortcutPaths('D:\\Desktop', 'D:\\StartMenu')
  assert.equal(paths.desktop, join('D:\\Desktop', PORTABLE_SHORTCUT_BASENAME))
  assert.equal(paths.startMenu, join('D:\\StartMenu', PORTABLE_SHORTCUT_BASENAME))
})

test('installPortableShortcuts 会覆盖桌面和开始菜单两处快捷方式', () => {
  const written: string[] = []
  const home = mkdtempSync(join(tmpdir(), 'dsh-portable-shell-'))
  const exe = join(home, 'DeepSeek Harness.exe')
  installPortableShortcuts({
    exePath: exe,
    version: '0.1.0',
    publisher: PORTABLE_PUBLISHER,
    desktopDir: join(home, 'Desktop'),
    startMenuDir: join(home, 'StartMenu'),
    writeShortcut: (path, details) => {
      written.push(path)
      assert.equal(details.target, exe)
      return true
    },
  })
  assert.deepEqual(written, [
    join(home, 'Desktop', PORTABLE_SHORTCUT_BASENAME),
    join(home, 'StartMenu', PORTABLE_SHORTCUT_BASENAME),
  ])
})

test('卸载注册脚本包含静默卸载命令且不删除 .dsh', () => {
  const exe = 'D:\\Apps\\DeepSeek Harness\\DeepSeek Harness.exe'
  const uninstall = 'D:\\Apps\\DeepSeek Harness\\uninstall.ps1'
  const script = buildUninstallRegistrationScript({
    exePath: exe,
    uninstallScriptPath: uninstall,
    version: '0.1.0',
    publisher: PORTABLE_PUBLISHER,
  })
  assert.match(script, /DisplayName/)
  assert.match(script, /DisplayVersion/)
  assert.match(script, /沭河/)
  assert.match(script, /-Silent/)
  assert.match(script, /uninstall\.ps1/)
  assert.match(script, /InstallLocation/)
  assert.doesNotMatch(script, /\.dsh/)
  const encoded = encodePowershellCommand(script)
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), script)
})

test('registerPortableUninstall 在缺少卸载脚本时跳过', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-portable-unreg-'))
  await registerPortableUninstall({
    exePath: join(home, 'DeepSeek Harness.exe'),
    version: '0.1.0',
    publisher: 'x',
    desktopDir: home,
    startMenuDir: home,
    writeShortcut: () => true,
  }, async () => {
    throw new Error('不应调用 PowerShell')
  })
})

test('registerPortableUninstall 在脚本存在时使用 EncodedCommand', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-portable-reg-'))
  const exe = join(home, 'DeepSeek Harness.exe')
  writeFileSync(join(home, PORTABLE_UNINSTALL_SCRIPT_NAME), '# test')
  const calls: string[][] = []
  await registerPortableUninstall({
    exePath: exe,
    version: '0.1.0',
    publisher: PORTABLE_PUBLISHER,
    desktopDir: home,
    startMenuDir: home,
    writeShortcut: () => true,
  }, async (_command, args) => {
    calls.push(args)
    return ''
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.includes('-EncodedCommand'), true)
  assert.equal(resolvePortableUninstallScript(exe), join(home, PORTABLE_UNINSTALL_SCRIPT_NAME))
})

test('卸载脚本只删程序目录，不删用户 .dsh', () => {
  const script = readFileSync(new URL('../../resources/uninstall-portable.ps1', import.meta.url), 'utf8')
  assert.match(script, /不删除用户目录下的 \.dsh/)
  assert.match(script, /rmdir \/s \/q/)
  assert.match(script, /\[switch\]\$Silent/)
  assert.doesNotMatch(script, /Remove-Item.*\.dsh/)
})

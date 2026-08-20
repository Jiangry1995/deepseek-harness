import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { resolveCompanionUninstallScript, uninstallBrowserCompanion } from '../src/companion.js'

test('resolveCompanionUninstallScript 打包态使用 extraResources 脚本', () => {
  const path = resolveCompanionUninstallScript({
    isPackaged: true,
    resourcesPath: 'C:\\installed\\resources',
    repositoryRoot: 'D:\\repo',
  })
  assert.equal(path, join('C:\\installed\\resources', 'uninstall-companion.ps1'))
})

test('resolveCompanionUninstallScript 开发态指向仓库现有卸载脚本', () => {
  const path = resolveCompanionUninstallScript({
    isPackaged: false,
    resourcesPath: 'C:\\ignored',
    repositoryRoot: 'D:\\repo',
  })
  assert.equal(
    path,
    join('D:\\repo', 'packages', 'client', 'browser-extension', 'windows', 'uninstall.ps1'),
  )
})

test('uninstallBrowserCompanion 调用 PowerShell -File 且不吞掉脚本缺失', async () => {
  await assert.rejects(
    uninstallBrowserCompanion('D:\\missing-uninstall.ps1', async () => ''),
    /找不到伴随程序卸载脚本/,
  )
})

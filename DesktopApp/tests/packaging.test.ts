import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const desktopRoot = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)))

interface DesktopManifest {
  author: string
  scripts: { 'dist:win': string }
  build: {
    artifactName: string
    copyright: string
    extraFiles?: { from: string; to: string }[]
    win: { target: { target: string }[] }
  }
}

/** 读取桌面壳 package.json，供打包约定断言使用。 */
function readDesktopManifest(): DesktopManifest {
  return JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as DesktopManifest
}

/** 遍历桌面壳文本文件，跳过构建产物和依赖目录。 */
function walkDesktopTextFiles(
  root: string,
  skipDirs: Set<string>,
  visit: (file: string, text: string) => void,
): void {
  for (const name of readdirSync(root)) {
    if (skipDirs.has(name)) continue
    const full = join(root, name)
    if (statSync(full).isDirectory()) {
      walkDesktopTextFiles(full, skipDirs, visit)
      continue
    }
    if (!/\.(ts|js|mjs|cjs|json|txt|md|html|ps1|cmd|nsh|yml|yaml)$/i.test(name)) continue
    visit(full, readFileSync(full, 'utf8'))
  }
}

test('默认 Windows 产物是 zip 绿色包而不是 NSIS 安装器', () => {
  const manifest = readDesktopManifest()
  assert.equal(manifest.build.win.target[0]?.target, 'zip')
  assert.match(manifest.scripts['dist:win'], /electron-builder --win zip --x64/)
  assert.equal(manifest.build.artifactName, 'DeepSeek-Harness-${version}-win-x64.${ext}')
  assert.doesNotMatch(manifest.build.artifactName, /Setup/)
  assert.doesNotMatch(manifest.scripts['dist:win'], /\bnsis\b/)
})

test('绿色包在解压根目录带使用说明和卸载脚本', () => {
  const manifest = readDesktopManifest()
  const extraFiles = manifest.build.extraFiles ?? []
  const byTo = Object.fromEntries(extraFiles.map(file => [file.to, file.from]))
  assert.equal(byTo['使用说明.txt'], 'resources/portable-readme.txt')
  assert.equal(byTo['uninstall.ps1'], 'resources/uninstall-portable.ps1')
  assert.equal(byTo['uninstall.cmd'], 'resources/uninstall-portable.cmd')
})

test('打包清单与桌面壳文本的发布者是沭河', () => {
  const manifest = readDesktopManifest()
  assert.equal(manifest.author, '沭河')
  assert.equal(manifest.build.copyright, '沭河')
  const skipDirs = new Set(['node_modules', 'dist', 'release', '.runtime'])
  const hits: string[] = []
  const forbidden = [String.fromCharCode(0x695a, 0x6dee), 'chu' + 'huai']
  walkDesktopTextFiles(desktopRoot, skipDirs, (file, text) => {
    const lowered = text.toLowerCase()
    if (forbidden.some(fragment => lowered.includes(fragment.toLowerCase()))) {
      hits.push(file)
    }
  })
  assert.deepEqual(hits, [])
})

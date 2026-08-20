import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '..')
const runtimeRoot = resolve(desktopRoot, '.runtime')
const downloadRoot = resolve(runtimeRoot, 'downloads')
const extractionRoot = resolve(runtimeRoot, 'extract')
const nodeRoot = resolve(runtimeRoot, 'node')
const appRoot = resolve(runtimeRoot, 'app')
const tarballRoot = resolve(runtimeRoot, 'tarballs')
const dshTarballRoot = resolve(tarballRoot, 'dsh')
const vendorTarballRoot = resolve(tarballRoot, 'vendor')
const landlockTarballRoot = resolve(tarballRoot, 'landlock')
const manifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'))
const { harnessVersion, nodeVersion } = manifest.desktopRuntime
const nodeArchiveName = `node-v${nodeVersion}-win-x64.zip`
const nodeBaseUrl = `https://nodejs.org/dist/v${nodeVersion}`
const nodeArchive = join(downloadRoot, nodeArchiveName)

/** 拒绝操作暂存目录以外的路径，避免 rm 扫到仓库其它位置。 */
function assertRuntimePath(path) {
  const rel = relative(runtimeRoot, resolve(path))
  if (rel === '' || rel.startsWith('..') || resolve(path) === desktopRoot) {
    throw new Error(`拒绝操作运行时暂存目录之外的路径：${path}`)
  }
}

/** 运行子进程，非 0 退出码视为失败。 */
async function run(command, args, options = {}) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options })
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${basename(command)} 失败（code=${String(code)}, signal=${String(signal)}）`))
    })
  })
}

/** 把暂存 Node 放到 PATH 前面，供 pack/install 使用。 */
function environmentWithNode({ ignoreScripts = false } = {}) {
  const environment = { ...process.env }
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'Path'
  environment[pathKey] = `${nodeRoot};${environment[pathKey] ?? ''}`
  environment.pnpm_config_pm_on_fail = 'ignore'
  if (ignoreScripts) environment.npm_config_ignore_scripts = 'true'
  else delete environment.npm_config_ignore_scripts
  return environment
}

/** 下载远程文件到本地。 */
async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`下载失败：${url}（HTTP ${String(response.status)}）`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  await writeFile(destination, bytes)
}

/** 计算文件 SHA-256。 */
async function sha256(path) {
  const hash = createHash('sha256')
  await new Promise((resolveHash, rejectHash) => {
    const input = createReadStream(path)
    input.on('data', chunk => { hash.update(chunk) })
    input.once('error', rejectHash)
    input.once('end', resolveHash)
  })
  return hash.digest('hex')
}

/** 把路径编码成 PowerShell 单引号字面量。 */
function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

/** 下载并校验官方 Windows x64 Node ZIP，再解压到 .runtime/node。 */
async function stageNode() {
  await mkdir(downloadRoot, { recursive: true })
  const sumsPath = join(downloadRoot, 'SHASUMS256.txt')
  await Promise.all([
    download(`${nodeBaseUrl}/${nodeArchiveName}`, nodeArchive),
    download(`${nodeBaseUrl}/SHASUMS256.txt`, sumsPath),
  ])
  const sums = await readFile(sumsPath, 'utf8')
  const expected = sums.split(/\r?\n/).find(line => line.endsWith(`  ${nodeArchiveName}`))?.split(/\s+/)[0]
  if (expected === undefined) throw new Error(`Node 校验清单缺少 ${nodeArchiveName}`)
  const actual = await sha256(nodeArchive)
  if (actual !== expected) throw new Error(`Node 运行时 SHA-256 不匹配：expected=${expected}, actual=${actual}`)

  assertRuntimePath(extractionRoot)
  assertRuntimePath(nodeRoot)
  await rm(extractionRoot, { recursive: true, force: true })
  await rm(nodeRoot, { recursive: true, force: true })
  await mkdir(extractionRoot, { recursive: true })
  const expand = `Expand-Archive -LiteralPath ${powershellLiteral(nodeArchive)} -DestinationPath ${powershellLiteral(extractionRoot)} -Force`
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', expand])
  await rename(join(extractionRoot, `node-v${nodeVersion}-win-x64`), nodeRoot)
}

/** 按 npm pack 规则生成 tarball 文件名。 */
function tarballName(name, version) {
  const unscoped = name.startsWith('@') ? name.slice(1).replace('/', '-') : name
  return `${unscoped}-${version}.tgz`
}

/** 按目录深度收集本地 package.json。 */
async function collectPackages(container, depth) {
  const packages = []
  for (const entry of await readdir(container, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const entryPath = join(container, entry.name)
    if (depth === 1) {
      const packagePath = join(entryPath, 'package.json')
      try {
        packages.push({ directory: entryPath, manifest: JSON.parse(await readFile(packagePath, 'utf8')) })
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      continue
    }
    packages.push(...await collectPackages(entryPath, depth - 1))
  }
  return packages
}

/** 把已 pack 的 tarball 变成 file: URL 依赖表。 */
async function packedDependencies() {
  const dshPackages = [
    ...await collectPackages(join(repositoryRoot, 'packages'), 2),
    ...await collectPackages(join(repositoryRoot, 'apps'), 1),
  ]
  const vendorPackages = await collectPackages(join(repositoryRoot, 'vendor'), 1)
  const landlockManifest = JSON.parse(await readFile(join(repositoryRoot, 'native', 'landlock-run', 'packages', 'entry', 'package.json'), 'utf8'))
  const entries = [
    ...dshPackages.map(({ manifest: packageManifest }) => ({ packageManifest, directory: dshTarballRoot })),
    ...vendorPackages.map(({ manifest: packageManifest }) => ({ packageManifest, directory: vendorTarballRoot })),
    { packageManifest: landlockManifest, directory: landlockTarballRoot },
  ]
  const dependencies = {}
  for (const { packageManifest, directory } of entries) {
    const { name, version } = packageManifest
    if (typeof name !== 'string' || typeof version !== 'string') throw new Error('本地包 manifest 缺少 name/version')
    const filename = tarballName(name, version)
    const tarball = join(directory, filename)
    await readFile(tarball)
    dependencies[name] = pathToFileURL(tarball).href
  }
  return dependencies
}

/** 按包名排序后 pack 到目标目录。 */
async function packPackages(node, pnpm, packages, destination, environment) {
  const ordered = [...packages].sort((left, right) => String(left.manifest.name).localeCompare(String(right.manifest.name)))
  for (const { directory, manifest: packageManifest } of ordered) {
    const { name, version } = packageManifest
    if (typeof name !== 'string' || typeof version !== 'string') throw new Error(`${directory} 的 package.json 缺少 name/version`)
    await run(node, [pnpm, '--config.ignore-scripts=true', '--reporter=silent', '--dir', directory, 'pack', '--pack-destination', destination], { cwd: repositoryRoot, env: environment })
    await readFile(join(destination, tarballName(name, version)))
  }
}

/** 把当前检出打成 npm tarball，确保安装包打的是这份改过的源码。 */
async function packCurrentWorkspace() {
  const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  if (rootManifest.version !== harnessVersion) {
    throw new Error(`DesktopApp harnessVersion=${harnessVersion} 与根仓库 version=${String(rootManifest.version)} 不一致`)
  }
  await Promise.all([
    readFile(join(repositoryRoot, 'apps', 'cli', 'lib', 'bin.js')),
    readFile(join(repositoryRoot, 'apps', 'web', 'dist', 'index.html')),
    readFile(join(repositoryRoot, 'native', 'landlock-run', 'packages', 'entry', 'lib', 'index.js')),
  ]).catch(() => {
    throw new Error('当前检出缺少构建产物；请先在仓库根目录运行 pnpm run build')
  })

  for (const directory of [dshTarballRoot, vendorTarballRoot, landlockTarballRoot]) {
    assertRuntimePath(directory)
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
  }

  const node = join(nodeRoot, 'node.exe')
  const activePnpm = process.env.DSH_DESKTOP_PNPM_JS ?? process.env.npm_execpath
  const pnpm = activePnpm ?? join(nodeRoot, 'node_modules', 'corepack', 'dist', 'pnpm.js')
  const environment = environmentWithNode({ ignoreScripts: true })
  await readFile(pnpm)
  const dshPackages = [
    ...await collectPackages(join(repositoryRoot, 'packages'), 2),
    ...await collectPackages(join(repositoryRoot, 'apps'), 1),
  ]
  const vendorPackages = await collectPackages(join(repositoryRoot, 'vendor'), 1)
  const landlockDirectory = join(repositoryRoot, 'native', 'landlock-run', 'packages', 'entry')
  const landlockPackages = [{
    directory: landlockDirectory,
    manifest: JSON.parse(await readFile(join(landlockDirectory, 'package.json'), 'utf8')),
  }]
  await packPackages(node, pnpm, dshPackages, dshTarballRoot, environment)
  await packPackages(node, pnpm, vendorPackages, vendorTarballRoot, environment)
  await packPackages(node, pnpm, landlockPackages, landlockTarballRoot, environment)
}

/** 从本地 tarball 安装生产依赖闭包，并校验 dsh 与 Web 前端入口。 */
async function stageHarness() {
  assertRuntimePath(appRoot)
  await rm(appRoot, { recursive: true, force: true })
  await mkdir(appRoot, { recursive: true })
  const dependencies = await packedDependencies()
  await writeFile(join(appRoot, 'package.json'), `${JSON.stringify({
    name: 'deepseek-harness-desktop-runtime',
    private: true,
    version: manifest.version,
    dependencies,
  }, null, 2)}\n`)
  const node = join(nodeRoot, 'node.exe')
  const npm = join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await run(node, [npm, 'install', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false'], {
    cwd: appRoot,
    env: environmentWithNode(),
  })
  await run(node, [join(appRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '--version'], { cwd: appRoot })
  await readFile(join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'))
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('stage-runtime 当前只支持 Windows x64')
}

await mkdir(runtimeRoot, { recursive: true })
await stageNode()
await packCurrentWorkspace()
await stageHarness()
assertRuntimePath(extractionRoot)
await rm(extractionRoot, { recursive: true, force: true })
console.log(`stage-runtime: Node ${nodeVersion} + @deepseek-ai/dsh ${harnessVersion} 已暂存`)

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '..')
const extensionRoot = join(repositoryRoot, 'packages', 'client', 'browser-extension', 'extension')
const releaseRoot = join(desktopRoot, 'release')
const zipPath = join(releaseRoot, 'dsh-side-assistant.zip')

/** 运行 PowerShell 命令，失败则抛错。 */
async function runPowershell(command) {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`pack-extension 失败（code=${String(code)}, signal=${String(signal)}）`))
    })
  })
}

await readFile(join(extensionRoot, 'manifest.json'))
await readFile(join(extensionRoot, 'sidepanel.js'))
await mkdir(releaseRoot, { recursive: true })
await rm(zipPath, { force: true })
const destination = zipPath.replaceAll("'", "''")
const source = join(extensionRoot, '*').replaceAll("'", "''")
await runPowershell(`Compress-Archive -Path '${source}' -DestinationPath '${destination}' -Force`)
console.log(`pack-extension: ${zipPath}`)

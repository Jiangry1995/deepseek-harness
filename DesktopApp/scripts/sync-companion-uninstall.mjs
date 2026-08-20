import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '..')
const source = join(
  repositoryRoot,
  'packages',
  'client',
  'browser-extension',
  'windows',
  'uninstall.ps1',
)
const destinationDir = join(desktopRoot, 'resources')
const destination = join(destinationDir, 'uninstall-companion.ps1')

await mkdir(destinationDir, { recursive: true })
await copyFile(source, destination)
console.log(`sync-companion-uninstall: ${destination}`)

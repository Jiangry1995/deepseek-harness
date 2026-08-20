import { join, resolve } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
process.env.DSH_DESKTOP_RUNTIME_ROOT = join(desktopRoot, 'release', 'win-unpacked', 'resources', 'runtime')
await import('./smoke-runtime.mjs')

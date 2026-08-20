import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startBackend } from '../dist/src/backend.js'

const desktopRoot = resolve(import.meta.dirname, '..')
const runtimeRoot = process.env.DSH_DESKTOP_RUNTIME_ROOT === undefined
  ? join(desktopRoot, '.runtime')
  : resolve(process.env.DSH_DESKTOP_RUNTIME_ROOT)
const workspace = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
const output = []
let backend

try {
  // 冒烟使用随机端口，避免打包时误杀本机正在跑的 3080 Host。
  backend = await startBackend({
    command: join(runtimeRoot, 'node', 'node.exe'),
    args: [
      join(runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      '--profile',
      'web',
      '--port',
      '0',
    ],
    cwd: workspace,
    env: {
      ...process.env,
      DSH_HOME: join(workspace, '.dsh'),
    },
    startTimeoutMs: 90_000,
    onOutput: event => {
      output.push(`[${event.source}] ${event.line}`)
      if (output.length > 100) output.shift()
    },
  })
  const response = await fetch(backend.url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Web 首页返回 HTTP ${String(response.status)}`)
  const html = await response.text()
  if (!/<html(?:\s|>)/i.test(html)) throw new Error('Web 首页没有返回 HTML 文档')
  if (!html.includes('@deepseek-ai/dsh-client-ui-settings-vision-fallback')) {
    throw new Error('Web 首页缺少自动识图客户端模块')
  }
  console.log(`smoke-runtime: ${backend.url.href} 返回有效 HTML，并包含自动识图模块`)
} catch (error) {
  if (output.length > 0) console.error(output.join('\n'))
  throw error
} finally {
  await backend?.stop()
  await rm(workspace, { recursive: true, force: true })
}

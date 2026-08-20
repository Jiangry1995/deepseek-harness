import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { webProfileArgs } from './port.js'

const DEFAULT_START_TIMEOUT_MS = 60_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000
const READY_LINE = /(?:^|\s)dsh web:\s+(http:\/\/127\.0\.0\.1:(\d+))(?:\s|$)/

/** 后端标准输出或标准错误的一行。 */
export interface BackendOutput {
  source: 'stdout' | 'stderr'
  line: string
}

/** 启动一个 Harness 后端进程所需的已解析参数。 */
export interface BackendLaunchSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  startTimeoutMs?: number
  stopTimeoutMs?: number
  onOutput?: (output: BackendOutput) => void
}

/** Harness 后端进程的终止信息。 */
export interface BackendExit {
  code: number | null
  signal: NodeJS.Signals | null
}

/** 已就绪的 Harness 后端及其完全停稳操作。 */
export interface BackendHandle {
  url: URL
  exit: Promise<BackendExit>
  stop(): Promise<BackendExit>
}

/** Electron 开发或安装环境中的后端定位输入。 */
export interface BackendResolutionInput {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  electronExecutable: string
  cwd: string
  env: NodeJS.ProcessEnv
  onOutput?: (output: BackendOutput) => void
}

/** 将分块文本还原为完整行，结束时保留最后一条无换行内容。 */
export class LineBuffer {
  private pending = ''

  /** 追加一块输出并返回其中已经完整的行。 */
  push(chunk: string): string[] {
    this.pending += chunk
    const parts = this.pending.split(/\r?\n/)
    this.pending = parts.pop() ?? ''
    return parts
  }

  /** 取出缓冲区里尚未换行的最后一段。 */
  finish(): string[] {
    if (this.pending === '') return []
    const line = this.pending
    this.pending = ''
    return [line]
  }
}

/** 只接受由现有 Web profile 发布的 IPv4 loopback 就绪地址。 */
export function parseReadyUrl(line: string): URL | undefined {
  const match = READY_LINE.exec(line)
  if (match === null) return undefined
  const raw = match[1]
  const port = Number(match[2])
  if (raw === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  return new URL(raw)
}

/** 根据 Electron 是否已打包，解析安装载荷或当前检出的 Harness 入口。 */
export function resolveBackendLaunch(input: BackendResolutionInput): BackendLaunchSpec {
  const env = { ...input.env }
  const profileArgs = webProfileArgs()
  let command: string
  let args: string[]

  if (input.isPackaged) {
    delete env.ELECTRON_RUN_AS_NODE
    command = join(input.resourcesPath, 'runtime', 'node', 'node.exe')
    args = [
      join(input.resourcesPath, 'runtime', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      ...profileArgs,
    ]
  } else {
    const repositoryRoot = dirname(input.appPath)
    const builtEntry = join(repositoryRoot, 'apps', 'cli', 'lib', 'bin.js')
    const sourceEntry = join(repositoryRoot, 'apps', 'cli', 'src', 'bin.ts')
    command = input.electronExecutable
    env.ELECTRON_RUN_AS_NODE = '1'
    args = existsSync(builtEntry)
      ? [builtEntry, ...profileArgs]
      : ['--import', 'tsx/esm', sourceEntry, ...profileArgs]
  }

  return {
    command,
    args,
    cwd: resolve(input.cwd),
    env,
    ...(input.onOutput === undefined ? {} : { onOutput: input.onOutput }),
  }
}

/** 确认启动命令和 Harness 入口文件都在磁盘上。 */
function assertLaunchFiles(spec: BackendLaunchSpec): void {
  if (!existsSync(spec.command)) {
    throw new Error(`找不到后端运行时：${spec.command}`)
  }
  const entry = spec.args.find(arg => /(?:bin\.js|bin\.ts)$/.test(arg))
  if (entry !== undefined && !existsSync(entry)) {
    throw new Error(`找不到 Harness 后端入口：${entry}`)
  }
}

/** 等待指定毫秒。 */
function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

/** 在超时内观察进程退出；超时则返回 undefined。 */
async function waitWithin(exit: Promise<BackendExit>, timeoutMs: number): Promise<BackendExit | undefined> {
  return await Promise.race([exit, delay(timeoutMs).then(() => undefined)])
}

/** 用系统 taskkill 结束 Windows 进程树。 */
async function runTaskkill(pid: number): Promise<void> {
  await new Promise<void>((resolveTaskkill) => {
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    const killer = spawn(executable, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.once('error', () => { resolveTaskkill() })
    killer.once('exit', () => { resolveTaskkill() })
  })
}

/** 结束后端进程及其子进程，并等待完全停稳。 */
async function stopProcessTree(
  child: ChildProcessWithoutNullStreams,
  exit: Promise<BackendExit>,
  timeoutMs: number,
): Promise<BackendExit> {
  const settled = await waitWithin(exit, 0)
  if (settled !== undefined) return settled
  const pid = child.pid
  if (pid === undefined) return await exit

  if (process.platform === 'win32') {
    await runTaskkill(pid)
    const killed = await waitWithin(exit, timeoutMs)
    if (killed !== undefined) return killed
    child.kill('SIGKILL')
    return await exit
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // 进程组可能在检查后退出；后续 await 仍负责观察完全停稳。
  }
  const graceful = await waitWithin(exit, timeoutMs)
  if (graceful !== undefined) return graceful
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // 进程组可能在超时边缘退出；后续 await 仍收敛到同一终止事件。
  }
  return await exit
}

/** 启动 Harness 后端，等待规范就绪行，并返回幂等的进程树停止操作。 */
export async function startBackend(spec: BackendLaunchSpec): Promise<BackendHandle> {
  assertLaunchFiles(spec)
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    detached: process.platform !== 'win32',
    stdio: 'pipe',
    windowsHide: true,
  })
  child.stdin.end()

  const exit = new Promise<BackendExit>((resolveExit) => {
    child.once('close', (code, signal) => { resolveExit({ code, signal }) })
  })
  const stdout = new LineBuffer()
  const stderr = new LineBuffer()
  let ready = false

  const readyUrl = await new Promise<URL>((resolveReady, rejectReady) => {
    const timeoutMs = spec.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    const timer = setTimeout(() => {
      rejectReady(new Error(`Harness 后端在 ${String(timeoutMs)}ms 内没有发布就绪地址`))
    }, timeoutMs)

    const acceptLine = (source: BackendOutput['source'], line: string): void => {
      spec.onOutput?.({ source, line })
      if (ready || source !== 'stdout') return
      const url = parseReadyUrl(line)
      if (url === undefined) return
      ready = true
      clearTimeout(timer)
      resolveReady(url)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of stdout.push(chunk)) acceptLine('stdout', line)
    })
    child.stderr.on('data', (chunk: string) => {
      for (const line of stderr.push(chunk)) acceptLine('stderr', line)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectReady(error)
    })
    child.once('exit', (code, signal) => {
      for (const line of stdout.finish()) acceptLine('stdout', line)
      for (const line of stderr.finish()) acceptLine('stderr', line)
      if (ready) return
      clearTimeout(timer)
      rejectReady(new Error(`Harness 后端在就绪前退出（code=${String(code)}, signal=${String(signal)}）`))
    })
  }).catch(async (error: unknown) => {
    await stopProcessTree(child, exit, spec.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)
    throw error
  })

  const expectedPort = requestedListenPort(spec.args)
  if (expectedPort !== undefined && expectedPort !== 0 && Number(readyUrl.port) !== expectedPort) {
    await stopProcessTree(child, exit, spec.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)
    throw new Error(`Harness 后端发布了 ${readyUrl.href}，期望端口 ${String(expectedPort)}`)
  }

  let stopping: Promise<BackendExit> | undefined
  return {
    url: readyUrl,
    exit,
    stop: () => {
      stopping ??= stopProcessTree(child, exit, spec.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)
      return stopping
    },
  }
}

/** 验证安装载荷中的固定 Windows 后端路径，供暂存脚本和诊断使用。 */
export function packagedBackendPaths(resourcesPath: string): { node: string; entry: string } {
  return {
    node: join(resourcesPath, 'runtime', 'node', 'node.exe'),
    entry: join(resourcesPath, 'runtime', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  }
}

/** 读取启动参数里 `--port` 的值；未给出时返回 undefined。 */
export function requestedListenPort(args: string[]): number | undefined {
  const index = args.lastIndexOf('--port')
  if (index < 0) return undefined
  const raw = args[index + 1]
  if (raw === undefined) return undefined
  const port = Number(raw)
  return Number.isInteger(port) ? port : undefined
}

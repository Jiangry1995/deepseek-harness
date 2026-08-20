import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { join } from 'node:path'

/** 桌面、H5 与 Chrome 侧栏共用的 loopback 主机。 */
export const HARNESS_HOST = '127.0.0.1'

/** 桌面 EXE 与现有插件约定的固定端口。 */
export const HARNESS_PORT = 3080

/** 插件默认 origin，必须与 DEFAULT_HARNESS_ORIGIN 一致。 */
export const HARNESS_ORIGIN = `http://${HARNESS_HOST}:${String(HARNESS_PORT)}`

/** 列出端口占用进程时注入的命令执行器。 */
export type CommandOutput = (command: string, args: string[]) => Promise<string>

/** 结束指定 PID 进程树时注入的杀手。 */
export type PidKiller = (pid: number) => Promise<void>

/** 探测 loopback 端口是否仍被占用。 */
export type PortProbe = (port: number) => Promise<boolean>

/** 组装 `dsh --profile web --port 3080` 参数，避免各入口各写一套。 */
export function webProfileArgs(): string[] {
  return ['--profile', 'web', '--port', String(HARNESS_PORT)]
}

/** 从 Windows netstat 输出中解析正在监听指定端口的 PID。 */
export function parseNetstatListeningPids(output: string, port: number): number[] {
  const pattern = new RegExp(
    String.raw`^\s*TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):${String(port)}\s+\S+\s+LISTENING\s+(\d+)\s*$`,
    'gim',
  )
  const pids = new Set<number>()
  for (const match of output.matchAll(pattern)) {
    const pid = Number(match[1])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

/** 执行一条隐藏窗口的命令并收集 stdout+stderr。 */
export async function runHiddenCommand(command: string, args: string[]): Promise<string> {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { windowsHide: true })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    child.once('error', rejectRun)
    child.once('close', () => { resolveRun(Buffer.concat(chunks).toString('utf8')) })
  })
}

/** 列出当前监听指定 TCP 端口的进程。 */
export async function listListeningPids(
  port: number,
  run: CommandOutput = runHiddenCommand,
): Promise<number[]> {
  const netstat = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'netstat.exe')
  const output = await run(netstat, ['-ano', '-p', 'tcp'])
  return parseNetstatListeningPids(output, port)
}

/** 用系统 taskkill 结束一棵 Windows 进程树。 */
export async function killProcessTree(pid: number): Promise<void> {
  await runHiddenCommand(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
    ['/PID', String(pid), '/T', '/F'],
  )
}

/** 探测 127.0.0.1 上的端口是否已有监听者。 */
export async function isLoopbackPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolveProbe) => {
    const socket = createConnection({ host: HARNESS_HOST, port })
    socket.once('connect', () => {
      socket.destroy()
      resolveProbe(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolveProbe(false)
    })
  })
}

/** 判断固定 origin 是否已经是一份可响应的 Harness Web。 */
export async function isHarnessHealthy(
  origin: string = HARNESS_ORIGIN,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(origin, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

/** 等待 loopback 端口空闲，超时则抛错。 */
export async function waitForPortFree(
  port: number,
  timeoutMs: number,
  probe: PortProbe = isLoopbackPortOpen,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await probe(port))) return
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error(`端口 ${String(port)} 在 ${String(timeoutMs)}ms 内仍被占用`)
}

/** 结束占用固定端口的进程树，供安装后的 EXE 接管 Host。 */
export async function takeOverListeningPort(
  port: number,
  options: {
    listPids?: (port: number) => Promise<number[]>
    killPid?: PidKiller
    probe?: PortProbe
    timeoutMs?: number
    selfPid?: number
  } = {},
): Promise<number[]> {
  const listPids = options.listPids ?? listListeningPids
  const killPid = options.killPid ?? killProcessTree
  const probe = options.probe ?? isLoopbackPortOpen
  const timeoutMs = options.timeoutMs ?? 8_000
  const selfPid = options.selfPid ?? process.pid
  const pids = (await listPids(port)).filter(pid => pid !== selfPid)
  for (const pid of pids) await killPid(pid)
  if (pids.length > 0) await waitForPortFree(port, timeoutMs, probe)
  return pids
}

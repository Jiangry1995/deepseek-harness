import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { LineBuffer, parseReadyUrl, requestedListenPort, resolveBackendLaunch, startBackend } from '../src/backend.js'
import { HARNESS_PORT } from '../src/port.js'

const fixtures = fileURLToPath(new URL('../../tests/fixtures/', import.meta.url))

test('parseReadyUrl 只接受有效的 loopback 就绪行', () => {
  assert.equal(parseReadyUrl('dsh web: http://127.0.0.1:3080')?.href, 'http://127.0.0.1:3080/')
  assert.equal(parseReadyUrl('dsh web: http://localhost:3080'), undefined)
  assert.equal(parseReadyUrl('dsh web: http://127.0.0.1:0'), undefined)
  assert.equal(parseReadyUrl('dsh web: http://127.0.0.1:65536'), undefined)
})

test('LineBuffer 跨分片恢复 CRLF 行并保留尾行', () => {
  const buffer = new LineBuffer()
  assert.deepEqual(buffer.push('first\r'), [])
  assert.deepEqual(buffer.push('\nsecond\nthird'), ['first', 'second'])
  assert.deepEqual(buffer.finish(), ['third'])
  assert.deepEqual(buffer.finish(), [])
})

test('requestedListenPort 读取最后一个 --port', () => {
  assert.equal(requestedListenPort(['--profile', 'web', '--port', '3080']), 3080)
  assert.equal(requestedListenPort(['--port', '0']), 0)
  assert.equal(requestedListenPort(['web']), undefined)
})

test('resolveBackendLaunch 在打包与开发态都固定 3080', () => {
  const packaged = resolveBackendLaunch({
    isPackaged: true,
    appPath: 'C:\\app',
    resourcesPath: 'C:\\resources',
    electronExecutable: 'C:\\electron.exe',
    cwd: 'C:\\docs',
    env: {},
  })
  assert.deepEqual(packaged.args.slice(-4), ['--profile', 'web', '--port', String(HARNESS_PORT)])

  const unpackaged = resolveBackendLaunch({
    isPackaged: false,
    appPath: fileURLToPath(new URL('../../', import.meta.url)),
    resourcesPath: 'C:\\resources',
    electronExecutable: process.execPath,
    cwd: process.cwd(),
    env: {},
  })
  assert.equal(unpackaged.args.at(-1), String(HARNESS_PORT))
  assert.equal(unpackaged.args.at(-2), '--port')
})

test('startBackend 等待就绪行并在停止后等待进程退出', async () => {
  const output: string[] = []
  const handle = await startBackend({
    command: process.execPath,
    args: [join(fixtures, 'fake-ready.mjs')],
    cwd: fixtures,
    env: process.env,
    startTimeoutMs: 2_000,
    stopTimeoutMs: 2_000,
    onOutput: event => { output.push(`${event.source}:${event.line}`) },
  })
  assert.equal(handle.url.href, 'http://127.0.0.1:43123/')
  const exit = await handle.stop()
  assert.notEqual(exit.signal === null && exit.code === null, true)
  assert.ok(output.some(line => line.includes('dsh web:')))
})

test('startBackend 在后端就绪前退出时拒绝', async () => {
  await assert.rejects(
    startBackend({
      command: process.execPath,
      args: [join(fixtures, 'fake-exit.mjs')],
      cwd: fixtures,
      env: process.env,
      startTimeoutMs: 2_000,
    }),
    /在就绪前退出/,
  )
})

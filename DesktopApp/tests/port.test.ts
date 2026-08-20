import assert from 'node:assert/strict'
import test from 'node:test'
import { parseNetstatListeningPids, takeOverListeningPort, webProfileArgs } from '../src/port.js'

test('webProfileArgs 固定 web profile 与 3080', () => {
  assert.deepEqual(webProfileArgs(), ['--profile', 'web', '--port', '3080'])
})

test('parseNetstatListeningPids 只匹配精确端口的 LISTENING 行', () => {
  const output = [
    '  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       1111',
    '  TCP    0.0.0.0:3080           0.0.0.0:0              LISTENING       2222',
    '  TCP    [::]:3080              [::]:0                 LISTENING       3333',
    '  TCP    127.0.0.1:13080        0.0.0.0:0              LISTENING       4444',
    '  TCP    127.0.0.1:3080         127.0.0.1:9            ESTABLISHED     5555',
  ].join('\n')
  assert.deepEqual(parseNetstatListeningPids(output, 3080), [1111, 2222, 3333])
})

test('takeOverListeningPort 结束占用者并等待端口空闲', async () => {
  const killed: number[] = []
  const probes = [true, true, false]
  const pids = await takeOverListeningPort(3080, {
    listPids: async () => [1001, 1002, process.pid],
    killPid: async (pid) => { killed.push(pid) },
    probe: async () => probes.shift() ?? false,
    timeoutMs: 1_000,
    selfPid: process.pid,
  })
  assert.deepEqual(pids, [1001, 1002])
  assert.deepEqual(killed, [1001, 1002])
})

test('takeOverListeningPort 在端口已空闲时不杀进程', async () => {
  const killed: number[] = []
  const pids = await takeOverListeningPort(3080, {
    listPids: async () => [],
    killPid: async (pid) => { killed.push(pid) },
    probe: async () => false,
  })
  assert.deepEqual(pids, [])
  assert.deepEqual(killed, [])
})

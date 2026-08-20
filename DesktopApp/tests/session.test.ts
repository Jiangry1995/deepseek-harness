import assert from 'node:assert/strict'
import test from 'node:test'
import { detachedBackendHandle, prepareBackendLifecycle } from '../src/session.js'
import { HARNESS_ORIGIN } from '../src/port.js'

test('打包态先卸载伴随程序、占领端口，再拉起自己的 Host', async () => {
  const calls: string[] = []
  const owned = { url: new URL('http://127.0.0.1:3080/'), exit: Promise.resolve({ code: 0, signal: null }), stop: async () => ({ code: 0, signal: null }) }
  const session = await prepareBackendLifecycle({
    isPackaged: true,
    uninstallCompanion: async () => { calls.push('uninstall') },
    takeOverPort: async () => { calls.push('takeover') },
    isHarnessHealthy: async () => {
      calls.push('healthy')
      return true
    },
    startOwnedBackend: async () => {
      calls.push('start')
      return owned
    },
  })
  assert.equal(session.owned, true)
  assert.equal(session.handle, owned)
  assert.deepEqual(calls, ['uninstall', 'takeover', 'start'])
})

test('开发态发现 3080 已健康时复用外部 Host，并且 stop 为空操作', async () => {
  const calls: string[] = []
  const session = await prepareBackendLifecycle({
    isPackaged: false,
    uninstallCompanion: async () => { calls.push('uninstall') },
    takeOverPort: async () => { calls.push('takeover') },
    isHarnessHealthy: async () => true,
    startOwnedBackend: async () => {
      calls.push('start')
      throw new Error('开发态不应再拉起后端')
    },
  })
  assert.equal(session.owned, false)
  assert.equal(session.handle.url.origin, HARNESS_ORIGIN)
  assert.deepEqual(calls, [])
  const exit = await session.handle.stop()
  assert.equal(exit.code, null)
})

test('开发态 3080 空闲时拉起自己的 Host', async () => {
  const owned = detachedBackendHandle()
  const session = await prepareBackendLifecycle({
    isPackaged: false,
    uninstallCompanion: async () => {},
    takeOverPort: async () => {},
    isHarnessHealthy: async () => false,
    startOwnedBackend: async () => owned,
  })
  assert.equal(session.owned, true)
  assert.equal(session.handle, owned)
})

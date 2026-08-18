/**
 * The cross-process address claim: what a second starter observes while the
 * first is still booting, and what it may reclaim after that first one died.
 */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimPath,
  claimWebAddress,
  internals,
  readAddressHolder,
  WebAddressBusyError,
  type AddressHolder,
} from '../src/single-instance.ts'

/**
 * A pid no live process can hold: Linux caps pids far below it and Windows
 * allocates nothing near it, so a claim naming it is unambiguously abandoned.
 */
const DEAD_PID = 2147483646

const realClaimDirectory = internals.claimDirectory
const released: (() => void)[] = []

beforeEach(() => {
  internals.claimDirectory = mkdtempSync(join(tmpdir(), 'dsh-web-single-'))
})

afterEach(() => {
  for (const release of released.splice(0)) release()
  internals.claimDirectory = realClaimDirectory
})

/**
 * Take a claim and schedule its release with the test.
 * @param host - bind host.
 * @param port - bind port.
 * @returns the disposer, already registered for cleanup.
 */
function claim(host: string, port: number): () => void {
  const release = claimWebAddress(host, port)
  released.push(release)
  return release
}

/**
 * Write a claim file as another process would have left it.
 * @param host - bind host.
 * @param port - bind port.
 * @param pid - pid to record as the holder.
 */
function writeForeignClaim(host: string, port: number, pid: number): void {
  writeFileSync(claimPath(host, port), JSON.stringify({
    pid,
    host,
    port,
    startedAt: '2026-08-15T00:00:00.000Z',
    command: 'dsh --profile web',
  } satisfies AddressHolder))
}

describe('web address claim', () => {
  it('records the holder so a loser can name it', () => {
    claim('127.0.0.1', 3080)
    expect(readAddressHolder(claimPath('127.0.0.1', 3080))).toMatchObject({
      pid: process.pid,
      host: '127.0.0.1',
      port: 3080,
    })
  })

  it('refuses an address a live process already claimed', () => {
    claim('127.0.0.1', 3080)
    expect(() => claimWebAddress('127.0.0.1', 3080)).toThrow(WebAddressBusyError)
  })

  it('names the holder in the refusal', () => {
    writeForeignClaim('127.0.0.1', 3080, process.pid)
    expect(() => claimWebAddress('127.0.0.1', 3080))
      .toThrow(`already claimed http://127.0.0.1:3080 (pid ${String(process.pid)}, started 2026-08-15T00:00:00.000Z, command: dsh --profile web)`)
  })

  it('reclaims an address whose holder is gone', () => {
    writeForeignClaim('127.0.0.1', 3080, DEAD_PID)
    claim('127.0.0.1', 3080)
    expect(readAddressHolder(claimPath('127.0.0.1', 3080))?.pid).toBe(process.pid)
  })

  it('reclaims an address whose record cannot be read as a claim', () => {
    writeFileSync(claimPath('127.0.0.1', 3080), 'half-written {')
    claim('127.0.0.1', 3080)
    expect(readAddressHolder(claimPath('127.0.0.1', 3080))?.pid).toBe(process.pid)
  })

  it('separates addresses that cannot collide', () => {
    claim('127.0.0.1', 3080)
    expect(() => claim('127.0.0.1', 8080)).not.toThrow()
  })

  it('claims nothing for an OS-assigned port', () => {
    claim('127.0.0.1', 0)
    expect(existsSync(claimPath('127.0.0.1', 0))).toBe(false)
  })

  it('frees the address on release', () => {
    claim('127.0.0.1', 3080)()
    expect(existsSync(claimPath('127.0.0.1', 3080))).toBe(false)
    expect(() => claim('127.0.0.1', 3080)).not.toThrow()
  })

  it('leaves a successor claim alone when a released disposer runs late', () => {
    const release = claimWebAddress('127.0.0.1', 3080)
    release()
    writeForeignClaim('127.0.0.1', 3080, DEAD_PID)
    release()
    expect(readAddressHolder(claimPath('127.0.0.1', 3080))?.pid).toBe(DEAD_PID)
  })
})

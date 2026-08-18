/**
 * A cross-process claim on the address this web app intends to serve.
 *
 * The OS already refuses a second listener on a bound port, but the web profile
 * spends tens of seconds loading its tree before it binds. Inside that window a
 * second starter — another shell, or the Windows tray companion whose health
 * probe still sees nothing answering — observes a free port and launches a
 * duplicate that only fails at `listen` time, long after the user was told a
 * startup was underway. The claim closes that window: it is taken from the
 * command line, before the slow boot, and names its holder so the loser can say
 * who owns the address instead of reporting a bare `EADDRINUSE`.
 *
 * The claim file is advisory and survives a killed process, so a recorded pid
 * that is no longer running is reclaimed rather than trusted. Callers that ask
 * for port 0 want an OS-assigned port and cannot collide, so they claim nothing.
 * @module @deepseek-ai/dsh-web-app/single-instance
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'

/** Test seam: the directory holding address claims. */
export const internals = { claimDirectory: tmpdir() }

/** The process that currently claims one address. */
export interface AddressHolder {
  /** Process id recorded when the claim was taken. */
  pid: number
  /** Bind host the holder intends to serve. */
  host: string
  /** Bind port the holder intends to serve. */
  port: number
  /** ISO timestamp of the claim, so a caller can report how long a boot has run. */
  startedAt: string
  /** Command that took the claim, so a user can tell a tray boot from a shell one. */
  command: string
}

/** Raised when a live process already claimed the requested address. */
export class WebAddressBusyError extends Error {
  /**
   * Describe the conflict in terms of the address and, when readable, its holder.
   * @param host - requested bind host.
   * @param port - requested bind port.
   * @param holder - the recorded holder, absent when its record was unreadable.
   */
  constructor(host: string, port: number, readonly holder: AddressHolder | undefined) {
    super(holder === undefined
      ? `another DeepSeek Harness web app already claimed http://${host}:${String(port)}; stop it before starting a new one`
      : `another DeepSeek Harness web app already claimed http://${host}:${String(port)}`
        + ` (pid ${String(holder.pid)}, started ${holder.startedAt}, command: ${holder.command});`
        + ' stop it before starting a new one')
    this.name = 'WebAddressBusyError'
  }
}

/** Reduce a value to the characters a file name may carry on every platform. */
function fileSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-')
}

/**
 * Absolute path of the claim file for one address.
 * The Windows tray companion reads this exact path before spawning, so the
 * naming is a cross-language contract rather than an implementation detail.
 * @param host - bind host.
 * @param port - bind port.
 * @returns the claim file path for the current user.
 */
export function claimPath(host: string, port: number): string {
  return join(internals.claimDirectory, `dsh-web-${fileSafe(host)}-${String(port)}-${fileSafe(userInfo().username)}.json`)
}

/**
 * Read the holder recorded in one claim file.
 * @param path - claim file path.
 * @returns the holder, or undefined when the file is absent or not a claim record.
 */
export function readAddressHolder(path: string): AddressHolder | undefined {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const holder = parsed as Partial<AddressHolder>
  if (typeof holder.pid !== 'number' || typeof holder.startedAt !== 'string') return undefined
  return holder as AddressHolder
}

/** Return whether a recorded process is still running under any owner. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // A running process owned by another user answers EPERM rather than ESRCH.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Create the claim file, failing when one already exists.
 * @param path - claim file path.
 * @param holder - record describing this process.
 * @returns whether this process created the file.
 */
function createClaim(path: string, holder: AddressHolder): boolean {
  try {
    writeFileSync(path, JSON.stringify(holder), { flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

/** Delete a claim file that no live process owns, tolerating a concurrent reclaim. */
function removeStaleClaim(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Release a claim only while this process still owns it. */
function releaseClaim(path: string): void {
  if (readAddressHolder(path)?.pid !== process.pid) return
  removeStaleClaim(path)
}

/**
 * Claim one address for this process before the slow boot begins.
 * @param host - bind host this app intends to serve.
 * @param port - bind port this app intends to serve; 0 claims nothing.
 * @returns a disposer that releases the claim.
 * @throws WebAddressBusyError when a live process already holds the address.
 */
export function claimWebAddress(host: string, port: number): () => void {
  if (port === 0) return () => {}
  const path = claimPath(host, port)
  const holder: AddressHolder = {
    pid: process.pid,
    host,
    port,
    startedAt: new Date().toISOString(),
    command: process.argv.slice(1).join(' '),
  }
  mkdirSync(internals.claimDirectory, { recursive: true })
  // Two attempts: the first competes for a free claim, the second competes for
  // one abandoned by a killed process that this call is the one to reclaim.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createClaim(path, holder)) return () => { releaseClaim(path) }
    const current = readAddressHolder(path)
    if (current !== undefined && processAlive(current.pid)) throw new WebAddressBusyError(host, port, current)
    removeStaleClaim(path)
  }
  throw new WebAddressBusyError(host, port, readAddressHolder(path))
}

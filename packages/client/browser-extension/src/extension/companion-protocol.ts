/** Closed messages shared by the MV3 side panel and Windows companion adapter. */

/** Registered Chrome Native Messaging host name. */
export const BROWSER_COMPANION_HOST_NAME = 'com.deepseek.dsh_browser_companion'

/** Side-panel request asking the Service Worker to ensure the local Web profile. */
export interface EnsureLocalHarnessRequest {
  /** Closed request discriminator. */
  kind: 'ensure-local-harness'
  /** Validated loopback Harness origin. */
  origin: string
}

/** Native-host request sent after the Service Worker validates its sender. */
export interface EnsureWebRequest {
  /** Closed native operation discriminator. */
  kind: 'ensure-web'
  /** Validated loopback Harness origin. */
  origin: string
}

/** Successful companion response after the configured origin is healthy. */
export interface EnsureWebSuccess {
  /** Success discriminator. */
  ok: true
  /** Whether Harness already existed or the companion started it. */
  state: 'running' | 'started'
  /** Healthy configured Harness origin. */
  origin: string
}

/** Failed companion response with a user-displayable diagnostic. */
export interface EnsureWebFailure {
  /** Failure discriminator. */
  ok: false
  /** Concrete installation, configuration, or startup failure. */
  error: string
}

/** Complete response returned to the side panel. */
export type EnsureWebResponse = EnsureWebSuccess | EnsureWebFailure

/** Narrow an unknown value to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require an exact closed field set at the extension/native process boundary. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

/**
 * Validate a side-panel startup request before sender authorization.
 * @param value - untrusted Chromium runtime message.
 * @returns whether the value carries the exact startup request fields.
 */
export function isEnsureLocalHarnessRequest(value: unknown): value is EnsureLocalHarnessRequest {
  return isRecord(value)
    && hasExactKeys(value, ['kind', 'origin'])
    && value.kind === 'ensure-local-harness'
    && typeof value.origin === 'string'
}

/**
 * Validate one Native Messaging response.
 * @param value - untrusted JSON returned by the registered native host.
 * @param expectedOrigin - origin requested by the side panel.
 * @returns normalized closed response.
 * @throws when the native host returns malformed or mismatched data.
 */
export function parseEnsureWebResponse(value: unknown, expectedOrigin: string): EnsureWebResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('本机伴随程序返回了无效响应。')
  }
  if (value.ok) {
    if (!hasExactKeys(value, ['ok', 'state', 'origin'])
      || (value.state !== 'running' && value.state !== 'started')
      || value.origin !== expectedOrigin) {
      throw new Error('本机伴随程序返回了不匹配的启动结果。')
    }
    return { ok: true, state: value.state, origin: value.origin }
  }
  if (!hasExactKeys(value, ['ok', 'error']) || typeof value.error !== 'string' || value.error === '') {
    throw new Error('本机伴随程序返回了无效错误。')
  }
  return { ok: false, error: value.error }
}

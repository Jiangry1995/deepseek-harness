/** Loopback Harness origin validation shared by side-panel and Service Worker boundaries. */

/**
 * Validate one user- or message-supplied Harness origin.
 * @param rawOrigin - candidate loopback HTTP origin.
 * @returns canonical origin without a trailing slash.
 */
export function normalizeHarnessOrigin(rawOrigin: string): string {
  let url: URL
  try {
    url = new URL(rawOrigin.trim())
  } catch {
    throw new Error('Harness 地址必须是有效 URL')
  }
  if (url.protocol !== 'http:') {
    throw new Error('Harness 地址必须使用明文 HTTP')
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Harness 地址主机必须是 127.0.0.1 或 localhost')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('Harness 地址不得包含用户名或密码')
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('Harness 地址只能包含 origin')
  }
  return url.origin
}

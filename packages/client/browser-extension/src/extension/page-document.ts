/** Document lifetime identity and DOM revision tracking for the in-page script. */

export const PAGE_ID_ATTRIBUTE = 'data-dsh-page-id'
export const PAGE_REF_ATTRIBUTE = 'data-dsh-page-ref'
export const DOCUMENT_ID_ATTRIBUTE = 'data-dsh-document-id'

let documentRevision = 0
let revisionObserver: MutationObserver | undefined

/** Create a UUID in browsers with or without randomUUID(). */
export function createOpaqueId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Return whether a mutation only records this script's own reference attributes. */
function isOwnProtocolMutation(mutation: MutationRecord): boolean {
  return mutation.type === 'attributes'
    && typeof mutation.attributeName === 'string'
    && mutation.attributeName.startsWith('data-dsh-')
}

/** Increment the document revision when page content other than protocol marks changes. */
function observeDocumentRevisions(mutations: MutationRecord[]): void {
  if (mutations.every(isOwnProtocolMutation)) return
  documentRevision += 1
}

/**
 * Ensure the current document has a stable identity and a live revision observer.
 * The identity survives reads of the same document and is replaced only when this
 * page script is created for a new document.
 * @returns the current document identity and revision.
 */
export function ensureDocumentIdentity(): { documentId: string; revision: number } {
  let documentId = document.documentElement.getAttribute(DOCUMENT_ID_ATTRIBUTE)
  if (documentId === null || documentId === '') {
    documentId = createOpaqueId()
    document.documentElement.setAttribute(DOCUMENT_ID_ATTRIBUTE, documentId)
    documentRevision = 0
  }
  if (revisionObserver === undefined && typeof MutationObserver === 'function') {
    revisionObserver = new MutationObserver(observeDocumentRevisions)
    revisionObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  }
  return { documentId, revision: documentRevision }
}

/**
 * Return the current document identity without creating a new page snapshot.
 * @returns the current document identity and revision.
 */
export function currentDocumentIdentity(): { documentId: string; revision: number } {
  return ensureDocumentIdentity()
}

/**
 * Reset document identity state. Used by tests after swapping the document body.
 */
export function resetDocumentIdentityForTests(): void {
  revisionObserver?.disconnect()
  revisionObserver = undefined
  documentRevision = 0
  document.documentElement.removeAttribute(DOCUMENT_ID_ATTRIBUTE)
  document.documentElement.removeAttribute(PAGE_ID_ATTRIBUTE)
}

/** Document lifetime identity and DOM revision tracking for the in-page script. */

/** Attribute carrying the latest page snapshot identity. */
export const PAGE_ID_ATTRIBUTE = 'data-dsh-page-id'
/** Attribute carrying one document-bound element reference. */
export const PAGE_REF_ATTRIBUTE = 'data-dsh-page-ref'
/** Attribute carrying the current document identity. */
export const DOCUMENT_ID_ATTRIBUTE = 'data-dsh-document-id'

let documentRevision = 0
let disposeRevisionObserver: (() => void) | undefined

/**
 * Create a UUID in browsers with or without randomUUID().
 * @returns an opaque document, page, or request identity.
 */
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

/**
 * Observe document changes other than this extension's reference attributes.
 * @param onChange - callback for each relevant mutation batch.
 * @returns a disposer that disconnects the observer.
 */
export function observeDocumentChanges(onChange: () => void): () => void {
  if (typeof MutationObserver !== 'function') return () => {}
  const observer = new MutationObserver((mutations) => {
    if (!mutations.every(isOwnProtocolMutation)) onChange()
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })
  return () => { observer.disconnect() }
}

/**
 * Ensure the current document has a stable identity.
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
  return { documentId, revision: documentRevision }
}

/** Arm the document revision for the first relevant mutation after a page snapshot. */
export function armDocumentRevision(): void {
  disposeRevisionObserver?.()
  let dispose = (): void => {}
  dispose = observeDocumentChanges(() => {
    documentRevision += 1
    dispose()
    if (disposeRevisionObserver === dispose) disposeRevisionObserver = undefined
  })
  disposeRevisionObserver = dispose
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
  disposeRevisionObserver?.()
  disposeRevisionObserver = undefined
  documentRevision = 0
  document.documentElement.removeAttribute(DOCUMENT_ID_ATTRIBUTE)
  document.documentElement.removeAttribute(PAGE_ID_ATTRIBUTE)
}

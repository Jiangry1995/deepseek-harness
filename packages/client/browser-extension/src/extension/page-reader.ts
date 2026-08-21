/** DOM extraction and document-bound element referencing for the active page. */

import {
  BROWSER_PAGE_CONTEXT_MAX,
  BROWSER_PAGE_OPTION_MAX,
  BROWSER_PAGE_SCROLL_TARGET_MAX,
  type BridgePageAction,
  type BridgePageContent,
  type BridgePageField,
  type BridgePageOption,
  type BridgePageRect,
  type BridgePageScrollTarget,
  type BridgePageViewport,
} from '../protocol.ts'
import {
  PAGE_ID_ATTRIBUTE,
  PAGE_REF_ATTRIBUTE,
  armDocumentRevision,
  createOpaqueId,
  ensureDocumentIdentity,
} from './page-document.ts'

const MAX_TEXT_LENGTH = 30_000
const MAX_FIELD_COUNT = 80
const MAX_ACTION_COUNT = 120
const MAX_LABEL_LENGTH = 160
const MAX_SHORT_FIELD_VALUE_LENGTH = 500
const UNLABELED = '(unlabeled)'
const POINTER_CURSOR = 'pointer'
const INFERRED_CLICK_ROLE = 'clickable'
/** Compact icon controls need a rect so same-looking siblings can be told apart by placement. */
const COMPACT_ACTION_PX = 56

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement

interface ReferenceState {
  next: number
}

/** Normalize rendered text while retaining meaningful line breaks. */
function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Limit one string and notify the caller when information was omitted. */
function limit(value: string, maxLength: number, onTruncated: () => void): string {
  if (value.length <= maxLength) return value
  onTruncated()
  return value.slice(0, maxLength)
}

/** Return whether one element is currently rendered. */
function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false
  if (typeof element.checkVisibility === 'function') return element.checkVisibility()
  let current: HTMLElement | null = element
  while (current !== null) {
    if (current.hidden) return false
    const style = current.style
    if (style.display === 'none' || style.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
}

/** Return whether an element currently intersects the layout viewport. */
function isInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return isVisible(element)
  return rect.bottom > 0
    && rect.right > 0
    && rect.top < window.innerHeight
    && rect.left < window.innerWidth
}

/** Return whether an input can expose authentication or payment secrets. */
function isSecretInput(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false
  if (element.type === 'password' || element.type === 'file' || element.type === 'hidden') return true
  const autocomplete = element.autocomplete.toLowerCase().split(/\s+/)
  return autocomplete.some(token => [
    'current-password',
    'new-password',
    'one-time-code',
    'cc-number',
    'cc-csc',
  ].includes(token))
}

/** Return whether Chromium treats an element as an editable content host. */
function isContentEditableElement(element: HTMLElement): boolean {
  if (element.isContentEditable) return true
  const declared = element.getAttribute('contenteditable')?.trim().toLowerCase()
  return declared === '' || declared === 'true' || declared === 'plaintext-only'
}

/** Return the rounded viewport placement used to tell same-looking controls apart. */
function elementRect(element: HTMLElement): BridgePageRect {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

/** Resolve the closest user-facing label for an element. */
function elementLabel(element: HTMLElement): string {
  const labeledControl = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const associated = Array.from(labeledControl.labels ?? [])
    .map(label => normalizeText(label.innerText || label.textContent || ''))
    .filter(Boolean)
    .join(' / ')
  const candidates = [
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    element.getAttribute('title'),
    element.innerText || element.textContent,
    element.getAttribute('name'),
    element.id,
  ]
  const fallback = candidates
    .map(candidate => normalizeText(candidate ?? ''))
    .find(candidate => candidate !== '') ?? UNLABELED
  return (associated || fallback).slice(0, MAX_LABEL_LENGTH)
}

/** Return a short heading or accessible name for a semantic container. */
function containerTitle(element: HTMLElement): string {
  const labeledBy = element.getAttribute('aria-labelledby')
  if (labeledBy !== null) {
    const labelled = labeledBy.split(/\s+/)
      .map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '')
      .map(normalizeText)
      .filter(Boolean)
      .join(' ')
    if (labelled !== '') return labelled.slice(0, BROWSER_PAGE_CONTEXT_MAX)
  }
  const heading = element.querySelector('h1, h2, h3, h4, legend, [role="heading"]')
  const candidates = [
    element.getAttribute('aria-label'),
    heading instanceof HTMLElement ? heading.innerText || heading.textContent : '',
    element.getAttribute('title'),
  ]
  return candidates
    .map(candidate => normalizeText(candidate ?? ''))
    .find(candidate => candidate !== '')
    ?.slice(0, BROWSER_PAGE_CONTEXT_MAX) ?? ''
}

/** Return whether an ancestor is a useful semantic context container. */
function isContextContainer(element: HTMLElement): boolean {
  const role = element.getAttribute('role')
  return element instanceof HTMLDialogElement
    || element instanceof HTMLFormElement
    || element instanceof HTMLTableRowElement
    || element instanceof HTMLLIElement
    || role === 'dialog'
    || role === 'alertdialog'
    || role === 'form'
    || role === 'listitem'
    || role === 'row'
    || role === 'region'
    || role === 'main'
    || role === 'navigation'
    || role === 'complementary'
    || role === 'banner'
    || element.tagName === 'MAIN'
    || element.tagName === 'NAV'
    || element.tagName === 'ASIDE'
    || element.tagName === 'HEADER'
    || element.tagName === 'SECTION'
    || element.tagName === 'ARTICLE'
}

/** Return the nearest short dialog, form, row, or landmark title. */
function elementContext(element: HTMLElement): string | undefined {
  let current = element.parentElement
  while (current !== null) {
    if (isContextContainer(current)) {
      const title = containerTitle(current)
      if (title !== '') return title
    }
    current = current.parentElement
  }
  return undefined
}

/** Return whether an element is a supported editable field. */
function isFieldElement(element: Element): element is FieldElement {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || (element instanceof HTMLElement && isContentEditableElement(element))
}

/** Return the stable field type exposed for one supported element. */
function fieldType(element: FieldElement): string {
  const role = element.getAttribute('role')
  if (role === 'combobox' || role === 'textbox') return role
  if (element instanceof HTMLTextAreaElement) return 'textarea'
  if (element instanceof HTMLSelectElement) return 'select'
  if (element instanceof HTMLInputElement) return element.type || 'text'
  return 'textbox'
}

/** Return the current user-visible value stored by one field. */
function fieldValue(element: FieldElement): string {
  if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.text ?? element.value
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
  return element.innerText || element.textContent || ''
}

/** Return native options for a select without dumping the full option list. */
function fieldOptions(element: FieldElement, onTruncated: () => void): BridgePageOption[] | undefined {
  if (!(element instanceof HTMLSelectElement)) return undefined
  const options: BridgePageOption[] = []
  for (const option of Array.from(element.options)) {
    if (options.length >= BROWSER_PAGE_OPTION_MAX) {
      onTruncated()
      break
    }
    options.push({
      value: option.value.slice(0, 1_000),
      label: normalizeText(option.text).slice(0, MAX_LABEL_LENGTH),
      selected: option.selected,
      disabled: option.disabled,
    })
  }
  return options
}

/** Return or assign the next opaque reference for one page element. */
function assignPageRef(element: HTMLElement, state: ReferenceState): string {
  const existing = element.getAttribute(PAGE_REF_ATTRIBUTE)
  if (existing !== null) return existing
  const ref = `e${String(state.next)}`
  state.next += 1
  element.setAttribute(PAGE_REF_ATTRIBUTE, ref)
  return ref
}

/** Convert one supported field to its bounded current state. */
function formField(
  element: FieldElement,
  state: ReferenceState,
  onTruncated: () => void,
): BridgePageField {
  const maxValueLength = (element instanceof HTMLTextAreaElement
    || (element instanceof HTMLElement && isContentEditableElement(element)))
    ? MAX_TEXT_LENGTH
    : MAX_SHORT_FIELD_VALUE_LENGTH
  const disabled = ('disabled' in element && element.disabled)
    || element.getAttribute('aria-disabled') === 'true'
  const readOnly = ('readOnly' in element && element.readOnly)
    || element.getAttribute('aria-readonly') === 'true'
  const required = ('required' in element && element.required)
    || element.getAttribute('aria-required') === 'true'
  const field: BridgePageField = {
    ref: assignPageRef(element, state),
    label: elementLabel(element),
    type: fieldType(element),
    value: limit(normalizeText(fieldValue(element)), maxValueLength, onTruncated),
    disabled,
    readOnly,
    required,
    inViewport: isInViewport(element),
    focused: element.ownerDocument.activeElement === element,
  }
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    field.checked = element.checked
  }
  const context = elementContext(element)
  if (context !== undefined) field.context = context
  const options = fieldOptions(element, onTruncated)
  if (options !== undefined) field.options = options
  return field
}

/** Return the click role exposed for one supported action element. */
function actionRole(element: HTMLElement): string {
  const explicit = element.getAttribute('role')
  if (explicit !== null && explicit !== '') return explicit
  if (element instanceof HTMLAnchorElement) return 'link'
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return element.type
  }
  return 'button'
}

/** Return whether one action element currently rejects activation. */
function actionDisabled(element: HTMLElement): boolean {
  return ('disabled' in element && (element as HTMLButtonElement).disabled)
    || element.getAttribute('aria-disabled') === 'true'
}

/** Convert a tri-state ARIA token into a boolean when the token is explicit. */
function ariaBoolean(element: HTMLElement, name: string): boolean | undefined {
  const value = element.getAttribute(name)
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/** Parse one computed CSS rgb/rgba color into 0-255 channels. */
function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | undefined {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)/.exec(value)
  if (match === null) return undefined
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  }
}

/** Return whether one color is a saturated fill rather than gray, white, or transparent. */
function isAccentColor(value: string): boolean {
  const color = parseCssColor(value)
  if (color === undefined || color.a < 0.4) return false
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  if (max < 80) return false
  return (max - min) / max >= 0.25
}

/** Return whether one control uses a saturated non-gray fill on itself or its nearest painted ancestor. */
function isAccentSurface(element: HTMLElement): boolean {
  let current: HTMLElement | null = element
  for (let depth = 0; depth < 4 && current !== null; depth += 1) {
    const style = window.getComputedStyle(current)
    if (isAccentColor(style.backgroundColor)) return true
    current = current.parentElement
  }
  return false
}

/** Convert one supported action element to its bounded current state. */
function pageAction(element: HTMLElement, state: ReferenceState, role?: string): BridgePageAction {
  const label = elementLabel(element)
  const action: BridgePageAction = {
    ref: assignPageRef(element, state),
    role: (role ?? actionRole(element)).slice(0, 32),
    label,
    disabled: actionDisabled(element),
    inViewport: isInViewport(element),
    focused: element.ownerDocument.activeElement === element,
  }
  const rect = elementRect(element)
  const compact = rect.width > 0 && rect.height > 0 && rect.width <= COMPACT_ACTION_PX && rect.height <= COMPACT_ACTION_PX
  if (label === UNLABELED || compact) action.rect = rect
  if (isAccentSurface(element)) action.accent = true
  const context = elementContext(element)
  if (context !== undefined) action.context = context
  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute('href')
    if (href !== null) action.href = href.slice(0, 2_000)
  }
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    action.checked = element.checked
  }
  const checked = ariaBoolean(element, 'aria-checked')
  if (checked !== undefined) action.checked = checked
  const selected = ariaBoolean(element, 'aria-selected')
  if (selected !== undefined) action.selected = selected
  const expanded = ariaBoolean(element, 'aria-expanded')
  if (expanded !== undefined) action.expanded = expanded
  const pressed = ariaBoolean(element, 'aria-pressed')
  if (pressed !== undefined) action.pressed = pressed
  return action
}

/**
 * Return whether one pointer-cursor element is worth exposing on its own.
 * An element already referenced by this snapshot, or one wrapping a reference,
 * is skipped because that inner reference is the more precise click target.
 */
function isInferredClickTarget(element: HTMLElement): boolean {
  if (element.hasAttribute(PAGE_REF_ATTRIBUTE)) return false
  if (element.querySelector(`[${PAGE_REF_ATTRIBUTE}]`) !== null) return false
  if (element.getAttribute('aria-hidden') === 'true') return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && isInViewport(element)
}

/**
 * Record the outermost pointer-cursor element of each on-screen region.
 * Frameworks build icon controls from click handlers on plain containers, which
 * carry no role and no accessible name; without this pass the model has no
 * reference for a control the user can see, such as a chat composer send icon.
 * `cursor` inherits, so recording a region ends the descent into it.
 * @param element - current element of the depth-first walk.
 * @param parentCursor - computed cursor of the parent element.
 * @param actions - actions collected so far, extended in place.
 */
function collectInferredClickTargets(
  element: HTMLElement,
  parentCursor: string,
  actions: BridgePageAction[],
  state: ReferenceState,
  onTruncated: () => void,
): void {
  if (actions.length >= MAX_ACTION_COUNT) {
    onTruncated()
    return
  }
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return
  if (style.cursor === POINTER_CURSOR && parentCursor !== POINTER_CURSOR && isInferredClickTarget(element)) {
    actions.push(pageAction(element, state, INFERRED_CLICK_ROLE))
    return
  }
  for (const child of element.children) {
    if (child instanceof HTMLElement) {
      collectInferredClickTargets(child, style.cursor, actions, state, onTruncated)
    }
  }
}

/** Collect the main document and accessible same-origin child-frame documents. */
function pageDocuments(): Document[] {
  const documents = [document]
  const frames = document.querySelectorAll('iframe')
  for (let index = 0; index < frames.length && index < 6; index += 1) {
    try {
      const frameDocument = frames[index]?.contentDocument
      if (frameDocument !== null && frameDocument !== undefined) documents.push(frameDocument)
    } catch {
      // Cross-origin frames stay inaccessible from the main-frame content script.
    }
  }
  return documents
}

/** Remove references from the preceding snapshot before assigning a new document identity. */
function clearPageRefs(documents: Document[]): void {
  for (const current of documents) {
    for (const element of current.querySelectorAll(`[${PAGE_REF_ATTRIBUTE}]`)) {
      element.removeAttribute(PAGE_REF_ATTRIBUTE)
    }
  }
}

/** Return current viewport and document scroll metrics. */
function pageViewport(): BridgePageViewport {
  const scrolling = document.scrollingElement ?? document.documentElement
  return {
    width: window.innerWidth || document.documentElement.clientWidth,
    height: window.innerHeight || document.documentElement.clientHeight,
    scrollX: window.scrollX || scrolling.scrollLeft,
    scrollY: window.scrollY || scrolling.scrollTop,
    documentWidth: Math.max(document.documentElement.scrollWidth, scrolling.scrollWidth),
    documentHeight: Math.max(document.documentElement.scrollHeight, scrolling.scrollHeight),
  }
}

/** Return overflow style tokens that can actually produce a scrollbar. */
function overflowTokens(element: HTMLElement): string {
  const style = window.getComputedStyle(element)
  return `${style.overflow} ${style.overflowX} ${style.overflowY} ${element.style.overflow}`
}

/** Return whether an element currently has leftover scroll range on at least one axis. */
function scrollRange(element: HTMLElement): {
  axis: BridgePageScrollTarget['axis']
  top: number
  left: number
  maxTop: number
  maxLeft: number
} | undefined {
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight)
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth)
  const vertical = maxTop > 1
  const horizontal = maxLeft > 1
  if (!vertical && !horizontal) return undefined
  const overflow = overflowTokens(element)
  const canScroll = element === document.documentElement
    || element === document.body
    || element === document.scrollingElement
    || /auto|scroll|overlay/.test(overflow)
  if (!canScroll) return undefined
  return {
    axis: vertical && horizontal ? 'both' : vertical ? 'vertical' : 'horizontal',
    top: element.scrollTop,
    left: element.scrollLeft,
    maxTop,
    maxLeft,
  }
}

/** Collect visible containers that currently have leftover scroll range. */
function collectScrollTargets(
  documents: Document[],
  state: ReferenceState,
  onTruncated: () => void,
): BridgePageScrollTarget[] {
  const targets: BridgePageScrollTarget[] = []
  const seen = new Set<HTMLElement>()
  const candidates: HTMLElement[] = []
  const scrolling = document.scrollingElement
  if (scrolling instanceof HTMLElement) candidates.push(scrolling)
  if (document.documentElement instanceof HTMLElement) candidates.push(document.documentElement)
  if (document.body instanceof HTMLElement) candidates.push(document.body)
  for (const current of documents) {
    for (const candidate of current.querySelectorAll<HTMLElement>('*')) {
      candidates.push(candidate)
    }
  }
  for (const element of candidates) {
    if (seen.has(element) || !isVisible(element)) continue
    const range = scrollRange(element)
    if (range === undefined) continue
    seen.add(element)
    if (targets.length >= BROWSER_PAGE_SCROLL_TARGET_MAX) {
      onTruncated()
      break
    }
    const label = element === document.scrollingElement || element === document.documentElement || element === document.body
      ? 'Document'
      : elementLabel(element)
    targets.push({
      ref: assignPageRef(element, state),
      label,
      ...range,
    })
  }
  return targets
}

/**
 * Read bounded visible text, fields, and actionable references from the active document.
 * @returns a new snapshot identity and its bounded readable and actionable state.
 */
export function readVisiblePage(): BridgePageContent {
  let truncated = false
  /** Record that the current snapshot omitted bounded content. */
  const markTruncated = (): void => { truncated = true }
  const documents = pageDocuments()
  clearPageRefs(documents)
  const identity = ensureDocumentIdentity()
  const pageId = createOpaqueId()
  document.documentElement.setAttribute(PAGE_ID_ATTRIBUTE, pageId)
  const referenceState: ReferenceState = { next: 1 }

  const renderedParts: string[] = []
  const controls: FieldElement[] = []
  for (const current of documents) {
    const body = current.body
    renderedParts.push(body.innerText || body.textContent || '')
    for (const candidate of current.querySelectorAll('input, textarea, select, [contenteditable], [role="textbox"]')) {
      if (isFieldElement(candidate)) controls.push(candidate)
    }
  }
  const renderedText = normalizeText(renderedParts.join('\n'))
  controls.sort((left, right) => Number(right instanceof HTMLTextAreaElement) - Number(left instanceof HTMLTextAreaElement))

  const fields: BridgePageField[] = []
  const extraText: string[] = []
  for (const control of controls) {
    if (isSecretInput(control) || !isVisible(control)) continue
    if (fields.length >= MAX_FIELD_COUNT) {
      truncated = true
      break
    }
    const field = formField(control, referenceState, markTruncated)
    fields.push(field)
    if (field.value === '' || renderedText.includes(field.value.slice(0, 80))) continue
    extraText.push(field.type === 'textarea' || field.type === 'textbox'
      ? field.value
      : `${field.label}: ${field.value}`)
  }

  const actionSelector = [
    'button',
    'a[href]',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    'input[type="checkbox"]',
    'input[type="radio"]',
    '[role="button"]',
    '[role="link"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
  ].join(', ')
  const actions: BridgePageAction[] = []
  for (const current of documents) {
    for (const candidate of current.querySelectorAll<HTMLElement>(actionSelector)) {
      if (isSecretInput(candidate) || !isVisible(candidate)) continue
      if (actions.length >= MAX_ACTION_COUNT) {
        truncated = true
        break
      }
      actions.push(pageAction(candidate, referenceState))
    }
    if (actions.length >= MAX_ACTION_COUNT) break
  }
  for (const current of documents) {
    collectInferredClickTargets(current.body, '', actions, referenceState, markTruncated)
  }

  const scrollTargets = collectScrollTargets(documents, referenceState, markTruncated)

  const page: BridgePageContent = {
    pageId,
    documentId: identity.documentId,
    revision: identity.revision,
    viewport: pageViewport(),
    text: limit(normalizeText([renderedText, ...extraText].filter(Boolean).join('\n\n')), MAX_TEXT_LENGTH, markTruncated),
    fields,
    actions,
    scrollTargets,
    truncated,
  }
  armDocumentRevision()
  return page
}

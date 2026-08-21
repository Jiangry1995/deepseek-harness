/** Document-bound click, fill, select, scroll, focus, and key operations executed inside the active page. */

import type {
  BridgePageActionOperation,
  BridgePageActionReceipt,
  BridgePressKey,
  BridgeScrollMovement,
  BridgeScrollReceipt,
} from '../protocol.ts'
import { PAGE_ID_ATTRIBUTE, PAGE_REF_ATTRIBUTE } from './page-document.ts'

/** Stable failures produced by document-bound page actions. */
export type PageActionErrorCode =
  | 'BROWSER_PAGE_STALE'
  | 'BROWSER_ELEMENT_NOT_FOUND'
  | 'BROWSER_ELEMENT_DISABLED'
  | 'BROWSER_ELEMENT_NOT_EDITABLE'
  | 'BROWSER_OPTION_NOT_FOUND'
  | 'BROWSER_SCROLL_TARGET_INVALID'
  | 'BROWSER_KEY_UNSUPPORTED'
  | 'BROWSER_CAPABILITY_UNAVAILABLE'

/** Stable page-action failure returned through the extension bridge. */
export class PageActionError extends Error {
  /** Machine-readable error code preserved through content-script messaging. */
  readonly code: PageActionErrorCode

  /** Create one page action failure with a stable code. */
  constructor(code: PageActionErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'PageActionError'
    this.code = code
  }
}

const LINE_SCROLL_PX = 40
const SKIP_KEYPRESS = new Set<BridgePressKey>([
  'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete',
])

/** Collect the main document and accessible same-origin child-frame documents. */
function pageDocuments(): Document[] {
  const documents = [document]
  const frames = document.querySelectorAll('iframe')
  for (let index = 0; index < frames.length && index < 6; index += 1) {
    try {
      const frameDocument = frames[index]?.contentDocument
      if (frameDocument !== null && frameDocument !== undefined) documents.push(frameDocument)
    } catch {
      // Cross-origin frames are not part of the main-frame action surface.
    }
  }
  return documents
}

/** Resolve a reference only when it belongs to the latest page snapshot. */
function resolveElement(pageId: string, ref: string): HTMLElement {
  if (document.documentElement.getAttribute(PAGE_ID_ATTRIBUTE) !== pageId) {
    throw new PageActionError('BROWSER_PAGE_STALE', 'the page changed or was read again; read the current page before retrying')
  }
  for (const current of pageDocuments()) {
    const element = current.querySelector<HTMLElement>(`[${PAGE_REF_ATTRIBUTE}="${ref}"]`)
    if (element !== null) return element
  }
  throw new PageActionError('BROWSER_ELEMENT_NOT_FOUND', `element reference ${ref} is no longer present; read the page again`)
}

/** Return whether one page element currently rejects activation. */
function isDisabled(element: HTMLElement): boolean {
  return ('disabled' in element && (element as HTMLButtonElement).disabled)
    || element.getAttribute('aria-disabled') === 'true'
}

/** Return whether one page element currently rejects editing. */
function isReadOnly(element: HTMLElement): boolean {
  return ('readOnly' in element && Boolean(element.readOnly))
    || element.getAttribute('aria-readonly') === 'true'
}

/** Reject controls whose values can contain authentication or payment secrets. */
function isSecretInput(element: HTMLElement): boolean {
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

/** Set a native input value without being shadowed by framework instance properties. */
function setInputValue(element: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (descriptor?.set === undefined) throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the input value setter is unavailable')
  descriptor.set.call(element, value)
}

/** Set a native textarea value without being shadowed by framework instance properties. */
function setTextAreaValue(element: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
  if (descriptor?.set === undefined) throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the textarea value setter is unavailable')
  descriptor.set.call(element, value)
}

/** Replace contenteditable text through Chromium's editing engine so page frameworks receive the native edit. */
function setContentEditableValue(element: HTMLElement, value: string): void {
  const ownerDocument = element.ownerDocument
  const selection = ownerDocument.getSelection()
  if (selection === null) {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the contenteditable selection is unavailable')
  }
  const range = ownerDocument.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  let applied = false
  try {
    applied = value === ''
      // oxlint-disable-next-line typescript/no-deprecated -- Chromium execCommand preserves framework contenteditable behavior.
      ? ownerDocument.execCommand('delete', false)
      // oxlint-disable-next-line typescript/no-deprecated -- paired with delete for contenteditable compatibility.
      : ownerDocument.execCommand('insertText', false, value)
  } catch {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the contenteditable editing command failed')
  }
  if (!applied) {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the contenteditable editing command was rejected')
  }
}

/** Notify page frameworks that one user-facing value changed. */
function dispatchValueEvents(element: HTMLElement, value: string): void {
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: value,
  }))
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

/** Submit the owning form, click a nearby send control, or dispatch Enter for standalone search. */
function submitElement(element: HTMLElement): void {
  const form = element.closest('form')
  if (form instanceof HTMLFormElement) {
    form.requestSubmit()
    return
  }
  const send = findComposerSubmitButton(element)
  if (send !== undefined) {
    clickElement(send)
    return
  }
  if (element instanceof HTMLButtonElement || element.getAttribute('role') === 'button') {
    element.click()
    return
  }
  dispatchKeySequence(element, 'Enter', {})
}

const COMPOSER_SCOPE_SELECTOR = 'form, [role="form"], .el-editor-sender, .ch-chat-input, [class*="editor-sender"]'
const SEND_CONTROL_NAME = /发送|send|submit|提交/i
const REJECT_CONTROL_NAME = /删除|delete|清空|clear|关闭|close|取消|cancel|新开对话|new chat|new conversation/i
const COMPOSER_CONTROL_SELECTOR = 'button, [role="button"], input[type="submit"]'
const COMPOSER_ANCESTOR_WALK = 8

/** Collect accessible names used to recognize send versus destructive composer controls. */
function controlName(element: HTMLElement): string {
  return [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.innerText || element.textContent,
  ].filter(candidate => candidate !== null && candidate !== '').join(' ')
}

/** Return whether one control is a native form submit button. */
function isNativeSubmitControl(element: HTMLElement): boolean {
  return (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) && element.type === 'submit'
}

/**
 * Find an enabled send or submit control inside one composer subtree.
 * Named send/submit wins; otherwise a native submit; otherwise the unique remaining non-destructive button.
 * Destructive names such as delete are never chosen, including the first button in a send-button cluster.
 */
function submitButtonIn(scope: ParentNode, from: HTMLElement): HTMLElement | undefined {
  const controls = [...scope.querySelectorAll<HTMLElement>(COMPOSER_CONTROL_SELECTOR)]
    .filter(element => element !== from && !isDisabled(element))
  const namedSend = controls.find((element) => {
    const name = controlName(element)
    return SEND_CONTROL_NAME.test(name) && !REJECT_CONTROL_NAME.test(name)
  })
  if (namedSend !== undefined) return namedSend
  const nativeSubmit = controls.find(element => isNativeSubmitControl(element) && !REJECT_CONTROL_NAME.test(controlName(element)))
  if (nativeSubmit !== undefined) return nativeSubmit
  const remaining = controls.filter(element => !REJECT_CONTROL_NAME.test(controlName(element)))
  return remaining.length === 1 ? remaining[0] : undefined
}

/** Locate a nearby composer send control when the filled field is not inside a native form. */
function findComposerSubmitButton(from: HTMLElement): HTMLElement | undefined {
  const closest = from.closest<HTMLElement>(COMPOSER_SCOPE_SELECTOR)
  if (closest !== null) return submitButtonIn(closest, from)
  let scope: HTMLElement | null = from.parentElement
  for (let depth = 0; depth < COMPOSER_ANCESTOR_WALK && scope !== null; depth += 1) {
    const found = submitButtonIn(scope, from)
    if (found !== undefined) return found
    scope = scope.parentElement
  }
  return undefined
}

/** Click a nearby send control when Enter was prevented on a non-form composer field. */
function submitStandaloneComposer(element: HTMLElement): void {
  if (element.closest('form') instanceof HTMLFormElement) return
  const send = findComposerSubmitButton(element)
  if (send === undefined || send === element) return
  clickElement(send)
}

/** Return the current user-visible text stored by one filled control. */
function currentEditableValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
  return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
}

/** Normalize comparison text so fill verification is independent of surrounding whitespace. */
function normalizeComparable(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Fill one supported text field and optionally submit it. */
function fillElement(element: HTMLElement, value: string, submit: boolean): void {
  if (isDisabled(element) || isReadOnly(element) || isSecretInput(element)) {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the referenced control cannot accept text')
  }
  element.focus()
  if (element instanceof HTMLInputElement) {
    if (['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type)) {
      throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', `input type ${element.type} cannot accept text`)
    }
    setInputValue(element, value)
  } else if (element instanceof HTMLTextAreaElement) {
    setTextAreaValue(element, value)
  } else if (isContentEditableElement(element)) {
    setContentEditableValue(element, value)
    const actual = normalizeComparable(currentEditableValue(element))
    const expected = normalizeComparable(value)
    if (expected !== '' && actual !== expected && !actual.includes(expected)) {
      throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the contenteditable value did not match the requested text')
    }
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    if (submit) submitElement(element)
    return
  } else {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the referenced element is not a text field')
  }
  dispatchValueEvents(element, value)
  if (normalizeComparable(currentEditableValue(element)) !== normalizeComparable(value)) {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the control value did not match the requested text after filling')
  }
  if (submit) submitElement(element)
}

/** Return whether one element is a native or ARIA control that should receive the click. */
function isActivationControl(element: HTMLElement): boolean {
  if (isDisabled(element)) return false
  if (element instanceof HTMLButtonElement) return true
  if (element instanceof HTMLAnchorElement && element.getAttribute('href') !== null) return true
  if (element instanceof HTMLInputElement) {
    return ['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(element.type)
  }
  const role = element.getAttribute('role')
  return role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem'
    || role === 'option' || role === 'checkbox' || role === 'radio'
}

/**
 * Resolve the control a click should activate.
 * Icon markup and composer chrome are often the referenced node; the named send or nearest button is the effect.
 */
function activationTarget(element: HTMLElement): HTMLElement {
  if (isActivationControl(element)) return element
  const closest = element.closest('button, a[href], input[type="button"], input[type="submit"], [role="button"]')
  if (closest instanceof HTMLElement && isActivationControl(closest)) return closest
  const send = findComposerSubmitButton(element)
  if (send !== undefined) return send
  const nested = [...element.querySelectorAll<HTMLElement>(COMPOSER_CONTROL_SELECTOR)]
    .filter(candidate => isActivationControl(candidate) && !REJECT_CONTROL_NAME.test(controlName(candidate)))
  const only = nested[0]
  return nested.length === 1 && only !== undefined ? only : element
}

/** Dispatch a pointer sequence then a native click so framework click and pointer handlers both run. */
function dispatchActivation(element: HTMLElement): void {
  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
  }
  if (typeof PointerEvent === 'function') {
    const pointerInit = { ...mouseInit, pointerId: 1, pointerType: 'mouse' as const }
    element.dispatchEvent(new PointerEvent('pointerdown', pointerInit))
    element.dispatchEvent(new MouseEvent('mousedown', mouseInit))
    element.dispatchEvent(new PointerEvent('pointerup', pointerInit))
    element.dispatchEvent(new MouseEvent('mouseup', mouseInit))
  } else {
    element.dispatchEvent(new MouseEvent('mousedown', mouseInit))
    element.dispatchEvent(new MouseEvent('mouseup', mouseInit))
  }
  element.click()
}

/** Click the activation target of one referenced element. */
function clickElement(element: HTMLElement): void {
  const target = activationTarget(element)
  if (isDisabled(target)) throw new PageActionError('BROWSER_ELEMENT_DISABLED', 'the referenced element is disabled')
  target.focus()
  dispatchActivation(target)
}

/** Select one native option by exact value or normalized visible text. */
function selectOption(element: HTMLElement, requestedValue: string): string {
  if (!(element instanceof HTMLSelectElement) || isDisabled(element)) {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the referenced element is not an enabled native select')
  }
  const normalizedRequested = requestedValue.replace(/\s+/g, ' ').trim()
  const option = Array.from(element.options).find(candidate => candidate.value === requestedValue)
    ?? Array.from(element.options).find(candidate => candidate.text.replace(/\s+/g, ' ').trim() === normalizedRequested)
  if (option === undefined) {
    throw new PageActionError('BROWSER_OPTION_NOT_FOUND', `no option matches ${requestedValue}`)
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  if (descriptor?.set === undefined) throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the select value setter is unavailable')
  descriptor.set.call(element, option.value)
  dispatchValueEvents(element, option.value)
  if (element.value !== option.value) {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the select value did not match the requested option')
  }
  return option.value
}

/** Return the document scrolling element used when no container ref is supplied. */
function documentScrollElement(): HTMLElement {
  const scrolling = document.scrollingElement
  if (scrolling instanceof HTMLElement) return scrolling
  return document.documentElement
}

/** Return leftover scroll range for one element. */
function scrollMetrics(element: HTMLElement): { top: number; left: number; maxTop: number; maxLeft: number } {
  return {
    top: element.scrollTop,
    left: element.scrollLeft,
    maxTop: Math.max(0, element.scrollHeight - element.clientHeight),
    maxLeft: Math.max(0, element.scrollWidth - element.clientWidth),
  }
}

/** Apply one discrete movement to a scrollable element. */
function applyScrollMovement(element: HTMLElement, movement: BridgeScrollMovement): void {
  const pageHeight = element.clientHeight || window.innerHeight
  const pageWidth = element.clientWidth || window.innerWidth
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight)
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth)
  switch (movement) {
    case 'line-up': element.scrollTop = element.scrollTop - LINE_SCROLL_PX; break
    case 'line-down': element.scrollTop = element.scrollTop + LINE_SCROLL_PX; break
    case 'line-left': element.scrollLeft = element.scrollLeft - LINE_SCROLL_PX; break
    case 'line-right': element.scrollLeft = element.scrollLeft + LINE_SCROLL_PX; break
    case 'page-up': element.scrollTop = element.scrollTop - pageHeight; break
    case 'page-down': element.scrollTop = element.scrollTop + pageHeight; break
    case 'page-left': element.scrollLeft = element.scrollLeft - pageWidth; break
    case 'page-right': element.scrollLeft = element.scrollLeft + pageWidth; break
    case 'top': element.scrollTop = 0; break
    case 'bottom': element.scrollTop = maxTop; break
    case 'left-edge': element.scrollLeft = 0; break
    case 'right-edge': element.scrollLeft = maxLeft; break
  }
}

/** Scroll the document viewport or one referenced scroll target. */
function scrollTarget(pageId: string, ref: string | undefined, movement: BridgeScrollMovement): BridgeScrollReceipt {
  if (document.documentElement.getAttribute(PAGE_ID_ATTRIBUTE) !== pageId) {
    throw new PageActionError('BROWSER_PAGE_STALE', 'the page changed or was read again; read the current page before retrying')
  }
  const element = ref === undefined ? documentScrollElement() : resolveElement(pageId, ref)
  const before = scrollMetrics(element)
  if (ref !== undefined && before.maxTop <= 1 && before.maxLeft <= 1) {
    throw new PageActionError('BROWSER_SCROLL_TARGET_INVALID', 'the referenced element is not a scrollable container')
  }
  applyScrollMovement(element, movement)
  if ((element === document.documentElement || element === document.body || element === document.scrollingElement)
    && typeof window.scrollTo === 'function') {
    try {
      window.scrollTo(element.scrollLeft, element.scrollTop)
    } catch {
      // jsdom does not implement window.scrollTo; the element offsets are still updated.
    }
  }
  const after = scrollMetrics(element)
  const moved = after.top !== before.top || after.left !== before.left
  return {
    pageId,
    ...(ref === undefined ? {} : { ref }),
    movement,
    ...after,
    moved,
    atBoundary: !moved,
  }
}

/** Return whether the referenced element currently holds document focus. */
function isActiveElement(element: HTMLElement): boolean {
  const active = element.ownerDocument.activeElement
  return active === element || element.contains(active)
}

/** Focus one referenced field or action and verify document.activeElement. */
function focusElement(element: HTMLElement): void {
  if (isDisabled(element)) throw new PageActionError('BROWSER_ELEMENT_DISABLED', 'the referenced element is disabled')
  if (element.tabIndex < 0 && !isContentEditableElement(element)
    && !(element instanceof HTMLInputElement)
    && !(element instanceof HTMLTextAreaElement)
    && !(element instanceof HTMLSelectElement)
    && !(element instanceof HTMLButtonElement)
    && !(element instanceof HTMLAnchorElement)) {
    throw new PageActionError('BROWSER_ELEMENT_NOT_EDITABLE', 'the referenced element is not focusable')
  }
  element.focus()
  if (!isActiveElement(element)) {
    throw new PageActionError('BROWSER_CAPABILITY_UNAVAILABLE', 'document.activeElement is not the referenced element after focus')
  }
}

/** Map a bounded key onto KeyboardEvent.code. */
function keyCode(key: BridgePressKey): string {
  if (key === 'Space') return 'Space'
  if (key.length === 1 && key >= 'a' && key <= 'z') return `Key${key.toUpperCase()}`
  if (key.length === 1 && key >= '0' && key <= '9') return `Digit${key}`
  return key
}

/** Map a bounded key onto KeyboardEvent.key, applying Shift for letters. */
function eventKeyFor(key: BridgePressKey, shift: boolean): string {
  if (key === 'Space') return ' '
  if (key.length === 1 && key >= 'a' && key <= 'z') return shift ? key.toUpperCase() : key
  return key
}

const NAMED_LEGACY_KEY_CODES: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Space: 32,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Backspace: 8,
  Delete: 46,
}

/**
 * Map a bounded key onto the legacy `keyCode`/`which` value. Pages that gate a
 * gesture on `event.keyCode` — chat composers sending on `keyCode === 13` are
 * the common case — never react to a synthetic event that omits it, because
 * the constructor defaults these members to 0.
 */
function legacyKeyCode(key: BridgePressKey): number {
  const named = NAMED_LEGACY_KEY_CODES[key]
  if (named !== undefined) return named
  return key.toUpperCase().charCodeAt(0)
}

/** Dispatch a bubbling, cancelable key sequence against one element. */
function dispatchKeySequence(
  element: HTMLElement,
  key: BridgePressKey,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean },
): boolean {
  const code = keyCode(key)
  const eventKey = eventKeyFor(key, modifiers.shift === true)
  const legacy = legacyKeyCode(key)
  let prevented = false
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    if (type === 'keypress' && SKIP_KEYPRESS.has(key)) continue
    const event = new KeyboardEvent(type, {
      key: eventKey,
      code,
      bubbles: true,
      composed: true,
      cancelable: true,
      ctrlKey: modifiers.ctrl === true,
      altKey: modifiers.alt === true,
      shiftKey: modifiers.shift === true,
      metaKey: modifiers.meta === true,
    })
    // Page listeners still inspect these legacy numeric fields; define own values without deprecated init members.
    Object.defineProperties(event, {
      keyCode: { value: legacy },
      which: { value: legacy },
    })
    if (!element.dispatchEvent(event)) prevented = true
  }
  return prevented
}

/** Collect tabbable elements in document order. */
function focusableElements(): HTMLElement[] {
  const selector = 'a[href], button, input, select, textarea, [contenteditable], [tabindex]'
  const elements: HTMLElement[] = []
  for (const current of pageDocuments()) {
    for (const candidate of current.querySelectorAll<HTMLElement>(selector)) {
      if (isDisabled(candidate) || candidate.tabIndex < 0) continue
      if (candidate instanceof HTMLInputElement && candidate.type === 'hidden') continue
      elements.push(candidate)
    }
  }
  return elements
}

/** Move focus to the next or previous tabbable element. */
function moveFocus(from: HTMLElement, reverse: boolean): boolean {
  const elements = focusableElements()
  if (elements.length === 0) return false
  const index = elements.indexOf(from)
  const nextIndex = reverse
    ? (index <= 0 ? elements.length - 1 : index - 1)
    : (index === -1 || index === elements.length - 1 ? 0 : index + 1)
  const next = elements[nextIndex]
  if (next === undefined) return false
  next.focus()
  return isActiveElement(next)
}

/** Apply the browser default for one bounded key when the page did not prevent it. */
function applyKeyDefault(
  element: HTMLElement,
  key: BridgePressKey,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean },
): boolean {
  if (key === 'Tab') return moveFocus(element, modifiers.shift === true)
  if (key === 'Space' && element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    if (element.type === 'checkbox') element.checked = !element.checked
    else element.checked = true
    dispatchValueEvents(element, element.value)
    return true
  }
  if (key === 'Enter') {
    submitElement(element)
    return true
  }
  if ((key === 'Backspace' || key === 'Delete') && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    const next = key === 'Backspace' ? element.value.slice(0, -1) : ''
    if (element instanceof HTMLInputElement) setInputValue(element, next)
    else setTextAreaValue(element, next)
    dispatchValueEvents(element, next)
    return true
  }
  return false
}

/** Press one allowed key against a referenced element and verify an observable effect. */
function pressKey(
  element: HTMLElement,
  key: BridgePressKey,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean },
  repeat: number,
): void {
  if (isDisabled(element)) throw new PageActionError('BROWSER_ELEMENT_DISABLED', 'the referenced element is disabled')
  element.focus()
  let observed = false
  for (let index = 0; index < repeat; index += 1) {
    const prevented = dispatchKeySequence(element, key, modifiers)
    if (prevented) {
      observed = true
      if (key === 'Enter') submitStandaloneComposer(element)
      continue
    }
    if (applyKeyDefault(element, key, modifiers)) observed = true
  }
  if (!observed) {
    throw new PageActionError(
      'BROWSER_CAPABILITY_UNAVAILABLE',
      'the page did not respond to the synthetic key event; real keyboard input is unavailable without extra permission',
    )
  }
}

/**
 * Execute one validated action against an element from the latest page read.
 * @param operation - click, fill, select, scroll, focus, or press operation carrying current page coordinates.
 * @returns confirmation of the completed page effect.
 */
export function actOnPage(operation: BridgePageActionOperation): BridgePageActionReceipt | BridgeScrollReceipt {
  if (operation.kind === 'scroll-page') {
    return scrollTarget(operation.pageId, operation.ref, operation.movement)
  }
  const element = resolveElement(operation.pageId, operation.ref)
  switch (operation.kind) {
    case 'click-page-element':
      clickElement(element)
      return { pageId: operation.pageId, ref: operation.ref, action: 'clicked' }
    case 'fill-page-element':
      fillElement(element, operation.value, operation.submit)
      return { pageId: operation.pageId, ref: operation.ref, action: 'filled' }
    case 'select-page-option': {
      const value = selectOption(element, operation.value)
      return { pageId: operation.pageId, ref: operation.ref, action: 'selected', value }
    }
    case 'focus-page-element':
      focusElement(element)
      return { pageId: operation.pageId, ref: operation.ref, action: 'focused' }
    case 'press-page-key':
      pressKey(element, operation.key, operation.modifiers, operation.repeat)
      return { pageId: operation.pageId, ref: operation.ref, action: 'pressed', key: operation.key }
  }
}

/** Chromium API adapter for validated browser-extension bridge operations. */

import {
  BROWSER_PAGE_RESULT_MAX_BYTES,
  isBridgePageActionReceipt,
  isBridgePage,
  isBridgePageContent,
  isBridgeError,
  isBridgeRequest,
  isBridgeScrollReceipt,
} from '../protocol.ts'
import {
  BROWSER_COMPANION_HOST_NAME,
  isEnsureLocalHarnessRequest,
  parseEnsureWebResponse,
  type EnsureWebFailure,
  type EnsureWebRequest,
} from './companion-protocol.ts'
import { normalizeHarnessOrigin } from './local-origin.ts'
import { DSH_ACT_PAGE_KIND, DSH_READ_PAGE_KIND, DSH_WAIT_PAGE_KIND } from './page-content-runtime.ts'
import type {
  BridgeError,
  BridgeOperation,
  BridgeOperationResult,
  BridgePageActionOperation,
  BridgePageActionReceipt,
  BridgePage,
  BridgePageContent,
  BridgeRequest,
  BridgeResponse,
  BridgeScrollReceipt,
  BridgeTab,
  BridgeWaitPageDomOperation,
} from '../protocol.ts'

interface TabsApi {
  create: typeof chrome.tabs.create
  query: typeof chrome.tabs.query
  update: typeof chrome.tabs.update
  remove: typeof chrome.tabs.remove
  get: typeof chrome.tabs.get
  /** Ask the injected page reader in one tab for its current DOM snapshot. */
  sendMessage(tabId: number, message: unknown): Promise<unknown>
}
type ScriptingApi = Pick<typeof chrome.scripting, 'executeScript'>
type SidePanelApi = Pick<typeof chrome.sidePanel, 'setPanelBehavior'>

interface RuntimeApi {
  readonly id: string
  /** Resolve one extension-owned document URL. */
  getURL(path: string): string
  /** Send one closed request to the registered Windows companion. */
  sendNativeMessage(application: string, message: object): Promise<unknown>
  readonly onMessage: Pick<typeof chrome.runtime.onMessage, 'addListener' | 'removeListener'>
}

/** Error produced by extension-side validation of an untrusted page request. */
class InvalidBridgeRequestError extends Error {}

/** Error produced when Chromium has not granted page-script access to the active tab. */
class PageAccessDeniedError extends Error {}

/** Error already classified by the in-page actor. */
class ClassifiedBridgeError extends Error {
  /** Stable error code preserved for the Web Client. */
  readonly code: BridgeError['code']

  /** Create one classified bridge failure. */
  constructor(code: BridgeError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/** Map extension validation and Chromium failures to stable bridge errors. */
function bridgeError(error: unknown): BridgeError {
  const message = error instanceof Error ? error.message : String(error)
  let code: BridgeError['code'] = 'BROWSER_API_FAILED'
  if (error instanceof ClassifiedBridgeError) code = error.code
  else if (error instanceof InvalidBridgeRequestError) code = 'BROWSER_INVALID_REQUEST'
  else if (error instanceof PageAccessDeniedError) code = 'BROWSER_PAGE_ACCESS_DENIED'
  else if (/No tab with id/i.test(message)) code = 'BROWSER_TAB_NOT_FOUND'
  return { code, message }
}

/** Convert a Chromium tab to the JSON representation used across the bridge. */
function normalizeTab(tab: chrome.tabs.Tab): BridgeTab {
  if (tab.id === undefined || !Number.isSafeInteger(tab.id) || tab.id < 0
    || !Number.isSafeInteger(tab.windowId) || tab.windowId < 0) {
    throw new Error('browser extension: browser returned a tab without valid ids')
  }
  const url = tab.pendingUrl ?? tab.url
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    ...(url === undefined ? {} : { url }),
    ...(tab.title === undefined ? {} : { title: tab.title }),
  }
}

/** Validate and normalize a page-supplied absolute HTTP(S) URL. */
function resolveHttpUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new InvalidBridgeRequestError('browser extension: URL must be absolute')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    throw new InvalidBridgeRequestError('browser extension: only credential-free HTTP(S) URLs are allowed')
  }
  return url.href
}

/** Return the serialized UTF-8 byte count of one complete page result. */
function pageByteLength(page: BridgePage): number {
  return new TextEncoder().encode(JSON.stringify(page)).byteLength
}

/** Return the longest Unicode-safe prefix that keeps the complete page within its byte limit. */
function fitPageText(page: BridgePage, text: string): string {
  const characters = Array.from(text)
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    page.text = characters.slice(0, middle).join('')
    if (pageByteLength(page) <= BROWSER_PAGE_RESULT_MAX_BYTES) low = middle
    else high = middle - 1
  }
  return characters.slice(0, low).join('')
}

/** Add active-tab metadata and enforce the complete serialized page-result limit. */
function boundedPage(tab: BridgeTab, content: BridgePageContent): BridgePage {
  const page: BridgePage = {
    tab,
    pageId: content.pageId,
    documentId: content.documentId,
    revision: content.revision,
    viewport: content.viewport,
    text: '',
    fields: [...content.fields],
    actions: [...content.actions],
    scrollTargets: [...content.scrollTargets],
    truncated: content.truncated,
  }
  const textReserveBytes = Math.min(48 * 1024, BROWSER_PAGE_RESULT_MAX_BYTES)
  while ((page.fields.length > 0 || page.actions.length > 0 || page.scrollTargets.length > 0)
    && pageByteLength(page) > BROWSER_PAGE_RESULT_MAX_BYTES - textReserveBytes) {
    if (page.scrollTargets.length > 0) page.scrollTargets.pop()
    else if (page.actions.length > page.fields.length) page.actions.pop()
    else page.fields.pop()
    page.truncated = true
  }
  if (pageByteLength(page) > BROWSER_PAGE_RESULT_MAX_BYTES) {
    throw new Error('browser extension: active-tab metadata exceeds the page result limit')
  }
  page.text = content.text
  if (pageByteLength(page) > BROWSER_PAGE_RESULT_MAX_BYTES) {
    page.text = fitPageText(page, content.text)
    page.truncated = true
  }
  if (!isBridgePage(page)) throw new Error('browser extension: page script returned an invalid result')
  return page
}

/** Return whether Chromium's script failure reports missing authority for the target page. */
function isPageAccessFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cannot access|cannot be scripted|extensions gallery|missing host permission|permission to access|did not return before timeout/i
    .test(message)
}

/** Return whether the tab has no page-reader content script listening yet. */
function isMissingPageReader(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /receiving end does not exist|could not establish connection/i.test(message)
}

/** Return whether the in-tab reader answered with extracted page content. */
function isPageReaderSuccess(value: unknown): value is { ok: true; content: unknown } {
  return typeof value === 'object' && value !== null
    && 'ok' in value && value.ok === true
    && 'content' in value
}

/** Return whether the in-tab reader answered with a concrete failure. */
function isPageReaderFailure(
  value: unknown,
): value is { ok: false; error: { code: BridgeError['code']; message: string } } {
  return typeof value === 'object' && value !== null
    && 'ok' in value && value.ok === false
    && 'error' in value && isBridgeError(value.error)
}

/** Return whether the in-tab actor answered with a valid action or scroll confirmation. */
function isPageActorSuccess(
  value: unknown,
): value is { ok: true; receipt: BridgePageActionReceipt | BridgeScrollReceipt } {
  return typeof value === 'object' && value !== null
    && 'ok' in value && value.ok === true
    && 'receipt' in value
    && (isBridgePageActionReceipt(value.receipt) || isBridgeScrollReceipt(value.receipt))
}

/**
 * Bound one Chromium API promise so a stuck page script cannot outlive the Host request timeout.
 * @param promise - the Chromium operation.
 * @param timeoutMs - maximum wait.
 * @param message - error raised when the timer fires first.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(message)) }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** Maximum time to wait for one in-tab read before failing the bridge call. */
const PAGE_READ_TIMEOUT_MS = 5_000

/** Maximum time to wait for on-demand injection of the page reader. */
const PAGE_INJECT_TIMEOUT_MS = 5_000

/** Reader bundle injected into tabs that loaded before this extension generation. */
const PAGE_READER_FILE = 'page-content.js'

/** Tab shown in the side-panel header; read-page prefers this over the Service Worker's window guess. */
let focusedTabId: number | undefined
/** Recent page snapshots mapped back to the tab that produced their document-bound refs. */
const pageTabIds = new Map<string, number>()
/** Bound retained snapshot routing state so long-lived Service Workers do not grow without limit. */
const PAGE_TAB_ID_MAX = 256

/** Remember which tab owns one newly returned page snapshot. */
function rememberPageTab(pageId: string, tabId: number): void {
  pageTabIds.delete(pageId)
  pageTabIds.set(pageId, tabId)
  while (pageTabIds.size > PAGE_TAB_ID_MAX) {
    const oldest = pageTabIds.keys().next().value as string | undefined
    if (oldest === undefined) return
    pageTabIds.delete(oldest)
  }
}

/**
 * Remember the tab currently displayed in the side-panel chrome.
 * @param tabId - browser-assigned tab identity, or undefined to clear.
 */
export function rememberFocusedTab(tabId: number | undefined): void {
  focusedTabId = tabId
}

/** Reset in-memory tab routing state after a runtime adapter test. */
export function resetBrowserRuntimeForTests(): void {
  focusedTabId = undefined
  pageTabIds.clear()
}

/** Return whether a side-panel message is selecting the tab that page reads should target. */
function isFocusTabRequest(message: unknown): message is { kind: 'focus-tab'; tabId: number } {
  return typeof message === 'object' && message !== null
    && 'kind' in message && message.kind === 'focus-tab'
    && 'tabId' in message && typeof message.tabId === 'number'
    && Number.isSafeInteger(message.tabId)
    && message.tabId >= 0
}

/** Resolve the tab the user is looking at, matching the side-panel header when possible. */
async function resolveReadTab(tabs: TabsApi, tabId?: number): Promise<chrome.tabs.Tab> {
  if (tabId !== undefined) {
    return await tabs.get(tabId)
  }
  if (focusedTabId !== undefined) {
    try {
      const focused = await tabs.get(focusedTabId)
      return focused
    } catch {
      focusedTabId = undefined
    }
  }
  const activeTabs = await tabs.query({ active: true, lastFocusedWindow: true })
  const activeTab = activeTabs[0]
  if (activeTab === undefined) throw new Error('No tab with id: active tab was not found')
  return activeTab
}

/** Ask the in-tab reader for one bounded DOM snapshot or action result. */
function askPageScript(tabs: TabsApi, tabId: number, message: unknown, timeoutMs = PAGE_READ_TIMEOUT_MS): Promise<unknown> {
  return withTimeout(
    tabs.sendMessage(tabId, message),
    timeoutMs,
    'browser extension: page reader did not answer before timeout',
  )
}

/** Inject the current page-content generation into one existing tab. */
function injectPageScript(scripting: ScriptingApi, tabId: number): Promise<unknown> {
  return withTimeout(
    scripting.executeScript({ target: { tabId }, files: [PAGE_READER_FILE] }),
    PAGE_INJECT_TIMEOUT_MS,
    'browser extension: page reader injection did not return before timeout',
  )
}

/** Return whether one page-script answer is a current read response or classified failure. */
function isCurrentReadResponse(value: unknown): boolean {
  return isPageReaderFailure(value)
    || (isPageReaderSuccess(value) && isBridgePageContent(value.content))
}

/** Return whether one page-script answer is a current action response or classified failure. */
function isCurrentActionResponse(value: unknown): boolean {
  return isPageReaderFailure(value) || isPageActorSuccess(value)
}

/**
 * Read one tab, injecting the reader when the tab predates this extension generation.
 * Manifest content scripts only enter tabs opened afterwards, so tabs the user already
 * had open would otherwise require a manual refresh before any read could succeed.
 * @param tabs - tabs API implementation.
 * @param scripting - scripting API used for the one-shot reader injection.
 * @param tabId - tab resolved from the side-panel header.
 * @param message - read or action request sent to the page content script.
 * @param accepts - validator for the expected current protocol response.
 * @returns the reader's raw answer.
 */
async function requestPageScript(
  tabs: TabsApi,
  scripting: ScriptingApi,
  tabId: number,
  message: unknown,
  accepts: (value: unknown) => boolean,
  timeoutMs = PAGE_READ_TIMEOUT_MS,
): Promise<unknown> {
  let response: unknown
  try {
    response = await askPageScript(tabs, tabId, message, timeoutMs)
  } catch (error) {
    if (!isMissingPageReader(error)) throw error
    await injectPageScript(scripting, tabId)
    return await askPageScript(tabs, tabId, message, timeoutMs)
  }
  if (accepts(response)) return response
  await injectPageScript(scripting, tabId)
  return await askPageScript(tabs, tabId, message, timeoutMs)
}

/** Read one resolved tab through its page content script. */
async function readTabPage(tabs: TabsApi, scripting: ScriptingApi, tab: chrome.tabs.Tab): Promise<BridgePage> {
  const normalized = normalizeTab(tab)
  let response: unknown
  try {
    response = await requestPageScript(
      tabs,
      scripting,
      normalized.id,
      { kind: DSH_READ_PAGE_KIND },
      isCurrentReadResponse,
    )
  } catch (error) {
    if (!isPageAccessFailure(error) && !isMissingPageReader(error)) throw error
    throw new PageAccessDeniedError(
      'browser extension: this page cannot be read by extensions; open a normal http(s) page, then retry',
    )
  }
  if (isPageReaderFailure(response)) throw new ClassifiedBridgeError(response.error.code, response.error.message)
  if (!isPageReaderSuccess(response) || !isBridgePageContent(response.content)) {
    throw new Error('browser extension: page script returned an invalid result')
  }
  const page = boundedPage(normalized, response.content)
  rememberPageTab(page.pageId, normalized.id)
  return page
}

/** Read the requested tab, or the tab shown in the side panel. */
async function readActivePage(tabs: TabsApi, scripting: ScriptingApi, tabId?: number): Promise<BridgePage> {
  return readTabPage(tabs, scripting, await resolveReadTab(tabs, tabId))
}

/** Execute one document-bound action in the tab shown by the side panel. */
async function actOnActivePage(
  tabs: TabsApi,
  scripting: ScriptingApi,
  operation: BridgePageActionOperation,
): Promise<BridgePageActionReceipt | BridgeScrollReceipt> {
  const mappedTabId = pageTabIds.get(operation.pageId)
  const tab = normalizeTab(await resolveReadTab(tabs, mappedTabId))
  let response: unknown
  try {
    response = await requestPageScript(
      tabs,
      scripting,
      tab.id,
      { kind: DSH_ACT_PAGE_KIND, operation },
      isCurrentActionResponse,
    )
  } catch (error) {
    if (!isPageAccessFailure(error) && !isMissingPageReader(error)) throw error
    throw new PageAccessDeniedError(
      'browser extension: this page cannot be operated by extensions; open a normal http(s) page, then retry',
    )
  }
  if (isPageReaderFailure(response)) throw new ClassifiedBridgeError(response.error.code, response.error.message)
  if (!isPageActorSuccess(response)) throw new Error('browser extension: page script returned an invalid action result')
  return response.receipt
}

/** Wait for one page condition, re-injecting after navigation destroys the page script. */
async function waitForTabPage(
  tabs: TabsApi,
  scripting: ScriptingApi,
  tabId: number,
  operation: BridgeWaitPageDomOperation,
): Promise<BridgePage> {
  const deadline = Date.now() + operation.timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    const remaining = Math.max(100, deadline - Date.now())
    const waitOperation: BridgeWaitPageDomOperation = {
      ...operation,
      timeoutMs: remaining,
    }
    try {
      const tab = await tabs.get(tabId)
      const response = await requestPageScript(
        tabs,
        scripting,
        tabId,
        { kind: DSH_WAIT_PAGE_KIND, operation: waitOperation },
        isCurrentReadResponse,
        remaining + 500,
      )
      if (isPageReaderFailure(response)) throw new ClassifiedBridgeError(response.error.code, response.error.message)
      if (!isPageReaderSuccess(response) || !isBridgePageContent(response.content)) {
        throw new Error('browser extension: page script returned an invalid result')
      }
      const page = boundedPage(normalizeTab(tab), response.content)
      rememberPageTab(page.pageId, tabId)
      return page
    } catch (error) {
      lastError = error
      if (error instanceof ClassifiedBridgeError && error.code === 'BROWSER_WAIT_TIMEOUT') throw error
      if (!isMissingPageReader(error) && !isPageAccessFailure(error)) throw error
      try {
        await injectPageScript(scripting, tabId)
      } catch (injectError) {
        lastError = injectError
      }
      await new Promise((resolve) => { setTimeout(resolve, 50) })
    }
  }
  if (lastError instanceof ClassifiedBridgeError) throw lastError
  const message = lastError instanceof Error ? lastError.message : 'browser extension: wait timed out'
  throw new ClassifiedBridgeError('BROWSER_WAIT_TIMEOUT', message)
}

/**
 * Execute one validated operation against Chromium's tabs API.
 * @param tabs - tabs API implementation.
 * @param scripting - scripting API used for on-demand page content injection.
 * @param operation - validated operation from the DSH Web Client.
 * @returns normalized JSON result.
 */
export async function executeBridgeOperation(
  tabs: TabsApi,
  scripting: ScriptingApi,
  operation: BridgeOperation,
): Promise<BridgeOperationResult> {
  switch (operation.kind) {
    case 'open-tab': {
      const tab = await tabs.create({ url: resolveHttpUrl(operation.url), active: operation.active })
      return { kind: 'open-tab', tab: normalizeTab(tab) }
    }
    case 'list-tabs': {
      const tabsInWindow = await tabs.query({ lastFocusedWindow: true })
      const normalized: BridgeTab[] = []
      for (const tab of tabsInWindow) {
        try {
          normalized.push(normalizeTab(tab))
        } catch {
          // Tabs without browser-assigned ids cannot be targeted by any supported operation.
        }
      }
      return { kind: 'list-tabs', tabs: normalized }
    }
    case 'read-page':
      return { kind: 'read-page', page: await readActivePage(tabs, scripting, operation.tabId) }
    case 'click-page-element':
    case 'fill-page-element':
    case 'select-page-option':
    case 'focus-page-element':
    case 'press-page-key': {
      const receipt = await actOnActivePage(tabs, scripting, operation)
      if (!isBridgePageActionReceipt(receipt)) {
        throw new Error('browser extension: page script returned an invalid action result')
      }
      return { kind: operation.kind, receipt }
    }
    case 'scroll-page': {
      const receipt = await actOnActivePage(tabs, scripting, operation)
      if (!isBridgeScrollReceipt(receipt)) {
        throw new Error('browser extension: page script returned an invalid scroll result')
      }
      return { kind: 'scroll-page', receipt }
    }
    case 'wait-page':
    {
      const mappedTabId = operation.pageId === undefined ? undefined : pageTabIds.get(operation.pageId)
      if (operation.pageId !== undefined && mappedTabId === undefined && operation.tabId === undefined) {
        throw new ClassifiedBridgeError('BROWSER_PAGE_STALE', 'browser extension: page snapshot is no longer available; read the page again')
      }
      if (mappedTabId !== undefined && operation.tabId !== undefined && mappedTabId !== operation.tabId) {
        throw new ClassifiedBridgeError('BROWSER_PAGE_STALE', 'browser extension: page snapshot belongs to another tab; read the page again')
      }
      const waitTabId = mappedTabId ?? operation.tabId
      if (waitTabId === undefined) throw new InvalidBridgeRequestError('browser extension: wait-page requires pageId or tabId')
      return {
        kind: 'wait-page',
        page: await waitForTabPage(tabs, scripting, waitTabId, {
          condition: operation.condition,
          timeoutMs: operation.timeoutMs,
          stableMs: operation.stableMs,
        }),
      }
    }
    case 'activate-tab': {
      const tab = await tabs.update(operation.tabId, { active: true })
      if (tab === undefined) throw new Error('browser extension: browser did not return the activated tab')
      return { kind: 'activate-tab', tab: normalizeTab(tab) }
    }
    case 'close-tab':
      await tabs.remove(operation.tabId)
      return { kind: 'close-tab', tabId: operation.tabId, closed: true }
  }
}

/** Restrict background requests to content scripts injected into loopback pages. */
function isLoopbackSender(sender: chrome.runtime.MessageSender): boolean {
  const rawUrl = sender.url ?? sender.tab?.url ?? sender.origin
  if (rawUrl === undefined) return false
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

/** Restrict native process startup to this extension's own side-panel document. */
function isSidePanelSender(runtime: RuntimeApi, sender: chrome.runtime.MessageSender): boolean {
  return sender.id === runtime.id && sender.url === runtime.getURL('sidepanel.html')
}

/** Convert Chrome Native Messaging failures to a concrete side-panel diagnostic. */
function nativeMessagingFailure(error: unknown): EnsureWebFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (/not found|not registered|specified native messaging host/i.test(message)) {
    return { ok: false, error: '本机伴随程序尚未安装或注册，请在项目根目录运行浏览器伴随程序安装命令。' }
  }
  return { ok: false, error: `本机伴随程序启动失败：${message}` }
}

/** Validate and forward one authorized side-panel startup request. */
async function ensureLocalHarness(runtime: RuntimeApi, rawOrigin: string) {
  let origin: string
  try {
    origin = normalizeHarnessOrigin(rawOrigin)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies EnsureWebFailure
  }
  try {
    const request: EnsureWebRequest = { kind: 'ensure-web', origin }
    const response = await runtime.sendNativeMessage(BROWSER_COMPANION_HOST_NAME, request)
    return parseEnsureWebResponse(response, origin)
  } catch (error) {
    return nativeMessagingFailure(error)
  }
}

/**
 * Install the MV3 background message listener.
 * @param runtime - Chromium runtime API.
 * @param tabs - Chromium tabs API.
 * @param scripting - scripting API used for on-demand page content injection.
 * @param sidePanel - side-panel API used to bind the extension action.
 * @returns listener disposer for tests and explicit teardown.
 */
export function installBackground(
  runtime: RuntimeApi,
  tabs: TabsApi,
  scripting: ScriptingApi,
  sidePanel: SidePanelApi,
): () => void {
  void sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error('browser extension: failed to enable action-click side panel', error)
  })
  /** Validate and asynchronously answer one Chromium runtime message. */
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (isFocusTabRequest(message)) {
      if (!isSidePanelSender(runtime, sender)) return false
      rememberFocusedTab(message.tabId)
      sendResponse({ ok: true })
      return false
    }
    if (isEnsureLocalHarnessRequest(message)) {
      if (!isSidePanelSender(runtime, sender)) return false
      void ensureLocalHarness(runtime, message.origin).then((response) => { sendResponse(response) })
      return true
    }
    if (!isBridgeRequest(message) || sender.id !== runtime.id) return false
    if (!isLoopbackSender(sender) && !isSidePanelSender(runtime, sender)) return false
    void executeBridgeOperation(tabs, scripting, message.operation).then(
      (value) => { sendResponse({ ok: true, value } satisfies BridgeResponse['response']) },
      (error: unknown) => { sendResponse({ ok: false, error: bridgeError(error) } satisfies BridgeResponse['response']) },
    )
    return true
  }
  runtime.onMessage.addListener(listener)
  return () => { runtime.onMessage.removeListener(listener) }
}

/**
 * Handle one already validated request without Chromium event machinery.
 * @param tabs - tabs API implementation.
 * @param scripting - scripting API used for on-demand page content injection.
 * @param request - validated bridge request.
 * @returns response payload for the content script.
 */
export async function answerBridgeRequest(
  tabs: TabsApi,
  scripting: ScriptingApi,
  request: BridgeRequest,
): Promise<BridgeResponse['response']> {
  try {
    return { ok: true, value: await executeBridgeOperation(tabs, scripting, request.operation) }
  } catch (error) {
    return { ok: false, error: bridgeError(error) }
  }
}

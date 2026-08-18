/** Browser side-panel connection controller for the loopback Harness Web UI. */

import { normalizeHarnessOrigin } from './local-origin.ts'
import {
  BROWSER_EXTENSION_CHANNEL,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  isBridgeProbe,
  isBridgeRequest,
  isBridgeResponse,
  type BridgeResponse,
} from '../protocol.ts'

export { normalizeHarnessOrigin } from './local-origin.ts'

/** Default local Harness Web origin used before the user stores an override. */
export const DEFAULT_HARNESS_ORIGIN = 'http://127.0.0.1:3080'

/** Storage key for the user-selected local Harness origin. */
export const HARNESS_ORIGIN_STORAGE_KEY = 'harnessOrigin'

/**
 * How often the side-panel shell pokes the Harness iframe to renew its Host lease.
 * The iframe's own timers are throttled when the user focuses the page tab;
 * this parent document stays runnable while the panel is open.
 */
export const LEASE_WAKEUP_INTERVAL_MS = 10_000

/** Minimal promise-based storage API used by the side-panel controller. */
export interface SidePanelStorage {
  /**
   * Read one stored value.
   * @param key - extension-local storage key.
   * @returns stored values indexed by key.
   */
  get(key: string): Promise<Record<string, unknown>>
  /**
   * Persist one or more values.
   * @param items - values indexed by storage key.
   * @returns settlement after Chromium stores the values.
   */
  set(items: Record<string, unknown>): Promise<void>
}

/** Required side-panel document elements. */
export interface SidePanelElements {
  /** Root element carrying the active presentation state. */
  root: HTMLElement
  /** Compact connection-state label. */
  status: HTMLElement
  /** Full Harness application frame. */
  frame: HTMLIFrameElement
  /** Connecting presentation. */
  loading: HTMLElement
  /** Dynamic loading/startup heading. */
  loadingTitle?: HTMLElement
  /** Dynamic loading/startup detail. */
  loadingDetail?: HTMLElement
  /** Unavailable-server presentation. */
  offline: HTMLElement
  /** Detailed connection failure. */
  offlineDetail: HTMLElement
  /** Address editor presentation. */
  settings: HTMLElement
  /** Address editor form. */
  settingsForm: HTMLFormElement
  /** Address input. */
  originInput: HTMLInputElement
  /** Address validation failure. */
  settingsError: HTMLElement
  /** Opens address settings from the compact connection status. */
  settingsButton: HTMLButtonElement
  /** Retries the current address. */
  retryButton: HTMLButtonElement
  /** Cancels address editing. */
  cancelButton: HTMLButtonElement
  /** Compact current-tab strip under the toolbar. */
  activeTab?: HTMLElement
  /** Favicon of the window's active tab. */
  activeTabIcon?: HTMLImageElement
  /** Default glyph shown when the active tab has no usable favicon. */
  activeTabIconFallback?: HTMLElement
  /** Visible title of the window's active tab. */
  activeTabTitle?: HTMLElement
  /** Requests host access so page reading can reach the active site. */
  grantAccessButton?: HTMLButtonElement
}

/** Tab fields the side panel needs to label the current page. */
export interface SidePanelTab {
  readonly id?: number | undefined
  readonly title?: string | undefined
  readonly url?: string | undefined
  readonly pendingUrl?: string | undefined
  readonly favIconUrl?: string | undefined
}

/** Tab query and change events used to keep the current-tab strip in sync. */
export interface SidePanelTabsApi {
  /** Read one tab by its browser-assigned id. */
  get(tabId: number): Promise<SidePanelTab>
  /** Read tabs matching a Chromium query. */
  query(queryInfo: { active: true; currentWindow: true }): Promise<SidePanelTab[]>
  readonly onActivated: {
    addListener(listener: (info: { tabId: number }) => void): void
    removeListener(listener: (info: { tabId: number }) => void): void
  }
  readonly onUpdated: {
    addListener(listener: (tabId: number, changeInfo: object, tab: SidePanelTab) => void): void
    removeListener(listener: (tabId: number, changeInfo: object, tab: SidePanelTab) => void): void
  }
}

/** Optional-origin permission checks issued from a user gesture in the side panel. */
export interface SidePanelPermissionsApi {
  /** Return whether the extension already holds the requested host access. */
  contains(permissions: { origins: string[] }): Promise<boolean>
  /** Prompt the user to grant host access for one origin pattern. */
  request(permissions: { origins: string[] }): Promise<boolean>
}

type SidePanelState = 'connecting' | 'starting' | 'connected' | 'offline' | 'settings'

/** Starts the installed tray companion and resolves after Harness is healthy. */
export type EnsureHarness = (origin: string) => Promise<unknown>

/** Forward one iframe bridge envelope through the extension page to the Service Worker. */
export type ForwardBridgeRequest = (message: unknown) => Promise<unknown>

/** Maximum time to wait for the loopback server probe. */
const PANEL_PROBE_TIMEOUT_MS = 3_000
/** Maximum time to wait for the embedded Web UI document. */
const PANEL_FRAME_TIMEOUT_MS = 10_000

/**
 * Return a host-permission pattern for pages that are not already covered by loopback access.
 * @param rawUrl - tab URL or pending URL.
 * @returns `https://host:port/*` when the user must grant access, otherwise undefined.
 */
export function siteAccessOrigin(rawUrl: string | undefined): string | undefined {
  if (rawUrl === undefined || rawUrl === '') return undefined
  try {
    const url = new URL(rawUrl)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
      return undefined
    }
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return undefined
    return `${url.origin}/*`
  } catch {
    return undefined
  }
}

/**
 * Choose a compact label for the window's active tab.
 * @param tab - Chromium tab metadata.
 * @returns page title, falling back to hostname when the title is empty.
 */
export function formatActiveTabTitle(tab: SidePanelTab): string {
  const title = tab.title?.trim()
  if (title) return title
  const rawUrl = tab.pendingUrl ?? tab.url
  if (rawUrl === undefined || rawUrl === '') return '未命名页签'
  try {
    return new URL(rawUrl).hostname || rawUrl
  } catch {
    return rawUrl
  }
}

/**
 * Return a displayable favicon URL from Chromium tab metadata.
 * @param tab - Chromium tab metadata.
 * @returns an http(s) or data URL, or undefined when the value is missing or unsafe.
 */
export function resolveTabFaviconUrl(tab: SidePanelTab): string | undefined {
  const raw = tab.favIconUrl?.trim()
  if (raw === undefined || raw === '') return undefined
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:') return raw
  } catch {
    return undefined
  }
  return undefined
}

/** Build the Web UI URL that marks this rendering as a browser side panel. */
function buildPanelUrl(origin: string): string {
  const url = new URL('/', origin)
  url.searchParams.set('dsh-surface', 'side-panel')
  return url.href
}

/** Convert one failed connection attempt to a concise visible message. */
function connectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '连接本地 Harness 超时，请确认服务已经启动。'
  }
  if (error instanceof TypeError) {
    return '无法连接本地 Harness，请确认服务已经启动且地址正确。'
  }
  return error instanceof Error ? error.message : String(error)
}

/** Whether a failed probe means no HTTP server answered and permits native startup. */
function canAttemptNativeStartup(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')
}

/** Owns side-panel controls, loopback probing, and iframe presentation. */
export class SidePanelController {
  private origin = DEFAULT_HARNESS_ORIGIN
  private state: SidePanelState = 'connecting'
  private stateBeforeSettings: Exclude<SidePanelState, 'settings'> = 'offline'
  private probe: AbortController | undefined
  private frameTimer: number | undefined
  private leaseWakeupTimer: number | undefined
  private probeGeneration = 0
  private awaitingFrame = false
  private started = false
  private disposed = false
  private activeTabId: number | undefined
  /** Monotonic token preventing slower tab lookups from overwriting a newer activation. */
  private activeTabGeneration = 0
  /** Favicon URL currently requested for the visible tab strip. */
  private expectedFaviconUrl: string | undefined
  /** Whether the expected favicon has already loaded successfully. */
  private faviconReady = false
  private accessOrigin: string | undefined

  /**
   * Create a controller over the static extension page.
   * @param elements - required static document elements.
   * @param storage - extension-local settings storage.
   * @param fetcher - cross-origin fetch implementation granted by the manifest.
   * @param ensureHarness - extension request that starts the installed Windows companion.
   * @param tabs - optional tab APIs that keep the current-tab strip in sync.
   * @param permissions - optional host-permission APIs for non-loopback page reading.
   * @param reportFocusedTab - tells the Service Worker which tab the header is showing.
   * @param forwardBridge - optional runtime messaging used to relay iframe Host operations.
   */
  constructor(
    private readonly elements: SidePanelElements,
    private readonly storage: SidePanelStorage,
    private readonly fetcher: typeof fetch,
    private readonly ensureHarness: EnsureHarness,
    private readonly tabs?: SidePanelTabsApi,
    private readonly permissions?: SidePanelPermissionsApi,
    private readonly reportFocusedTab?: (tabId: number) => void,
    private readonly forwardBridge?: ForwardBridgeRequest,
  ) {}

  /**
   * Load saved configuration, install controls, and connect to Harness.
   * @returns settlement after storage loading and the initial server probe.
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.installControls()
    let stored: Record<string, unknown>
    try {
      stored = await this.storage.get(HARNESS_ORIGIN_STORAGE_KEY)
    } catch (error) {
      this.elements.offlineDetail.textContent = `无法读取扩展设置：${connectionErrorMessage(error)}`
      this.setState('offline')
      return
    }
    if (this.disposed) return
    const candidate = stored[HARNESS_ORIGIN_STORAGE_KEY]
    if (candidate !== undefined) {
      if (typeof candidate !== 'string') {
        this.showSettings('已保存的 Harness 地址必须是文本。')
        return
      }
      try {
        this.origin = normalizeHarnessOrigin(candidate)
      } catch (error) {
        this.elements.originInput.value = candidate
        this.showSettings(connectionErrorMessage(error))
        return
      }
    }
    this.elements.originInput.value = this.origin
    this.watchActiveTab()
    await this.connect()
  }

  /** Remove controls and cancel in-flight work. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.probeGeneration += 1
    this.probe?.abort()
    this.probe = undefined
    this.clearFrameTimer()
    this.stopLeaseWakeup()
    this.removeControls()
  }

  /** Attach the static page controls owned by this controller. */
  private installControls(): void {
    this.elements.frame.addEventListener('load', this.onFrameLoad)
    this.elements.settingsButton.addEventListener('click', this.onOpenSettings)
    this.elements.retryButton.addEventListener('click', this.onRetry)
    this.elements.cancelButton.addEventListener('click', this.onCancelSettings)
    this.elements.settingsForm.addEventListener('submit', this.onSaveSettings)
    this.elements.grantAccessButton?.addEventListener('click', this.onGrantAccess)
    this.elements.activeTabIcon?.addEventListener('load', this.onFaviconLoad)
    this.elements.activeTabIcon?.addEventListener('error', this.onFaviconError)
    window.addEventListener('message', this.onIframeMessage)
  }

  /** Detach every static page control installed by {@link installControls}. */
  private removeControls(): void {
    this.elements.frame.removeEventListener('load', this.onFrameLoad)
    this.elements.settingsButton.removeEventListener('click', this.onOpenSettings)
    this.elements.retryButton.removeEventListener('click', this.onRetry)
    this.elements.cancelButton.removeEventListener('click', this.onCancelSettings)
    this.elements.settingsForm.removeEventListener('submit', this.onSaveSettings)
    this.elements.grantAccessButton?.removeEventListener('click', this.onGrantAccess)
    this.elements.activeTabIcon?.removeEventListener('load', this.onFaviconLoad)
    this.elements.activeTabIcon?.removeEventListener('error', this.onFaviconError)
    window.removeEventListener('message', this.onIframeMessage)
    this.tabs?.onActivated.removeListener(this.onTabActivated)
    this.tabs?.onUpdated.removeListener(this.onTabUpdated)
  }

  /** Probe the selected origin, then navigate the hidden app frame. */
  private async connect(allowNativeStartup = true): Promise<void> {
    this.probe?.abort()
    this.clearFrameTimer()
    const generation = ++this.probeGeneration
    const controller = new AbortController()
    this.probe = controller
    this.awaitingFrame = false
    this.elements.offlineDetail.textContent = ''
    this.setState('connecting')
    const timer = window.setTimeout(() => { controller.abort() }, PANEL_PROBE_TIMEOUT_MS)
    try {
      const response = await this.fetcher(`${this.origin}/`, {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (this.disposed || generation !== this.probeGeneration) return
      if (!response.ok) throw new Error(`Harness 服务返回 HTTP ${String(response.status)}`)
      this.awaitingFrame = true
      this.elements.frame.src = buildPanelUrl(this.origin)
      this.frameTimer = window.setTimeout(this.onFrameTimeout, PANEL_FRAME_TIMEOUT_MS)
    } catch (error) {
      if (this.disposed || generation !== this.probeGeneration) return
      if (allowNativeStartup && canAttemptNativeStartup(error)) {
        this.setState('starting')
        try {
          await this.ensureHarness(this.origin)
        } catch (startupError) {
          if (this.disposed || generation !== this.probeGeneration) return
          this.elements.offlineDetail.textContent = `${connectionErrorMessage(error)} ${connectionErrorMessage(startupError)}`
          this.setState('offline')
          return
        }
        if (this.disposed || generation !== this.probeGeneration) return
        await this.connect(false)
        return
      }
      this.elements.offlineDetail.textContent = connectionErrorMessage(error)
      this.setState('offline')
    } finally {
      window.clearTimeout(timer)
      if (generation === this.probeGeneration) this.probe = undefined
    }
  }

  /** Open the address editor while retaining the current presentation for cancel. */
  private showSettings(error = ''): void {
    if (this.state === 'connecting' || this.state === 'starting') {
      this.probeGeneration += 1
      this.probe?.abort()
      this.probe = undefined
      this.clearFrameTimer()
      this.awaitingFrame = false
      this.stateBeforeSettings = 'offline'
    } else if (this.state !== 'settings') {
      this.stateBeforeSettings = this.state
    }
    this.elements.originInput.value ||= this.origin
    this.elements.settingsError.textContent = error
    this.setState('settings')
    this.elements.originInput.focus()
    this.elements.originInput.select()
  }

  /** Validate, persist, and connect to the edited address. */
  private async saveSettings(): Promise<void> {
    let origin: string
    try {
      origin = normalizeHarnessOrigin(this.elements.originInput.value)
    } catch (error) {
      this.elements.settingsError.textContent = connectionErrorMessage(error)
      return
    }
    this.elements.settingsError.textContent = ''
    try {
      await this.storage.set({ [HARNESS_ORIGIN_STORAGE_KEY]: origin })
    } catch (error) {
      this.elements.settingsError.textContent = `无法保存扩展设置：${connectionErrorMessage(error)}`
      return
    }
    if (this.disposed) return
    this.origin = origin
    this.elements.originInput.value = origin
    await this.connect()
  }

  /** Project one controller state into the static side-panel document. */
  private setState(state: SidePanelState): void {
    this.state = state
    this.elements.root.dataset.state = state
    this.elements.status.textContent = state === 'connecting'
      ? '正在加载 Harness'
      : state === 'starting' ? '正在启动本地服务'
        : state === 'connected' ? '已连接' : state === 'offline' ? '未连接' : '连接设置'
    this.elements.frame.hidden = state !== 'connected'
    this.elements.loading.hidden = state !== 'connecting' && state !== 'starting'
    this.elements.offline.hidden = state !== 'offline'
    this.elements.settings.hidden = state !== 'settings'
    if (this.elements.loadingTitle !== undefined) {
      this.elements.loadingTitle.textContent = state === 'starting' ? '正在启动 Harness' : '正在连接 Harness'
    }
    if (this.elements.loadingDetail !== undefined) {
      this.elements.loadingDetail.textContent = state === 'starting'
        ? '本机伴随程序正在启动托盘和 Web 服务，准备好后会自动打开。'
        : '侧边助手会在本地服务准备好后自动打开。'
    }
    if (state === 'connected') this.startLeaseWakeup()
    else this.stopLeaseWakeup()
  }

  /** Clear the pending embedded-document deadline when present. */
  private clearFrameTimer(): void {
    if (this.frameTimer === undefined) return
    window.clearTimeout(this.frameTimer)
    this.frameTimer = undefined
  }

  /**
   * Post one protocol envelope into the embedded Harness iframe.
   * @param message - versioned side-panel or bridge envelope.
   */
  private postToIframe(message: object): void {
    const frameWindow = this.elements.frame.contentWindow
    if (this.state !== 'connected' || frameWindow === null) return
    frameWindow.postMessage(message, this.origin)
  }

  /**
   * Announce that this extension page can answer the current page-bridge protocol.
   * The iframe's content script may be missing; the parent document is the reliable relay.
   */
  private postReadyToIframe(): void {
    this.postToIframe({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'ready',
    })
  }

  /**
   * Echo one Service Worker response into the embedded Harness page.
   * @param requestId - Host request identity echoed by the iframe.
   * @param response - success or failure payload from the Service Worker.
   */
  private postBridgeResponse(requestId: string, response: BridgeResponse['response']): void {
    this.postToIframe({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId,
      response,
    })
  }

  /**
   * Relay probes and Host operations from the embedded Web UI.
   * Same-window content scripts in this iframe are not sufficient: Chromium may omit
   * tab/url on that sender, so this extension page forwards the envelope itself.
   * @param event - untrusted window message.
   */
  private readonly onIframeMessage = (event: MessageEvent<unknown>): void => {
    if (this.disposed || this.state !== 'connected') return
    if (event.source !== this.elements.frame.contentWindow) return
    if (event.origin !== this.origin) return
    if (isBridgeProbe(event.data)) {
      this.postReadyToIframe()
      return
    }
    if (!isBridgeRequest(event.data) || this.forwardBridge === undefined) return
    const request = event.data
    void this.forwardBridge(request).then(
      (response) => {
        const candidate = {
          channel: BROWSER_EXTENSION_CHANNEL,
          version: BROWSER_EXTENSION_PROTOCOL_VERSION,
          direction: 'response' as const,
          requestId: request.requestId,
          response,
        }
        if (isBridgeResponse(candidate)) this.postBridgeResponse(request.requestId, candidate.response)
        else this.postBridgeResponse(request.requestId, {
          ok: false,
          error: { code: 'BROWSER_INVALID_REQUEST', message: 'browser extension: invalid Service Worker response' },
        })
      },
      (error: unknown) => {
        this.postBridgeResponse(request.requestId, {
          ok: false,
          error: {
            code: 'BROWSER_API_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      },
    )
  }

  /**
   * Ask the embedded Harness page to renew its Host lease.
   * postMessage wakes a throttled iframe even when its own setTimeout no longer fires.
   */
  private readonly pokeIframeLease = (): void => {
    this.postReadyToIframe()
    this.postToIframe({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'lease-wakeup',
    })
  }

  /** Start the parent-frame wakeup loop while the Harness UI is showing. */
  private startLeaseWakeup(): void {
    this.stopLeaseWakeup()
    this.pokeIframeLease()
    this.leaseWakeupTimer = window.setInterval(this.pokeIframeLease, LEASE_WAKEUP_INTERVAL_MS)
  }

  /** Stop the parent-frame wakeup loop. */
  private stopLeaseWakeup(): void {
    if (this.leaseWakeupTimer === undefined) return
    window.clearInterval(this.leaseWakeupTimer)
    this.leaseWakeupTimer = undefined
  }

  /** Reveal the already-probed Web UI after its document finishes loading. */
  private readonly onFrameLoad = (): void => {
    if (!this.awaitingFrame || this.state !== 'connecting') return
    this.awaitingFrame = false
    this.clearFrameTimer()
    this.setState('connected')
  }

  /** Surface an embedded Web UI that never produced a load event. */
  private readonly onFrameTimeout = (): void => {
    this.frameTimer = undefined
    if (!this.awaitingFrame || this.state !== 'connecting') return
    this.awaitingFrame = false
    this.elements.offlineDetail.textContent = 'Harness 页面加载超时，请检查浏览器扩展权限后重试。'
    this.setState('offline')
  }

  /** Subscribe to the current window's active tab so the plugin chrome follows tab switches. */
  private watchActiveTab(): void {
    const tabs = this.tabs
    const strip = this.elements.activeTab
    const title = this.elements.activeTabTitle
    if (tabs === undefined || strip === undefined || title === undefined) return
    tabs.onActivated.addListener(this.onTabActivated)
    tabs.onUpdated.addListener(this.onTabUpdated)
    void this.refreshActiveTab()
  }

  /** Query the window's active tab and project it into the plugin chrome. */
  private async refreshActiveTab(): Promise<void> {
    if (this.tabs === undefined || this.disposed) return
    const generation = ++this.activeTabGeneration
    let tab: SidePanelTab | undefined
    try {
      tab = (await this.tabs.query({ active: true, currentWindow: true }))[0]
    } catch {
      if (generation === this.activeTabGeneration) this.hideActiveTab()
      return
    }
    if (this.disposed || generation !== this.activeTabGeneration) return
    await this.renderActiveTab(tab, generation)
  }

  /**
   * Load one tab after Chromium reports a new active tab id.
   * @param tabId - browser-assigned tab identity.
   */
  private async revealTabById(tabId: number, generation: number): Promise<void> {
    if (this.tabs === undefined || this.disposed) return
    let tab: SidePanelTab
    try {
      tab = await this.tabs.get(tabId)
    } catch {
      return
    }
    if (this.disposed || generation !== this.activeTabGeneration) return
    await this.renderActiveTab(tab, generation)
  }

  /**
   * Render the current tab title, favicon, and whether page reading still needs a host grant.
   * @param tab - active tab metadata, if Chromium returned one.
   */
  private async renderActiveTab(tab: SidePanelTab | undefined, generation: number): Promise<void> {
    const strip = this.elements.activeTab
    const title = this.elements.activeTabTitle
    const grant = this.elements.grantAccessButton
    if (strip === undefined || title === undefined || generation !== this.activeTabGeneration) return
    if (tab === undefined) {
      this.hideActiveTab()
      return
    }
    this.activeTabId = tab.id
    this.accessOrigin = siteAccessOrigin(tab.pendingUrl ?? tab.url)
    const tabTitle = formatActiveTabTitle(tab)
    title.textContent = tabTitle
    title.title = tabTitle
    strip.title = tabTitle
    this.applyFavicon(resolveTabFaviconUrl(tab))
    strip.hidden = false
    if (tab.id !== undefined) this.reportFocusedTab?.(tab.id)
    if (grant === undefined) return
    grant.hidden = true
    if (this.accessOrigin === undefined || this.permissions === undefined) return
    let granted = false
    try {
      granted = await this.permissions.contains({ origins: [this.accessOrigin] })
    } catch {
      granted = false
    }
    if (this.disposed || generation !== this.activeTabGeneration || this.accessOrigin === undefined) return
    grant.hidden = granted
  }

  /**
   * Show the tab favicon, or the default glyph when Chromium did not supply a usable URL.
   * @param url - sanitized favicon URL, if any.
   */
  private applyFavicon(url: string | undefined): void {
    const img = this.elements.activeTabIcon
    this.expectedFaviconUrl = url
    this.faviconReady = false
    if (img === undefined) {
      this.showFaviconFallback()
      return
    }
    if (url === undefined) {
      img.removeAttribute('src')
      this.showFaviconFallback()
      return
    }
    if (img.getAttribute('src') === url && img.complete && img.naturalWidth > 0) {
      this.faviconReady = true
      this.showFaviconImage()
      return
    }
    this.showFaviconFallback()
    img.src = url
  }

  /** Reveal the loaded favicon and hide the default glyph. */
  private showFaviconImage(): void {
    const img = this.elements.activeTabIcon
    const fallback = this.elements.activeTabIconFallback
    if (img !== undefined) img.hidden = false
    if (fallback !== undefined) fallback.hidden = true
  }

  /** Hide the favicon image and keep the default glyph visible. */
  private showFaviconFallback(): void {
    const img = this.elements.activeTabIcon
    const fallback = this.elements.activeTabIconFallback
    if (img !== undefined) img.hidden = true
    if (fallback !== undefined) fallback.hidden = false
  }

  /** Hide the current-tab strip when no usable tab is available. */
  private hideActiveTab(): void {
    this.activeTabId = undefined
    this.accessOrigin = undefined
    this.expectedFaviconUrl = undefined
    this.faviconReady = false
    if (this.elements.activeTabIcon !== undefined) this.elements.activeTabIcon.removeAttribute('src')
    this.showFaviconFallback()
    if (this.elements.activeTab !== undefined) this.elements.activeTab.hidden = true
    if (this.elements.grantAccessButton !== undefined) this.elements.grantAccessButton.hidden = true
  }

  /** Follow Chromium's active-tab change into the plugin chrome. */
  private readonly onTabActivated = (info: { tabId: number }): void => {
    const generation = ++this.activeTabGeneration
    void this.revealTabById(info.tabId, generation)
  }

  /** Refresh the strip when the already-active tab's title, URL, or favicon changes. */
  private readonly onTabUpdated = (tabId: number, _changeInfo: object, tab: SidePanelTab): void => {
    if (tabId !== this.activeTabId) return
    const generation = ++this.activeTabGeneration
    void this.renderActiveTab(tab, generation)
  }

  /** Reveal the favicon after the image has loaded for the currently expected URL. */
  private readonly onFaviconLoad = (): void => {
    const img = this.elements.activeTabIcon
    if (this.disposed || img === undefined || this.expectedFaviconUrl === undefined) return
    if (img.getAttribute('src') !== this.expectedFaviconUrl) return
    this.faviconReady = true
    this.showFaviconImage()
  }

  /** Keep the default glyph when the current favicon URL fails to load. */
  private readonly onFaviconError = (): void => {
    const img = this.elements.activeTabIcon
    if (this.disposed || img === undefined) return
    if (this.expectedFaviconUrl === undefined) {
      this.showFaviconFallback()
      return
    }
    if (img.getAttribute('src') !== this.expectedFaviconUrl) return
    if (this.faviconReady) return
    this.showFaviconFallback()
  }

  /** Prompt for host access to the current non-loopback site so page reading can proceed. */
  private readonly onGrantAccess = (): void => {
    const origin = this.accessOrigin
    if (origin === undefined || this.permissions === undefined) return
    void this.permissions.request({ origins: [origin] }).then((granted) => {
      if (this.disposed || this.elements.grantAccessButton === undefined) return
      this.elements.grantAccessButton.hidden = granted
    }, () => {
      // Keep the grant button visible when Chromium rejects the permission prompt.
    })
  }

  /** Open connection settings from the compact status label. */
  private readonly onOpenSettings = (): void => {
    this.showSettings()
  }

  /** Retry the currently selected local Harness origin. */
  private readonly onRetry = (): void => {
    void this.connect()
  }

  /** Restore the presentation that was active before address editing. */
  private readonly onCancelSettings = (): void => {
    this.elements.settingsError.textContent = ''
    this.elements.originInput.value = this.origin
    this.setState(this.stateBeforeSettings)
  }

  /** Save a submitted address without allowing a document navigation. */
  private readonly onSaveSettings = (event: Event): void => {
    event.preventDefault()
    void this.saveSettings()
  }
}

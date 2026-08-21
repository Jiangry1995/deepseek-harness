// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  DEFAULT_HARNESS_ORIGIN,
  HARNESS_ORIGIN_STORAGE_KEY,
  LEASE_WAKEUP_INTERVAL_MS,
  SidePanelController,
  formatActiveTabTitle,
  resolveTabFaviconUrl,
  siteAccessOrigin,
  type EnsureHarness,
  type SidePanelElements,
  type SidePanelPermissionsApi,
  type SidePanelStorage,
  type SidePanelTab,
  type SidePanelTabsApi,
  normalizeHarnessOrigin,
} from '../src/extension/sidepanel-runtime.ts'
import {
  BROWSER_EXTENSION_CHANNEL,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
} from '../src/protocol.ts'

interface TestElementConstructor<T extends HTMLElement> {
  /** Construct the requested jsdom element type. */
  new(): T
}

/** Resolve one typed element from the current jsdom fixture. */
function elementById<T extends HTMLElement>(id: string, constructor: TestElementConstructor<T>): T {
  const element = document.getElementById(id)
  if (!(element instanceof constructor)) throw new Error(`test fixture: missing #${id}`)
  return element
}

/** Create the real element set consumed by the side-panel controller. */
function elements(): SidePanelElements {
  document.body.innerHTML = `
    <main id="root">
      <iframe id="frame" hidden></iframe>
      <section id="loading"></section>
      <section id="offline" hidden><p id="offline-detail"></p></section>
      <section id="settings" hidden>
        <form id="settings-form">
          <input id="origin" />
          <p id="settings-error"></p>
          <button id="cancel" type="button">Cancel</button>
        </form>
      </section>
      <button id="open-settings" type="button"><span id="status"></span></button>
      <button id="retry" type="button">Retry</button>
      <div id="active-tab" hidden>
        <span id="active-tab-icon-fallback"></span>
        <img id="active-tab-icon" alt="" hidden />
        <span id="active-tab-title"></span>
        <button id="grant-access" type="button" hidden>Grant</button>
      </div>
    </main>
  `
  return {
    root: elementById('root', HTMLElement),
    status: elementById('status', HTMLElement),
    frame: elementById('frame', HTMLIFrameElement),
    loading: elementById('loading', HTMLElement),
    offline: elementById('offline', HTMLElement),
    offlineDetail: elementById('offline-detail', HTMLElement),
    settings: elementById('settings', HTMLElement),
    settingsForm: elementById('settings-form', HTMLFormElement),
    originInput: elementById('origin', HTMLInputElement),
    settingsError: elementById('settings-error', HTMLElement),
    settingsButton: elementById('open-settings', HTMLButtonElement),
    retryButton: elementById('retry', HTMLButtonElement),
    cancelButton: elementById('cancel', HTMLButtonElement),
    activeTab: elementById('active-tab', HTMLElement),
    activeTabIcon: elementById('active-tab-icon', HTMLImageElement),
    activeTabIconFallback: elementById('active-tab-icon-fallback', HTMLElement),
    activeTabTitle: elementById('active-tab-title', HTMLElement),
    grantAccessButton: elementById('grant-access', HTMLButtonElement),
  }
}

/** Create a programmable tab API that records listeners. */
function tabsApi(initial?: SidePanelTab): SidePanelTabsApi & {
  activated: Array<(info: { tabId: number }) => void>
  updated: Array<(tabId: number, changeInfo: object, tab: SidePanelTab) => void>
  get: Mock<(tabId: number) => Promise<SidePanelTab>>
  query: Mock<(queryInfo: { active: true; currentWindow: true }) => Promise<SidePanelTab[]>>
} {
  const activated: Array<(info: { tabId: number }) => void> = []
  const updated: Array<(tabId: number, changeInfo: object, tab: SidePanelTab) => void> = []
  const current = initial ?? {
    id: 1,
    title: 'Harness',
    url: 'http://127.0.0.1:3080/',
  }
  return {
    activated,
    updated,
    get: vi.fn().mockImplementation(async (tabId: number) => ({ ...current, id: tabId })),
    query: vi.fn().mockResolvedValue([current]),
    onActivated: {
      addListener(listener: (info: { tabId: number }) => void) { activated.push(listener) },
      removeListener(listener: (info: { tabId: number }) => void) {
        const index = activated.indexOf(listener)
        if (index >= 0) activated.splice(index, 1)
      },
    },
    onUpdated: {
      addListener(listener: (tabId: number, changeInfo: object, tab: SidePanelTab) => void) {
        updated.push(listener)
      },
      removeListener(listener: (tabId: number, changeInfo: object, tab: SidePanelTab) => void) {
        const index = updated.indexOf(listener)
        if (index >= 0) updated.splice(index, 1)
      },
    },
  }
}

/** Create a programmable host-permission API. */
function permissionsApi(granted = false): SidePanelPermissionsApi & {
  contains: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
} {
  return {
    contains: vi.fn().mockResolvedValue(granted),
    request: vi.fn().mockResolvedValue(true),
  }
}

/** Create a programmable promise-based extension storage area. */
function storage(origin?: unknown): SidePanelStorage & { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn().mockResolvedValue(origin === undefined ? {} : { [HARNESS_ORIGIN_STORAGE_KEY]: origin }),
    set: vi.fn().mockResolvedValue(undefined),
  }
}

/** Create a companion startup function that exposes installation failures by default. */
function starter(): Mock<EnsureHarness> {
  return vi.fn<EnsureHarness>().mockRejectedValue(new Error('本机伴随程序尚未安装。'))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('side-panel Harness origin', () => {
  it('normalizes the two allowed loopback hosts', () => {
    expect(DEFAULT_HARNESS_ORIGIN).toBe('http://127.0.0.1:3080')
    expect(normalizeHarnessOrigin(' http://127.0.0.1:3080/ ')).toBe('http://127.0.0.1:3080')
    expect(normalizeHarnessOrigin('http://localhost:4310')).toBe('http://localhost:4310')
  })

  it('rejects remote, credentialed, encrypted, and routed URLs', () => {
    expect(() => normalizeHarnessOrigin('https://localhost:3080')).toThrow('明文 HTTP')
    expect(() => normalizeHarnessOrigin('http://example.com:3080')).toThrow('127.0.0.1 或 localhost')
    expect(() => normalizeHarnessOrigin('http://user:secret@127.0.0.1:3080')).toThrow('用户名或密码')
    expect(() => normalizeHarnessOrigin('http://127.0.0.1:3080/app')).toThrow('只能包含 origin')
    expect(() => normalizeHarnessOrigin('not a URL')).toThrow('有效 URL')
  })
})

describe('side-panel connection controller', () => {
  it('loads the stored origin and reveals the full Harness app after its frame loads', async () => {
    const view = elements()
    const saved = storage('http://localhost:4310')
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const controller = new SidePanelController(view, saved, fetcher, starter())

    await controller.start()

    expect(fetcher).toHaveBeenCalledWith('http://localhost:4310/', expect.objectContaining({ cache: 'no-store' }))
    expect(view.frame.src).toBe('http://localhost:4310/?dsh-surface=side-panel')
    expect(view.root.dataset.state).toBe('connecting')
    view.frame.dispatchEvent(new Event('load'))
    expect(view.root.dataset.state).toBe('connected')
    expect(view.frame.hidden).toBe(false)
    expect(view.loading.hidden).toBe(true)
    controller.dispose()
  })

  it('pokes the embedded Harness page so the Host lease survives iframe timer throttling', async () => {
    vi.useFakeTimers()
    const view = elements()
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      starter(),
    )
    await controller.start()

    const frameWindow = { postMessage: vi.fn() }
    Object.defineProperty(view.frame, 'contentWindow', { configurable: true, value: frameWindow })
    view.frame.dispatchEvent(new Event('load'))

    const wakeup = {
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'lease-wakeup',
    }
    const ready = {
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'ready',
    }
    expect(frameWindow.postMessage).toHaveBeenCalledWith(ready, DEFAULT_HARNESS_ORIGIN)
    expect(frameWindow.postMessage).toHaveBeenCalledWith(wakeup, DEFAULT_HARNESS_ORIGIN)

    frameWindow.postMessage.mockClear()
    await vi.advanceTimersByTimeAsync(LEASE_WAKEUP_INTERVAL_MS)
    expect(frameWindow.postMessage).toHaveBeenCalledWith(wakeup, DEFAULT_HARNESS_ORIGIN)

    controller.dispose()
    frameWindow.postMessage.mockClear()
    await vi.advanceTimersByTimeAsync(LEASE_WAKEUP_INTERVAL_MS)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
  })

  it('relays iframe bridge requests through the extension page to the Service Worker', async () => {
    const view = elements()
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, value: { kind: 'list-tabs', tabs: [] } })
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      starter(),
      undefined,
      undefined,
      undefined,
      sendMessage,
    )
    await controller.start()
    view.frame.dispatchEvent(new Event('load'))

    const frameWindow = view.frame.contentWindow
    if (frameWindow === null) throw new Error('test fixture: iframe has no contentWindow')
    const posted: unknown[] = []
    vi.spyOn(frameWindow, 'postMessage').mockImplementation((message: unknown) => { posted.push(message) })

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        channel: BROWSER_EXTENSION_CHANNEL,
        version: BROWSER_EXTENSION_PROTOCOL_VERSION,
        direction: 'probe',
      },
      origin: DEFAULT_HARNESS_ORIGIN,
      source: frameWindow,
    }))
    expect(posted).toContainEqual({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'ready',
    })

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        channel: BROWSER_EXTENSION_CHANNEL,
        version: BROWSER_EXTENSION_PROTOCOL_VERSION,
        direction: 'request',
        requestId: 'host-request-1',
        operation: { kind: 'list-tabs' },
      },
      origin: DEFAULT_HARNESS_ORIGIN,
      source: frameWindow,
    }))
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        channel: BROWSER_EXTENSION_CHANNEL,
        version: BROWSER_EXTENSION_PROTOCOL_VERSION,
        direction: 'request',
        requestId: 'host-request-1',
        operation: { kind: 'list-tabs' },
      })
    })
    await vi.waitFor(() => {
      expect(posted).toContainEqual({
        channel: BROWSER_EXTENSION_CHANNEL,
        version: BROWSER_EXTENSION_PROTOCOL_VERSION,
        direction: 'response',
        requestId: 'host-request-1',
        response: { ok: true, value: { kind: 'list-tabs', tabs: [] } },
      })
    })

    controller.dispose()
  })

  it('shows a useful offline state and retries the current origin', async () => {
    const view = elements()
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: true, status: 200 })
    const ensureHarness = starter()
    const controller = new SidePanelController(view, storage(), fetcher, ensureHarness)

    await controller.start()

    expect(view.root.dataset.state).toBe('offline')
    expect(view.offline.hidden).toBe(false)
    expect(view.offlineDetail.textContent).toContain('本机伴随程序尚未安装')
    view.retryButton.click()
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(view.frame.src).toBe('http://127.0.0.1:3080/?dsh-surface=side-panel')
    })
    expect(ensureHarness).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('starts the Windows companion once after a failed probe and reconnects without a startup loop', async () => {
    const view = elements()
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: true, status: 200 })
    let finishStartup!: (value: unknown) => void
    const ensureHarness = vi.fn().mockImplementation(() => new Promise((resolve) => { finishStartup = resolve }))
    const controller = new SidePanelController(view, storage(), fetcher, ensureHarness)

    const started = controller.start()
    await vi.waitFor(() => {
      expect(view.root.dataset.state).toBe('starting')
      expect(view.status.textContent).toContain('正在启动')
    })
    finishStartup({ ok: true, state: 'started', origin: 'http://127.0.0.1:3080' })
    await started

    expect(ensureHarness).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(view.frame.src).toBe('http://127.0.0.1:3080/?dsh-surface=side-panel')
    controller.dispose()
  })

  it('does not ask the companion to replace a server that returned HTTP', async () => {
    const view = elements()
    const ensureHarness = starter()
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      ensureHarness,
    )

    await controller.start()

    expect(view.root.dataset.state).toBe('offline')
    expect(view.offlineDetail.textContent).toContain('HTTP 503')
    expect(ensureHarness).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('reports a Web UI frame that does not finish loading', async () => {
    vi.useFakeTimers()
    const view = elements()
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      starter(),
    )
    await controller.start()

    await vi.advanceTimersByTimeAsync(10_001)

    expect(view.root.dataset.state).toBe('offline')
    expect(view.offlineDetail.textContent).toContain('页面加载超时')
    controller.dispose()
  })

  it('validates and persists an edited local origin before reconnecting', async () => {
    const view = elements()
    const saved = storage()
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const controller = new SidePanelController(view, saved, fetcher, starter())
    await controller.start()

    view.status.click()
    expect(view.root.dataset.state).toBe('settings')
    view.originInput.value = 'https://example.com'
    view.settingsForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(view.settingsError.textContent).toContain('明文 HTTP')
    expect(saved.set).not.toHaveBeenCalled()

    view.originInput.value = 'http://localhost:4310/'
    view.settingsForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => {
      expect(saved.set).toHaveBeenCalledWith({ [HARNESS_ORIGIN_STORAGE_KEY]: 'http://localhost:4310' })
      expect(fetcher).toHaveBeenLastCalledWith('http://localhost:4310/', expect.any(Object))
    })
    controller.dispose()
  })
})

describe('side-panel current tab', () => {
  it('builds host-access patterns only for non-loopback HTTP(S) pages', () => {
    expect(siteAccessOrigin('http://127.0.0.1:3080/')).toBeUndefined()
    expect(siteAccessOrigin('http://localhost:4310/app')).toBeUndefined()
    expect(siteAccessOrigin('chrome://extensions')).toBeUndefined()
    expect(siteAccessOrigin('https://szxf.xfj.xz.gov.cn:20000/xfjc/#/lx')).toBe(
      'https://szxf.xfj.xz.gov.cn:20000/*',
    )
    expect(formatActiveTabTitle({ title: ' 来信 ' })).toBe('来信')
    expect(formatActiveTabTitle({ url: 'https://example.test/case' })).toBe('example.test')
    expect(resolveTabFaviconUrl({
      favIconUrl: 'https://element-plus.org/images/element-plus-logo-small.svg',
    })).toBe('https://element-plus.org/images/element-plus-logo-small.svg')
    expect(resolveTabFaviconUrl({ favIconUrl: '  ' })).toBeUndefined()
    expect(resolveTabFaviconUrl({ favIconUrl: 'javascript:alert(1)' })).toBeUndefined()
    expect(resolveTabFaviconUrl({ favIconUrl: 'chrome://favicon/https://example.test' })).toBeUndefined()
  })

  it('shows the page favicon when Chromium supplies one, and falls back when it is missing or broken', async () => {
    const view = elements()
    const favicon = 'https://element-plus.org/images/element-plus-logo-small.svg'
    const tabs = tabsApi({
      id: 1,
      title: 'Popconfirm 气泡确认框',
      url: 'https://element-plus.org/zh-CN/component/popconfirm',
      favIconUrl: favicon,
    })
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      starter(),
      tabs,
      permissionsApi(true),
    )

    await controller.start()
    await vi.waitFor(() => { expect(view.activeTab?.hidden).toBe(false) })
    expect(view.activeTabIcon?.getAttribute('src')).toBe(favicon)

    view.activeTabIcon?.dispatchEvent(new Event('load'))
    expect(view.activeTabIcon?.hidden).toBe(false)
    expect(view.activeTabIconFallback?.hidden).toBe(true)

    tabs.get.mockResolvedValue({
      id: 7,
      title: '来信',
      url: 'https://szxf.xfj.xz.gov.cn:20000/xfjc/#/lx',
    })
    tabs.activated[0]!({ tabId: 7 })
    await vi.waitFor(() => { expect(view.activeTabTitle?.textContent).toBe('来信') })
    expect(view.activeTabIcon?.hasAttribute('src')).toBe(false)
    expect(view.activeTabIcon?.hidden).toBe(true)
    expect(view.activeTabIconFallback?.hidden).toBe(false)

    tabs.get.mockResolvedValue({
      id: 8,
      title: '文档',
      url: 'https://example.test/docs',
      favIconUrl: 'https://example.test/favicon.ico',
    })
    tabs.activated[0]!({ tabId: 8 })
    await vi.waitFor(() => {
      expect(view.activeTabIcon?.getAttribute('src')).toBe('https://example.test/favicon.ico')
    })
    view.activeTabIcon?.dispatchEvent(new Event('error'))
    expect(view.activeTabIcon?.hidden).toBe(true)
    expect(view.activeTabIconFallback?.hidden).toBe(false)
    controller.dispose()
  })

  it('shows the switched tab title and asks for host access on intranet pages', async () => {
    const view = elements()
    const tabs = tabsApi({ id: 1, title: 'Harness', url: 'http://127.0.0.1:3080/' })
    const permissions = permissionsApi(false)
    const incoming = {
      id: 7,
      title: '来信',
      url: 'https://szxf.xfj.xz.gov.cn:20000/xfjc/#/jcyw/lxsl/lx',
    }
    tabs.get.mockResolvedValue(incoming)
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      starter(),
      tabs,
      permissions,
    )

    await controller.start()
    await vi.waitFor(() => {
      expect(view.activeTab?.hidden).toBe(false)
      expect(view.activeTabTitle?.textContent).toBe('Harness')
      expect(view.grantAccessButton?.hidden).toBe(true)
    })

    tabs.activated[0]!({ tabId: 7 })
    await vi.waitFor(() => {
      expect(view.activeTabTitle?.textContent).toBe('来信')
      expect(view.grantAccessButton?.hidden).toBe(false)
    })
    expect(permissions.contains).toHaveBeenCalledWith({
      origins: ['https://szxf.xfj.xz.gov.cn:20000/*'],
    })

    view.grantAccessButton?.click()
    await vi.waitFor(() => {
      expect(permissions.request).toHaveBeenCalledWith({
        origins: ['https://szxf.xfj.xz.gov.cn:20000/*'],
      })
      expect(view.grantAccessButton?.hidden).toBe(true)
    })
    controller.dispose()
    expect(tabs.activated).toHaveLength(0)
  })

  it('does not ask for host access when HTTP(S) pages are already granted by default', async () => {
    const view = elements()
    const tabs = tabsApi({ id: 1, title: 'Harness', url: 'http://127.0.0.1:3080/' })
    const permissions = permissionsApi(true)
    tabs.get.mockResolvedValue({
      id: 7,
      title: '来信',
      url: 'https://szxf.xfj.xz.gov.cn:20000/xfjc/#/jcyw/lxsl/lx',
    })
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      starter(),
      tabs,
      permissions,
    )

    await controller.start()
    tabs.activated[0]!({ tabId: 7 })
    await vi.waitFor(() => {
      expect(view.activeTabTitle?.textContent).toBe('来信')
      expect(view.grantAccessButton?.hidden).toBe(true)
    })
    expect(permissions.request).not.toHaveBeenCalled()
    controller.dispose()
    expect(tabs.activated).toHaveLength(0)
  })

  it('keeps the newest activated tab when an earlier tab lookup settles later', async () => {
    const view = elements()
    const tabs = tabsApi({ id: 1, title: '初始页签', url: 'https://example.test/1' })
    const pending = new Map<number, (tab: SidePanelTab) => void>()
    const reportFocusedTab = vi.fn()
    const controller = new SidePanelController(
      view,
      storage(),
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      starter(),
      tabs,
      permissionsApi(true),
      reportFocusedTab,
    )

    await controller.start()
    await vi.waitFor(() => { expect(view.activeTabTitle?.textContent).toBe('初始页签') })
    reportFocusedTab.mockClear()
    tabs.get.mockImplementation((tabId: number) => new Promise<SidePanelTab>((resolve) => {
      pending.set(tabId, resolve)
    }))

    tabs.activated[0]!({ tabId: 7 })
    tabs.activated[0]!({ tabId: 8 })
    pending.get(8)!({ id: 8, title: '最新页签', url: 'https://example.test/8' })
    await vi.waitFor(() => { expect(view.activeTabTitle?.textContent).toBe('最新页签') })
    pending.get(7)!({ id: 7, title: '过期页签', url: 'https://example.test/7' })
    await Promise.resolve()

    expect(view.activeTabTitle?.textContent).toBe('最新页签')
    expect(reportFocusedTab).toHaveBeenCalledTimes(1)
    expect(reportFocusedTab).toHaveBeenCalledWith(8)
    controller.dispose()
  })
})

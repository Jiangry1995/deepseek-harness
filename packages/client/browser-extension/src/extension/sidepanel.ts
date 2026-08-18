/** MV3 side-panel entry that mounts the local Harness connection controller. */

import {
  SidePanelController,
  type SidePanelElements,
} from './sidepanel-runtime.ts'

interface ElementConstructor<T extends HTMLElement> {
  /** Construct the expected DOM element type. */
  new(): T
}

/**
 * Resolve and validate one required static side-panel element.
 * @param id - document id owned by sidepanel.html.
 * @param constructor - expected DOM element constructor.
 * @returns the matching element.
 */
function requiredElement<T extends HTMLElement>(id: string, constructor: ElementConstructor<T>): T {
  const element = document.getElementById(id)
  if (!(element instanceof constructor)) {
    throw new Error(`browser side panel: #${id} is missing or has the wrong element type`)
  }
  return element
}

/** Resolve the complete element set expected by the controller. */
function resolveElements(): SidePanelElements {
  return {
    root: requiredElement('panel-root', HTMLElement),
    status: requiredElement('panel-status', HTMLElement),
    frame: requiredElement('harness-frame', HTMLIFrameElement),
    loading: requiredElement('loading-view', HTMLElement),
    loadingTitle: requiredElement('loading-title', HTMLElement),
    loadingDetail: requiredElement('loading-detail', HTMLElement),
    offline: requiredElement('offline-view', HTMLElement),
    offlineDetail: requiredElement('offline-detail', HTMLElement),
    settings: requiredElement('settings-view', HTMLElement),
    settingsForm: requiredElement('settings-form', HTMLFormElement),
    originInput: requiredElement('harness-origin', HTMLInputElement),
    settingsError: requiredElement('settings-error', HTMLElement),
    settingsButton: requiredElement('settings-button', HTMLButtonElement),
    retryButton: requiredElement('retry-button', HTMLButtonElement),
    cancelButton: requiredElement('cancel-button', HTMLButtonElement),
    activeTab: requiredElement('panel-active-tab', HTMLElement),
    activeTabIcon: requiredElement('panel-active-tab-icon', HTMLImageElement),
    activeTabIconFallback: requiredElement('panel-active-tab-icon-fallback', HTMLElement),
    activeTabTitle: requiredElement('panel-active-tab-title', HTMLElement),
    grantAccessButton: requiredElement('grant-page-access', HTMLButtonElement),
  }
}

// Chromium's Window.fetch brand-checks its receiver, so retain the extension
// page as `this` when the controller invokes the injected function later.
const panelFetch: typeof fetch = globalThis.fetch.bind(globalThis)
/** Ask the Service Worker to start the registered local companion. */
async function ensureHarness(origin: string): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({ kind: 'ensure-local-harness', origin })
  if (typeof response !== 'object' || response === null || !('ok' in response)) {
    throw new Error('浏览器后台没有返回本机服务启动结果。')
  }
  if (response.ok !== true) {
    const message = 'error' in response && typeof response.error === 'string'
      ? response.error
      : '本机服务启动失败。'
    throw new Error(message)
  }
}

/** Tell the Service Worker which tab the side-panel header is showing. */
function reportFocusedTab(tabId: number): void {
  void chrome.runtime.sendMessage({ kind: 'focus-tab', tabId })
}

/**
 * Forward one iframe bridge envelope through this extension page.
 * Content scripts inside the side-panel iframe are not a reliable sender for Host operations.
 * @param message - versioned probe-time request from the embedded Web Client.
 * @returns the Service Worker response payload.
 */
async function forwardBridge(message: unknown): Promise<unknown> {
  return await chrome.runtime.sendMessage(message)
}

const controller = new SidePanelController(
  resolveElements(),
  chrome.storage.local,
  panelFetch,
  ensureHarness,
  chrome.tabs,
  chrome.permissions,
  reportFocusedTab,
  forwardBridge,
)
void controller.start().catch((error: unknown) => {
  console.error('browser side panel: startup failed', error)
})
window.addEventListener('unload', () => { controller.dispose() }, { once: true })

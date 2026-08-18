import { rm, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const pnpmPackages = await readdir(path.resolve('node_modules/.pnpm'))
const playwrightPackage = pnpmPackages.find(name => /^playwright@[^_]+$/.test(name))
if (!playwrightPackage) throw new Error('workspace Playwright package was not found')
const playwrightUrl = pathToFileURL(path.resolve('node_modules/.pnpm', playwrightPackage, 'node_modules/playwright/index.mjs')).href
const { chromium } = await import(playwrightUrl)

const extensionId = 'gjkldbgjbgjendihekikhjkilimfaikb'
const extensionPath = path.resolve('packages/client/browser-extension/extension')
const profileRoot = path.resolve(tmpdir())
const profilePath = await mkdtemp(path.join(profileRoot, 'dsh-browser-companion-smoke-'))
const screenshotPath = path.resolve('output/playwright/browser-companion-connected.png')
let context
let failure

/** Wait for one Manifest V3 Service Worker without hiding a load failure. */
async function waitForServiceWorker(browserContext) {
  const existing = browserContext.serviceWorkers()[0]
  if (existing) return existing
  return await browserContext.waitForEvent('serviceworker', { timeout: 15_000 })
}

/** Send one real same-window bridge request through content script and Service Worker. */
async function listTabs(frame) {
  return await frame.evaluate(() => new Promise((resolve, reject) => {
    const requestId = `smoke-${Date.now()}`
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('browser bridge response timed out'))
    }, 10_000)
    function onMessage(event) {
      const value = event.data
      if (event.source !== window || value?.channel !== 'dsh-browser-extension'
        || value?.version !== 1 || value?.direction !== 'response' || value?.requestId !== requestId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(value.response)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({
      channel: 'dsh-browser-extension',
      version: 1,
      direction: 'request',
      requestId,
      operation: { kind: 'list-tabs' },
    }, window.location.origin)
  }))
}

try {
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    viewport: { width: 440, height: 860 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  })
  const worker = await waitForServiceWorker(context)
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await page.waitForFunction(() => document.getElementById('panel-root')?.dataset.state === 'starting', undefined, { timeout: 15_000 })
  const startingStatus = await page.locator('#panel-status').textContent()
  await page.waitForFunction(() => document.getElementById('panel-root')?.dataset.state === 'connected', undefined, { timeout: 70_000 })
  const harnessFrame = page.frames().find(frame => frame.url().startsWith('http://127.0.0.1:3080/'))
  if (!harnessFrame) throw new Error('connected panel did not contain the Harness Web frame')
  await harnessFrame.waitForLoadState('domcontentloaded')
  const bridgeResponse = await listTabs(harnessFrame)
  if (bridgeResponse?.ok !== true || bridgeResponse.value?.kind !== 'list-tabs') {
    throw new Error(`real list-tabs bridge failed: ${JSON.stringify(bridgeResponse)}`)
  }
  await page.screenshot({ path: screenshotPath })
  process.stdout.write(`${JSON.stringify({
    extensionId,
    workerUrl: worker.url(),
    startingStatus,
    finalState: await page.locator('#panel-root').getAttribute('data-state'),
    harnessUrl: harnessFrame.url(),
    harnessTitle: await harnessFrame.title(),
    listedTabs: bridgeResponse.value.tabs.length,
    screenshotPath,
  })}\n`)
} catch (error) {
  failure = error
} finally {
  if (context) await context.close().catch(error => { failure ??= error })
  const resolvedProfile = path.resolve(profilePath)
  if (!resolvedProfile.startsWith(`${profileRoot}${path.sep}`)) {
    throw new Error(`temporary browser profile escaped the OS temp directory: ${resolvedProfile}`)
  }
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
if (failure) throw failure

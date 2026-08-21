/**
 * Model-facing browser tab tools over the leased WebExtension provider.
 * @module @deepseek-ai/dsh-tool-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  BrowserInspectMode,
  BrowserPressKey,
  BrowserScrollMovement,
  BrowserTab,
  BrowserWaitCondition,
} from '@deepseek-ai/dsh-browser'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-browser'

/** Services required by the browser tool suite. */
export const inject = ['browser', 'systemPrompt', 'tools']

/** Browser tool configuration. */
export interface Config {
  /** Cooperative timeout for each browser tool call in milliseconds. */
  timeoutMs?: number
  /** Ask through the tool approval chain before every browser operation. */
  requireApproval?: boolean
}

/** Browser tool configuration schema. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1).default(20_000),
  requireApproval: z.boolean().default(true),
})

interface ResolvedConfig {
  timeoutMs: number
  requireApproval: boolean
}

const BROWSER_TOOL_NAMES = new Set([
  'browser_open_tab',
  'browser_list_tabs',
  'browser_read_page',
  'browser_inspect',
  'browser_click',
  'browser_fill',
  'browser_select',
  'browser_scroll',
  'browser_wait_for',
  'browser_focus',
  'browser_press',
  'browser_activate_tab',
  'browser_close_tab',
])

const tabSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number', required: true },
    windowId: { type: 'number', required: true },
    active: { type: 'boolean', required: true },
    url: { type: 'string' },
    title: { type: 'string' },
  },
} as const

const pageFieldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    label: { type: 'string', required: true },
    type: { type: 'string', required: true },
    value: { type: 'string', required: true },
    checked: { type: 'boolean' },
    disabled: { type: 'boolean', required: true },
    readOnly: { type: 'boolean', required: true },
    required: { type: 'boolean', required: true },
    inViewport: { type: 'boolean', required: true },
    focused: { type: 'boolean', required: true },
    context: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: { type: 'string', required: true },
          label: { type: 'string', required: true },
          selected: { type: 'boolean', required: true },
          disabled: { type: 'boolean', required: true },
        },
      },
    },
  },
} as const

const pageActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    role: { type: 'string', required: true },
    label: { type: 'string', required: true },
    rect: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number', required: true },
        y: { type: 'number', required: true },
        width: { type: 'number', required: true },
        height: { type: 'number', required: true },
      },
    },
    accent: { type: 'boolean' },
    disabled: { type: 'boolean', required: true },
    inViewport: { type: 'boolean', required: true },
    focused: { type: 'boolean', required: true },
    context: { type: 'string' },
    href: { type: 'string' },
    checked: { type: 'boolean' },
    selected: { type: 'boolean' },
    expanded: { type: 'boolean' },
    pressed: { type: 'boolean' },
  },
} as const

const pageViewportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
    scrollX: { type: 'number', required: true },
    scrollY: { type: 'number', required: true },
    documentWidth: { type: 'number', required: true },
    documentHeight: { type: 'number', required: true },
  },
} as const

const pageScrollTargetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    label: { type: 'string', required: true },
    axis: { type: 'string', required: true },
    top: { type: 'number', required: true },
    left: { type: 'number', required: true },
    maxTop: { type: 'number', required: true },
    maxLeft: { type: 'number', required: true },
  },
} as const

const pageActionReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pageId: { type: 'string', required: true },
    ref: { type: 'string', required: true },
    action: { type: 'string', required: true },
    value: { type: 'string' },
    key: { type: 'string' },
  },
} as const

const scrollReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pageId: { type: 'string', required: true },
    ref: { type: 'string' },
    movement: { type: 'string', required: true },
    top: { type: 'number', required: true },
    left: { type: 'number', required: true },
    maxTop: { type: 'number', required: true },
    maxLeft: { type: 'number', required: true },
    moved: { type: 'boolean', required: true },
    atBoundary: { type: 'boolean', required: true },
  },
} as const

interface RenderedPageField {
  ref: string
  label: string
  type: string
  value: string
  checked?: boolean
  disabled: boolean
  readOnly: boolean
  required: boolean
  inViewport: boolean
  focused: boolean
  context?: string
  options?: Array<{ value: string; label: string; selected: boolean; disabled: boolean }>
}

interface RenderedPageAction {
  ref: string
  role: string
  label: string
  rect?: { x: number; y: number; width: number; height: number }
  accent?: boolean
  disabled: boolean
  inViewport: boolean
  focused: boolean
  context?: string
  href?: string
  checked?: boolean
  selected?: boolean
  expanded?: boolean
  pressed?: boolean
}

interface RenderedScrollTarget {
  ref: string
  label: string
  axis: string
  top: number
  left: number
  maxTop: number
  maxLeft: number
}

interface RenderedPage {
  tab: BrowserTab
  pageId: string
  documentId: string
  revision: number
  viewport: {
    width: number
    height: number
    scrollX: number
    scrollY: number
    documentWidth: number
    documentHeight: number
  }
  text: string
  fields: RenderedPageField[]
  actions: RenderedPageAction[]
  scrollTargets: RenderedScrollTarget[]
  truncated: boolean
}

interface RenderedPageActionReceipt {
  pageId: string
  ref: string
  action: string
  value?: string
  key?: string
}

interface RenderedScrollReceipt {
  pageId: string
  ref?: string
  movement: string
  top: number
  left: number
  moved: boolean
  atBoundary: boolean
}

interface RenderedInspectNetworkEntry {
  at: number
  source: string
  method: string
  url: string
  status?: number
  ok?: boolean
  durationMs?: number
  error?: string
}

interface RenderedInspectConsoleEntry {
  at: number
  level: string
  text: string
}

interface RenderedInspect {
  tab: BrowserTab
  hooked: boolean
  hookedAt?: number
  network: RenderedInspectNetworkEntry[]
  console: RenderedInspectConsoleEntry[]
  omittedNetwork: number
  omittedConsole: number
}

/** Render one browser tab for model-visible tool output. */
function formatTab(tab: BrowserTab): string {
  const location = tab.url ?? '(URL unavailable)'
  const title = tab.title === undefined ? '' : ` — ${tab.title}`
  return `Tab ${String(tab.id)}${tab.active ? ' [active]' : ''}: ${location}${title}`
}

/** Render one current form field without hiding false checked states. */
function formatPageField(field: RenderedPageField): string {
  const checked = field.checked === undefined ? '' : field.checked ? ' [checked]' : ' [not checked]'
  const flags = [
    field.disabled ? 'disabled' : '',
    field.readOnly ? 'readonly' : '',
    field.required ? 'required' : '',
    field.inViewport ? '' : 'offscreen',
    field.focused ? 'focused' : '',
  ].filter(Boolean)
  const suffix = flags.length === 0 ? '' : ` [${flags.join(', ')}]`
  const context = field.context === undefined ? '' : ` in ${field.context}`
  const options = field.options === undefined
    ? ''
    : `; options: ${field.options.map(option => `${option.label}=${option.value}${option.selected ? ' [selected]' : ''}${option.disabled ? ' [disabled]' : ''}`).join('; ')}`
  return `- [${field.ref}] ${field.label} (${field.type})${checked}${suffix}${context}: ${field.value}${options}`
}

/** Render one clickable page action with its document-bound reference. */
function formatPageAction(action: RenderedPageAction): string {
  const flags = [
    action.disabled ? 'disabled' : '',
    action.accent === true ? 'accent' : '',
    action.inViewport ? '' : 'offscreen',
    action.focused ? 'focused' : '',
    action.checked === undefined ? '' : action.checked ? 'checked' : 'not checked',
    action.selected === undefined ? '' : action.selected ? 'selected' : 'not selected',
    action.expanded === undefined ? '' : action.expanded ? 'expanded' : 'collapsed',
    action.pressed === undefined ? '' : action.pressed ? 'pressed' : 'not pressed',
  ].filter(Boolean)
  const suffix = flags.length === 0 ? '' : ` [${flags.join(', ')}]`
  const context = action.context === undefined ? '' : ` in ${action.context}`
  const href = action.href === undefined ? '' : ` href=${action.href}`
  const rect = action.rect === undefined
    ? ''
    : ` at ${String(action.rect.x)},${String(action.rect.y)} ${String(action.rect.width)}x${String(action.rect.height)}`
  return `- [${action.ref}] ${action.label} (${action.role})${rect}${suffix}${context}${href}`
}

/** Render one scrollable container with its current offsets. */
function formatScrollTarget(target: RenderedScrollTarget): string {
  return `- [${target.ref}] ${target.label} (${target.axis}) ${String(target.top)}/${String(target.maxTop)}`
}

/** Render a bounded current-page snapshot for model-visible tool output. */
function formatPage(page: RenderedPage): string {
  const title = page.tab.title ?? `Tab ${String(page.tab.id)}`
  const url = page.tab.url ?? '(URL unavailable)'
  const text = page.text || '(No visible text.)'
  const fields = page.fields.length === 0 ? '(No form fields.)' : page.fields.map(formatPageField).join('\n')
  const actions = page.actions.length === 0 ? '(No clickable elements.)' : page.actions.map(formatPageAction).join('\n')
  const scrolls = page.scrollTargets.length === 0
    ? '(No extra scroll containers.)'
    : page.scrollTargets.map(formatScrollTarget).join('\n')
  const omitted = page.truncated ? '\n\nSome page content was omitted because the result reached its size limit.' : ''
  return `Current page: ${title}\nTab id: ${String(page.tab.id)}\nURL: ${url}\nPage id: ${page.pageId}\nDocument id: ${page.documentId}\nRevision: ${String(page.revision)}\nViewport: ${String(page.viewport.width)}x${String(page.viewport.height)} at ${String(page.viewport.scrollX)},${String(page.viewport.scrollY)}\n\nVisible text:\n${text}\n\nForm fields:\n${fields}\n\nClickable elements:\n${actions}\n\nScroll targets:\n${scrolls}${omitted}`
}

/** Render one network observation for model-visible inspect output. */
function formatNetworkEntry(entry: RenderedInspectNetworkEntry): string {
  const status = entry.status === undefined ? '' : ` -> ${String(entry.status)}`
  const duration = entry.durationMs === undefined ? '' : ` (${String(entry.durationMs)}ms)`
  const error = entry.error === undefined ? '' : ` error=${entry.error}`
  return `- ${entry.method} ${entry.url}${status}${duration} [${entry.source}]${error}`
}

/** Render one console observation for model-visible inspect output. */
function formatConsoleEntry(entry: RenderedInspectConsoleEntry): string {
  return `- ${entry.level}: ${entry.text}`
}

/** Render a bounded Network/Console snapshot for model-visible tool output. */
function formatInspect(inspect: RenderedInspect, mode: BrowserInspectMode): string {
  const title = inspect.tab.title ?? `Tab ${String(inspect.tab.id)}`
  const url = inspect.tab.url ?? '(URL unavailable)'
  const probe = inspect.hooked
    ? `${mode === 'start' ? 'Capture started' : mode === 'snapshot' ? 'Capture snapshot taken; capture remains active' : 'Capture stopped'}${inspect.hookedAt === undefined ? '' : `; observations began at ${new Date(inspect.hookedAt).toISOString()}`}.`
    : 'Page observation is unavailable. The page CSP may block MAIN-world scripts.'
  const omitted = inspect.omittedNetwork === 0 && inspect.omittedConsole === 0
    ? ''
    : `\nOmitted older entries: network ${String(inspect.omittedNetwork)}, console ${String(inspect.omittedConsole)}.`
  const network = inspect.network.length === 0
    ? '(No network entries captured in this observation session.)'
    : inspect.network.map(formatNetworkEntry).join('\n')
  const logs = inspect.console.length === 0
    ? '(No console entries captured yet.)'
    : inspect.console.map(formatConsoleEntry).join('\n')
  return `Page inspect: ${title}\nTab id: ${String(inspect.tab.id)}\nURL: ${url}\n${probe}${omitted}\n\nNetwork:\n${network}\n\nConsole:\n${logs}`
}

/** Render one completed page action without echoing submitted field contents. */
function formatPageActionReceipt(receipt: RenderedPageActionReceipt): string {
  const value = receipt.value === undefined ? '' : ` Native option value: ${receipt.value}.`
  const key = receipt.key === undefined ? '' : ` Key: ${receipt.key}.`
  return `${receipt.action} element ${receipt.ref} on page ${receipt.pageId}.${value}${key}`
}

/** Render one scroll attempt, including an already-at-boundary outcome. */
function formatScrollReceipt(receipt: RenderedScrollReceipt): string {
  const target = receipt.ref === undefined ? 'document viewport' : `container ${receipt.ref}`
  if (receipt.atBoundary && !receipt.moved) {
    return `Already at the ${receipt.movement} boundary of ${target} on page ${receipt.pageId}. Offset ${String(receipt.top)},${String(receipt.left)}.`
  }
  return `Scrolled ${target} ${receipt.movement} on page ${receipt.pageId} to ${String(receipt.top)},${String(receipt.left)}.`
}

/** Return the first rendered text block from a completed tool result. */
function firstResultText(result: ToolResult): string | undefined {
  const block = result.content[0]
  return block?.type === 'text' && block.text.length > 0 ? block.text : undefined
}

/**
 * Show the switched or opened tab in the plugin card after the call completes.
 * Call-time views only have a tab id; the result carries title and URL.
 */
function presentTabResult(prefix: string, result: ToolResult): ToolResultView | undefined {
  if (result.isError) return undefined
  const text = firstResultText(result)
  if (text === undefined) return undefined
  const firstLine = text.split('\n')[0] ?? text
  const named = / — (.+)$/.exec(firstLine)
  return {
    card: 'generic',
    title: `${prefix}${named?.[1] ?? firstLine}`,
    content: result.content,
  }
}

/** Show the current page title on the completed read card. */
function presentReadPageResult(result: ToolResult): ToolResultView | undefined {
  if (result.isError) return undefined
  const text = firstResultText(result)
  if (text === undefined) return undefined
  const firstLine = text.split('\n')[0] ?? text
  return { card: 'generic', title: firstLine, content: result.content }
}

/** Explain the user-visible effect of one browser tool approval request. */
function approvalReason(toolName: string): string {
  switch (toolName) {
    case 'browser_open_tab': return 'Open a new browser tab.'
    case 'browser_list_tabs': return 'Read URLs and titles from tabs in the current browser window.'
    case 'browser_read_page': return 'Read visible text and current non-secret form values from the active browser page.'
    case 'browser_inspect': return 'Start, snapshot, or stop page network and console capture for the active browser page.'
    case 'browser_click': return 'Click one element on the active browser page.'
    case 'browser_fill': return 'Replace text in one field on the active browser page.'
    case 'browser_select': return 'Select one option on the active browser page.'
    case 'browser_scroll': return 'Scroll the current page or one returned scroll container.'
    case 'browser_wait_for': return 'Wait for the current browser page to change, then read it again.'
    case 'browser_focus': return 'Focus one element on the active browser page.'
    case 'browser_press': return 'Press one allowed key or page shortcut on the active browser page.'
    case 'browser_activate_tab': return 'Activate a browser tab.'
    case 'browser_close_tab': return 'Close a browser tab.'
    default: return 'Use the browser extension.'
  }
}

/**
 * Register browser tab tools, prompt guidance, and the default approval policy.
 * @param ctx - Host Cordis context carrying browser, tool, and system-prompt services.
 * @param config - timeout and approval behavior.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: ResolvedConfig = {
    timeoutMs: config.timeoutMs ?? 20_000,
    requireApproval: config.requireApproval ?? true,
  }

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const downstream = await next()
    if (!resolved.requireApproval || !BROWSER_TOOL_NAMES.has(exec.name) || downstream.kind !== 'allow') return downstream
    return { kind: 'ask', reason: approvalReason(exec.name) }
  })

  ctx.systemPrompt.section({
    name: 'tool:browser',
    order: 145,
    text: 'Treat the user\'s current Chromium window as an execution environment. Infer whether the requested effect belongs in that environment from the user\'s goal and the conversation context. When it does, browser tools are the primary direct capability. When the user asks to read, summarize, or operate the current browser tab, first use browser_list_tabs or browser_read_page to obtain the real browser state. Do not call a skill, web search, or a fetch of the Harness page first. Subsequent actions must be chosen dynamically from the returned page semantics. Use another capability only when a browser tool reports that it cannot perform the requested effect, or when the user explicitly asks for an external search. Select browser tools from their schemas and the observed browser state, not from fixed phrases or site-specific rules. A shared topic, website, or data source is not a reason to divert the task to a skill, shell CLI, web_fetch, or a platform-specific adapter. For a request to find, read, navigate, or interact with website content, use Chromium as the default execution environment even when the user does not say \"browser\". Unless the user explicitly requests another execution path, the first task action must be an applicable browser tool; do not load a skill first. If the active page may contain or lead to the requested content, start with browser_read_page. For every new user message that refers to the page currently beside the side assistant—whether as this page, the current page, or content here—call browser_read_page without tabId before interpreting, answering, or asking for clarification, unless the user explicitly identifies another tab. Treat page snapshots in conversation history as historical observations, not current-tab state. A previous page read never establishes which page is current for a later user message because the user may have switched tabs or navigated. Do not answer from or clarify against an older page snapshot when a fresh read can resolve the reference. Skill catalog descriptions are capability summaries, not routing instructions, and never override this browser-first rule. Use another execution path only when the user explicitly requests it or a browser tool reports a concrete limitation and changing environments still satisfies the request. Recommended loop: read the page, act with a returned ref, wait for the page to change, read again, and verify the actual result. browser_read_page reads visible text, current non-secret form values including textarea and input values, clickable elements, scroll targets, viewport metrics, one pageId, one documentId, a revision, and document-bound element refs. Choose the next browser operation from the requested effect and that returned state. Before clicking, filling, selecting, focusing, pressing, or scrolling a container, use the pageId and ref from the latest browser_read_page result. Never invent refs, CSS selectors, XPath, coordinates, or JavaScript. To send a chat composer, use the gesture the composer itself advertises: when its label or placeholder names a key, press that key on the field with browser_press; otherwise click the send control from the latest snapshot. Icon controls that expose no accessible name are reported as (unlabeled) with role clickable and their viewport rect, so choose among same-looking controls by position instead of guessing. After a page action that may update the page asynchronously, call browser_wait_for with kind:ready or kind:text, then call browser_read_page again to confirm the result and obtain fresh refs. Do not invent documentId or afterRevision for kind:change; omitting them waits until the page is stable. If a reference is stale or missing, read the page again instead of guessing. If a browser tool fails, diagnose the provider connection, permission, stale pageId, or page change; do not silently switch to a skill. Use browser_list_tabs only when the task requires information about or selection among tabs; its results contain only tab ids, URLs, and titles. When the task concerns the current page, operate on that page instead of constructing a replacement URL, and never list, summarize, or mention unrelated tabs. HTTP(S) pages are readable and operable by default after the extension is loaded; do not ask the user to click Allow or reopen the side assistant for ordinary sites. If a browser tool returns page text, fields, or actions, use that content; do not claim the body is unavailable because the URL uses a hash route or the site is on an intranet. Password, file, hidden, one-time-code, and payment-secret controls are not exposed for reading or writing. chrome:// and similar privileged pages cannot be scripted. Native Chromium DevTools cannot be opened from these tools. When the user asks for F12, Network, Console, or page requests, call browser_inspect with mode:start before reproducing the page behavior, use mode:snapshot only for an intermediate read, and call mode:stop for the final read and cleanup. The result contains only fetch/XHR calls and console messages observed after start, without request or response bodies. Always stop a capture after inspection. browser_press accepts named keys and, with Control, Alt, or Meta, letter and digit page shortcuts such as Ctrl+S; it cannot operate browser chrome such as F12.',
  })

  ctx.tools.register(defineTool({
    name: 'browser_open_tab',
    description: 'Open an absolute HTTP(S) URL in a new tab of the user\'s current Chromium window. Use this when the user asks to go to, open, or visit a website; do not substitute the skill tool or a shell CLI.',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute HTTP(S) URL without embedded credentials.' },
      active: { type: 'boolean', description: 'Whether the new tab becomes active. Defaults to true.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: tabSchema,
      render: (_args, tab) => [{ type: 'text', text: formatTab(tab) }],
    },
    /** Open one validated HTTP(S) URL through the selected extension provider. */
    async execute(args, exec) {
      return ctx.browser.openTab({ url: args.url, ...(args.active === undefined ? {} : { active: args.active }) }, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'Open browser tab', kind: 'other', rawInput: args.url }),
    presentResult: (_args, result) => presentTabResult('Opened ', result),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_list_tabs',
    description: 'List tabs in the current browser window, including ids, active state, URLs, and titles when available. Do not use this to summarize or inspect the current page; use browser_read_page instead.',
    parameters: {},
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { tabs: { type: 'array', items: tabSchema, required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tabs.length === 0 ? 'No tabs found.' : value.tabs.map(formatTab).join('\n'),
      }],
    },
    /** List tabs visible in the connected extension's current window. */
    async execute(_args, exec) {
      return { tabs: await ctx.browser.listTabs(exec.signal) }
    },
    presentCall: () => ({ card: 'generic', title: 'List browser tabs', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_read_page',
    description: 'Read bounded visible text and current non-secret form values from a browser tab, including textarea and input values, scroll targets, and viewport metrics. Every new current-page reference requires a fresh read without tabId, even when conversation history contains a prior page snapshot. Omit tabId to read the current active web tab. Password, file, hidden, one-time-code, and payment-secret controls are excluded.',
    parameters: {
      tabId: { type: 'number', description: 'Browser-assigned tab id to read without first activating it. Omit to read the current active web tab.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tab: { ...tabSchema, required: true },
          pageId: { type: 'string', required: true },
          documentId: { type: 'string', required: true },
          revision: { type: 'number', required: true },
          viewport: { ...pageViewportSchema, required: true },
          text: { type: 'string', required: true },
          fields: { type: 'array', items: pageFieldSchema, required: true },
          actions: { type: 'array', items: pageActionSchema, required: true },
          scrollTargets: { type: 'array', items: pageScrollTargetSchema, required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, page) => [{ type: 'text', text: formatPage(page) }],
    },
    /** Read the requested or active page through the selected browser-extension provider. */
    async execute(args, exec) {
      return ctx.browser.readPage(args.tabId === undefined ? {} : { tabId: args.tabId }, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'Read current page', kind: 'read' }),
    presentResult: (_args, result) => presentReadPageResult(result),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_inspect',
    description: 'Control a short-lived capture of page fetch/XHR requests and console messages. Call with mode=start before reproducing the page behavior, use snapshot for an intermediate read, and call stop for the final read and cleanup. Native DevTools cannot be opened. Request and response bodies are not returned.',
    parameters: {
      tabId: { type: 'number', description: 'Browser-assigned tab id to inspect without first activating it. Omit to inspect the current active web tab.' },
      mode: { type: 'string', required: true, description: 'Observation lifecycle: start, snapshot, or stop.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tab: { ...tabSchema, required: true },
          hooked: { type: 'boolean', required: true },
          hookedAt: { type: 'number' },
          network: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                at: { type: 'number', required: true },
                source: { type: 'string', required: true },
                method: { type: 'string', required: true },
                url: { type: 'string', required: true },
                status: { type: 'number' },
                ok: { type: 'boolean' },
                durationMs: { type: 'number' },
                error: { type: 'string' },
              },
            },
          },
          console: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                at: { type: 'number', required: true },
                level: { type: 'string', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          omittedNetwork: { type: 'number', required: true },
          omittedConsole: { type: 'number', required: true },
        },
      },
      render: (args, inspect) => [{ type: 'text', text: formatInspect(inspect, args.mode as BrowserInspectMode) }],
    },
    /** Inspect recent page network and console observations through the selected provider. */
    async execute(args, exec) {
      return ctx.browser.inspectPage({
        mode: args.mode as BrowserInspectMode,
        ...(args.tabId === undefined ? {} : { tabId: args.tabId }),
      }, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'Inspect page network and console', kind: 'read' }),
    presentResult: (_args, result) => presentReadPageResult(result),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: 'Click a visible enabled element using pageId and ref from the latest browser_read_page result.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id from the latest browser_read_page result.' },
      ref: { type: 'string', required: true, description: 'Element ref from the same browser_read_page result.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: pageActionReceiptSchema,
      render: (_args, receipt) => [{ type: 'text', text: formatPageActionReceipt(receipt) }],
    },
    /** Click one document-bound element through the selected browser-extension provider. */
    async execute(args, exec) {
      return ctx.browser.clickPage(ctx.browser.resolvePageTarget(args.pageId, args.ref), exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: `Click page element ${args.ref}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_fill',
    description: 'Replace text in a visible editable field using pageId and ref from the latest browser_read_page result.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id from the latest browser_read_page result.' },
      ref: { type: 'string', required: true, description: 'Field ref from the same browser_read_page result.' },
      value: { type: 'string', required: true, description: 'Complete replacement text.' },
      submit: { type: 'boolean', description: 'Submit the owning form, click a nearby send or submit control when there is no form, or dispatch Enter after filling. Defaults to false.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: pageActionReceiptSchema,
      render: (_args, receipt) => [{ type: 'text', text: formatPageActionReceipt(receipt) }],
    },
    /** Fill one document-bound text field through the selected extension provider. */
    async execute(args, exec) {
      const target = ctx.browser.resolvePageTarget(args.pageId, args.ref)
      return ctx.browser.fillPage({
        ...target,
        value: args.value,
        ...(args.submit === undefined ? {} : { submit: args.submit }),
      }, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: `Fill page field ${args.ref}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_select',
    description: 'Select a native option by exact value or visible text using pageId and ref from browser_read_page.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id from the latest browser_read_page result.' },
      ref: { type: 'string', required: true, description: 'Native select ref from the same browser_read_page result.' },
      value: { type: 'string', required: true, description: 'Exact option value or visible option text.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: pageActionReceiptSchema,
      render: (_args, receipt) => [{ type: 'text', text: formatPageActionReceipt(receipt) }],
    },
    /** Select one native option through the selected extension provider. */
    async execute(args, exec) {
      const target = ctx.browser.resolvePageTarget(args.pageId, args.ref)
      return ctx.browser.selectPage({ ...target, value: args.value }, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: `Select page field ${args.ref}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_scroll',
    description: 'Scroll the document viewport or one scroll target returned by the latest browser_read_page result. Omit ref to scroll the page. If the container is already at the requested boundary, the result says so instead of claiming a move.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id from the latest browser_read_page result.' },
      ref: { type: 'string', description: 'Scroll-target ref from the same browser_read_page result. Omit to scroll the document viewport.' },
      movement: {
        type: 'string',
        required: true,
        description: 'One of line-up, line-down, line-left, line-right, page-up, page-down, page-left, page-right, top, bottom, left-edge, right-edge.',
      },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: scrollReceiptSchema,
      render: (_args, receipt) => [{ type: 'text', text: formatScrollReceipt(receipt) }],
    },
    /** Scroll one current page snapshot through the selected extension provider. */
    async execute(args, exec) {
      return ctx.browser.scrollPage({
        pageId: ctx.browser.resolvePageId(args.pageId),
        movement: args.movement as BrowserScrollMovement,
        ...(args.ref === undefined ? {} : { ref: ctx.browser.resolvePageTarget(args.pageId, args.ref).ref }),
      }, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: `Scroll page ${args.movement}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_focus',
    description: 'Focus a field or focusable action using pageId and ref from the latest browser_read_page result. Success requires document.activeElement to be that element.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id from the latest browser_read_page result.' },
      ref: { type: 'string', required: true, description: 'Element ref from the same browser_read_page result.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: pageActionReceiptSchema,
      render: (_args, receipt) => [{ type: 'text', text: formatPageActionReceipt(receipt) }],
    },
    /** Focus one document-bound element through the selected extension provider. */
    async execute(args, exec) {
      return ctx.browser.focusPage(ctx.browser.resolvePageTarget(args.pageId, args.ref), exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: `Focus page element ${args.ref}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_press',
    description: 'Press one allowed key against a referenced element from the latest browser_read_page result. Named keys: Enter, Escape, Tab, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Backspace, Delete. Letter and digit keys require ctrl, alt, or meta and are for page shortcuts such as Ctrl+S. F12 and other browser-chrome keys are rejected. Repeat is 1-20.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id from the latest browser_read_page result.' },
      ref: { type: 'string', required: true, description: 'Element ref from the same browser_read_page result.' },
      key: { type: 'string', required: true, description: 'Allowed key name. Arbitrary key names are rejected.' },
      ctrl: { type: 'boolean', description: 'Hold Control. Defaults to false.' },
      alt: { type: 'boolean', description: 'Hold Alt. Defaults to false.' },
      shift: { type: 'boolean', description: 'Hold Shift. Defaults to false.' },
      meta: { type: 'boolean', description: 'Hold Meta. Defaults to false.' },
      repeat: { type: 'number', description: 'Repeat count from 1 through 20. Defaults to 1.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: pageActionReceiptSchema,
      render: (_args, receipt) => [{ type: 'text', text: formatPageActionReceipt(receipt) }],
    },
    /** Press one allowed key through the selected extension provider. */
    async execute(args, exec) {
      const target = ctx.browser.resolvePageTarget(args.pageId, args.ref)
      return ctx.browser.pressPage({
        ...target,
        key: args.key as BrowserPressKey,
        modifiers: {
          ...(args.ctrl === true ? { ctrl: true } : {}),
          ...(args.alt === true ? { alt: true } : {}),
          ...(args.shift === true ? { shift: true } : {}),
          ...(args.meta === true ? { meta: true } : {}),
        },
        ...(args.repeat === undefined ? {} : { repeat: args.repeat }),
      }, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: `Press ${args.key} on ${args.ref}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_wait_for',
    description: 'Wait until a page changes, shows or hides text, reaches a URL, or becomes stable, then return a fresh page snapshot. Prefer pageId from the latest browser_read_page result; use tabId only when no page snapshot exists. Never invent a tab id. Prefer kind:ready or kind:text after an action; kind:change without documentId and afterRevision waits until the page is stable.',
    parameters: {
      pageId: { type: 'string', description: 'Page id from the latest browser_read_page result. Preferred because it stays bound to the tab that produced the snapshot.' },
      tabId: { type: 'number', description: 'Browser-assigned tab id to observe only when no pageId is available.' },
      condition: {
        type: 'object',
        required: true,
        description: 'Wait condition: {kind:"change",documentId,afterRevision}, {kind:"text",text,state:"present"|"absent"}, {kind:"url",value,match:"exact"|"prefix"|"contains"}, or {kind:"ready"}. A change condition without documentId and afterRevision waits until the page is stable, the same as kind:ready.',
        additionalProperties: true,
        properties: {
          kind: { type: 'string', required: true },
          documentId: { type: 'string' },
          afterRevision: { type: 'number' },
          text: { type: 'string' },
          state: { type: 'string' },
          value: { type: 'string' },
          match: { type: 'string' },
        },
      },
      timeoutMs: { type: 'number', description: 'Maximum wait in milliseconds from 100 through 30000. Defaults to 5000.' },
      stableMs: { type: 'number', description: 'Quiet period in milliseconds from 0 through 2000. Defaults to 150.' },
    },
    timeoutMs: Math.max(resolved.timeoutMs, 32_000),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tab: { ...tabSchema, required: true },
          pageId: { type: 'string', required: true },
          documentId: { type: 'string', required: true },
          revision: { type: 'number', required: true },
          viewport: { ...pageViewportSchema, required: true },
          text: { type: 'string', required: true },
          fields: { type: 'array', items: pageFieldSchema, required: true },
          actions: { type: 'array', items: pageActionSchema, required: true },
          scrollTargets: { type: 'array', items: pageScrollTargetSchema, required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, page) => [{ type: 'text', text: formatPage(page) }],
    },
    /** Wait for one page condition through the selected extension provider. */
    async execute(args, exec) {
      return ctx.browser.waitPage({
        kind: 'wait-page',
        ...(args.pageId === undefined ? {} : { pageId: ctx.browser.resolvePageId(args.pageId) }),
        ...(args.tabId === undefined ? {} : { tabId: args.tabId }),
        condition: args.condition as BrowserWaitCondition,
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
        ...(args.stableMs === undefined ? {} : { stableMs: args.stableMs }),
      }, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'Wait for page', kind: 'read' }),
    presentResult: (_args, result) => presentReadPageResult(result),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_activate_tab',
    description: 'Activate a browser tab by its browser-assigned id.',
    parameters: {
      tabId: { type: 'number', required: true, description: 'Non-negative tab id returned by browser_list_tabs or browser_open_tab.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: tabSchema,
      render: (_args, tab) => [{ type: 'text', text: formatTab(tab) }],
    },
    /** Activate the requested browser-assigned tab identity. */
    async execute(args, exec) {
      return ctx.browser.activateTab(args.tabId, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'Switch browser tab', kind: 'other', rawInput: args.tabId }),
    presentResult: (_args, result) => presentTabResult('Switched to ', result),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_close_tab',
    description: 'Close a browser tab by its browser-assigned id.',
    parameters: {
      tabId: { type: 'number', required: true, description: 'Non-negative tab id returned by browser_list_tabs or browser_open_tab.' },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tabId: { type: 'number', required: true },
          closed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Closed tab ${String(value.tabId)}.` }],
    },
    /** Close the requested browser-assigned tab identity. */
    async execute(args, exec) {
      return ctx.browser.closeTab(args.tabId, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'Close browser tab', kind: 'other', rawInput: args.tabId }),
  }))
}

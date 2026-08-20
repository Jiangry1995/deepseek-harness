// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { actOnPage } from '../src/extension/page-actor.ts'
import { resetDocumentIdentityForTests } from '../src/extension/page-document.ts'
import { readVisiblePage } from '../src/extension/page-reader.ts'

/** Replace the current page body for one interaction assertion. */
function setPage(html: string): void {
  document.body.innerHTML = html
}

afterEach(() => {
  document.body.innerHTML = ''
  resetDocumentIdentityForTests()
  Reflect.deleteProperty(document, 'execCommand')
})

describe('document-bound page actions', () => {
  it('fills a native input through its value setter and emits framework-compatible events', () => {
    setPage('<form><input aria-label="搜索"><button type="submit">搜索</button></form>')
    const page = readVisiblePage()
    const input = document.querySelector('input')!
    const events: string[] = []
    input.addEventListener('input', event => events.push(event.type))
    input.addEventListener('change', event => events.push(event.type))

    expect(actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e1', value: 'deepseek', submit: false }))
      .toEqual({ pageId: page.pageId, ref: 'e1', action: 'filled' })
    expect(input.value).toBe('deepseek')
    expect(events).toEqual(['input', 'change'])
  })

  it('fills a contenteditable through the document editing command without replacing its editor structure', () => {
    setPage(`
      <div role="textbox" aria-label="正文" contenteditable="true">
        <div data-editor-block><span data-editor-text><br></span></div>
      </div>
    `)
    const page = readVisiblePage()
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
    const editorText = document.querySelector<HTMLElement>('[data-editor-text]')!
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    const input = vi.fn()
    editor.addEventListener('input', input)
    const execCommand = vi.fn((_command: string, _showDefaultUi: boolean, value: string) => {
      editorText.textContent = value
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value,
      }))
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e1', value: '通用草稿', submit: false }))
      .toEqual({ pageId: page.pageId, ref: 'e1', action: 'filled' })
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '通用草稿')
    expect(editor.querySelector('[data-editor-block]')).not.toBeNull()
    expect(editor.innerText || editor.textContent).toContain('通用草稿')
    expect(input).toHaveBeenCalledTimes(1)
  })

  it('clears a contenteditable through the document delete command', () => {
    setPage('<div role="textbox" aria-label="正文" contenteditable="true">旧草稿</div>')
    const page = readVisiblePage()
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e1', value: '', submit: false }))
      .toEqual({ pageId: page.pageId, ref: 'e1', action: 'filled' })
    expect(execCommand).toHaveBeenCalledWith('delete', false)
  })

  it('submits a filled search control when requested', () => {
    setPage('<form><input aria-label="搜索"><button type="submit">搜索</button></form>')
    const page = readVisiblePage()
    const form = document.querySelector('form')!
    const requestSubmit = vi.fn()
    form.requestSubmit = requestSubmit

    actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e1', value: 'deepseek', submit: true })

    expect(requestSubmit).toHaveBeenCalledTimes(1)
  })

  it('clicks a nearby named send control when filling or pressing Enter without a form', () => {
    setPage(`
      <div class="el-editor-sender">
        <textarea aria-label="输入"></textarea>
        <div class="el-send-button">
          <button type="button">新开对话</button>
          <button type="button" aria-label="删除"></button>
          <button type="button" aria-label="发送"></button>
        </div>
      </div>
    `)
    const page = readVisiblePage()
    const newChat = document.querySelectorAll('button')[0]!
    const remove = document.querySelectorAll('button')[1]!
    const send = document.querySelectorAll('button')[2]!
    const newChatClick = vi.fn()
    const removeClick = vi.fn()
    const sendClick = vi.fn()
    newChat.addEventListener('click', newChatClick)
    remove.addEventListener('click', removeClick)
    send.addEventListener('click', sendClick)

    actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e1', value: '你好', submit: true })
    expect(sendClick).toHaveBeenCalledTimes(1)
    expect(newChatClick).not.toHaveBeenCalled()
    expect(removeClick).not.toHaveBeenCalled()

    sendClick.mockClear()
    actOnPage({
      kind: 'press-page-key',
      pageId: page.pageId,
      ref: 'e1',
      key: 'Enter',
      modifiers: {},
      repeat: 1,
    })
    expect(sendClick).toHaveBeenCalledTimes(1)
    expect(newChatClick).not.toHaveBeenCalled()
    expect(removeClick).not.toHaveBeenCalled()
  })

  it('clicks the named send button when the referenced node is icon markup or composer chrome', () => {
    setPage(`
      <div class="el-editor-sender">
        <textarea aria-label="输入"></textarea>
        <div class="el-send-button" id="cluster">
          <button type="button">新开对话</button>
          <button type="button" aria-label="删除"></button>
          <button type="button" aria-label="发送" id="send"><span data-icon="send"></span></button>
        </div>
      </div>
    `)
    const page = readVisiblePage()
    const cluster = document.querySelector<HTMLElement>('#cluster')!
    const icon = document.querySelector<HTMLElement>('[data-icon="send"]')!
    const send = document.querySelector<HTMLElement>('#send')!
    const remove = document.querySelectorAll('button')[1]!
    const sendClick = vi.fn()
    const removeClick = vi.fn()
    send.addEventListener('click', sendClick)
    remove.addEventListener('click', removeClick)
    icon.setAttribute('data-dsh-page-ref', 'icon')
    cluster.setAttribute('data-dsh-page-ref', 'cluster')

    actOnPage({ kind: 'click-page-element', pageId: page.pageId, ref: 'icon' })
    expect(sendClick).toHaveBeenCalledTimes(1)
    expect(removeClick).not.toHaveBeenCalled()

    sendClick.mockClear()
    actOnPage({ kind: 'click-page-element', pageId: page.pageId, ref: 'cluster' })
    expect(sendClick).toHaveBeenCalledTimes(1)
    expect(removeClick).not.toHaveBeenCalled()
  })

  it('sends a composer that gates Enter on the legacy keyCode', () => {
    setPage('<div><textarea aria-label="输入问题，发送 [Enter]"></textarea></div>')
    const page = readVisiblePage()
    const textarea = document.querySelector('textarea')!
    const send = vi.fn()
    const observed: number[] = []
    textarea.addEventListener('keydown', (event) => {
      observed.push(event.keyCode, event.which)
      if (event.keyCode === 13 && !event.shiftKey) {
        send()
        event.preventDefault()
      }
    })

    actOnPage({ kind: 'press-page-key', pageId: page.pageId, ref: 'e1', key: 'Enter', modifiers: {}, repeat: 1 })
    expect(observed).toEqual([13, 13])
    expect(send).toHaveBeenCalledTimes(1)

    send.mockClear()
    actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e1', value: '你好', submit: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('clicks a nearby send control when the composer prevents Enter without submitting', () => {
    setPage(`
      <div class="ch-chat-input">
        <textarea aria-label="输入"></textarea>
        <button type="button" aria-label="发送"></button>
      </div>
    `)
    const page = readVisiblePage()
    const textarea = document.querySelector('textarea')!
    const send = document.querySelector('button')!
    const sendClick = vi.fn()
    send.addEventListener('click', sendClick)
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault()
    })

    actOnPage({
      kind: 'press-page-key',
      pageId: page.pageId,
      ref: 'e1',
      key: 'Enter',
      modifiers: {},
      repeat: 1,
    })
    expect(sendClick).toHaveBeenCalledTimes(1)
  })

  it('clicks referenced controls and selects native options by value or visible text', () => {
    setPage(`
      <button aria-label="搜索按钮">搜索</button>
      <label for="sort">排序</label>
      <select id="sort"><option value="top">热门</option><option value="live">最新</option></select>
    `)
    const page = readVisiblePage()
    const button = document.querySelector('button')!
    const select = document.querySelector('select')!
    const click = vi.fn()
    const change = vi.fn()
    button.addEventListener('click', click)
    select.addEventListener('change', change)

    expect(actOnPage({ kind: 'click-page-element', pageId: page.pageId, ref: 'e2' }))
      .toEqual({ pageId: page.pageId, ref: 'e2', action: 'clicked' })
    expect(actOnPage({ kind: 'select-page-option', pageId: page.pageId, ref: 'e1', value: '最新' }))
      .toEqual({ pageId: page.pageId, ref: 'e1', action: 'selected', value: 'live' })
    expect(click).toHaveBeenCalledTimes(1)
    expect(select.value).toBe('live')
    expect(change).toHaveBeenCalledTimes(1)
  })

  it('rejects stale references, disabled controls, and secret or non-editable targets', () => {
    setPage(`
      <input aria-label="名称">
      <button disabled>提交</button>
      <input type="password" aria-label="密码" value="secret">
    `)
    const page = readVisiblePage()

    expect(() => actOnPage({ kind: 'click-page-element', pageId: '00000000-0000-4000-8000-000000000000', ref: 'e2' }))
      .toThrow(/BROWSER_PAGE_STALE/)
    expect(() => actOnPage({ kind: 'click-page-element', pageId: page.pageId, ref: 'e2' }))
      .toThrow(/BROWSER_ELEMENT_DISABLED/)
    expect(() => actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e2', value: 'x', submit: false }))
      .toThrow(/BROWSER_ELEMENT_NOT_EDITABLE/)
    expect(() => actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e99', value: 'x', submit: false }))
      .toThrow(/BROWSER_ELEMENT_NOT_FOUND/)
  })

  it('fills a textarea and a Vue-style controlled input through the native setter', () => {
    setPage(`
      <textarea aria-label="概况">旧值</textarea>
      <input id="name" aria-label="姓名" value="旧名">
    `)
    const page = readVisiblePage()
    const textarea = document.querySelector('textarea')!
    const input = document.querySelector<HTMLInputElement>('#name')!
    let vueValue = '旧名'
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => vueValue,
      set: () => undefined,
    })
    input.addEventListener('input', () => {
      vueValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(input) as string
    })

    actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e1', value: '新概况', submit: false })
    expect(textarea.value).toBe('新概况')

    actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e2', value: '新名', submit: false })
    expect(vueValue).toBe('新名')
  })

  it('scrolls the document and a container, then reports an already-at-boundary result', () => {
    setPage('<div id="box" style="overflow:auto">内容</div><input aria-label="姓名">')
    const box = document.querySelector<HTMLElement>('#box')!
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 800 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 80 })
    Object.defineProperty(box, 'scrollWidth', { configurable: true, value: 80 })
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 80 })
    let top = 0
    Object.defineProperty(box, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(720, value)) },
    })
    const page = readVisiblePage()
    const target = page.scrollTargets.find(item => item.maxTop > 0)
    expect(target).toBeDefined()

    const moved = actOnPage({ kind: 'scroll-page', pageId: page.pageId, ref: target!.ref, movement: 'page-down' })
    expect(moved).toMatchObject({ moved: true, atBoundary: false, top: 80 })

    top = 720
    const bounded = actOnPage({ kind: 'scroll-page', pageId: page.pageId, ref: target!.ref, movement: 'bottom' })
    expect(bounded).toMatchObject({ moved: false, atBoundary: true, top: 720 })

    const documentScroll = actOnPage({ kind: 'scroll-page', pageId: page.pageId, movement: 'top' })
    expect(documentScroll).toMatchObject({ pageId: page.pageId, movement: 'top', atBoundary: true })
  })

  it('focuses a field, presses allowed keys, and rejects old page ids and read-only controls', () => {
    setPage(`
      <input aria-label="姓名">
      <input aria-label="备注" readonly>
      <button>下一步</button>
    `)
    const page = readVisiblePage()
    const name = document.querySelector<HTMLInputElement>('input[aria-label="姓名"]')!
    const next = document.querySelector('button')!
    next.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault()
    })

    expect(actOnPage({ kind: 'focus-page-element', pageId: page.pageId, ref: 'e1' }))
      .toEqual({ pageId: page.pageId, ref: 'e1', action: 'focused' })
    expect(document.activeElement).toBe(name)

    expect(actOnPage({
      kind: 'press-page-key',
      pageId: page.pageId,
      ref: 'e3',
      key: 'Enter',
      modifiers: {},
      repeat: 1,
    })).toEqual({ pageId: page.pageId, ref: 'e3', action: 'pressed', key: 'Enter' })

    expect(actOnPage({
      kind: 'press-page-key',
      pageId: page.pageId,
      ref: 'e1',
      key: 'Tab',
      modifiers: {},
      repeat: 1,
    })).toMatchObject({ action: 'pressed', key: 'Tab' })
    expect(document.activeElement).not.toBe(name)

    next.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 's') event.preventDefault()
    })
    expect(actOnPage({
      kind: 'press-page-key',
      pageId: page.pageId,
      ref: 'e3',
      key: 's',
      modifiers: { ctrl: true },
      repeat: 1,
    })).toEqual({ pageId: page.pageId, ref: 'e3', action: 'pressed', key: 's' })

    expect(() => actOnPage({ kind: 'focus-page-element', pageId: '00000000-0000-4000-8000-000000000000', ref: 'e1' }))
      .toThrow(/BROWSER_PAGE_STALE/)
    expect(() => actOnPage({ kind: 'fill-page-element', pageId: page.pageId, ref: 'e2', value: 'x', submit: false }))
      .toThrow(/BROWSER_ELEMENT_NOT_EDITABLE/)
  })
})

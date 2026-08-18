// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { readVisiblePage } from '../src/extension/page-reader.ts'
import { resetDocumentIdentityForTests } from '../src/extension/page-document.ts'
import { PageWaitError, waitForPage } from '../src/extension/page-waiter.ts'

/** Replace the page body for one extraction assertion. */
function setPage(html: string): void {
  document.body.innerHTML = html
}

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(document.body, 'innerText')
  resetDocumentIdentityForTests()
})

describe('current-page extraction', () => {
  it('reads rendered text and current visible form values without password, file, or hidden controls', () => {
    setPage(`
      <main><h1>信访人信息</h1></main>
      <label for="name">姓名</label><input id="name" value="邓记测试">
      <label><input type="checkbox" value="yes" checked> 匿名</label>
      <label for="reason">信访原因</label>
      <select id="reason"><option>请选择</option><option selected>工作原因</option></select>
      <input aria-label="手机号码" value="13800000000">
      <input aria-label="密码" type="password" value="secret">
      <input aria-label="附件" type="file">
      <input aria-label="内部字段" type="hidden" value="private">
      <input aria-label="不可见字段" style="display:none" value="private">
    `)

    const page = readVisiblePage()
    expect(page.pageId).toMatch(/^[0-9a-f-]{36}$/)
    expect(page.text).toContain('信访人信息')
    expect(page.text).toContain('邓记测试')
    expect(page.text).toContain('工作原因')
    expect(page.text).not.toContain('secret')
    expect(page.text).not.toContain('private')
    expect(page.fields).toEqual([
      { ref: 'e1', label: '姓名', type: 'text', value: '邓记测试', disabled: false, readOnly: false, required: false, inViewport: true, focused: false },
      { ref: 'e2', label: '匿名', type: 'checkbox', value: 'yes', checked: true, disabled: false, readOnly: false, required: false, inViewport: true, focused: false },
      {
        ref: 'e3',
        label: '信访原因',
        type: 'select',
        value: '工作原因',
        disabled: false,
        readOnly: false,
        required: false,
        inViewport: true,
        focused: false,
        options: [
          { value: '请选择', label: '请选择', selected: false, disabled: false },
          { value: '工作原因', label: '工作原因', selected: true, disabled: false },
        ],
      },
      { ref: 'e4', label: '手机号码', type: 'text', value: '13800000000', disabled: false, readOnly: false, required: false, inViewport: true, focused: false },
    ])
    expect(page.actions).toEqual([
      { ref: 'e2', role: 'checkbox', label: '匿名', disabled: false, inViewport: true, focused: false, checked: true },
    ])
    expect(document.querySelector('#name')?.getAttribute('data-dsh-page-ref')).toBe('e1')
    expect(page.truncated).toBe(false)
  })

  it('includes textarea body text that Chrome omits from innerText', () => {
    setPage(`
      <h1>来信</h1>
      <label for="summary">概况信息</label>
      <input id="summary" value="要求明确拆迁房票结算款">
      <label for="body">信访内容</label>
      <textarea id="body">信访人姓名：邓记测试；我是一名被逼到绝境的拆迁户！${'详情'.repeat(300)}</textarea>
    `)
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      value: '来信\n概况信息\n信访内容',
    })

    const page = readVisiblePage()

    expect(page.text).toContain('信访人姓名：邓记测试')
    expect(page.text).toContain('被逼到绝境的拆迁户')
    expect(page.fields.find(field => field.type === 'textarea')?.value).toContain('信访人姓名：邓记测试')
    expect(page.fields.find(field => field.type === 'textarea')?.value.length).toBeGreaterThan(500)
  })

  it('keeps long textareas when a dense form exceeds the short-field cap', () => {
    const inputs = Array.from({ length: 81 }, (_, index) =>
      `<input aria-label="字段${String(index)}" value="短值${String(index)}">`).join('')
    setPage(`${inputs}<textarea aria-label="概况信息">信件正文应优先保留</textarea>`)

    const page = readVisiblePage()

    expect(page.fields[0]).toEqual({
      ref: 'e1',
      label: '概况信息',
      type: 'textarea',
      value: '信件正文应优先保留',
      disabled: false,
      readOnly: false,
      required: false,
      inViewport: true,
      focused: false,
    })
    expect(page.fields).toHaveLength(80)
    expect(page.text).toContain('信件正文应优先保留')
    expect(page.truncated).toBe(true)
  })

  it('bounds the complete page text and form-field collection', () => {
    const controls = Array.from({ length: 81 }, (_, index) =>
      `<input aria-label="字段${String(index)}" value="${'值'.repeat(600)}">`).join('')
    setPage(`<p>${'正文'.repeat(20_000)}</p>${controls}`)

    const page = readVisiblePage()

    expect(page.text.length).toBe(30_000)
    expect(page.fields).toHaveLength(80)
    expect(page.fields[0]).toMatchObject({ ref: 'e1', label: '字段0', type: 'text', value: '值'.repeat(500) })
    expect(page.truncated).toBe(true)
  })

  it('returns actionable references for native and ARIA controls without exposing secret controls', () => {
    setPage(`
      <input role="combobox" aria-label="搜索" value="deep">
      <div role="textbox" aria-label="备注" contenteditable="true">原始备注</div>
      <button aria-label="搜索按钮">搜索</button>
      <a href="/advanced">高级搜索</a>
      <div role="option" aria-label="最新">最新</div>
      <button disabled>不可用操作</button>
      <input type="password" aria-label="密码" value="secret">
      <input type="file" aria-label="附件">
    `)

    const page = readVisiblePage()

    expect(page.fields).toEqual([
      { ref: 'e1', label: '搜索', type: 'combobox', value: 'deep', disabled: false, readOnly: false, required: false, inViewport: true, focused: false },
      { ref: 'e2', label: '备注', type: 'textbox', value: '原始备注', disabled: false, readOnly: false, required: false, inViewport: true, focused: false },
    ])
    expect(page.actions).toEqual([
      { ref: 'e3', role: 'button', label: '搜索按钮', disabled: false, inViewport: true, focused: false },
      { ref: 'e4', role: 'link', label: '高级搜索', disabled: false, inViewport: true, focused: false, href: '/advanced' },
      { ref: 'e5', role: 'option', label: '最新', disabled: false, inViewport: true, focused: false },
      { ref: 'e6', role: 'button', label: '不可用操作', disabled: true, inViewport: true, focused: false },
    ])
    expect(page.text).not.toContain('secret')
  })

  it('does not expose a role-only textbox that the page has not made editable', () => {
    setPage('<div role="textbox" aria-label="静态说明">不可编辑正文</div>')

    const page = readVisiblePage()

    expect(page.fields).toEqual([])
  })

  it('replaces document references on every read so prior action coordinates expire', () => {
    setPage('<input aria-label="搜索"><button>提交</button>')

    const first = readVisiblePage()
    const second = readVisiblePage()

    expect(second.pageId).not.toBe(first.pageId)
    expect(second.documentId).toBe(first.documentId)
    expect(second.revision).toBe(first.revision)
    expect(second.fields[0]?.ref).toBe('e1')
    expect(second.actions[0]?.ref).toBe('e2')
    expect(document.documentElement.getAttribute('data-dsh-page-id')).toBe(second.pageId)
  })

  it('reports viewport metrics, semantic context, ARIA state, and actual scroll containers', () => {
    setPage(`
      <main aria-label="案件详情">
        <form aria-label="查询条件">
          <label for="name">姓名</label>
          <input id="name" required readonly value="邓记测试">
          <button aria-expanded="true" aria-pressed="false">更多</button>
        </form>
        <div role="dialog" aria-label="确认办理">
          <button>确定</button>
        </div>
        <div id="list" style="overflow:auto;height:80px">${'<p>行</p>'.repeat(40)}</div>
      </main>
    `)
    const list = document.querySelector<HTMLElement>('#list')!
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 800 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 80 })
    Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 200 })
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 200 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 40 })
    Object.defineProperty(list, 'scrollLeft', { configurable: true, writable: true, value: 0 })

    const page = readVisiblePage()

    expect(page.documentId).toMatch(/^[0-9a-f-]{36}$/)
    expect(page.revision).toBeGreaterThanOrEqual(0)
    expect(page.viewport.width).toBeGreaterThan(0)
    expect(page.viewport.height).toBeGreaterThan(0)
    expect(page.fields[0]).toMatchObject({
      label: '姓名',
      readOnly: true,
      required: true,
      context: '查询条件',
      inViewport: true,
    })
    expect(page.actions.find(action => action.label === '更多')).toMatchObject({
      expanded: true,
      pressed: false,
      context: '查询条件',
    })
    expect(page.actions.find(action => action.label === '确定')).toMatchObject({
      context: '确认办理',
    })
    expect(page.scrollTargets.some(target => target.label === 'list' || target.ref === list.getAttribute('data-dsh-page-ref'))).toBe(true)
    const container = page.scrollTargets.find(target => target.maxTop > 0)
    expect(container).toMatchObject({ axis: 'vertical', top: 40, maxTop: 720 })
  })

  it('reports the currently focused field and action', () => {
    setPage('<input aria-label="搜索"><button aria-expanded="true">筛选</button>')
    const input = document.querySelector<HTMLInputElement>('input')!
    input.focus()

    const focusedField = readVisiblePage()
    expect(focusedField.fields[0]).toMatchObject({ label: '搜索', focused: true })
    expect(focusedField.actions[0]).toMatchObject({ label: '筛选', focused: false, expanded: true })

    const button = document.querySelector<HTMLButtonElement>('button')!
    button.focus()
    const focusedAction = readVisiblePage()
    expect(focusedAction.fields[0]).toMatchObject({ label: '搜索', focused: false })
    expect(focusedAction.actions[0]).toMatchObject({ label: '筛选', focused: true, expanded: true })
  })

  it('excludes password, OTP, payment, and file inputs from readable fields', () => {
    setPage(`
      <input aria-label="密码" type="password" value="secret">
      <input aria-label="验证码" autocomplete="one-time-code" value="123456">
      <input aria-label="卡号" autocomplete="cc-number" value="4111111111111111">
      <input aria-label="附件" type="file">
      <input aria-label="姓名" value="公开">
    `)

    const page = readVisiblePage()
    expect(page.fields.map(field => field.label)).toEqual(['姓名'])
    expect(page.text).not.toContain('secret')
    expect(page.text).not.toContain('123456')
    expect(page.text).not.toContain('4111111111111111')
  })
})

describe('in-page wait conditions', () => {
  it('returns a fresh snapshot when the requested text is already present', async () => {
    setPage('<p>异步结果已到达</p>')
    const page = await waitForPage({
      condition: { kind: 'text', text: '异步结果已到达', state: 'present' },
      timeoutMs: 200,
      stableMs: 0,
    })
    expect(page.text).toContain('异步结果已到达')
    expect(page.pageId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('times out with the last observed document coordinates', async () => {
    setPage('<p>当前正文</p>')
    const before = readVisiblePage()
    await expect(waitForPage({
      condition: { kind: 'text', text: '永不出现', state: 'present' },
      timeoutMs: 120,
      stableMs: 0,
    })).rejects.toMatchObject({
      code: 'BROWSER_WAIT_TIMEOUT',
      documentId: before.documentId,
      revision: before.revision,
    })
    await expect(waitForPage({
      condition: { kind: 'url', value: 'https://never.example/', match: 'exact' },
      timeoutMs: 120,
      stableMs: 0,
    })).rejects.toBeInstanceOf(PageWaitError)
  })
})

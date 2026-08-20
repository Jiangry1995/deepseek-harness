import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLOSE_DIALOG_BUTTONS,
  closeBehaviorFromResponse,
  parseClosePromptChoice,
  shouldPromptOnWindowClose,
  shouldReportUnexpectedBackendExit,
} from '../src/close-behavior.js'

test('关闭对话框按钮顺序是最小化到托盘、退出、取消', () => {
  assert.deepEqual([...CLOSE_DIALOG_BUTTONS], ['最小化到托盘', '退出', '取消'])
  assert.equal(closeBehaviorFromResponse(0), 'tray')
  assert.equal(closeBehaviorFromResponse(1), 'quit')
  assert.equal(closeBehaviorFromResponse(2), 'cancel')
  assert.equal(closeBehaviorFromResponse(-1), 'cancel')
  assert.equal(parseClosePromptChoice('tray'), 'tray')
  assert.equal(parseClosePromptChoice('quit'), 'quit')
  assert.equal(parseClosePromptChoice('cancel'), 'cancel')
  assert.equal(parseClosePromptChoice('nope'), 'cancel')
})

test('主动退出或对话框已打开时不再弹出关闭询问', () => {
  assert.equal(shouldPromptOnWindowClose({ intentionalExit: false, promptOpen: false }), true)
  assert.equal(shouldPromptOnWindowClose({ intentionalExit: true, promptOpen: false }), false)
  assert.equal(shouldPromptOnWindowClose({ intentionalExit: false, promptOpen: true }), false)
})

test('主动停止后端时不把 taskkill 的 code=1 当成崩溃', () => {
  assert.equal(shouldReportUnexpectedBackendExit({
    intentionalExit: false,
    backendOwned: true,
  }), true)
  assert.equal(shouldReportUnexpectedBackendExit({
    intentionalExit: true,
    backendOwned: true,
  }), false)
  assert.equal(shouldReportUnexpectedBackendExit({
    intentionalExit: false,
    backendOwned: false,
  }), false)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CLOSE_DIALOG_BUTTONS } from '../src/close-behavior.js'
import {
  sessionIdleNotificationBody,
  sessionIdlePageTitle,
  shouldShowSessionIdleNotification,
} from '../src/session-notify.js'

test('窗口在前台可见时不发完成通知', () => {
  assert.equal(shouldShowSessionIdleNotification({ focused: true, visible: true }), false)
  assert.equal(shouldShowSessionIdleNotification({ focused: false, visible: true }), true)
  assert.equal(shouldShowSessionIdleNotification({ focused: false, visible: false }), true)
})

test('完成通知正文使用会话标题', () => {
  assert.equal(
    sessionIdleNotificationBody('资料整理 — DeepSeek Harness', 'DeepSeek Harness'),
    '资料整理 已完成',
  )
  assert.equal(sessionIdleNotificationBody('DeepSeek Harness', 'DeepSeek Harness'), '任务已完成')
  assert.equal(sessionIdlePageTitle({ title: '整理材料 — DeepSeek Harness' }, 'DeepSeek Harness'), '整理材料 — DeepSeek Harness')
  assert.equal(sessionIdlePageTitle({}, 'DeepSeek Harness'), 'DeepSeek Harness')
})

test('关闭询问页包含三个选项且不用系统对话框文案图标', () => {
  const html = readFileSync(new URL('../../resources/close-prompt.html', import.meta.url), 'utf8')
  for (const label of CLOSE_DIALOG_BUTTONS) assert.match(html, new RegExp(label))
  assert.match(html, /data-choice="tray"/)
  assert.doesNotMatch(html, /showMessageBox/)
})

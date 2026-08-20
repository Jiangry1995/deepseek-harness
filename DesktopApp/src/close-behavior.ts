/** 点窗口关闭时的三个按钮。 */
export const CLOSE_DIALOG_BUTTONS = ['最小化到托盘', '退出', '取消'] as const

/** 用户在关闭对话框里做出的选择。 */
export type CloseBehavior = 'tray' | 'quit' | 'cancel'

/** 把对话框按钮下标映射成关闭行为。未知下标视为取消，窗口保持打开。 */
export function closeBehaviorFromResponse(response: number): CloseBehavior {
  if (response === 0) return 'tray'
  if (response === 1) return 'quit'
  return 'cancel'
}

/** 把自定义关闭页回传的字符串收成关闭行为。 */
export function parseClosePromptChoice(raw: unknown): CloseBehavior {
  if (raw === 'tray' || raw === 'quit' || raw === 'cancel') return raw
  return 'cancel'
}

/** 正在主动退出或关对话框已弹出时，不再拦截窗口 close。 */
export function shouldPromptOnWindowClose(input: {
  intentionalExit: boolean
  promptOpen: boolean
}): boolean {
  return !input.intentionalExit && !input.promptOpen
}

/**
 * 只有仍归本窗口所有、且用户并未选择退出时，才把后端退出当成崩溃。
 * 主动停止会走 taskkill，Windows 上常见 code=1，不能当异常弹窗。
 */
export function shouldReportUnexpectedBackendExit(input: {
  intentionalExit: boolean
  backendOwned: boolean
}): boolean {
  return input.backendOwned && !input.intentionalExit
}

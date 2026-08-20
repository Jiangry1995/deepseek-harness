/** 会话从忙碌变为空闲时，主进程用来弹系统通知的 IPC 通道。 */
export const SESSION_IDLE_CHANNEL = 'dsh-session-idle'

/** 窗口不在前台或不在屏幕上时，才发系统通知，避免打断正在看的人。 */
export function shouldShowSessionIdleNotification(input: {
  focused: boolean
  visible: boolean
}): boolean {
  return !input.focused || !input.visible
}

/** 从页面标题里抽出会话名，拼成通知正文。 */
export function sessionIdleNotificationBody(pageTitle: string, productTitle: string): string {
  const suffix = ` — ${productTitle}`
  const session = pageTitle.endsWith(suffix) ? pageTitle.slice(0, -suffix.length).trim() : ''
  if (session === '' || session === productTitle) return '任务已完成'
  return `${session} 已完成`
}

/** 解析预加载脚本传来的完成通知载荷。 */
export function sessionIdlePageTitle(payload: unknown, fallback: string): string {
  if (payload === null || typeof payload !== 'object' || !('title' in payload)) return fallback
  const title = payload.title
  return typeof title === 'string' && title !== '' ? title : fallback
}

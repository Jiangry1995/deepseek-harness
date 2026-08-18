/**
 * Plugin-mode sidebar: no left rail. Overlay icons (历史 / 新建 / 应用设置)
 * sit on the same 48px band as the session header; the workspace browser
 * opens as a full-size drawer. Desktop SidebarRoot is unchanged — this tree
 * mounts only when the frame passes `surface: 'side-panel'`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCloseOutline16, IconNewChatOutline16, IconPanelLeftOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidePanelShell.module.css'

/** Props the side-panel chrome needs from the sidebar slot. */
export type SidePanelShellProps = Pick<
  SidebarRootComponentProps,
  'startSession' | 't' | 'renderSlot' | 'useSessions'
>

/**
 * Close the history drawer when the current session id changes (picking a
 * row in the workspace browser). Mounted only while the drawer is open so
 * the opening click itself is not treated as a change.
 */
function CloseDrawerOnSessionChange({
  useSessions,
  onClose,
}: {
  useSessions: SidePanelShellProps['useSessions']
  onClose: () => void
}) {
  const current = useSessions(state => state.current)
  const seen = useRef(current)
  useEffect(() => {
    if (seen.current === current) return
    seen.current = current
    onClose()
  }, [current, onClose])
  return null
}

/**
 * Render the side-panel chrome bar and the history drawer.
 * @param props - session start, locale, child-slot render, and the sessions hook.
 * @returns the overlay chrome tree.
 */
export function SidePanelShell({ startSession, t, renderSlot, useSessions }: SidePanelShellProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const closeHistory = useCallback(() => { setHistoryOpen(false) }, [])

  const onNewSession = useCallback(() => {
    startSession()
    setHistoryOpen(false)
  }, [startSession])

  return (
    <div className={css.shell}>
      <div className={css.chrome}>
        <Tooltip
          label={historyOpen ? t('history.close') : t('history.open')}
          side="bottom"
          delayMs={500}
        >
          <button
            type="button"
            className={css.iconButton}
            aria-label={historyOpen ? t('history.close') : t('history.open')}
            aria-expanded={historyOpen}
            aria-controls="dsh-side-panel-history"
            onClick={() => { setHistoryOpen(open => !open) }}
          >
            {historyOpen
              ? <IconCloseOutline16 size={16} />
              : <IconPanelLeftOutline16 size={16} />}
          </button>
        </Tooltip>
        {historyOpen
          ? <span className={css.chromeTitle}>{t('history.open')}</span>
          : <div className={css.chromeSpacer} />}
        {/* Same gap as header padding-end uses, so 轨迹框→+ equals +→设置. */}
        <div className={css.chromeEnd} data-chrome-end="">
          <Tooltip label={t('session.new.label')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('session.new.label')}
              onClick={onNewSession}
            >
              <IconNewChatOutline16 size={16} />
            </button>
          </Tooltip>
          <div className={css.chromeSettings}>
            {renderSlot('sidebar.settings', { wide: false })}
          </div>
        </div>
      </div>

      <div
        id="dsh-side-panel-history"
        className={css.drawer}
        hidden={!historyOpen}
        role="navigation"
        aria-label={t('history.open')}
      >
        {historyOpen && (
          <CloseDrawerOnSessionChange useSessions={useSessions} onClose={closeHistory} />
        )}
        <div className={css.regionArea}>
          {renderSlot('sidebar.workspaces', {
            wide: true,
            expandSidebar: () => {},
          })}
        </div>
        <div className={css.footArea}>
          <div className={css.footerActions}>
            {renderSlot('sidebar.footer.action', { wide: true })}
          </div>
        </div>
      </div>
    </div>
  )
}

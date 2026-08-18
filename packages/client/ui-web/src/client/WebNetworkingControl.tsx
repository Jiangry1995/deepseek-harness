import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (input.left owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WebChipInjected } from './index.ts'
import css from './WebNetworkingControl.module.css'

/** Full web-chip props: input.left runtime + injected command face + locale. */
export type WebChipProps =
  PropsRuntime<'conversation.input.left'> & InjectFace<WebChipInjected> & PropsLocale<'web'>

/**
 * Session web-networking toggle over the host-computed `webNetworking`
 * projection. Absent key (plugin not composed) renders nothing; otherwise the
 * globe chip stays visible and flips `/web` / `/web off`.
 */
export function WebChip({ useProjection, session, setWebNetworking, t }: WebChipProps) {
  const networking = useProjection('webNetworking')
  const removed = session.removed
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (networking === undefined) return null

  const enabled = networking.enabled
  const toggle = (): void => {
    if (removed || busy) return
    setBusy(true)
    setError(null)
    void setWebNetworking(!enabled).then((failure) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={`${css.trigger}${enabled ? ` ${css.triggerOn}` : ''}`}
        aria-label={enabled ? t('chip.on.aria') : t('chip.off.aria')}
        aria-pressed={enabled}
        title={enabled ? t('chip.on.title') : t('chip.off.title')}
        disabled={removed || busy}
        onClick={toggle}
      >
        <span className={css.triggerIcon} aria-hidden>
          <IconGlobeOutline14 size={14} />
        </span>
        <span className={css.triggerLabel}>Web</span>
      </button>
      {/* Failure copy stays English (error-surface policy: not localized). */}
      {error !== null && <span className={css.error} role="status" title={error}>failed to toggle web tools</span>}
    </span>
  )
}

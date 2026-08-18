/** Settings renderer for the automatic vision fallback provider. */

import { useEffect, useId, type FormEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  VisionFallbackSettingsController,
  VisionFallbackSettingsState,
} from './controller.ts'
import css from './VisionFallbackSettingsTab.module.css'

/** Registration-side state and actions supplied to the renderer. */
export interface VisionFallbackSettingsTabInjected {
  readonly controller: VisionFallbackSettingsController
  readonly useVisionFallbackSettings: SnapshotSelectorHook<VisionFallbackSettingsState>
}

/** Full props assembled by the Plugins tab renderer. */
export type VisionFallbackSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.visionFallback'>
  & InjectFace<VisionFallbackSettingsTabInjected>

/** Render the settings form and every loading, empty, error, and read-only state. */
export function VisionFallbackSettingsTab(props: VisionFallbackSettingsTabProps): ReactNode {
  const { controller, t } = props
  const state = props.useVisionFallbackSettings(snapshot => snapshot)
  const id = useId()
  const selectedProvider = state.providers.find(provider => provider.id === state.provider)
  const providerKnown = selectedProvider !== undefined
  const modelKnown = selectedProvider?.models.some(model => model.id === state.model) === true

  useEffect(() => { void controller.loadCatalog() }, [controller])

  /** Save the staged form without navigating or closing the Settings dialog. */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void controller.save()
  }

  if (state.scopeStatus === 'loading') {
    return <p className={css.status}>{t('loadingModels')}</p>
  }
  if (state.scopeStatus === 'unavailable') {
    return <p className={css.failure} role="alert">{t('unavailable')}</p>
  }

  return (
    <form className={css.section} onSubmit={submit}>
      <header className={css.header}>
        <div>
          <div className={css.titleRow}>
            <h3>{t('title')}</h3>
            <span className={state.configured ? css.enabled : css.disabled}>
              {t(state.configured ? 'enabled' : 'disabled')}
            </span>
          </div>
          <p>{t('intro')}</p>
        </div>
      </header>

      <p className={css.privacy}>{t('privacy')}</p>
      {!state.writable ? <p className={css.status}>{t('readOnly')}</p> : null}
      {state.catalogStatus === 'loading' || state.catalogStatus === 'idle'
        ? <p className={css.status}>{t('loadingModels')}</p>
        : null}
      {state.catalogStatus === 'error' ? (
        <div className={css.retryRow}>
          <p className={css.failure} role="alert">{t('modelLoadFailed')}</p>
          <button type="button" className={css.secondaryButton} onClick={() => { void controller.loadCatalog() }}>
            {t('retry')}
          </button>
        </div>
      ) : null}
      {state.catalogStatus === 'ready' && state.providers.length === 0
        ? <p className={css.empty}>{t('noVisualModels')}</p>
        : null}
      {state.failures.length > 0 ? <p className={css.warning}>{t('catalogWarnings')}</p> : null}

      <div className={css.grid}>
        <label className={css.field} htmlFor={`${id}-provider`}>
          <span>{t('provider')}</span>
          <select
            id={`${id}-provider`}
            value={state.provider}
            disabled={!state.writable || state.catalogStatus !== 'ready'}
            onChange={(event) => { controller.edit('provider', event.currentTarget.value) }}
          >
            <option value="">{t('providerPlaceholder')}</option>
            {!providerKnown && state.provider.length > 0
              ? <option value={state.provider}>{state.provider} — {t('unavailableSelection')}</option>
              : null}
            {state.providers.map(provider => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </label>
        <label className={css.field} htmlFor={`${id}-model`}>
          <span>{t('model')}</span>
          <select
            id={`${id}-model`}
            value={state.model}
            disabled={!state.writable || selectedProvider === undefined}
            onChange={(event) => { controller.edit('model', event.currentTarget.value) }}
          >
            <option value="">{t('modelPlaceholder')}</option>
            {!modelKnown && state.model.length > 0
              ? <option value={state.model}>{state.model} — {t('unavailableSelection')}</option>
              : null}
            {selectedProvider?.models.map(model => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        </label>
        <label className={css.field} htmlFor={`${id}-tokens`}>
          <span>{t('maxTokens')}</span>
          <input
            id={`${id}-tokens`}
            type="text"
            inputMode="numeric"
            value={state.maxTokens}
            disabled={!state.writable}
            onChange={(event) => { controller.edit('maxTokens', event.currentTarget.value) }}
          />
          <small>{t('maxTokensHint')}</small>
        </label>
        <label className={css.field} htmlFor={`${id}-timeout`}>
          <span>{t('timeout')}</span>
          <input
            id={`${id}-timeout`}
            type="text"
            inputMode="numeric"
            value={state.timeoutMs}
            disabled={!state.writable}
            onChange={(event) => { controller.edit('timeoutMs', event.currentTarget.value) }}
          />
          <small>{t('timeoutHint')}</small>
        </label>
      </div>

      <label className={css.field} htmlFor={`${id}-prompt`}>
        <span>{t('prompt')}</span>
        <textarea
          id={`${id}-prompt`}
          rows={5}
          value={state.prompt}
          disabled={!state.writable}
          onChange={(event) => { controller.edit('prompt', event.currentTarget.value) }}
        />
        <small>{t('promptHint')}</small>
      </label>

      {state.invalid ? <p className={css.failure} role="alert">{t('invalid')}</p> : null}
      {state.saveFailed ? <p className={css.failure} role="alert">{t('saveFailed')}</p> : null}
      <footer className={css.actions}>
        <button
          type="button"
          className={css.secondaryButton}
          disabled={!state.dirty || state.saving}
          onClick={() => { controller.discard() }}
        >
          {t('discard')}
        </button>
        <button
          type="submit"
          className={css.primaryButton}
          disabled={!state.writable || !state.dirty || state.invalid || state.saving}
        >
          {t(state.saving ? 'saving' : 'save')}
        </button>
      </footer>
    </form>
  )
}

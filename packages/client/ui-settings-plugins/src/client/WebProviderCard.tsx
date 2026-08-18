/**
 * A third-party web provider's card (Tavily, Firecrawl): its endpoint, the
 * credential reference it resolves, and the key — written through the
 * credentials domain, never into the settings section, so the literal never
 * rides a response. The display copy arrives through the injected face, so
 * this one component renders every provider card of this shape.
 */

import { useState } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import css from './PluginCard.module.css'
import type { WebProviderCardFace } from './web-provider-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for a web-provider card. */
export type WebProviderCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebProviderCardFace>

/** Transient connectivity-probe outcome shown beside the test control. */
type ProbeUi =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; message: string }
  | { kind: 'failed'; message: string }

/**
 * Render the web-provider card.
 * @param props - locale copy, the card snapshot, its form actions, and its display keys.
 * @returns the card.
 */
export function WebProviderCard(props: WebProviderCardProps) {
  const { t } = props
  const state = props.useWebProviderCard(snapshot => snapshot)
  const disabled = !state.writable
  const [probe, setProbe] = useState<ProbeUi>({ kind: 'idle' })
  const canTest = state.apiKeyConfigured && !state.saving && probe.kind !== 'running'

  /**
   * Ask the Host to run a one-result search through this provider's saved config.
   */
  async function runProbe(): Promise<void> {
    if (!canTest) return
    setProbe({ kind: 'running' })
    const result = await props.probeSearch()
    if (result.ok) {
      setProbe({ kind: 'ok', message: t('webProviderTestOk') })
      return
    }
    setProbe({ kind: 'failed', message: result.message || t('webProviderTestFailed') })
  }

  return (
    <PluginCard
      t={t}
      titleKey={props.display.titleKey}
      descriptionKey={props.display.descriptionKey}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
      footerStart={(
        <>
          <button
            type="button"
            className={css.test}
            disabled={!canTest}
            title={state.apiKeyConfigured ? undefined : t('webProviderTestNeedKey')}
            onClick={() => { void runProbe() }}
          >
            {t(probe.kind === 'running' ? 'webProviderTesting' : 'webProviderTest')}
          </button>
          {probe.kind === 'ok' || probe.kind === 'failed'
            ? (
              <p
                className={clsx(
                  css.probeStatus,
                  probe.kind === 'ok' ? css.probeOk : css.probeFailed,
                )}
                role="status"
              >
                {probe.message}
              </p>
            )
            : null}
        </>
      )}
    >
      <SecretField
        id="plugin-config-web-provider-key"
        label={t('webSearchApiKey')}
        hint={t('webSearchApiKeyHint')}
        showLabel={t('webSearchApiKeyShow')}
        hideLabel={t('webSearchApiKeyHide')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('webSearchApiKeySet') : t('webSearchApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-web-provider-key-ref"
        label={t('webProviderApiKeyEnv')}
        hint={t('webProviderApiKeyEnvHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.apiKeyEnv}
        onEdit={(text) => { props.edit('apiKeyEnv', text) }}
        onReset={() => { props.resetField('apiKeyEnv') }}
      />
      <ValueField
        id="plugin-config-web-provider-endpoint"
        label={t('webSearchBaseUrl')}
        hint={t('webSearchBaseUrlHint')}
        placeholder={props.display.defaultBaseURL}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
    </PluginCard>
  )
}

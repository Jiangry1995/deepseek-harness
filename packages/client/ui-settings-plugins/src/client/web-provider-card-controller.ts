/**
 * Generic staged form for third-party web-provider cards (Tavily, Firecrawl):
 * one settings namespace per provider, editing the credential reference,
 * the endpoint, and the key — which is written through the credentials
 * domain, never into the settings section, so the literal never rides a
 * response. The display copy is part of the face so one component and one
 * controller serve every provider card of this shape.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'

/** Credential field the key control stages under. */
const API_KEY_FIELD = 'apiKey'

/** Namespace of the Tavily search provider. Spelled here rather than imported: a client package must not depend on a Host package. */
export const WEB_SEARCH_TAVILY_NS = 'web-search-tavily'

/** Namespace of the Firecrawl search/scrape providers. */
export const WEB_SEARCH_FIRECRAWL_NS = 'web-search-firecrawl'

/** Outcome of a Host-side connectivity probe. */
export type WebProviderProbeResult =
  | { ok: true; sourceCount: number }
  | { ok: false; message: string }

/** The provider fields this card edits. */
export interface WebProviderSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/** What the card renders. */
export interface WebProviderCardState extends CardShell {
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Credential reference naming the environment key. */
  apiKeyEnv: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the card's slot entry injects. */
export interface WebProviderCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebProviderCard. */
    webProviderCard: SnapshotStore<WebProviderCardState>
  }
  /** Locale keys naming the provider and what its settings govern. */
  display: {
    titleKey: PluginsSettingsLocaleKey
    descriptionKey: PluginsSettingsLocaleKey
    /** Default endpoint shown as the blank-field placeholder. */
    defaultBaseURL: string
  }
  /**
   * Ask the Host to verify this provider can search with its currently
   * saved credentials and endpoint.
   */
  probeSearch: () => Promise<WebProviderProbeResult>
}

/** Bridges one provider's settings scope and the credentials domain onto a card. */
export class WebProviderCardController {
  private readonly form: CardForm<WebProviderSettings>
  private readonly store: SnapshotStore<WebProviderCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the provider's namespace.
   * @param api - wire face used for credentials and connectivity probes.
   * @param defaultApiKeyRef - the reference used when the section names none.
   * @param providerId - registry id passed to `web.probeSearch` (`tavily`, `firecrawl`).
   * @param display - locale keys naming the provider on its card.
   */
  constructor(
    private readonly scope: SettingsScope<WebProviderSettings>,
    private readonly api: Pick<IApiClient, 'credentials' | 'web'>,
    private readonly defaultApiKeyRef: string,
    private readonly providerId: string,
    private readonly display: WebProviderCardFace['display'],
  ) {
    this.form = new CardForm(
      scope,
      [textField('apiKeyEnv'), textField('baseURL')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): WebProviderCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      apiKeyEnv: this.form.field('apiKeyEnv'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently
   * names. A response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot(), this.defaultApiKeyRef)
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      // The card stays usable without this: the key control simply reports
      // the last state it knew, and a write still reaches the Host.
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot(), this.defaultApiKeyRef)) return
    const view = response.result.value.credentials[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Ask the Host to run a minimal search through this provider's saved config.
   * @returns pass/fail for the settings card status line.
   */
  async probeSearch(): Promise<WebProviderProbeResult> {
    let response: Awaited<ReturnType<IApiClient['web']['probeSearch']>>
    try {
      response = await this.api.web.probeSearch({ providerId: this.providerId })
    } catch (error: unknown) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    if (!response.result.ok) {
      return { ok: false, message: response.result.error.message }
    }
    return { ok: true, sourceCount: response.result.value.sourceCount }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot, its form actions, and its display copy.
   */
  inject(): WebProviderCardFace {
    return {
      hooks: { webProviderCard: this.store },
      display: this.display,
      probeSearch: () => this.probeSearch(),
      ...this.form.actions(),
    }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    let response: Awaited<ReturnType<IApiClient['credentials']['set']>>
    try {
      response = await this.api.credentials.set({
        ref: refOf(this.scope.getSnapshot(), this.defaultApiKeyRef),
        value,
      })
    } catch (_credentialWriteFailure) {
      return false
    }
    if (!response.result.ok) return false
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @param defaultRef - the reference used when the section names none.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<WebProviderSettings>, defaultRef: string): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : defaultRef
}

/** Staged settings and visual-model catalog controller for the Vision tab. */

import type { IApiClient, ModelCatalogFailure, ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client'
import {
  createSnapshotStore,
  type SettingsScope,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Host settings section owned by `@deepseek-ai/dsh-llm-vision-fallback`. */
export interface VisionFallbackSettings {
  provider?: string
  model?: string
  maxTokens?: number
  timeoutMs?: number
  prompt?: string
}

/** One provider whose catalog contains at least one explicit visual model. */
export interface VisualProviderOption {
  readonly id: string
  readonly name: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
}

/** Complete settings-tab snapshot. */
export interface VisionFallbackSettingsState {
  readonly scopeStatus: 'loading' | 'ready' | 'unavailable'
  readonly catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  readonly writable: boolean
  readonly provider: string
  readonly model: string
  readonly maxTokens: string
  readonly timeoutMs: string
  readonly prompt: string
  readonly providers: readonly VisualProviderOption[]
  readonly failures: readonly ModelCatalogFailure[]
  readonly configured: boolean
  readonly dirty: boolean
  readonly invalid: boolean
  readonly saving: boolean
  readonly saveFailed: boolean
}

type EditableField = 'provider' | 'model' | 'maxTokens' | 'timeoutMs' | 'prompt'
type Drafts = Record<EditableField, string>

const EMPTY_DRAFTS: Drafts = {
  provider: '',
  model: '',
  maxTokens: '',
  timeoutMs: '',
  prompt: '',
}

/** Keep only exact models whose adapter declares native image input. */
function visualProviders(groups: readonly ModelProviderGroup[]): VisualProviderOption[] {
  return groups.flatMap((group) => {
    const models = group.models
      .filter(model => model.inputModalities?.includes('image') === true)
      .map(model => ({ id: model.id, name: model.name }))
    return models.length === 0 ? [] : [{ id: group.id, name: group.name, models }]
  })
}

/** Render one effective section as editable strings. */
function draftsOf(settings: VisionFallbackSettings | undefined): Drafts {
  return {
    provider: settings?.provider ?? '',
    model: settings?.model ?? '',
    maxTokens: settings?.maxTokens === undefined ? '' : String(settings.maxTokens),
    timeoutMs: settings?.timeoutMs === undefined ? '' : String(settings.timeoutMs),
    prompt: settings?.prompt ?? '',
  }
}

/** Parse one positive integer draft within its configured inclusive range. */
function boundedInteger(text: string, min: number, max: number): number | undefined {
  const value = Number(text)
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined
}

/** Controller that separates settings/catalog I/O from the React renderer. */
export class VisionFallbackSettingsController {
  /** Reactive renderer snapshot published after scope, catalog, or draft changes. */
  readonly store: SnapshotStore<VisionFallbackSettingsState>
  private drafts: Drafts = { ...EMPTY_DRAFTS }
  private seeded: Drafts = { ...EMPTY_DRAFTS }
  private readonly dirtyFields = new Set<EditableField>()
  private catalogStatus: VisionFallbackSettingsState['catalogStatus'] = 'idle'
  private providers: readonly VisualProviderOption[] = []
  private failures: readonly ModelCatalogFailure[] = []
  private saving = false
  private saveFailed = false

  /** Bind one settings namespace and the Host model catalog. */
  constructor(
    private readonly scope: SettingsScope<VisionFallbackSettings>,
    private readonly api: Pick<IApiClient, 'llm'>,
  ) {
    this.seedFromScope()
    this.store = createSnapshotStore(this.snapshot())
    scope.subscribe(() => {
      if (!this.saving && this.dirtyFields.size === 0) this.seedFromScope()
      this.publish()
    })
  }

  /** Fetch the registered model catalog once the tab is mounted. */
  async loadCatalog(): Promise<void> {
    if (this.catalogStatus === 'loading') return
    this.catalogStatus = 'loading'
    this.publish()
    try {
      const response = await this.api.llm.models({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.providers = visualProviders(response.result.value.groups)
      this.failures = response.result.value.failures
      this.catalogStatus = 'ready'
    } catch (_catalogFailure) {
      this.catalogStatus = 'error'
    }
    this.publish()
  }

  /** Refetch a catalog that the mounted tab has already requested. */
  refreshCatalogIfLoaded(): void {
    if (this.catalogStatus === 'idle') return
    this.catalogStatus = 'idle'
    void this.loadCatalog()
  }

  /**
   * Stage one field and keep provider/model selection internally consistent.
   * @param field - settings field whose browser draft changes.
   * @param value - exact draft text from the control.
   */
  edit(field: EditableField, value: string): void {
    this.drafts = { ...this.drafts, [field]: value }
    this.updateDirty(field)
    if (field === 'provider' && value !== this.seeded.provider) {
      this.drafts.model = ''
      this.updateDirty('model')
    }
    this.saveFailed = false
    this.publish()
  }

  /** Drop every staged edit and restore the current Host snapshot. */
  discard(): void {
    this.dirtyFields.clear()
    this.saveFailed = false
    this.seedFromScope()
    this.publish()
  }

  /** Persist the valid staged fields through revision-fenced settings mutations. */
  async save(): Promise<void> {
    const state = this.snapshot()
    if (!state.writable || !state.dirty || state.invalid || this.saving) return
    this.saving = true
    this.saveFailed = false
    this.publish()
    try {
      for (const field of this.dirtyFields) await this.writeField(field)
      this.dirtyFields.clear()
      this.seedFromScope()
    } catch (_writeFailure) {
      this.saveFailed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  /** Build the immutable renderer snapshot. */
  private snapshot(): VisionFallbackSettingsState {
    const scope = this.scope.getSnapshot()
    const provider = this.drafts.provider.trim()
    const model = this.drafts.model.trim()
    const routeComplete = provider.length > 0 && model.length > 0
    const routeEmpty = provider.length === 0 && model.length === 0
    return {
      scopeStatus: scope.status,
      catalogStatus: this.catalogStatus,
      writable: scope.status === 'ready' && scope.writable,
      ...this.drafts,
      providers: this.providers,
      failures: this.failures,
      configured: routeComplete,
      dirty: this.dirtyFields.size > 0,
      invalid: (!routeComplete && !routeEmpty)
        || boundedInteger(this.drafts.maxTokens, 1, 32_768) === undefined
        || boundedInteger(this.drafts.timeoutMs, 1_000, 300_000) === undefined
        || this.drafts.prompt.trim().length === 0,
      saving: this.saving,
      saveFailed: this.saveFailed,
    }
  }

  /** Re-seed drafts after the Host publishes an accepted section. */
  private seedFromScope(): void {
    const next = draftsOf(this.scope.getSnapshot().value)
    this.seeded = next
    this.drafts = { ...next }
  }

  /** Update whether one draft differs from the effective Host value. */
  private updateDirty(field: EditableField): void {
    if (this.drafts[field] === this.seeded[field]) this.dirtyFields.delete(field)
    else this.dirtyFields.add(field)
  }

  /** Write or clear one staged field using the Host settings namespace. */
  private async writeField(field: EditableField): Promise<void> {
    const text = this.drafts[field].trim()
    if (field === 'provider' || field === 'model') {
      if (text.length === 0) {
        await this.scope.unset(field)
        if (this.userLayerHas(field)) throw new Error(`settings did not clear ${field}`)
      } else {
        await this.scope.set(field, text)
        if (this.userLayerValue(field) !== text) throw new Error(`settings did not store ${field}`)
      }
      return
    }
    if (field === 'prompt') {
      await this.scope.set(field, text)
      if (this.userLayerValue(field) !== text) throw new Error(`settings did not store ${field}`)
      return
    }
    const value = boundedInteger(text, field === 'timeoutMs' ? 1_000 : 1, field === 'timeoutMs' ? 300_000 : 32_768)
    if (value === undefined) throw new Error(`invalid ${field}`)
    await this.scope.set(field, value)
    if (this.userLayerValue(field) !== value) throw new Error(`settings did not store ${field}`)
  }

  /** Whether the current raw user layer owns one field. */
  private userLayerHas(field: EditableField): boolean {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null && Object.hasOwn(user, field)
  }

  /** Read one field from the current raw user layer. */
  private userLayerValue(field: EditableField): unknown {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null
      ? (user as Record<string, unknown>)[field]
      : undefined
  }

  /** Publish the current projection to every React subscriber. */
  private publish(): void {
    this.store.set(this.snapshot())
  }
}

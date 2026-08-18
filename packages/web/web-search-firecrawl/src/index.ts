/**
 * Register Firecrawl-backed providers in `ctx.web`: a search provider over
 * `POST /v1/search` and a fetch (scrape) provider over `POST /v1/scrape`.
 * Both register under the id `firecrawl` — the seam keeps search and fetch
 * registries separate, so one id names one provider per capability kind.
 * A function/namespace plugin (NOT a default-export service), exactly as
 * `@deepseek-ai/dsh-web-search-exa`.
 * @module @deepseek-ai/dsh-web-search-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
} from './provider.ts'
import type { FirecrawlProviderOptions } from './provider.ts'

export {
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_PROVIDER_ID,
  firecrawlSearchItems,
  mapFirecrawlSearchItem,
  mapFirecrawlSearchResponse,
} from './provider.ts'
export type { FirecrawlProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-firecrawl'

/** The web seam these providers register into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'FIRECRAWL_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Firecrawl API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each operation; defaults to `FIRECRAWL_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/v1/search` and `/v1/scrape` are appended. */
  baseURL?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
})

/** Environment variable naming this provider's endpoint. */
const BASE_URL_ENV = 'FIRECRAWL_BASE_URL'

/** Settings namespace carrying this provider's endpoint and key reference. */
export const WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE = settingsNamespace('web-search-firecrawl')

/**
 * Project one resolved section into the options both providers serve their
 * next operation with. Environment fallbacks stay here rather than in the
 * providers: every value they read is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one operation.
 */
function resolveOptions(ctx: Context, config: Config): FirecrawlProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? FIRECRAWL_DEFAULT_BASE_URL,
  }
}

/** Register the Firecrawl search and fetch providers with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registrations carry no resolved value: the providers project the
    // section per operation, so a committed change needs no re-registration.
    onChange: () => {},
  })
  const options = () => resolveOptions(ctx, current())
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider(options))
  ctx.web.registerFetchProvider(new FirecrawlFetchProvider(options))
}

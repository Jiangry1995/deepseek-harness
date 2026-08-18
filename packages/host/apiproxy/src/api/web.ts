/**
 * web domain contract: configuration-surface probes against registered web
 * search providers. Credentials stay on the Host; the client only learns
 * whether a named provider answered a minimal search.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Web-domain unary methods (the map keys web.* of RpcMethodMap). */
export interface WebApi {
  /**
   * Run a one-result search through a registered provider id to verify that
   * the currently resolved credentials and endpoint can talk to the service.
   * Draft form fields that have not been saved are not applied — the Host
   * uses whatever the provider already resolves.
   */
  probeSearch(
    request: RpcRequest<{ providerId: string }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ providerId: string; sourceCount: number }>>
}

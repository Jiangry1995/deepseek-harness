/**
 * web domain zod schemas (names derived from map keys: webProbeSearchRequestSchema /
 * webProbeSearchValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** web.probeSearch request payload. */
export const webProbeSearchRequestSchema = z.object({
  providerId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'web.probeSearch'>>>

/** web.probeSearch response value. */
export const webProbeSearchValueSchema = z.object({
  providerId: z.string().min(1),
  sourceCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<ResponseValue<'web.probeSearch'>>>

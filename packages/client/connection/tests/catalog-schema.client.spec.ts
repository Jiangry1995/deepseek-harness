/**
 * The browser parse of `llm.models` lives in this package's tsdown artifact.
 * A stale bundle that omits `inputModalities` strips the field (zod object
 * default) and the Automatic vision tab then reports every visual model as
 * unavailable even when Host sent `['text', 'image']`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('connection client catalog schema', () => {
  it('retains inputModalities on model catalog rows', () => {
    const bundle = readFileSync(resolve('packages/client/connection/lib/client.js'), 'utf8')
    expect(bundle).toMatch(/inputModalities:\s*array\(_enum\(\["text", "image"\]\)\)\.optional\(\)/)
  })
})

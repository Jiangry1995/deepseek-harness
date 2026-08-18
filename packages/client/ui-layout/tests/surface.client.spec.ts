import { describe, expect, it } from 'vitest'
import { readClientSurface } from '@deepseek-ai/dsh-client-ui-layout/src/client/surface.ts'

describe('readClientSurface', () => {
  it('selects the side panel only for the exact query value', () => {
    expect(readClientSurface('?dsh-surface=side-panel')).toBe('side-panel')
    expect(readClientSurface('dsh-surface=side-panel')).toBe('side-panel')
    expect(readClientSurface('?dsh-surface=side-panel&x=1')).toBe('side-panel')
  })

  it('keeps the desktop shell for missing or other values', () => {
    expect(readClientSurface('')).toBe('desktop')
    expect(readClientSurface('?foo=1')).toBe('desktop')
    expect(readClientSurface('?dsh-surface=desktop')).toBe('desktop')
    expect(readClientSurface('?dsh-surface=sidepanel')).toBe('desktop')
  })
})

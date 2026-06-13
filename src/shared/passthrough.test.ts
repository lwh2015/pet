import { describe, it, expect } from 'vitest'
import { resolveIgnoreMouse } from './passthrough'
import { PASSTHROUGH_MODES, type PassthroughMode } from './types'

describe('resolveIgnoreMouse', () => {
  describe("mode 'locked-interactive'", () => {
    it('returns false (never ignore) when cursor is over interactive', () => {
      expect(resolveIgnoreMouse('locked-interactive', true)).toBe(false)
    })
    it('returns false (never ignore) when cursor is NOT over interactive', () => {
      expect(resolveIgnoreMouse('locked-interactive', false)).toBe(false)
    })
  })

  describe("mode 'locked-passthrough'", () => {
    it('returns true (always ignore) when cursor is over interactive', () => {
      expect(resolveIgnoreMouse('locked-passthrough', true)).toBe(true)
    })
    it('returns true (always ignore) when cursor is NOT over interactive', () => {
      expect(resolveIgnoreMouse('locked-passthrough', false)).toBe(true)
    })
  })

  describe("mode 'auto'", () => {
    it('returns false (interactive) when cursor IS over interactive', () => {
      expect(resolveIgnoreMouse('auto', true)).toBe(false)
    })
    it('returns true (click-through) when cursor is NOT over interactive', () => {
      expect(resolveIgnoreMouse('auto', false)).toBe(true)
    })
  })

  it('covers every PassthroughMode literal without throwing', () => {
    for (const mode of PASSTHROUGH_MODES) {
      const m: PassthroughMode = mode
      expect(typeof resolveIgnoreMouse(m, true)).toBe('boolean')
      expect(typeof resolveIgnoreMouse(m, false)).toBe('boolean')
    }
  })
})

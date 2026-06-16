// src/renderer/src/pet/pixi/metal.test.ts
import { describe, it, expect } from 'vitest'
import { sheenAlpha } from './metal'

describe('sheenAlpha', () => {
  it('oscillates within [0.45, 0.7] over time', () => {
    const samples = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4].map((t) => sheenAlpha(t))
    for (const a of samples) {
      expect(a).toBeGreaterThanOrEqual(0.45 - 1e-9)
      expect(a).toBeLessThanOrEqual(0.7 + 1e-9)
    }
  })
})

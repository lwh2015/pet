// src/renderer/src/pet/pixi/eyeMath.test.ts
import { describe, it, expect } from 'vitest'
import { pupilOffset } from './eyeMath'

describe('pupilOffset', () => {
  it('returns zero when cursor is exactly at the eye center', () => {
    expect(pupilOffset(0, 0, 6.5)).toEqual({ x: 0, y: 0 })
  })

  it('clamps travel to maxTravel when the cursor is far away', () => {
    const o = pupilOffset(1000, 0, 6.5)
    expect(o.x).toBeCloseTo(6.5, 5)
    expect(o.y).toBeCloseTo(0, 5)
  })

  it('eases (less than max) when the cursor is near, within the gain radius', () => {
    // gain default 220; dist 110 -> half of maxTravel
    const o = pupilOffset(110, 0, 6.5)
    expect(o.x).toBeCloseTo(3.25, 5)
    expect(o.y).toBeCloseTo(0, 5)
  })

  it('keeps the offset magnitude <= maxTravel on a diagonal', () => {
    const o = pupilOffset(300, 400, 6.5) // dist 500 > gain -> clamped
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(6.5, 5)
    expect(o.y).toBeGreaterThan(o.x) // points more downward than rightward
  })
})

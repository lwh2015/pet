// src/shared/cursorTransform.test.ts
import { describe, it, expect } from 'vitest'
import { toWindowLocal } from './cursorTransform'

describe('toWindowLocal', () => {
  it('subtracts the window top-left from the global cursor point', () => {
    expect(toWindowLocal({ x: 500, y: 300 }, { x: 100, y: 50, width: 200, height: 210 })).toEqual({
      x: 400,
      y: 250
    })
  })

  it('yields negatives when the cursor is left/above the window', () => {
    expect(toWindowLocal({ x: 10, y: 5 }, { x: 100, y: 50, width: 200, height: 210 })).toEqual({
      x: -90,
      y: -45
    })
  })
})

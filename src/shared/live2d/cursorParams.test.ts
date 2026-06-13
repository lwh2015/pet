import { describe, it, expect } from 'vitest'
import {
  normalizeCursorOffset,
  cursorToParams,
  DEFAULT_CURSOR_CONFIG,
  type CursorOffset
} from './cursorParams'

const RECT = { left: 100, top: 50, width: 400, height: 300 }

describe('normalizeCursorOffset', () => {
  it('returns center (0,0) for a degenerate zero-size rect (no divide-by-zero)', () => {
    const o = normalizeCursorOffset({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 })
    // `=== 0` treats -0 and +0 as equal; the negated zero-axis can yield a
    // harmless -0. What matters: no NaN/Infinity from the divide-by-zero guard.
    expect(o.x === 0).toBe(true)
    expect(o.y === 0).toBe(true)
  })

  it('maps the rect center to (0,0)', () => {
    const o = normalizeCursorOffset({ x: 100 + 200, y: 50 + 150 }, RECT)
    expect(o.x).toBeCloseTo(0, 6)
    expect(o.y).toBeCloseTo(0, 6)
  })

  it('maps the right edge to x=+1 and left edge to x=-1', () => {
    expect(normalizeCursorOffset({ x: 500, y: 200 }, RECT).x).toBeCloseTo(1, 6)
    expect(normalizeCursorOffset({ x: 100, y: 200 }, RECT).x).toBeCloseTo(-1, 6)
  })

  it('negates Y so the TOP edge is +1 and the BOTTOM edge is -1 (y points up)', () => {
    expect(normalizeCursorOffset({ x: 300, y: 50 }, RECT).y).toBeCloseTo(1, 6)
    expect(normalizeCursorOffset({ x: 300, y: 350 }, RECT).y).toBeCloseTo(-1, 6)
  })

  it('clamps points outside the rect to [-1,1]', () => {
    const o = normalizeCursorOffset({ x: 9999, y: -9999 }, RECT)
    expect(o.x).toBe(1)
    expect(o.y).toBe(1) // above the top -> +1 after negation
    const o2 = normalizeCursorOffset({ x: -9999, y: 9999 }, RECT)
    expect(o2.x).toBe(-1)
    expect(o2.y).toBe(-1)
  })
})

describe('DEFAULT_CURSOR_CONFIG', () => {
  it('uses the contract scale defaults (angle 30, eye 1, body 10)', () => {
    expect(DEFAULT_CURSOR_CONFIG.angleScale).toBe(30)
    expect(DEFAULT_CURSOR_CONFIG.eyeScale).toBe(1)
    expect(DEFAULT_CURSOR_CONFIG.bodyScale).toBe(10)
  })
})

describe('cursorToParams', () => {
  it('maps a center offset (0,0) to all zeros', () => {
    const p = cursorToParams({ x: 0, y: 0 })
    expect(p).toEqual({ angleX: 0, angleY: 0, eyeX: 0, eyeY: 0, bodyAngleX: 0 })
  })

  it('scales each param by the default config at the +1/+1 corner', () => {
    const p = cursorToParams({ x: 1, y: 1 })
    expect(p.angleX).toBe(30)
    expect(p.angleY).toBe(30)
    expect(p.eyeX).toBe(1)
    expect(p.eyeY).toBe(1)
    expect(p.bodyAngleX).toBe(10)
  })

  it('preserves sign at the -1/-1 corner', () => {
    const p = cursorToParams({ x: -1, y: -1 })
    expect(p.angleX).toBe(-30)
    expect(p.angleY).toBe(-30)
    expect(p.eyeX).toBe(-1)
    expect(p.eyeY).toBe(-1)
    expect(p.bodyAngleX).toBe(-10)
  })

  it('clamps an out-of-range offset before scaling', () => {
    const wild: CursorOffset = { x: 5, y: -5 }
    const p = cursorToParams(wild)
    expect(p.angleX).toBe(30)
    expect(p.angleY).toBe(-30)
    expect(p.eyeX).toBe(1)
    expect(p.eyeY).toBe(-1)
    expect(p.bodyAngleX).toBe(10)
  })

  it('honors a custom config', () => {
    const p = cursorToParams({ x: 0.5, y: -0.5 }, { angleScale: 20, eyeScale: 0.8, bodyScale: 6 })
    expect(p.angleX).toBe(10)
    expect(p.angleY).toBe(-10)
    expect(p.eyeX).toBe(0.4)
    expect(p.eyeY).toBe(-0.4)
    expect(p.bodyAngleX).toBe(3)
  })
})

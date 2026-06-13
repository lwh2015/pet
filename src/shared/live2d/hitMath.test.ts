import { describe, it, expect } from 'vitest'
import { clientToGlPixel, isHit, DEFAULT_ALPHA_THRESHOLD, type GlHitInput } from './hitMath'

// A 400x300 CSS rect rendered at DPR 2 => 800x600 drawing buffer.
const baseRect = { left: 0, top: 0, width: 400, height: 300 }
const W = 800
const H = 600

function input(clientX: number, clientY: number, over: Partial<GlHitInput> = {}): GlHitInput {
  return {
    clientX,
    clientY,
    rect: baseRect,
    canvasPixelWidth: W,
    canvasPixelHeight: H,
    ...over
  }
}

describe('clientToGlPixel — scaling', () => {
  it('scales CSS px to device px by canvasPixel/rect (DPR 2 => x2)', () => {
    // CSS (10,20) within the rect at origin -> device (20,40)
    const p = clientToGlPixel(input(10, 20))
    expect(p.gx).toBe(20)
    // Y is flipped: gy = H-1 - floor(20*2) = 599 - 40 = 559
    expect(p.gy).toBe(H - 1 - 40)
    expect(p.inBounds).toBe(true)
  })

  it('accounts for a non-zero rect offset (left/top)', () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 }
    // client (110,60) -> cssX=10, cssY=10 -> device (20,20)
    const p = clientToGlPixel(input(110, 60, { rect }))
    expect(p.gx).toBe(20)
    expect(p.gy).toBe(H - 1 - 20)
    expect(p.inBounds).toBe(true)
  })
})

describe('clientToGlPixel — Y-flip', () => {
  it('maps the TOP-LEFT client corner to GL top-left (gy = H-1)', () => {
    const p = clientToGlPixel(input(0, 0))
    expect(p.gx).toBe(0)
    expect(p.gy).toBe(H - 1)
    expect(p.inBounds).toBe(true)
  })

  it('maps near the BOTTOM-LEFT client corner to GL bottom-left (gy = 0)', () => {
    // clientY just inside the bottom edge: cssY=299.9 -> device floor(599.8)=599 -> gy=0
    const p = clientToGlPixel(input(0, 299.9))
    expect(p.gx).toBe(0)
    expect(p.gy).toBe(0)
    expect(p.inBounds).toBe(true)
  })
})

describe('clientToGlPixel — bounds & clamp', () => {
  it('flags out-of-bounds to the LEFT/ABOVE as inBounds:false but clamps gx/gy to valid range', () => {
    const p = clientToGlPixel(input(-50, -50))
    expect(p.inBounds).toBe(false)
    expect(p.gx).toBeGreaterThanOrEqual(0)
    expect(p.gx).toBeLessThan(W)
    expect(p.gy).toBeGreaterThanOrEqual(0)
    expect(p.gy).toBeLessThan(H)
  })

  it('flags out-of-bounds to the RIGHT/BELOW as inBounds:false and clamps to max index', () => {
    const p = clientToGlPixel(input(10000, 10000))
    expect(p.inBounds).toBe(false)
    expect(p.gx).toBe(W - 1)
    // far below -> device y huge -> gy clamped to 0 after flip
    expect(p.gy).toBe(0)
  })

  it('treats the exact right/bottom edge (cssX===width) as out of bounds (half-open)', () => {
    const p = clientToGlPixel(input(400, 0)) // cssX=400 == width -> device 800 == W -> out
    expect(p.inBounds).toBe(false)
    expect(p.gx).toBe(W - 1)
  })

  it('keeps the clamped gx/gy readable (0 <= gx < W, 0 <= gy < H) for any input', () => {
    for (const [cx, cy] of [
      [-1, -1],
      [0, 0],
      [399, 299],
      [1e6, 1e6]
    ] as const) {
      const p = clientToGlPixel(input(cx, cy))
      expect(p.gx).toBeGreaterThanOrEqual(0)
      expect(p.gx).toBeLessThan(W)
      expect(p.gy).toBeGreaterThanOrEqual(0)
      expect(p.gy).toBeLessThan(H)
    }
  })
})

describe('isHit + DEFAULT_ALPHA_THRESHOLD', () => {
  it('exports the threshold as 10', () => {
    expect(DEFAULT_ALPHA_THRESHOLD).toBe(10)
  })

  it('returns false at and below the default threshold (alpha > threshold)', () => {
    expect(isHit(0)).toBe(false)
    expect(isHit(10)).toBe(false) // boundary: 10 is NOT > 10
  })

  it('returns true just above the default threshold', () => {
    expect(isHit(11)).toBe(true)
    expect(isHit(255)).toBe(true)
  })

  it('honors a custom threshold', () => {
    expect(isHit(5, 0)).toBe(true)
    expect(isHit(0, 0)).toBe(false)
    expect(isHit(200, 250)).toBe(false)
  })
})

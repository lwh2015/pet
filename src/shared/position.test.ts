import { describe, it, expect } from 'vitest'
import { clampPositionToDisplays, pickDisplayForPosition } from './position'
import type { DisplayBounds, PetPosition } from './types'

// Primary display: 1920x1080 at origin (workArea height 1040 leaves a taskbar).
const primary: DisplayBounds = {
  id: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
}
// Secondary display to the right: 1280x1024 starting at x=1920.
const secondary: DisplayBounds = {
  id: 2,
  workArea: { x: 1920, y: 0, width: 1280, height: 1024 }
}

const pos = (x: number, y: number, width = 300, height = 300): PetPosition => ({
  x,
  y,
  width,
  height
})

describe('pickDisplayForPosition', () => {
  it('picks the display the window mostly overlaps', () => {
    const p = pos(2000, 100) // fully inside secondary
    expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(2)
  })

  it('picks the display with the larger overlap when straddling two', () => {
    // window x=1820..2120 (width 300): 100px on primary, 200px on secondary
    const p = pos(1820, 100)
    expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(2)
  })

  it('falls back to displays[0] when there is zero overlap', () => {
    const p = pos(5000, 5000) // off all displays
    expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(1)
  })

  it('resolves a tie to displays[0]', () => {
    // x=1770..2070 width 300: 150px on primary, 150px on secondary -> tie -> displays[0]
    const p = pos(1770, 100)
    expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(1)
  })

  it('throws when displays is empty', () => {
    expect(() => pickDisplayForPosition(pos(0, 0), [])).toThrow()
  })
})

describe('clampPositionToDisplays', () => {
  it('throws when displays is empty', () => {
    expect(() => clampPositionToDisplays(pos(0, 0), [])).toThrow()
  })

  it('leaves a fully on-screen position unchanged', () => {
    const p = pos(100, 100)
    expect(clampPositionToDisplays(p, [primary])).toEqual(p)
  })

  it('clamps a window hanging off the right edge back inside', () => {
    // x=1800 width 300 -> right edge 2100 > 1920; clamp x to 1920-300 = 1620
    const result = clampPositionToDisplays(pos(1800, 100), [primary])
    expect(result.x).toBe(1620)
    expect(result.y).toBe(100)
    expect(result.width).toBe(300)
    expect(result.height).toBe(300)
  })

  it('clamps a window hanging off the left edge to workArea.x', () => {
    const result = clampPositionToDisplays(pos(-50, 100), [primary])
    expect(result.x).toBe(0)
  })

  it('clamps a window hanging off the top edge to workArea.y', () => {
    const result = clampPositionToDisplays(pos(100, -80), [primary])
    expect(result.y).toBe(0)
  })

  it('clamps a window hanging off the bottom edge back inside', () => {
    // y=900 height 300 -> bottom 1200 > 1040; clamp y to 1040-300 = 740
    const result = clampPositionToDisplays(pos(100, 900), [primary])
    expect(result.y).toBe(740)
  })

  it('re-homes an off-screen window onto displays[0] (monitor removed)', () => {
    // Saved on a now-removed monitor at x=2500; only primary remains.
    const result = clampPositionToDisplays(pos(2500, 100), [primary])
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.x).toBeLessThanOrEqual(1920 - 300)
    expect(result.y).toBe(100)
  })

  it('clamps onto the chosen secondary display in a multi-display setup', () => {
    // mostly on secondary but hanging off its right edge
    const result = clampPositionToDisplays(pos(3100, 100), [primary, secondary])
    // secondary right limit: 1920 + 1280 - 300 = 2900
    expect(result.x).toBe(2900)
    expect(result.y).toBe(100)
  })

  it('shrinks width to fit when it exceeds the chosen workArea', () => {
    const result = clampPositionToDisplays(pos(0, 0, 5000, 300), [primary])
    expect(result.width).toBe(1920)
    expect(result.x).toBe(0)
  })

  it('shrinks height to fit when it exceeds the chosen workArea', () => {
    const result = clampPositionToDisplays(pos(0, 0, 300, 5000), [primary])
    expect(result.height).toBe(1040)
    expect(result.y).toBe(0)
  })

  it('re-homes onto displays[0] when overlapping none of several displays', () => {
    // pos(5000, 5000) overlaps neither display -> deliberate fallback to
    // displays[0] (primary). Pin current behavior: result lands within primary.
    const result = clampPositionToDisplays(pos(5000, 5000), [primary, secondary])
    const wa = primary.workArea
    expect(result.x).toBeGreaterThanOrEqual(wa.x)
    expect(result.x + result.width).toBeLessThanOrEqual(wa.x + wa.width)
    expect(result.y).toBeGreaterThanOrEqual(wa.y)
    expect(result.y + result.height).toBeLessThanOrEqual(wa.y + wa.height)
  })
})

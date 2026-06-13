import { describe, it, expect } from 'vitest'
import { clampPositionToDisplays } from './position'
import type { PetPosition, DisplayBounds } from './types'

// Synthetic single primary display: 1920x1080, taskbar 40px at bottom.
const PRIMARY: DisplayBounds = {
  id: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
}

// Synthetic secondary display to the right: 1280x1024, full work area.
const SECONDARY: DisplayBounds = {
  id: 2,
  workArea: { x: 1920, y: 0, width: 1280, height: 1024 }
}

const SIZE = { width: 300, height: 300 }

describe('clampPositionToDisplays — restore-on-launch path', () => {
  it('leaves a fully on-screen saved position unchanged', () => {
    const saved: PetPosition = { x: 200, y: 200, ...SIZE }
    const out = clampPositionToDisplays(saved, [PRIMARY])
    expect(out).toEqual({ x: 200, y: 200, width: 300, height: 300 })
  })

  it('pulls a position that is off the RIGHT edge back on-screen', () => {
    const saved: PetPosition = { x: 5000, y: 100, ...SIZE }
    const out = clampPositionToDisplays(saved, [PRIMARY])
    // max x = workArea.x + workArea.width - width = 0 + 1920 - 300 = 1620
    expect(out.x).toBe(1620)
    expect(out.y).toBe(100)
    expect(out.width).toBe(300)
    expect(out.height).toBe(300)
  })

  it('pulls a position that is off the LEFT edge back on-screen', () => {
    const saved: PetPosition = { x: -500, y: 100, ...SIZE }
    const out = clampPositionToDisplays(saved, [PRIMARY])
    // min x = workArea.x = 0
    expect(out.x).toBe(0)
    expect(out.y).toBe(100)
  })

  it('pulls a position that is off the TOP edge back on-screen', () => {
    const saved: PetPosition = { x: 100, y: -500, ...SIZE }
    const out = clampPositionToDisplays(saved, [PRIMARY])
    expect(out.x).toBe(100)
    expect(out.y).toBe(0)
  })

  it('pulls a position off the BOTTOM (under taskbar) into the work area', () => {
    const saved: PetPosition = { x: 100, y: 5000, ...SIZE }
    const out = clampPositionToDisplays(saved, [PRIMARY])
    // max y = workArea.y + workArea.height - height = 0 + 1040 - 300 = 740
    expect(out.y).toBe(740)
    expect(out.x).toBe(100)
  })

  it('falls back to the primary (displays[0]) when the saved monitor was unplugged', () => {
    // Saved deep on the secondary monitor, but only PRIMARY is connected now.
    const saved: PetPosition = { x: 2400, y: 500, ...SIZE }
    const out = clampPositionToDisplays(saved, [PRIMARY])
    // No overlap with PRIMARY => clamp into PRIMARY's work area.
    expect(out.x).toBe(1620) // 1920 - 300
    expect(out.y).toBe(500)
  })

  it('keeps a position that lives on the secondary display on that display', () => {
    const saved: PetPosition = { x: 2000, y: 100, ...SIZE }
    const out = clampPositionToDisplays(saved, [PRIMARY, SECONDARY])
    // Overlaps SECONDARY (x:1920..3200); within its work area already.
    expect(out.x).toBe(2000)
    expect(out.y).toBe(100)
  })

  it('shrinks a window larger than the work area to fit', () => {
    const saved: PetPosition = { x: 0, y: 0, width: 5000, height: 5000 }
    const out = clampPositionToDisplays(saved, [PRIMARY])
    expect(out.width).toBe(1920)
    expect(out.height).toBe(1040)
    expect(out.x).toBe(0)
    expect(out.y).toBe(0)
  })

  it('throws when no displays are provided', () => {
    const saved: PetPosition = { x: 0, y: 0, ...SIZE }
    expect(() => clampPositionToDisplays(saved, [])).toThrow()
  })
})

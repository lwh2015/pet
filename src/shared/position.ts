// ============================================================================
// src/shared/position.ts
// Pure geometry: clamp a pet window into connected display work areas.
// ELECTRON-FREE. Takes DisplayBounds[] as plain data.
// ============================================================================
import type { DisplayBounds, PetPosition } from './types'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Area of the rectangular intersection of two rects (0 if disjoint). */
function overlapArea(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const top = Math.max(a.y, b.y)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const w = right - left
  const h = bottom - top
  if (w <= 0 || h <= 0) return 0
  return w * h
}

/**
 * Returns the DisplayBounds whose workArea has the largest rectangular overlap
 * with pos. Ties and zero-overlap resolve to displays[0]. Throws if displays is
 * empty. Pure.
 */
export function pickDisplayForPosition(pos: PetPosition, displays: DisplayBounds[]): DisplayBounds {
  if (displays.length === 0) {
    throw new Error('pickDisplayForPosition: displays must not be empty')
  }
  // Deliberate fallback: best/bestArea seed from displays[0], so when the saved
  // position overlaps NO display (every overlapArea is 0, never > bestArea of 0)
  // we return displays[0]. We do NOT switch to nearest-by-distance — that is out
  // of scope for this plan; clamping into displays[0] is the intended re-home.
  let best = displays[0]
  let bestArea = overlapArea(pos, displays[0].workArea)
  for (let i = 1; i < displays.length; i++) {
    const area = overlapArea(pos, displays[i].workArea)
    if (area > bestArea) {
      best = displays[i]
      bestArea = area
    }
  }
  return best
}

/**
 * Returns a PetPosition guaranteed fully visible within the workArea of one
 * connected display. Picks the most-overlapping display (displays[0] if none
 * overlap), shrinks width/height to fit if they exceed the workArea, then
 * clamps x/y so the whole window sits inside. Throws if displays is empty.
 * Pure.
 */
export function clampPositionToDisplays(pos: PetPosition, displays: DisplayBounds[]): PetPosition {
  if (displays.length === 0) {
    throw new Error('clampPositionToDisplays: displays must not be empty')
  }

  const wa = pickDisplayForPosition(pos, displays).workArea

  const width = Math.min(pos.width, wa.width)
  const height = Math.min(pos.height, wa.height)

  const maxX = wa.x + wa.width - width
  const maxY = wa.y + wa.height - height

  const x = Math.min(Math.max(pos.x, wa.x), maxX)
  const y = Math.min(Math.max(pos.y, wa.y), maxY)

  return { x, y, width, height }
}

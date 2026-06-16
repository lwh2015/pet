// src/shared/cursorTransform.ts
// Pure geometry: global screen cursor -> pet-window-local coordinates.
// ELECTRON-FREE.
export interface Point {
  x: number
  y: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Cursor point relative to the window's top-left corner. */
export function toWindowLocal(cursor: Point, bounds: Bounds): Point {
  return { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
}

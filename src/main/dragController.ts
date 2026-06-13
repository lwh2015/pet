// ============================================================================
// src/main/dragController.ts
// Manual-drag glue for the transparent pet window. Coexists with mouse
// passthrough (we deliberately avoid -webkit-app-region: drag — see plan note).
// On drag-end the new bounds are clamped into connected displays and the
// position is debounce-persisted to settings via the injected persistPosition
// sink. The controller never broadcasts itself; persist+broadcast policy lives
// in the sink (see ipc.ts), so flushPersist() at quit time stays safe.
// ============================================================================
import { screen, type BrowserWindow } from 'electron'
import { clampPositionToDisplays } from '@shared/position'
import { debounce } from '@shared/debounce'
import type { PetPosition } from '@shared/types'
import { readDisplayBounds } from './displays'

/** Persist debounce window (ms) — coalesces the end-of-drag write. */
const PERSIST_DEBOUNCE_MS = 400

export interface DragController {
  onStart(): void
  onMove(): void
  onEnd(): void
  /** Flush any pending debounced persist (e.g. before quit). */
  flushPersist(): void
}

/**
 * Creates the manual-drag controller.
 * @param getWindow       returns the live pet BrowserWindow (or null).
 * @param persistPosition called with the final clamped PetPosition to save.
 */
export function createDragController(
  getWindow: () => BrowserWindow | null,
  persistPosition: (pos: PetPosition) => void
): DragController {
  // Fixed cursor->window offset captured at drag-start; null when not dragging.
  let offset: { dx: number; dy: number } | null = null

  const debouncedPersist = debounce((pos: PetPosition) => {
    persistPosition(pos)
  }, PERSIST_DEBOUNCE_MS)

  const onStart = (): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    offset = { dx: cursor.x - wx, dy: cursor.y - wy }
  }

  const onMove = (): void => {
    if (!offset) return
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    win.setPosition(cursor.x - offset.dx, cursor.y - offset.dy)
  }

  const onEnd = (): void => {
    // Gate on an in-progress gesture: a stray drag-end with no preceding
    // drag-start (offset === null) must not clamp or schedule a persist.
    const wasDragging = offset !== null
    offset = null
    if (!wasDragging) return
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    const [width, height] = win.getSize()
    const clamped = clampPositionToDisplays(
      { x, y, width, height },
      readDisplayBounds()
    )
    if (clamped.x !== x || clamped.y !== y) {
      win.setPosition(clamped.x, clamped.y)
    }
    debouncedPersist(clamped)
  }

  const flushPersist = (): void => {
    debouncedPersist.flush()
  }

  return { onStart, onMove, onEnd, flushPersist }
}

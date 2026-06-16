// src/main/cursorTracker.ts
// Polls the global cursor and pushes pet-window-local coordinates to the
// renderer ONLY while the pet window is visible. All side-effecting deps are
// injected so the tick logic is unit-testable without electron.
import { toWindowLocal, type Point, type Bounds } from '@shared/cursorTransform'

interface TrackableWindow {
  isVisible(): boolean
  isDestroyed(): boolean
  getBounds(): Bounds
}

export interface CursorTrackerDeps {
  getPetWindow: () => TrackableWindow | null
  getCursorScreenPoint: () => Point
  send: (local: Point) => void
  intervalMs?: number
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void
}

export interface CursorTracker {
  start(): void
  stop(): void
}

export function createCursorTracker(deps: CursorTrackerDeps): CursorTracker {
  const intervalMs = deps.intervalMs ?? 16
  const setI = deps.setIntervalFn ?? setInterval
  const clearI = deps.clearIntervalFn ?? clearInterval
  let handle: ReturnType<typeof setInterval> | null = null
  let last: Point | null = null

  function tick(): void {
    const win = deps.getPetWindow()
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const local = toWindowLocal(deps.getCursorScreenPoint(), win.getBounds())
    if (last && last.x === local.x && last.y === local.y) return
    last = local
    deps.send(local)
  }

  return {
    start(): void {
      if (handle === null) handle = setI(tick, intervalMs)
    },
    stop(): void {
      if (handle !== null) {
        clearI(handle)
        handle = null
      }
    }
  }
}

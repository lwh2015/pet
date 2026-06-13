// ============================================================================
// src/main/displayWatcher.ts
// Re-clamps the pet window into connected displays when the display
// configuration changes (monitor unplugged / resolution / workArea change),
// so a previously valid position can't end up off-screen. Uses the SAME pure
// clampPositionToDisplays as launch-restore and drag-end.
// ============================================================================
import { screen, type BrowserWindow, type Display, type Event } from 'electron'
import { clampPositionToDisplays } from '@shared/position'
import { readDisplayBounds } from './displays'

function reclamp(getWindow: () => BrowserWindow | null): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  const [width, height] = win.getSize()
  const clamped = clampPositionToDisplays({ x, y, width, height }, readDisplayBounds())
  if (clamped.x !== x || clamped.y !== y || clamped.width !== width || clamped.height !== height) {
    win.setBounds({
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height
    })
  }
}

/**
 * Subscribes to display changes and re-clamps the pet window.
 * Canonical name + signature per integration contract §2:
 * startDisplayWatcher(getWindow) returning a disposer.
 * 6.4's bootstrap calls startDisplayWatcher(getPetWindow).
 * Must be called AFTER app.whenReady(). Returns a disposer.
 */
export function startDisplayWatcher(getWindow: () => BrowserWindow | null): () => void {
  const onRemoved = (): void => reclamp(getWindow)
  const onMetrics = (_event: Event, _display: Display, changedMetrics: string[]): void => {
    if (changedMetrics.includes('bounds') || changedMetrics.includes('workArea')) {
      reclamp(getWindow)
    }
  }

  screen.on('display-removed', onRemoved)
  screen.on('display-metrics-changed', onMetrics)

  return () => {
    screen.removeListener('display-removed', onRemoved)
    screen.removeListener('display-metrics-changed', onMetrics)
  }
}

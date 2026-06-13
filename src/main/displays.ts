// ============================================================================
// src/main/displays.ts
// Single source of truth for mapping connected Electron displays to plain
// DisplayBounds, PRIMARY FIRST. Used by every position-clamp call site
// (createPetWindow, restorePetPosition, dragController.onEnd,
// displayWatcher.reclamp) so a fully off-screen position — which
// clampPositionToDisplays re-homes to displays[0] — consistently lands on the
// PRIMARY display rather than on getAllDisplays()[0] (which varies by call).
// Touches the `screen` module, so must only be called AFTER app.whenReady().
// ============================================================================
import { screen } from 'electron'
import type { DisplayBounds } from '@shared/types'

/**
 * Map connected Electron displays to plain DisplayBounds, primary first.
 * Primary is placed at index 0 so clampPositionToDisplays' off-screen fallback
 * (displays[0]) re-homes to the primary display.
 */
export function readDisplayBounds(): DisplayBounds[] {
  const primary = screen.getPrimaryDisplay()
  const all = screen.getAllDisplays()
  // Ensure the primary display is first (clampPositionToDisplays falls back to
  // displays[0] when nothing overlaps).
  const ordered = [primary, ...all.filter((d) => d.id !== primary.id)]
  return ordered.map((d) => ({
    id: d.id,
    workArea: {
      x: d.workArea.x,
      y: d.workArea.y,
      width: d.workArea.width,
      height: d.workArea.height
    }
  }))
}

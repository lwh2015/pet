// ============================================================================
// src/main/passthrough.ts
// PassthroughController: thin electron wrapper around resolveIgnoreMouse.
// Holds current PassthroughMode + overInteractive flag; applies the result
// via win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined).
// ============================================================================
import type { BrowserWindow } from 'electron'
import { type PassthroughMode } from '@shared/types'
import { resolveIgnoreMouse } from '@shared/passthrough'

export interface PassthroughController {
  setMode(mode: PassthroughMode): void
  setOverInteractive(over: boolean): void
  apply(): void
  reset(): void
  getMode(): PassthroughMode
}

export function createPassthroughController(
  getWindow: () => BrowserWindow | null
): PassthroughController {
  let mode: PassthroughMode = 'auto'
  let overInteractive = false
  // Mirror of the last applied `ignore` so we only call the native API on a
  // real state change (R4 pitfall: toggling every frame causes flicker / lost
  // clicks). `undefined` forces the first apply() to always push to the window.
  let lastIgnore: boolean | undefined = undefined

  function apply(): void {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    const ignore = resolveIgnoreMouse(mode, overInteractive)
    if (ignore === lastIgnore) return
    lastIgnore = ignore
    // forward only matters (and is only allowed to matter) when ignore===true.
    win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
  }

  return {
    setMode(next: PassthroughMode): void {
      mode = next
      apply()
    },
    setOverInteractive(over: boolean): void {
      overInteractive = over
      apply()
    },
    apply,
    reset(): void {
      // Tray "reset interaction": force not-over and re-apply.
      overInteractive = false
      apply()
    },
    getMode(): PassthroughMode {
      return mode
    }
  }
}

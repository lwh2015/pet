// ============================================================================
// src/shared/passthrough.ts
// Pure passthrough state machine. ELECTRON-FREE, no side effects.
// ============================================================================
import type { PassthroughMode } from './types'

/**
 * Decide the `ignore` boolean to feed
 * win.setIgnoreMouseEvents(ignore, { forward: true }).
 *
 *  - 'locked-interactive' -> false : window always interactive, never click-through.
 *  - 'locked-passthrough' -> true  : window always click-through (ignores the pet).
 *  - 'auto'               -> ignore = !overInteractive : interactive only when the
 *                            cursor is over a solid pet pixel / interactive UI.
 *
 * Pure: no electron, no I/O, no mutation.
 */
export function resolveIgnoreMouse(
  mode: PassthroughMode,
  overInteractive: boolean
): boolean {
  switch (mode) {
    case 'locked-interactive':
      return false
    case 'locked-passthrough':
      return true
    case 'auto':
      return !overInteractive
    default: {
      // Exhaustiveness guard: if PassthroughMode gains a member this errors at
      // compile time. At runtime fall back to the safest interactive state.
      const _exhaustive: never = mode
      void _exhaustive
      return false
    }
  }
}

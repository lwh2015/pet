import { useEffect, useRef } from 'react'
import type { PassthroughMode } from '@shared/types'
import { isPetDragging } from './dragState'

const LEAVE_DEBOUNCE_MS = 120

/**
 * Dependencies injected by PetApp. `isOverInteractive` is the alpha-silhouette
 * hit-test: given a client (CSS) point it returns true when the cursor is over
 * an opaque pixel of the pet. PetApp supplies the AlphaHitTester's `isOverModel`
 * once the Live2D model is ready, and a `() => false` fallback before ready / on
 * model-load error (fully click-through over the placeholder). This replaces
 * Plan 1's DOM `e.target` check; the hook's observable contract is unchanged.
 */
export interface UsePassthroughDeps {
  isOverInteractive: (clientX: number, clientY: number) => boolean
}

/**
 * Runs the passthrough hit-test loop. Reports enter/leave to main via
 * window.petApi.setInteractive ONLY when the boolean state changes. While the
 * passthrough mode is a manual lock (not 'auto') reporting is suspended,
 * because main ignores hit-test input in those modes anyway (resolveIgnoreMouse
 * gates it) — suspending avoids churn.
 *
 * The hit-test itself is injected via `deps.isOverInteractive(clientX, clientY)`
 * (alpha sampling of the canvas), so the pure DPR/Y-flip/threshold math lives in
 * @shared/live2d/hitMath and the gl read lives in the alphaHitTester glue — this
 * hook only orchestrates the enter/leave/debounce/suspend state machine.
 */
export function usePassthrough(deps: UsePassthroughDeps): void {
  // Mirror of last-reported interactivity so we never re-send the same value.
  const lastReported = useRef<boolean | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeRef = useRef<PassthroughMode>('auto')

  // Hold the latest deps in a ref so the mousemove effect can stay keyed [] and
  // never re-subscribe when PetApp swaps the hit-tester (e.g. fallback -> ready).
  // The ref is updated in an effect (NOT the render body) because
  // react-hooks/refs forbids mutating ref.current during render; a passive
  // effect flushes long before the next user mousemove, so the swap still takes
  // effect on the very next move.
  const depsRef = useRef<UsePassthroughDeps>(deps)
  useEffect(() => {
    depsRef.current = deps
  }, [deps])

  useEffect(() => {
    function report(interactive: boolean): void {
      if (lastReported.current === interactive) return
      lastReported.current = interactive
      window.petApi.setInteractive(interactive)
    }

    function clearLeaveTimer(): void {
      if (leaveTimer.current !== null) {
        clearTimeout(leaveTimer.current)
        leaveTimer.current = null
      }
    }

    function onMouseMove(e: MouseEvent): void {
      // Skip the hit-test entirely while a drag gesture is in progress: PetApp
      // has pinned the window interactive for the whole drag, and a passthrough
      // flip mid-drag would forward mousemove but NOT mouseup, stranding it.
      // Skipping here also avoids a per-move gl.readPixels GPU stall mid-drag.
      if (isPetDragging()) return

      // Suspend hit-test reporting under a manual lock mode.
      if (modeRef.current !== 'auto') return

      const over = depsRef.current.isOverInteractive(e.clientX, e.clientY)
      if (over) {
        // Enter is immediate; cancel any pending leave.
        clearLeaveTimer()
        report(true)
      } else if (leaveTimer.current === null) {
        // Debounce the leave so an anti-aliased edge doesn't chatter (R4).
        leaveTimer.current = setTimeout(() => {
          leaveTimer.current = null
          report(false)
        }, LEAVE_DEBOUNCE_MS)
      }
    }

    const unsubscribeMode = window.petApi.onPassthroughModeChanged(({ mode }) => {
      modeRef.current = mode
      if (mode !== 'auto') {
        // Entering a lock mode: cancel any pending leave; main owns state now.
        clearLeaveTimer()
        lastReported.current = null
      }
    })

    window.addEventListener('mousemove', onMouseMove)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      clearLeaveTimer()
      unsubscribeMode()
    }
  }, [])
}

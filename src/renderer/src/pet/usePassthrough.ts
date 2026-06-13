import { useEffect, useRef } from 'react'
import type { PassthroughMode } from '@shared/types'
import { isPetDragging } from './dragState'

/**
 * Cheap DOM hit-test: pointer-events:none is set on every decorative layer,
 * so the only elements that can become the mousemove target are interactive
 * ones (.pet-body and real UI). The <html> element is the exception that is
 * still targetable over empty space (R4), so target === documentElement means
 * "over transparent background" -> not interactive.
 */
function isOverInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target === document.documentElement) return false
  if (target === document.body) return false
  return true
}

const LEAVE_DEBOUNCE_MS = 120

/**
 * Runs the passthrough hit-test loop. Reports enter/leave to main via
 * window.petApi.setInteractive ONLY when the boolean state changes. While the
 * passthrough mode is a manual lock (not 'auto') reporting is suspended,
 * because main ignores hit-test input in those modes anyway (resolveIgnoreMouse
 * gates it) — suspending avoids churn.
 */
export function usePassthrough(): void {
  // Mirror of last-reported interactivity so we never re-send the same value.
  const lastReported = useRef<boolean | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeRef = useRef<PassthroughMode>('auto')

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
      if (isPetDragging()) return

      // Suspend hit-test reporting under a manual lock mode.
      if (modeRef.current !== 'auto') return

      const over = isOverInteractive(e.target)
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

    const unsubscribeMode = window.petApi.onPassthroughModeChanged(
      ({ mode }) => {
        modeRef.current = mode
        if (mode !== 'auto') {
          // Entering a lock mode: cancel any pending leave; main owns state now.
          clearLeaveTimer()
          lastReported.current = null
        }
      }
    )

    window.addEventListener('mousemove', onMouseMove)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      clearLeaveTimer()
      unsubscribeMode()
    }
  }, [])
}

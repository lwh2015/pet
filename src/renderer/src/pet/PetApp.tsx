// src/renderer/src/pet/PetApp.tsx
// Pet root component. Composes the Plan-2 Live2D stack:
//   - renders <Live2DStage>, which owns the WebGL canvas, loads the model,
//     builds the ActionController + AlphaHitTester, and (on load failure)
//     renders <PlaceholderPet/> as the fallback. The ready handles are
//     captured into refs here so the rest of PetApp can use them.
//   - usePassthrough(deps): the alpha-silhouette hit-test loop. We inject
//     isOverInteractive = hitTester.isOverModel so the window flips between
//     interactive (over the pet) and click-through (transparent areas).
//   - manual drag/tap gesture, gated on the alpha hit-test: a mousedown over
//     the model that crosses the drag threshold drives window.petApi.drag.*;
//     a mousedown over the model with no drag is a TAP -> playAction('react').
//     A mousedown over a transparent area is ignored (passes through).
//   - HTML5 drag-to-feed: while a file is dragged over the pet it looks toward
//     the file and holds a "hungry" expression; on drop it shows a "satisfied"
//     expression + a reaction motion, then ingests the file(s) into the vault.
//     Paths are resolved per-File via window.petApi.getPathForFile (a FileList
//     does NOT survive the contextBridge) then sent to window.petApi.ingestPaths.
//
// CROSS-GROUP COUPLING: onMouseDown sits on .pet-root (pointer-events:none in
// the sibling-group pet.css). The press lands on the descendant
// <canvas className="pet-canvas"> (pointer-events:auto, also sibling-group)
// and bubbles up to this handler. If .pet-canvas loses pointer-events:auto or
// stops being a descendant of .pet-root, mousedown silently never fires.
import React, { useCallback, useEffect, useRef } from 'react'
import { usePassthrough } from './usePassthrough'
import { setPetDragging } from './dragState'
import { Live2DStage } from './live2d/Live2DStage'
import type { ActionController } from './live2d/actionController'
import type { AlphaHitTester } from './live2d/alphaHitTester'
import './pet.css'

const DRAG_THRESHOLD = 4
// Min interval between real alpha samples. usePassthrough calls isOverInteractive
// on EVERY mousemove and isOverModel does a gl.readPixels (a GPU->CPU sync stall);
// the cursor can't cross the silhouette boundary meaningfully within this window,
// so we cache the last boolean and resample at most once per HIT_TEST_THROTTLE_MS.
const HIT_TEST_THROTTLE_MS = 32
// Drag-to-feed facial cues (Haru expressions f00..f07). Swap these two indices
// if a different face reads better as "hungry" / "satisfied".
const FEED_HUNGRY_EXPRESSION = 'f04'
const FEED_SATISFIED_EXPRESSION = 'f03'
// How long the satisfied face is held after a feed before reverting to neutral.
const FEED_SATISFIED_HOLD_MS = 2500
// Debounce for the spurious dragleave events that fire on internal boundaries.
const DRAG_LEAVE_DEBOUNCE_MS = 120

export function PetApp(): React.JSX.Element {
  // Live2DStage hands these up once the model is ready (null on error/dispose).
  const controllerRef = useRef<ActionController | null>(null)
  const hitTesterRef = useRef<AlphaHitTester | null>(null)

  // Time-throttle + cache for the alpha hit-test. We read the GPU at most once
  // per HIT_TEST_THROTTLE_MS and return the cached boolean in between, so a
  // per-mousemove gl.readPixels stall never happens. Reset to a guaranteed-stale
  // timestamp so the very first call always samples.
  const lastSampleAt = useRef(0)
  const lastOver = useRef(false)

  // Tracks the active gesture: anchor screen coords + whether it crossed the
  // click-vs-drag threshold. null when no button is held / the down was not
  // over the model (a transparent-area press passes through and is ignored).
  const dragState = useRef<{ x: number; y: number; dragging: boolean } | null>(null)

  const handleReady = useCallback(
    (handles: { controller: ActionController; hitTester: AlphaHitTester } | null): void => {
      controllerRef.current = handles?.controller ?? null
      hitTesterRef.current = handles?.hitTester ?? null
    },
    []
  )

  // Throttled+cached alpha hit-test injected into the passthrough loop. Reads
  // through hitTesterRef so a disposed controller (ref nulled on onReady(null))
  // is never called: a null tester resets the cache to false (fully
  // click-through), the simple decisive Plan-2 default before the model is ready.
  const isOverInteractive = useCallback((x: number, y: number): boolean => {
    const tester = hitTesterRef.current
    if (!tester) {
      lastOver.current = false
      return false
    }
    const now = Date.now()
    if (now - lastSampleAt.current >= HIT_TEST_THROTTLE_MS) {
      lastSampleAt.current = now
      lastOver.current = tester.isOverModel(x, y)
    }
    return lastOver.current
  }, [])

  // Inject the throttled alpha hit-test into the passthrough loop.
  usePassthrough({ isOverInteractive })

  const handlePetMouseDown = useCallback((e: React.MouseEvent): void => {
    if (e.button !== 0) return // left button only
    // Gate on the alpha hit-test: a press over a transparent area must pass
    // through (Plan-1 behavior = do nothing). Only start a gesture over the pet.
    // Read through the ref so a disposed/absent hit-tester no-ops.
    if (!hitTesterRef.current?.isOverModel(e.clientX, e.clientY)) return
    dragState.current = { x: e.screenX, y: e.screenY, dragging: false }
    // Pin the window interactive for the WHOLE gesture so the auto-mode
    // hit-test can't flip it to click-through and steal the upcoming mouseup.
    setPetDragging(true)
    window.petApi.setInteractive(true)
    window.petApi.drag.start()
  }, [])

  useEffect(() => {
    const handleMove = (e: MouseEvent): void => {
      const s = dragState.current
      if (!s) return
      if (!s.dragging && Math.hypot(e.screenX - s.x, e.screenY - s.y) > DRAG_THRESHOLD) {
        s.dragging = true
      }
      if (s.dragging) {
        window.petApi.drag.move()
      }
    }
    const handleUp = (): void => {
      const s = dragState.current
      if (!s) return
      window.petApi.drag.end()
      const wasTap = !s.dragging
      dragState.current = null
      // Release the interactive pin; usePassthrough resumes hit-testing and
      // re-applies the correct interactive/passthrough state on next move.
      setPetDragging(false)
      // A press over the pet that never crossed the drag threshold is a TAP
      // -> generic reaction. Read through the ref (controller is null before the
      // model is ready / after dispose), so a disposed controller is never called.
      if (wasTap) {
        controllerRef.current?.playAction('react')
      }
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  useEffect(() => {
    // craving = the pet is currently showing the "hungry" face for a hovering
    // drag. leaveTimer debounces dragleave (it also fires on internal
    // boundaries); satisfiedTimer reverts the post-feed "satisfied" face.
    let craving = false
    let leaveTimer: ReturnType<typeof setTimeout> | null = null
    let satisfiedTimer: ReturnType<typeof setTimeout> | null = null

    const clearLeave = (): void => {
      if (leaveTimer !== null) {
        clearTimeout(leaveTimer)
        leaveTimer = null
      }
    }
    const clearSatisfied = (): void => {
      if (satisfiedTimer !== null) {
        clearTimeout(satisfiedTimer)
        satisfiedTimer = null
      }
    }

    // 'dragover' preventDefault is MANDATORY or Chromium navigates the window to
    // the dropped file:// URL and blanks the pet. While a file hovers, the pet
    // looks toward it (updateCursor) and holds a hungry expression.
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      clearLeave()
      controllerRef.current?.updateCursor(e.clientX, e.clientY)
      if (!craving) {
        craving = true
        clearSatisfied()
        controllerRef.current?.setExpression(FEED_HUNGRY_EXPRESSION)
      }
    }

    // dragleave fires on internal boundaries too; debounce so a continuous
    // dragover keeps the craving face, and only revert when the drag truly left.
    const onDragLeave = (): void => {
      clearLeave()
      leaveTimer = setTimeout(() => {
        leaveTimer = null
        if (!craving) return
        craving = false
        controllerRef.current?.resetExpression()
      }, DRAG_LEAVE_DEBOUNCE_MS)
    }

    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      clearLeave()
      craving = false
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) {
        controllerRef.current?.resetExpression()
        return
      }
      // Feed! Satisfied face + a lively reaction motion, held briefly then
      // reverted. Fires even if the ensuing ingest fails (separate path).
      const controller = controllerRef.current
      controller?.playAction('react')
      controller?.setExpression(FEED_SATISFIED_EXPRESSION)
      clearSatisfied()
      satisfiedTimer = setTimeout(() => {
        satisfiedTimer = null
        controllerRef.current?.resetExpression()
      }, FEED_SATISFIED_HOLD_MS)
      // Resolve each dropped file's real OS path (per-File: a FileList does not
      // survive the contextBridge) and ingest into the vault.
      const paths: string[] = []
      for (const f of Array.from(files)) {
        const p = window.petApi.getPathForFile(f)
        if (p) paths.push(p)
      }
      if (paths.length > 0) {
        void window.petApi.ingestPaths(paths).catch((err: unknown) => {
          console.error('[PetApp] ingest failed', err)
        })
      }
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      clearLeave()
      clearSatisfied()
    }
  }, [])

  return (
    <div className="pet-root" onMouseDown={handlePetMouseDown}>
      <Live2DStage onReady={handleReady} />
    </div>
  )
}

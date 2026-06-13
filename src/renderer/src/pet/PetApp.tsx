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
//   - HTML5 file drag/drop on the window -> playAction('receive') for visual
//     feedback AND resolves real OS paths via window.petApi.resolveDroppedPaths +
//     window.petApi.ingestPaths (Plan 3 real ingestion into the vault).
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
    // 'dragover' preventDefault is MANDATORY or Chromium navigates the window
    // to the dropped file:// URL and blanks the pet. 'drop' preventDefault
    // likewise. Plan 2 is VISUAL-ONLY: if any files are present, play
    // 'receive'. No OS path is read (no File.path / no preload bridge) and
    // nothing is logged, stored, or sent over IPC — that is Plan 3's scope.
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      // Visual feedback (Plan 2 behavior, PRESERVED) — fires even if ingest fails.
      controllerRef.current?.playAction('receive')
      // Plan 3: resolve real OS paths in the preload and ingest them.
      const paths = window.petApi.resolveDroppedPaths(files)
      if (paths.length > 0) {
        void window.petApi.ingestPaths(paths).catch((err: unknown) => {
          console.error('[PetApp] ingest failed', err)
        })
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <div className="pet-root" onMouseDown={handlePetMouseDown}>
      <Live2DStage onReady={handleReady} />
    </div>
  )
}

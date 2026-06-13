// src/renderer/src/pet/PetApp.tsx
// Pet root component. Composes three concerns:
//   - 3.2: renders the transparent placeholder pet.
//   - 4.5: mounts the usePassthrough hit-test loop (reports setInteractive
//          only on enter/leave transitions; pauses while dragging).
//   - 5.3 Step 5: manual-drag gesture on the pet body — pins the window
//          interactive for the whole gesture so the auto-mode hit-test cannot
//          flip it to click-through mid-drag and strand the mouseup.
import React, { useEffect, useRef } from 'react'
import { usePassthrough } from './usePassthrough'
import { PlaceholderPet } from './PlaceholderPet'
import { setPetDragging } from './dragState'
import './pet.css'

const DRAG_THRESHOLD = 4

export function PetApp() {
  usePassthrough()

  // Tracks the active gesture: anchor screen coords + whether it crossed the
  // click-vs-drag threshold. null when no button is held.
  const dragState = useRef<{ x: number; y: number; dragging: boolean } | null>(
    null
  )

  const handlePetMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return // left button only
    dragState.current = { x: e.screenX, y: e.screenY, dragging: false }
    // Pin the window interactive for the WHOLE gesture so the auto-mode
    // hit-test can't flip it to click-through and steal the upcoming mouseup.
    setPetDragging(true)
    window.petApi.setInteractive(true)
    window.petApi.drag.start()
  }

  useEffect(() => {
    const handleMove = (e: MouseEvent): void => {
      const s = dragState.current
      if (!s) return
      if (
        !s.dragging &&
        Math.hypot(e.screenX - s.x, e.screenY - s.y) > DRAG_THRESHOLD
      ) {
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
      // s.dragging === false here means it was a click, not a drag.
      dragState.current = null
      // Release the interactive pin; usePassthrough resumes hit-testing and
      // will re-apply the correct interactive/passthrough state on next move.
      setPetDragging(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  return (
    <div className="pet-root" onMouseDown={handlePetMouseDown}>
      <PlaceholderPet />
    </div>
  )
}

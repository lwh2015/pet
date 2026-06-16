// src/renderer/src/pet/ChromeZPet.tsx
// Mounts the PixiJS chrome-Z pet inside the interactive .pet-body region.
// - Subscribes to whole-screen cursor updates (window.petApi.onCursorMove),
//   converts window-local px -> canvas/scene px via getBoundingClientRect.
// - Triggers a squash on pointerdown (independent of the drag gesture).
// - Falls back to <PlaceholderPet/> if the WebGL Application fails to init.
import React, { useEffect, useRef, useState } from 'react'
import { createPetController, type PetController } from './pixi/petController'
import { PlaceholderPet } from './PlaceholderPet'

export function ChromeZPet(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<PetController | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let unsub: (() => void) | null = null
    let disposed = false

    createPetController()
      .then((c) => {
        if (disposed) {
          c.destroy()
          return
        }
        controllerRef.current = c
        const host = hostRef.current
        if (!host) return
        host.appendChild(c.canvas)

        unsub = window.petApi.onCursorMove((p) => {
          const rect = c.canvas.getBoundingClientRect()
          // window-local px (relative to window top-left) == viewport px here.
          c.setCursorScene(p.x - rect.left, p.y - rect.top)
        })
      })
      .catch((err) => {
        console.error('ChromeZPet init failed; falling back to placeholder', err)
        if (!disposed) setFailed(true)
      })

    return () => {
      disposed = true
      unsub?.()
      controllerRef.current?.destroy()
      controllerRef.current = null
    }
  }, [])

  if (failed) return <PlaceholderPet />

  return (
    <div className="pet-stage">
      <div
        className="pet-body"
        ref={hostRef}
        role="img"
        aria-label="Chrome Z pet"
        onPointerDown={() => controllerRef.current?.triggerSquash()}
      />
    </div>
  )
}

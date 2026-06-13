// src/renderer/src/pet/live2d/Live2DStage.tsx
// GLUE component: owns the single full-window <canvas>, drives the Live2D model
// via useLive2DModel, and on success builds the ActionController + AlphaHitTester,
// plays 'greet', starts idle, follows the cursor each frame, and hands the glue
// units up to PetApp via onReady. On model-load error it renders the existing
// PlaceholderPet instead. It ALSO owns hidden-pause: when petVisible flips false
// it pauses the pixi ticker + idle, resuming on true (it owns the ticker/idle).
import React, { useEffect, useRef } from 'react'
import type { Renderer } from 'pixi.js'
import { LIVE2D_MODEL } from '@shared/live2d/modelConfig'
import { useLive2DModel } from './useLive2DModel'
import { createActionController } from './actionController'
import { createAlphaHitTester } from './alphaHitTester'
import type { ActionController } from './actionController'
import type { AlphaHitTester } from './alphaHitTester'
import { PlaceholderPet } from '../PlaceholderPet'

export interface Live2DStageProps {
  onReady: (handles: { controller: ActionController; hitTester: AlphaHitTester } | null) => void
}

export function Live2DStage(props: Live2DStageProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Keep onReady in a ref so it is NOT an effect dependency. PetApp may pass a
  // fresh onReady identity on every render (it is not required to useCallback);
  // putting onReady in the dep array would tear down + rebuild the controller
  // and re-fire 'greet' on every parent render. The ref always holds the latest
  // callback; the build effect below keys ONLY on [status, app, model], so the
  // controller/hitTester are built exactly once per model-ready and onReady is
  // invoked exactly once (and once with null on teardown).
  // The latest callback is synced in a post-render effect (NOT during render —
  // react-hooks/refs forbids writing refs in the render body). It runs on every
  // render and is committed before the build effect's onReadyRef reads fire
  // (those fire only on model-ready / unmount, never during render).
  const onReadyRef = useRef(props.onReady)
  useEffect(() => {
    onReadyRef.current = props.onReady
  })

  const { app, model, status } = useLive2DModel({
    canvasRef,
    modelUrl: LIVE2D_MODEL.modelUrl,
    anchor: LIVE2D_MODEL.anchor,
    fitScale: LIVE2D_MODEL.fitScale
  })

  // Build + tear down the glue units exactly when the model becomes ready.
  // onReady is intentionally absent from the deps (read via ref) — see above.
  useEffect(() => {
    if (status !== 'ready' || !app || !model) return

    const controller = createActionController(model)
    // app.renderer is typed as the abstract IRenderer (no `gl`); at runtime it
    // is the concrete WebGL Renderer (which `implements IRenderer` and exposes
    // `gl`). Narrow to Renderer for the gl/view reads — verified against pixi
    // v7 @pixi/core (Renderer.gl: IRenderingContext).
    const renderer = app.renderer as Renderer
    const hitTester = createAlphaHitTester({
      getGl: () => renderer.gl,
      getCanvas: () => renderer.view as HTMLCanvasElement
    })

    // Cursor-follow: cache offset every mousemove; applied in beforeModelUpdate.
    const onMouseMove = (e: MouseEvent): void => controller.updateCursor(e.clientX, e.clientY)
    window.addEventListener('mousemove', onMouseMove)

    // Greet fires exactly once here (per model-ready), not per parent render,
    // because this effect no longer depends on onReady.
    controller.playAction('greet')
    controller.startIdle()
    onReadyRef.current({ controller, hitTester })

    // Hidden-pause: Live2DStage owns the ticker + idle, so it owns the pause.
    // onSettingsChanged delivers the UNWRAPPED Settings (verified: preload calls
    // cb(payload.settings) in src/preload/index.ts), so settings.petVisible is
    // the correct access — no destructuring change is needed.
    const unsubscribeSettings = window.petApi.onSettingsChanged((settings) => {
      if (settings.petVisible === false) {
        if (app.ticker.started) app.ticker.stop()
        controller.stopIdle()
      } else {
        if (!app.ticker.started) app.ticker.start()
        controller.startIdle()
      }
    })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      unsubscribeSettings()
      controller.dispose()
      onReadyRef.current(null)
    }
  }, [status, app, model])

  if (status === 'error') {
    return <PlaceholderPet />
  }

  return <canvas ref={canvasRef} className="pet-canvas" />
}

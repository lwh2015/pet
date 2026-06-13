// src/renderer/src/pet/live2d/useLive2DModel.ts
// GLUE hook: creates the transparent pixi v7 Application on the given canvas,
// loads the Live2D model, fits/centers it on resize, and tears everything down
// StrictMode-safe. Returns { app, model, status } for Live2DStage to wire the
// controller + hit-tester once status === 'ready'. The fit policy (anchor +
// fitScale) is passed in from LIVE2D_MODEL by Live2DStage so modelConfig.ts
// stays the single place to tune fit (no duplicated magic constant here).
import { useEffect, useState } from 'react'
import * as PIXI from 'pixi.js'
import './registerPixi' // side-effect: window.PIXI set before Live2DModel.from
import { Live2DModel } from './registerPixi'
import type { Live2DModelType } from './registerPixi'

export type Live2DStatus = 'loading' | 'ready' | 'error'

export interface UseLive2DModelParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  modelUrl: string
  anchor: { x: number; y: number }
  fitScale: number
}

export interface UseLive2DModelResult {
  app: PIXI.Application | null
  model: Live2DModelType | null
  status: Live2DStatus
}

function fitModel(model: Live2DModelType, fitScale: number): void {
  const s = Math.min(window.innerWidth / model.width, window.innerHeight / model.height) * fitScale
  model.scale.set(s)
  model.position.set(window.innerWidth / 2, window.innerHeight / 2)
}

export function useLive2DModel(params: UseLive2DModelParams): UseLive2DModelResult {
  const { canvasRef, modelUrl, anchor, fitScale } = params
  const [app, setApp] = useState<PIXI.Application | null>(null)
  const [model, setModel] = useState<Live2DModelType | null>(null)
  const [status, setStatus] = useState<Live2DStatus>('loading')

  useEffect(() => {
    let cancelled = false
    let localApp: PIXI.Application | null = null
    let onResize: (() => void) | null = null

    async function boot(): Promise<void> {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        localApp = new PIXI.Application({
          view: canvas,
          resizeTo: window,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          preserveDrawingBuffer: true
        })

        const loaded = await Live2DModel.from(modelUrl, { autoInteract: false, autoUpdate: true })
        // StrictMode double-mount / unmount-before-load guard.
        if (cancelled || !localApp) {
          loaded.destroy()
          return
        }
        loaded.anchor.set(anchor.x, anchor.y)

        onResize = (): void => fitModel(loaded, fitScale)
        onResize()
        window.addEventListener('resize', onResize)
        localApp.stage.addChild(loaded)

        setApp(localApp)
        setModel(loaded)
        setStatus('ready')
      } catch (err) {
        console.error('[useLive2DModel] model load failed:', err)
        if (!cancelled) setStatus('error')
      }
    }

    void boot()

    return () => {
      cancelled = true
      if (onResize) window.removeEventListener('resize', onResize)
      // destroy(false, ...): do NOT remove the view. The <canvas> is rendered
      // by Live2DStage's JSX (<canvas ref={canvasRef}>), so React owns that DOM
      // node and discards it on unmount. Passing removeView=true would have
      // pixi yank a React-managed node out from under React, risking a
      // NotFoundError on React's own unmount/commit (worse under StrictMode's
      // double-unmount). We still destroy children/textures to release GL.
      localApp?.destroy(false, { children: true, texture: true, baseTexture: true })
      localApp = null
      setApp(null)
      setModel(null)
      setStatus('loading')
    }
  }, [canvasRef, modelUrl, anchor, fitScale])

  return { app, model, status }
}

// src/renderer/src/pet/pixi/petController.ts
// Owns the PixiJS Application + ticker and applies all pet animations.
// Imperative API consumed by the React wrapper. Eye-tracking input is in
// SCENE coordinates (the wrapper converts window-local px -> scene px).
//
// Patch PixiJS to use non-eval shader/UBO codegen BEFORE any pixi object is
// created — the Electron renderer disallows unsafe-eval (CSP), so the default
// `new Function()` path throws. This side-effect import keeps CSP strict.
import 'pixi.js/unsafe-eval'
import { Application } from 'pixi.js'
import {
  buildScene,
  EYE_L,
  EYE_R,
  PUPIL_MAX_TRAVEL,
  FACE_CENTER_X,
  SCENE_W,
  SCENE_H,
  type PetParts
} from './buildScene'
import { pupilOffset } from './eyeMath'
import { sheenAlpha } from './metal'

export interface PetController {
  canvas: HTMLCanvasElement
  setCursorScene(x: number, y: number): void
  triggerSquash(): void
  pause(): void
  resume(): void
  destroy(): void
}

export async function createPetController(): Promise<PetController> {
  const app = new Application()
  await app.init({
    width: SCENE_W,
    height: SCENE_H,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  })

  const parts: PetParts = buildScene()
  app.stage.addChild(parts.root)

  let elapsed = 0
  let cursor: { x: number; y: number } | null = null
  let nextBlinkAt = randBlinkDelay()
  let blinkT = -1 // -1 idle; otherwise seconds into the blink
  let squashT = -1 // -1 idle; otherwise seconds into the squash

  function randBlinkDelay(): number {
    return 3 + Math.random() * 4 // 3..7 s
  }

  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime / 60 // ~seconds at 60fps
    elapsed += dt

    // Breathing (scale around bottom-center).
    const breathe = Math.sin(elapsed * 2.2)
    let sx = 1 - breathe * 0.015
    let sy = 1 + breathe * 0.02

    // Squash on click/drag: quick scaleX up / scaleY down, decaying.
    if (squashT >= 0) {
      squashT += dt
      const k = Math.max(0, 1 - squashT / 0.35)
      const pulse = Math.sin(squashT * 22) * k
      sx += pulse * 0.12
      sy -= pulse * 0.12
      if (squashT > 0.35) squashT = -1
    }
    parts.bodyGroup.scale.set(sx, sy)

    // Sheen + ears/tail sway.
    parts.highlight.alpha = sheenAlpha(elapsed)
    parts.earL.rotation = Math.sin(elapsed * 1.6) * 0.08
    parts.earR.rotation = Math.sin(elapsed * 1.6 + 0.6) * 0.08
    parts.tail.rotation = Math.sin(elapsed * 1.3) * 0.12

    // Pupil follow + face tilt toward cursor.
    if (cursor) {
      const oL = pupilOffset(cursor.x - EYE_L.x, cursor.y - EYE_L.y, PUPIL_MAX_TRAVEL)
      parts.pupilL.position.set(EYE_L.x + oL.x, EYE_L.y + oL.y)
      const oR = pupilOffset(cursor.x - EYE_R.x, cursor.y - EYE_R.y, PUPIL_MAX_TRAVEL)
      parts.pupilR.position.set(EYE_R.x + oR.x, EYE_R.y + oR.y)
      parts.face.rotation = clamp((cursor.x - FACE_CENTER_X) / 1500, -0.06, 0.06)
    }

    // Blink.
    if (blinkT < 0 && elapsed >= nextBlinkAt) blinkT = 0
    if (blinkT >= 0) {
      blinkT += dt
      const half = 0.06
      const k = blinkT < half ? 1 - blinkT / half : (blinkT - half) / half
      parts.eyes.scale.y = Math.max(0.1, k)
      if (blinkT > half * 2) {
        blinkT = -1
        parts.eyes.scale.y = 1
        nextBlinkAt = elapsed + randBlinkDelay()
      }
    }
  })

  return {
    canvas: app.canvas,
    setCursorScene(x: number, y: number): void {
      cursor = { x, y }
    },
    triggerSquash(): void {
      squashT = 0
    },
    pause(): void {
      app.ticker.stop()
    },
    resume(): void {
      app.ticker.start()
    },
    destroy(): void {
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true })
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

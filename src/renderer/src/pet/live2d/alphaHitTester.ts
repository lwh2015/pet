// src/renderer/src/pet/live2d/alphaHitTester.ts
// GLUE: per-pixel alpha hit-test of the transparent pet canvas. CSS->GL pixel
// math + Y-flip + threshold are the pure @shared/live2d/hitMath; this file only
// binds the default framebuffer and does the 1x1 gl.readPixels readback. The
// pixi Application MUST be created with preserveDrawingBuffer:true (see
// useLive2DModel) or the default-framebuffer read returns zero post-composite.
import { clientToGlPixel, isHit, DEFAULT_ALPHA_THRESHOLD } from '@shared/live2d/hitMath'

export interface AlphaHitTester {
  sampleAlpha(clientX: number, clientY: number): number
  isOverModel(clientX: number, clientY: number): boolean
}

export interface AlphaHitTesterDeps {
  getGl: () => WebGLRenderingContext | WebGL2RenderingContext | null
  getCanvas: () => HTMLCanvasElement | null
  threshold?: number
}

export function createAlphaHitTester(deps: AlphaHitTesterDeps): AlphaHitTester {
  const threshold = deps.threshold ?? DEFAULT_ALPHA_THRESHOLD
  const buf = new Uint8Array(4)

  function sampleAlpha(clientX: number, clientY: number): number {
    const gl = deps.getGl()
    const canvas = deps.getCanvas()
    if (!gl || !canvas) return 0

    const rect = canvas.getBoundingClientRect()
    const { gx, gy, inBounds } = clientToGlPixel({
      clientX,
      clientY,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      canvasPixelWidth: canvas.width,
      canvasPixelHeight: canvas.height
    })
    if (!inBounds) return 0

    // Pixi binds its own render-target FBOs; rebind the default (on-screen)
    // framebuffer before reading. readPixels origin is bottom-left (handled by
    // hitMath's Y-flip). 1x1 RGBA/UNSIGNED_BYTE is the always-valid combo.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(gx, gy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    return buf[3]
  }

  function isOverModel(clientX: number, clientY: number): boolean {
    return isHit(sampleAlpha(clientX, clientY), threshold)
  }

  return { sampleAlpha, isOverModel }
}

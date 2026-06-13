// ============================================================================
// src/shared/live2d/hitMath.ts
// Pure hit-test geometry. ELECTRON-FREE, PIXI-FREE, GL-FREE.
// clientToGlPixel: CSS client coord -> drawing-buffer pixel with DPR scaling
//   and the WebGL bottom-left Y-flip (readPixels origin is bottom-left).
// isHit: alpha-coverage threshold test. DEFAULT_ALPHA_THRESHOLD is the SINGLE
//   source of the cutoff (modelConfig.ts re-exports it as ALPHA_HIT_THRESHOLD).
// Unit-tested with vitest (node env).
// ============================================================================

/** Inputs for converting a client point to a drawing-buffer pixel. */
export interface GlHitInput {
  clientX: number
  clientY: number
  rect: { left: number; top: number; width: number; height: number }
  canvasPixelWidth: number
  canvasPixelHeight: number
}

/** A drawing-buffer pixel (GL bottom-left origin) + an in-bounds flag. */
export interface GlPixel {
  gx: number
  gy: number
  inBounds: boolean
}

/** Alpha-coverage cutoff (0..255) above which a pixel counts as "over the pet". */
export const DEFAULT_ALPHA_THRESHOLD = 10

/** Clamp v into [min,max]. Pure. */
function clamp(v: number, min: number, max: number): number {
  if (v < min) {
    return min
  }
  if (v > max) {
    return max
  }
  return v
}

/**
 * Convert a CSS client coordinate to a drawing-buffer pixel for gl.readPixels.
 * scaleX = canvasPixelWidth/rect.width (handles CSS-scaling + DPR without
 * assuming devicePixelRatio); gx = floor((clientX-left)*scaleX). gy is
 * Y-flipped to GL's bottom-left origin: gy = canvasPixelHeight-1 - floor(cssY*scaleY).
 * inBounds is the half-open [0,W) x [0,H) test on the pre-flip device pixel;
 * gx/gy are always clamped to a valid readable index so a caller can read safely
 * even when inBounds is false. Pure, no gl/pixi.
 */
export function clientToGlPixel(input: GlHitInput): GlPixel {
  const { clientX, clientY, rect, canvasPixelWidth, canvasPixelHeight } = input

  const scaleX = rect.width === 0 ? 0 : canvasPixelWidth / rect.width
  const scaleY = rect.height === 0 ? 0 : canvasPixelHeight / rect.height

  const deviceX = Math.floor((clientX - rect.left) * scaleX)
  const deviceY = Math.floor((clientY - rect.top) * scaleY)

  const inBounds =
    deviceX >= 0 && deviceX < canvasPixelWidth && deviceY >= 0 && deviceY < canvasPixelHeight

  const gx = clamp(deviceX, 0, canvasPixelWidth - 1)
  const gy = clamp(canvasPixelHeight - 1 - deviceY, 0, canvasPixelHeight - 1)

  return { gx, gy, inBounds }
}

/**
 * Alpha-coverage hit test: returns alpha > threshold. The default threshold
 * (DEFAULT_ALPHA_THRESHOLD = 10) ignores faint antialiased edges. Pure.
 */
export function isHit(alpha: number, threshold: number = DEFAULT_ALPHA_THRESHOLD): boolean {
  return alpha > threshold
}

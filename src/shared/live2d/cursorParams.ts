// ============================================================================
// src/shared/live2d/cursorParams.ts
// Pure cursor-follow math. ELECTRON-FREE, PIXI-FREE.
// normalizeCursorOffset: client point within a rect -> offset in [-1,1]
//   (center = 0,0; +x right; +y UP after negation).
// cursorToParams: offset -> Cubism param values (head angle / eyeball / body),
//   matching focus()'s conventional multipliers so we can drive params manually.
// Unit-tested with vitest (node env).
// ============================================================================

/** Normalized cursor offset; each axis clamped to [-1,1]. */
export interface CursorOffset {
  x: number
  y: number
}

/** Resolved Cubism parameter values for a given offset. */
export interface CursorParams {
  angleX: number
  angleY: number
  eyeX: number
  eyeY: number
  bodyAngleX: number
}

/** Per-axis scale factors mapping offset -> param value. */
export interface CursorParamConfig {
  angleScale: number
  eyeScale: number
  bodyScale: number
}

/**
 * Conventional focus() multipliers: head angle +/-30 deg, eyeball +/-1,
 * body angle +/-10. Matches the additive ranges focus() would otherwise apply.
 */
export const DEFAULT_CURSOR_CONFIG: CursorParamConfig = {
  angleScale: 30,
  eyeScale: 1,
  bodyScale: 10
}

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
 * Map a client (CSS) point within `rect` to a normalized offset in [-1,1].
 * Center of the rect -> (0,0). X grows right; Y is negated so the TOP of the
 * rect is +1 and the bottom is -1 (screen-up = positive). Out-of-rect points
 * are clamped to the [-1,1] box. Pure, no pixi/electron.
 */
export function normalizeCursorOffset(
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number }
): CursorOffset {
  const nx = rect.width === 0 ? 0 : ((client.x - rect.left) / rect.width) * 2 - 1
  const ny = rect.height === 0 ? 0 : ((client.y - rect.top) / rect.height) * 2 - 1
  return {
    x: clamp(nx, -1, 1),
    y: clamp(-ny, -1, 1)
  }
}

/**
 * Map a normalized offset to Cubism parameter values. Clamps the offset to
 * [-1,1] first, then: angleX/Y = x/y * angleScale, eyeX/Y = x/y * eyeScale,
 * bodyAngleX = x * bodyScale. Center -> all zeros. Pure, no pixi/electron.
 */
export function cursorToParams(
  offset: CursorOffset,
  cfg: CursorParamConfig = DEFAULT_CURSOR_CONFIG
): CursorParams {
  const x = clamp(offset.x, -1, 1)
  const y = clamp(offset.y, -1, 1)
  return {
    angleX: x * cfg.angleScale,
    angleY: y * cfg.angleScale,
    eyeX: x * cfg.eyeScale,
    eyeY: y * cfg.eyeScale,
    bodyAngleX: x * cfg.bodyScale
  }
}

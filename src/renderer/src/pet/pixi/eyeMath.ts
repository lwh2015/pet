// src/renderer/src/pet/pixi/eyeMath.ts
export interface Vec2 {
  x: number
  y: number
}

/**
 * Clamp the pupil so it stays inside the eye-white and eases toward the rim.
 * @param toCursorX cursor X minus eye-center X, in scene px
 * @param toCursorY cursor Y minus eye-center Y, in scene px
 * @param maxTravel max distance (px) the pupil center may leave the eye center
 * @param gain cursor distance (px) that maps to FULL travel; nearer => softer
 */
export function pupilOffset(
  toCursorX: number,
  toCursorY: number,
  maxTravel: number,
  gain = 220
): Vec2 {
  const dist = Math.hypot(toCursorX, toCursorY)
  if (dist === 0) return { x: 0, y: 0 }
  const travel = Math.min(maxTravel, (dist / gain) * maxTravel)
  const k = travel / dist
  return { x: toCursorX * k, y: toCursorY * k }
}

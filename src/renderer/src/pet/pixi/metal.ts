// src/renderer/src/pet/pixi/metal.ts
// Polished-chrome palette + gradient/sheen helpers. The ONLY place that touches
// PixiJS FillGradient (version-volatile) — adjust here if the installed pixi's
// FillGradient signature differs.
import { FillGradient } from 'pixi.js'

export const CHROME = {
  rim: 0x23272e, // dark outline under the metal stroke
  edge: 0x2c3038, // thin edge stroke on ears
  dark: 0x5b6670, // tail / deep accents
  eyeWhite: 0xf3f6fa,
  ink: 0x1b1e24 // pupils / mouth
} as const

/**
 * Vertical polished-chrome gradient spanning the pet's body height. Bright top,
 * a hot near-white sheen band in the middle, dark belly — the classic chrome
 * "horizon reflection" look. Coordinates are in scene space (canvas 200x210).
 */
export function makeChromeGradient(topY = 24, bottomY = 150): FillGradient {
  const g = new FillGradient(100, topY, 100, bottomY)
  g.addColorStop(0.0, 0xeef2f7)
  g.addColorStop(0.38, 0xaab3c0)
  g.addColorStop(0.5, 0xffffff)
  g.addColorStop(0.58, 0x6c7480)
  g.addColorStop(1.0, 0x3a3f48)
  return g
}

/** Breathing-synced highlight alpha (the simplified "metal sheen flow"). */
export function sheenAlpha(t: number): number {
  return 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2))
}

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
 * Vertical polished-chrome gradient. Bright top, a hot near-white sheen band in
 * the middle, dark belly — the classic chrome "horizon reflection" look.
 * Coordinates use normalized local texture space (0..1, top -> bottom) so the
 * gradient maps top-to-bottom across each metal shape's bounding box.
 */
export function makeChromeGradient(): FillGradient {
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0.0, color: 0xeef2f7 },
      { offset: 0.38, color: 0xaab3c0 },
      { offset: 0.5, color: 0xffffff },
      { offset: 0.58, color: 0x6c7480 },
      { offset: 1.0, color: 0x3a3f48 }
    ]
  })
}

/** Breathing-synced highlight alpha (the simplified "metal sheen flow"). */
export function sheenAlpha(t: number): number {
  return 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2))
}

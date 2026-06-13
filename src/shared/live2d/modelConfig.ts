// ============================================================================
// src/shared/live2d/modelConfig.ts  (PURE data; PIXI-FREE, ELECTRON-FREE)
// The ONE place to swap the model / tune fit. Imported by Live2DStage glue.
// ============================================================================
import type { ActionMap } from './actionMap'
import { DEFAULT_ACTION_MAP } from './actionMap'
import { DEFAULT_ALPHA_THRESHOLD } from './hitMath'

export interface Live2DModelConfig {
  /** Display name (debug/logging only). */
  name: string
  /**
   * Relative URL to the .model3.json, resolved against the renderer page.
   * SAME string in dev (Vite server root) and packaged (file:// next to
   * index.html), because the assets live under src/renderer/public/ and Vite
   * copies them verbatim into out/renderer/. NEVER a leading slash.
   */
  modelUrl: string
  /** Anchor for centering; 0.5,0.5 = model center. */
  anchor: { x: number; y: number }
  /**
   * Fit policy: scale = min(W/model.width, H/model.height) * fitScale, then
   * center at (W/2, H/2). fitScale lets the model breathe inside the window.
   */
  fitScale: number
  /** Cubism idle motion group name (matches the model3.json). */
  idleMotionGroup: string
  /** Tag -> motion/expression table for THIS model. */
  actionMap: ActionMap
}

/**
 * Bundled free sample: haru_greeter_t03 (Cubism 4) — redistributed under
 * Live2D's Free Material License, ships 8 expressions (Name keys f00..f07) and
 * motion groups 'Idle'/'Tap', which DEFAULT_ACTION_MAP targets. Swap by
 * replacing the public/models folder and editing modelUrl + idleMotionGroup +
 * actionMap here (and the action map if group/expression names differ).
 */
export const LIVE2D_MODEL: Live2DModelConfig = {
  name: 'Haru',
  modelUrl: 'models/haru/haru.model3.json',
  anchor: { x: 0.5, y: 0.5 },
  fitScale: 0.9,
  idleMotionGroup: 'Idle',
  actionMap: DEFAULT_ACTION_MAP
}

/**
 * Classic global script that defines window.Live2DCubismCore. Vendored at
 * src/renderer/public/live2dcubismcore.min.js; referenced from index.html as a
 * RELATIVE path so it resolves in dev AND packaged file://. (This constant
 * documents the path; the actual <script> tag lives in index.html.)
 */
export const CUBISM_CORE_SRC = './live2dcubismcore.min.js'

/**
 * Alpha-coverage cutoff (0..255) above which a pixel counts as "over the pet".
 * Re-exported from hitMath so there is exactly ONE threshold source — NEVER a
 * second literal here.
 */
export const ALPHA_HIT_THRESHOLD = DEFAULT_ALPHA_THRESHOLD

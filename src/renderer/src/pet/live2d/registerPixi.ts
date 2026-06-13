// src/renderer/src/pet/live2d/registerPixi.ts
// Side-effect module: register PixiJS with the Live2D plugin ONCE, before any
// model load, so models auto-update on the shared ticker (autoUpdate:true).
// Also the SINGLE place the rest of the app imports the Live2D classes from,
// pinned to the /cubism4 subpath (Cubism 3/4 .model3.json only — no cubism2
// runtime bundled). Importing this module first guarantees window.PIXI is set
// before useLive2DModel calls Live2DModel.from.
import * as PIXI from 'pixi.js'

// The full pixi.js bundle path: the plugin reads window.PIXI.Ticker for
// autoUpdate. Set once; guarded so React StrictMode re-imports are no-ops
// (ES modules are singletons, but the guard documents intent).
declare global {
  var __PET_PIXI_REGISTERED__: boolean | undefined
}

if (!globalThis.__PET_PIXI_REGISTERED__) {
  // @ts-expect-error window.PIXI is the plugin's documented auto-update hook.
  window.PIXI = PIXI
  globalThis.__PET_PIXI_REGISTERED__ = true
}

export { Live2DModel, MotionPriority } from 'pixi-live2d-display-advanced/cubism4'
export type Live2DModelType = import('pixi-live2d-display-advanced/cubism4').Live2DModel

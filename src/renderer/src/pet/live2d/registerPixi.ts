// src/renderer/src/pet/live2d/registerPixi.ts
// Side-effect module: register PixiJS with the Live2D plugin ONCE, before any
// model load, so models auto-update on the shared ticker (autoUpdate:true).
// Also the SINGLE place the rest of the app imports the Live2D classes from,
// pinned to the /cubism4 subpath (Cubism 3/4 .model3.json only — no cubism2
// runtime bundled). Importing this module first guarantees window.PIXI is set
// before useLive2DModel calls Live2DModel.from.
import * as PIXI from 'pixi.js'
// Patch PixiJS to avoid new Function()/eval. The pet window's CSP is strict
// (script-src 'self', NO 'unsafe-eval'); pixi v7's renderer generates shader
// programs via new Function(), so Live2DModel.from would throw "Current
// environment does not allow unsafe-eval" when it creates the renderer.
// @pixi/unsafe-eval self-installs on import (since 7.1.0) and rewrites those
// systems, keeping the strict CSP. This side-effect import MUST be evaluated
// before any PIXI.Application/renderer is created — registerPixi is imported
// (side-effect) at the top of useLive2DModel, before it boots the app.
import '@pixi/unsafe-eval'

// The plugin reads window.PIXI.Ticker for autoUpdate. Set once; guarded so
// re-imports are no-ops (ES modules are singletons; the guard documents intent).
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

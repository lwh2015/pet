// src/renderer/src/pet/live2d/actionController.ts
// GLUE: turns semantic ActionTags into Live2D motions/expressions, runs the
// idle micro-action loop, and drives per-frame cursor-follow params. Pure
// decision logic lives in @shared/live2d/*; this file is the ONLY place the
// string ActionPriority is mapped to pixi's MotionPriority enum.
import { MotionPriority } from './registerPixi'
import type { Live2DModelType } from './registerPixi'
import type { ActionTag, ActionPriority } from '@shared/live2d/actionMap'
import { resolveAction } from '@shared/live2d/actionMap'
import { nextIdleAction } from '@shared/live2d/idleScheduler'
import type { IdleSchedulerConfig } from '@shared/live2d/idleScheduler'
import { cursorToParams, normalizeCursorOffset } from '@shared/live2d/cursorParams'
import type { CursorOffset } from '@shared/live2d/cursorParams'

export interface ActionController {
  playAction(tag: ActionTag): void
  startIdle(): void
  stopIdle(): void
  updateCursor(clientX: number, clientY: number): void
  /** Hold a Live2D expression (e.g. a "hungry" face during drag-to-feed). */
  setExpression(name: string): void
  /** Revert to the model's base face. */
  resetExpression(): void
  dispose(): void
}

// Minimal structural type for the Cubism core model. The advanced fork bundles
// its own types but coreModel's setParameterValueById typing is a soft area
// (see Step 1a verification): cast ONCE here, out of the per-frame hot path.
interface CubismCore {
  setParameterValueById: (id: string, value: number) => void
}

// Minimal EventEmitter surface for internalModel.on/off. The fork's bundled
// .d.ts declares `InternalModel extends utils.EventEmitter` but that reference
// does NOT resolve to eventemitter3's method-bearing declaration in this
// project's type resolution, so `on`/`off` are not visible on the typed
// InternalModel (TS2339) even though they exist at runtime (verified: the dist
// extends core.utils.EventEmitter and emits 'beforeModelUpdate'). Cast through
// this surface for the two listener calls — same pattern as coreModel above.
interface InternalModelEvents {
  on(event: 'beforeModelUpdate', fn: () => void): void
  off(event: 'beforeModelUpdate', fn: () => void): void
}

// Explicit idle config: idle-priority tags ONLY (never a reaction tag) and
// avoidRepeat so consecutive idles differ. We do NOT fall back to
// DEFAULT_IDLE_CONFIG implicitly — passing this keeps the glue behavior pinned
// regardless of the default, and guarantees idle never FORCE-interrupts.
const IDLE_CONFIG: IdleSchedulerConfig = {
  minDelayMs: 4000,
  maxDelayMs: 9000,
  tags: ['idle'],
  avoidRepeat: true
}

/**
 * Single place ActionPriority (pixi-free string) -> pixi MotionPriority enum.
 * The default branch is an exhaustiveness guard: it makes the function total on
 * all code paths (satisfies noImplicitReturns) and turns any future ActionPriority
 * member into a COMPILE error here rather than a silent fall-through.
 */
function toMotionPriority(priority: ActionPriority): MotionPriority {
  switch (priority) {
    case 'idle':
      return MotionPriority.IDLE
    case 'normal':
      return MotionPriority.NORMAL
    case 'reaction':
      return MotionPriority.FORCE
    default: {
      // Exhaustiveness guard: assigning `priority` to `never` turns any future
      // ActionPriority member into a COMPILE error here. Returned so the binding
      // is read (satisfies noUnusedLocals) while keeping the function total.
      const _exhaustive: never = priority
      return _exhaustive
    }
  }
}

export function createActionController(model: Live2DModelType): ActionController {
  let idleActive = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  // Latest normalized cursor offset, applied every frame in beforeModelUpdate.
  let offset: CursorOffset = { x: 0, y: 0 }
  let lastIdleTag: ActionTag | undefined

  // Cast the core model ONCE (not per frame). coreModel is the Cubism runtime
  // model exposing setParameterValueById; see Step 1a for the verified type.
  const core = model.internalModel.coreModel as unknown as CubismCore

  // DISABLE the plugin's built-in idle auto-play so there is exactly ONE idle
  // driver. The MotionManager auto-plays the configured idle group at IDLE
  // priority whenever the model goes idle; left on, it would race this manual
  // scheduler (two idle drivers, both IDLE). We clear the idle group name so
  // the built-in never fires, and OUR scheduler is the sole idle source.
  const motionManager = model.internalModel.motionManager as unknown as {
    groups: { idle: string }
  }
  motionManager.groups.idle = ''

  // beforeModelUpdate runs AFTER motion/expression/physics, just before the
  // core flush, so manually-set params win and don't fight focus (focus is OFF
  // because autoInteract:false). We drive head/eye/body params ourselves.
  const onBeforeUpdate = (): void => {
    const p = cursorToParams(offset)
    core.setParameterValueById('ParamAngleX', p.angleX)
    core.setParameterValueById('ParamAngleY', p.angleY)
    // ParamAngleZ (head ROLL): the Cubism focus convention is
    // focusX * focusY * -30, where focusX/focusY are the NORMALIZED offset in
    // [-1,1] — NOT the already-scaled angleX/angleY (those are *30 each, which
    // would give ~x*y*-900, an order of magnitude past the ±30 range). Use the
    // raw cached offset for the Z term; -30 is the documented focus magnitude.
    core.setParameterValueById('ParamAngleZ', offset.x * offset.y * -30)
    core.setParameterValueById('ParamEyeBallX', p.eyeX)
    core.setParameterValueById('ParamEyeBallY', p.eyeY)
    core.setParameterValueById('ParamBodyAngleX', p.bodyAngleX)
  }
  const internalModelEvents = model.internalModel as unknown as InternalModelEvents
  internalModelEvents.on('beforeModelUpdate', onBeforeUpdate)

  function playAction(tag: ActionTag): void {
    if (disposed) return
    const entry = resolveAction(tag)
    void model.motion(entry.motionGroup, entry.motionIndex, toMotionPriority(entry.priority))
    if (entry.expression !== undefined) {
      void model.expression(entry.expression)
    }
  }

  function scheduleNextIdle(): void {
    if (!idleActive || disposed) return
    const { tag, delayMs } = nextIdleAction(
      { random: Math.random, now: Date.now(), lastTag: lastIdleTag },
      IDLE_CONFIG
    )
    idleTimer = setTimeout(() => {
      if (!idleActive || disposed) return
      lastIdleTag = tag
      const entry = resolveAction(tag)
      void model.motion(entry.motionGroup, entry.motionIndex, toMotionPriority(entry.priority))
      if (entry.expression !== undefined) void model.expression(entry.expression)
      scheduleNextIdle()
    }, delayMs)
  }

  function startIdle(): void {
    if (idleActive || disposed) return
    idleActive = true
    scheduleNextIdle()
  }

  function stopIdle(): void {
    idleActive = false
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  function updateCursor(clientX: number, clientY: number): void {
    offset = normalizeCursorOffset(
      { x: clientX, y: clientY },
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    )
  }

  function setExpression(name: string): void {
    if (disposed) return
    void model.expression(name)
  }

  function resetExpression(): void {
    if (disposed) return
    // Revert to the model's base face. pixi-live2d-display exposes
    // resetExpression() on the expression manager; cast (same soft-typing as
    // coreModel/internalModelEvents above) and guard so it no-ops if absent.
    try {
      const em = (
        model.internalModel.motionManager as unknown as {
          expressionManager?: { resetExpression?: () => void }
        }
      ).expressionManager
      em?.resetExpression?.()
    } catch {
      /* best-effort: leave the current expression if reset is unavailable */
    }
  }

  function dispose(): void {
    disposed = true
    stopIdle()
    internalModelEvents.off('beforeModelUpdate', onBeforeUpdate)
  }

  return {
    playAction,
    startIdle,
    stopIdle,
    updateCursor,
    setExpression,
    resetExpression,
    dispose
  }
}

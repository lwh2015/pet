// ============================================================================
// src/shared/live2d/idleScheduler.ts
// Pure, deterministic idle micro-action planner. ELECTRON-FREE, PIXI-FREE.
// Given an injected random() in [0,1) and a `now` timestamp, returns the next
// idle tag + a delayMs in [minDelayMs, maxDelayMs). No timers, no pixi.
// Unit-tested with vitest (node env).
// ============================================================================

import type { ActionTag } from './actionMap'

/** Tuning for the idle loop: delay window + the pool of idle tags to choose from. */
export interface IdleSchedulerConfig {
  minDelayMs: number
  maxDelayMs: number
  tags: readonly ActionTag[]
  /** When true (and tags.length > 1), never re-pick the lastTag. */
  avoidRepeat?: boolean
}

/**
 * Injected sources of nondeterminism, supplied by the caller so the planner is
 * pure and testable. `random` returns [0,1); `now` is the current timestamp
 * (accepted for future jitter/seeding, kept so the fn stays referentially testable).
 */
export interface IdleScheduleInput {
  random: () => number
  now: number
  lastTag?: ActionTag
}

/** The plan: which idle tag to play and how long to wait before playing it. */
export interface IdleSchedule {
  tag: ActionTag
  delayMs: number
}

/** Default idle pool/window for the bundled model. */
export const DEFAULT_IDLE_CONFIG: IdleSchedulerConfig = {
  minDelayMs: 4000,
  maxDelayMs: 9000,
  tags: ['idle'],
  avoidRepeat: true
}

/**
 * Plan the next idle micro-action. Deterministic given `input.random`:
 *  1. choose a tag from cfg.tags (filtering out input.lastTag when avoidRepeat
 *     is set and more than one tag remains),
 *  2. choose a delay in [minDelayMs, maxDelayMs) (floored to an integer ms).
 * Pure: no timers, no mutation of inputs, no pixi/electron. `input.now` is
 * intentionally unused by the current math (reserved for future jitter).
 */
export function nextIdleAction(
  input: IdleScheduleInput,
  cfg: IdleSchedulerConfig = DEFAULT_IDLE_CONFIG
): IdleSchedule {
  const { random, lastTag } = input

  let pool: readonly ActionTag[] = cfg.tags
  if (cfg.avoidRepeat === true && lastTag !== undefined && cfg.tags.length > 1) {
    const filtered = cfg.tags.filter((t) => t !== lastTag)
    if (filtered.length > 0) {
      pool = filtered
    }
  }

  const tagIndex = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  const tag = pool[tagIndex]

  const span = cfg.maxDelayMs - cfg.minDelayMs
  const delayMs = cfg.minDelayMs + Math.floor(random() * span)

  return { tag, delayMs }
}

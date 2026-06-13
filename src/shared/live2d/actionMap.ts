// ============================================================================
// src/shared/live2d/actionMap.ts
// Pure semantic-action model for the Live2D pet. ELECTRON-FREE, PIXI-FREE.
// Single source of truth mapping semantic tags -> Cubism motion group /
// optional motion index / optional expression / playback priority.
// Unit-tested with vitest (node env): NO pixi/electron import here.
// ============================================================================

/**
 * Semantic action tags the rest of the app speaks. UI/AI/file-drop trigger
 * these; the ActionController translates them into concrete motions/expressions.
 *  - 'idle'    : low-priority ambient micro-action (scheduler-driven).
 *  - 'greet'   : on-appear / hello.
 *  - 'talk'    : reserved for Plan 4 AI (registered, NOT triggered in Plan 2).
 *  - 'think'   : reserved for Plan 4 AI (registered, NOT triggered in Plan 2).
 *  - 'happy'   : positive reaction.
 *  - 'react'   : generic tap reaction.
 *  - 'receive' : file-drop visual feedback (Plan 2 visual-only; Plan 3 reuses).
 */
export type ActionTag = 'idle' | 'greet' | 'talk' | 'think' | 'happy' | 'react' | 'receive'

/**
 * Playback priority. Higher wins; a playing higher-priority motion is NOT
 * interrupted by a lower one. Maps 1:1 onto pixi-live2d MotionPriority
 * (IDLE=1, NORMAL=2, FORCE=3) — kept as a plain union here to stay pixi-free.
 *  - 'idle'     -> MotionPriority.IDLE   (auto idle micro-actions)
 *  - 'normal'   -> MotionPriority.NORMAL (greet/talk/think)
 *  - 'reaction' -> MotionPriority.FORCE  (happy/react/receive: always interrupt)
 */
export type ActionPriority = 'idle' | 'normal' | 'reaction'

/**
 * One mapping row. motionGroup is REQUIRED (must exist in the model3.json).
 * motionIndex omitted => random motion within the group. expression optional.
 */
export interface ActionMapEntry {
  motionGroup: string
  motionIndex?: number
  expression?: string
  priority: ActionPriority
}

/** Full tag -> entry table. Every ActionTag must have an entry. */
export type ActionMap = Record<ActionTag, ActionMapEntry>

/**
 * Default mapping for the bundled model (haru_greeter_t03; groups 'Idle','Tap';
 * expressions f00..f07). Swap alongside the model in modelConfig.ts if a
 * different model with different group names is used.
 * talk/think are registered (so resolveAction is total) but map to neutral
 * idle-ish motions and are never triggered in Plan 2.
 */
export const DEFAULT_ACTION_MAP: ActionMap = {
  idle: { motionGroup: 'Idle', priority: 'idle' },
  greet: { motionGroup: 'Tap', expression: 'f00', priority: 'normal' },
  talk: { motionGroup: 'Idle', expression: 'f01', priority: 'normal' },
  think: { motionGroup: 'Idle', expression: 'f02', priority: 'normal' },
  happy: { motionGroup: 'Tap', expression: 'f03', priority: 'reaction' },
  react: { motionGroup: 'Tap', priority: 'reaction' },
  receive: { motionGroup: 'Tap', expression: 'f05', priority: 'reaction' }
}

/**
 * Pure lookup: resolve a semantic tag to its mapping entry. Uses the provided
 * map (defaults to DEFAULT_ACTION_MAP). Total over ActionTag — never throws for
 * a valid tag. No pixi/electron, no I/O, no mutation.
 */
export function resolveAction(
  tag: ActionTag,
  map: ActionMap = DEFAULT_ACTION_MAP
): Readonly<ActionMapEntry> {
  return map[tag]
}

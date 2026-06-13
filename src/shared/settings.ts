// ============================================================================
// src/shared/settings.ts
// DEFAULT_SETTINGS + pure merge/validate logic. ELECTRON-FREE, FS-FREE.
// ============================================================================
import type { Settings, PassthroughMode, PetPosition } from './types'
import { PASSTHROUGH_MODES } from './types'

/** Bumped only when the persisted Settings shape changes incompatibly. */
export const SETTINGS_VERSION = 1

/** Default pet-window bounds used on first launch (centered later by main). */
export const DEFAULT_PET_POSITION: PetPosition = {
  x: 100,
  y: 100,
  width: 300,
  height: 300
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  petPosition: { ...DEFAULT_PET_POSITION },
  passthroughMode: 'auto',
  petVisible: true
}

function isPassthroughMode(value: unknown): value is PassthroughMode {
  return typeof value === 'string' && (PASSTHROUGH_MODES as readonly string[]).includes(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Deep-merge a partial (e.g. parsed JSON from disk, or an IPC patch) onto a
 * known-good defaults object. Unknown keys are ignored; invalid values fall
 * back to the default for that field. Always returns a complete, valid
 * Settings — never throws. Pure (no I/O).
 *
 * Note: this only validates shape/type/positivity of petPosition. Absolute
 * on-screen position bounds (fitting within a connected display's workArea) are
 * enforced downstream by clampPositionToDisplays in ./position, not here.
 */
export function mergeSettings(
  defaults: Settings,
  partial: Partial<Settings> | null | undefined
): Settings {
  const src = partial ?? {}

  const petPosition: PetPosition = { ...defaults.petPosition }
  const p = src.petPosition
  if (p && typeof p === 'object') {
    if (isFiniteNumber(p.x)) petPosition.x = p.x
    if (isFiniteNumber(p.y)) petPosition.y = p.y
    if (isFiniteNumber(p.width) && p.width > 0) petPosition.width = p.width
    if (isFiniteNumber(p.height) && p.height > 0) petPosition.height = p.height
  }

  return {
    version: defaults.version,
    petPosition,
    passthroughMode: isPassthroughMode(src.passthroughMode)
      ? src.passthroughMode
      : defaults.passthroughMode,
    petVisible: typeof src.petVisible === 'boolean' ? src.petVisible : defaults.petVisible
  }
}

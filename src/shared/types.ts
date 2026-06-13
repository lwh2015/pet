// ============================================================================
// src/shared/types.ts
// Single source of truth for Plan 1 domain types. ELECTRON-FREE.
// Importable by main, preload, renderer, and vitest without loading electron.
// ============================================================================

/**
 * Window position + size in screen DIP coordinates (matches Electron getBounds).
 * width/height are persisted so restore is robust even if defaults change.
 */
export interface PetPosition {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Plain data view of an Electron Display's usable area.
 * Passed into pure clamping logic so position.ts never imports electron.
 */
export interface DisplayBounds {
  id: number
  /** Usable area excluding taskbar/dock/menubar (Electron Display.workArea). */
  workArea: { x: number; y: number; width: number; height: number }
}

/**
 * Mouse-passthrough lock mode, chosen from the tray.
 *  - 'auto'                : renderer hit-test drives interactivity (default).
 *  - 'locked-interactive'  : window is always interactive (never click-through).
 *  - 'locked-passthrough'  : window is always click-through (ignores the pet).
 */
export type PassthroughMode = 'auto' | 'locked-interactive' | 'locked-passthrough'

export const PASSTHROUGH_MODES: readonly PassthroughMode[] = [
  'auto',
  'locked-interactive',
  'locked-passthrough'
] as const

/**
 * User-facing settings persisted to userData/settings.json.
 * Keep flat + JSON-serializable. No functions, no Date objects.
 */
export interface Settings {
  /** Schema version for forward-compatible migrations. */
  version: number
  /** Last known pet-window bounds, restored (clamped) on launch. */
  petPosition: PetPosition
  /** Current passthrough lock mode. */
  passthroughMode: PassthroughMode
  /** Whether the pet window is shown (toggled from tray). */
  petVisible: boolean
}

// ---------------------------------------------------------------------------
// Tray menu model (pure, declarative). The main process maps this to
// Electron's Menu.buildFromTemplate; the builder itself stays electron-free
// and unit-testable.
// ---------------------------------------------------------------------------

/** Stable identifiers for tray menu actions (used as the click contract). */
export type TrayItemId =
  | 'toggle-visibility'
  | 'mode-auto'
  | 'mode-locked-interactive'
  | 'mode-locked-passthrough'
  | 'reset-interaction'
  | 'open-panel'
  | 'quit'

export interface TrayMenuItem {
  /** undefined id => separator. */
  id?: TrayItemId
  type: 'normal' | 'radio' | 'separator'
  label?: string
  /** For radio items: whether currently selected. */
  checked?: boolean
  enabled?: boolean
}

export type TrayMenuModel = TrayMenuItem[]

/** Input snapshot the tray menu is rendered from. */
export interface TrayMenuState {
  mode: PassthroughMode
  petVisible: boolean
}

// ---------------------------------------------------------------------------
// IPC payload shapes (the typed wire contract). Channel NAME constants live in
// src/shared/ipc.ts; these are the payload/response types referenced by both
// the preload bridge and the main-process handlers.
// ---------------------------------------------------------------------------

export interface SetInteractivePayload {
  interactive: boolean
}

export interface SettingsChangedPayload {
  settings: Settings
}

export interface PassthroughModeChangedPayload {
  mode: PassthroughMode
}

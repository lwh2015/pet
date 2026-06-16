// ============================================================================
// src/shared/ipc.ts
// Canonical IPC channel name constants + the contextBridge surfaces.
// ELECTRON-FREE: string constants and interfaces only (no runtime electron).
// Pet window exposes RendererApi as window.petApi; panel window exposes the
// strict PanelApi subset as window.panelApi.
// ============================================================================
import type { Settings, PassthroughModeChangedPayload } from './types'

export const IPC = {
  PET_SET_INTERACTIVE: 'pet:setInteractive',
  PET_DRAG_START: 'pet:drag-start',
  PET_DRAG_MOVE: 'pet:drag-move',
  PET_DRAG_END: 'pet:drag-end',
  PET_OPEN_PANEL: 'pet:open-panel',
  PET_PASSTHROUGH_MODE_CHANGED: 'pet:passthrough-mode-changed',
  PET_CURSOR_MOVE: 'pet:cursor-move',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Unsubscribe function returned by every on*() listener registration. */
export type Unsubscribe = () => void

/** Pet-window-local cursor coordinates pushed from main each tick. */
export interface CursorPoint {
  x: number
  y: number
}

/**
 * The exact surface exposed on the pet window as window.petApi.
 * Renderer code calls these; it must NEVER import 'electron' directly.
 * onSettingsChanged forwards the UNWRAPPED Settings (the preload unwraps
 * the { settings } broadcast payload before invoking cb).
 */
export interface RendererApi {
  /** Report the hit-test result (cursor over a solid pet pixel / UI). */
  setInteractive(interactive: boolean): void
  drag: {
    start(): void
    move(): void
    end(): void
  }
  openPanel(): void
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  onSettingsChanged(cb: (settings: Settings) => void): Unsubscribe
  onPassthroughModeChanged(cb: (payload: PassthroughModeChangedPayload) => void): Unsubscribe
  /** Subscribe to pet-window-local cursor updates (whole-screen eye tracking). */
  onCursorMove(cb: (p: CursorPoint) => void): Unsubscribe
}

/**
 * The strict panel-window subset exposed as window.panelApi.
 * NO drag, NO passthrough, NO openPanel. Same unwrapped onSettingsChanged
 * shape as RendererApi.
 */
export interface PanelApi {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  onSettingsChanged(cb: (settings: Settings) => void): Unsubscribe
}

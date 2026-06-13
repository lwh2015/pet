// ============================================================================
// src/shared/ipc.ts
// Canonical IPC channel name constants + the contextBridge surfaces.
// ELECTRON-FREE: string constants and interfaces only (no runtime electron).
// Pet window exposes RendererApi as window.petApi; panel window exposes the
// strict PanelApi subset as window.panelApi.
// ============================================================================
import type { Settings, PassthroughModeChangedPayload, FileRecord, IngestResult } from './types'

export const IPC = {
  PET_SET_INTERACTIVE: 'pet:setInteractive',
  PET_DRAG_START: 'pet:drag-start',
  PET_DRAG_MOVE: 'pet:drag-move',
  PET_DRAG_END: 'pet:drag-end',
  PET_OPEN_PANEL: 'pet:open-panel',
  PET_PASSTHROUGH_MODE_CHANGED: 'pet:passthrough-mode-changed',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',
  // --- Plan 3: file library / ingestion ---
  LIBRARY_LIST: 'library:list',
  LIBRARY_INGEST: 'library:ingest',
  LIBRARY_REMOVE: 'library:remove',
  LIBRARY_OPEN: 'library:open',
  LIBRARY_REVEAL: 'library:reveal',
  LIBRARY_PICK: 'library:pick',
  LIBRARY_CHANGED: 'library:changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Unsubscribe function returned by every on*() listener registration. */
export type Unsubscribe = () => void

/**
 * File-library operations exposed to the PANEL window. ingestPaths is also
 * reachable from the pet window (same channel) for drop-on-pet ingestion.
 */
export interface LibraryApi {
  list(): Promise<FileRecord[]>
  ingestPaths(paths: string[]): Promise<IngestResult[]>
  remove(id: number): Promise<void>
  open(id: number): Promise<void>
  reveal(id: number): Promise<void>
  pick(): Promise<IngestResult[]>
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
  /**
   * Resolve dropped File objects to absolute OS paths via webUtils (runs in
   * preload; '' results are dropped). Synchronous.
   */
  resolveDroppedPaths(files: FileList | File[]): string[]
  /** Ingest the given absolute paths (drop-on-pet). */
  ingestPaths(paths: string[]): Promise<IngestResult[]>
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
  resolveDroppedPaths(files: FileList | File[]): string[]
  library: LibraryApi
  onLibraryChanged(cb: () => void): Unsubscribe
}

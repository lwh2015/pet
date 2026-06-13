// Global Window augmentation for the typed contextBridge surfaces.
// Pet window exposes window.petApi; panel window exposes window.panelApi.
// Both are typed from the single source of truth in src/shared.
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { RendererApi, PanelApi } from '@shared/ipc'

// PanelApi (the panel-window contextBridge surface — a strict subset of the pet
// surface: read/write settings + subscribe to settings:changed) has its single
// source of truth in src/shared/ipc.ts (authored by Task 4.2). It is imported
// here, never re-declared, so window.panelApi stays one type.

declare global {
  interface Window {
    electron: ElectronAPI
    petApi: RendererApi
    panelApi: PanelApi
  }
}

export {}

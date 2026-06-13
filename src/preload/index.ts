// Pet-window preload. Exposes window.petApi (the RendererApi surface) wrapping
// ipcRenderer over the IPC channel-name constants. Later groups EXTEND this
// object (setInteractive, drag.*, onPassthroughModeChanged); this is the base.
import { contextBridge, ipcRenderer, type IpcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC, type RendererApi, type Unsubscribe } from '@shared/ipc'
import type {
  Settings,
  SettingsChangedPayload,
  PassthroughModeChangedPayload
} from '@shared/types'

/**
 * Pure factory for the petApi surface. Takes ipcRenderer as a parameter so the
 * wiring is unit-testable without electron. Later groups add members here.
 */
export function buildPetApi(ipc: IpcRenderer): RendererApi {
  return {
    getSettings(): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_GET)
    },
    setSettings(patch: Partial<Settings>): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_SET, patch)
    },
    openPanel(): void {
      ipc.send(IPC.PET_OPEN_PANEL)
    },
    onSettingsChanged(cb: (settings: Settings) => void): () => void {
      const listener = (_e: unknown, payload: SettingsChangedPayload): void =>
        cb(payload.settings)
      ipc.on(IPC.SETTINGS_CHANGED, listener)
      return () => ipc.removeListener(IPC.SETTINGS_CHANGED, listener)
    },
    // --- 4.4 adds ---
    setInteractive: (interactive: boolean): void => {
      ipc.send(IPC.PET_SET_INTERACTIVE, { interactive })
    },
    onPassthroughModeChanged: (
      cb: (payload: PassthroughModeChangedPayload) => void
    ): Unsubscribe => {
      const l = (_e: unknown, p: PassthroughModeChangedPayload): void => cb(p)
      ipc.on(IPC.PET_PASSTHROUGH_MODE_CHANGED, l)
      return () => ipc.removeListener(IPC.PET_PASSTHROUGH_MODE_CHANGED, l)
    },
    // --- 5.3 adds ---
    drag: {
      start: () => ipc.send(IPC.PET_DRAG_START),
      move: () => ipc.send(IPC.PET_DRAG_MOVE),
      end: () => ipc.send(IPC.PET_DRAG_END)
    }
  }
}

const petApi = buildPetApi(ipcRenderer)

// contextIsolation:true -> expose via contextBridge.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('petApi', petApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when isolation is off)
  window.electron = electronAPI
  // @ts-ignore
  window.petApi = petApi
}

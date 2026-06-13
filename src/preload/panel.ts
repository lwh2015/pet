// D:\aicode\pet\src\preload\panel.ts
// Panel-window preload. Exposes window.panelApi: a STRICT subset of the
// renderer surface (read/write settings + subscribe). No drag, no passthrough,
// no openPanel — the panel never controls the pet directly.
import { contextBridge, ipcRenderer, type IpcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Settings, SettingsChangedPayload } from '@shared/types'

/** Pure factory for the panelApi surface (injected ipcRenderer for testing). */
export function buildPanelApi(ipc: IpcRenderer) {
  return {
    getSettings(): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_GET)
    },
    setSettings(patch: Partial<Settings>): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_SET, patch)
    },
    onSettingsChanged(cb: (settings: Settings) => void): () => void {
      const listener = (_e: unknown, payload: SettingsChangedPayload): void =>
        cb(payload.settings)
      ipc.on(IPC.SETTINGS_CHANGED, listener)
      return () => ipc.removeListener(IPC.SETTINGS_CHANGED, listener)
    }
  }
}

const panelApi = buildPanelApi(ipcRenderer)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('panelApi', panelApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when isolation is off)
  window.panelApi = panelApi
}

// D:\aicode\pet\src\preload\panel.ts
// Panel-window preload. window.panelApi: settings subset + the file library.
import { contextBridge, ipcRenderer, webUtils, type IpcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { PanelApi } from '@shared/ipc'
import type { Settings, SettingsChangedPayload } from '@shared/types'

/** Pure factory for the panelApi surface (injected ipcRenderer + path resolver). */
export function buildPanelApi(
  ipc: IpcRenderer,
  getPathForFile: (file: File) => string = (file) => webUtils.getPathForFile(file)
): PanelApi {
  return {
    getSettings(): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_GET)
    },
    setSettings(patch: Partial<Settings>): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_SET, patch)
    },
    onSettingsChanged(cb: (settings: Settings) => void): () => void {
      const listener = (_e: unknown, payload: SettingsChangedPayload): void => cb(payload.settings)
      ipc.on(IPC.SETTINGS_CHANGED, listener)
      return () => ipc.removeListener(IPC.SETTINGS_CHANGED, listener)
    },
    // --- Plan 3 ---
    resolveDroppedPaths(files: FileList | File[]): string[] {
      const out: string[] = []
      for (const f of Array.from(files)) {
        const p = getPathForFile(f)
        if (p) out.push(p)
      }
      return out
    },
    library: {
      list: () => ipc.invoke(IPC.LIBRARY_LIST),
      ingestPaths: (paths: string[]) => ipc.invoke(IPC.LIBRARY_INGEST, paths),
      remove: (id: number) => ipc.invoke(IPC.LIBRARY_REMOVE, id),
      open: (id: number) => ipc.invoke(IPC.LIBRARY_OPEN, id),
      reveal: (id: number) => ipc.invoke(IPC.LIBRARY_REVEAL, id),
      pick: () => ipc.invoke(IPC.LIBRARY_PICK)
    },
    onLibraryChanged(cb: () => void): () => void {
      const listener = (): void => cb()
      ipc.on(IPC.LIBRARY_CHANGED, listener)
      return () => ipc.removeListener(IPC.LIBRARY_CHANGED, listener)
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

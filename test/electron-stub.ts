// Test-only stub for the 'electron' module so preload modules (index.ts / panel.ts),
// which import named runtime exports (contextBridge, ipcRenderer) at module top,
// can be imported under vitest's node environment. The real node_modules/electron
// entry only exports a path string, so named imports throw at load time. Aliased
// in vitest.config.ts; production builds use the real electron. Keeps the
// purity rule (vitest stays electron-free) intact without altering source files.
import { vi } from 'vitest'

export const contextBridge = {
  exposeInMainWorld: vi.fn()
}

export const ipcRenderer = {
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn()
}

export const webUtils = {}
export const webFrame = {}

export default { contextBridge, ipcRenderer, ipcMain, webUtils, webFrame }

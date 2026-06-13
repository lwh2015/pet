// D:\aicode\pet\src\main\ipc.ts
// registerIpcHandlers(): wires ipcMain handlers/listeners for the Plan 1 base IPC
// channels (settings:get/set + settings:changed broadcast + pet:open-panel),
// delegating to injected seams (deps) so the handler logic is unit-testable.
// `ipcMain` is imported from electron at module top (the test mocks 'electron');
// the single-arg (deps) signature is canonical per the integration contract.
// Later groups ADD their registrations INSIDE this same function: 4.4 adds the
// pet:setInteractive handler, and 5.3 builds the drag controller + persist sink,
// registers the three drag handlers, and replaces the returned flushPersist
// placeholder with the real () => dragController.flushPersist().
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/types'

/**
 * The dependencies registerIpcHandlers needs, injected so the handler logic
 * (persist + broadcast + return) can be tested with fakes. This is the canonical
 * IpcDeps shape: 4.4 consumes `passthrough` and 5.3 consumes `getPetWindow` +
 * `settingsStore` + `broadcastSettingsChanged`; none of them re-author this shape.
 */
export interface IpcDeps {
  /** The settings store (createSettingsStore result). */
  settingsStore: {
    get(): Settings
    set(patch: Partial<Settings>): Settings
  }
  /** Passthrough controller (consumed by 4.4's pet:setInteractive handler). */
  passthrough: import('./passthrough').PassthroughController
  /** Shows/creates the opaque panel window (from panelWindow.ts). */
  showPanelWindow: () => void
  /** Live pet-window getter (drag controller built by 5.3 + broadcast). */
  getPetWindow: () => Electron.BrowserWindow | null
  /** Broadcast full Settings to every live window (destroyed-safe; owned by 6.4). */
  broadcastSettingsChanged: () => void
  /** All live windows to broadcast settings:changed to (may contain nulls). */
  getAllWindows: () => Array<Electron.BrowserWindow | null>
}

/**
 * Handles returned to the bootstrap (6.4). `flushPersist` flushes the pending
 * debounced drag-persist write on before-quit. 7.7's base returns a no-op
 * placeholder; 5.3 replaces it with the real drag-controller flush.
 */
export interface IpcHandles {
  /** Flush the pending debounced drag-persist write (called on before-quit). */
  flushPersist: () => void
}

/**
 * Register the Plan 1 base IPC handlers and return the IpcHandles. `ipcMain` is
 * the real Electron import at runtime (mocked in tests). Call once at startup.
 */
export function registerIpcHandlers(deps: IpcDeps): IpcHandles {
  // settings:get -> current merged Settings (request/response).
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return deps.settingsStore.get()
  })

  // settings:set -> merge+persist patch, broadcast, return new Settings.
  ipcMain.handle(IPC.SETTINGS_SET, (_event, ...args: unknown[]) => {
    const patch = (args[0] ?? {}) as Partial<Settings>
    const next = deps.settingsStore.set(patch)
    deps.broadcastSettingsChanged()
    return next
  })

  // pet:open-panel -> show/create the opaque panel window (fire-and-forget).
  ipcMain.on(IPC.PET_OPEN_PANEL, () => {
    deps.showPanelWindow()
  })

  // pet:setInteractive — fire-and-forget hit-test result from the pet renderer.
  // Gated by resolveIgnoreMouse inside the controller: honored only in 'auto'.
  ipcMain.on(IPC.PET_SET_INTERACTIVE, (_e, payload) =>
    deps.passthrough.setOverInteractive(Boolean(payload?.interactive))
  )

  // Placeholder flush; 5.3 replaces this with () => dragController.flushPersist().
  return { flushPersist: () => {} }
}

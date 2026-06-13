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
import type { Settings, FileRecord, IngestResult } from '@shared/types'
// 5.3 adds:
import { createDragController } from './dragController'

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
  /** File library store (createLibraryStore result; structural subset). */
  libraryStore: {
    list(): FileRecord[]
    ingest(absPath: string): Promise<FileRecord>
    remove(id: number): void
    blobPathFor(id: number): string | undefined
    materializeForOpen(id: number): string | undefined
  }
  /**
   * Electron shell/dialog seams. Typed as Pick<Electron.*> so the RAW electron
   * `shell`/`dialog` objects inject directly (index.ts) with no adapter — a plain
   * `{ showOpenDialog(options): ... }` shape is NOT assignable from electron's
   * OVERLOADED `dialog.showOpenDialog` (arity mismatch, TS2322). Tests pass fakes
   * cast `as never`, so the Pick types don't burden the test harness.
   */
  shell: Pick<Electron.Shell, 'openPath' | 'showItemInFolder'>
  dialog: Pick<Electron.Dialog, 'showOpenDialog'>
  /** Broadcast library:changed to the panel (destroyed-safe; owned by index.ts). */
  broadcastLibraryChanged: () => void
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

  // --- 5.3: manual-drag controller + channels ---
  // Persist sink (canonical, contract §5/§7): write the clamped position to disk,
  // then broadcast full Settings to every live window via the injected, destroyed-
  // safe broadcaster. The controller never broadcasts itself, so the quit-time
  // flush path can persist even after windows are destroyed.
  const dragController = createDragController(deps.getPetWindow, (pos) => {
    deps.settingsStore.set({ petPosition: pos })
    deps.broadcastSettingsChanged()
  })

  ipcMain.on(IPC.PET_DRAG_START, () => dragController.onStart())
  ipcMain.on(IPC.PET_DRAG_MOVE, () => dragController.onMove())
  ipcMain.on(IPC.PET_DRAG_END, () => dragController.onEnd())

  // --- Plan 3: file library / ingestion ---
  // Shared ingest loop: each path -> ok/record or error; broadcast if any ok.
  const ingestAll = async (paths: string[]): Promise<IngestResult[]> => {
    const results: IngestResult[] = []
    for (const p of paths) {
      try {
        results.push({ ok: true, record: await deps.libraryStore.ingest(p) })
      } catch (err) {
        results.push({
          ok: false,
          sourcePath: p,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    if (results.some((r) => r.ok)) deps.broadcastLibraryChanged()
    return results
  }

  ipcMain.handle(IPC.LIBRARY_LIST, () => deps.libraryStore.list())

  ipcMain.handle(IPC.LIBRARY_INGEST, (_event, ...args: unknown[]) => {
    const paths = Array.isArray(args[0]) ? (args[0] as string[]) : []
    return ingestAll(paths)
  })

  ipcMain.handle(IPC.LIBRARY_REMOVE, (_event, ...args: unknown[]) => {
    deps.libraryStore.remove(Number(args[0]))
    deps.broadcastLibraryChanged()
  })

  ipcMain.handle(IPC.LIBRARY_OPEN, async (_event, ...args: unknown[]) => {
    const p = deps.libraryStore.materializeForOpen(Number(args[0]))
    if (p) await deps.shell.openPath(p)
  })

  ipcMain.handle(IPC.LIBRARY_REVEAL, (_event, ...args: unknown[]) => {
    const p = deps.libraryStore.blobPathFor(Number(args[0]))
    if (p) deps.shell.showItemInFolder(p)
  })

  ipcMain.handle(IPC.LIBRARY_PICK, async () => {
    const { canceled, filePaths } = await deps.dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return []
    return ingestAll(filePaths)
  })

  return { flushPersist: () => dragController.flushPersist() }
}

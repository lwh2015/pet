import { app } from 'electron'
import { IPC } from '@shared/ipc'
import type { PassthroughMode, PassthroughModeChangedPayload } from '@shared/types'
import { getPetWindow, getPanelWindow, togglePetVisibility } from './windows/windowManager'
import { showPanelWindow } from './windows/panelWindow'
import { createPetWindow } from './windows/petWindow'
import { createSettingsStore } from './settingsStore'
import { createPassthroughController } from './passthrough'
import { registerIpcHandlers } from './ipc'
import { startDisplayWatcher } from './displayWatcher'
import { createTray, type TrayHandlers } from './tray'

// --- Single-instance lock (before any window creation, R5) --------------------
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const pet = getPetWindow()
    if (pet && !pet.isDestroyed()) {
      if (!pet.isVisible()) pet.show()
      pet.focus()
    }
    const panel = getPanelWindow()
    if (panel && !panel.isDestroyed()) {
      if (panel.isMinimized()) panel.restore()
      panel.show()
      panel.focus()
    }
  })
  bootstrap()
}

function bootstrap(): void {
  app.whenReady().then(() => {
    // macOS: pure accessory (no Dock). Pairs with LSUIElement for no-flash start.
    if (process.platform === 'darwin') {
      app.setActivationPolicy('accessory')
    }

    // 1) Settings store + load.
    const settingsStore = createSettingsStore(app.getPath('userData'))
    let settings = settingsStore.load()

    // 2) Pet window (factory restores clamped position, registers ref, honors petVisible).
    createPetWindow(settings)

    // 3) Passthrough controller bound to the live pet window; init from settings.
    const passthrough = createPassthroughController(getPetWindow)
    passthrough.setMode(settings.passthroughMode)
    // Resting state: in 'auto' with overInteractive=false -> ignore=true+forward.
    // Apply unconditionally (valid pre-show; do NOT add a late ready-to-show here).
    passthrough.apply()

    // 4) Broadcast helper: full Settings to every live window (destroyed-safe).
    const broadcastSettingsChanged = (): void => {
      const payload = { settings: settingsStore.get() }
      for (const w of [getPetWindow(), getPanelWindow()]) {
        if (w && !w.isDestroyed()) w.webContents.send(IPC.SETTINGS_CHANGED, payload)
      }
    }

    // 5) IPC: base (settings:get/set, pet:open-panel) + extensions (setInteractive, drag).
    //    Returns { flushPersist } (the drag-controller flush handle). One deps shape.
    const ipcHandles = registerIpcHandlers({
      settingsStore,
      passthrough,
      showPanelWindow,
      getPetWindow,
      broadcastSettingsChanged,
      getAllWindows: () => [getPetWindow(), getPanelWindow()]
    })

    // 6) Display watcher (re-clamp on monitor changes). Returns a disposer.
    const stopDisplayWatcher = startDisplayWatcher(getPetWindow)

    // 7) Passthrough-mode broadcast to the pet renderer (always via IPC constant).
    const broadcastPassthroughMode = (mode: PassthroughMode): void => {
      getPetWindow()?.webContents.send(IPC.PET_PASSTHROUGH_MODE_CHANGED, {
        mode
      } satisfies PassthroughModeChangedPayload)
    }

    // 8) Tray.
    const handlers: TrayHandlers = {
      getState: () => ({ mode: passthrough.getMode(), petVisible: settings.petVisible }),
      onToggleVisibility: () => {
        settings = settingsStore.set({ petVisible: !settings.petVisible })
        togglePetVisibility(settings.petVisible)
        broadcastSettingsChanged()
      },
      onSetMode: (mode) => {
        passthrough.setMode(mode)
        passthrough.apply()
        settings = settingsStore.set({ passthroughMode: mode })
        broadcastSettingsChanged()
        broadcastPassthroughMode(mode)
      },
      onResetInteraction: () => passthrough.reset(),
      onOpenPanel: () => showPanelWindow(),
      onQuit: () => app.quit()
    }
    createTray(handlers)

    // 9) Flush pending drag-persist on quit, then stop the watcher.
    app.on('before-quit', () => {
      ipcHandles.flushPersist()
      stopDisplayWatcher()
    })

    app.on('activate', () => {
      if (!getPetWindow()) createPetWindow(settings)
    })
  })

  app.on('window-all-closed', () => {
    // Overlay/tray app: do NOT quit when the panel closes. Quit only via tray.
  })
}

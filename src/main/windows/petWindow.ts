// src/main/windows/petWindow.ts  — BASE authored by 3.1; setPetWindow added by 7.1.
// createPetWindow(): transparent, frameless, always-on-top pet window factory. GLUE.
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { clampPositionToDisplays } from '@shared/position'
import type { PetPosition, Settings } from '@shared/types'
import { setPetWindow } from './windowManager'
import { readDisplayBounds } from '../displays'

/**
 * Create the transparent/frameless always-on-top pet window from the loaded
 * Settings. Restores the clamped saved position, registers the window into
 * windowManager, and shows it on ready-to-show ONLY when settings.petVisible.
 * Must be called after app.whenReady() (touches `screen`). Returns the window.
 */
export function createPetWindow(settings: Settings): BrowserWindow {
  const saved: PetPosition = settings.petPosition
  const clamped: PetPosition = clampPositionToDisplays(saved, readDisplayBounds())

  const win = new BrowserWindow({
    x: clamped.x,
    y: clamped.y,
    width: clamped.width,
    height: clamped.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    hasShadow: false,
    roundedCorners: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  // Register so tray/ipc/passthrough/drag reach this window without circular imports.
  setPetWindow(win)

  // Honor persisted visibility: show on first paint ONLY if petVisible is true.
  // (Showing only on ready-to-show avoids a white/opaque flash on a transparent
  // window — Research R3.)
  win.once('ready-to-show', () => {
    if (settings.petVisible) win.show()
  })

  // Highest documented stacking level: above the taskbar/Dock and other
  // always-on-top windows (Research R3).
  win.setAlwaysOnTop(true, 'screen-saver')

  // macOS: follow across Spaces and stay over other apps' fullscreen windows.
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // Load the pet renderer route: dev uses the HMR server URL, prod the built
  // index.html (CommonJS __dirname is available — do not migrate to ESM).
  // Load returns a Promise; tolerate transient failures for this glue shell.
  if (process.env.ELECTRON_RENDERER_URL) {
    win
      .loadURL(process.env.ELECTRON_RENDERER_URL)
      .catch((err) => console.error('pet renderer load failed', err))
  } else {
    win
      .loadFile(join(__dirname, '../renderer/index.html'))
      .catch((err) => console.error('pet renderer load failed', err))
  }

  return win
}

/**
 * Restores the saved pet-window bounds, clamped to currently-connected
 * displays so an off-screen / removed-monitor position is pulled on-screen.
 * Exported so the display watcher and tests reuse the same clamp path as the
 * launch restore that createPetWindow performs inline.
 * Must be called AFTER app is ready (uses the screen module).
 */
export function restorePetPosition(win: BrowserWindow, saved: PetPosition): void {
  const clamped = clampPositionToDisplays(saved, readDisplayBounds())
  win.setBounds({
    x: clamped.x,
    y: clamped.y,
    width: clamped.width,
    height: clamped.height
  })
}

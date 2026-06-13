// ============================================================================
// src/main/windows/panelWindow.ts
// Normal, opaque, resizable panel window. Loads the panel React route.
// create-or-focus: showPanelWindow() reuses an existing window if open,
// otherwise creates one. The single panel ref is owned by windowManager
// (setPanelWindow / getPanelWindow) — this module keeps NO local ref.
// GLUE — manually verified.
// ============================================================================
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { setPanelWindow, getPanelWindow } from './windowManager'

/**
 * Create the panel BrowserWindow (hidden until ready-to-show).
 * Normal opaque resizable window — NOT transparent/frameless.
 * Registers itself into windowManager via setPanelWindow(win).
 */
export function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 480,
    minHeight: 360,
    show: false,
    resizable: true,
    title: 'Pet Panel',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/panel.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  // Load the second renderer entry (panel.html).
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/panel.html'))
  }

  // Register the single panel ref in windowManager. No local module ref and no
  // 'closed' handler: getPanelWindow() already returns null for a destroyed
  // window via its isDestroyed() guard.
  setPanelWindow(win)
  return win
}

/**
 * create-or-focus: open the panel if it does not exist, otherwise restore +
 * focus the existing one. Called from the tray ('open-panel') and from the
 * pet:open-panel IPC command. Reads the live ref from windowManager.
 */
export function showPanelWindow(): BrowserWindow {
  const existing = getPanelWindow()
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    if (!existing.isVisible()) existing.show()
    existing.focus()
    return existing
  }
  return createPanelWindow()
}

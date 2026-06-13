// D:\aicode\pet\src\main\windows\windowManager.ts
// Module-scope window references + accessor/helper functions shared by
// tray / ipc / passthrough / dragController without circular imports.
// Electron is referenced only as a TYPE (Electron.BrowserWindow); no runtime
// import of 'electron', so this stays importable in main without side effects.

let petWindow: Electron.BrowserWindow | null = null
let panelWindow: Electron.BrowserWindow | null = null

function isAlive(win: Electron.BrowserWindow | null): win is Electron.BrowserWindow {
  return win !== null && !win.isDestroyed()
}

/** Register the pet window. Called by createPetWindow() after construction. */
export function setPetWindow(win: Electron.BrowserWindow): void {
  petWindow = win
}

/** Returns the live pet window, or null if absent/destroyed. */
export function getPetWindow(): Electron.BrowserWindow | null {
  return isAlive(petWindow) ? petWindow : null
}

/** Register the panel window. Called by createPanelWindow() after construction. */
export function setPanelWindow(win: Electron.BrowserWindow): void {
  panelWindow = win
}

/** Returns the live panel window, or null if absent/destroyed. */
export function getPanelWindow(): Electron.BrowserWindow | null {
  return isAlive(panelWindow) ? panelWindow : null
}

/**
 * Show/hide the pet window. Returns the resulting visibility (the requested
 * value) so callers (tray) can persist petVisible to settings. No-op (still
 * returns `visible`) when the pet window is absent.
 */
export function togglePetVisibility(visible: boolean): boolean {
  const win = getPetWindow()
  if (win) {
    if (visible) win.show()
    else win.hide()
  }
  return visible
}

/** TEST-ONLY: clears the module-scope refs between unit tests. */
export function __resetWindowManagerForTests(): void {
  petWindow = null
  panelWindow = null
}

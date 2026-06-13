// ============================================================================
// src/main/tray.ts
// createTray(): builds the Electron Tray, keeps a module-scope ref (or it is
// GC'd and disappears), and rebuilds its context menu from the pure
// buildTrayMenuModel(state) whenever app state changes. GLUE — verified manually.
// ============================================================================
import {
  app,
  Tray,
  Menu,
  nativeImage,
  type NativeImage,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import { buildTrayMenuModel } from '@shared/trayMenu'
import type { TrayMenuState, TrayItemId, PassthroughMode } from '@shared/types'

// Keep a module-scope ref — losing it lets the GC destroy the tray icon.
let tray: Tray | null = null

/** Callbacks the tray invokes; wired by the caller (index.ts) to the real
 *  window/passthrough/settings glue so this module stays dependency-light. */
export interface TrayHandlers {
  getState(): TrayMenuState
  onToggleVisibility(): void
  onSetMode(mode: PassthroughMode): void
  onResetInteraction(): void
  onOpenPanel(): void
  onQuit(): void
}

function resolveIconPath(): string {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.ico'
  // Dev: resources live at <root>/resources (two levels up from out/main).
  // Prod: shipped via electron-builder extraResources -> <resourcesPath>/resources/<file>.
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', file)
  }
  return join(__dirname, '../../resources', file)
}

/**
 * Load the tray icon, guarding against an empty NativeImage (which on Windows
 * makes new Tray() throw or produce an invisible icon). Falls back to a known
 * 1x1 opaque image so new Tray never receives an empty image.
 */
function loadTrayImage(): NativeImage {
  const img = nativeImage.createFromPath(resolveIconPath())
  if (!img.isEmpty()) {
    return img
  }
  // Known-valid fallback: a 16x16 white square data URL so the tray is never
  // empty even if the bundled icon failed to load.
  const fallback = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNkYPhfz0BkYBxVSFNAFY1QwUEFADj4Bf2gB1k4AAAAAElFTkSuQmCC'
  )
  return fallback
}

function idToMode(id: TrayItemId): PassthroughMode | null {
  switch (id) {
    case 'mode-auto':
      return 'auto'
    case 'mode-locked-interactive':
      return 'locked-interactive'
    case 'mode-locked-passthrough':
      return 'locked-passthrough'
    default:
      return null
  }
}

function buildElectronMenu(handlers: TrayHandlers): Menu {
  const model = buildTrayMenuModel(handlers.getState())
  const template: MenuItemConstructorOptions[] = model.map((item) => {
    if (item.type === 'separator') {
      return { type: 'separator' }
    }
    const id = item.id as TrayItemId
    return {
      label: item.label,
      type: item.type,
      checked: item.checked,
      enabled: item.enabled ?? true,
      click: () => {
        switch (id) {
          case 'toggle-visibility':
            handlers.onToggleVisibility()
            break
          case 'reset-interaction':
            handlers.onResetInteraction()
            break
          case 'open-panel':
            handlers.onOpenPanel()
            break
          case 'quit':
            handlers.onQuit()
            break
          default: {
            const mode = idToMode(id)
            if (mode) handlers.onSetMode(mode)
          }
        }
        // State changed -> rebuild so labels/radios reflect the new state.
        refreshTrayMenu(handlers)
      }
    }
  })
  return Menu.buildFromTemplate(template)
}

/** Rebuild and re-apply the context menu from current state. */
export function refreshTrayMenu(handlers: TrayHandlers): void {
  if (!tray) return
  const menu = buildElectronMenu(handlers)
  if (process.platform === 'darwin') {
    // On macOS we DON'T setContextMenu (it would hijack left-click); we pop it
    // up on right-click instead and keep a reference for that.
    tray.removeAllListeners('right-click')
    tray.on('right-click', () => tray?.popUpContextMenu(menu))
    // Left click also opens the menu for discoverability on mac.
    tray.removeAllListeners('click')
    tray.on('click', () => tray?.popUpContextMenu(menu))
  } else {
    tray.setContextMenu(menu)
  }
}

/**
 * Create the Tray after app.whenReady(). Returns the Tray and wires its
 * menu from buildTrayMenuModel. Keep the returned value alive (this module
 * already holds a ref).
 */
export function createTray(handlers: TrayHandlers): Tray {
  const icon = loadTrayImage()
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }
  tray = new Tray(icon)
  tray.setToolTip('Desktop Pet')

  if (process.platform !== 'darwin') {
    // Windows: left-click opens the panel; right-click shows the menu.
    tray.on('click', () => handlers.onOpenPanel())
  }

  refreshTrayMenu(handlers)
  return tray
}

export function getTray(): Tray | null {
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

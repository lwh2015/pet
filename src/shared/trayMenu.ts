// ============================================================================
// src/shared/trayMenu.ts
// Pure, declarative tray-menu model builder. ELECTRON-FREE.
// The main process maps the returned TrayMenuModel to Menu.buildFromTemplate;
// this builder stays electron-free and unit-testable.
// ============================================================================
import type { TrayMenuModel, TrayMenuItem, TrayMenuState, PassthroughMode } from './types'

function separator(): TrayMenuItem {
  return { type: 'separator' }
}

function modeRadio(
  id: Extract<
    TrayMenuItem['id'],
    'mode-auto' | 'mode-locked-interactive' | 'mode-locked-passthrough'
  >,
  label: string,
  mode: PassthroughMode,
  current: PassthroughMode
): TrayMenuItem {
  return { id, type: 'radio', label, checked: mode === current }
}

/**
 * Build the declarative tray menu model for the given app state.
 * Order (stable, click handlers bind by id):
 *   toggle-visibility, ─, mode-auto, mode-locked-interactive,
 *   mode-locked-passthrough, reset-interaction, ─, open-panel, ─, quit
 * Pure: no electron, no side effects.
 */
export function buildTrayMenuModel(state: TrayMenuState): TrayMenuModel {
  return [
    {
      id: 'toggle-visibility',
      type: 'normal',
      label: state.petVisible ? 'Hide Pet' : 'Show Pet'
    },
    separator(),
    modeRadio('mode-auto', 'Auto (hit-test)', 'auto', state.mode),
    modeRadio('mode-locked-interactive', 'Always Interactive', 'locked-interactive', state.mode),
    modeRadio('mode-locked-passthrough', 'Always Click-through', 'locked-passthrough', state.mode),
    { id: 'reset-interaction', type: 'normal', label: 'Reset Interaction' },
    separator(),
    { id: 'open-panel', type: 'normal', label: 'Open Panel' },
    separator(),
    { id: 'quit', type: 'normal', label: 'Quit' }
  ]
}

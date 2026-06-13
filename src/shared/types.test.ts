import { describe, it, expect } from 'vitest'
import { PASSTHROUGH_MODES, type PassthroughMode, type Settings, type TrayItemId } from './types'

describe('shared/types', () => {
  it('PASSTHROUGH_MODES contains exactly the three modes in order', () => {
    expect(PASSTHROUGH_MODES).toEqual(['auto', 'locked-interactive', 'locked-passthrough'])
  })

  it('PASSTHROUGH_MODES has no extra members', () => {
    expect(PASSTHROUGH_MODES).toHaveLength(3)
  })

  it('a value typed as PassthroughMode is one of the runtime modes', () => {
    const mode: PassthroughMode = 'auto'
    expect((PASSTHROUGH_MODES as readonly string[]).includes(mode)).toBe(true)
  })

  it('Settings is structurally constructable (compile + runtime guard)', () => {
    const s: Settings = {
      version: 1,
      petPosition: { x: 0, y: 0, width: 300, height: 300 },
      passthroughMode: 'auto',
      petVisible: true
    }
    expect(s.petPosition.width).toBe(300)
    expect(s.passthroughMode).toBe('auto')
  })

  it('every TrayItemId literal is a non-empty string', () => {
    const ids: TrayItemId[] = [
      'toggle-visibility',
      'mode-auto',
      'mode-locked-interactive',
      'mode-locked-passthrough',
      'reset-interaction',
      'open-panel',
      'quit'
    ]
    for (const id of ids) expect(id.length).toBeGreaterThan(0)
  })
})

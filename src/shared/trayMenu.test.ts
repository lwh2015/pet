import { describe, it, expect } from 'vitest'
import { buildTrayMenuModel } from './trayMenu'
import type { TrayMenuState, TrayItemId } from './types'

function idsOf(model: ReturnType<typeof buildTrayMenuModel>): (TrayItemId | undefined)[] {
  return model.map((item) => item.id)
}

describe('buildTrayMenuModel', () => {
  const baseAuto: TrayMenuState = { mode: 'auto', petVisible: true }

  it('produces items in the canonical order with separators', () => {
    const model = buildTrayMenuModel(baseAuto)
    expect(idsOf(model)).toEqual([
      'toggle-visibility',
      undefined, // separator
      'mode-auto',
      'mode-locked-interactive',
      'mode-locked-passthrough',
      'reset-interaction',
      undefined, // separator
      'open-panel',
      undefined, // separator
      'quit'
    ])
  })

  it('labels toggle-visibility "Hide Pet" when the pet is visible', () => {
    const model = buildTrayMenuModel({ mode: 'auto', petVisible: true })
    const toggle = model.find((i) => i.id === 'toggle-visibility')
    expect(toggle?.label).toBe('Hide Pet')
    expect(toggle?.type).toBe('normal')
  })

  it('labels toggle-visibility "Show Pet" when the pet is hidden', () => {
    const model = buildTrayMenuModel({ mode: 'auto', petVisible: false })
    const toggle = model.find((i) => i.id === 'toggle-visibility')
    expect(toggle?.label).toBe('Show Pet')
  })

  it('marks the three mode items as radio type', () => {
    const model = buildTrayMenuModel(baseAuto)
    for (const id of ['mode-auto', 'mode-locked-interactive', 'mode-locked-passthrough'] as const) {
      const item = model.find((i) => i.id === id)
      expect(item?.type).toBe('radio')
    }
  })

  it('checks exactly the mode item matching state.mode (auto)', () => {
    const model = buildTrayMenuModel({ mode: 'auto', petVisible: true })
    expect(model.find((i) => i.id === 'mode-auto')?.checked).toBe(true)
    expect(model.find((i) => i.id === 'mode-locked-interactive')?.checked).toBe(false)
    expect(model.find((i) => i.id === 'mode-locked-passthrough')?.checked).toBe(false)
  })

  it('checks exactly the mode item matching state.mode (locked-passthrough)', () => {
    const model = buildTrayMenuModel({ mode: 'locked-passthrough', petVisible: true })
    expect(model.find((i) => i.id === 'mode-auto')?.checked).toBe(false)
    expect(model.find((i) => i.id === 'mode-locked-interactive')?.checked).toBe(false)
    expect(model.find((i) => i.id === 'mode-locked-passthrough')?.checked).toBe(true)
  })

  it('checks exactly the mode item matching state.mode (locked-interactive)', () => {
    const model = buildTrayMenuModel({ mode: 'locked-interactive', petVisible: false })
    expect(model.find((i) => i.id === 'mode-auto')?.checked).toBe(false)
    expect(model.find((i) => i.id === 'mode-locked-interactive')?.checked).toBe(true)
    expect(model.find((i) => i.id === 'mode-locked-passthrough')?.checked).toBe(false)
  })

  it('gives reset-interaction, open-panel and quit normal type and stable labels', () => {
    const model = buildTrayMenuModel(baseAuto)
    expect(model.find((i) => i.id === 'reset-interaction')).toMatchObject({
      type: 'normal',
      label: 'Reset Interaction'
    })
    expect(model.find((i) => i.id === 'open-panel')).toMatchObject({
      type: 'normal',
      label: 'Open Panel'
    })
    expect(model.find((i) => i.id === 'quit')).toMatchObject({
      type: 'normal',
      label: 'Quit'
    })
  })

  it('gives every separator type "separator" and no id', () => {
    const model = buildTrayMenuModel(baseAuto)
    const separators = model.filter((i) => i.type === 'separator')
    expect(separators).toHaveLength(3)
    for (const sep of separators) {
      expect(sep.id).toBeUndefined()
    }
  })

  it('labels the three mode radios with human-readable text', () => {
    const model = buildTrayMenuModel(baseAuto)
    expect(model.find((i) => i.id === 'mode-auto')?.label).toBe('Auto (hit-test)')
    expect(model.find((i) => i.id === 'mode-locked-interactive')?.label).toBe('Always Interactive')
    expect(model.find((i) => i.id === 'mode-locked-passthrough')?.label).toBe(
      'Always Click-through'
    )
  })
})

import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_PET_POSITION, SETTINGS_VERSION, mergeSettings } from './settings'
import type { Settings } from './types'

describe('DEFAULT_SETTINGS', () => {
  it('is a complete valid Settings with version, position, mode, visible', () => {
    expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION)
    expect(DEFAULT_SETTINGS.passthroughMode).toBe('auto')
    expect(DEFAULT_SETTINGS.petVisible).toBe(true)
    expect(DEFAULT_SETTINGS.petPosition).toEqual(DEFAULT_PET_POSITION)
  })

  it('petPosition is a copy, not the same reference as DEFAULT_PET_POSITION', () => {
    expect(DEFAULT_SETTINGS.petPosition).not.toBe(DEFAULT_PET_POSITION)
  })
})

describe('mergeSettings', () => {
  it('returns a full defaults clone when partial is null', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS)
  })

  it('returns a full defaults clone when partial is undefined', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('returns a full defaults clone when partial is an empty object', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS)
  })

  it('does not mutate the defaults object', () => {
    const frozen = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings
    mergeSettings(DEFAULT_SETTINGS, { petVisible: false })
    expect(DEFAULT_SETTINGS).toEqual(frozen)
  })

  it('overrides petVisible when a boolean is supplied', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { petVisible: false }).petVisible).toBe(false)
  })

  it('ignores a non-boolean petVisible and keeps the default', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      petVisible: 'yes' as unknown as boolean
    })
    expect(result.petVisible).toBe(true)
  })

  it('accepts a valid passthroughMode', () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { passthroughMode: 'locked-passthrough' }).passthroughMode
    ).toBe('locked-passthrough')
  })

  it('clamps an invalid passthroughMode back to the default', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      passthroughMode: 'bogus' as unknown as Settings['passthroughMode']
    })
    expect(result.passthroughMode).toBe('auto')
  })

  it('deep-merges a partial petPosition (x/y override, width/height kept)', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      petPosition: { x: 500, y: 600 } as Settings['petPosition']
    })
    expect(result.petPosition).toEqual({
      x: 500,
      y: 600,
      width: DEFAULT_PET_POSITION.width,
      height: DEFAULT_PET_POSITION.height
    })
  })

  it('rejects non-finite position numbers and keeps the default for that field', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      petPosition: {
        x: NaN,
        y: Infinity,
        width: 400,
        height: 400
      } as Settings['petPosition']
    })
    expect(result.petPosition.x).toBe(DEFAULT_PET_POSITION.x)
    expect(result.petPosition.y).toBe(DEFAULT_PET_POSITION.y)
    expect(result.petPosition.width).toBe(400)
    expect(result.petPosition.height).toBe(400)
  })

  it('rejects zero/negative width and height, keeping defaults for those fields', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      petPosition: {
        x: 10,
        y: 20,
        width: 0,
        height: -50
      } as Settings['petPosition']
    })
    expect(result.petPosition.x).toBe(10)
    expect(result.petPosition.y).toBe(20)
    expect(result.petPosition.width).toBe(DEFAULT_PET_POSITION.width)
    expect(result.petPosition.height).toBe(DEFAULT_PET_POSITION.height)
  })

  it('ignores unknown keys entirely', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      somethingUnknown: 42,
      petVisible: false
    } as unknown as Partial<Settings>)
    expect(result).toEqual({ ...DEFAULT_SETTINGS, petVisible: false })
    expect((result as unknown as Record<string, unknown>).somethingUnknown).toBeUndefined()
  })

  it('preserves defaults.version even if partial supplies a different version', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      version: 999 as Settings['version']
    })
    expect(result.version).toBe(DEFAULT_SETTINGS.version)
  })

  it('preserves the default petPosition when partial.petPosition is null', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {
      petPosition: null as unknown as Settings['petPosition']
    })
    expect(result.petPosition).toEqual(DEFAULT_PET_POSITION)
  })

  it('preserves the default petPosition when partial.petPosition is absent', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, { petVisible: false })
    expect(result.petPosition).toEqual(DEFAULT_PET_POSITION)
  })

  it('returns a fresh petPosition, not the DEFAULT_SETTINGS reference', () => {
    const result = mergeSettings(DEFAULT_SETTINGS, {})
    expect(result.petPosition).not.toBe(DEFAULT_SETTINGS.petPosition)
  })

  it('returns a fresh petPosition, not the supplied partial reference', () => {
    const partialPosition = { x: 500, y: 600 } as Settings['petPosition']
    const result = mergeSettings(DEFAULT_SETTINGS, {
      petPosition: partialPosition
    })
    expect(result.petPosition).not.toBe(partialPosition)
  })
})

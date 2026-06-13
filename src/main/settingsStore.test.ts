import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsStore } from './settingsStore'
import { DEFAULT_SETTINGS } from '@shared/settings'

// NOTE: this test imports NO electron. createSettingsStore takes userDataDir
// as a plain string, so the file I/O is exercised against a real tmp dir.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pet-settings-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createSettingsStore', () => {
  it('getFilePath returns <userDataDir>/settings.json', () => {
    const store = createSettingsStore(dir)
    expect(store.getFilePath()).toBe(join(dir, 'settings.json'))
  })

  it('load returns DEFAULT_SETTINGS when the file does not exist', () => {
    const store = createSettingsStore(dir)
    expect(store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('load returns DEFAULT_SETTINGS when the file is corrupt JSON', () => {
    writeFileSync(join(dir, 'settings.json'), '{ this is : not json', 'utf8')
    const store = createSettingsStore(dir)
    expect(store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('load merges a partial on-disk file onto defaults', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ petVisible: false, passthroughMode: 'locked-passthrough' }),
      'utf8'
    )
    const store = createSettingsStore(dir)
    const loaded = store.load()
    expect(loaded.petVisible).toBe(false)
    expect(loaded.passthroughMode).toBe('locked-passthrough')
    expect(loaded.petPosition).toEqual(DEFAULT_SETTINGS.petPosition)
  })

  it('load coerces invalid on-disk values back to defaults', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ passthroughMode: 'bogus', petVisible: 'nope' }),
      'utf8'
    )
    const store = createSettingsStore(dir)
    const loaded = store.load()
    expect(loaded.passthroughMode).toBe('auto')
    expect(loaded.petVisible).toBe(true)
  })

  it('get returns DEFAULT_SETTINGS before any load/set', () => {
    const store = createSettingsStore(dir)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('set merges a patch, writes the file, and returns the new full Settings', () => {
    const store = createSettingsStore(dir)
    const result = store.set({ petVisible: false })
    expect(result.petVisible).toBe(false)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
    const onDisk = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(onDisk.petVisible).toBe(false)
  })

  it('set updates the cache so a subsequent get reflects the patch', () => {
    const store = createSettingsStore(dir)
    store.set({ passthroughMode: 'locked-interactive' })
    expect(store.get().passthroughMode).toBe('locked-interactive')
  })

  it('set deep-merges petPosition without losing untouched fields', () => {
    const store = createSettingsStore(dir)
    const result = store.set({
      petPosition: {
        x: 42,
        y: 84,
        width: DEFAULT_SETTINGS.petPosition.width,
        height: DEFAULT_SETTINGS.petPosition.height
      }
    })
    expect(result.petPosition.x).toBe(42)
    expect(result.petPosition.y).toBe(84)
    expect(result.petPosition.width).toBe(DEFAULT_SETTINGS.petPosition.width)
  })

  it('set called before load() preserves existing on-disk settings (no clobber)', () => {
    // A previous run saved a custom petPosition to disk.
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        version: DEFAULT_SETTINGS.version,
        petPosition: { x: 777, y: 888, width: 320, height: 320 },
        passthroughMode: 'locked-interactive',
        petVisible: true
      }),
      'utf8'
    )
    // Fresh store; we call set() WITHOUT calling load() first.
    const store = createSettingsStore(dir)
    const result = store.set({ petVisible: false })
    // The patch is applied...
    expect(result.petVisible).toBe(false)
    // ...but the previously-saved fields are preserved, not reset to defaults.
    expect(result.petPosition).toEqual({ x: 777, y: 888, width: 320, height: 320 })
    expect(result.passthroughMode).toBe('locked-interactive')
    // And the same is true on disk.
    const onDisk = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(onDisk.petPosition).toEqual({ x: 777, y: 888, width: 320, height: 320 })
    expect(onDisk.passthroughMode).toBe('locked-interactive')
    expect(onDisk.petVisible).toBe(false)
  })

  it('persisted file survives a fresh store instance (load reads it back)', () => {
    const store1 = createSettingsStore(dir)
    store1.set({ petVisible: false })
    const store2 = createSettingsStore(dir)
    expect(store2.load().petVisible).toBe(false)
  })

  it('does not leave a .tmp file behind after an atomic write', () => {
    const store = createSettingsStore(dir)
    store.set({ petVisible: false })
    expect(existsSync(join(dir, 'settings.json.tmp'))).toBe(false)
  })
})

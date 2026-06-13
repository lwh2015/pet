// ============================================================================
// src/main/settingsStore.ts
// Hand-rolled JSON settings store over fs. Does NOT import electron:
// the userData directory is injected as a string so it is unit-testable.
// File I/O is thin; all merge/validation is delegated to mergeSettings.
// ============================================================================
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings'
import type { Settings } from '@shared/types'

const SETTINGS_FILENAME = 'settings.json'

export interface SettingsStore {
  load(): Settings
  get(): Settings
  set(patch: Partial<Settings>): Settings
  getFilePath(): string
}

/**
 * Creates a JSON-file settings store rooted at userDataDir.
 *  - load()  : read+parse the file, mergeSettings(DEFAULT_SETTINGS, parsed);
 *              returns DEFAULT_SETTINGS on missing/corrupt file. Caches result
 *              and marks the store as loaded.
 *  - get()   : return the in-memory cache (DEFAULT_SETTINGS until load/set).
 *  - set()   : if load() has never run, lazily load() once first (so an early
 *              set() merges onto the existing on-disk state instead of onto
 *              bare defaults and clobbering it); then merge patch onto the
 *              current cache, atomically write to disk, update the cache, and
 *              return the new full Settings.
 *  - getFilePath(): absolute path of the settings file.
 */
export function createSettingsStore(userDataDir: string): SettingsStore {
  const filePath = join(userDataDir, SETTINGS_FILENAME)
  const tmpPath = filePath + '.tmp'
  let cache: Settings = mergeSettings(DEFAULT_SETTINGS, null)
  let loaded = false

  function writeAtomic(settings: Settings): void {
    const json = JSON.stringify(settings, null, 2)
    writeFileSync(tmpPath, json, 'utf8')
    renameSync(tmpPath, filePath)
  }

  function load(): Settings {
    let parsed: unknown = null
    try {
      const raw = readFileSync(filePath, 'utf8')
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    cache = mergeSettings(DEFAULT_SETTINGS, parsed as Partial<Settings> | null)
    loaded = true
    return cache
  }

  function get(): Settings {
    return cache
  }

  function set(patch: Partial<Settings>): Settings {
    // One-time lazy load so an early set() does not overwrite existing
    // on-disk settings with defaults+patch.
    if (!loaded) {
      load()
    }
    cache = mergeSettings(cache, patch)
    writeAtomic(cache)
    return cache
  }

  function getFilePath(): string {
    return filePath
  }

  return { load, get, set, getFilePath }
}

// ============================================================================
// src/shared/library/filter.ts
// Pure client-side filter for the panel file library. ELECTRON-FREE.
// ============================================================================
import type { FileRecord } from '@shared/types'

/** Case-insensitive substring match over name/ext/mime. Empty query => all. */
export function filterFiles(items: readonly FileRecord[], query: string): FileRecord[] {
  const q = query.trim().toLowerCase()
  if (q === '') return items.slice()
  return items.filter(
    (f) =>
      f.originalName.toLowerCase().includes(q) ||
      f.ext.toLowerCase().includes(q) ||
      f.mime.toLowerCase().includes(q)
  )
}

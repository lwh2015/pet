// ============================================================================
// src/shared/library/format.ts
// Pure human-readable byte formatting. ELECTRON-FREE.
// ============================================================================

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Format a byte count as e.g. "1.5 KB". Bytes show no decimal; KB+ show one. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`
}

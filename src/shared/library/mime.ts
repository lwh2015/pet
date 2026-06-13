// ============================================================================
// src/shared/library/mime.ts
// Best-effort extension -> MIME mapping. ELECTRON-FREE, pure. No content sniff
// (Plan 3 trusts the extension; sniffing is a later enhancement).
// ============================================================================

const EXT_MIME: Readonly<Record<string, string>> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.html': 'text/html'
}

export const DEFAULT_MIME = 'application/octet-stream'

/** Map a (possibly mixed-case) extension incl. dot to a MIME type. */
export function extToMime(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? DEFAULT_MIME
}

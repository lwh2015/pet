# Plan 3 — File Ingestion & Content-Addressed Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feeding a file to the pet (drop-on-pet, panel "Feed file" button, or drag-onto-panel) actually hashes it, copies it into a local content-addressed vault, records it in a `node:sqlite` metadata DB, and surfaces it in a panel file library — reusing Plan 2's `playAction('receive')` for the pet's reaction.

**Architecture:** A single electron-free main-process module (`libraryStore`, mirroring `settingsStore`) owns the `node:sqlite` DB (`userData/library.db`) and the vault (`userData/vault/blobs/ab/cd/<sha256>`, staged via `tmp/` + atomic rename, write-once dedup). It is reached only through `library:*` IPC handlers registered in the existing `registerIpcHandlers(deps)`. Preloads gain `webUtils.getPathForFile` resolution (pet + panel) and the panel `library.*` surface. The renderer adds ingest calls to PetApp's existing drop handler and a new `FileLibrary` panel component.

**Tech Stack:** `node:sqlite` (built into Electron 39 / Node 22.21, and into the dev/test Node 24.9 — verified, no native rebuild, no flag), `node:crypto` streaming sha256, `node:fs` + `node:stream/promises`, `webUtils.getPathForFile`, Electron `dialog`/`shell` (injected into IPC deps), React 19 panel UI, vitest 4.

---

## Conventions this plan mirrors (read once)

- **Stores are electron-free + injected** (`settingsStore.ts`): `createLibraryStore(userDataDir)` takes a string, imports no electron, atomic writes, exposes accessors. Unit-tested against a real tmp dir.
- **IPC**: channel-name constants in `src/shared/ipc.ts` (`namespace:verb`), all handlers inside the single `registerIpcHandlers(deps)` in `src/main/ipc.ts` with seams injected (`shell`/`dialog`/`broadcast*` come via `deps`, NOT imported, so tests need no extra electron mocking). Request/response = `ipcMain.handle`/`ipcRenderer.invoke`; broadcast = `webContents.send`/`ipcRenderer.on`.
- **Preloads** expose pure factories `buildPetApi(ipc)` / `buildPanelApi(ipc)`; interfaces (`RendererApi`/`PanelApi`) are the single source of truth in `src/shared/ipc.ts`; `index.d.ts` imports them, never re-declares.
- **Tests**: vitest `node` env, `globals:true`, includes ONLY `src/shared`, `src/main`, `src/preload` — renderer `.tsx` is NOT unit-tested (verify it manually). `test/electron-stub.ts` already exports an empty `webUtils` object; preload tests inject a fake `getPathForFile`, so the stub stays untouched.
- **eslint**: `no-explicit-any` is enforced (never `any`); explicit return types are provided by convention (not lint-enforced). `node:sqlite` `.get()` returns a value castable straight to `FileRow`, but `.all()` returns a typed `Record<string, SQLOutputValue>[]` — cast it through `unknown` (`as unknown as FileRow[]`), never `any`.
- **git**: branch `feat/file-ingestion` (already created off `feat/live2d`, spec committed). Commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Do NOT push / open PR until the user asks.

## File Structure

**New:**
- `src/shared/library/mime.ts` — `extToMime(ext)` pure map (+ `mime.test.ts`)
- `src/shared/library/filter.ts` — `filterFiles(items, query)` pure (+ `filter.test.ts`)
- `src/shared/library/format.ts` — `formatBytes(n)` pure (+ `format.test.ts`)
- `src/main/libraryStore.ts` — DB + vault module (+ `libraryStore.test.ts`)
- `src/renderer/src/panel/FileLibrary.tsx` — panel file-library UI

**Modified:**
- `src/shared/types.ts` — add `FileRecord`, `IngestResult`
- `src/shared/ipc.ts` — add `LIBRARY_*` constants + `LibraryApi`; extend `RendererApi` + `PanelApi`
- `src/main/ipc.ts` — extend `IpcDeps`; register `library:*` handlers (+ `ipc.test.ts`)
- `src/main/index.ts` — create `libraryStore`, inject deps, `broadcastLibraryChanged`, dispose on quit
- `src/preload/index.ts` — pet `resolveDroppedPaths` + `ingestPaths` (+ `index.test.ts`)
- `src/preload/panel.ts` — panel `resolveDroppedPaths` + `library.*` + `onLibraryChanged` (+ `panel.test.ts`)
- `src/renderer/src/pet/PetApp.tsx` — drop handler resolves paths + ingests (keeps `receive`)
- `src/renderer/src/panel/PanelApp.tsx` — mount `FileLibrary`
- `src/renderer/src/panel/panel.css` — library styles
- `docs/superpowers/2026-06-13-plan3-manual-verification.md` — new manual checklist

---

## Task 1: Shared domain types

**Files:**
- Modify: `src/shared/types.ts` (append after `PassthroughModeChangedPayload`)

- [ ] **Step 1: Add the types**

Append to `src/shared/types.ts`:

```ts
// ---------------------------------------------------------------------------
// Plan 3: file ingestion / library domain types. ELECTRON-FREE.
// ---------------------------------------------------------------------------

/** One ingested file's metadata row (camelCase view of the SQLite `files` row). */
export interface FileRecord {
  id: number
  /** Lowercase 64-char hex sha256; locates the content-addressed blob. */
  sha256: string
  /** Display name as fed in, incl. extension, e.g. "Budget.xlsx". */
  originalName: string
  /** Lowercased extension incl. dot (".xlsx"), or "" if none. */
  ext: string
  /** Best-effort MIME by extension; "application/octet-stream" when unknown. */
  mime: string
  sizeBytes: number
  /** ISO 8601 timestamp. */
  ingestedAt: string
  /** Original absolute path (provenance only), or null. */
  sourcePath: string | null
}

/** Per-file outcome of an ingest request (one input path -> one result). */
export type IngestResult =
  | { ok: true; record: FileRecord }
  | { ok: false; sourcePath: string; error: string }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet; pure type additions).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add FileRecord + IngestResult for Plan 3"
```

---

## Task 2: MIME map (pure)

**Files:**
- Create: `src/shared/library/mime.ts`
- Test: `src/shared/library/mime.test.ts`

- [ ] **Step 1: Write the failing test**

`src/shared/library/mime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extToMime } from './mime'

describe('extToMime', () => {
  it('maps common known extensions', () => {
    expect(extToMime('.png')).toBe('image/png')
    expect(extToMime('.pdf')).toBe('application/pdf')
    expect(extToMime('.txt')).toBe('text/plain')
    expect(extToMime('.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('is case-insensitive', () => {
    expect(extToMime('.PNG')).toBe('image/png')
  })

  it('falls back to application/octet-stream for unknown or empty', () => {
    expect(extToMime('.zzz')).toBe('application/octet-stream')
    expect(extToMime('')).toBe('application/octet-stream')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/library/mime.test.ts`
Expected: FAIL ("Cannot find module './mime'").

- [ ] **Step 3: Implement**

`src/shared/library/mime.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/library/mime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/library/mime.ts src/shared/library/mime.test.ts
git commit -m "feat(library): extToMime extension->MIME map"
```

---

## Task 3: List helpers — filter + format (pure)

**Files:**
- Create: `src/shared/library/filter.ts`, `src/shared/library/format.ts`
- Test: `src/shared/library/filter.test.ts`, `src/shared/library/format.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/shared/library/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterFiles } from './filter'
import type { FileRecord } from '@shared/types'

function rec(p: Partial<FileRecord>): FileRecord {
  return {
    id: 1,
    sha256: 'a'.repeat(64),
    originalName: 'file.txt',
    ext: '.txt',
    mime: 'text/plain',
    sizeBytes: 10,
    ingestedAt: '2026-06-13T00:00:00.000Z',
    sourcePath: null,
    ...p
  }
}

describe('filterFiles', () => {
  const items = [
    rec({ id: 1, originalName: 'Vacation Budget.xlsx', ext: '.xlsx', mime: 'application/vnd.ms-excel' }),
    rec({ id: 2, originalName: 'notes.md', ext: '.md', mime: 'text/markdown' }),
    rec({ id: 3, originalName: 'photo.png', ext: '.png', mime: 'image/png' })
  ]

  it('returns all items for an empty/whitespace query', () => {
    expect(filterFiles(items, '')).toHaveLength(3)
    expect(filterFiles(items, '   ')).toHaveLength(3)
  })

  it('matches on name, case-insensitively', () => {
    expect(filterFiles(items, 'budget').map((f) => f.id)).toEqual([1])
  })

  it('matches on extension and mime', () => {
    expect(filterFiles(items, '.png').map((f) => f.id)).toEqual([3])
    expect(filterFiles(items, 'image').map((f) => f.id)).toEqual([3])
  })

  it('returns [] when nothing matches', () => {
    expect(filterFiles(items, 'zzzzz')).toEqual([])
  })
})
```

`src/shared/library/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it('formats bytes/KB/MB/GB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1073741824)).toBe('1.0 GB')
  })

  it('clamps negatives to 0 B', () => {
    expect(formatBytes(-5)).toBe('0 B')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/library/filter.test.ts src/shared/library/format.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/shared/library/filter.ts`:

```ts
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
```

`src/shared/library/format.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/shared/library/filter.test.ts src/shared/library/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/library/filter.ts src/shared/library/filter.test.ts src/shared/library/format.ts src/shared/library/format.test.ts
git commit -m "feat(library): pure filterFiles + formatBytes helpers"
```

---

## Task 4: IPC channel constants + API interfaces

**Files:**
- Modify: `src/shared/ipc.ts`

- [ ] **Step 1: Add channel constants**

In `src/shared/ipc.ts`, extend the `IPC` object (add inside the object literal, after `SETTINGS_CHANGED`):

```ts
  SETTINGS_CHANGED: 'settings:changed',
  // --- Plan 3: file library / ingestion ---
  LIBRARY_LIST: 'library:list',
  LIBRARY_INGEST: 'library:ingest',
  LIBRARY_REMOVE: 'library:remove',
  LIBRARY_OPEN: 'library:open',
  LIBRARY_REVEAL: 'library:reveal',
  LIBRARY_PICK: 'library:pick',
  LIBRARY_CHANGED: 'library:changed'
```

- [ ] **Step 2: Add the import + `LibraryApi` + extend the surfaces**

At the top import line, add the new types:

```ts
import type {
  Settings,
  PassthroughModeChangedPayload,
  FileRecord,
  IngestResult
} from './types'
```

Add the shared `LibraryApi` interface (after `Unsubscribe`):

```ts
/**
 * File-library operations exposed to the PANEL window. ingestPaths is also
 * reachable from the pet window (same channel) for drop-on-pet ingestion.
 */
export interface LibraryApi {
  list(): Promise<FileRecord[]>
  ingestPaths(paths: string[]): Promise<IngestResult[]>
  remove(id: number): Promise<void>
  open(id: number): Promise<void>
  reveal(id: number): Promise<void>
  pick(): Promise<IngestResult[]>
}
```

Extend `RendererApi` (pet window) — add after `onPassthroughModeChanged`:

```ts
  /**
   * Resolve dropped File objects to absolute OS paths via webUtils
   * (runs in preload; '' results are dropped). Synchronous.
   */
  resolveDroppedPaths(files: FileList | File[]): string[]
  /** Ingest the given absolute paths (drop-on-pet). */
  ingestPaths(paths: string[]): Promise<IngestResult[]>
```

Extend `PanelApi` — add after `onSettingsChanged`:

```ts
  resolveDroppedPaths(files: FileList | File[]): string[]
  library: LibraryApi
  onLibraryChanged(cb: () => void): Unsubscribe
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL — `buildPetApi`/`buildPanelApi` no longer satisfy the extended interfaces (implemented in Tasks 7–8). This is expected; do NOT fix here. Confirm the ONLY errors are "Property 'resolveDroppedPaths'/'ingestPaths'/'library'/'onLibraryChanged' is missing" in `src/preload/index.ts` and `src/preload/panel.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts
git commit -m "feat(ipc): library:* channels + LibraryApi, extend Renderer/Panel surfaces"
```

> Note: typecheck stays red until Tasks 7–8 implement the preload methods. Tasks 5–6 don't touch the preloads, so run their tests with `npx vitest run <file>` (not the full `npm run typecheck`) to stay green per-task.

---

## Task 5: libraryStore — DB + content-addressed vault (the core)

**Files:**
- Create: `src/main/libraryStore.ts`
- Test: `src/main/libraryStore.test.ts`

This module imports `node:sqlite` + `node:*` only — NO electron. `shell`/`dialog` live in the IPC layer (Task 6), so this stays unit-testable against a real tmp dir. `node:sqlite` prints a one-line `ExperimentalWarning` to stderr on import under the dev/test Node 24 — that is expected and harmless; tests still pass.

- [ ] **Step 1: Write the failing test**

`src/main/libraryStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createLibraryStore } from './libraryStore'

// Imports NO electron. Exercises the real node:sqlite DB + vault on a tmp dir.

let dir: string
let srcDir: string

function writeSource(name: string, content: string): string {
  const p = join(srcDir, name)
  writeFileSync(p, content, 'utf8')
  return p
}

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function shardPath(root: string, hash: string): string {
  return join(root, 'vault', 'blobs', hash.slice(0, 2), hash.slice(2, 4), hash)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pet-library-'))
  srcDir = mkdtempSync(join(tmpdir(), 'pet-src-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

describe('createLibraryStore', () => {
  it('getDbPath returns <userDataDir>/library.db and creates the vault dirs', () => {
    const store = createLibraryStore(dir)
    expect(store.getDbPath()).toBe(join(dir, 'library.db'))
    expect(existsSync(join(dir, 'vault', 'blobs'))).toBe(true)
    expect(existsSync(join(dir, 'vault', 'tmp'))).toBe(true)
    store.dispose()
  })

  it('stamps PRAGMA user_version = 1 for future migrations', () => {
    const store = createLibraryStore(dir)
    store.dispose()
    const db = new DatabaseSync(join(dir, 'library.db'))
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(row.user_version).toBe(1)
    db.close()
  })

  it('ingest hashes, copies to the content-addressed blob, and returns the record', async () => {
    const store = createLibraryStore(dir)
    const src = writeSource('hello.txt', 'hello world')
    const rec = await store.ingest(src)
    const hash = sha256Of('hello world')

    expect(rec.sha256).toBe(hash)
    expect(rec.originalName).toBe('hello.txt')
    expect(rec.ext).toBe('.txt')
    expect(rec.mime).toBe('text/plain')
    expect(rec.sizeBytes).toBe(Buffer.byteLength('hello world'))
    expect(rec.sourcePath).toBe(src)
    expect(typeof rec.ingestedAt).toBe('string')
    expect(Number.isNaN(Date.parse(rec.ingestedAt))).toBe(false)
    expect(existsSync(shardPath(dir, hash))).toBe(true)
    store.dispose()
  })

  it('list returns ingested records (newest first)', async () => {
    const store = createLibraryStore(dir)
    await store.ingest(writeSource('a.txt', 'aaa'))
    await store.ingest(writeSource('b.txt', 'bbb'))
    const all = store.list()
    expect(all.map((r) => r.originalName)).toEqual(['b.txt', 'a.txt'])
    store.dispose()
  })

  it('dedupes identical content at the blob layer (one blob, write-once)', async () => {
    const store = createLibraryStore(dir)
    await store.ingest(writeSource('first.txt', 'same'))
    await store.ingest(writeSource('second.txt', 'same')) // same content, different name
    const hash = sha256Of('same')
    const leafDir = join(dir, 'vault', 'blobs', hash.slice(0, 2), hash.slice(2, 4))
    expect(readdirSync(leafDir)).toEqual([hash]) // exactly one blob
    expect(store.list()).toHaveLength(2) // two display rows
    store.dispose()
  })

  it('skips a duplicate row only when same content AND same name', async () => {
    const store = createLibraryStore(dir)
    const a = await store.ingest(writeSource('dup.txt', 'x'))
    const b = await store.ingest(writeSource('dup.txt', 'x')) // identical name+content
    expect(b.id).toBe(a.id) // same row returned, not a new one
    expect(store.list()).toHaveLength(1)
    store.dispose()
  })

  it('leaves no .part temp behind after a successful ingest', async () => {
    const store = createLibraryStore(dir)
    await store.ingest(writeSource('c.txt', 'ccc'))
    expect(readdirSync(join(dir, 'vault', 'tmp'))).toEqual([])
    store.dispose()
  })

  it('rejects a missing source, a directory, and an oversize file', async () => {
    const store = createLibraryStore(dir, { maxBytes: 4 })
    await expect(store.ingest(join(srcDir, 'nope.txt'))).rejects.toThrow()
    mkdirSync(join(srcDir, 'adir'))
    await expect(store.ingest(join(srcDir, 'adir'))).rejects.toThrow()
    await expect(store.ingest(writeSource('big.txt', 'too many bytes'))).rejects.toThrow(/too large/i)
    expect(store.list()).toHaveLength(0)
    store.dispose()
  })

  it('remove deletes the row and reclaims the blob when it was the last reference', async () => {
    const store = createLibraryStore(dir)
    const a = await store.ingest(writeSource('one.txt', 'shared'))
    const b = await store.ingest(writeSource('two.txt', 'shared')) // shares the blob
    const hash = a.sha256
    store.remove(a.id)
    expect(existsSync(shardPath(dir, hash))).toBe(true) // b still references it
    store.remove(b.id)
    expect(existsSync(shardPath(dir, hash))).toBe(false) // last reference gone
    expect(store.list()).toHaveLength(0)
    store.dispose()
  })

  it('blobPathFor returns the on-disk blob path; materializeForOpen yields a named copy', async () => {
    const store = createLibraryStore(dir)
    const rec = await store.ingest(writeSource('doc.txt', 'content'))
    expect(store.blobPathFor(rec.id)).toBe(shardPath(dir, rec.sha256))
    const opened = store.materializeForOpen(rec.id)!
    expect(opened.endsWith('doc.txt')).toBe(true)
    expect(existsSync(opened)).toBe(true)
    store.dispose()
  })

  it('sweeps stale *.part temps on construction', () => {
    mkdirSync(join(dir, 'vault', 'tmp'), { recursive: true })
    writeFileSync(join(dir, 'vault', 'tmp', 'orphan.part'), 'junk')
    const store = createLibraryStore(dir)
    expect(existsSync(join(dir, 'vault', 'tmp', 'orphan.part'))).toBe(false)
    store.dispose()
  })

  it('persists across store instances (data survives reopen)', async () => {
    const store1 = createLibraryStore(dir)
    await store1.ingest(writeSource('persist.txt', 'keep'))
    store1.dispose()
    const store2 = createLibraryStore(dir)
    expect(store2.list().map((r) => r.originalName)).toEqual(['persist.txt'])
    store2.dispose()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/libraryStore.test.ts`
Expected: FAIL ("Cannot find module './libraryStore'").

- [ ] **Step 3: Implement**

`src/main/libraryStore.ts`:

```ts
// ============================================================================
// src/main/libraryStore.ts
// File library: node:sqlite metadata DB + content-addressed file vault.
// Does NOT import electron — userDataDir is injected as a string so it is
// unit-testable (mirrors settingsStore.ts). shell/dialog live in the IPC layer.
// ============================================================================
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  mkdirSync,
  renameSync,
  statSync,
  existsSync,
  unlinkSync,
  copyFileSync,
  readdirSync
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join, extname, basename, resolve as resolvePath, sep } from 'node:path'
import { extToMime } from '@shared/library/mime'
import type { FileRecord } from '@shared/types'

const DB_FILENAME = 'library.db'
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024 // 1 GiB

/** Raw SQLite row shape (snake_case). node:sqlite .get() returns a value castable
 *  to FileRow; .all() returns Record<string, SQLOutputValue>[] (cast through unknown). */
interface FileRow {
  id: number
  sha256: string
  original_name: string
  ext: string
  mime: string
  size_bytes: number
  ingested_at: string
  source_path: string | null
}

export interface LibraryStore {
  ingest(absPath: string): Promise<FileRecord>
  list(): FileRecord[]
  get(id: number): FileRecord | undefined
  remove(id: number): void
  /** Absolute path of the content-addressed blob, or undefined if no such id. */
  blobPathFor(id: number): string | undefined
  /** Copy the blob to userData/work/<id>/<originalName>; returns that path. */
  materializeForOpen(id: number): string | undefined
  getDbPath(): string
  dispose(): void
}

export interface LibraryStoreOptions {
  /** Reject ingests larger than this (bytes). Default 1 GiB. */
  maxBytes?: number
  /** Clock seam for deterministic tests. Default () => new Date(). */
  now?: () => Date
}

export function createLibraryStore(
  userDataDir: string,
  options: LibraryStoreOptions = {}
): LibraryStore {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const now = options.now ?? ((): Date => new Date())

  const dbPath = join(userDataDir, DB_FILENAME)
  const vaultDir = join(userDataDir, 'vault')
  const blobsDir = join(vaultDir, 'blobs')
  const tmpDir = join(vaultDir, 'tmp')
  const workDir = join(userDataDir, 'work')

  mkdirSync(blobsDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  sweepTmp()

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY,
      sha256        TEXT    NOT NULL,
      original_name TEXT    NOT NULL,
      ext           TEXT    NOT NULL DEFAULT '',
      mime          TEXT    NOT NULL DEFAULT '',
      size_bytes    INTEGER NOT NULL,
      ingested_at   TEXT    NOT NULL,
      source_path   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_sha_name ON files(sha256, original_name);
  `)
  db.exec('PRAGMA user_version = 1') // schema v1; future migrations read+bump this here

  function sweepTmp(): void {
    if (!existsSync(tmpDir)) return
    for (const name of readdirSync(tmpDir)) {
      if (name.endsWith('.part')) safeUnlink(join(tmpDir, name))
    }
  }

  function safeUnlink(p: string): void {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* best-effort cleanup */
    }
  }

  function blobPathForHash(hash: string): string {
    return join(blobsDir, hash.slice(0, 2), hash.slice(2, 4), hash)
  }

  function rowToRecord(row: FileRow): FileRecord {
    return {
      id: row.id,
      sha256: row.sha256,
      originalName: row.original_name,
      ext: row.ext,
      mime: row.mime,
      sizeBytes: row.size_bytes,
      ingestedAt: row.ingested_at,
      sourcePath: row.source_path
    }
  }

  async function ingest(absPath: string): Promise<FileRecord> {
    if (typeof absPath !== 'string' || absPath.length === 0 || absPath.includes('\0')) {
      throw new Error('invalid path')
    }
    const resolved = resolvePath(absPath)
    const st = statSync(resolved) // throws ENOENT for a missing source
    if (!st.isFile()) throw new Error('not a regular file')
    if (st.size > maxBytes) throw new Error(`file too large (${st.size} > ${maxBytes})`)

    // Single read: copy into tmp while updating the sha256 (constant memory).
    const tmpPath = join(tmpDir, `${randomBytes(8).toString('hex')}.part`)
    const hash = createHash('sha256')
    try {
      await pipeline(
        createReadStream(resolved),
        async function* tee(source) {
          for await (const chunk of source) {
            hash.update(chunk as Buffer)
            yield chunk
          }
        },
        createWriteStream(tmpPath)
      )
    } catch (err) {
      safeUnlink(tmpPath)
      throw err
    }

    const sha256 = hash.digest('hex')
    const destPath = blobPathForHash(sha256)
    // Defense-in-depth (spec §7): destPath is hash-derived so traversal is
    // structurally impossible, but assert containment within the vault.
    if (!destPath.startsWith(blobsDir + sep)) {
      safeUnlink(tmpPath)
      throw new Error('destination escapes vault')
    }
    if (existsSync(destPath)) {
      safeUnlink(tmpPath) // dedup: identical bytes already stored
    } else {
      mkdirSync(join(blobsDir, sha256.slice(0, 2), sha256.slice(2, 4)), { recursive: true })
      renameSync(tmpPath, destPath) // atomic (same volume)
    }

    const originalName = basename(resolved)
    const ext = extname(originalName).toLowerCase()
    const mime = extToMime(ext)
    const ingestedAt = now().toISOString()

    db.prepare(
      `INSERT OR IGNORE INTO files
         (sha256, original_name, ext, mime, size_bytes, ingested_at, source_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sha256, originalName, ext, mime, st.size, ingestedAt, resolved)

    const row = db
      .prepare(
        'SELECT * FROM files WHERE sha256 = ? AND original_name = ? ORDER BY id LIMIT 1'
      )
      .get(sha256, originalName) as FileRow | undefined
    if (!row) throw new Error('ingest failed to persist row')
    return rowToRecord(row)
  }

  function list(): FileRecord[] {
    const rows = db.prepare('SELECT * FROM files ORDER BY id DESC').all() as unknown as FileRow[]
    return rows.map(rowToRecord)
  }

  function get(id: number): FileRecord | undefined {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined
    return row ? rowToRecord(row) : undefined
  }

  function remove(id: number): void {
    const row = db.prepare('SELECT sha256 FROM files WHERE id = ?').get(id) as
      | Pick<FileRow, 'sha256'>
      | undefined
    if (!row) return
    db.prepare('DELETE FROM files WHERE id = ?').run(id)
    const ref = db.prepare('SELECT COUNT(*) AS n FROM files WHERE sha256 = ?').get(row.sha256) as {
      n: number
    }
    if (ref.n === 0) safeUnlink(blobPathForHash(row.sha256))
  }

  function blobPathFor(id: number): string | undefined {
    const rec = get(id)
    return rec ? blobPathForHash(rec.sha256) : undefined
  }

  function materializeForOpen(id: number): string | undefined {
    const rec = get(id)
    if (!rec) return undefined
    const blob = blobPathForHash(rec.sha256)
    if (!existsSync(blob)) return undefined
    const outDir = join(workDir, String(id))
    mkdirSync(outDir, { recursive: true })
    const outPath = join(outDir, rec.originalName)
    copyFileSync(blob, outPath)
    return outPath
  }

  function getDbPath(): string {
    return dbPath
  }

  function dispose(): void {
    db.close()
  }

  return { ingest, list, get, remove, blobPathFor, materializeForOpen, getDbPath, dispose }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/libraryStore.test.ts`
Expected: PASS (all cases). The `ExperimentalWarning: SQLite ...` line on stderr is expected.

- [ ] **Step 5: Commit**

```bash
git add src/main/libraryStore.ts src/main/libraryStore.test.ts
git commit -m "feat(main): libraryStore — node:sqlite DB + content-addressed vault"
```

---

## Task 6: IPC handlers for `library:*`

**Files:**
- Modify: `src/main/ipc.ts`
- Test: `src/main/ipc.test.ts`

- [ ] **Step 1: Extend `IpcDeps` and register handlers**

In `src/main/ipc.ts`, add imports near the top:

```ts
import type { Settings, FileRecord, IngestResult } from '@shared/types'
```

(Replace the existing `import type { Settings } from '@shared/types'` line.)

Add to the `IpcDeps` interface (after `getAllWindows`):

```ts
  /** File library store (createLibraryStore result). */
  libraryStore: {
    list(): FileRecord[]
    ingest(absPath: string): Promise<FileRecord>
    remove(id: number): void
    blobPathFor(id: number): string | undefined
    materializeForOpen(id: number): string | undefined
  }
  /**
   * Electron shell/dialog seams. Typed as Pick<Electron.*> so the RAW electron
   * `shell`/`dialog` objects inject directly (Task 9) with no adapter — a plain
   * `{ showOpenDialog(options): ... }` shape is NOT assignable from electron's
   * OVERLOADED `dialog.showOpenDialog` (arity mismatch, TS2322). Tests pass fakes
   * cast `as never`, so the Pick types don't burden the test harness.
   */
  shell: Pick<Electron.Shell, 'openPath' | 'showItemInFolder'>
  dialog: Pick<Electron.Dialog, 'showOpenDialog'>
  /** Broadcast library:changed to the panel (destroyed-safe; owned by index.ts). */
  broadcastLibraryChanged: () => void
```

Inside `registerIpcHandlers`, before the final `return { flushPersist: ... }`, add:

```ts
  // --- Plan 3: file library / ingestion ---
  // Shared ingest loop: each path -> ok/record or error; broadcast if any ok.
  const ingestAll = async (paths: string[]): Promise<IngestResult[]> => {
    const results: IngestResult[] = []
    for (const p of paths) {
      try {
        results.push({ ok: true, record: await deps.libraryStore.ingest(p) })
      } catch (err) {
        results.push({ ok: false, sourcePath: p, error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (results.some((r) => r.ok)) deps.broadcastLibraryChanged()
    return results
  }

  ipcMain.handle(IPC.LIBRARY_LIST, () => deps.libraryStore.list())

  ipcMain.handle(IPC.LIBRARY_INGEST, (_event, ...args: unknown[]) => {
    const paths = Array.isArray(args[0]) ? (args[0] as string[]) : []
    return ingestAll(paths)
  })

  ipcMain.handle(IPC.LIBRARY_REMOVE, (_event, ...args: unknown[]) => {
    deps.libraryStore.remove(Number(args[0]))
    deps.broadcastLibraryChanged()
  })

  ipcMain.handle(IPC.LIBRARY_OPEN, async (_event, ...args: unknown[]) => {
    const p = deps.libraryStore.materializeForOpen(Number(args[0]))
    if (p) await deps.shell.openPath(p)
  })

  ipcMain.handle(IPC.LIBRARY_REVEAL, (_event, ...args: unknown[]) => {
    const p = deps.libraryStore.blobPathFor(Number(args[0]))
    if (p) deps.shell.showItemInFolder(p)
  })

  ipcMain.handle(IPC.LIBRARY_PICK, async () => {
    const { canceled, filePaths } = await deps.dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return []
    return ingestAll(filePaths)
  })
```

- [ ] **Step 2: Update the test harness + add handler tests**

In `src/main/ipc.test.ts`, extend `makeDeps` so the new required deps exist. Add these fakes inside `makeDeps` (before building `deps`):

```ts
  const libraryStore = {
    list: vi.fn(() => [] as never[]),
    ingest: vi.fn(async (p: string) => ({
      id: 1,
      sha256: 'a'.repeat(64),
      originalName: p,
      ext: '.txt',
      mime: 'text/plain',
      sizeBytes: 3,
      ingestedAt: '2026-06-13T00:00:00.000Z',
      sourcePath: p
    })),
    remove: vi.fn(),
    blobPathFor: vi.fn((id: number) => `/vault/${id}`),
    materializeForOpen: vi.fn((id: number) => `/work/${id}/file.txt`)
  }
  const shell = { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })) }
  const broadcastLibraryChanged = vi.fn()
```

Add them to the returned `deps` object and to the destructured return:

```ts
  const deps: IpcDeps = {
    settingsStore: store as never,
    passthrough: makeFakePassthrough() as never,
    showPanelWindow,
    getPetWindow: () => win as never,
    broadcastSettingsChanged,
    getAllWindows: () => [win as never],
    libraryStore: libraryStore as never,
    shell: shell as never,
    dialog: dialog as never,
    broadcastLibraryChanged
  }
  return { deps, win, showPanelWindow, broadcastSettingsChanged, libraryStore, shell, dialog, broadcastLibraryChanged }
```

Add a new `describe` block (after the existing tests):

```ts
describe('registerIpcHandlers — library:*', () => {
  it('registers handle for all library channels', () => {
    const { deps } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    for (const ch of [
      IPC.LIBRARY_LIST,
      IPC.LIBRARY_INGEST,
      IPC.LIBRARY_REMOVE,
      IPC.LIBRARY_OPEN,
      IPC.LIBRARY_REVEAL,
      IPC.LIBRARY_PICK
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it('LIBRARY_LIST returns the store listing', async () => {
    const { deps, libraryStore } = makeDeps(makeFakeStore(BASE))
    libraryStore.list.mockReturnValueOnce([{ id: 7 }] as never)
    registerIpcHandlers(deps)
    const result = await handlers.get(IPC.LIBRARY_LIST)!({})
    expect(result).toEqual([{ id: 7 }])
  })

  it('LIBRARY_INGEST maps each path to an ok result and broadcasts', async () => {
    const { deps, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    const result = (await handlers.get(IPC.LIBRARY_INGEST)!({}, ['/a.txt', '/b.txt'])) as Array<{
      ok: boolean
    }>
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.ok)).toBe(true)
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('LIBRARY_INGEST reports a failing path as { ok:false } and still broadcasts the ok ones', async () => {
    const { deps, libraryStore, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    libraryStore.ingest
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 2 } as never)
    registerIpcHandlers(deps)
    const result = (await handlers.get(IPC.LIBRARY_INGEST)!({}, ['/bad', '/good'])) as Array<{
      ok: boolean
      error?: string
    }>
    expect(result[0]).toMatchObject({ ok: false, error: 'boom' })
    expect(result[1]).toMatchObject({ ok: true })
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('LIBRARY_INGEST does NOT broadcast when every path fails', async () => {
    const { deps, libraryStore, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    libraryStore.ingest.mockRejectedValue(new Error('nope'))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_INGEST)!({}, ['/x'])
    expect(broadcastLibraryChanged).not.toHaveBeenCalled()
  })

  it('LIBRARY_REMOVE removes and broadcasts', async () => {
    const { deps, libraryStore, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_REMOVE)!({}, 5)
    expect(libraryStore.remove).toHaveBeenCalledWith(5)
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('LIBRARY_OPEN materializes then opens via shell', async () => {
    const { deps, libraryStore, shell } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_OPEN)!({}, 3)
    expect(libraryStore.materializeForOpen).toHaveBeenCalledWith(3)
    expect(shell.openPath).toHaveBeenCalledWith('/work/3/file.txt')
  })

  it('LIBRARY_REVEAL shows the blob in the folder', async () => {
    const { deps, shell } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_REVEAL)!({}, 4)
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/vault/4')
  })

  it('LIBRARY_PICK returns [] when the dialog is canceled', async () => {
    const { deps } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    const result = await handlers.get(IPC.LIBRARY_PICK)!({})
    expect(result).toEqual([])
  })

  it('LIBRARY_PICK ingests the chosen paths', async () => {
    const { deps, dialog, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/picked.txt'] })
    registerIpcHandlers(deps)
    const result = (await handlers.get(IPC.LIBRARY_PICK)!({})) as Array<{ ok: boolean }>
    expect(result).toHaveLength(1)
    expect(result[0].ok).toBe(true)
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/main/ipc.test.ts`
Expected: PASS (existing Plan-1 tests + the new library block).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/main/ipc.test.ts
git commit -m "feat(ipc): register library:* handlers (list/ingest/remove/open/reveal/pick)"
```

---

## Task 7: Pet preload — resolve dropped paths + ingest

**Files:**
- Modify: `src/preload/index.ts`
- Test: `src/preload/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/preload/index.test.ts` (inside the `describe('buildPetApi', ...)`):

```ts
  it('resolveDroppedPaths maps File objects through getPathForFile, dropping empties', () => {
    const ipc = makeFakeIpc()
    const getPathForFile = vi.fn((f: { name: string }) => (f.name === 'empty' ? '' : `/abs/${f.name}`))
    const api = buildPetApi(ipc as never, getPathForFile as never)
    const paths = api.resolveDroppedPaths([{ name: 'a' }, { name: 'empty' }, { name: 'b' }] as never)
    expect(paths).toEqual(['/abs/a', '/abs/b'])
  })

  it('ingestPaths invokes IPC.LIBRARY_INGEST with the paths', async () => {
    const ipc = makeFakeIpc()
    ipc.invoke.mockResolvedValueOnce([])
    const api = buildPetApi(ipc as never)
    await api.ingestPaths(['/abs/a'])
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_INGEST, ['/abs/a'])
  })
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/preload/index.test.ts`
Expected: FAIL (`resolveDroppedPaths`/`ingestPaths` not functions).

- [ ] **Step 3: Implement**

In `src/preload/index.ts`:

Change the electron import to include `webUtils`:

```ts
import { contextBridge, ipcRenderer, webUtils, type IpcRenderer } from 'electron'
```

Change the factory signature + add the two methods. Update `buildPetApi`:

```ts
export function buildPetApi(
  ipc: IpcRenderer,
  getPathForFile: (file: File) => string = (file) => webUtils.getPathForFile(file)
): RendererApi {
  return {
    // ...existing members unchanged...
    drag: {
      start: () => ipc.send(IPC.PET_DRAG_START),
      move: () => ipc.send(IPC.PET_DRAG_MOVE),
      end: () => ipc.send(IPC.PET_DRAG_END)
    },
    // --- Plan 3 adds ---
    resolveDroppedPaths(files: FileList | File[]): string[] {
      const out: string[] = []
      for (const f of Array.from(files)) {
        const p = getPathForFile(f)
        if (p) out.push(p)
      }
      return out
    },
    ingestPaths(paths: string[]): Promise<IngestResult[]> {
      return ipc.invoke(IPC.LIBRARY_INGEST, paths)
    }
  }
}
```

Add the `IngestResult` type import:

```ts
import type {
  Settings,
  SettingsChangedPayload,
  PassthroughModeChangedPayload,
  IngestResult
} from '@shared/types'
```

(The bottom `const petApi = buildPetApi(ipcRenderer)` stays — it uses the default `getPathForFile`, i.e. the real `webUtils`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/preload/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/index.test.ts
git commit -m "feat(preload): pet resolveDroppedPaths + ingestPaths"
```

---

## Task 8: Panel preload — library surface + drop-path resolution

**Files:**
- Modify: `src/preload/panel.ts`
- Test: `src/preload/panel.test.ts`

- [ ] **Step 1: Update the exhaustive-keys test + add new tests**

In `src/preload/panel.test.ts`:

Replace the `'exposes ONLY ...'` test with the new surface:

```ts
  it('exposes the settings + library surface', () => {
    const api = buildPanelApi(makeFakeIpc() as never)
    expect(Object.keys(api).sort()).toEqual([
      'getSettings',
      'library',
      'onLibraryChanged',
      'onSettingsChanged',
      'resolveDroppedPaths',
      'setSettings'
    ])
    expect(Object.keys(api.library).sort()).toEqual([
      'ingestPaths',
      'list',
      'open',
      'pick',
      'remove',
      'reveal'
    ])
  })
```

Add new tests:

```ts
  it('resolveDroppedPaths maps Files via injected getPathForFile, dropping empties', () => {
    const getPathForFile = vi.fn((f: { name: string }) => (f.name === 'x' ? '' : `/p/${f.name}`))
    const api = buildPanelApi(makeFakeIpc() as never, getPathForFile as never)
    expect(api.resolveDroppedPaths([{ name: 'a' }, { name: 'x' }] as never)).toEqual(['/p/a'])
  })

  it('library.list/remove/open/reveal/pick invoke their channels', async () => {
    const ipc = makeFakeIpc()
    const api = buildPanelApi(ipc as never)
    await api.library.list()
    await api.library.ingestPaths(['/a'])
    await api.library.remove(1)
    await api.library.open(2)
    await api.library.reveal(3)
    await api.library.pick()
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_LIST)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_INGEST, ['/a'])
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_REMOVE, 1)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_OPEN, 2)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_REVEAL, 3)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_PICK)
  })

  it('onLibraryChanged subscribes to IPC.LIBRARY_CHANGED and returns an unsubscribe', () => {
    const ipc = makeFakeIpc()
    const api = buildPanelApi(ipc as never)
    const cb = vi.fn()
    const off = api.onLibraryChanged(cb)
    expect(ipc.on.mock.calls[0][0]).toBe(IPC.LIBRARY_CHANGED)
    const handler = ipc.on.mock.calls[0][1] as () => void
    handler()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC.LIBRARY_CHANGED, expect.any(Function))
  })
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/preload/panel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/preload/panel.ts` — full new version:

```ts
// D:\aicode\pet\src\preload\panel.ts
// Panel-window preload. window.panelApi: settings subset + the file library.
import { contextBridge, ipcRenderer, webUtils, type IpcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { PanelApi } from '@shared/ipc'
import type { Settings, SettingsChangedPayload } from '@shared/types'

/** Pure factory for the panelApi surface (injected ipcRenderer + path resolver). */
export function buildPanelApi(
  ipc: IpcRenderer,
  getPathForFile: (file: File) => string = (file) => webUtils.getPathForFile(file)
): PanelApi {
  return {
    getSettings(): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_GET)
    },
    setSettings(patch: Partial<Settings>): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_SET, patch)
    },
    onSettingsChanged(cb: (settings: Settings) => void): () => void {
      const listener = (_e: unknown, payload: SettingsChangedPayload): void => cb(payload.settings)
      ipc.on(IPC.SETTINGS_CHANGED, listener)
      return () => ipc.removeListener(IPC.SETTINGS_CHANGED, listener)
    },
    // --- Plan 3 ---
    resolveDroppedPaths(files: FileList | File[]): string[] {
      const out: string[] = []
      for (const f of Array.from(files)) {
        const p = getPathForFile(f)
        if (p) out.push(p)
      }
      return out
    },
    library: {
      list: () => ipc.invoke(IPC.LIBRARY_LIST),
      ingestPaths: (paths: string[]) => ipc.invoke(IPC.LIBRARY_INGEST, paths),
      remove: (id: number) => ipc.invoke(IPC.LIBRARY_REMOVE, id),
      open: (id: number) => ipc.invoke(IPC.LIBRARY_OPEN, id),
      reveal: (id: number) => ipc.invoke(IPC.LIBRARY_REVEAL, id),
      pick: () => ipc.invoke(IPC.LIBRARY_PICK)
    },
    onLibraryChanged(cb: () => void): () => void {
      const listener = (): void => cb()
      ipc.on(IPC.LIBRARY_CHANGED, listener)
      return () => ipc.removeListener(IPC.LIBRARY_CHANGED, listener)
    }
  }
}

const panelApi = buildPanelApi(ipcRenderer)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('panelApi', panelApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when isolation is off)
  window.panelApi = panelApi
}
```

- [ ] **Step 4: Run to verify pass + full typecheck (now green)**

Run: `npx vitest run src/preload/panel.test.ts && npm run typecheck`
Expected: PASS, and `typecheck` is now GREEN (Task 4's interfaces are fully implemented by Tasks 7–8).

- [ ] **Step 5: Commit**

```bash
git add src/preload/panel.ts src/preload/panel.test.ts
git commit -m "feat(preload): panel library surface + resolveDroppedPaths + onLibraryChanged"
```

---

## Task 9: Main bootstrap wiring

**Files:**
- Modify: `src/main/index.ts`

No unit test (`index.ts` is glue, not in the vitest globs) — verified via typecheck + the manual checklist (Task 12).

- [ ] **Step 1: Wire the libraryStore + injected seams**

In `src/main/index.ts`:

Add to the electron import:

```ts
import { app, shell, dialog } from 'electron'
```

Add the store import (next to `createSettingsStore`):

```ts
import { createLibraryStore } from './libraryStore'
```

Inside `bootstrap()`'s `app.whenReady().then(...)`, after the settings store is created (step 1), add:

```ts
    // 1b) File library store (node:sqlite DB + content-addressed vault).
    const libraryStore = createLibraryStore(app.getPath('userData'))
```

Add a `broadcastLibraryChanged` helper next to `broadcastSettingsChanged` (step 4):

```ts
    // 4b) Library-changed broadcast: notify the panel to re-list (destroyed-safe).
    const broadcastLibraryChanged = (): void => {
      const panel = getPanelWindow()
      if (panel && !panel.isDestroyed()) panel.webContents.send(IPC.LIBRARY_CHANGED)
    }
```

Extend the `registerIpcHandlers({...})` call (step 5) with the new deps:

```ts
    const ipcHandles = registerIpcHandlers({
      settingsStore,
      passthrough,
      showPanelWindow,
      getPetWindow,
      broadcastSettingsChanged,
      getAllWindows: () => [getPetWindow(), getPanelWindow()],
      libraryStore,
      shell,
      dialog,
      broadcastLibraryChanged
    })
```

Dispose the DB on quit — extend the existing `before-quit` handler (step 9):

```ts
    app.on('before-quit', () => {
      ipcHandles.flushPersist()
      stopDisplayWatcher()
      libraryStore.dispose()
    })
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): bootstrap libraryStore + inject shell/dialog/broadcast into IPC"
```

---

## Task 10: PetApp drop handler — resolve + ingest (keep `receive`)

**Files:**
- Modify: `src/renderer/src/pet/PetApp.tsx`

Renderer — no unit test; verified manually (Task 12). The `playAction('receive')` call MUST be preserved.

- [ ] **Step 1: Update the `onDrop` handler**

In `src/renderer/src/pet/PetApp.tsx`, replace the `onDrop` body inside the drag/drop `useEffect` (currently lines ~141-148) with:

```ts
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      // Visual feedback (Plan 2 behavior, PRESERVED) — fires even if ingest fails.
      controllerRef.current?.playAction('receive')
      // Plan 3: resolve real OS paths in the preload and ingest them.
      const paths = window.petApi.resolveDroppedPaths(files)
      if (paths.length > 0) {
        void window.petApi.ingestPaths(paths).catch((err: unknown) => {
          console.error('[PetApp] ingest failed', err)
        })
      }
    }
```

Also update the header comment block (lines ~14-15) to reflect that Plan 3 now ingests:

```ts
//   - HTML5 file drag/drop on the window -> playAction('receive') for visual
//     feedback AND resolves real paths via window.petApi.resolveDroppedPaths +
//     window.petApi.ingestPaths (Plan 3 real ingestion into the vault).
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pet/PetApp.tsx
git commit -m "feat(pet): ingest dropped files into the vault (keeps receive reaction)"
```

---

## Task 11: Panel file library UI

**Files:**
- Create: `src/renderer/src/panel/FileLibrary.tsx`
- Modify: `src/renderer/src/panel/PanelApp.tsx`, `src/renderer/src/panel/panel.css`

Renderer — no unit test; verified manually (Task 12). Effects must be idempotent (the panel uses `React.StrictMode`).

- [ ] **Step 1: Create `FileLibrary.tsx`**

`src/renderer/src/panel/FileLibrary.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileRecord } from '@shared/types'
import { filterFiles } from '@shared/library/filter'
import { formatBytes } from '@shared/library/format'

/**
 * Panel file library. Lists ingested files (newest first) with search + actions
 * (open / reveal / delete), a "Feed file" picker button, and a drop zone that
 * ingests files dragged onto the panel. Live-updates via onLibraryChanged.
 * StrictMode-safe: the effect's subscribe/refresh is idempotent and cleaned up.
 */
export function FileLibrary(): React.JSX.Element {
  const [items, setItems] = useState<FileRecord[]>([])
  const [query, setQuery] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback((): void => {
    window.panelApi.library
      .list()
      .then(setItems)
      .catch((e: unknown) => console.error('[FileLibrary] list failed', e))
  }, [])

  useEffect(() => {
    refresh()
    const off = window.panelApi.onLibraryChanged(() => refresh())
    return () => off()
  }, [refresh])

  const ingestPaths = useCallback(async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    setBusy(true)
    try {
      const results = await window.panelApi.library.ingestPaths(paths)
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) console.warn('[FileLibrary] some ingests failed', failed)
    } finally {
      setBusy(false)
      refresh()
    }
  }, [refresh])

  const onFeedClick = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.panelApi.library.pick()
    } finally {
      setBusy(false)
      refresh()
    }
  }, [refresh])

  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      setDragOver(false)
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      void ingestPaths(window.panelApi.resolveDroppedPaths(files))
    },
    [ingestPaths]
  )

  const visible = filterFiles(items, query)

  return (
    <div className="library">
      <div className="library__bar">
        <input
          className="library__search"
          type="search"
          placeholder="Search files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="library__feed" onClick={onFeedClick} disabled={busy}>
          {busy ? 'Working…' : 'Feed file'}
        </button>
      </div>

      <div
        ref={dropRef}
        className={`library__drop${dragOver ? ' library__drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {visible.length === 0 ? (
          <p className="library__empty">
            {items.length === 0 ? 'No files yet — drop one here or feed the pet.' : 'No matches.'}
          </p>
        ) : (
          <ul className="library__list">
            {visible.map((f) => (
              <li key={f.id} className="library__item">
                <div className="library__meta">
                  <span className="library__name" title={f.originalName}>
                    {f.originalName}
                  </span>
                  <span className="library__sub">
                    {formatBytes(f.sizeBytes)} · {f.mime} · {new Date(f.ingestedAt).toLocaleString()}
                  </span>
                </div>
                <div className="library__actions">
                  <button onClick={() => void window.panelApi.library.open(f.id)}>Open</button>
                  <button onClick={() => void window.panelApi.library.reveal(f.id)}>Reveal</button>
                  <button
                    className="library__danger"
                    onClick={() => void window.panelApi.library.remove(f.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in `PanelApp.tsx`**

Replace `src/renderer/src/panel/PanelApp.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import { FileLibrary } from './FileLibrary'

/**
 * Panel root (opaque). Hosts the file library (Plan 3) and keeps a small
 * settings-loaded indicator wired through window.panelApi.
 */
export function PanelApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    window.panelApi
      .getSettings()
      .then((s) => setSettings(s))
      .catch(() => setSettings(null))
    const unsubscribe = window.panelApi.onSettingsChanged((s) => setSettings(s))
    return () => unsubscribe()
  }, [])

  return (
    <div className="panel">
      <h1>Pet Panel</h1>
      <p className="panel__status">{settings ? 'Connected.' : 'Connecting…'}</p>
      <FileLibrary />
    </div>
  )
}
```

- [ ] **Step 3: Add library styles to `panel.css`**

Append to `src/renderer/src/panel/panel.css`:

```css
.library {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.library__bar {
  display: flex;
  gap: 8px;
}

.library__search {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
}

.library__feed {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: #3b82f6;
  color: #fff;
  cursor: pointer;
}
.library__feed:disabled {
  opacity: 0.6;
  cursor: default;
}

.library__drop {
  min-height: 120px;
  border: 1.5px dashed rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  padding: 8px;
}
.library__drop--over {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
}

.library__empty {
  opacity: 0.6;
  text-align: center;
  margin: 36px 0;
}

.library__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.library__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

.library__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.library__name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.library__sub {
  opacity: 0.6;
  font-size: 12px;
}

.library__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.library__actions button {
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  cursor: pointer;
}
.library__danger {
  color: #fca5a5;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panel/FileLibrary.tsx src/renderer/src/panel/PanelApp.tsx src/renderer/src/panel/panel.css
git commit -m "feat(panel): file library UI — list/search/open/reveal/delete + feed + drop"
```

---

## Task 12: Manual verification checklist

**Files:**
- Create: `docs/superpowers/2026-06-13-plan3-manual-verification.md`

- [ ] **Step 1: Write the checklist**

`docs/superpowers/2026-06-13-plan3-manual-verification.md`:

```markdown
# Plan 3 — Manual Verification (file ingestion & vault)

Run `npm run dev`. Then verify:

## Feed paths
- [ ] **Drop on pet:** drag a file onto the Live2D character → pet plays `receive`,
      and the file appears in the panel's file library (open the panel from the tray).
- [ ] **Panel "Feed file":** click "Feed file" → OS picker → choose file(s) → they
      appear in the list.
- [ ] **Drag onto panel:** drag a file onto the panel drop zone → it appears.

## Library actions
- [ ] **Open:** click Open → file launches in its default app (correct extension).
- [ ] **Reveal:** click Reveal → OS file manager highlights the blob.
- [ ] **Delete:** click Delete → row disappears; deleting the last reference to a
      blob removes it from `userData/vault/blobs/...`.
- [ ] **Search:** type in the search box → list filters by name/ext/mime.

## Dedup & integrity
- [ ] Feeding the SAME file twice (same name+content) → only ONE row.
- [ ] Feeding identical content under two different names → TWO rows, ONE blob on disk
      (check `userData/vault/blobs/<ab>/<cd>/`).

## Robustness
- [ ] DB + vault live under `userData` (Windows `%AppData%/pet`): `library.db`,
      `vault/blobs`, `vault/tmp` (empty after ingests).
- [ ] Quitting and relaunching → previously fed files still listed.
- [ ] Pet passthrough / drag / tray all still work (no Plan 1/2 regression).

## Where to find userData
- Windows: `%AppData%/pet`
- macOS: `~/Library/Application Support/pet`
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/2026-06-13-plan3-manual-verification.md
git commit -m "docs: Plan 3 manual verification checklist"
```

---

## Task 13: Final gates

**Files:** none (verification only).

- [ ] **Step 1: Run every gate**

Run each and confirm:

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 errors
npm run test        # all suites pass (note: stderr shows node:sqlite ExperimentalWarning — expected)
npm run build       # builds main + preload + renderer with no errors
```

Expected: all green. If `npm run test`'s exit code is non-zero, READ the failure — do not rely on grepping output. (`npm run test` runs `vitest run`, whose exit code reflects pass/fail.)

- [ ] **Step 2: Final review subagent**

Per subagent-driven-development, dispatch a final code-reviewer over the whole `feat/file-ingestion` diff vs `feat/live2d`: check spec coverage, the preserved `receive` call, electron-free `libraryStore`, no `any`, and that no Plan 1/2 contract changed.

- [ ] **Step 3: Report**

Summarize gate results to the user. Do NOT push or open a PR until the user asks; when they do, stack PR #3 with base `feat/live2d`.

---

## Self-review (author checklist — completed)

- **Spec coverage:** node:sqlite (T5) ✓; webUtils path resolution (T7/T8) ✓; dialog picker (T6) ✓; content-addressed vault + shard + tmp/atomic rename + write-once dedup (T5) ✓; `files` schema incl. unique (sha256, original_name) row-dedup (T5) ✓; three feed paths — drop-on-pet (T10), panel button (T6/T8/T11), drag-onto-panel (T8/T11) ✓; four library actions — open/reveal/delete/search (T6/T11/T3) ✓; reuse `playAction('receive')` preserved (T10) ✓; mirror settingsStore + IPC conventions ✓; tests in node-env globs only ✓; last-reference blob reclaim (T5) ✓; tmp/work sweep (T5) ✓; broadcast→panel refresh (T6/T9/T11) ✓.
- **Type consistency:** `FileRecord`/`IngestResult` defined T1, used identically in T5/T6/T7/T8/T11. `LibraryApi` (T4) matches `buildPanelApi.library` (T8) and the IPC handlers (T6). Channel constants `LIBRARY_*` consistent across T4/T6/T7/T8/T9. `createLibraryStore(userDataDir, options?)` signature consistent T5↔T9 (T9 omits options → defaults). `libraryStore` deps shape (T6 `IpcDeps`) is a structural subset of the T5 return — compatible.
- **Placeholder scan:** none — every code step has complete code.
- **Known intentional red state:** typecheck is red after T4 until T8 (documented in T4 Step 3 + T8 Step 4); per-task vitest runs stay green throughout.
- **Adversarial review applied (3 critics ran real tsc/eslint):** the hard parts verified sound (streaming hash+copy tee, INSERT-OR-IGNORE row-dedup, node:sqlite availability + main-build externalization, panel key assertions). Two compile blockers fixed inline — `list()` casts `.all()` through `unknown` (node:sqlite `.all()` is typed `Record<string, SQLOutputValue>[]`); `shell`/`dialog` deps typed `Pick<Electron.Shell|Dialog, …>` so the raw electron objects inject with no adapter. Added `PRAGMA user_version = 1` (+ test) and a spec-§7 vault-containment assert.
```

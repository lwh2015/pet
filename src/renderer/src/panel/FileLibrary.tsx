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
  // Monotonic request id: rapid library:changed events launch overlapping list()
  // invokes that may resolve out of order; ignore any resolution that is not the
  // latest so a stale (shorter) list never clobbers a newer one.
  const refreshSeq = useRef(0)

  const refresh = useCallback((): void => {
    const seq = ++refreshSeq.current
    window.panelApi.library
      .list()
      .then((list) => {
        if (seq === refreshSeq.current) setItems(list)
      })
      .catch((e: unknown) => console.error('[FileLibrary] list failed', e))
  }, [])

  useEffect(() => {
    refresh()
    const off = window.panelApi.onLibraryChanged(() => refresh())
    return () => off()
  }, [refresh])

  const ingestPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      setBusy(true)
      try {
        const results = await window.panelApi.library.ingestPaths(paths)
        const failed = results.filter((r) => !r.ok)
        if (failed.length > 0) console.warn('[FileLibrary] some ingests failed', failed)
      } catch (e) {
        console.error('[FileLibrary] ingest failed', e)
      } finally {
        setBusy(false)
        refresh()
      }
    },
    [refresh]
  )

  const onFeedClick = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.panelApi.library.pick()
    } catch (e) {
      console.error('[FileLibrary] feed failed', e)
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
      // Iterate the real FileList here; pass each File to the preload singly
      // (a FileList does not survive the contextBridge).
      const paths: string[] = []
      for (const f of Array.from(files)) {
        const p = window.panelApi.getPathForFile(f)
        if (p) paths.push(p)
      }
      void ingestPaths(paths)
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
                    {formatBytes(f.sizeBytes)} · {f.mime} ·{' '}
                    {new Date(f.ingestedAt).toLocaleString()}
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

import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'

/**
 * Panel placeholder route (opaque). Reads the current Settings via
 * window.panelApi.getSettings() and stays in sync via onSettingsChanged.
 * Empty shell for Plans 3/4 — only proves the panel preload + IPC are wired.
 */
export function PanelApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.panelApi
      .getSettings()
      .then((s) => setSettings(s))
      .catch((e: unknown) => setError(String(e)))
    const unsubscribe = window.panelApi.onSettingsChanged((s) => setSettings(s))
    return () => unsubscribe()
  }, [])

  return (
    <div className="panel">
      <h1>Pet Panel</h1>
      {error ? (
        <p className="panel__status">Failed to load settings: {error}</p>
      ) : settings ? (
        <>
          <p className="panel__status">Settings loaded.</p>
          <pre className="panel__settings">{JSON.stringify(settings, null, 2)}</pre>
        </>
      ) : (
        <p className="panel__status">Loading settings…</p>
      )}
    </div>
  )
}

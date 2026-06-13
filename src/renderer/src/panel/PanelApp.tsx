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

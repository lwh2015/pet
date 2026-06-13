// Vitest setup (node environment). The preload modules (index.ts / panel.ts) run
// an exposure side-effect at import time, branching on process.contextIsolated:
// the true branch uses contextBridge.exposeInMainWorld (stubbed, safe), the false
// branch assigns to `window` (undefined in the node env). Force the contextBridge
// branch so importing the preload modules under test has no window dependency.
// The pure factories (buildPetApi/buildPanelApi) are what the tests actually drive.
;(process as unknown as { contextIsolated?: boolean }).contextIsolated = true

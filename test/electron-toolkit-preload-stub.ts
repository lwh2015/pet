// Test-only stub for '@electron-toolkit/preload'. The real package imports named
// runtime exports from 'electron' at module top, which cannot load under vitest's
// node environment. The preload modules only expose `electronAPI` as opaque glue
// (not unit-tested), so a minimal placeholder is sufficient. Aliased in
// vitest.config.ts; production builds use the real package.
export const electronAPI = {}
export default { electronAPI }

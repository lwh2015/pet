import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['test/setup.ts'],
    include: [
      'src/shared/**/*.{test,spec}.ts',
      'src/main/**/*.{test,spec}.ts',
      'src/preload/**/*.{test,spec}.ts'
    ],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**']
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Test-only: the real electron entry exports a path string, so the
      // preload modules' top-level named imports (contextBridge/ipcRenderer)
      // cannot load under vitest. ipc.test.ts's own vi.mock('electron') still
      // takes precedence over this alias.
      electron: resolve(__dirname, 'test/electron-stub.ts'),
      // Same reason: this package imports named electron runtime exports at its
      // module top; the preload modules only use its opaque electronAPI glue.
      '@electron-toolkit/preload': resolve(
        __dirname,
        'test/electron-toolkit-preload-stub.ts'
      )
    }
  }
})

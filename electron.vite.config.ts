import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two DISTINCT input keys -> out/preload/index.js + out/preload/panel.js.
        // Never share one key across the two preloads.
        input: {
          index: resolve('src/preload/index.ts'),
          panel: resolve('src/preload/panel.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      // Fewer shared chunks across the two HTML entries.
      isolatedEntries: true,
      rollupOptions: {
        // Two HTML entries -> out/renderer/index.html + out/renderer/panel.html.
        input: {
          index: resolve('src/renderer/index.html'),
          panel: resolve('src/renderer/panel.html')
        }
      }
    }
  }
})

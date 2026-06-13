import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/shared/**/*.{test,spec}.ts',
      'src/main/**/*.{test,spec}.ts'
    ],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**']
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})

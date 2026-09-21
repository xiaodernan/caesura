import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { port: 5173 },
  build: {
    target: 'es2022',
    manualChunks: (id) => {
      if (id.includes('node_modules/three')) return 'three'
      if (id.includes('/src/data/')) return 'data'
      if (id.includes('/src/ui/')) return 'ui'
      if (id.includes('/src/audio/')) return 'audio'
      if (id.includes('/src/world/') || id.includes('/src/vfx/')) return 'render'
      return undefined
    }
  }
})

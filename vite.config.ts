import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import path from 'path'
import { readFileSync } from 'fs'

// Read version from package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const APP_VERSION = pkg.version || '0.0.0'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  // Get base path from environment variable for GitHub Pages support
  // Default: '/' for local development, '/repo-name/' for GitHub Pages
  const base = env.BASE_URL || '/'

  return {
    plugins: [
      react(),
      {
        name: 'version-injection',
        enforce: 'pre',
        resolveId(id) {
          if (id === 'virtual:version') {
            return '\0virtual:version'
          }
        },
        load(id) {
          if (id === '\0virtual:version') {
            return `export const APP_VERSION = '${APP_VERSION}'`
          }
        },
      },
    ],
    root: 'client',
    base,
    server: {
      host: true,
      port: 8080,
    },
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
    build: {
      outDir: '../docs',
      cssMinify: true,
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve('./client'),
        '@server': path.resolve('./server'),
        '@shared': path.resolve('./shared'),
      },
    },
  }
})

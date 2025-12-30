import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  // Get base path from environment variable for GitHub Pages support
  // Default: '/' for local development, '/repo-name/' for GitHub Pages
  const base = env.BASE_URL || '/'

  return {
    plugins: [react()],
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
      outDir: '../dist',
      cssMinify: true,
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve('./client'),
        '@server': path.resolve('./server'),
      },
    },
  }
})

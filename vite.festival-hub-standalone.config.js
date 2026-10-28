import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROBOTS_TXT, SITEMAP_XML, applyLaunchHtml, isLaunchBuild } from './scripts/standalone/mode.mjs'

// Festival Hub STANDALONE build (preview deploy branch only).
//
// Builds only festival-hub/index.html into dist-hub-standalone/, with no
// calendar code, no PWA plugin / service worker, no manifest and no public/
// directory copy -- only the favicon. The logo is the Hub's own imported
// asset (src/festivalHub/assets/msm-logo-hub.webp), emitted by Vite.
// scripts/standalone/verify-output.mjs then checks the output and the
// module graph recorded below, and fails the build if anything else is
// present. The calendar's own build (vite.config.js, "npm run build") is
// unaffected.
//
// Build mode (scripts/standalone/mode.mjs): "staging" by default -- staging
// banner, noindex meta, optional demo. "launch" only for a release build on a
// production deployment (or HUB_LAUNCH=1): public head tags with the canonical
// URL, robots.txt + sitemap.xml, no staging banner, no demo.
const ROOT = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(ROOT, 'dist-hub-standalone')
// Written next to (not inside) the output so it is never deployed.
export const MODULE_GRAPH_FILE = resolve(ROOT, 'dist-hub-standalone.modules.json')
const STATIC_FILES = ['favicon.ico']
const LAUNCH = isLaunchBuild(process.env)

// "\0/abs/node_modules/react/index.js?commonjs-module" -> "virtual:node_modules/react/index.js?commonjs-module"
function normaliseId(id) {
  const isVirtual = id.startsWith('\0')
  const [path, query] = id.replace(/^\0/, '').split('?')
  const rel = path.startsWith('/') ? relative(ROOT, path) : path
  return (isVirtual ? 'virtual:' : '') + rel + (query ? `?${query}` : '')
}

function standaloneExtras() {
  return {
    name: 'festival-hub-standalone-extras',
    transformIndexHtml(html) {
      return LAUNCH ? applyLaunchHtml(html) : html
    },
    generateBundle(_options, bundle) {
      if (LAUNCH) {
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: ROBOTS_TXT })
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: SITEMAP_XML })
      }
      const graph = {}
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        graph[chunk.fileName] = {
          modules: Object.keys(chunk.modules).map(normaliseId),
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
        }
      }
      writeFileSync(MODULE_GRAPH_FILE, JSON.stringify(graph, null, 2))
    },
    closeBundle() {
      for (const file of STATIC_FILES) {
        mkdirSync(dirname(resolve(OUT_DIR, file)), { recursive: true })
        copyFileSync(resolve(ROOT, 'public', file), resolve(OUT_DIR, file))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), standaloneExtras()],
  publicDir: false,
  define: {
    'import.meta.env.VITE_HUB_LAUNCH': JSON.stringify(LAUNCH ? '1' : '0'),
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    assetsDir: 'festival-hub/assets',
    sourcemap: false,
    rollupOptions: {
      input: resolve(ROOT, 'festival-hub/index.html'),
    },
  },
})

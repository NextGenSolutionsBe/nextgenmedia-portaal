// Kopieert de pdf.js-worker (legacy-build, mét polyfills) naar public/, zodat de
// contracteditor hem van onze eigen site laadt — altijd exact dezelfde versie
// als het geïnstalleerde pdfjs-dist. Draait automatisch vóór `next build` en
// `next dev`. Het gekopieerde bestand staat bewust niet in Git.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const bron = join(dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.min.mjs')
const doel = join(process.cwd(), 'public/pdfjs/pdf.worker.min.mjs')
mkdirSync(dirname(doel), { recursive: true })
copyFileSync(bron, doel)
console.log('pdf.js-worker gekopieerd naar public/pdfjs/')

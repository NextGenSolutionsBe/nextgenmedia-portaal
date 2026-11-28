// pdf.js wordt lazy geladen (alleen client). Bewust de LEGACY-build: pdf.js 6
// gebruikt splinternieuwe JavaScript (o.a. Map.prototype.getOrInsertComputed)
// die de meeste browsers nog niet kennen → "getOrInsertComputed is not a
// function". De legacy-build brengt daar polyfills voor mee. De worker komt uit
// hetzelfde pakket: scripts/kopieer-pdf-worker.mjs zet hem bij elke build in
// public/pdfjs/ (de CDN heeft geen legacy-worker), dus altijd dezelfde versie.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsPromise: Promise<any> | null = null
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker.min.mjs?v=${pdfjs.version}`
      return pdfjs
    }).catch((e) => { pdfjsPromise = null; throw e })
  }
  return pdfjsPromise
}

/**
 * PDF.js loader shared by the reader and the import-time analyzer.
 *
 * A dedicated worker is created from an inlined copy of pdf.worker so the
 * plugin stays a single browser module; PDF.js itself needs the same version's
 * worker code.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.js?raw';

let workerUrl = null;
let fakeWorkerInstall = null;

function ensureWorkerUrl() {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return workerUrl;
}

/**
 * Run PDF.js's worker module on the page thread.
 *
 * A blob Worker is the usual choice, but in Electron-like renderers a blocked
 * or misbehaving worker can leave `getDocument()` waiting forever on its
 * handshake. The parser is fast enough on the page thread (a 10 MiB, 27-page
 * paper opens in well under a second), so installing the worker bundle as a
 * regular script is both more predictable and faster to first page.
 */
function installFakeWorker() {
  if (globalThis.pdfjsWorker?.WorkerMessageHandler) return Promise.resolve();
  if (fakeWorkerInstall) return fakeWorkerInstall;
  fakeWorkerInstall = new Promise((resolve, reject) => {
    try {
      // A classic script in page context is enough for the UMD worker bundle.
      // eslint-disable-next-line no-new-func
      new Function(workerSource)();
    } catch { /* fall through to a script tag */ }
    if (globalThis.pdfjsWorker?.WorkerMessageHandler) { resolve(); return; }
    const script = document.createElement('script');
    script.src = ensureWorkerUrl();
    script.onload = () => {
      if (globalThis.pdfjsWorker?.WorkerMessageHandler) resolve();
      else reject(new Error('PDF 解析器初始化失败'));
    };
    script.onerror = () => reject(new Error('PDF 解析器初始化失败（可能被页面安全策略阻止）'));
    document.head.appendChild(script);
  });
  return fakeWorkerInstall;
}

export async function openPdfDocument(data) {
  await installFakeWorker();
  const task = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    disableAutoFetch: true,
    disableStream: false,
  });
  const doc = await task.promise;
  return { doc, worker: null, task };
}

export function metadataFacts(info, firstPageText, fallbackName) {
  const rawTitle = String(info?.Title || '').trim();
  const fallback = String(fallbackName || 'Untitled paper').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  let title = rawTitle;
  if (
    !title
    || title.length < 6
    || /^(untitled|microsoft word|document\d*|slide\s*\d+)/i.test(title)
    || /\.(docx?|pdf)$/i.test(title)
  ) {
    title = '';
  }
  if (!title && firstPageText) {
    const lines = firstPageText
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 18 && line.length < 260)
      .filter((line) => !/arxiv|doi|preprint|proceedings|conference on|under review|copyright|all rights reserved/i.test(line));
    if (lines.length > 0) {
      const chosen = lines.slice(0, 5).sort((a, b) => b.length - a.length)[0];
      if (chosen && chosen.length >= 18) title = chosen;
    }
  }
  if (!title) title = fallback || 'Untitled paper';

  const authors = String(info?.Author || '')
    .split(/\s*(?:;|\band\b|&)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 30);
  let year = '';
  const creation = String(info?.CreationDate || '');
  const yearMatch = creation.match(/D:(\d{4})/) || String(firstPageText || '').match(/\b(19|20)\d{2}\b/);
  if (yearMatch) year = yearMatch[1] || yearMatch[0];
  const venue = String(info?.Subject || '').trim().slice(0, 180);
  return { title: title.slice(0, 300), authors, year, venue };
}

function textFromContent(content) {
  let out = '';
  let lastY = null;
  for (const item of content.items || []) {
    if (!item || typeof item.str !== 'string') continue;
    const str = item.str;
    if (!str) continue;
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2.5 && !out.endsWith('\n')) out += '\n';
    else if (out && !out.endsWith(' ') && !out.endsWith('\n') && !str.startsWith(' ')) out += ' ';
    out += str;
    if (item.hasEOL) out += '\n';
    if (y !== null) lastY = y;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function analyzePdfFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const { doc, worker } = await openPdfDocument(data);
  try {
    const info = await doc.getMetadata().then((m) => m?.info || {}).catch(() => ({}));
    const maxPages = Math.min(doc.numPages, 160);
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(textFromContent(content));
      page.cleanup();
    }
    const text = pageTexts
      .map((value, index) => `\n=== Page ${index + 1} ===\n${value}`)
      .join('\n')
      .trim()
      .slice(0, 3_800_000);
    const facts = metadataFacts(info, pageTexts[0] || '', file.name);
    return { ...facts, text, pageCount: doc.numPages, pagesWithText: pageTexts.filter(Boolean).length };
  } finally {
    try { await doc.destroy(); } catch { /* ignore */ }
    try { worker.destroy(); } catch { /* ignore */ }
  }
}

export { pdfjsLib };

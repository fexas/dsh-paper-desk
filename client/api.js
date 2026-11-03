/** Thin typed facade over the `paperDesk` Remote namespace. */
const CHUNK_BYTES = 768 * 1024;
const DOWNLOAD_CHUNK_BYTES = 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 8;
const PDF_CACHE_LIMIT = 160 * 1024 * 1024;
const pdfCache = new Map();
const pdfInflight = new Map();

function unwrap(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.ok === false) {
    const error = result.error;
    throw new Error(error?.message || 'Paper Desk 请求失败');
  }
  return result.value;
}

export function makeApi(remote) {
  const call = (method, ...args) => remote[method](...args).then(unwrap);
  return {
    clientReady: (version) => call('clientReady', version),
    listProjects: () => call('listProjects'),
    createProject: (name) => call('createProject', name),
    renameProject: (projectId, name) => call('renameProject', projectId, name),
    deleteProject: (projectId) => call('deleteProject', projectId),
    getProject: (projectId) => call('getProject', projectId),
    beginPaper: (projectId, filename, size) => call('beginPaper', projectId, filename, size),
    beginAttachment: (projectId, paperId, filename, size, mime) => call('beginAttachment', projectId, paperId, filename, size, mime),
    putUploadChunk: (uploadId, index, dataBase64) => call('putUploadChunk', uploadId, index, dataBase64),
    finishUpload: (uploadId) => call('finishUpload', uploadId),
    updatePaper: (projectId, paperId, patch) => call('updatePaper', projectId, paperId, JSON.stringify(patch)),
    deletePaper: (projectId, paperId) => call('deletePaper', projectId, paperId),
    deleteAttachment: (projectId, paperId, attachmentId) => call('deleteAttachment', projectId, paperId, attachmentId),
    getReaderData: (projectId, paperId) => call('getReaderData', projectId, paperId),
    savePaperText: (projectId, paperId, text) => call('savePaperText', projectId, paperId, text),
    generateNotes: (projectId, paperId, force = false) => call('generateNotes', projectId, paperId, force),
    saveNotes: (projectId, paperId, markdown) => call('saveNotes', projectId, paperId, markdown),
    saveAnnotations: (projectId, paperId, annotations) => call('saveAnnotations', projectId, paperId, JSON.stringify({ version: 1, annotations })),
    chat: (projectId, paperId, text, quote, page) => call('chat', projectId, paperId, text, quote, page),
    clearChat: (projectId, paperId) => call('clearChat', projectId, paperId),
    translate: (projectId, paperId, text, page) => call('translate', projectId, paperId, text, page),
    readPaperChunk: (projectId, paperId, kind, offset, length) => call('readPaperChunk', projectId, paperId, kind, offset, length),
    noteProgress: (projectId, paperId) => call('noteProgress', projectId, paperId),
  };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export async function uploadBlob(api, blob, { mode, projectId, paperId, onProgress }) {
  const begin = mode === 'paper'
    ? await api.beginPaper(projectId, blob.name || 'paper.pdf', blob.size)
    : await api.beginAttachment(projectId, paperId, blob.name || 'attachment', blob.size, blob.type || '');
  let index = 0;
  for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + CHUNK_BYTES));
    const dataBase64 = await blobToBase64(chunk);
    await api.putUploadChunk(begin.uploadId, index, dataBase64);
    index += 1;
    onProgress?.(Math.min(blob.size, offset + chunk.size), blob.size);
  }
  const finished = await api.finishUpload(begin.uploadId);
  return { begin, finished };
}

function decodeBase64(data) {
  const binary = atob(data || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function pdfCacheKey(projectId, paperId, paper) {
  return `${projectId}/${paperId}/${paper?.pdfBytes || 0}`;
}

export function getCachedPdf(key) {
  const value = pdfCache.get(key);
  if (!value) return null;
  // Refresh LRU position.
  pdfCache.delete(key);
  pdfCache.set(key, value);
  return value;
}

function cachePdf(key, bytes) {
  if (!key || !bytes?.length) return;
  pdfCache.set(key, bytes);
  let total = 0;
  for (const value of pdfCache.values()) total += value.length;
  while (total > PDF_CACHE_LIMIT && pdfCache.size > 1) {
    const oldest = pdfCache.keys().next().value;
    total -= pdfCache.get(oldest)?.length || 0;
    pdfCache.delete(oldest);
  }
}

async function fetchAllChunks(api, projectId, paperId, kind, onProgress) {
  const first = await api.readPaperChunk(projectId, paperId, kind, 0, DOWNLOAD_CHUNK_BYTES);
  const total = Number(first.size) || 0;
  if (total <= 0) return new Uint8Array(0);
  const chunkCount = Math.ceil(total / DOWNLOAD_CHUNK_BYTES);
  const chunks = new Array(chunkCount);
  chunks[0] = decodeBase64(first.data);
  let loaded = chunks[0].length;
  const report = () => onProgress?.(Math.min(loaded, total), total);
  report();
  if (chunkCount > 1) {
    let next = 1;
    const worker = async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= chunkCount) return;
        const offset = index * DOWNLOAD_CHUNK_BYTES;
        const result = await api.readPaperChunk(projectId, paperId, kind, offset, DOWNLOAD_CHUNK_BYTES);
        const bytes = decodeBase64(result.data);
        chunks[index] = bytes;
        loaded += bytes.length;
        report();
      }
    };
    const workers = Math.min(DOWNLOAD_CONCURRENCY, chunkCount - 1);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    merged.set(chunk, at);
    at += chunk.length;
  }
  return at === total ? merged : merged.slice(0, at);
}

/**
 * Fetch a file with parallel range reads, deduplicating concurrent requests for
 * the same cached PDF. The first page can only render once its bytes are here,
 * so eight in-flight 1 MiB reads beat a sequential cursor substantially.
 */
export async function downloadEntireFile(api, projectId, paperId, kind, onProgress, cacheKey) {
  if (cacheKey) {
    const cached = getCachedPdf(cacheKey);
    if (cached) {
      onProgress?.(cached.length, cached.length);
      return cached;
    }
    const pending = pdfInflight.get(cacheKey);
    if (pending) return pending;
  }
  const task = fetchAllChunks(api, projectId, paperId, kind, onProgress)
    .then((bytes) => {
      if (cacheKey) cachePdf(cacheKey, bytes);
      return bytes;
    })
    .finally(() => {
      if (cacheKey) pdfInflight.delete(cacheKey);
    });
  if (cacheKey) pdfInflight.set(cacheKey, task);
  return task;
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatRelative(value) {
  if (!value) return '刚刚';
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function paperMetaLine(paper) {
  const authors = Array.isArray(paper.authors) ? paper.authors.filter(Boolean) : [];
  const shortAuthors = authors.length > 3 ? `${authors.slice(0, 2).join(', ')} et al.` : authors.join(', ');
  return [shortAuthors, paper.year, paper.venue].filter(Boolean).join(' · ');
}

export function isChineseLocale() {
  const lang = (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || 'zh';
  return String(lang).toLowerCase().startsWith('zh');
}

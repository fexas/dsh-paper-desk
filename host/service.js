/**
 * Paper Desk — host half.
 *
 * Owns the on-disk project library, chunked browser uploads, annotations,
 * Markdown notes and the DeepSeek co-reading calls. The paper library lives in
 * `projects/` beside this plugin so a user can inspect and sync it directly.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const MANAGED_INSTALL = PLUGIN_ROOT.split(path.sep).includes('node_modules');
const DEFAULT_DATA_ROOT = MANAGED_INSTALL
  ? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'paper-desk', 'projects')
  : path.join(PLUGIN_ROOT, 'projects');
const PACKAGE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
})();
const MAX_FILE_BYTES = 160 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const NOTE_MAX_CHARS = 80_000;
const PAPER_CONTEXT_CHARS = 52_000;
const UPLOAD_CHUNK_MAX = 2 * 1024 * 1024;

const REMOTE_METHOD_NAMES = [
  'listProjects',
  'clientReady',
  'createProject',
  'renameProject',
  'deleteProject',
  'getProject',
  'beginPaper',
  'beginAttachment',
  'putUploadChunk',
  'finishUpload',
  'updatePaper',
  'deletePaper',
  'deleteAttachment',
  'getReaderData',
  'savePaperText',
  'generateNotes',
  'noteProgress',
  'saveNotes',
  'saveAnnotations',
  'chat',
  'clearChat',
  'translate',
  'readPaperChunk',
];

const now = () => new Date().toISOString();
const rand = (n = 5) => crypto.randomBytes(n).toString('hex');
const clampText = (value, max) => String(value ?? '').replace(/\u0000/g, '').slice(0, max);

function slugify(value, fallback = 'untitled') {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 90)
    .toLowerCase();
  return slug || fallback;
}

function safeFilename(value, fallback = 'file') {
  const name = path.basename(String(value ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').trim();
  return (name || fallback).slice(0, 150);
}

function uniqueChild(dir, desired, isDir = true) {
  const base = safeFilename(desired, 'item');
  let candidate = base;
  let i = 2;
  const suffixOf = (name) => isDir || !path.extname(name) ? name : name;
  while (fs.existsSync(path.join(dir, suffixOf(candidate)))) {
    const ext = isDir ? '' : path.extname(base);
    const stem = isDir ? base : base.slice(0, base.length - ext.length);
    candidate = `${stem}-${i}${ext}`;
    i += 1;
  }
  return candidate;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function looksLikePdf(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    return buf.toString('latin1') === '%PDF-';
  } catch {
    return false;
  }
}

function titleFromFilename(name) {
  return String(name || 'Untitled paper')
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled paper';
}

function firstSurname(author) {
  const value = String(author || '').trim();
  if (!value) return '';
  if (value.includes(',')) return value.split(',')[0].trim();
  const parts = value.split(/\s+/);
  return parts[parts.length - 1] || value;
}

/** Zotero-shaped folder name: Author et al. - Year - Title. */
function folderForPaper(meta) {
  const authors = Array.isArray(meta.authors) ? meta.authors.filter(Boolean) : [];
  const authorPart = authors.length === 0
    ? ''
    : authors.length === 1
      ? firstSurname(authors[0])
      : `${firstSurname(authors[0])} et al.`;
  const yearPart = meta.year ? String(meta.year).slice(0, 4) : '';
  const title = meta.title || 'Untitled paper';
  const pieces = [authorPart, yearPart, title].filter(Boolean);
  return slugify(pieces.join(' - '), 'paper').slice(0, 110);
}

function stripFrontmatter(md) {
  return String(md || '').replace(/^---[\s\S]*?---\s*/, '');
}

function notePreview(md, limit = 240) {
  const body = stripFrontmatter(md)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, limit);
}

function isPdfName(name) {
  return /\.pdf$/i.test(String(name || ''));
}

function normalizeAuthors(value) {
  if (Array.isArray(value)) return value.map((a) => String(a).trim()).filter(Boolean).slice(0, 30);
  return String(value || '')
    .split(/\s*(?:;|\band\b|&)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，]/);
  const seen = new Set();
  const tags = [];
  for (const raw of source) {
    const tag = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 24) break;
  }
  return tags;
}

function withPageContext(paper, notes, annotations) {
  const parts = [
    `论文标题：${paper.title}`,
    paper.authors?.length ? `作者：${paper.authors.join(', ')}` : '',
    paper.year ? `年份：${paper.year}` : '',
    paper.venue ? `发表：${paper.venue}` : '',
    notes ? `\n## 已有的精读笔记\n${stripFrontmatter(notes).slice(0, 18_000)}` : '',
    annotations?.length
      ? `\n## 用户的标注（共 ${annotations.length} 条）\n${annotations
        .slice(-24)
        .map((a) => `- 第 ${a.page} 页${a.note ? `（笔记：${a.note}）` : ''}：“${String(a.text || '').slice(0, 260)}”`)
        .join('\n')}`
      : '',
  ];
  return parts.filter(Boolean).join('\n');
}

function paperTextForPrompt(text) {
  const clean = String(text || '');
  if (clean.length <= PAPER_CONTEXT_CHARS) return clean;
  const head = clean.slice(0, 36_000);
  const tail = clean.slice(-14_000);
  return `${head}\n\n[... 中间部分因长度限制省略 ...]\n\n${tail}`;
}

function relevantPaperText(text, question, page) {
  const clean = String(text || '');
  if (!clean) return '';
  const pageBlocks = clean.split(/\n=== Page (\d+) ===\n/);
  const blocks = [];
  for (let i = 1; i < pageBlocks.length; i += 2) {
    blocks.push({ page: Number(pageBlocks[i]), text: pageBlocks[i + 1] || '' });
  }
  if (blocks.length === 0) return paperTextForPrompt(clean);

  const queryWords = String(question || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .slice(0, 12);
  const selectedPage = Number(page) || 0;
  const picked = new Map();
  const add = (block, priority) => {
    if (!block) return;
    const prev = picked.get(block.page);
    if (!prev || priority > prev.priority) picked.set(block.page, { ...block, priority });
  };
  for (const block of blocks) {
    if (block.page === 1 || block.page === blocks.length) add(block, 3);
    if (selectedPage && Math.abs(block.page - selectedPage) <= 1) add(block, 6);
  }
  for (const block of blocks) {
    const hay = block.text.toLowerCase();
    if (queryWords.some((w) => hay.includes(w))) add(block, 4);
  }
  const ordered = [...picked.values()].sort((a, b) => b.priority - a.priority || a.page - b.page);
  let out = '';
  for (const block of ordered) {
    if (out.length + block.text.length > PAPER_CONTEXT_CHARS) continue;
    out += `\n=== Page ${block.page} ===\n${block.text}\n`;
  }
  if (out.length < 12_000) {
    out = paperTextForPrompt(clean);
  }
  return out;
}

export class PaperDeskService extends TypertRemoteService {
  static inject = ['llm'];

  constructor(ctx, config = {}) {
    super(ctx, 'paperDesk');
    this.config = config || {};
    this.root = this.config.dataDir ? path.resolve(String(this.config.dataDir)) : DEFAULT_DATA_ROOT;
    this.trashRoot = path.join(this.root, '.trash');
    this.uploadRoot = path.join(this.root, '.uploads');
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.trashRoot, { recursive: true });
    fs.mkdirSync(this.uploadRoot, { recursive: true });
    try {
      fs.writeFileSync(path.join(this.root, '.runtime.json'), JSON.stringify({ version: PACKAGE_VERSION, startedAt: now(), dataDir: this.root }, null, 2));
    } catch { /* runtime metadata is diagnostic only */ }
    this.uploads = new Map();
    this.noteJobs = new Map();
    this.noteProgressByKey = new Map();
    this.chatJobs = new Map();
    this.cleanupUploads();
    ctx.effect(() => () => {
      for (const upload of this.uploads.values()) {
        try { fs.rmSync(upload.tmp, { force: true }); } catch { /* best effort */ }
      }
      this.uploads.clear();
    }, 'paper-desk: uploads');
  }

  cleanupUploads() {
    try {
      const cutoff = Date.now() - 24 * 3600_000;
      for (const entry of fs.readdirSync(this.uploadRoot, { withFileTypes: true })) {
        const target = path.join(this.uploadRoot, entry.name);
        try {
          if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ paths

  projectDir(projectId) {
    const wanted = String(projectId || '');
    if (!wanted) throw new Error('缺少项目 id');
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const metaFile = path.join(this.root, entry.name, 'project.json');
      if (!fs.existsSync(metaFile)) continue;
      const meta = readJson(metaFile, null);
      if (meta?.id === wanted) return { dir: path.join(this.root, entry.name), meta };
    }
    throw new Error('项目不存在或已被删除');
  }

  loadProject(projectId) {
    const found = this.projectDir(projectId);
    return { ...found, meta: this.normalizeProject(found.meta, found.dir) };
  }

  normalizeProject(meta, dir) {
    return {
      id: String(meta.id),
      name: String(meta.name || '未命名项目'),
      folder: path.basename(dir),
      createdAt: meta.createdAt || now(),
      updatedAt: meta.updatedAt || meta.createdAt || now(),
      papers: Array.isArray(meta.papers) ? meta.papers : [],
    };
  }

  saveProject(dir, meta) {
    meta.updatedAt = now();
    writeJson(path.join(dir, 'project.json'), meta);
    return meta;
  }

  paperDir(projectDirValue, paper) {
    const target = path.resolve(projectDirValue, paper.folder);
    if (!target.startsWith(path.resolve(projectDirValue) + path.sep)) throw new Error('论文路径越界');
    return target;
  }

  paperFiles(projectDirValue, paper) {
    const dir = this.paperDir(projectDirValue, paper);
    return {
      dir,
      pdf: path.join(dir, 'paper.pdf'),
      notes: path.join(dir, 'notes.md'),
      text: path.join(dir, 'paper.txt'),
      annotations: path.join(dir, 'annotations.json'),
      chat: path.join(dir, 'chat.json'),
      attachments: path.join(dir, 'attachments'),
    };
  }

  pdfSize(dir, paper) {
    try { return fs.statSync(this.paperFiles(dir, paper).pdf).size; } catch { return 0; }
  }

  paperSummary(projectDirValue, paper, includePreview = false) {
    const files = this.paperFiles(projectDirValue, paper);
    const notes = readText(files.notes);
    const placeholder = notes.includes('AI 精读正在准备中');
    const attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
    return {
      id: paper.id,
      title: paper.title || 'Untitled paper',
      authors: Array.isArray(paper.authors) ? paper.authors : [],
      year: paper.year || '',
      venue: paper.venue || '',
      tags: Array.isArray(paper.tags) ? paper.tags : [],
      folder: paper.folder,
      originalFilename: paper.originalFilename || 'paper.pdf',
      addedAt: paper.addedAt || now(),
      updatedAt: paper.updatedAt || paper.addedAt || now(),
      parsedAt: paper.parsedAt || null,
      notesGeneratedAt: paper.notesGeneratedAt || null,
      hasText: Boolean(paper.hasText),
      textChars: Number(paper.textChars) || 0,
      pdfBytes: this.pdfSize(projectDirValue, paper),
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.name,
        bytes: Number(a.bytes) || 0,
        mime: a.mime || '',
        addedAt: a.addedAt || now(),
      })),
      hasNotes: notes.trim().length > 40 && !placeholder,
      notesPreview: includePreview ? notePreview(notes) : '',
    };
  }

  projectSummary(dir, meta) {
    const papers = (meta.papers || []).slice().sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    const tagCount = new Map();
    for (const paper of papers) for (const tag of paper.tags || []) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    return {
      id: meta.id,
      name: meta.name,
      folder: path.basename(dir),
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      paperCount: papers.length,
      notesCount: papers.filter((p) => this.paperSummary(dir, p).hasNotes).length,
      tagCount: tagCount.size,
      tags: [...tagCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  }

  findPaper(projectDirValue, paperId) {
    const project = this.loadProject(this.projectDirByDir(projectDirValue));
    const paper = project.meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在或已被删除');
    return { project, paper, files: this.paperFiles(projectDirValue, paper) };
  }

  projectDirByDir(dir) {
    const meta = readJson(path.join(dir, 'project.json'), null);
    if (!meta?.id) throw new Error('项目损坏：缺少 project.json');
    return meta.id;
  }

  // --------------------------------------------------------------- projects

  async clientReady(version) {
    try {
      fs.writeFileSync(path.join(this.root, '.client-runtime.json'), JSON.stringify({ clientVersion: String(version || ''), hostVersion: PACKAGE_VERSION, at: now() }, null, 2));
    } catch { /* diagnostic only */ }
    return { ok: true, hostVersion: PACKAGE_VERSION };
  }

  async listProjects() {
    const projects = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = path.join(this.root, entry.name);
      const meta = readJson(path.join(dir, 'project.json'), null);
      if (!meta?.id) continue;
      projects.push(this.projectSummary(dir, this.normalizeProject(meta, dir)));
    }
    projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { projects, root: this.root };
  }

  async createProject(name) {
    const clean = clampText(name, 100).trim();
    if (!clean) throw new Error('项目名称不能为空');
    const base = slugify(clean, 'project');
    const folder = uniqueChild(this.root, base, true);
    const dir = path.join(this.root, folder);
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
      id: `prj-${rand(6)}`,
      name: clean,
      createdAt: now(),
      updatedAt: now(),
      papers: [],
    };
    writeJson(path.join(dir, 'project.json'), meta);
    return this.projectSummary(dir, meta);
  }

  async renameProject(projectId, name) {
    const clean = clampText(name, 100).trim();
    if (!clean) throw new Error('项目名称不能为空');
    const { dir, meta } = this.loadProject(projectId);
    const base = slugify(clean, 'project');
    let nextDir = dir;
    if (path.basename(dir) !== base) {
      const folder = uniqueChild(this.root, base, true);
      nextDir = path.join(this.root, folder);
      fs.renameSync(dir, nextDir);
      meta.folder = folder;
    }
    meta.name = clean;
    this.saveProject(nextDir, meta);
    return this.projectSummary(nextDir, meta);
  }

  async deleteProject(projectId) {
    const { dir } = this.loadProject(projectId);
    const dest = path.join(this.trashRoot, `${path.basename(dir)}-${Date.now()}`);
    fs.renameSync(dir, dest);
    return { ok: true };
  }

  async getProject(projectId) {
    const { dir, meta } = this.loadProject(projectId);
    const papers = (meta.papers || [])
      .slice()
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
      .map((paper) => this.paperSummary(dir, paper, true));
    const summary = this.projectSummary(dir, meta);
    return { ...summary, papers, root: this.root };
  }

  // ---------------------------------------------------------------- uploads

  createUpload({ kind, projectId, paperId, filename, size, mime, projectDirValue }) {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('文件为空');
    if (bytes > MAX_FILE_BYTES) throw new Error(`文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限`);
    const uploadId = `up-${rand(8)}`;
    const tmp = path.join(this.uploadRoot, `${uploadId}.part`);
    fs.writeFileSync(tmp, Buffer.alloc(0));
    const upload = {
      id: uploadId,
      kind,
      projectId,
      paperId,
      projectDirValue,
      filename: safeFilename(filename, kind === 'paper' ? 'paper.pdf' : 'attachment'),
      mime: String(mime || ''),
      size: bytes,
      received: 0,
      index: 0,
      tmp,
      createdAt: now(),
    };
    this.uploads.set(uploadId, upload);
    return upload;
  }

  async beginPaper(projectId, filename, size) {
    const { dir, meta } = this.loadProject(projectId);
    if (!isPdfName(filename)) throw new Error('只接受 PDF 论文');
    const paperId = `pap-${rand(6)}`;
    const title = titleFromFilename(filename);
    const folderStem = folderForPaper({ title });
    const folderName = uniqueChild(path.join(dir, 'papers'), folderStem, true);
    const upload = this.createUpload({
      kind: 'paper',
      projectId,
      paperId,
      filename,
      size,
      mime: 'application/pdf',
      projectDirValue: path.join(dir, 'papers', folderName),
    });
    upload.paperBase = {
      id: paperId,
      title,
      authors: [],
      year: '',
      venue: '',
      tags: [],
      folder: path.join('papers', folderName),
      originalFilename: filename,
      addedAt: now(),
      updatedAt: now(),
      hasText: false,
      textChars: 0,
      notesGeneratedAt: null,
      parsedAt: null,
      attachments: [],
    };
    void meta;
    return { uploadId: upload.id, paperId, folder: upload.paperBase.folder, title };
  }

  async beginAttachment(projectId, paperId, filename, size, mime) {
    const { dir } = this.loadProject(projectId);
    const paper = this.loadProject(projectId).meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const upload = this.createUpload({
      kind: 'attachment',
      projectId,
      paperId,
      filename,
      size,
      mime,
      projectDirValue: dir,
    });
    return { uploadId: upload.id, filename: safeFilename(filename, 'attachment') };
  }

  async putUploadChunk(uploadId, index, dataBase64) {
    const upload = this.uploads.get(String(uploadId));
    if (!upload) throw new Error('上传会话不存在或已过期');
    const chunkIndex = Number(index);
    if (chunkIndex !== upload.index) throw new Error('上传分片顺序错误，请重试');
    const raw = String(dataBase64 || '');
    if (raw.length > UPLOAD_CHUNK_MAX * 2) throw new Error('上传分片过大');
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0) throw new Error('上传分片为空');
    if (upload.received + buffer.length > upload.size + 1024) throw new Error('上传内容超过声明大小');
    fs.appendFileSync(upload.tmp, buffer);
    upload.received += buffer.length;
    upload.index += 1;
    return { received: upload.received, size: upload.size };
  }

  async finishUpload(uploadId) {
    const upload = this.uploads.get(String(uploadId));
    if (!upload) throw new Error('上传会话不存在或已过期');
    try {
      if (upload.received === 0) throw new Error('没有收到文件内容');
      if (upload.kind === 'paper') return await this.finishPaperUpload(upload);
      if (upload.kind === 'attachment') return await this.finishAttachmentUpload(upload);
      throw new Error('未知上传类型');
    } finally {
      this.uploads.delete(upload.id);
      try { fs.rmSync(upload.tmp, { force: true }); } catch { /* ignore */ }
    }
  }

  async finishPaperUpload(upload) {
    if (!looksLikePdf(upload.tmp)) throw new Error('这个文件不是有效的 PDF');
    const { dir, meta } = this.loadProject(upload.projectId);
    const paper = upload.paperBase;
    const paperDir = path.join(dir, paper.folder);
    fs.mkdirSync(paperDir, { recursive: true });
    fs.renameSync(upload.tmp, path.join(paperDir, 'paper.pdf'));
    const notesTemplate = [
      `# ${paper.title}`,
      '',
      '> **TL;DR**',
      '>',
      '> AI 精读正在准备中。打开论文后，DeepSeek 会补全核心问题、方法、实验与局限。',
      '',
      '## 我的笔记',
      '',
      '- ',
      '',
    ].join('\n');
    writeText(path.join(paperDir, 'notes.md'), notesTemplate);
    writeJson(path.join(paperDir, 'annotations.json'), { version: 1, annotations: [] });
    writeJson(path.join(paperDir, 'chat.json'), { version: 1, messages: [] });
    meta.papers.push(paper);
    this.saveProject(dir, meta);
    return { kind: 'paper', paper: this.paperSummary(dir, paper, true) };
  }

  async finishAttachmentUpload(upload) {
    const { dir, meta } = this.loadProject(upload.projectId);
    const paper = meta.papers.find((p) => p.id === upload.paperId);
    if (!paper) throw new Error('论文不存在');
    const paperDir = path.join(dir, paper.folder);
    const attachDir = path.join(paperDir, 'attachments');
    fs.mkdirSync(attachDir, { recursive: true });
    const storedName = uniqueChild(attachDir, upload.filename, false);
    fs.renameSync(upload.tmp, path.join(attachDir, storedName));
    const attachment = {
      id: `att-${rand(6)}`,
      name: upload.filename,
      storedName,
      bytes: upload.received,
      mime: upload.mime || 'application/octet-stream',
      addedAt: now(),
    };
    paper.attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
    paper.attachments.push(attachment);
    paper.updatedAt = now();
    this.saveProject(dir, meta);
    return { kind: 'attachment', attachment, paper: this.paperSummary(dir, paper, true) };
  }

  // --------------------------------------------------------------- metadata

  async updatePaper(projectId, paperId, patchJson) {
    let patch = patchJson;
    if (typeof patchJson === 'string') {
      try { patch = JSON.parse(patchJson); } catch { throw new Error('论文信息格式错误'); }
    }
    if (!patch || typeof patch !== 'object') throw new Error('论文信息格式错误');
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const beforeFolder = paper.folder;
    if (typeof patch.title === 'string') paper.title = clampText(patch.title, 300).trim() || paper.title;
    if (patch.authors !== undefined) paper.authors = normalizeAuthors(patch.authors);
    if (patch.year !== undefined) paper.year = clampText(patch.year, 12).trim();
    if (patch.venue !== undefined) paper.venue = clampText(patch.venue, 200).trim();
    if (patch.tags !== undefined) paper.tags = normalizeTags(patch.tags);
    if (patch.parsedAt !== undefined) paper.parsedAt = patch.parsedAt ? now() : null;
    paper.updatedAt = now();

    const desired = folderForPaper(paper);
    const currentBase = path.basename(paper.folder);
    if (desired && desired !== currentBase) {
      const papersDir = path.join(dir, 'papers');
      const nextBase = uniqueChild(papersDir, desired, true);
      const oldPath = path.join(dir, beforeFolder);
      const newPath = path.join(papersDir, nextBase);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        paper.folder = path.join('papers', nextBase);
      }
    }
    meta.papers = meta.papers.map((p) => (p.id === paperId ? paper : p));
    this.saveProject(dir, meta);
    return this.paperSummary(dir, paper, true);
  }

  async deletePaper(projectId, paperId) {
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const target = path.join(dir, paper.folder);
    const dest = path.join(this.trashRoot, `${path.basename(target)}-${Date.now()}`);
    if (fs.existsSync(target)) fs.renameSync(target, dest);
    meta.papers = meta.papers.filter((p) => p.id !== paperId);
    this.saveProject(dir, meta);
    return { ok: true };
  }

  async deleteAttachment(projectId, paperId, attachmentId) {
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const attachment = (paper.attachments || []).find((a) => a.id === attachmentId);
    if (!attachment) throw new Error('附件不存在');
    const file = path.join(dir, paper.folder, 'attachments', safeFilename(attachment.storedName, 'attachment'));
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    paper.attachments = paper.attachments.filter((a) => a.id !== attachmentId);
    paper.updatedAt = now();
    this.saveProject(dir, meta);
    return this.paperSummary(dir, paper, true);
  }

  // ----------------------------------------------------------------- reader

  async getReaderData(projectId, paperId) {
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const files = this.paperFiles(dir, paper);
    const annotations = readJson(files.annotations, { version: 1, annotations: [] });
    const chat = readJson(files.chat, { version: 1, messages: [] });
    return {
      project: { id: meta.id, name: meta.name },
      paper: this.paperSummary(dir, paper, true),
      notes: readText(files.notes),
      annotations: Array.isArray(annotations.annotations) ? annotations.annotations : [],
      chat: Array.isArray(chat.messages) ? chat.messages : [],
      pdfBytes: this.pdfSize(dir, paper),
    };
  }

  async savePaperText(projectId, paperId, text) {
    const value = String(text || '');
    if (value.length > MAX_TEXT_BYTES) throw new Error('提取文本过大');
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const files = this.paperFiles(dir, paper);
    writeText(files.text, value);
    paper.hasText = value.trim().length > 0;
    paper.textChars = value.length;
    paper.updatedAt = now();
    this.saveProject(dir, meta);
    return { hasText: paper.hasText, textChars: paper.textChars };
  }

  async saveNotes(projectId, paperId, markdown) {
    const text = String(markdown || '');
    if (text.length > 2_000_000) throw new Error('笔记过大');
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const files = this.paperFiles(dir, paper);
    writeText(files.notes, text);
    paper.updatedAt = now();
    this.saveProject(dir, meta);
    return { savedAt: now(), paper: this.paperSummary(dir, paper, true) };
  }

  async saveAnnotations(projectId, paperId, annotationsJson) {
    let parsed = annotationsJson;
    if (typeof annotationsJson === 'string') {
      try { parsed = JSON.parse(annotationsJson); } catch { throw new Error('标注格式错误'); }
    }
    const annotations = Array.isArray(parsed?.annotations) ? parsed.annotations : Array.isArray(parsed) ? parsed : [];
    if (annotations.length > 3000) throw new Error('标注数量过多');
    const normalized = annotations.map((a) => ({
      id: String(a.id || `ann-${rand(4)}`),
      page: Number(a.page) || 1,
      color: ['yellow', 'green', 'blue', 'pink'].includes(a.color) ? a.color : 'yellow',
      rects: (Array.isArray(a.rects) ? a.rects : []).slice(0, 120).map((r) => ({
        x: Number(r.x) || 0,
        y: Number(r.y) || 0,
        w: Number(r.w) || 0,
        h: Number(r.h) || 0,
      })),
      text: clampText(a.text, 4000),
      note: clampText(a.note, 8000),
      createdAt: a.createdAt || now(),
      updatedAt: now(),
    }));
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const files = this.paperFiles(dir, paper);
    writeJson(files.annotations, { version: 1, annotations: normalized });
    paper.updatedAt = now();
    this.saveProject(dir, meta);
    return { count: normalized.length };
  }

  async readPaperChunk(projectId, paperId, kind, offset, length) {
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const files = this.paperFiles(dir, paper);
    let file;
    if (kind === 'pdf') file = files.pdf;
    else if (String(kind).startsWith('attachment:')) {
      const id = String(kind).slice('attachment:'.length);
      const attachment = (paper.attachments || []).find((a) => a.id === id);
      if (!attachment) throw new Error('附件不存在');
      file = path.join(files.attachments, safeFilename(attachment.storedName, 'attachment'));
    } else {
      throw new Error('未知文件');
    }
    const start = Math.max(0, Number(offset) || 0);
    const want = Math.min(Math.max(1, Number(length) || 1024 * 1024), 1024 * 1024);
    const stat = fs.statSync(file);
    const end = Math.min(stat.size, start + want);
    const buf = Buffer.alloc(Math.max(0, end - start));
    if (buf.length > 0) {
      const fd = fs.openSync(file, 'r');
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
    }
    return {
      data: buf.toString('base64'),
      offset: start,
      size: stat.size,
      eof: end >= stat.size,
      kind,
    };
  }

  // -------------------------------------------------------------------- ai

  async resolveRoute() {
    const providers = this.ctx.llm.listProviders();
    if (!providers.length) throw new Error('当前 profile 没有可用的模型 provider');
    const wanted = this.config.provider ? String(this.config.provider) : '';
    const provider = providers.find((p) => p.id === wanted)
      || providers.find((p) => /deepseek/i.test(p.id))
      || providers[0];
    let models = [];
    try { models = await this.ctx.llm.listModels(provider.id); } catch { /* fall through */ }
    let model = this.config.model ? String(this.config.model) : '';
    if (!model || (models.length > 0 && !models.some((m) => m.id === model))) {
      model = models.find((m) => /flash/i.test(m.id))?.id
        || models.find((m) => /chat/i.test(m.id))?.id
        || models[0]?.id
        || 'deepseek-flash';
    }
    return { provider: provider.id, model };
  }

  async complete({ system, messages, maxTokens = 4096, temperature = 0.35, onDelta }) {
    const route = await this.resolveRoute();
    let text = '';
    let failure = null;
    for await (const chunk of this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages,
      temperature,
      maxTokens,
    })) {
      if (chunk.type === 'text-delta') {
        text += chunk.text;
        onDelta?.(chunk.text);
      }
      if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'error') failure = chunk.reason.failure;
        if (chunk.reason.kind === 'aborted') failure = chunk.reason.failure || { message: '模型请求已取消' };
      }
    }
    if (failure) throw new Error(failure.message || 'DeepSeek 请求失败');
    const answer = text.trim();
    if (!answer) throw new Error('DeepSeek 没有返回文本');
    return { answer, route };
  }

  updateNoteProgress(key, patch) {
    const current = this.noteProgressByKey.get(key);
    if (!current) return;
    Object.assign(current, patch, { updatedAt: Date.now() });
  }

  async noteProgress(projectId, paperId) {
    const key = `${projectId}/${paperId}`;
    const state = this.noteProgressByKey.get(key);
    if (!state) return { active: false, stage: 'idle', chars: 0, startedAt: 0, updatedAt: 0, done: false, error: null };
    return { ...state, elapsedMs: state.startedAt ? Date.now() - state.startedAt : 0 };
  }

  async generateNotes(projectId, paperId, force) {
    const key = `${projectId}/${paperId}`;
    if (this.noteJobs.has(key)) return this.noteJobs.get(key);
    const startedAt = Date.now();
    const progressState = {
      active: true,
      stage: 'reading',
      chars: 0,
      startedAt,
      updatedAt: startedAt,
      done: false,
      error: null,
    };
    this.noteProgressByKey.set(key, progressState);
    const progress = (patch) => this.updateNoteProgress(key, patch);
    const job = (async () => {
      try {
        const { dir, meta } = this.loadProject(projectId);
        const paper = meta.papers.find((p) => p.id === paperId);
        if (!paper) throw new Error('论文不存在');
        const files = this.paperFiles(dir, paper);
        const existing = readText(files.notes);
        if (!force && paper.notesGeneratedAt && existing.trim().length > 120 && !existing.includes('AI 精读正在准备中')) {
          progress({ active: false, done: true, stage: 'done', chars: existing.length });
          return { notes: existing, paper: this.paperSummary(dir, paper, true), generated: false };
        }
        const text = readText(files.text);
        if (!text.trim()) throw new Error('还没有论文文本，请先打开一次论文或等待解析完成');
        progress({ stage: 'preparing' });
      const metaLine = [
        `标题：${paper.title}`,
        paper.authors?.length ? `作者：${paper.authors.join(', ')}` : '',
        paper.year ? `年份：${paper.year}` : '',
        paper.venue ? `发表：${paper.venue}` : '',
      ].filter(Boolean).join('\n');
      const system = [
        '你是 DeepSeek，一位严谨、敏锐的论文精读搭档。',
        '你只根据用户给出的论文文本写作，不编造论文中不存在的数据、实验或结论；不确定时明确说“论文没有说明”。',
        '用中文写作，重要的技术术语保留英文。Markdown 输出，层级清楚，段落紧凑，不要写空泛套话。',
      ].join('\n');
      const user = [
        `请为下面这篇论文写一份可以直接放进 Obsidian 的精读笔记。`,
        metaLine,
        '',
        '严格使用以下结构（不要输出一级标题，我会自己加）：',
        '> **TL;DR** — 3～5 句话讲清楚这篇论文做了什么、为什么重要、结果如何。',
        '',
        '## 1. 核心问题',
        '论文真正想解决什么问题？为什么这个问题重要、困难？把问题写成可检验的研究问题。',
        '',
        '## 2. 过去的方法：Pros / Cons',
        '用表格或分组列出主流做法，每一项写清楚它的优点和关键缺陷。',
        '',
        '## 3. 这篇论文如何补上 Cons',
        '逐条对应上一节的缺陷，解释新论文用什么设计解决了它们；区分“声称解决”和“实验证明解决”。',
        '',
        '## 4. 方法：Motivation / Key Idea / Example',
        '先讲 motivation，再讲 key motivating idea，再讲方法机制；给一个具体例子或 toy case 帮助理解。',
        '',
        '## 5. 实验结果怎么读',
        '解释任务、baseline、metric 分别意味着什么；结果是否支撑主张；有哪些 ablation 值得看；可能的 confounder。',
        '',
        '## 6. 优点、局限与未来展望',
        '优点要具体；局限包括作者承认的和没承认的；未来方向给出可执行的研究问题。',
        '',
        '## 7. 值得继续追问',
        '列出 3～5 个我们接下来可以讨论的问题。',
        '',
        '写作要求：',
        '- 关键论断后标注页码或章节，例如（p.4, §3.2）。',
        '- 如果论文的 PDF 文本有噪声，基于能读懂的部分谨慎总结。',
        '- 不要输出任何前言或“好的，以下是”。',
        '',
        '=== 论文全文（含页码标记）===',
        paperTextForPrompt(text),
      ].join('\n');
      progress({ stage: 'thinking' });
      let received = 0;
      let lastProgressAt = 0;
      const { answer, route } = await this.complete({
        system,
        messages: [createUserMessage({ content: [{ type: 'text', text: user }], source: { kind: 'user' } })],
        maxTokens: 7000,
        temperature: 0.25,
        onDelta: (delta) => {
          received += delta.length;
          const at = Date.now();
          if (at - lastProgressAt > 140) {
            lastProgressAt = at;
            progress({ stage: 'writing', chars: received });
          }
        },
      });
      progress({ stage: 'saving', chars: received });
      const title = paper.title || '论文精读';
      const frontmatter = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `authors: ${JSON.stringify(paper.authors || [])}`,
        `year: ${paper.year ? JSON.stringify(String(paper.year)) : '""'}`,
        `tags: ${JSON.stringify(paper.tags || [])}`,
        `source: ${JSON.stringify(paper.originalFilename || 'paper.pdf')}`,
        `generated_by: ${JSON.stringify(`${route.provider}/${route.model}`)}`,
        `generated_at: ${JSON.stringify(now())}`,
        '---',
        '',
        `# ${title}`,
        '',
      ].join('\n');
      let body = answer.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim();
      body = body.replace(/^---[\s\S]*?---\s*/, '').replace(/^#\s+.*\n+/, '');
      const notes = `${frontmatter}${body}\n`;
      writeText(files.notes, notes);
      paper.notesGeneratedAt = now();
      paper.updatedAt = now();
      this.saveProject(dir, meta);
      progress({ active: false, done: true, stage: 'done', chars: received });
      return { notes, paper: this.paperSummary(dir, paper, true), generated: true };
      } catch (reason) {
        progress({ active: false, done: true, stage: 'error', error: reason instanceof Error ? reason.message : String(reason) });
        throw reason;
      }
    })().finally(() => {
      this.noteJobs.delete(key);
      const timer = setTimeout(() => {
        if (this.noteProgressByKey.get(key) === progressState) this.noteProgressByKey.delete(key);
      }, 120_000);
      timer.unref?.();
    });
    this.noteJobs.set(key, job);
    return job;
  }

  async chat(projectId, paperId, text, quote, page) {
    const question = clampText(text, 12_000).trim();
    if (!question) throw new Error('请输入问题');
    const key = `${projectId}/${paperId}`;
    if (this.chatJobs.has(key)) throw new Error('上一条对话还在生成，请稍等');
    const job = (async () => {
      const { dir, meta } = this.loadProject(projectId);
      const paper = meta.papers.find((p) => p.id === paperId);
      if (!paper) throw new Error('论文不存在');
      const files = this.paperFiles(dir, paper);
      const store = readJson(files.chat, { version: 1, messages: [] });
      const history = Array.isArray(store.messages) ? store.messages : [];
      const quoteText = clampText(quote, 6000).trim();
      const pageNumber = Number(page) || 0;
      const userMessage = {
        id: `msg-${rand(5)}`,
        role: 'user',
        content: question,
        quote: quoteText,
        page: pageNumber || null,
        createdAt: now(),
      };
      const notes = readText(files.notes);
      const annotations = readJson(files.annotations, { version: 1, annotations: [] }).annotations || [];
      const paperText = readText(files.text);
      const context = withPageContext(paper, notes, annotations);
      const excerpt = relevantPaperText(paperText, question, pageNumber);
      const system = [
        '你是 DeepSeek，正在和用户一起精读论文。',
        '你的回答要基于下面给出的论文上下文和对话历史；不要编造论文没有写的内容。',
        '优先用中文，技术术语保留英文。回答要具体、可操作，必要时引用页码。',
        '如果用户要求解释某个段落、公式或实验，先说你的理解，再指出依据。',
        '可以使用 Markdown（列表、表格、代码、引用）。不要写空洞的总结。',
        '',
        '## 论文档案',
        context,
        '',
        '## 论文正文节选',
        excerpt || '（尚未提取到正文；请基于标题与笔记回答，并说明这一限制。）',
      ].join('\n');

      const llmMessages = [];
      for (const message of history.slice(-16)) {
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        const historicalText = message.role === 'user' && message.quote
          ? `${message.page ? `（第 ${message.page} 页选中）\n` : ''}> ${String(message.quote).replace(/\n/g, '\n> ')}\n\n${String(message.content || '')}`
          : String(message.content || '');
        const content = [{ type: 'text', text: historicalText.slice(0, 8000) }];
        if (message.role === 'user') {
          llmMessages.push(createUserMessage({ content, source: { kind: 'user' } }));
        } else {
          llmMessages.push(createAssistantMessage({
            content,
            source: { kind: 'model', provider: 'paper-desk', model: 'history' },
          }));
        }
      }
      const prompt = quoteText
        ? `${pageNumber ? `（我选中了第 ${pageNumber} 页）\n` : ''}> ${quoteText.replace(/\n/g, '\n> ')}\n\n${question}`
        : question;
      llmMessages.push(createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      }));
      const { answer } = await this.complete({ system, messages: llmMessages, maxTokens: 5000, temperature: 0.4 });
      const assistantMessage = {
        id: `msg-${rand(5)}`,
        role: 'assistant',
        content: answer,
        createdAt: now(),
      };
      store.version = 1;
      store.messages = [...history, userMessage, assistantMessage].slice(-120);
      writeJson(files.chat, store);
      return { messages: store.messages, answer, userMessage, assistantMessage };
    })().finally(() => this.chatJobs.delete(key));
    this.chatJobs.set(key, job);
    return job;
  }

  async clearChat(projectId, paperId) {
    const { dir, meta } = this.loadProject(projectId);
    const paper = meta.papers.find((p) => p.id === paperId);
    if (!paper) throw new Error('论文不存在');
    const files = this.paperFiles(dir, paper);
    writeJson(files.chat, { version: 1, messages: [] });
    return { ok: true };
  }

  async translate(projectId, paperId, text, page) {
    const source = clampText(text, 12_000).trim();
    if (!source) throw new Error('没有可翻译的内容');
    const { paper } = this.findPaper(this.loadProject(projectId).dir, paperId);
    const { answer } = await this.complete({
      system: [
        '你是 DeepSeek，擅长把 AI / 统计 / 机器学习论文中的英文段落翻译成准确、通顺的中文。',
        '保留专业术语的英文原文（可在括号中给出中文），不要总结，不要添加原文没有的内容。',
        '公式、变量名、引用编号保持原样。只输出译文。',
      ].join('\n'),
      messages: [createUserMessage({
        content: [{
          type: 'text',
          text: `来自论文《${paper.title}》${page ? `第 ${page} 页` : ''}：\n\n${source}`,
        }],
        source: { kind: 'user' },
      })],
      maxTokens: 3000,
      temperature: 0.2,
    });
    return { translation: answer };
  }
}

Object.defineProperty(PaperDeskService.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze(REMOTE_METHOD_NAMES.map((method) => Object.freeze({
      method,
      invocation: Object.freeze({ kind: 'direct' }),
    }))),
  }),
});

export default PaperDeskService;

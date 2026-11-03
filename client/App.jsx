import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  BookMarked,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  FolderOpen,
  Highlighter,
  Languages,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PdfViewer, COLORS } from './PdfViewer';
import { analyzePdfFile, metadataFacts } from './pdf';
import { renderMarkdown, plainText } from './markdown';
import {
  downloadEntireFile,
  formatBytes,
  formatRelative,
  getCachedPdf,
  paperMetaLine,
  pdfCacheKey,
  uploadBlob,
} from './api';

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function hueOf(value) {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

function ToastLayer({ toasts, onDismiss }) {
  return (
    <div className="pd-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`pd-toast pd-toast-${toast.type || 'info'}`}>
          <span className="pd-toast-icon">
            {toast.type === 'error' ? <CircleAlert size={15} /> : toast.type === 'success' ? <Check size={15} /> : <Sparkles size={15} />}
          </span>
          <span>{toast.message}</span>
          <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={() => onDismiss(toast.id)} aria-label="关闭"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function Modal({ title, children, onClose, width = 460 }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="pd-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="pd-modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="pd-modal-head">
          <h3>{title}</h3>
          <button type="button" className="pd-icon-btn" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PromptDialog({ title, label, defaultValue = '', placeholder, confirmLabel, onCancel, onConfirm }) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);
  useEffect(() => { const id = window.setTimeout(() => inputRef.current?.focus(), 30); return () => window.clearTimeout(id); }, []);
  const submit = () => {
    if (!value.trim()) return;
    onConfirm(value.trim());
  };
  return (
    <Modal title={title} onClose={onCancel} width={430}>
      <div className="pd-modal-body">
        <label className="pd-field">
          <span>{label}</span>
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          />
        </label>
      </div>
      <div className="pd-modal-actions">
        <button type="button" className="pd-btn pd-btn-ghost" onClick={onCancel}>取消</button>
        <button type="button" className="pd-btn pd-btn-primary" onClick={submit} disabled={!value.trim()}>{confirmLabel || '保存'}</button>
      </div>
    </Modal>
  );
}

function ConfirmDialog({ title, message, confirmLabel = '删除', onCancel, onConfirm }) {
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <div className="pd-modal-body">
        <p className="pd-muted pd-confirm-text">{message}</p>
      </div>
      <div className="pd-modal-actions">
        <button type="button" className="pd-btn pd-btn-ghost" onClick={onCancel}>取消</button>
        <button type="button" className="pd-btn pd-btn-danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="pd-segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}

function TagPill({ tag, active, onClick, onRemove }) {
  const hue = hueOf(tag);
  return (
    <span
      className={`pd-tag ${active ? 'is-active' : ''}`}
      style={{ '--pd-tag-hue': hue }}
    >
      <button type="button" onClick={onClick} className="pd-tag-label" title={tag}>{tag}</button>
      {onRemove && (
        <button type="button" className="pd-tag-remove" onClick={onRemove} aria-label={`移除标签 ${tag}`}><X size={10} /></button>
      )}
    </span>
  );
}

function EmptyState({ icon, title, description, action }) {
  return (
    <div className="pd-empty">
      <div className="pd-empty-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  );
}

function PendingImportRow({ item }) {
  return (
    <div className="pd-import-row">
      <div className="pd-import-icon"><FileText size={18} /></div>
      <div className="pd-import-main">
        <div className="pd-import-title">{item.name}</div>
        <div className="pd-import-stage">{item.stage}{item.progress ? ` · ${Math.round(item.progress)}%` : ''}</div>
        <div className="pd-import-bar"><span style={{ width: `${item.progress || 8}%` }} /></div>
      </div>
      <Loader2 size={16} className="pd-spin pd-muted" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// First-level project library
// ---------------------------------------------------------------------------

function ProjectCard({ project, onOpen, onRename, onDelete }) {
  const [menu, setMenu] = useState(false);
  const cardRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (event) => { if (!cardRef.current?.contains(event.target)) setMenu(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);
  const progress = project.paperCount ? Math.round((project.notesCount / project.paperCount) * 100) : 0;
  return (
    <article
      ref={cardRef}
      className="pd-project-card"
      style={{ '--pd-card-hue': hueOf(project.name) }}
      onClick={() => onOpen(project)}
    >
      <div className="pd-project-card-top">
        <div className="pd-project-glyph"><BookMarked size={20} /></div>
        <div className="pd-project-menu-wrap">
          <button
            type="button"
            className="pd-icon-btn pd-card-menu-btn"
            onClick={(event) => { event.stopPropagation(); setMenu((value) => !value); }}
            aria-label="项目操作"
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className="pd-menu" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => { setMenu(false); onRename(project); }}><Pencil size={14} />重命名</button>
              <button type="button" className="is-danger" onClick={() => { setMenu(false); onDelete(project); }}><Trash2 size={14} />删除项目</button>
            </div>
          )}
        </div>
      </div>
      <h3>{project.name}</h3>
      <div className="pd-project-folder"><FolderOpen size={12} />{project.folder}</div>
      <div className="pd-project-tags">
        {project.tags.slice(0, 4).map((tag) => <TagPill key={tag.name} tag={tag.name} />)}
        {project.tags.length > 4 && <span className="pd-tag-more">+{project.tags.length - 4}</span>}
        {project.tags.length === 0 && <span className="pd-project-no-tags">还没有标签</span>}
      </div>
      <div className="pd-project-footer">
        <div className="pd-project-stats">
          <span><FileText size={13} />{project.paperCount} 篇</span>
          <span><NotebookPen size={13} />{project.notesCount} 精读</span>
        </div>
        <span className="pd-project-time">{formatRelative(project.updatedAt)}</span>
      </div>
      <div className="pd-project-progress" title={`${progress}% 已完成 AI 精读`}><span style={{ width: `${progress}%` }} /></div>
    </article>
  );
}

function ProjectsPage({ api, notify, onOpenProject }) {
  const [projects, setProjects] = useState([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null);
  const mounted = useMounted();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listProjects();
      if (!mounted.current) return;
      setProjects(data.projects);
      setRoot(data.root);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [api, mounted]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => `${project.name} ${project.tags.map((tag) => tag.name).join(' ')}`.toLowerCase().includes(needle));
  }, [projects, query]);

  const create = async (name) => {
    try {
      const project = await api.createProject(name);
      setDialog(null);
      notify('项目已创建', 'success');
      await load();
      onOpenProject(project.id);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const rename = async (name) => {
    try {
      await api.renameProject(dialog.project.id, name);
      setDialog(null);
      notify('项目已重命名', 'success');
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const remove = async () => {
    try {
      await api.deleteProject(dialog.project.id);
      setDialog(null);
      notify('项目已移到 .trash', 'success');
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  return (
    <div className="pd-page pd-projects-page">
      <header className="pd-hero">
        <div className="pd-hero-copy">
          <div className="pd-eyebrow"><span className="pd-eyebrow-dot" />PAPER DESK</div>
          <h1>把论文读成自己的东西</h1>
          <p>为每个研究问题建一个项目，和 DeepSeek 一起划线、追问、翻译，最后沉淀成一篇能反复回看的笔记。</p>
        </div>
        <button type="button" className="pd-btn pd-btn-primary pd-btn-lg" onClick={() => setDialog({ type: 'create' })}>
          <Plus size={16} />新建项目
        </button>
      </header>

      <div className="pd-library-toolbar">
        <div className="pd-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或标签…" />
          {query && <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={() => setQuery('')}><X size={13} /></button>}
        </div>
        <div className="pd-library-meta">
          {loading ? '正在读取…' : `${filtered.length} 个项目`}
          {root && <span className="pd-root-path" title={root}>{root}</span>}
        </div>
      </div>

      {error && (
        <div className="pd-inline-error">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" className="pd-text-btn" onClick={load}>重试</button>
        </div>
      )}

      {loading && (
        <div className="pd-project-grid">
          {[1, 2, 3].map((item) => <div key={item} className="pd-project-card pd-skeleton-card"><div className="pd-skeleton" style={{ width: '42%', height: 16 }} /><div className="pd-skeleton" style={{ width: '78%', height: 26, marginTop: 18 }} /><div className="pd-skeleton" style={{ width: '100%', height: 12, marginTop: 26 }} /></div>)}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<BookMarked size={28} />}
          title={query ? '没有匹配的项目' : '从一个项目开始'}
          description={query ? '换一个关键词，或者清空搜索。' : '例如 “scaling inference for SBI”。项目会拥有独立的论文库、标签和笔记。'}
          action={!query && (
            <button type="button" className="pd-btn pd-btn-primary" onClick={() => setDialog({ type: 'create' })}><Plus size={15} />创建第一个项目</button>
          )}
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="pd-project-grid">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={(item) => onOpenProject(item.id)}
              onRename={(item) => setDialog({ type: 'rename', project: item })}
              onDelete={(item) => setDialog({ type: 'delete', project: item })}
            />
          ))}
        </div>
      )}

      {dialog?.type === 'create' && (
        <PromptDialog
          title="新建论文项目"
          label="项目名称"
          placeholder="scaling inference for SBI"
          confirmLabel="创建项目"
          onCancel={() => setDialog(null)}
          onConfirm={create}
        />
      )}
      {dialog?.type === 'rename' && (
        <PromptDialog
          title="重命名项目"
          label="项目名称"
          defaultValue={dialog.project.name}
          confirmLabel="保存"
          onCancel={() => setDialog(null)}
          onConfirm={rename}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="删除项目"
          message={`“${dialog.project.name}” 会连同论文、标注、笔记和对话一起移到插件目录下的 .trash，不会立即永久删除。`}
          onCancel={() => setDialog(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project page: Zotero-shaped paper library
// ---------------------------------------------------------------------------

function AttachmentChip({ attachment, onOpen, onDelete }) {
  return (
    <span className="pd-file-chip pd-attachment-chip">
      <button type="button" className="pd-file-main" onClick={() => onOpen(attachment)}>
        <Paperclip size={13} />
        <span>{attachment.name}</span>
        <small>{formatBytes(attachment.bytes)}</small>
      </button>
      <button type="button" className="pd-file-remove" onClick={() => onDelete(attachment)} title="移除附件" aria-label={`移除 ${attachment.name}`}><X size={11} /></button>
    </span>
  );
}

function PaperCard({
  paper,
  expanded,
  onToggle,
  onOpenReader,
  onEdit,
  onDelete,
  onTagsChange,
  onDropFiles,
  onOpenAttachment,
  onDeleteAttachment,
  onAddAttachment,
  onTagClick,
  allTags,
  busy,
}) {
  const [tagOpen, setTagOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const dropDepth = useRef(0);
  const addTag = () => {
    const value = tagDraft.trim().replace(/[,，]/g, '');
    if (!value) return;
    if (!paper.tags.includes(value)) onTagsChange([...paper.tags, value]);
    setTagDraft('');
  };
  const suggestions = allTags.filter((tag) => !paper.tags.includes(tag)).slice(0, 6);
  return (
    <article
      className={`pd-paper-card ${expanded ? 'is-expanded' : ''} ${dropActive ? 'is-drop' : ''}`}
      onDoubleClick={(event) => {
        // The paper card is a reading target; buttons, form controls and the
        // tag editor keep their own single-click/double-click behaviour.
        if (event.target.closest('button, a, input, textarea, select, label, [contenteditable="true"], .pd-tag-editor, .pd-menu')) return;
        onOpenReader('chat');
      }}
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
        event.preventDefault();
        dropDepth.current += 1;
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragLeave={() => {
        dropDepth.current = Math.max(0, dropDepth.current - 1);
        if (dropDepth.current === 0) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dropDepth.current = 0;
        setDropActive(false);
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length) onDropFiles(files);
      }}
    >
      {dropActive && <div className="pd-paper-drop-hint"><Paperclip size={18} />松手添加到这篇论文</div>}
      <div className="pd-paper-row">
        <button type="button" className="pd-paper-expand" onClick={onToggle} aria-label={expanded ? '收起相关文件' : '展开相关文件'}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="pd-paper-glyph" style={{ '--pd-paper-hue': hueOf(paper.title) }}>
          <FileText size={18} />
        </div>
        <div className="pd-paper-main">
          <button type="button" className="pd-paper-title" onClick={() => onOpenReader('chat')}>{paper.title}</button>
          <div className="pd-paper-meta">
            <span>{paperMetaLine(paper) || '等待补充作者与年份'}</span>
            {paper.hasText && <span className="pd-dot-sep">·</span>}
            {paper.hasText && <span>{Math.round(paper.textChars / 1000)}k 字符</span>}
            {paper.attachments.length > 0 && <><span className="pd-dot-sep">·</span><span>{paper.attachments.length} 个附件</span></>}
          </div>
          <div className="pd-paper-tags">
            {paper.tags.map((tag) => (
              <TagPill key={tag} tag={tag} onClick={() => onTagClick(tag)} onRemove={() => onTagsChange(paper.tags.filter((value) => value !== tag))} />
            ))}
            <button type="button" className={`pd-add-tag ${tagOpen ? 'is-open' : ''}`} onClick={() => setTagOpen((value) => !value)}>
              <Tag size={11} />{paper.tags.length ? '' : '添加标签'}
            </button>
          </div>
          {tagOpen && (
            <div className="pd-tag-editor">
              <div className="pd-tag-input-row">
                <input
                  autoFocus
                  value={tagDraft}
                  placeholder="输入标签，回车添加"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); addTag(); }
                    if (event.key === 'Escape') setTagOpen(false);
                  }}
                />
                <button type="button" className="pd-btn pd-btn-ghost pd-btn-sm" onClick={addTag}>添加</button>
              </div>
              {suggestions.length > 0 && (
                <div className="pd-tag-suggestions">
                  <span>常用</span>
                  {suggestions.map((tag) => <button key={tag} type="button" onClick={() => onTagsChange([...paper.tags, tag])}>{tag}</button>)}
                </div>
              )}
            </div>
          )}
          {expanded && paper.notesPreview && (
            <p className="pd-paper-preview">{paper.notesPreview}</p>
          )}
        </div>
        <div className="pd-paper-side">
          <div className="pd-paper-badges">
            {busy === 'notes' ? (
              <span className="pd-badge pd-badge-ai"><Loader2 size={11} className="pd-spin" />AI 精读中</span>
            ) : paper.notesGeneratedAt ? (
              <span className="pd-badge pd-badge-ai"><Sparkles size={11} />AI 精读</span>
            ) : paper.hasNotes ? (
              <span className="pd-badge"><NotebookPen size={11} />有笔记</span>
            ) : (
              <span className="pd-badge pd-badge-muted">待精读</span>
            )}
            <span className="pd-paper-updated">{formatRelative(paper.updatedAt)}</span>
          </div>
          <div className="pd-paper-actions">
            <button type="button" className="pd-btn pd-btn-ghost pd-btn-sm" onClick={() => onOpenReader('chat')}><BookOpen size={14} />阅读</button>
            <button type="button" className="pd-btn pd-btn-ghost pd-btn-sm" onClick={() => onOpenReader('notes')}><NotebookPen size={14} />笔记</button>
            <button type="button" className="pd-icon-btn" onClick={onEdit} title="编辑论文信息"><Pencil size={14} /></button>
            <button type="button" className="pd-icon-btn pd-icon-btn-danger" onClick={onDelete} title="移除论文"><Trash2 size={14} /></button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="pd-paper-files">
          <div className="pd-files-row">
            <span className="pd-file-chip pd-file-primary">
              <button type="button" className="pd-file-main" onClick={() => onOpenReader('chat')}>
                <FileText size={13} /><span>paper.pdf</span><small>{formatBytes(paper.pdfBytes)}</small>
              </button>
            </span>
            <span className="pd-file-chip">
              <button type="button" className="pd-file-main" onClick={() => onOpenReader('notes')}>
                <NotebookPen size={13} /><span>notes.md</span><small>Markdown</small>
              </button>
            </span>
            {paper.attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onOpen={(item) => onOpenAttachment(paper, item)}
                onDelete={(item) => onDeleteAttachment(paper, item)}
              />
            ))}
            <button type="button" className="pd-add-file-btn" onClick={() => onAddAttachment(paper)}><Plus size={12} />附件</button>
            <span className="pd-file-drop-note"><Paperclip size={12} />把 appendix / 补充材料拖到这里</span>
          </div>
          <div className="pd-paper-focus-row">
            <button type="button" className="pd-text-btn" onClick={() => onOpenReader('chat')}><MessageSquare size={13} />和 DeepSeek 共读</button>
            <button type="button" className="pd-text-btn" onClick={() => onOpenReader('annotations')}><Highlighter size={13} />查看标注</button>
            <button type="button" className="pd-text-btn" onClick={() => onOpenReader('notes')}><ArrowUpRight size={13} />打开精读笔记</button>
          </div>
        </div>
      )}
    </article>
  );
}

function PaperEditDialog({ paper, onCancel, onSave }) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState((paper.authors || []).join(', '));
  const [year, setYear] = useState(paper.year || '');
  const [venue, setVenue] = useState(paper.venue || '');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        title,
        authors: authors.split(/[,，;]/).map((value) => value.trim()).filter(Boolean),
        year,
        venue,
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="论文信息" onClose={onCancel} width={520}>
      <div className="pd-modal-body pd-form">
        <label className="pd-field"><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="pd-form-grid">
          <label className="pd-field"><span>作者（逗号分隔）</span><input value={authors} onChange={(event) => setAuthors(event.target.value)} placeholder="A. Smith, B. Lee" /></label>
          <label className="pd-field pd-field-narrow"><span>年份</span><input value={year} onChange={(event) => setYear(event.target.value)} placeholder="2024" /></label>
        </div>
        <label className="pd-field"><span>发表 venue</span><input value={venue} onChange={(event) => setVenue(event.target.value)} placeholder="NeurIPS / arXiv" /></label>
        <p className="pd-hint">保存后，论文文件夹会自动按 “作者 - 年份 - 标题” 的 Zotero 风格重命名。</p>
      </div>
      <div className="pd-modal-actions">
        <button type="button" className="pd-btn pd-btn-ghost" onClick={onCancel}>取消</button>
        <button type="button" className="pd-btn pd-btn-primary" onClick={submit} disabled={saving || !title.trim()}>{saving ? <Loader2 size={14} className="pd-spin" /> : <Check size={14} />}保存</button>
      </div>
    </Modal>
  );
}

function ProjectPage({ api, projectId, notify, onBack, onOpenReader }) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [editingPaper, setEditingPaper] = useState(null);
  const [deletePaper, setDeletePaper] = useState(null);
  const [pending, setPending] = useState({});
  const [busyNotes, setBusyNotes] = useState({});
  const [dragActive, setDragActive] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState(null);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);
  const mounted = useMounted();

  useEffect(() => {
    const reset = () => { dragDepth.current = 0; setDragActive(false); };
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const detail = await api.getProject(projectId);
      if (!mounted.current) return;
      setProject(detail);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current && !quiet) setLoading(false);
    }
  }, [api, projectId, mounted]);

  useEffect(() => { void load(false); }, [load]);

  const papers = project?.papers || [];
  const allTags = useMemo(() => {
    const map = new Map();
    for (const paper of papers) for (const tag of paper.tags) map.set(tag, (map.get(tag) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [papers]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return papers.filter((paper) => {
      if (activeTags.length && !activeTags.every((tag) => paper.tags.includes(tag))) return false;
      if (!needle) return true;
      return `${paper.title} ${(paper.authors || []).join(' ')} ${paper.year} ${paper.tags.join(' ')} ${paper.notesPreview}`.toLowerCase().includes(needle);
    });
  }, [papers, query, activeTags]);

  const toggleTag = (tag) => setActiveTags((previous) => previous.includes(tag) ? previous.filter((value) => value !== tag) : [...previous, tag]);

  const updatePaperInState = (paper) => {
    setProject((previous) => previous ? { ...previous, papers: previous.papers.map((item) => item.id === paper.id ? paper : item) } : previous);
  };

  const addFilesAsPapers = async (files) => {
    const pdfs = files.filter((file) => /\.pdf$/i.test(file.name));
    const rejected = files.filter((file) => !/\.pdf$/i.test(file.name));
    if (rejected.length) notify('项目页只导入 PDF；辅助文件请拖到某篇论文的附件区域。', 'info');
    for (const file of pdfs) {
      const key = `imp-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      setPending((previous) => ({ ...previous, [key]: { name: file.name, stage: '上传中', progress: 2 } }));
      try {
        const { finished } = await uploadBlob(api, file, {
          mode: 'paper',
          projectId,
          onProgress: (received, total) => setPending((previous) => ({
            ...previous,
            [key]: { ...previous[key], stage: '上传 PDF', progress: Math.max(2, Math.round((received / total) * 55)) },
          })),
        });
        const paper = finished.paper;
        setPending((previous) => ({ ...previous, [key]: { name: file.name, stage: '解析标题与正文', progress: 64 } }));
        let analysis = null;
        try {
          analysis = await analyzePdfFile(file);
        } catch (reason) {
          notify('PDF 已导入，但文本解析失败；仍然可以阅读和手动记笔记。', 'error');
        }
        if (analysis) {
          setPending((previous) => ({ ...previous, [key]: { name: file.name, stage: '整理论文信息', progress: 76 } }));
          await api.updatePaper(projectId, paper.id, {
            title: analysis.title,
            authors: analysis.authors,
            year: analysis.year,
            venue: analysis.venue,
            parsedAt: true,
          });
          await api.savePaperText(projectId, paper.id, analysis.text);
        }
        setPending((previous) => { const next = { ...previous }; delete next[key]; return next; });
        await load(true);
        notify(`已加入《${analysis?.title || paper.title}》`, 'success');
        if (analysis) {
          void startNotes(paper.id);
        }
      } catch (reason) {
        setPending((previous) => { const next = { ...previous }; delete next[key]; return next; });
        notify(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    }
  };

  const startNotes = async (paperId) => {
    setBusyNotes((previous) => ({ ...previous, [paperId]: 'notes' }));
    try {
      const result = await api.generateNotes(projectId, paperId, false);
      if (result?.paper) updatePaperInState(result.paper);
      notify('DeepSeek 精读笔记已生成', 'success');
    } catch (reason) {
      notify(`AI 精读失败：${reason instanceof Error ? reason.message : String(reason)}`, 'error');
    } finally {
      if (mounted.current) setBusyNotes((previous) => { const next = { ...previous }; delete next[paperId]; return next; });
    }
  };

  const addAttachments = async (paper, files) => {
    for (const file of files) {
      const key = `att-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      setPending((previous) => ({ ...previous, [key]: { name: `${paper.title} · ${file.name}`, stage: '上传附件', progress: 4 } }));
      try {
        await uploadBlob(api, file, {
          mode: 'attachment',
          projectId,
          paperId: paper.id,
          onProgress: (received, total) => setPending((previous) => ({
            ...previous,
            [key]: { ...previous[key], progress: Math.max(4, Math.round((received / total) * 90)) },
          })),
        });
        setPending((previous) => { const next = { ...previous }; delete next[key]; return next; });
        notify(`已添加附件 ${file.name}`, 'success');
        await load(true);
      } catch (reason) {
        setPending((previous) => { const next = { ...previous }; delete next[key]; return next; });
        notify(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    void addFilesAsPapers(files);
  };

  const openAttachment = async (paper, attachment) => {
    try {
      notify(`正在打开 ${attachment.name}…`, 'info');
      const bytes = await downloadEntireFile(api, projectId, paper.id, `attachment:${attachment.id}`);
      const blob = new Blob([bytes], { type: attachment.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const removeAttachment = async (paper, attachment) => {
    if (!window.confirm(`移除附件 “${attachment.name}”？`)) return;
    try {
      const updated = await api.deleteAttachment(projectId, paper.id, attachment.id);
      updatePaperInState(updated);
      notify('附件已移除', 'success');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const updateTags = async (paper, tags) => {
    try {
      const updated = await api.updatePaper(projectId, paper.id, { tags });
      updatePaperInState(updated);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const savePaperEdit = async (patch) => {
    if (!editingPaper) return;
    try {
      const updated = await api.updatePaper(projectId, editingPaper.id, patch);
      updatePaperInState(updated);
      setEditingPaper(null);
      notify('论文信息已更新', 'success');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const removePaper = async () => {
    if (!deletePaper) return;
    try {
      await api.deletePaper(projectId, deletePaper.id);
      setDeletePaper(null);
      notify('论文已移到 .trash', 'success');
      await load(true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const openFilePicker = (target) => {
    setAttachmentTarget(target);
    if (fileInput.current) {
      fileInput.current.value = '';
      fileInput.current.click();
    }
  };

  return (
    <div
      className="pd-page pd-project-page"
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); }}
      onDragLeave={(event) => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="pd-drop-overlay">
          <div className="pd-drop-card">
            <Upload size={26} />
            <strong>松手导入 PDF</strong>
            <span>会在项目中自动创建论文栏目，并从 PDF 中整理标题、作者和文本。</span>
          </div>
        </div>
      )}
      <header className="pd-project-header">
        <button type="button" className="pd-back" onClick={onBack}><ArrowLeft size={15} />所有项目</button>
        <div className="pd-project-title-row">
          <div>
            <div className="pd-eyebrow"><span className="pd-eyebrow-dot" />PROJECT</div>
            <h1>{project?.name || '载入项目中…'}</h1>
            <div className="pd-project-subline">
              {project && (
                <>
                  <span><FileText size={13} />{project.paperCount} 篇论文</span>
                  <span><Sparkles size={13} />{project.notesCount} 篇 AI 精读</span>
                  <span><Tag size={13} />{project.tags.length} 个标签</span>
                  <span className="pd-root-path"><FolderOpen size={12} />{project.folder}</span>
                </>
              )}
            </div>
          </div>
          <div className="pd-project-header-actions">
            <button type="button" className="pd-btn pd-btn-secondary" onClick={() => openFilePicker({ kind: 'paper' })} disabled={!project}>
              <Upload size={15} />导入 PDF
            </button>
            <button type="button" className="pd-btn pd-btn-primary" onClick={() => openFilePicker({ kind: 'paper' })} disabled={!project}>
              <Plus size={15} />添加论文
            </button>
          </div>
        </div>
      </header>

      <div className="pd-project-controls">
        <div className="pd-search pd-search-sm">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、标签…" />
          {query && <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={() => setQuery('')}><X size={12} /></button>}
        </div>
        <div className="pd-filter-tags">
          <button type="button" className={`pd-filter-all ${activeTags.length === 0 ? 'is-active' : ''}`} onClick={() => setActiveTags([])}>全部</button>
          {allTags.slice(0, 12).map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              className={`pd-filter-tag ${activeTags.includes(tag) ? 'is-active' : ''}`}
              style={{ '--pd-tag-hue': hueOf(tag) }}
              onClick={() => toggleTag(tag)}
            >
              {tag}<span>{count}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="pd-inline-error"><CircleAlert size={16} /><span>{error}</span><button type="button" className="pd-text-btn" onClick={() => load()}>重试</button></div>}

      <div className="pd-paper-list">
        {loading && [1, 2, 3].map((item) => <div key={item} className="pd-paper-card pd-skeleton-paper"><div className="pd-skeleton" style={{ width: 54, height: 42, borderRadius: 10 }} /><div style={{ flex: 1 }}><div className="pd-skeleton" style={{ width: '55%', height: 18 }} /><div className="pd-skeleton" style={{ width: '32%', height: 12, marginTop: 12 }} /></div></div>)}
        {Object.entries(pending).map(([key, item]) => <PendingImportRow key={key} item={item} />)}
        {!loading && !error && filtered.length === 0 && papers.length === 0 && (
          <EmptyState
            icon={<FileText size={28} />}
            title="把第一篇论文拖进来"
            description="PDF 会被自动解析标题和正文，并在插件目录下创建 Zotero 风格的论文文件夹。"
            action={<button type="button" className="pd-btn pd-btn-primary" onClick={() => openFilePicker({ kind: 'paper' })}><Upload size={15} />选择 PDF</button>}
          />
        )}
        {!loading && !error && filtered.length === 0 && papers.length > 0 && (
          <EmptyState icon={<Search size={28} />} title="没有匹配的论文" description="调整搜索词或取消标签筛选。" />
        )}
        {filtered.map((paper) => (
          <PaperCard
            key={paper.id}
            paper={paper}
            expanded={expanded.has(paper.id)}
            onToggle={() => setExpanded((previous) => {
              const next = new Set(previous);
              if (next.has(paper.id)) next.delete(paper.id); else next.add(paper.id);
              return next;
            })}
            onOpenReader={(tab) => onOpenReader(paper.id, tab)}
            onEdit={() => setEditingPaper(paper)}
            onDelete={() => setDeletePaper(paper)}
            onTagsChange={(tags) => updateTags(paper, tags)}
            onDropFiles={(files) => { dragDepth.current = 0; setDragActive(false); void addAttachments(paper, files); }}
            onOpenAttachment={openAttachment}
            onDeleteAttachment={removeAttachment}
            onAddAttachment={(item) => openFilePicker({ kind: 'attachment', paper: item })}
            onTagClick={toggleTag}
            allTags={project?.tags?.map((tag) => tag.name) || []}
            busy={busyNotes[paper.id]}
          />
        ))}
      </div>

      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept={attachmentTarget?.kind === 'paper' ? 'application/pdf,.pdf' : undefined}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (!files.length) return;
          if (attachmentTarget?.kind === 'attachment') void addAttachments(attachmentTarget.paper, files);
          else void addFilesAsPapers(files);
          if (fileInput.current) fileInput.current.value = '';
        }}
      />

      {editingPaper && <PaperEditDialog paper={editingPaper} onCancel={() => setEditingPaper(null)} onSave={savePaperEdit} />}
      {deletePaper && (
        <ConfirmDialog
          title="移除论文"
          message={`“${deletePaper.title}” 会连同 PDF、标注、笔记和对话一起移到 .trash。`}
          onCancel={() => setDeletePaper(null)}
          onConfirm={removePaper}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reader — PDF on the left, DeepSeek / notes on the right
// ---------------------------------------------------------------------------

const NOTE_STAGE_COPY = {
  reading: '正在读取论文与你的标注',
  preparing: '正在整理论文上下文',
  thinking: 'DeepSeek 正在精读并梳理结构',
  writing: '正在写精读笔记',
  saving: '正在整理成 Markdown',
  done: '精读笔记已生成',
  error: '精读生成失败',
  idle: '准备中',
};

function NoteProgressCard({ progress, pdfReady }) {
  const stage = progress?.stage || 'reading';
  const chars = Number(progress?.chars) || 0;
  const done = progress?.done;
  const failed = stage === 'error';
  const elapsed = Math.max(0, Math.round((progress?.elapsedMs || (progress?.startedAt ? Date.now() - progress.startedAt : 0)) / 1000));
  let percent = 8;
  if (stage === 'preparing') percent = 13;
  else if (stage === 'thinking') percent = 22;
  else if (stage === 'writing') percent = Math.min(92, 24 + (chars / 6500) * 68);
  else if (stage === 'saving') percent = 94;
  else if (done) percent = 100;
  const label = stage === 'writing' && chars > 0
    ? `${NOTE_STAGE_COPY.writing} · 已生成 ${chars.toLocaleString()} 字`
    : NOTE_STAGE_COPY[stage] || NOTE_STAGE_COPY.reading;
  return (
    <div className={`pd-note-progress ${failed ? 'is-error' : ''}`} role="status" aria-live="polite">
      <div className="pd-note-progress-head">
        <span className="pd-note-progress-icon">{failed ? <CircleAlert size={14} /> : <Sparkles size={14} />}</span>
        <strong>{failed ? 'AI 精读没有完成' : 'DeepSeek 正在生成 TL;DR'}</strong>
        <span className="pd-note-progress-time">{elapsed}s</span>
      </div>
      {failed ? (
        <div className="pd-note-progress-sub">{progress?.error || '稍后可以在笔记里点击“AI 重写”再试一次。'}</div>
      ) : (
        <>
          <div className="pd-note-progress-row">
            <span className="pd-note-progress-stage">{label}</span>
            <span className="pd-note-progress-percent">{Math.round(percent)}%</span>
          </div>
          <div className="pd-note-progress-bar"><span style={{ width: `${Math.max(6, percent)}%` }} /></div>
          <div className="pd-note-progress-sub">{pdfReady ? 'PDF 已可正常阅读' : 'PDF 正在并行加载'}；完成后会自动更新笔记，这个提示会消失。</div>
        </>
      )}
    </div>
  );
}

function ChatMessage({ message }) {
  if (message.role === 'user') {
    return (
      <div className="pd-chat-message pd-chat-user">
        <div className="pd-chat-bubble">
          {message.quote && (
            <div className="pd-chat-quote">
              <span>p.{message.page || '?'}</span>
              <p>{message.quote}</p>
            </div>
          )}
          <div className="pd-chat-user-text">{message.content}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="pd-chat-message pd-chat-assistant">
      <div className="pd-chat-avatar"><Sparkles size={13} /></div>
      <div className="pd-chat-assistant-body">
        <div className="pd-chat-markdown pd-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      </div>
    </div>
  );
}

function ChatPane({ chat, quote, onClearQuote, onSend, onClear, paper }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [optimistic, setOptimistic] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (quote) {
      setError('');
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [quote]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat, optimistic]);

  const send = async (preset) => {
    const text = String(preset ?? input).trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    const currentQuote = quote;
    setOptimistic({
      user: { id: 'optimistic-user', role: 'user', content: text, quote: currentQuote?.text || '', page: currentQuote?.page || null, createdAt: new Date().toISOString() },
    });
    try {
      const result = await onSend(text, currentQuote);
      setInput('');
      onClearQuote();
      setOptimistic(null);
    } catch (reason) {
      setOptimistic(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };

  const messages = optimistic ? [...chat, optimistic.user] : chat;
  return (
    <div className="pd-chatpane">
      <div className="pd-pane-head">
        <div>
          <div className="pd-pane-title"><Sparkles size={14} />和 DeepSeek 共读</div>
          <div className="pd-pane-subtitle">基于论文正文、你的标注与笔记回答</div>
        </div>
        {chat.length > 0 && (
          <button type="button" className="pd-text-btn pd-muted" onClick={() => { if (window.confirm('清空这篇论文的对话？')) onClear(); }}>清空</button>
        )}
      </div>
      <div className="pd-chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="pd-chat-empty">
            <div className="pd-chat-empty-mark"><Sparkles size={22} /></div>
            <strong>从哪一页开始？</strong>
            <p>你可以直接问，也可以在 PDF 里选中一段话，点“问 AI”。我会带着页码和上下文一起回答。</p>
            <div className="pd-suggestion-list">
              {[
                '用三句话讲清这篇论文的核心贡献',
                '这篇论文的 key idea 是什么？',
                '实验是否真的支撑了它的结论？',
                '有哪些值得我继续追问的问题？',
              ].map((suggestion) => (
                <button key={suggestion} type="button" className="pd-suggestion" onClick={() => void send(suggestion)}>
                  <MessageSquare size={13} />{suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
        {sending && (
          <div className="pd-chat-message pd-chat-assistant">
            <div className="pd-chat-avatar"><Sparkles size={13} /></div>
            <div className="pd-typing"><span /><span /><span /></div>
          </div>
        )}
        {error && <div className="pd-chat-error"><CircleAlert size={14} />{error}</div>}
      </div>
      <div className="pd-composer-wrap">
        {quote && (
          <div className="pd-composer-quote">
            <div><span>第 {quote.page} 页选中</span><p>{quote.text}</p></div>
            <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={onClearQuote} aria-label="移除引用"><X size={13} /></button>
          </div>
        )}
        <div className="pd-composer">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={`问关于《${paper.title}》的任何问题…`}
            rows={1}
          />
          <button type="button" className="pd-send-btn" onClick={() => void send()} disabled={sending || !input.trim()} aria-label="发送">
            {sending ? <Loader2 size={16} className="pd-spin" /> : <Send size={15} />}
          </button>
        </div>
        <div className="pd-composer-hint">Enter 发送 · Shift+Enter 换行 · 回答只基于这篇论文</div>
      </div>
    </div>
  );
}

function NotesPane({ notes, paper, generating, error, onSave, onRegenerate }) {
  const [mode, setMode] = useState('preview');
  const [draft, setDraft] = useState(notes);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('saved');
  const timer = useRef(null);
  const latest = useRef({ draft, dirty, notes });
  latest.current = { draft, dirty, notes };
  const previousNotes = useRef(notes);
  const mounted = useMounted();

  useEffect(() => {
    if (!dirty && notes !== previousNotes.current) {
      setDraft(notes);
      setStatus('saved');
    }
    previousNotes.current = notes;
  }, [notes, dirty]);

  const save = useCallback(async () => {
    if (!dirty) return;
    setStatus('saving');
    try {
      await onSave(latest.current.draft);
      if (!mounted.current) return;
      setDirty(false);
      setStatus('saved');
    } catch (reason) {
      if (mounted.current) setStatus('error');
    }
  }, [dirty, onSave, mounted]);

  useEffect(() => {
    if (!dirty) return undefined;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void save(); }, 900);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [draft, dirty, save]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const wordCount = useMemo(() => (draft.match(/[\u4e00-\u9fa5]|[A-Za-z0-9]+/g) || []).length, [draft]);

  return (
    <div className="pd-notespane">
      <div className="pd-pane-head pd-notes-head">
        <div>
          <div className="pd-pane-title"><NotebookPen size={14} />精读笔记</div>
          <div className="pd-pane-subtitle">{paper?.title}</div>
        </div>
        <div className="pd-notes-head-actions">
          <button type="button" className="pd-text-btn" disabled={generating} onClick={() => { if (window.confirm('让 DeepSeek 重写整篇笔记？当前 Markdown 会被覆盖。')) onRegenerate(); }}>
            <Sparkles size={13} />AI 重写
          </button>
        </div>
      </div>
      <div className="pd-notes-toolbar">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[{ value: 'preview', label: '阅读', icon: <BookOpen size={13} /> }, { value: 'edit', label: '编辑', icon: <Pencil size={13} /> }]}
        />
        <div className="pd-notes-status">
          {generating ? <span className="pd-notes-generating"><Loader2 size={12} className="pd-spin" />DeepSeek 正在精读…</span> : status === 'saving' ? '保存中…' : status === 'error' ? <span className="pd-text-danger">保存失败</span> : dirty ? '未保存' : '已保存'}
          <span className="pd-notes-words">{wordCount} 字</span>
        </div>
      </div>
      {error && <div className="pd-note-error"><CircleAlert size={14} />{error}</div>}
      {mode === 'preview' ? (
        <div className="pd-notes-scroll">
          {draft.trim() ? (
            <div className="pd-note-doc pd-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }} />
          ) : (
            <EmptyState icon={<NotebookPen size={28} />} title="还没有笔记" description="让 DeepSeek 生成第一版精读，再一起补充你的判断。" action={<button type="button" className="pd-btn pd-btn-primary pd-btn-sm" onClick={onRegenerate}><Sparkles size={14} />AI 精读</button>} />
          )}
        </div>
      ) : (
        <div className="pd-notes-editor-wrap">
          <textarea
            className="pd-notes-editor"
            value={draft}
            disabled={generating}
            onChange={(event) => { setDraft(event.target.value); setDirty(true); setStatus('idle'); }}
            onBlur={() => { void save(); }}
            spellCheck={false}
            placeholder="# 我的精读笔记…"
          />
          <div className="pd-editor-footer"><span>Markdown · 自动保存</span><button type="button" className="pd-btn pd-btn-primary pd-btn-sm" onClick={() => void save()}>保存</button></div>
        </div>
      )}
    </div>
  );
}

function AnnotationCard({ annotation, focus, onUpdate, onDelete, onGoTo, onAsk, onTranslate }) {
  const [note, setNote] = useState(annotation.note || '');
  const [translation, setTranslation] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const cardRef = useRef(null);
  const latest = useRef({ note, annotation });
  latest.current = { note, annotation };


  useEffect(() => {
    if (!focus) return;
    const node = cardRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('is-focus');
    const timerId = window.setTimeout(() => node.classList.remove('is-focus'), 1600);
    return () => window.clearTimeout(timerId);
  }, [focus]);

  useEffect(() => {
    if (!annotation.focusNote) return;
    const area = cardRef.current?.querySelector('textarea');
    if (area) window.setTimeout(() => area.focus(), 120);
  }, [annotation.focusNote]);

  const commit = (patch = {}) => {
    if (timer.current) window.clearTimeout(timer.current);
    onUpdate({ ...annotation, note, ...patch });
  };

  const changeNote = (value) => {
    setNote(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onUpdate({ ...latest.current.annotation, note: latest.current.note });
    }, 650);
  };

  const translate = async () => {
    setTranslating(true);
    setError('');
    try {
      const value = await onTranslate(annotation.text, annotation.page);
      setTranslation(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTranslating(false);
    }
  };

  return (
    <article ref={cardRef} className={`pd-annotation-card pd-annotation-${annotation.color}`}>
      <div className="pd-annotation-head">
        <button type="button" className="pd-page-jump" onClick={() => onGoTo(annotation.page)}>p.{annotation.page}</button>
        <div className="pd-color-row">
          {COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              className={`pd-color-dot pd-color-dot-sm ${annotation.color === color.id ? 'is-active' : ''}`}
              style={{ background: color.css }}
              onClick={() => commit({ color: color.id })}
              aria-label={color.label}
            />
          ))}
        </div>
        <div className="pd-annotation-actions">
          <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={() => onAsk(annotation)} title="问 AI"><MessageSquare size={13} /></button>
          <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={translate} title="翻译"><Languages size={13} /></button>
          <button type="button" className="pd-icon-btn pd-icon-btn-sm pd-icon-btn-danger" onClick={() => onDelete(annotation)} title="删除标注"><Trash2 size={13} /></button>
        </div>
      </div>
      <blockquote className="pd-annotation-quote">{annotation.text}</blockquote>
      <textarea
        className="pd-annotation-note"
        value={note}
        placeholder="写一点理解、疑问，或者和作者的对话…"
        onChange={(event) => changeNote(event.target.value)}
        onBlur={() => commit()}
        rows={note ? 3 : 2}
      />
      {translating && <div className="pd-annotation-translation"><Loader2 size={13} className="pd-spin" />翻译中…</div>}
      {translation && <div className="pd-annotation-translation"><Languages size={13} /><span>{translation}</span><button type="button" className="pd-text-btn" onClick={() => { void navigator.clipboard.writeText(translation); }}><Copy size={12} />复制</button></div>}
      {error && <div className="pd-annotation-error">{error}</div>}
    </article>
  );
}

function AnnotationsPane({ annotations, activeId, onUpdate, onDelete, onGoTo, onAsk, onTranslate }) {
  const sorted = useMemo(() => annotations.slice().sort((a, b) => a.page - b.page || String(a.createdAt).localeCompare(String(b.createdAt))), [annotations]);
  return (
    <div className="pd-annotationspane">
      <div className="pd-pane-head">
        <div>
          <div className="pd-pane-title"><Highlighter size={14} />高亮与段落笔记</div>
          <div className="pd-pane-subtitle">{annotations.length} 条标注 · 默认高亮色可以在 PDF 选区工具栏切换</div>
        </div>
      </div>
      <div className="pd-annotations-scroll">
        {sorted.length === 0 && (
          <EmptyState
            icon={<Highlighter size={28} />}
            title="划线，然后写下你的理解"
            description="在左侧 PDF 里选中文字：高亮、记笔记、问 AI 或翻译。所有标注会自动保存。"
          />
        )}
        {sorted.map((annotation) => (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            focus={activeId === annotation.id}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onGoTo={onGoTo}
            onAsk={onAsk}
            onTranslate={onTranslate}
          />
        ))}
      </div>
    </div>
  );
}

function ReaderPage({ api, projectId, paperId, initialTab, onBack, notify }) {
  const [data, setData] = useState(null);
  const [paper, setPaper] = useState(null);
  const [notes, setNotes] = useState('');
  const [annotations, setAnnotations] = useState([]);
  const [chat, setChat] = useState([]);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [pdfProgress, setPdfProgress] = useState(null);
  const [pdfError, setPdfError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(initialTab || 'chat');
  const [activeAnnotation, setActiveAnnotation] = useState(null);
  const [chatQuote, setChatQuote] = useState(null);
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [noteProgress, setNoteProgress] = useState(null);
  const [notesError, setNotesError] = useState('');
  const [notesFresh, setNotesFresh] = useState(false);
  const [paneOpen, setPaneOpen] = useState(true);
  const [annotationSave, setAnnotationSave] = useState('saved');
  const pdfRef = useRef(null);
  const mounted = useMounted();
  const autoNotesTried = useRef(false);

  const loadPdf = useCallback(async (paperInfo) => {
    if (!mounted.current) return;
    setPdfError('');
    const cacheKey = pdfCacheKey(projectId, paperId, paperInfo);
    const cached = getCachedPdf(cacheKey);
    if (cached) {
      setPdfProgress({ received: cached.length, total: cached.length });
      setPdfBytes(cached);
      return;
    }
    setPdfProgress((previous) => ({ received: 0, total: previous?.total || paperInfo?.pdfBytes || 0 }));
    try {
      const bytes = await downloadEntireFile(api, projectId, paperId, 'pdf', (received, total) => {
        if (mounted.current) setPdfProgress({ received, total });
      }, cacheKey);
      if (!mounted.current) return;
      setPdfBytes(bytes);
    } catch (reason) {
      if (!mounted.current) return;
      setPdfError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [api, projectId, paperId, mounted]);

  const loadReader = useCallback(async () => {
    setLoading(true);
    setError('');
    setPdfBytes(null);
    autoNotesTried.current = false;
    try {
      const reader = await api.getReaderData(projectId, paperId);
      if (!mounted.current) return;
      setData(reader);
      setPaper(reader.paper);
      setNotes(reader.notes || '');
      setAnnotations(reader.annotations || []);
      setChat(reader.chat || []);
      setPdfProgress({ received: 0, total: reader.pdfBytes || 0 });
      // Do not make the whole reader wait for the file transfer: show the
      // three-pane shell and start the PDF download alongside it.
      setLoading(false);
      void loadPdf(reader.paper);
      const hasUsefulNotes = String(reader.notes || '').trim().length > 260 && !String(reader.notes).includes('AI 精读正在准备中');
      if (reader.paper.hasText && !reader.paper.notesGeneratedAt && !hasUsefulNotes) {
        autoNotesTried.current = true;
        void runGenerateNotes(false, { silent: true });
      }
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    }
  }, [api, projectId, paperId, mounted, loadPdf]);

  useEffect(() => { void loadReader(); }, [loadReader]);

  useEffect(() => {
    if (!generatingNotes) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const progress = await api.noteProgress(projectId, paperId);
        if (!cancelled) setNoteProgress(progress);
      } catch { /* the fallback card keeps showing */ }
      if (!cancelled) timer = window.setTimeout(poll, 900);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [generatingNotes, api, projectId, paperId]);

  const persistAnnotations = async (next, message) => {
    if (!mounted.current) return;
    setAnnotations(next);
    setAnnotationSave('saving');
    try {
      await api.saveAnnotations(projectId, paperId, next);
      if (mounted.current) setAnnotationSave('saved');
    } catch (reason) {
      if (mounted.current) setAnnotationSave('error');
      notify(`标注保存失败：${reason instanceof Error ? reason.message : String(reason)}`, 'error');
    }
    if (message) notify(message, 'success');
  };

  const runGenerateNotes = async (force = false, { silent = false } = {}) => {
    if (generatingNotes) return;
    setGeneratingNotes(true);
    setNoteProgress({ active: true, stage: 'reading', chars: 0, startedAt: Date.now(), done: false, error: null });
    setNotesError('');
    try {
      const result = await api.generateNotes(projectId, paperId, force);
      if (!mounted.current) return;
      setNotes(result.notes);
      if (result.paper) setPaper(result.paper);
      setNoteProgress({ active: false, done: true, stage: 'done', chars: result.notes?.length || 0, error: null });
      if (silent) {
        setNotesFresh(true);
      } else {
        setNotesFresh(false);
        setTab('notes');
        setPaneOpen(true);
        notify('AI 精读笔记已更新', 'success');
      }
    } catch (reason) {
      if (!mounted.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setNotesError(message);
      setNoteProgress({ active: false, done: true, stage: 'error', chars: 0, error: message });
      if (!silent) notify(message, 'error');
    } finally {
      if (mounted.current) setGeneratingNotes(false);
    }
  };

  const handleTextExtracted = async (text) => {
    if (!paper || paper.hasText || !text?.trim()) return;
    try {
      await api.savePaperText(projectId, paperId, text);
      if (!mounted.current) return;
      setPaper((previous) => previous ? { ...previous, hasText: true, textChars: text.length } : previous);
      if (!paper.notesGeneratedAt && String(notes).trim().length < 260) {
        autoNotesTried.current = true;
        void runGenerateNotes(false, { silent: true });
      }
    } catch (reason) {
      notify(`文本索引保存失败：${reason instanceof Error ? reason.message : String(reason)}`, 'error');
    }
  };

  const handleMetadata = async (info, firstText) => {
    if (!paper || paper.parsedAt) return;
    try {
      const facts = metadataFacts(info, firstText, paper.originalFilename);
      const updated = await api.updatePaper(projectId, paperId, {
        title: facts.title,
        authors: facts.authors,
        year: facts.year,
        venue: facts.venue,
        parsedAt: true,
      });
      if (mounted.current) setPaper(updated);
    } catch { /* metadata is best-effort */ }
  };

  const goToAnnotation = (annotation) => {
    setActiveAnnotation(annotation.id);
    pdfRef.current?.goToPage(annotation.page);
  };

  const addAnnotation = (annotation) => {
    const next = [annotation, ...annotations];
    void persistAnnotations(next, '已高亮');
    setActiveAnnotation(annotation.id);
    if (annotation.focusNote) {
      setTab('annotations');
      setPaneOpen(true);
    } else {
      notify('已高亮，点击 PDF 中的高亮或右侧“标注”可以补充笔记', 'success');
    }
    window.getSelection()?.removeAllRanges();
  };

  const updateAnnotation = (annotation) => {
    const { focusNote, ...clean } = annotation;
    const next = annotations.map((item) => item.id === annotation.id ? clean : item);
    void persistAnnotations(next);
  };

  const deleteAnnotation = (annotation) => {
    if (!window.confirm('删除这条标注？')) return;
    void persistAnnotations(annotations.filter((item) => item.id !== annotation.id), '标注已删除');
    if (activeAnnotation === annotation.id) setActiveAnnotation(null);
  };

  const askFromAnnotation = (annotation) => {
    setChatQuote({ text: annotation.text, page: annotation.page });
    setTab('chat');
    setPaneOpen(true);
  };

  const translateText = async (text, page) => {
    const result = await api.translate(projectId, paperId, text, page);
    return result.translation;
  };

  const insertTranslationToNotes = async (translation) => {
    const source = String(translation.source || '').trim();
    if (!source) return;
    const quote = source.split('\n').map((line) => `> ${line}`).join('\n');
    const block = `\n\n### 翻译 · 第 ${translation.page} 页\n\n${quote}\n\n${translation.text}\n`;
    const next = `${notes.trimEnd()}${block}`;
    setNotes(next);
    try {
      await api.saveNotes(projectId, paperId, next);
      setTab('notes');
      setPaneOpen(true);
      notify('翻译已存入笔记', 'success');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const saveNotes = async (markdown) => {
    const result = await api.saveNotes(projectId, paperId, markdown);
    if (mounted.current) {
      setNotes(markdown);
      if (result.paper) setPaper(result.paper);
    }
    return result;
  };

  const sendChat = async (text, quote) => {
    const result = await api.chat(projectId, paperId, text, quote?.text || '', quote?.page || 0);
    if (mounted.current) setChat(result.messages);
    return result;
  };

  const clearChat = async () => {
    try {
      await api.clearChat(projectId, paperId);
      setChat([]);
      notify('对话已清空', 'success');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  };

  const totalPdf = pdfProgress?.total || paper?.pdfBytes || 0;
  const pdfPercent = totalPdf ? Math.round((pdfProgress?.received / totalPdf) * 100) : 0;

  if (loading) {
    return (
      <div className="pd-page pd-reader pd-reader-loading">
        <div className="pd-reader-loading-card">
          <div className="pd-pdf-loading-orb"><Loader2 size={22} className="pd-spin" /></div>
          <strong>正在准备共读空间</strong>
          <span>读取 PDF、笔记、标注与对话…</span>
          {totalPdf > 0 && <div className="pd-reader-progress"><span style={{ width: `${pdfPercent}%` }} /></div>}
        </div>
      </div>
    );
  }

  if (error || !paper) {
    return (
      <div className="pd-page pd-reader">
        <div className="pd-empty pd-empty-error">
          <CircleAlert size={28} />
          <strong>无法打开这篇论文</strong>
          <span>{error || '论文不存在'}</span>
          <button type="button" className="pd-btn pd-btn-secondary" onClick={onBack}>返回项目</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`pd-reader ${paneOpen ? 'is-pane-open' : ''}`}>
      <header className="pd-reader-header">
        <button type="button" className="pd-back" onClick={onBack}><ArrowLeft size={15} />{data?.project?.name || '项目'}</button>
        <div className="pd-reader-title">
          <strong>{paper.title}</strong>
          <span>{paperMetaLine(paper)}</span>
        </div>
        <div className="pd-reader-header-actions">
          {paper.tags.slice(0, 3).map((tag) => <TagPill key={tag} tag={tag} />)}
          <button type="button" className={`pd-btn pd-btn-ghost pd-btn-sm pd-pane-toggle ${paneOpen ? 'is-active' : ''}`} onClick={() => setPaneOpen((value) => !value)}>
            {generatingNotes ? <Loader2 size={14} className="pd-spin" /> : <MessageSquare size={14} />}{tab === 'chat' ? '对话' : tab === 'notes' ? '笔记' : '标注'}
          </button>
        </div>
      </header>

      <div className="pd-reader-body">
        <section className="pd-pdf-panel">
          {pdfBytes ? (
            <PdfViewer
              ref={pdfRef}
              data={pdfBytes}
              paper={paper}
              annotations={annotations}
              activeAnnotationId={activeAnnotation}
              onPageChange={() => {}}
              onMetadata={handleMetadata}
              onTextExtracted={paper.hasText ? undefined : handleTextExtracted}
              onCreateAnnotation={addAnnotation}
              onAskAI={(selection) => {
                setChatQuote(selection);
                setTab('chat');
                setPaneOpen(true);
                notify(`已附上第 ${selection.page} 页的选中段落`, 'info');
              }}
              onTranslate={translateText}
              onInsertNote={insertTranslationToNotes}
              onHighlightClick={(annotation) => {
                setActiveAnnotation(annotation.id);
                setTab('annotations');
                setPaneOpen(true);
              }}
            />
          ) : pdfError ? (
            <div className="pd-empty pd-empty-error pd-pdf-error">
              <CircleAlert size={24} />
              <strong>PDF 下载没有完成</strong>
              <span>{pdfError}</span>
              <button type="button" className="pd-btn pd-btn-secondary" onClick={() => void loadPdf(paper)}>重新加载 PDF</button>
            </div>
          ) : (
            <div className="pd-pdf-loading">
              <div className="pd-pdf-loading-orb"><Loader2 size={22} className="pd-spin" /></div>
              <strong>PDF 正在加载</strong>
              <span>{formatBytes(pdfProgress?.received || 0)} / {formatBytes(totalPdf)} · 8 路并行读取</span>
              <div className="pd-reader-progress"><span style={{ width: `${Math.max(4, pdfPercent)}%` }} /></div>
              <div className="pd-pdf-loading-hint">不必等 AI 读完，右侧对话和笔记已经可用</div>
            </div>
          )}
        </section>

        <aside className={`pd-rightpane ${paneOpen ? 'is-open' : ''}`}>
          <div className="pd-right-tabs">
            <button type="button" className={`pd-right-tab ${tab === 'chat' ? 'is-active' : ''}`} onClick={() => setTab('chat')}><MessageSquare size={14} />对话</button>
            <button type="button" className={`pd-right-tab ${tab === 'notes' ? 'is-active' : ''}`} onClick={() => { setTab('notes'); setNotesFresh(false); }}><NotebookPen size={14} />笔记{notesFresh && <span className="pd-tab-dot" />}</button>
            <button type="button" className={`pd-right-tab ${tab === 'annotations' ? 'is-active' : ''}`} onClick={() => setTab('annotations')}><Highlighter size={14} />标注{annotations.length > 0 && <span>{annotations.length}</span>}</button>
            <div className="pd-right-tabs-spacer" />
            <button type="button" className="pd-icon-btn pd-pane-close" onClick={() => setPaneOpen(false)} aria-label="收起侧栏"><X size={15} /></button>
          </div>
          {generatingNotes && <NoteProgressCard progress={noteProgress} pdfReady={Boolean(pdfBytes)} />}
          <div className="pd-right-content">
            {tab === 'chat' && (
              <ChatPane
                chat={chat}
                paper={paper}
                quote={chatQuote}
                onClearQuote={() => setChatQuote(null)}
                onSend={sendChat}
                onClear={clearChat}
              />
            )}
            {tab === 'notes' && (
              <NotesPane
                notes={notes}
                paper={paper}
                generating={generatingNotes}
                error={notesError}
                onSave={saveNotes}
                onRegenerate={() => { void runGenerateNotes(true); }}
              />
            )}
            {tab === 'annotations' && (
              <AnnotationsPane
                annotations={annotations}
                activeId={activeAnnotation}
                onUpdate={updateAnnotation}
                onDelete={deleteAnnotation}
                onGoTo={(page) => pdfRef.current?.goToPage(page)}
                onAsk={askFromAnnotation}
                onTranslate={translateText}
              />
            )}
          </div>
          {annotationSave === 'error' && <div className="pd-annotation-save-error">标注保存失败</div>}
        </aside>
        {!paneOpen && (
          <button type="button" className="pd-reopen-pane" onClick={() => setPaneOpen(true)}><MessageSquare size={15} />继续对话</button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function PaperDeskApp({ api }) {
  const [view, setView] = useState({ kind: 'projects' });
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2, 5)}`;
    setToasts((previous) => [...previous.slice(-3), { id, message, type }]);
    window.setTimeout(() => setToasts((previous) => previous.filter((toast) => toast.id !== id)), type === 'error' ? 6000 : 3600);
  }, []);
  const dismiss = useCallback((id) => setToasts((previous) => previous.filter((toast) => toast.id !== id)), []);

  return (
    <div className="pd-app">
      {view.kind === 'projects' && (
        <ProjectsPage
          api={api}
          notify={notify}
          onOpenProject={(projectId) => setView({ kind: 'project', projectId })}
        />
      )}
      {view.kind === 'project' && (
        <ProjectPage
          key={view.projectId}
          api={api}
          projectId={view.projectId}
          notify={notify}
          onBack={() => setView({ kind: 'projects' })}
          onOpenReader={(paperId, tab) => setView({ kind: 'reader', projectId: view.projectId, paperId, tab })}
        />
      )}
      {view.kind === 'reader' && (
        <ReaderPage
          key={`${view.projectId}/${view.paperId}`}
          api={api}
          projectId={view.projectId}
          paperId={view.paperId}
          initialTab={view.tab}
          notify={notify}
          onBack={() => setView({ kind: 'project', projectId: view.projectId })}
        />
      )}
      <ToastLayer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default PaperDeskApp;


// Internal pages are also exported for development harnesses.
export { ProjectsPage, ProjectPage, ReaderPage, ChatPane, NotesPane, AnnotationsPane };

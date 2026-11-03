import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FlaskConical,
  GripVertical,
  GraduationCap,
  Library,
  Link2,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { renderMarkdown } from './markdown';
import { formatRelative, paperMetaLine } from './api';

const KIND_META = {
  root: { label: '项目', hint: '项目总览' },
  section: { label: '章节', hint: '章节' },
  problem: { label: '问题', hint: '研究问题' },
  method: { label: '方法', hint: '方法' },
  idea: { label: '想法', hint: '关键想法' },
  question: { label: '问题', hint: '待追问' },
  eval: { label: '评估', hint: '实验与指标' },
  foundation: { label: '基础', hint: '前置基础' },
  concept: { label: '概念', hint: '核心概念' },
  timeline: { label: '脉络', hint: '发展脉络' },
  paper: { label: '论文', hint: '文献' },
  recall: { label: '复习', hint: '主动回忆' },
  note: { label: '笔记', hint: '自由笔记' },
};

const PAPER_MIME = 'application/x-paper-desk-paper';
const MapPaperContext = React.createContext({ papers: new Map(), onOpenPaper: () => {}, onAddChild: () => {} });

function uid(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function cloneNodeForSave(node) {
  return {
    id: node.id,
    type: 'mapNode',
    position: { x: node.position.x, y: node.position.y },
    data: {
      kind: node.data?.kind || 'note',
      title: String(node.data?.title || 'Untitled node'),
      markdown: String(node.data?.markdown || ''),
      paperIds: Array.isArray(node.data?.paperIds) ? node.data.paperIds : [],
    },
  };
}

function cloneEdgeForSave(edge) {
  return { id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep' };
}

function MindMapNode({ id, data, selected }) {
  const { papers, onOpenPaper, onAddChild } = useContext(MapPaperContext);
  const html = useMemo(() => renderMarkdown(data.markdown || ''), [data.markdown]);
  const linked = (data.paperIds || []).map((paperId) => papers.get(paperId)).filter(Boolean);
  const kind = KIND_META[data.kind] || KIND_META.note;
  return (
    <div className={`pd-map-node pd-map-kind-${data.kind || 'note'} ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="pd-map-handle" />
      <div className="pd-map-node-drag">
        <GripVertical size={13} />
        <span>{kind.label}</span>
        <span className="pd-map-node-spacer" />
        <button
          type="button"
          className="pd-map-node-add nodrag"
          title="添加子节点"
          onClick={(event) => {
            event.stopPropagation();
            onAddChild?.(id);
          }}
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="pd-map-node-title">{data.title || '未命名节点'}</div>
      <div
        className={`pd-map-node-body pd-md ${html ? '' : 'is-empty'}`}
        dangerouslySetInnerHTML={{ __html: html || '<p>双击这个节点，写下你的想法…</p>' }}
      />
      {linked.length > 0 && (
        <div className="pd-map-node-papers nodrag">
          {linked.slice(0, 3).map((paper) => (
            <button
              key={paper.id}
              type="button"
              className="pd-map-paper-chip"
              title={paper.title}
              onClick={(event) => {
                event.stopPropagation();
                onOpenPaper?.(paper.id);
              }}
            >
              <BookOpen size={10} />{paper.title}
            </button>
          ))}
          {linked.length > 3 && <span className="pd-map-paper-more">+{linked.length - 3}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="pd-map-handle" />
    </div>
  );
}

const NODE_TYPES = { mapNode: MindMapNode };

function MapTypeBadge({ type }) {
  const learning = type === 'learning';
  return (
    <span className={`pd-map-type-badge ${learning ? 'is-learning' : 'is-research'}`}>
      {learning ? <GraduationCap size={12} /> : <FlaskConical size={12} />}
      {learning ? '学习型' : '研究型'}
    </span>
  );
}

function MapSaveState({ state }) {
  if (state === 'saving') return <span className="pd-map-save is-saving"><Loader2 size={11} className="pd-spin" />保存中…</span>;
  if (state === 'error') return <span className="pd-map-save is-error"><CircleAlert size={11} />保存失败</span>;
  return <span className="pd-map-save"><Check size={11} />已保存</span>;
}

function estimateNodeHeight(node) {
  const chars = String(node.data?.markdown || '').length;
  return Math.max(118, Math.min(280, 112 + chars / 2.7));
}

function layoutGraph(nodes, edges) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 38, ranksep: 105, marginx: 30, marginy: 30 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: 310, height: estimateNodeHeight(node) });
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  return nodes.map((node) => {
    const point = graph.node(node.id);
    if (!point) return node;
    return {
      ...node,
      position: {
        x: Math.round(point.x - 155),
        y: Math.round(point.y - estimateNodeHeight(node) / 2),
      },
    };
  });
}

function PaperLibrary({ papers, nodes, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const linked = useMemo(() => {
    const counts = new Map();
    for (const node of nodes) {
      for (const id of node.data?.paperIds || []) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [nodes]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return papers.filter((paper) => !needle || `${paper.title} ${(paper.authors || []).join(' ')} ${paper.tags.join(' ')}`.toLowerCase().includes(needle));
  }, [papers, query]);
  return (
    <div className="pd-map-library" onMouseDown={(event) => event.stopPropagation()}>
      <div className="pd-map-library-head">
        <div><Library size={14} /><strong>论文库</strong><span>{papers.length} 篇</span></div>
        <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={onClose} aria-label="关闭论文库"><X size={14} /></button>
      </div>
      <div className="pd-search pd-search-sm">
        <Search size={13} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索论文、作者、标签…" />
      </div>
      <div className="pd-map-library-list">
        {filtered.length === 0 && <div className="pd-map-library-empty">没有匹配的论文</div>}
        {filtered.map((paper) => (
          <div
            key={paper.id}
            className={`pd-map-library-row ${linked.has(paper.id) ? 'is-linked' : ''}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(PAPER_MIME, paper.id);
              event.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <span className="pd-map-library-icon"><BookOpen size={14} /></span>
            <div className="pd-map-library-copy">
              <strong title={paper.title}>{paper.title}</strong>
              <span>{paperMetaLine(paper) || '等待补充元数据'} {paper.tags.length ? `· ${paper.tags.slice(0, 3).join(' / ')}` : ''}{linked.get(paper.id) ? ` · ${linked.get(paper.id)} 个节点引用` : ''}</span>
            </div>
            <button type="button" className={`pd-btn pd-btn-sm ${linked.has(paper.id) ? 'pd-btn-ghost' : 'pd-btn-secondary'}`} onClick={() => onAdd(paper)}>
              {linked.has(paper.id) ? '已加入' : '加入'}
            </button>
          </div>
        ))}
      </div>
      <div className="pd-map-library-foot"><Link2 size={12} />拖到画布也可以创建论文节点</div>
    </div>
  );
}

function MapChatMessage({ message, nodes }) {
  const mentioned = (message.nodeIds || []).map((id) => nodes.find((node) => node.id === id)).filter(Boolean);
  if (message.role === 'user') {
    return (
      <div className="pd-chat-message pd-chat-user">
        <div className="pd-chat-bubble">
          {mentioned.length > 0 && (
            <div className="pd-map-node-quote">
              <span>引用了节点</span>
              {mentioned.map((node) => <b key={node.id}>{node.data.title}</b>)}
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

function MapChatPane({ chat, nodes, selectedNode, type, onSend, onClear }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [optimistic, setOptimistic] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const isLearning = type === 'learning';

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat, optimistic]);

  useEffect(() => {
    if (selectedNode) window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [selectedNode?.id]);

  const suggestions = isLearning ? [
    '按概念依赖关系帮我重排学习路径',
    '用费曼方式解释我选中的概念',
    '根据脑图给我出 5 道主动回忆题',
    '这个方向的发展脉络还缺哪些关键论文？',
  ] : [
    '把这张脑图收敛成一个 research problem',
    '从方法节点推导一个可验证的 hypothesis',
    '我的评估方案缺了哪些 baseline 或 benchmark？',
    '把选中的论文和我的方法连起来，找差异',
  ];

  const send = async (preset) => {
    const text = String(preset ?? input).trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    const ids = selectedNode ? [selectedNode.id] : [];
    setOptimistic({
      user: { id: 'optimistic-map-user', role: 'user', content: text, nodeIds: ids, createdAt: new Date().toISOString() },
    });
    try {
      const result = await onSend(text, ids);
      setInput('');
      setOptimistic(null);
      void result;
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
          <div className="pd-pane-title"><Network size={14} />脑图对话</div>
          <div className="pd-pane-subtitle">基于整张图、论文库{selectedNode ? '和选中节点' : ''}回答</div>
        </div>
        {chat.length > 0 && (
          <button type="button" className="pd-text-btn pd-muted" onClick={() => { if (window.confirm('清空脑图对话？')) onClear?.(); }}>清空</button>
        )}
      </div>
      <div className="pd-chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="pd-chat-empty">
            <div className="pd-chat-empty-mark"><Network size={22} /></div>
            <strong>{isLearning ? '把学习路线想清楚' : '把研究想法逼到可执行'}</strong>
            <p>{isLearning ? '让 DeepSeek 帮你找依赖、补脉络、设计练习，而不只是总结论文。' : '让 DeepSeek 帮你找漏洞、补 baseline、收敛问题，并把论文接到你的论证上。'}</p>
            <div className="pd-suggestion-list">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" className="pd-suggestion" onClick={() => void send(suggestion)}>
                  <Sparkles size={13} />{suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => <MapChatMessage key={message.id} message={message} nodes={nodes} />)}
        {sending && (
          <div className="pd-chat-message pd-chat-assistant">
            <div className="pd-chat-avatar"><Sparkles size={13} /></div>
            <div className="pd-typing"><span /><span /><span /></div>
          </div>
        )}
        {error && <div className="pd-chat-error"><CircleAlert size={14} />{error}</div>}
      </div>
      <div className="pd-composer-wrap">
        {selectedNode && (
          <div className="pd-map-selected-chip">
            <Link2 size={12} /><span>引用节点</span><strong>{selectedNode.data.title}</strong>
            <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={() => onClear?.('selection')} title="在本次提问中不引用节点"><X size={12} /></button>
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
            rows={1}
            placeholder={isLearning ? '问关于学习路线、概念或论文的问题…' : '问关于研究问题、方法、实验或论文的问题…'}
          />
          <button type="button" className="pd-send-btn" onClick={() => void send()} disabled={sending || !input.trim()} aria-label="发送">
            {sending ? <Loader2 size={16} className="pd-spin" /> : <Send size={15} />}
          </button>
        </div>
        <div className="pd-composer-hint">Enter 发送 · Shift+Enter 换行 · 引用选中节点会带上它的内容</div>
      </div>
    </div>
  );
}

function NodeInspector({ node, papers, nodes, edges, onChange, onDelete, onSelectNode, onOpenPaper }) {
  const [preview, setPreview] = useState(false);
  const [paperQuery, setPaperQuery] = useState('');
  const nodePapers = (node.data?.paperIds || []).map((id) => papers.find((p) => p.id === id)).filter(Boolean);
  const backlinks = edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => nodes.find((item) => item.id === edge.source))
    .filter(Boolean);
  const filteredPapers = papers.filter((paper) => {
    const needle = paperQuery.trim().toLowerCase();
    return !needle || `${paper.title} ${(paper.authors || []).join(' ')} ${paper.tags.join(' ')}`.toLowerCase().includes(needle);
  });
  useEffect(() => { setPreview(false); setPaperQuery(''); }, [node.id]);
  const patch = (data) => onChange(node.id, data);
  const togglePaper = (paperId) => {
    const current = node.data?.paperIds || [];
    patch({ paperIds: current.includes(paperId) ? current.filter((id) => id !== paperId) : [...current, paperId] });
  };
  return (
    <div className="pd-map-inspector">
      <div className="pd-pane-head">
        <div>
          <div className="pd-pane-title"><GripVertical size={14} />节点详情</div>
          <div className="pd-pane-subtitle">{KIND_META[node.data?.kind]?.hint || '自由节点'}</div>
        </div>
        <button type="button" className="pd-icon-btn pd-icon-btn-sm pd-icon-btn-danger" title="删除节点" onClick={() => onDelete(node)}><Trash2 size={14} /></button>
      </div>
      <div className="pd-map-inspector-scroll">
        <label className="pd-field">
          <span>节点标题</span>
          <input value={node.data?.title || ''} onChange={(event) => patch({ title: event.target.value })} />
        </label>
        <label className="pd-field">
          <span>节点类型</span>
          <select value={node.data?.kind || 'note'} onChange={(event) => patch({ kind: event.target.value })}>
            {Object.entries(KIND_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </select>
        </label>
        <div className="pd-field">
          <span>Markdown 内容</span>
          <div className="pd-map-editor-tabs">
            <button type="button" className={!preview ? 'is-active' : ''} onClick={() => setPreview(false)}>编辑</button>
            <button type="button" className={preview ? 'is-active' : ''} onClick={() => setPreview(true)}>预览</button>
          </div>
          {preview ? (
            <div className="pd-map-node-preview pd-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.data?.markdown || '') || '<p class="pd-muted">还没有内容。</p>' }} />
          ) : (
            <textarea
              className="pd-map-node-textarea"
              value={node.data?.markdown || ''}
              onChange={(event) => patch({ markdown: event.target.value })}
              placeholder="支持 Markdown 和 $公式$，例如：&#10;&#10;关键假设：$$p(\theta \mid x) \propto p(x \mid \theta)p(\theta)$$"
              spellCheck={false}
            />
          )}
        </div>
        <div className="pd-field">
          <span><Link2 size={12} />关联论文 <em>{nodePapers.length}</em></span>
          {nodePapers.length > 0 && (
            <div className="pd-map-linked-papers">
              {nodePapers.map((paper) => (
                <span key={paper.id} className="pd-map-linked-paper">
                  <button type="button" onClick={() => onOpenPaper?.(paper.id)}>{paper.title}</button>
                  <button type="button" className="pd-icon-btn pd-icon-btn-sm" onClick={() => togglePaper(paper.id)} aria-label="移除论文"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="pd-map-paper-picker">
            <div className="pd-search pd-search-sm"><Search size={12} /><input value={paperQuery} onChange={(event) => setPaperQuery(event.target.value)} placeholder="搜索论文库…" /></div>
            <div className="pd-map-paper-options">
              {filteredPapers.map((paper) => {
                const active = (node.data?.paperIds || []).includes(paper.id);
                return (
                  <button key={paper.id} type="button" className={`pd-map-paper-option ${active ? 'is-active' : ''}`} onClick={() => togglePaper(paper.id)}>
                    <span>{active ? <Check size={12} /> : <Plus size={12} />}</span>
                    <span>{paper.title}</span>
                    <small>{paper.year || ''}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {node.data?.kind === 'paper' && nodePapers[0] && (
          <button type="button" className="pd-btn pd-btn-secondary pd-map-open-paper" onClick={() => onOpenPaper?.(nodePapers[0].id)}><ExternalLink size={14} />打开论文阅读页</button>
        )}
        <div className="pd-field">
          <span><Network size={12} />反向链接 <em>{backlinks.length}</em></span>
          {backlinks.length === 0 ? <div className="pd-map-empty-note">还没有节点连到这里。拖动节点右侧的连接点画一条线。</div> : (
            <div className="pd-map-backlinks">
              {backlinks.map((source) => (
                <button key={source.id} type="button" onClick={() => onSelectNode(source.id)}>
                  <ChevronRight size={12} /><span>{source.data.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="pd-map-inspector-hint">点击节点可选中；双击节点直接打开这里。连线从右侧圆点拖到另一个节点。</p>
      </div>
    </div>
  );
}

function MindMapInner({ api, projectId, notify, onBack, onOpenReader }) {
  const [project, setProject] = useState(null);
  const [papers, setPapers] = useState([]);
  const [mapType, setMapType] = useState('research');
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [chat, setChat] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('chat');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [quoteSuppressed, setQuoteSuppressed] = useState(false);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);
  const mounted = useRef(true);
  const { fitView, screenToFlowPosition } = useReactFlow();

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const paperMap = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);
  const selectedNode = nodes.find((node) => node.id === selectedId) || null;

  const flushSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveState('saving');
    try {
      const map = {
        version: 1,
        type: mapType,
        nodes: nodesRef.current.map(cloneNodeForSave),
        edges: edgesRef.current.map(cloneEdgeForSave),
      };
      await api.saveMindmap(projectId, map);
      if (mounted.current) setSaveState('saved');
    } catch (reason) {
      if (mounted.current) setSaveState('error');
      notify?.(`脑图保存失败：${reason instanceof Error ? reason.message : String(reason)}`, 'error');
    }
  }, [api, projectId, mapType, notify]);

  const queueSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void flushSave(); }, 650);
  }, [flushSave]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (dirtyRef.current) {
      const map = { version: 1, type: mapType, nodes: nodesRef.current.map(cloneNodeForSave), edges: edgesRef.current.map(cloneEdgeForSave) };
      void api.saveMindmap(projectId, map).catch(() => {});
    }
  }, [api, projectId, mapType]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getMindmap(projectId);
      if (!mounted.current) return;
      setProject(data.project);
      setPapers(data.papers || []);
      setMapType(data.map?.type || data.project?.type || 'research');
      const initialNodes = (data.map?.nodes || []).map((node) => ({ ...node, type: 'mapNode' }));
      const initialEdges = (data.map?.edges || []).map((edge) => ({
        ...edge,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--pd-map-edge, #9aa6ba)', strokeWidth: 1.5 },
      }));
      nodesRef.current = initialNodes;
      edgesRef.current = initialEdges;
      setNodes(initialNodes);
      setEdges(initialEdges);
      setChat(data.chat || []);
      setLoading(false);
      window.setTimeout(() => fitView({ padding: 0.16, duration: 350 }), 80);
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    }
  }, [api, projectId, fitView]);

  useEffect(() => { void load(); }, [load]);

  const patchNode = useCallback((id, patch) => {
    const next = nodesRef.current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node);
    nodesRef.current = next;
    setNodes(next);
    queueSave();
  }, [queueSave]);

  const addNode = useCallback(({ title, kind = 'note', markdown = '', paperIds = [], position, parentId = null }) => {
    const id = uid('node');
    const source = parentId ? nodesRef.current.find((node) => node.id === parentId) : null;
    const point = position || (source
      ? { x: source.position.x + 390, y: source.position.y + 40 }
      : screenToFlowPosition({ x: window.innerWidth * 0.42, y: window.innerHeight * 0.38 }));
    const nextNode = {
      id,
      type: 'mapNode',
      position: { x: Math.round(point.x), y: Math.round(point.y) },
      data: { kind, title, markdown, paperIds },
    };
    const nextNodes = [...nodesRef.current, nextNode];
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    if (parentId) {
      const nextEdges = [...edgesRef.current, { id: uid('edge'), source: parentId, target: id, type: 'smoothstep' }];
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    }
    setSelectedId(id);
    setQuoteSuppressed(false);
    setTab('node');
    queueSave();
    window.setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 50);
    return nextNode;
  }, [queueSave, screenToFlowPosition, fitView]);

  const addPaperNode = useCallback((paper, position) => {
    const existing = nodesRef.current.find((node) => (node.data?.paperIds || []).includes(paper.id) && node.data?.kind === 'paper');
    if (existing) {
      setSelectedId(existing.id);
      setTab('node');
      setQuoteSuppressed(false);
      fitView({ padding: 0.7, duration: 300 });
      return;
    }
    const markdown = [
      paperMetaLine(paper) || '论文',
      paper.tags?.length ? paper.tags.map((tag) => `\`${tag}\``).join(' ') : '',
      paper.notesPreview ? `\n${paper.notesPreview}` : '',
    ].filter(Boolean).join('\n\n');
    addNode({ title: paper.title, kind: 'paper', markdown, paperIds: [paper.id], position });
  }, [addNode, fitView]);

  const addChild = useCallback((parentId) => {
    addNode({ parentId, title: '新想法', kind: 'note', markdown: '' });
  }, [addNode]);

  const mapContextValue = useMemo(() => ({
    papers: paperMap,
    onOpenPaper: (paperId) => onOpenReader?.(paperId, 'chat'),
    onAddChild: addChild,
  }), [paperMap, onOpenReader, addChild]);

  const onNodesChange = useCallback((changes) => {
    const next = applyNodeChanges(changes, nodesRef.current);
    nodesRef.current = next;
    setNodes(next);
    if (changes.some((change) => ['position', 'remove', 'replace'].includes(change.type))) queueSave();
  }, [queueSave]);

  const onEdgesChange = useCallback((changes) => {
    const next = applyEdgeChanges(changes, edgesRef.current);
    edgesRef.current = next;
    setEdges(next);
    if (changes.some((change) => ['remove', 'replace'].includes(change.type))) queueSave();
  }, [queueSave]);

  const onConnect = useCallback((connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const next = addEdge({
      ...connection,
      id: uid('edge'),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'var(--pd-map-edge, #9aa6ba)', strokeWidth: 1.5 },
    }, edgesRef.current);
    edgesRef.current = next;
    setEdges(next);
    queueSave();
  }, [queueSave]);

  const tidy = useCallback(() => {
    const next = layoutGraph(nodesRef.current, edgesRef.current);
    nodesRef.current = next;
    setNodes(next);
    queueSave();
    window.setTimeout(() => fitView({ padding: 0.18, duration: 450 }), 80);
  }, [queueSave, fitView]);

  const deleteNode = useCallback((node) => {
    if (!window.confirm(`删除节点“${node.data?.title || '未命名'}”？`)) return;
    const nextNodes = nodesRef.current.filter((item) => item.id !== node.id);
    const nextEdges = edgesRef.current.filter((edge) => edge.source !== node.id && edge.target !== node.id);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    if (selectedId === node.id) setSelectedId(null);
    queueSave();
  }, [queueSave, selectedId]);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    const paperId = event.dataTransfer.getData(PAPER_MIME);
    const paper = papers.find((item) => item.id === paperId);
    if (!paper) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addPaperNode(paper, position);
  }, [papers, screenToFlowPosition, addPaperNode]);

  const sendChat = useCallback(async (text, selectedIds) => {
    // The Host builds the model context from mindmap.json. Flush pending
    // edits first so the assistant sees the nodes the user is looking at.
    await flushSave();
    const result = await api.mindmapChat(projectId, text, selectedIds);
    if (mounted.current) setChat(result.messages || []);
    return result;
  }, [api, projectId, flushSave]);

  const clearMapChat = useCallback(async (mode) => {
    if (mode === 'selection') {
      setQuoteSuppressed(true);
      return;
    }
    try {
      await api.clearMindmapChat(projectId);
      if (mounted.current) setChat([]);
      notify('脑图对话已清空', 'success');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
    }
  }, [api, projectId, notify]);

  if (loading) {
    return (
      <div className="pd-map-page pd-map-loading">
        <div className="pd-reader-loading-card">
          <div className="pd-pdf-loading-orb"><Network size={22} /></div>
          <strong>正在打开项目脑图</strong>
          <span>载入模板、论文库和对话…</span>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="pd-map-page pd-map-loading">
        <div className="pd-empty pd-empty-error">
          <CircleAlert size={28} />
          <strong>无法打开脑图</strong>
          <span>{error || '项目不存在'}</span>
          <button type="button" className="pd-btn pd-btn-secondary" onClick={onBack}>返回项目</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pd-map-page">
      <header className="pd-map-header">
        <button type="button" className="pd-back" onClick={onBack}><ArrowLeft size={15} />{project.name}</button>
        <div className="pd-map-title">
          <Network size={15} />
          <strong>项目脑图</strong>
          <MapTypeBadge type={mapType} />
        </div>
        <div className="pd-map-header-status">
          <MapSaveState state={saveState} />
        </div>
        <div className="pd-map-header-actions">
          <button type="button" className="pd-btn pd-btn-ghost pd-btn-sm" onClick={tidy}><Sparkles size={14} />整理布局</button>
          <button type="button" className={`pd-btn pd-btn-ghost pd-btn-sm ${libraryOpen ? 'pd-btn-ghost-active' : ''}`} onClick={() => setLibraryOpen((value) => !value)}><Library size={14} />论文库</button>
          <button type="button" className="pd-btn pd-btn-primary pd-btn-sm" onClick={() => addNode({ title: '新想法', kind: 'idea', markdown: '**一句话想法**\n\n' })}><Plus size={14} />节点</button>
        </div>
      </header>
      <div className="pd-map-body">
        <div
          className="pd-map-canvas-wrap"
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
          onDrop={handleDrop}
        >
          <MapPaperContext.Provider value={mapContextValue}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => { setSelectedId(node.id); setQuoteSuppressed(false); }}
            onNodeDoubleClick={(_, node) => { setSelectedId(node.id); setQuoteSuppressed(false); setTab('node'); }}
            onPaneClick={() => setSelectedId(null)}
            onInit={(instance) => { window.setTimeout(() => instance.fitView({ padding: 0.16, duration: 250 }), 50); }}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.2}
            maxZoom={1.8}
            panOnScroll
            selectionOnDrag
            dragHandle=".pd-map-node-drag"
            nodeDragThreshold={4}
            defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--pd-map-edge, #9aa6ba)', strokeWidth: 1.5 } }}
            proOptions={{ hideAttribution: true }}
            className="pd-map-flow"
          >
            <Background variant="dots" gap={20} size={1.2} color="var(--pd-map-dot, #cbd3df)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.data?.kind === 'paper' ? '#8b5cf6' : node.data?.kind === 'root' ? '#4d6bfe' : '#aab6c8'} maskColor="rgba(15, 18, 32, .08)" />
          </ReactFlow>
          </MapPaperContext.Provider>
          <div className="pd-map-tools">
            <span className="pd-map-tools-label"><Network size={13} />{nodes.length} 个节点 · {edges.length} 条连线</span>
            <span className="pd-map-tools-sep" />
            <button type="button" className="pd-text-btn" onClick={() => setLibraryOpen(true)}><Library size={13} />从论文库拖入</button>
          </div>
          {nodes.length === 0 && (
            <div className="pd-map-empty">
              <div className="pd-empty-icon"><Network size={28} /></div>
              <strong>这张图还是空的</strong>
              <span>添加一个想法，或从论文库拖入一篇论文开始。</span>
              <button type="button" className="pd-btn pd-btn-primary pd-btn-sm" onClick={() => addNode({ title: '新想法', kind: 'idea' })}><Plus size={14} />添加节点</button>
            </div>
          )}
          {libraryOpen && (
            <PaperLibrary papers={papers} nodes={nodes} onAdd={(paper) => addPaperNode(paper)} onClose={() => setLibraryOpen(false)} />
          )}
        </div>
        <aside className="pd-map-right">
          <div className="pd-right-tabs">
            <button type="button" className={`pd-right-tab ${tab === 'chat' ? 'is-active' : ''}`} onClick={() => setTab('chat')}><MessageSquare size={14} />对话</button>
            <button type="button" className={`pd-right-tab ${tab === 'node' ? 'is-active' : ''}`} onClick={() => setTab('node')}><GripVertical size={14} />节点{selectedNode && <span className="pd-map-tab-dot" />}</button>
            <div className="pd-right-tabs-spacer" />
            {selectedNode && <button type="button" className="pd-text-btn pd-map-chat-node-btn" onClick={() => setTab('node')}><ChevronRight size={13} />编辑</button>}
          </div>
          <div className="pd-map-right-content">
            {tab === 'chat' && (
              <MapChatPane
                chat={chat}
                nodes={nodes}
                selectedNode={quoteSuppressed ? null : selectedNode}
                type={mapType}
                onSend={sendChat}
                onClear={clearMapChat}
              />
            )}
            {tab === 'node' && (selectedNode ? (
              <NodeInspector
                node={selectedNode}
                papers={papers}
                nodes={nodes}
                edges={edges}
                onChange={patchNode}
                onDelete={deleteNode}
                onSelectNode={(id) => { setSelectedId(id); setQuoteSuppressed(false); }}
                onOpenPaper={(paperId) => onOpenReader?.(paperId, 'chat')}
              />
            ) : (
              <div className="pd-map-no-selection">
                <div className="pd-empty-icon"><GripVertical size={24} /></div>
                <strong>选择一个节点</strong>
                <span>单击节点查看详情，双击直接进入编辑。右侧对话会带上选中节点的内容。</span>
                <button type="button" className="pd-btn pd-btn-secondary pd-btn-sm" onClick={() => addNode({ title: '新想法', kind: 'idea' })}><Plus size={14} />新建节点</button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function MindMapPage(props) {
  return (
    <ReactFlowProvider>
      <MindMapInner {...props} />
    </ReactFlowProvider>
  );
}

export default MindMapPage;

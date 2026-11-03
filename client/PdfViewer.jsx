import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Highlighter,
  Languages,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react';
import { openPdfDocument, pdfjsLib } from './pdf';
import { formatBytes } from './api';

const COLORS = [
  { id: 'yellow', label: '琥珀', css: 'rgba(250, 204, 21, .34)' },
  { id: 'green', label: '青绿', css: 'rgba(52, 211, 153, .3)' },
  { id: 'blue', label: '天青', css: 'rgba(96, 165, 250, .32)' },
  { id: 'pink', label: '绯粉', css: 'rgba(244, 114, 182, .3)' },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function selectionFromPage(pageEl, pageNumber) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!pageEl.contains(range.commonAncestorContainer)) return null;
  const text = String(selection.toString() || '').replace(/\s+\n/g, '\n').trim();
  if (!text) return null;
  const bounds = pageEl.getBoundingClientRect();
  const rects = [];
  for (const rect of range.getClientRects()) {
    if (rect.width < 2 || rect.height < 2) continue;
    const left = clamp(rect.left, bounds.left, bounds.right);
    const top = clamp(rect.top, bounds.top, bounds.bottom);
    const right = clamp(rect.right, bounds.left, bounds.right);
    const bottom = clamp(rect.bottom, bounds.top, bounds.bottom);
    if (right - left < 2 || bottom - top < 2) continue;
    rects.push({
      x: (left - bounds.left) / bounds.width,
      y: (top - bounds.top) / bounds.height,
      w: (right - left) / bounds.width,
      h: (bottom - top) / bounds.height,
    });
  }
  if (rects.length === 0) return null;
  const screen = range.getBoundingClientRect();
  return {
    page: pageNumber,
    text: text.slice(0, 6000),
    rects,
    screenRect: { left: screen.left, top: screen.top, right: screen.right, bottom: screen.bottom, width: screen.width, height: screen.height },
  };
}

function PdfPage({ doc, pageNumber, pageInfo, scale, annotations, activeAnnotationId, scrollRoot, onSelection, onHighlightClick }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { root: scrollRoot?.current || null, rootMargin: '1100px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!visible || !doc) return undefined;
    let cancelled = false;
    let renderTask = null;
    let textTask = null;
    setFailed(false);
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const host = hostRef.current;
        const textLayer = textRef.current;
        if (!canvas || !host || !textLayer) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext('2d', { alpha: false });
        context.save();
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
        if (cancelled) return;
        setRendered(true);
        textLayer.innerHTML = '';
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        textLayer.style.setProperty('--scale-factor', String(viewport.scale));
        const content = await page.getTextContent();
        textTask = pdfjsLib.renderTextLayer({
          textContentSource: content,
          container: textLayer,
          viewport,
          textDivs: [],
        });
        await textTask.promise;
      } catch (error) {
        if (!cancelled && error?.name !== 'RenderingCancelledException') setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch { /* ignore */ }
      try { textTask?.cancel(); } catch { /* ignore */ }
    };
  }, [doc, pageNumber, scale, visible]);

  const width = pageInfo.width * scale;
  const height = pageInfo.height * scale;
  const highlights = annotations.filter((annotation) => annotation.page === pageNumber);

  return (
    <div
      className="pd-pdf-page"
      ref={hostRef}
      data-page={pageNumber}
      style={{ width, height, '--scale-factor': scale }}
      onMouseUp={() => {
        window.setTimeout(() => {
          const payload = selectionFromPage(hostRef.current, pageNumber);
          if (payload) onSelection(payload);
        }, 0);
      }}
    >
      <canvas ref={canvasRef} className="pd-pdf-canvas" />
      {!rendered && (
        <div className="pd-pdf-page-skeleton" style={{ aspectRatio: `${pageInfo.width} / ${pageInfo.height}` }}>
          {failed ? '这一页渲染失败' : <Loader2 size={18} className="pd-spin" />}
        </div>
      )}
      <div ref={textRef} className="textLayer pd-textLayer" />
      <div className="pd-highlight-layer">
        {highlights.map((annotation) => (
          <React.Fragment key={annotation.id}>
            {(annotation.rects || []).map((rect, index) => (
              <button
                type="button"
                key={`${annotation.id}-${index}`}
                className={`pd-highlight ${activeAnnotationId === annotation.id ? 'is-active' : ''}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  background: COLORS.find((c) => c.id === annotation.color)?.css || COLORS[0].css,
                }}
                title={annotation.note || annotation.text || '高亮'}
                onClick={(event) => {
                  event.stopPropagation();
                  onHighlightClick(annotation);
                }}
                aria-label={`打开第 ${pageNumber} 页的高亮`}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      <span className="pd-page-number-chip">{pageNumber}</span>
    </div>
  );
}

export const PdfViewer = forwardRef(function PdfViewer({
  data,
  paper,
  annotations,
  activeAnnotationId,
  onPageChange,
  onDocumentInfo,
  onTextExtracted,
  onMetadata,
  onCreateAnnotation,
  onAskAI,
  onTranslate,
  onInsertNote,
  onHighlightClick,
}, ref) {
  const scrollRef = useRef(null);
  const pagesRef = useRef([]);
  const [docState, setDocState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [containerWidth, setContainerWidth] = useState(900);
  const [scaleMode, setScaleMode] = useState('fit');
  const [zoom, setZoom] = useState(1.3);
  const [currentPage, setCurrentPage] = useState(1);
  const [selection, setSelection] = useState(null);
  const [translation, setTranslation] = useState(null);
  const [toolbarColor, setToolbarColor] = useState(() => {
    try { return localStorage.getItem('paper-desk.highlight') || 'yellow'; } catch { return 'yellow'; }
  });
  const [copied, setCopied] = useState(false);
  const callbacksRef = useRef({ onPageChange, onDocumentInfo, onTextExtracted, onMetadata });
  callbacksRef.current = { onPageChange, onDocumentInfo, onTextExtracted, onMetadata };

  useEffect(() => {
    let cancelled = false;
    let opened = null;
    setLoading(true);
    setError('');
    setDocState(null);
    setSelection(null);
    setTranslation(null);
    (async () => {
      try {
        opened = await openPdfDocument(data);
        if (cancelled) {
          await opened.doc.destroy().catch(() => {});
          try { opened.worker?.destroy(); } catch { /* ignore */ }
          return;
        }
        const numPages = opened.doc.numPages;
        const firstPage = await opened.doc.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const pages = Array.from({ length: numPages }, () => ({
          width: firstViewport.width,
          height: firstViewport.height,
        }));
        if (cancelled) return;
        // Show page 1 immediately with a sensible default size for the rest;
        // real page boxes are filled in concurrently below.
        setDocState({ doc: opened.doc, numPages, pages });
        setLoading(false);
        callbacksRef.current.onDocumentInfo?.({ pageCount: numPages });

        const contentPromise = firstPage.getTextContent().catch(() => ({ items: [] }));
        const metadataPromise = opened.doc.getMetadata().then((m) => m?.info || {}).catch(() => ({}));
        const firstContent = await contentPromise;
        const firstText = (firstContent.items || []).map((item) => item.str || '').join(' ');
        const metadata = await metadataPromise;
        if (!cancelled) callbacksRef.current.onMetadata?.(metadata, firstText);

        // Resolve the remaining page boxes in the background, batching state
        // updates so a 100-page PDF does not trigger 100 React renders.
        const pagesArray = pages.map((page) => ({ ...page }));
        let nextPage = 1;
        let resolved = 0;
        let flushFrame = 0;
        const flushPageBoxes = () => {
          if (cancelled) return;
          flushFrame = 0;
          setDocState((previous) => previous ? { ...previous, pages: pagesArray.slice() } : previous);
        };
        const scheduleFlush = () => {
          if (flushFrame) return;
          flushFrame = requestAnimationFrame(flushPageBoxes);
        };
        const resolvePageBoxes = async () => {
          while (!cancelled) {
            const index = nextPage;
            nextPage += 1;
            if (index >= numPages) return;
            try {
              const page = await opened.doc.getPage(index + 1);
              const viewport = page.getViewport({ scale: 1 });
              pagesArray[index] = { width: viewport.width, height: viewport.height };
              resolved += 1;
              if (resolved % 3 === 0) scheduleFlush();
            } catch { /* a page box is best-effort */ }
          }
        };
        void Promise.all(Array.from({ length: Math.min(6, Math.max(1, numPages - 1)) }, resolvePageBoxes))
          .then(() => { if (!cancelled) flushPageBoxes(); });

        const needsText = Boolean(callbacksRef.current.onTextExtracted);
        if (needsText) {
          // Let page 1 paint before competing for the worker with a full-text
          // extraction pass over every page.
          await new Promise((resolve) => setTimeout(resolve, 750));
          if (cancelled) return;
          let fullText = '';
          for (let i = 1; i <= numPages; i += 1) {
            if (cancelled) return;
            const page = await opened.doc.getPage(i);
            const content = await page.getTextContent();
            let pageText = '';
            let lastY = null;
            for (const item of content.items || []) {
              const str = item?.str;
              if (typeof str !== 'string' || !str) continue;
              const y = Array.isArray(item.transform) ? item.transform[5] : null;
              if (lastY !== null && y !== null && Math.abs(y - lastY) > 2.5 && !pageText.endsWith('\n')) pageText += '\n';
              else if (pageText && !pageText.endsWith(' ') && !pageText.endsWith('\n') && !str.startsWith(' ')) pageText += ' ';
              pageText += str;
              if (item.hasEOL) pageText += '\n';
              if (y !== null) lastY = y;
            }
            fullText += `\n=== Page ${i} ===\n${pageText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
            if (fullText.length > 3_800_000) break;
            if (i % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
          }
          if (!cancelled) callbacksRef.current.onTextExtracted(fullText.trim());
        }
      } catch (reason) {
        if (!cancelled) {
          setLoading(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (opened) {
        opened.doc.destroy().catch(() => {});
        try { opened.worker.destroy(); } catch { /* ignore */ }
      }
    };
  }, [data]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || node.clientWidth;
      if (width > 0) setContainerWidth(width);
    });
    observer.observe(node);
    setContainerWidth(node.clientWidth || 900);
    return () => observer.disconnect();
  }, [loading]);

  const scaleFor = useCallback((pageInfo) => {
    if (!pageInfo) return 1;
    if (scaleMode === 'fit') return clamp((containerWidth - 72) / pageInfo.width, 0.35, 2.6);
    return clamp(zoom, 0.35, 4);
  }, [containerWidth, scaleMode, zoom]);

  const currentScale = docState?.pages?.[currentPage - 1] ? scaleFor(docState.pages[currentPage - 1]) : scaleMode === 'fit' ? 1 : zoom;

  const updateCurrentPage = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top + 90;
    let page = 1;
    for (let i = 0; i < pagesRef.current.length; i += 1) {
      const node = pagesRef.current[i];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (rect.top <= top) page = i + 1;
      else break;
    }
    setCurrentPage((previous) => {
      if (previous !== page) {
        callbacksRef.current.onPageChange?.(page);
        return page;
      }
      return previous;
    });
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateCurrentPage();
        if (selection) setSelection(null);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [selection, updateCurrentPage]);

  const goToPage = useCallback((pageNumber) => {
    const index = clamp(Number(pageNumber) || 1, 1, docState?.numPages || 1) - 1;
    const node = pagesRef.current[index];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentPage(index + 1);
      callbacksRef.current.onPageChange?.(index + 1);
    }
  }, [docState?.numPages]);

  useImperativeHandle(ref, () => ({
    goToPage,
    getCurrentPage: () => currentPage,
  }), [goToPage, currentPage]);

  const zoomIn = () => {
    setScaleMode('zoom');
    setZoom((value) => clamp(value + 0.15, 0.5, 4));
  };
  const zoomOut = () => {
    setScaleMode('zoom');
    setZoom((value) => clamp(value - 0.15, 0.5, 4));
  };
  const fit = () => setScaleMode('fit');

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setTranslation(null);
  };

  const chooseColor = (id) => {
    setToolbarColor(id);
    try { localStorage.setItem('paper-desk.highlight', id); } catch { /* ignore */ }
  };

  const addHighlight = (focusNote = false) => {
    if (!selection) return;
    const annotation = {
      id: `ann-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      page: selection.page,
      color: toolbarColor,
      rects: selection.rects,
      text: selection.text,
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      focusNote,
    };
    onCreateAnnotation(annotation);
    clearSelection();
  };

  const askAI = () => {
    if (!selection) return;
    const payload = { page: selection.page, text: selection.text };
    onCreateAnnotation({
      id: `ann-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      page: selection.page,
      color: toolbarColor,
      rects: selection.rects,
      text: selection.text,
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    onAskAI(payload);
    clearSelection();
  };

  const translateSelection = async () => {
    if (!selection) return;
    const source = selection.text;
    setTranslation({ loading: true, text: '', error: '', source, page: selection.page });
    try {
      const result = await onTranslate(source, selection.page);
      setTranslation({ loading: false, text: result || '', error: '', source, page: selection.page });
    } catch (reason) {
      setTranslation({ loading: false, text: '', error: reason instanceof Error ? reason.message : String(reason), source, page: selection.page });
    }
  };

  const copyTranslation = async () => {
    if (!translation?.text) return;
    try {
      await navigator.clipboard.writeText(translation.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  const toolbarStyle = useMemo(() => {
    if (!selection) return null;
    const rect = selection.screenRect;
    const width = 392;
    const left = clamp(rect.left + rect.width / 2 - width / 2, 12, Math.max(12, window.innerWidth - width - 12));
    const below = rect.top < 96;
    const top = below ? rect.bottom + 12 : rect.top - 58;
    return { left, top: Math.max(8, top), width };
  }, [selection]);

  const pageInfo = docState?.pages?.[currentPage - 1];

  return (
    <div className="pd-pdf">
      <div className="pd-pdf-toolbar">
        <div className="pd-pdf-toolbar-group">
          <button type="button" className="pd-icon-btn" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} title="上一页">
            <ChevronLeft size={16} />
          </button>
          <div className="pd-page-indicator" aria-label="页码">
            <input
              value={currentPage}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next >= 1) setCurrentPage(next);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') goToPage(currentPage);
              }}
              inputMode="numeric"
              aria-label="跳转到页"
            />
            <span>/ {docState?.numPages || '—'}</span>
          </div>
          <button type="button" className="pd-icon-btn" onClick={() => goToPage(currentPage + 1)} disabled={!docState || currentPage >= docState.numPages} title="下一页">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="pd-pdf-toolbar-group">
          <button type="button" className="pd-icon-btn" onClick={zoomOut} title="缩小"><Minus size={16} /></button>
          <span className="pd-zoom-value">{Math.round(currentScale * 100)}%</span>
          <button type="button" className="pd-icon-btn" onClick={zoomIn} title="放大"><Plus size={16} /></button>
          <button type="button" className={`pd-icon-btn ${scaleMode === 'fit' ? 'is-active' : ''}`} onClick={fit} title="适应宽度"><Maximize2 size={15} /></button>
        </div>
        <div className="pd-pdf-toolbar-meta">
          <span>{paper?.pdfBytes ? formatBytes(paper.pdfBytes) : ''}</span>
          {!paper?.hasText && <span className="pd-index-hint">准备文本索引…</span>}
        </div>
      </div>

      <div
        className="pd-pdf-scroll"
        ref={scrollRef}
        onMouseDown={(event) => {
          if (event.target.closest('.pd-selection-toolbar') || event.target.closest('.pd-translation-card')) return;
          if (selection) setSelection(null);
        }}
      >
        {loading && (
          <div className="pd-pdf-loading">
            <div className="pd-pdf-loading-orb"><Loader2 size={22} className="pd-spin" /></div>
            <strong>正在打开论文</strong>
            <span>加载 PDF 页面与文本层…</span>
          </div>
        )}
        {error && (
          <div className="pd-empty pd-empty-error">
            <strong>PDF 打开失败</strong>
            <span>{error}</span>
          </div>
        )}
        {docState && (
          <div className="pd-pdf-pages" style={{ paddingTop: 20 }}>
            {docState.pages.map((info, index) => (
              <div className="pd-pdf-page-slot" key={index} ref={(node) => { pagesRef.current[index] = node; }}>
                <PdfPage
                  doc={docState.doc}
                  pageNumber={index + 1}
                  pageInfo={info}
                  scale={scaleFor(info)}
                  annotations={annotations}
                  activeAnnotationId={activeAnnotationId}
                  scrollRoot={scrollRef}
                  onSelection={setSelection}
                  onHighlightClick={onHighlightClick}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {selection && toolbarStyle && (
        <div className="pd-selection-toolbar" style={toolbarStyle} onMouseDown={(event) => event.preventDefault()}>
          <div className="pd-selection-colors" aria-label="高亮颜色">
            {COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`pd-color-dot ${toolbarColor === color.id ? 'is-active' : ''}`}
                style={{ background: color.css }}
                onClick={() => chooseColor(color.id)}
                title={color.label}
                aria-label={color.label}
              />
            ))}
          </div>
          <span className="pd-selection-divider" />
          <button type="button" className="pd-selection-action" onClick={() => addHighlight(false)}>
            <Highlighter size={15} /><span>高亮</span>
          </button>
          <button type="button" className="pd-selection-action" onClick={() => addHighlight(true)}>
            <StickyNote size={15} /><span>笔记</span>
          </button>
          <button type="button" className="pd-selection-action" onClick={askAI}>
            <MessageSquare size={15} /><span>问 AI</span>
          </button>
          <button type="button" className="pd-selection-action" onClick={translateSelection}>
            <Languages size={15} /><span>翻译</span>
          </button>
        </div>
      )}

      {translation && (
        <div
          className="pd-translation-card"
          style={{
            left: toolbarStyle?.left ?? 24,
            top: (toolbarStyle?.top ?? 120) + 54,
            width: toolbarStyle?.width ?? 392,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="pd-translation-head">
            <span><Sparkles size={14} /> DeepSeek 翻译</span>
            <button type="button" className="pd-icon-btn" onClick={() => setTranslation(null)}><X size={14} /></button>
          </div>
          {translation.loading && (
            <div className="pd-translation-loading"><Loader2 size={15} className="pd-spin" /> 正在翻译第 {translation.page} 页的这段内容…</div>
          )}
          {translation.error && <div className="pd-translation-error">{translation.error}</div>}
          {!translation.loading && translation.text && (
            <>
              <p className="pd-translation-text">{translation.text}</p>
              <div className="pd-translation-actions">
                <button type="button" className="pd-text-btn" onClick={copyTranslation}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button>
                <button type="button" className="pd-text-btn" onClick={() => onInsertNote?.(translation)}><StickyNote size={14} />存入笔记</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

export { COLORS };

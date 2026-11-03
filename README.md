# Paper Desk · 论文工作台

A Zotero-shaped paper desk for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
It adds a **Papers** entry to the DSH sidebar and a three-pane reader to the
main panel: the normal DSH sidebar on the left, the PDF in the middle, and a
DeepSeek co-reading chat / Markdown notebook on the right.

> 本项目也适合中文用户：界面、AI 精读笔记和共读对话默认使用中文。

## Features

- **Projects** — create a project such as *Scaling inference for SBI*. Each
  project keeps its papers, tags, annotations, chats and notes together.
- **Drop PDFs in** — uploads, parses, and files PDFs into a Zotero-style folder
  (`Author et al. - Year - Title`). Title, authors and year are read from the
  PDF metadata and first page.
- **Double-click to read** — click the Read button, or double-click any
  non-interactive part of a paper row.
- **Zotero-shaped paper rows** — expand a paper to see `paper.pdf`, `notes.md`
  and any appendix or supplementary files. Extra files are stored verbatim and
  never parsed.
- **PDF reading** — PDF.js viewer with fit-width/zoom, page navigation,
  selectable text, four highlight colours, paragraph-anchored notes,
  one-click selection translation, and “ask AI” with the selected passage.
- **Math-aware Markdown** — `$...$`, `$$...$$`, `\(...\)` and `\[...\]` render
  in notes and chat using KaTeX's HTML layout with embedded KaTeX fonts.
  Code spans and currency are left alone.
- **AI deep-read note** — on first open DeepSeek writes a structured Markdown
  note: TL;DR, core problem, prior work pros/cons, how this paper fixes the
  cons, motivation + key idea + example, how to read the experiments,
  strengths, limitations and future work. The note is a normal Markdown file
  you edit in the right pane, with preview, autosave and “AI rewrite”.
- **Co-reading chat** — a dedicated DeepSeek conversation per paper. It receives
  the paper text, generated note, highlights and the quoted passage, so
  follow-up questions have context. The conversation is persisted.
- **Tags and search** — Zotero-style tag chips; filter by one or more tags and
  search titles, authors, tags and note excerpts.
- **Your data is plain files** — no database, no lock-in.

```text
paper-desk/
  projects/
    scaling-inference-for-sbi/
      project.json
      papers/
        kuhmichel-et-al-2026-high-dimensional-simulation-based-inference/
          paper.pdf
          paper.txt          # extracted text (AI context)
          notes.md           # Markdown notebook
          annotations.json   # highlights + paragraph notes
          chat.json          # co-reading conversation
          attachments/       # appendix, supplementary material, ...
```

## Requirements

- DeepSeek Harness **0.2.x** with the Web GUI and a DeepSeek provider.
- A modern Chromium-based Web renderer (the DSH Desktop app is supported).
- Node.js **22+** for development builds.

Paper Desk uses the active DSH profile's provider/model. It does not ask for a
separate API key. When provider/model are not configured explicitly it selects
the first DeepSeek Flash/Chat route available in the profile.

## Install from GitHub

In DSH, open **Settings → Plugins**, install the bundle from GitHub
(`fexas/dsh-paper-desk`), and enable it. Restart DSH if the host asks for a
restart after installing a new package.

If your DSH version exposes the plugin command directly, the equivalent local
checkout flow is:

```bash
git clone https://github.com/fexas/dsh-paper-desk.git
cd dsh-paper-desk
npm ci
npm run build
```

Then add this directory as a `file:` dependency of the active DSH profile and
select `dsh-paper-desk` in that profile's bundle list (see the
[DSH plugin documentation](https://github.com/deepseek-ai/deepseek-harness)).
The host half has no build step; `client.js` is the pre-built browser half.

## Data location

The default data directory depends on how the plugin is installed:

| Install | Default `projects/` location |
|---|---|
| Linked local checkout | `<plugin-root>/projects/` |
| Managed plugin (under `node_modules`) | `$DSH_HOME/paper-desk/projects/` (usually `~/.dsh/paper-desk/projects/`) |

Override it in the plugin row:

```yaml
- id: dsh-paper-desk
  name: dsh-paper-desk
  config:
    provider: deepseek-account
    model: deepseek-flash
    # dataDir: /absolute/path/to/paper-desk-projects
```

The data directory contains `project.json` plus one folder per paper. Deleting
a project or paper moves it to `projects/.trash/` rather than destroying it.
PDFs, text, notes, annotations and chat history are local files; nothing is
sent anywhere except the model requests made by DeepSeek.

## How it works

```
browser (client.js)                         host (host/service.js)
──────────────────                         ───────────────────────
React slot UI                              Typert Remote `paperDesk`
PDF.js viewer + KaTeX                      projects/, uploads, files
highlight / note state          <──RPC──>  annotations.json, notes.md
DeepSeek chat + note UI                    chat.json, paper.txt
                                           DeepSeek call via ctx.llm
```

- `client.js` is a single browser module built from `client/` with esbuild.
  PDF.js and KaTeX fonts are bundled, so no CDN or extra asset route is needed.
- The host exposes a small `paperDesk` Remote namespace. The browser never gets
  direct filesystem access.
- Every paper is a directory with human-readable JSON/Markdown files; the UI can
  be removed without losing the research library.

## Performance notes

The reader shell opens as soon as the paper record arrives. PDF bytes are read
in eight parallel range requests, page 1 renders before the remaining page
boxes and text layer are resolved, and recently opened PDFs stay in a small
in-memory LRU cache. PDF.js runs its worker bundle on the page thread, which
avoids a Chromium/Electron worker handshake failure that can otherwise hang the
viewer. AI note generation runs alongside PDF loading; a compact progress card
shows the live stage and disappears when the note is written.

## Development

```bash
npm ci
npm run build      # rebuild client.js
npm run check      # syntax-check host and built client
```

Source layout:

- `host/service.js` — projects, chunked uploads, annotations, notes, LLM calls
- `client/App.jsx` — project library, paper rows, reader shell, chat and notes
- `client/PdfViewer.jsx` — PDF.js canvas/text/highlight viewer
- `client/markdown.js` — Markdown + KaTeX formula rendering
- `client/styles.css` — DSH-token-based UI styles
- `build.mjs` — esbuild bundle, PDF.js worker embedding, inline KaTeX fonts

Pull requests are welcome. Please keep the UI on DSH theme tokens
(`--dsw-alias-*`) and do not add a separate app shell, CDN dependency or a
second filesystem root.

## Known limitations

- No OCR: image-only PDFs will not have selectable text or AI full-text context.
- The AI note is generated from extracted PDF text; complex multi-column or
  scanned layouts may lose structure.
- The co-reading chat is a focused paper assistant, not a general-purpose DSH
  agent with tool access.
- Data is local to one machine; there is no sync or multi-user layer.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Bundled third-party code includes PDF.js (Apache-2.0), KaTeX (MIT), marked,
DOMPurify and lucide.

# Changelog

## 1.2.0 — 2026-11-03

- Added a persistent per-project mind map built on React Flow + dagre.
- Added research and learning project types with different seeded templates.
- Research map: motivating example / problem, methods framework, motivation,
  superiority, evaluation, benchmarks and ablations.
- Learning map: foundations, core concepts, timeline, paper queue and recall.
- Added paper nodes with drag-and-drop from the project library, paper links on
  any node, backlinks and Markdown/KaTeX content in nodes.
- Added a three-pane map view: DSH sidebar, canvas, DeepSeek map chat / node
  inspector.
- Added map chat with whole-graph, paper-library and selected-node context.
- Existing projects default to the research template; the SBI project was seeded.
- Added generated and seeded map files to the project data folder.

## 1.1.0 — 2026-11-03

- Added project library, Zotero-style paper folders and tag filtering.
- Added PDF.js reader with highlights, paragraph notes, translation and AI quoting.
- Added DeepSeek-generated TL;DR / deep-read notes with live progress.
- Added per-paper co-reading chat with persisted context.
- Added MathML to KaTeX HTML formula rendering with embedded KaTeX fonts.
- Added double-click-to-read on paper rows.
- Improved PDF startup: parallel range reads, first-page-first rendering,
  worker packaging fix, in-memory LRU cache.
- Improved button contrast, dark-theme selection toolbar and primary controls.
- Added managed-install data directory at `$DSH_HOME/paper-desk/projects`.
- Added build CI, contribution guide and third-party notices.

## 1.0.0

Initial internal prototype.

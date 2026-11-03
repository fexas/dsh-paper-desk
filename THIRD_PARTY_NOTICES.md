Paper Desk is released under the MIT License. See LICENSE.

Third-party software bundled into `client.js`:

- pdfjs-dist 3.11.174 — Apache License 2.0
  https://github.com/mozilla/pdf.js
  The PDF.js worker is embedded as a string so the plugin stays a single
  browser module.
- KaTeX 0.16.22 — MIT
  https://katex.org
  KaTeX CSS and the woff2 font files are inlined so formulas render consistently
  without a CDN or a separate asset route.
- @xyflow/react (React Flow) 12.12.1 — MIT
  https://reactflow.dev
- @dagrejs/dagre 3.1.3 — MIT
  https://github.com/dagrejs/dagre
- marked — MIT
- DOMPurify — Apache-2.0 OR MPL-2.0
- lucide-react — ISC
- zod — MIT

React is provided by the DeepSeek Harness client runtime and is not bundled.

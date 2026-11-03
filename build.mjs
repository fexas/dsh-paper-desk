import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function inlineKatexCss() {
  const cssFile = require.resolve('katex/dist/katex.min.css');
  const fontDir = path.join(path.dirname(cssFile), 'fonts');
  const css = fs.readFileSync(cssFile, 'utf8');
  return css.replace(/@font-face\{[^}]*\}/g, (block) => {
    const family = /font-family:([^;]+);/.exec(block)?.[1];
    const style = /font-style:([^;]+);/.exec(block)?.[1] || 'normal';
    const weight = /font-weight:([^;]+);/.exec(block)?.[1] || '400';
    const file = /url\(fonts\/([^)]+\.woff2)\)/.exec(block)?.[1];
    if (!family || !file) return block;
    const data = fs.readFileSync(path.join(fontDir, file)).toString('base64');
    return `@font-face{font-family:${family};font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
  });
}

const katexPlugin = {
  name: 'paper-desk-katex-css',
  setup(build) {
    build.onResolve({ filter: /^virtual:katex-css$/ }, () => ({ path: 'katex-css', namespace: 'paper-desk-virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'paper-desk-virtual' }, () => ({
      contents: `export default ${JSON.stringify(inlineKatexCss())};`,
      loader: 'js',
    }));
  },
};

const root = process.cwd();
const rawWorker = {
  name: 'paper-desk-raw-worker',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: require.resolve(args.path.replace(/\?raw$/, '')),
      namespace: 'paper-desk-raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'paper-desk-raw' }, (args) => ({
      contents: fs.readFileSync(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(root, 'client/index.jsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120', 'safari16'],
  external: ['react', 'react/jsx-runtime'],
  loader: {
    '.css': 'text',
    '.woff2': 'dataurl',
    '.woff': 'dataurl',
    '.ttf': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [rawWorker, katexPlugin],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

const js = result.outputFiles[0]?.text;
if (!js) throw new Error('esbuild produced no JavaScript output');

const output = `/* dsh-paper-desk — browser bundle */
window.__ModuleLoader__.load({
  id: "dsh-paper-desk",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${js}
    return module.exports;
  }
});
`;

fs.writeFileSync(path.join(root, 'client.js'), output);
const kb = Math.round(Buffer.byteLength(output) / 1024);
console.log(`client.js written (${kb} KiB)`);

/**
 * 프로토타입 페이지 빌드.
 * 엔진을 브라우저용으로 번들링해 템플릿에 인라인한다 (외부 요청 없이 한 파일로 동작).
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('.', import.meta.url);
const out = new URL('dist/', root);
await mkdir(out, { recursive: true });

const bundled = await build({
  entryPoints: [new URL('../src/engine/index.ts', root).pathname],
  bundle: true,
  format: 'iife',
  globalName: 'FitEngine',
  target: 'es2022',
  minify: true,
  write: false,
});

const engine = bundled.outputFiles[0].text;
const app = await readFile(new URL('app.js', root), 'utf8');
const template = await readFile(new URL('index.template.html', root), 'utf8');

const page = template
  .replace('/*ENGINE_BUNDLE*/', () => engine)
  .replace('/*APP_SCRIPT*/', () => app);

const target = new URL('dist/index.html', root);
await writeFile(target, page);
console.log(`built ${target.pathname} — ${(page.length / 1024).toFixed(1)} KB`);

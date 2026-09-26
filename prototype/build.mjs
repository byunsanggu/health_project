/**
 * 프로토타입 페이지 빌드.
 * 엔진을 브라우저용으로 번들링해 템플릿에 인라인한다 (외부 요청 없이 한 파일로 동작).
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

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
const demo3d = await readFile(new URL('demo3d.js', root), 'utf8');
const equipmentArt = await readFile(new URL('equipmentArt.js', root), 'utf8');
const bodyMap = await readFile(new URL('bodyMap.js', root), 'utf8');
const demoClips = await readFile(new URL('demoClips.js', root), 'utf8');
const remote = await readFile(new URL('remote.js', root), 'utf8');
const gymSearch = await readFile(new URL('gymSearch.js', root), 'utf8');
const template = await readFile(new URL('index.template.html', root), 'utf8');

const page = template
  .replace('/*ENGINE_BUNDLE*/', () => engine)
  .replace('/*EQUIPMENT_ART*/', () => equipmentArt)
  .replace('/*BODY_MAP*/', () => bodyMap)
  .replace('/*DEMO_CLIPS*/', () => demoClips)
  .replace('/*REMOTE_SCRIPT*/', () => remote)
  .replace('/*GYM_SEARCH_SCRIPT*/', () => gymSearch)
  .replace('/*DEMO3D_SCRIPT*/', () => demo3d)
  .replace('/*APP_SCRIPT*/', () => app);

const target = new URL('dist/index.html', root);
await writeFile(target, page);

/*
 * PWA 부속 파일.
 *
 * 한 장짜리 HTML은 아티팩트용이고, 실제로 설치되는 앱은 이 파일들이 같이
 * 있어야 한다. 서비스 워커는 인라인할 수 없다 — 자기 URL의 스코프를 가져야
 * 하기 때문이다.
 */
const ASSETS = [
  'manifest.webmanifest',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable.png',
  'apple-touch-icon.png',
];
for (const name of ASSETS) {
  await copyFile(new URL(name, root), new URL(`dist/${name}`, root));
}

console.log(`built ${target.pathname} — ${(page.length / 1024).toFixed(1)} KB`);
console.log(`       + PWA 부속 ${ASSETS.length}개 (manifest · sw · 아이콘)`);

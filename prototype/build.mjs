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

/*
 * 서버 접속 정보를 빌드에 박아 넣는다.
 *
 * 없으면 그냥 비워 둔다 — 로컬에서 빌드할 때마다 비밀값을 챙길 필요는 없고,
 * 그때는 예전처럼 사용자가 앱에서 직접 넣는 길이 열린다.
 *
 * publishable(anon) 열쇠는 공개를 전제로 설계된 값이라 브라우저에 박아도
 * 된다. 남의 기록은 이 열쇠가 아니라 DB의 RLS 정책이 막는다.
 *
 * 하지만 **secret 열쇠는 절대 아니다.** 그건 정책을 전부 무시하므로 페이지에
 * 박히는 순간 아무나 남의 건강 기록을 읽을 수 있게 된다. 사람은 두 값을
 * 헷갈리고, 그 실수는 되돌릴 수 없다(한 번 공개된 열쇠는 공개된 것이다).
 * 그래서 빌드를 통과시키지 않는다.
 */
const serverUrl = (process.env.SUPABASE_URL ?? '').trim();
const serverKey = (process.env.SUPABASE_ANON_KEY ?? '').trim();

if (serverKey) {
  const isJwt = serverKey.split('.').length === 3;
  const claims = isJwt
    ? Buffer.from(serverKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    : '';
  if (/^sb_secret_/.test(serverKey) || (isJwt && claims.includes('service_role'))) {
    throw new Error(
      'SUPABASE_ANON_KEY가 secret / service_role 열쇠입니다. ' +
      '이 열쇠는 보안 정책을 전부 무시하므로 페이지에 박으면 안 됩니다 — ' +
      'anon / publishable 열쇠를 쓰세요.');
  }
  if (!isJwt && !/^sb_publishable_/.test(serverKey)) {
    throw new Error('SUPABASE_ANON_KEY가 열쇠 모양이 아닙니다.');
  }
}

if (serverUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(serverUrl)) {
  throw new Error('SUPABASE_URL이 https://xxxx.supabase.co 모양이 아닙니다.');
}

const bakedServer = serverUrl && serverKey
  ? `<script>window.__VOLUME_COACH_SERVER__=${JSON.stringify({
      url: serverUrl.replace(/\/+$/, ''), anonKey: serverKey,
    })};</script>`
  : '';

const page = template
  .replace('/*ENGINE_BUNDLE*/', () => engine)
  .replace('/*EQUIPMENT_ART*/', () => equipmentArt)
  .replace('/*BODY_MAP*/', () => bodyMap)
  .replace('/*DEMO_CLIPS*/', () => demoClips)
  .replace('<!--BAKED_SERVER-->', () => bakedServer)
  .replace('/*REMOTE_SCRIPT*/', () => remote)
  .replace('/*GYM_SEARCH_SCRIPT*/', () => gymSearch)
  .replace('/*DEMO3D_SCRIPT*/', () => demo3d)
  .replace('/*APP_SCRIPT*/', () => app);

const target = new URL('dist/index.html', root);
await writeFile(target, page);

console.log(bakedServer
  ? `       + 서버 연결 박음 (${serverUrl})`
  : '       + 서버 연결 없음 — 앱에서 직접 넣는 길만 열립니다');

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

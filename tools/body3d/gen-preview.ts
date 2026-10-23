// 시안 페이지를 만든다 — 앱의 실제 스타일 · 지금 근육 그림 코드를 그대로 쓴다.
//   node tools/body3d/gen-preview.ts   → tools/body3d/out/preview.html (batch.mjs로 그린 그림을 쓴다)
import { readFileSync, writeFileSync } from 'node:fs';
import { EXERCISES } from '../../src/engine/exercises.ts';

const HERE = new URL('.', import.meta.url).pathname;
const tpl = readFileSync(new URL('../../prototype/index.template.html', import.meta.url), 'utf8');
const style = tpl.slice(tpl.indexOf('<style>') + 7, tpl.indexOf('</style>'));
const ART_FOR: Record<string, string> = { barbell: 'barbell-set', dumbbell: 'dumbbells', machine: 'chest-press-machine', cable: 'cable-station', smith: 'smith-machine', bodyweight: 'floor' };

const upperDay = [
  ['barbell-bench-press', '3세트 · 20kg · 4–6회'],
  ['pull-up', '3세트 · 맨몸 · 4–6회'],
  ['cable-fly', '2세트 · 5kg · 8–12회'],
  ['seated-dumbbell-press', '2세트 · 4kg · 8–12회'],
  ['lateral-raise', '3세트 · 2kg · 10–15회'],
  ['barbell-curl', '3세트 · 10kg · 10–15회'],
  ['triceps-pushdown', '3세트 · 15kg · 10–15회'],
];
const lowerDay = [
  ['back-squat', '3세트 · 40kg · 6–10회'],
  ['romanian-deadlift', '3세트 · 30kg · 8–12회'],
  ['leg-press', '3세트 · 80kg · 10–15회'],
];
const ex = (id: string) => EXERCISES.find((e) => e.id === id)!;
const data = Object.fromEntries([...upperDay, ...lowerDay].map(([id]) => [id, { name: ex(id).name, contribution: ex(id).contribution, art: ART_FOR[ex(id).equipment] }]));

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>근육 그림 시안</title>
<style>${style}
body { background: var(--ground); margin: 0; }
.pv { width: 390px; padding: 18px 16px 28px; box-sizing: border-box; display: grid; gap: 14px; font-family: inherit; background: var(--ground); }
#part-list, #part-detail { background: var(--ground); }
.pv h1 { font-size: 18px; margin: 0; }
.pv .lead { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.55; }
.pv h2 { font-size: 13px; margin: 6px 0 0; display: flex; gap: 6px; align-items: baseline; }
.pv h2 .tag { font-size: 10.5px; font-weight: 500; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.pv h2 .tag.new { border-color: var(--accent); color: var(--accent); }
.lift-thumb .thumb-3d { width: 46px; height: 46px; border-radius: 10px; object-fit: cover; }
.lift-thumb.three { background: linear-gradient(180deg, #f3f4f8, #e8eaf0); overflow: visible; }
@media (prefers-color-scheme: dark) { .lift-thumb.three { background: linear-gradient(180deg, #252a33, #1d2128); } }
.detail { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: end; }
.detail figure { margin: 0; text-align: center; }
.detail img { width: 100%; height: auto; display: block; }
.detail figcaption { font-size: 11px; color: var(--muted); margin-top: 2px; }
.legend { display: flex; gap: 14px; font-size: 12px; align-items: center; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 4px; margin-right: 5px; vertical-align: -2px; }
.cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cmp .cell { display: grid; justify-items: center; gap: 6px; padding: 10px 0; border: 1px solid var(--line-soft); border-radius: 12px; background: var(--surface); }
.cmp .cell span { font-size: 11px; color: var(--muted); }
.big-thumb { width: 92px; height: 92px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: var(--surface-2); border: 1px solid var(--line-soft); color: var(--accent); }
.big-thumb svg { width: 44px; height: 86px; }
.big-thumb img { width: 92px; height: 92px; border-radius: 16px; }
</style>
<script src="../../../prototype/bodyMap.js"></script>
<script src="../../../prototype/equipmentArt.js"></script>
</head><body>
<div class="pv">
  <div id="part-list" style="display:grid;gap:14px">
  <h1>근육 그림 — 시안</h1>
  <p class="lead">종목 목록의 몸 그림을 입체로 바꾼 모습입니다. 아직 앱에는 넣지 않았습니다. 근육은 엔진의 기여도대로 칠합니다 — 진한 색이 주로 쓰는 근육, 옅은 색이 같이 쓰는 근육입니다.</p>

  <h2>한 칸 크게 <span class="tag">지금</span> <span class="tag new">바꾸면</span></h2>
  <div class="cmp">
    <div class="cell"><div class="big-thumb" id="big-old"></div><span>지금 · 바벨 벤치프레스</span></div>
    <div class="cell"><div class="big-thumb"><img src="out/thumb-barbell-bench-press.png" alt=""></div><span>바꾸면 · 바벨 벤치프레스</span></div>
  </div>

  <h2>상체 날 목록 <span class="tag">지금</span></h2>
  <div class="sheet"><div class="sheet-body tight"><div class="summary-list" id="old-upper"></div></div></div>
  <h2>상체 날 목록 <span class="tag new">바꾸면</span></h2>
  <div class="sheet"><div class="sheet-body tight"><div class="summary-list" id="new-upper"></div></div></div>
  <h2>하체 날 목록 <span class="tag new">바꾸면</span></h2>
  <div class="sheet"><div class="sheet-body tight"><div class="summary-list" id="new-lower"></div></div></div>

  </div>
  <div id="part-detail" style="display:grid;gap:14px">
  <h2>동작 시연 › 쓰는 근육 <span class="tag new">바꾸면</span></h2>
  <div class="sheet"><div class="sheet-body">
    <b style="font-size:13px">바벨 벤치프레스</b>
    <div class="detail">
      <figure><img src="out/detail-barbell-bench-press-front.png" alt=""><figcaption>앞</figcaption></figure>
      <figure><img src="out/detail-barbell-bench-press-back.png" alt=""><figcaption>뒤</figcaption></figure>
    </div>
    <div class="legend"><span><i style="background:#4c46d6"></i>가슴</span><span><i style="background:#a5a2ea"></i>전면 삼각근 · 삼두</span></div>
  </div></div>
  <div class="sheet"><div class="sheet-body">
    <b style="font-size:13px">루마니안 데드리프트</b>
    <div class="detail">
      <figure><img src="out/detail-romanian-deadlift-front.png" alt=""><figcaption>앞</figcaption></figure>
      <figure><img src="out/detail-romanian-deadlift-back.png" alt=""><figcaption>뒤</figcaption></figure>
    </div>
    <div class="legend"><span><i style="background:#4c46d6"></i>햄스트링 · 둔근</span><span><i style="background:#a5a2ea"></i>허리 · 전완</span></div>
  </div></div>
  </div>
</div>
<script>
var DARK = matchMedia('(prefers-color-scheme: dark)').matches;
var DIR = DARK ? 'dark/' : 'light/';
document.querySelectorAll('img[src^="out/"]').forEach(function (img) { img.src = img.getAttribute('src').replace('out/', DIR); });
var DATA = ${JSON.stringify(data)};
var UPPER = ${JSON.stringify(upperDay)};
var LOWER = ${JSON.stringify(lowerDay)};
function el(tag, cls, kids) { var n = document.createElement(tag); if (cls) n.className = cls; (kids || []).forEach(function (k) { if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); }); return n; }
function equip(id) { var svg = window.FitEquipmentArt && FitEquipmentArt.has(id) ? FitEquipmentArt.render(id, '') : null; if (svg) svg.setAttribute('class', 'thumb-equip'); return svg; }
function row(id, sets, mode) {
  var d = DATA[id];
  var box = el('span', 'lift-thumb' + (mode === 'new' ? ' three' : ''));
  if (mode === 'old') { var body = FitBodyMap.render(d.contribution, '', { side: 'auto' }); body.setAttribute('class', 'thumb-art thumb-body'); box.appendChild(body); }
  else { var img = document.createElement('img'); img.className = 'thumb-3d'; img.src = DIR + 'thumb-' + id + '.png'; box.appendChild(img); }
  var e = equip(d.art); if (e) box.appendChild(e);
  return el('div', 'plan-row', [box, el('span', 'plan-main', [el('span', 'name', [el('span', null, [d.name])]), el('span', 'plan-sets', [sets])]), el('button', 'row-menu', ['⋯'])]);
}
UPPER.forEach(function (r) { document.getElementById('old-upper').appendChild(row(r[0], r[1], 'old')); document.getElementById('new-upper').appendChild(row(r[0], r[1], 'new')); });
LOWER.forEach(function (r) { document.getElementById('new-lower').appendChild(row(r[0], r[1], 'new')); });
var big = FitBodyMap.render(DATA['barbell-bench-press'].contribution, '', { side: 'auto' }); document.getElementById('big-old').appendChild(big);
window.ready = true;
</script>
</body></html>`;
writeFileSync(HERE + 'out/preview.html', html);
console.log('ok', html.length);

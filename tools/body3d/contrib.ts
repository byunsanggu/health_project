import { EXERCISES } from '../../src/engine/exercises.ts';
import { MUSCLE_GROUPS } from '../../src/engine/muscles.ts';
const ids = process.argv.slice(2);
const out: Record<string, { name: string; w: number[]; pattern: string }> = {};
for (const id of ids) {
  const ex = EXERCISES.find((e) => e.id === id);
  if (!ex) { console.error('no', id); continue; }
  out[id] = { name: ex.name, w: MUSCLE_GROUPS.map((m) => ex.contribution[m] ?? 0), pattern: ex.pattern };
}
console.log(JSON.stringify(out));

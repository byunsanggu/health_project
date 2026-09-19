/**
 * 촬영 목록 만들기.
 *
 * 종목 83개를 무작정 찍으면 하루 만에 지친다. 그런데 실제로 처방되는
 * 빈도는 종목마다 크게 다르다 — 스쿼트는 거의 모든 사람에게 나오고,
 * 어떤 고립 종목은 특정 조건에서만 나온다.
 *
 * 그래서 추측하지 않고 엔진에 직접 물어본다. 현실적인 설정 조합을 전부
 * 돌려서 "이 종목이 몇 번이나 처방되는가"를 센다. 그 순서대로 찍으면
 * 20개만 찍어도 대부분의 사용자가 대부분의 날에 영상을 본다.
 *
 * 실행: node tools/shotList.ts > docs/촬영목록.md
 */
import {
  EXERCISES,
  GYM_PRESETS,
  TRAINING_LEVELS,
  presetEquipment,
  runOnboarding,
  demoFor,
  exerciseById,
} from '../src/engine/index.ts';
import type { Exercise, TrainingLevel } from '../src/engine/types.ts';
import type { TrainingGoal } from '../src/engine/goals.ts';

/* ── 1. 빈도 세기 ─────────────────────────────────── */

const GOAL_SETS: TrainingGoal[][] = [
  ['hypertrophy'],
  ['strength'],
  ['hypertrophy', 'strength'],
  ['hypertrophy', 'fatLoss'],
  ['general'],
];

/**
 * 현실적인 조합만 돌린다. 경력 4 × 일수 6 × 헬스장 6 × 목표 5 = 720판.
 * 홈짐까지 넣는 이유는 그쪽만 쓰는 종목이 뒤로 밀리는 걸 보기 위해서다.
 */
function prescriptionCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  let runs = 0;

  for (const level of TRAINING_LEVELS) {
    for (let days = 2; days <= 7; days += 1) {
      for (const preset of GYM_PRESETS) {
        for (const goals of GOAL_SETS) {
          const result = runOnboarding({
            selfReportedLevel: level as TrainingLevel,
            monthsTraining: 24,
            bodyweightKg: 75,
            daysPerWeek: days,
            goals,
            gym: { equipmentIds: presetEquipment(preset.id) },
          });
          runs += 1;
          for (const template of result.program.templates) {
            for (const slot of template.slots) {
              counts.set(slot.exerciseId, (counts.get(slot.exerciseId) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  process.stderr.write(`설정 ${runs}판을 돌려 셌습니다.\n`);
  return counts;
}

/* ── 2. 어느 각도로 찍는가 ───────────────────────── */

/**
 * 패턴마다 봐야 하는 것이 다르다.
 *
 * 힌지는 등 각도가 무너지는 게 문제라 옆에서 봐야 하고, 풀다운은 어깨가
 * 말리는 게 문제라 앞에서 봐야 한다. "일단 다 찍자"는 촬영 분량을 두 배로
 * 만들고 편집에서 무너진다.
 */
const ANGLE: Record<string, { view: string; why: string }> = {
  squat:         { view: '측면', why: '무릎과 고관절이 같이 접히는지, 상체 각도가 유지되는지' },
  hinge:         { view: '측면', why: '허리가 말리는 순간이 보여야 합니다. 이 패턴의 전부입니다' },
  lunge:         { view: '측면', why: '앞무릎이 발끝을 넘는지, 뒷무릎이 바닥에 닿는 깊이' },
  horizontalPush:{ view: '측면', why: '바가 내려오는 위치와 팔꿈치 각도' },
  verticalPush:  { view: '측면 + 정면', why: '측면은 바 궤적, 정면은 팔꿈치가 벌어지는 정도' },
  verticalPull:  { view: '정면', why: '그립 너비와 어깨가 말리는지. 측면으로는 안 보입니다' },
  horizontalPull:{ view: '측면', why: '당길 때 몸통이 같이 젖혀지는지' },
  isolation:     { view: '정면', why: '반동이 들어가는지. 고립 종목은 반동이 거의 전부입니다' },
  core:          { view: '측면', why: '허리가 뜨는지, 골반 각도' },
  carry:         { view: '정면', why: '좌우로 기우는지' },
};

function angleFor(exercise: Exercise) {
  return ANGLE[exercise.pattern] ?? { view: '측면', why: '동작 전체가 보이게' };
}

/* ── 3. 우선순위 ──────────────────────────────────── */

/**
 * 빈도만으로 줄을 세우면 컨센트레이션 컬이 백 스쿼트보다 위로 온다.
 * 실제로 처방 횟수는 그쪽이 많기 때문이다 — 덤벨만 있으면 되니 모든
 * 헬스장 조합에서 나온다.
 *
 * 그런데 영상이 급한 종목은 "자주 나오는 것"이 아니라 "모르면 다치는
 * 것"이다. 컬은 틀려도 무게를 못 들 뿐이지만, 힌지는 틀리면 허리가
 * 나간다.
 *
 * 둘을 한 점수로 섞으면 가중치를 어떻게 잡았는지 아무도 모르게 된다.
 * 그래서 등급으로 가른다 — 다치는 것 먼저, 그 안에서 자주 나오는 순서.
 */
function riskOf(exercise: Exercise): number {
  const values = Object.values(exercise.jointStress ?? {});
  return values.length > 0 ? Math.max(...values) : 0;
}

/** 이 선 위는 "틀리면 다치는" 종목이다. 17개 — 첫 촬영 한 번 분량이다. */
const RISKY = 0.7;

/* ── 4. 어느 자리에서 찍는가 ─────────────────────── */

/**
 * 촬영은 동선이 전부다. 랙에서 스쿼트 찍고 케이블 갔다가 다시 랙으로
 * 오면 삼각대를 세 번 다시 세운다. 같은 자리에서 찍을 것을 묶어 둔다.
 */
const STATION: Record<string, string> = {
  barbell: '랙 · 바벨',
  smith: '랙 · 바벨',
  dumbbell: '덤벨존',
  cable: '케이블',
  machine: '머신',
  bodyweight: '맨몸 · 철봉',
  band: '맨몸 · 철봉',
  kettlebell: '덤벨존',
};

function stationOf(exercise: Exercise): string {
  return STATION[exercise.equipment] ?? '기타';
}

/* ── 4. 목록 찍기 ─────────────────────────────────── */

function main(): void {
  const counts = prescriptionCounts();
  const scored = [...EXERCISES].map((exercise) => ({
    exercise,
    count: counts.get(exercise.id) ?? 0,
    risk: riskOf(exercise),
  }));
  const total = scored.reduce((sum, row) => sum + row.count, 0);

  const byFrequency = (a: typeof scored[number], b: typeof scored[number]) =>
    b.count - a.count || a.exercise.name.localeCompare(b.exercise.name);

  const tier1 = scored.filter((row) => row.risk >= RISKY).sort(byFrequency);
  const tier2 = scored.filter((row) => row.risk < RISKY).sort(byFrequency);
  const ranked = [...tier1, ...tier2];

  const out: string[] = [];
  out.push('# 촬영 목록');
  out.push('');
  out.push('엔진에 직접 물어서 만든 순서입니다. 추측이 아닙니다.');
  out.push('');
  out.push('설정 조합 720판을 전부 돌려 **종목별 처방 횟수**를 셌습니다. 다만 빈도만으로 줄을');
  out.push('세우면 컨센트레이션 컬이 백 스쿼트보다 위로 옵니다 — 덤벨만 있으면 되니 모든 헬스장');
  out.push('조합에서 나오기 때문입니다. 영상이 급한 건 *자주 나오는 것*이 아니라 **모르면 다치는**');
  out.push('것이라, **관절 부하 0.7 이상**을 먼저 놓고 그 안에서 빈도순으로 정렬했습니다.');
  out.push('');

  out.push('## 몇 개까지 찍으면 되나');
  out.push('');
  out.push('| 상위 | 덮는 비율 | 걸리는 시간(대략) |');
  out.push('| --- | --- | --- |');
  let running = 0;
  let index = 0;
  for (const mark of [tier1.length, 30, 50, ranked.length]) {
    while (index < mark) { running += ranked[index]!.count; index += 1; }
    const pct = Math.round((running / total) * 100);
    // 한 종목에 정상 1컷 + 실수 1컷, 세팅까지 6분으로 잡는다.
    const hours = Math.round((mark * 6) / 6) / 10;
    const note = mark === tier1.length ? ` (1단계 전부)` : '';
    out.push(`| ${mark}개${note} | ${pct}% | ${hours}시간 |`);
  }
  out.push('');
  out.push(`**1단계 ${tier1.length}개를 먼저 찍고 앱에 넣어 보세요.** 83개를 다 찍고 나서야 "화면에서`);
  out.push('작아서 안 보이네"를 알게 되면 전부 다시 찍어야 합니다. 나머지는 동작 애니메이션이');
  out.push('그대로 나오므로 빈 칸으로 보이지 않습니다.');
  out.push('');

  /* 스테이션별 묶음 — 동선이 촬영 시간을 좌우한다. */
  out.push('## 촬영 동선 (1단계)');
  out.push('');
  out.push('삼각대를 한 번 세우고 그 자리에서 찍을 것을 묶었습니다. 위에서부터 순서대로 도세요.');
  out.push('');
  const grouped = new Map<string, string[]>();
  for (const row of tier1) {
    const station = stationOf(row.exercise);
    if (!grouped.has(station)) grouped.set(station, []);
    grouped.get(station)!.push(row.exercise.name);
  }
  for (const [station, names] of grouped) {
    out.push(`**${station}** (${names.length}개) — ${names.join(' · ')}`);
    out.push('');
  }

  out.push('## 목록');
  out.push('');

  ranked.forEach((row, rank) => {
    const { exercise, count } = row;
    const angle = angleFor(exercise);
    const demo = demoFor(exercise);
    const share = ((count / total) * 100).toFixed(1);
    const tier = row.risk >= RISKY ? '1단계' : '2단계';
    const riskTag = row.risk >= 0.85 ? ' · **부상 위험 매우 높음**'
      : row.risk >= RISKY ? ' · **부상 위험 높음**' : '';

    out.push(`### ${rank + 1}. ${exercise.name}`);
    out.push('');
    out.push(`\`${exercise.id}\` · ${tier} · 처방 빈도 ${share}% · **${angle.view}** · ${stationOf(exercise)}${riskTag}`);
    out.push('');
    out.push(`- **왜 그 각도** — ${angle.why}`);
    if (demo.cues.length > 0) {
      out.push(`- **정상 컷에서 보여줄 것** — ${demo.cues.join(' / ')}`);
    }
    if (demo.mistakes.length > 0) {
      out.push(`- **실수 컷에서 일부러 할 것** — ${demo.mistakes.join(' / ')}`);
    }
    out.push('');
  });

  process.stdout.write(out.join('\n'));
}

// exerciseById를 쓰지 않는 경로가 생기면 import가 죽은 코드가 된다.
void exerciseById;

main();

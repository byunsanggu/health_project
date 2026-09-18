/* 볼륨 코치 프로토타입 — 저장소의 트레이닝 엔진(FitEngine)을 그대로 구동한다. */
(function () {
  'use strict';

  var E = window.FitEngine;
  var index = E.buildExerciseIndex();
  var landmarks = E.landmarksFor('intermediate');

  /** 온보딩 전 기본값 — 완료되면 생성된 프로그램으로 교체된다. */
  var DEFAULT_ANSWERS = {
    selfReportedLevel: 'intermediate',
    monthsTraining: 18,
    bodyweightKg: 78,
    sex: 'male',
    daysPerWeek: 4,
    goal: 'hypertrophy',
    gym: { equipmentIds: E.COMMON_EQUIPMENT_IDS.slice() },
  };

  /** 주당 일수별 훈련 요일 (월=0). */
  var WEEK_OFFSETS = {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
  };

  var START_WEIGHT = {
    'barbell-bench-press': 80, 'lat-pulldown': 65, 'seated-dumbbell-press': 22,
    'barbell-curl': 35, 'back-squat': 110, 'romanian-deadlift': 90,
    'leg-press': 160, 'standing-calf-raise': 80, 'chest-supported-row': 70,
    'incline-dumbbell-press': 26, 'lateral-raise': 10, 'triceps-pushdown': 35,
    'hip-thrust': 100, 'lying-leg-curl': 45, 'walking-lunge': 20, 'cable-crunch': 40,
    'machine-chest-press': 60, 'machine-shoulder-press': 35, 'landmine-press': 30,
    'neutral-grip-pulldown': 60, 'pec-deck': 45, 'cable-fly': 20, 'seated-cable-row': 65,
    'hack-squat': 100, 'goblet-squat': 26, 'back-extension': 10, 'leg-extension': 50,
    'reverse-pec-deck': 30, 'face-pull': 25, 'hammer-curl': 14, 'incline-dumbbell-curl': 12,
    'overhead-cable-extension': 25, 'push-up': 0, 'pull-up': 0, 'plank': 0,
    'hanging-leg-raise': 0, 'cable-lateral-raise': 7, 'conventional-deadlift': 130,
  };

  function trainingDays() {
    return WEEK_OFFSETS[state.program.daysPerWeek] || WEEK_OFFSETS[4];
  }

  /** 오늘은 이번 주의 마지막 훈련일이고, 그 앞 세션들은 이미 수행한 것으로 시드한다. */
  function todayIndex() {
    return trainingDays().length - 1;
  }

  var JOINTS = ['shoulder', 'lowBack', 'knee', 'elbow'];

  var SCENARIOS = [
    {
      id: 'normal',
      label: '정상 진행',
      note: '2주간 계획대로 훈련한 상태. 3주차 처방은 볼륨을 조금씩 올립니다.',
      decay: 0.25,
      pain: {},
      sleep: 7.2,
      soreness: 4,
    },
    {
      id: 'pain',
      label: '어깨 통증 발생',
      note: '어깨 통증 4점. 오늘 세션에서 어깨 부담이 큰 종목이 자동으로 대체됩니다.',
      decay: 0.35,
      pain: { shoulder: 4 },
      sleep: 6.8,
      soreness: 5,
    },
    {
      id: 'overreached',
      label: '과훈련 누적',
      note: '수행력 하락 · 수면 부족 · 통증 누적. 엔진이 디로드를 처방하는 상태입니다.',
      decay: 1.5,
      pain: { shoulder: 4, lowBack: 3 },
      sleep: 5.2,
      soreness: 8,
      heavy: true,
    },
  ];

  var WARNING_LABELS = { plan: '주간 처방', pain: '통증 게이트', equipment: '기구' };

  var TABS = [
    { id: 'today', label: '오늘', icon: 'M4 7h2v10H4zM18 7h2v10h-2zM7 10h10v4H7z' },
    { id: 'volume', label: '볼륨', icon: 'M4 19h16M6 16V9M11 16V5M16 16v-6' },
    { id: 'week', label: '주간', icon: 'M4 6h16M4 12h16M4 18h9' },
    { id: 'checkin', label: '체크인', icon: 'M5 12l4 4 10-10' },
    { id: 'gym', label: '헬스장', icon: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8' },
  ];

  var state = {
    gym: JSON.parse(JSON.stringify(E.DEFAULT_GYM)),
    lifter: { bodyweightKg: 78, level: 'intermediate', sex: 'male' },
    scenario: 'normal',
    tab: 'today',
    pain: JOINTS.map(function (joint) { return { joint: joint, score: 0 }; }),
    sleepHours: 7.2,
    soreness: 4,
    history: [],
    checkIns: [],
    plan: null,
    session: null,
    lifts: [],
    todaySets: [],
    log: [],
    monday: E.weekStart(todayISO()),
    todayDate: null,
    program: null,
    answers: null,
    onboarding: { active: true, step: 0 },
  };

  /* ── 시드 데이터 ───────────────────────────────── */

  function todayISO() {
    var now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** 계획된 세션을 "수행했다"고 가정하고 기록을 만든다. */
  function perform(planned, decay) {
    var sets = [];
    planned.exercises.forEach(function (item) {
      var fallback = START_WEIGHT[item.exercise.id] || 40;
      item.sets.forEach(function (set, order) {
        var drop = decay + order * 0.4;
        sets.push({
          exerciseId: item.exercise.id,
          weightKg: set.weightKg === null ? fallback : set.weightKg,
          reps: clamp(Math.round(set.targetReps.max - drop), 3, set.targetReps.max),
          rir: clamp(Math.round(set.targetRir - decay * 0.7), 0, 5),
        });
      });
    });
    return { date: planned.date, sets: sets };
  }

  /**
   * 지난 2주 전체 + 이번 주 앞 세 번의 훈련을 생성한다.
   * 오늘이 그 주의 네 번째 세션이라, 앱을 열면 볼륨 게이지가 실제로 쌓인 상태로 보인다.
   */
  function seedHistory(scenario) {
    var history = [];
    var checkIns = [];
    var pain = JOINTS
      .map(function (joint) { return { joint: joint, score: scenario.pain[joint] || 0 }; })
      .filter(function (report) { return report.score > 0; });

    for (var week = 0; week < 3; week += 1) {
      var monday = E.addDays(state.monday, (week - 2) * 7);
      var plan = week === 0
        ? coldStartPlan(monday)
        : E.planNextWeek({
            sessions: history,
            checkIns: checkIns,
            index: index,
            landmarks: landmarks,
            asOf: E.addDays(monday, -1),
            weekInBlock: week + 1,
            lastWeekPhase: 'accumulation',
          });

      // 이번 주(week 2)는 오늘 세션을 남겨둔다.
      var offsets = trainingDays();
      var days = week === 2 ? offsets.slice(0, -1) : offsets;

      days.forEach(function (offset, dayIndex) {
        var date = E.addDays(monday, offset);
        var template = state.program.templates[dayIndex % state.program.templates.length];
        var slots = scenario.heavy
          ? template.slots.map(function (slot) { return Object.assign({}, slot, { sets: slot.sets + 2 }); })
          : template.slots;
        var planned = E.buildSession({
          template: { name: template.name, slots: slots },
          date: date,
          plan: plan,
          history: history,
          index: index,
          pain: [],
          gym: state.gym,
          lifter: state.lifter,
        });
        history.push(perform(planned, scenario.decay * (week + 1)));
        checkIns.push({
          date: date,
          sleepHours: scenario.sleep,
          soreness: scenario.soreness,
          motivation: scenario.heavy ? 3 : 7,
          pain: pain,
        });
      });
    }
    return { history: history, checkIns: checkIns };
  }

  function coldStartPlan(monday) {
    return {
      weekStart: monday,
      phase: 'accumulation',
      weekInBlock: 1,
      targetRir: 3,
      intensityMultiplier: 1,
      fatigue: { score: 0, threshold: 5, deloadRecommended: false, signals: [] },
      volume: [],
      neglected: [],
      frequency: [],
      summary: '첫 주: 템플릿 그대로 수행하며 기준선을 잡습니다',
    };
  }

  /* ── 상태 계산 ─────────────────────────────────── */

  function activePain() {
    return state.pain.filter(function (report) { return report.score > 0; });
  }

  function painfulMuscles() {
    var muscles = [];
    state.session && state.session.exercises.forEach(function (item) {
      if (item.painRuling.action === 'allow') return;
      var muscle = E.primaryMuscle(item.exercise);
      if (muscle && muscles.indexOf(muscle) === -1) muscles.push(muscle);
    });
    return muscles;
  }

  /** 시나리오를 적용하고 오늘 세션까지 다시 만든다. */
  function loadScenario(id, silent) {
    var scenario = SCENARIOS.filter(function (s) { return s.id === id; })[0];
    state.scenario = id;
    state.pain = JOINTS.map(function (joint) {
      return { joint: joint, score: scenario.pain[joint] || 0 };
    });
    state.sleepHours = scenario.sleep;
    state.soreness = scenario.soreness;

    state.todayDate = E.addDays(state.monday, trainingDays()[todayIndex()]);
    var seeded = seedHistory(scenario);
    state.history = seeded.history;
    state.checkIns = seeded.checkIns;
    state.todaySets = [];
    if (!silent) state.log = [];

    rebuildPlan();
    rebuildSession();

    if (!silent) {
      pushLog('주간 처방', state.plan.phase === 'deload'
        ? '피로 점수 ' + state.plan.fatigue.score + '점 → <b>디로드</b> 처방. ' + state.plan.summary
        : '피로 점수 ' + state.plan.fatigue.score + '점 → <b>축적 ' + state.plan.weekInBlock + '주차</b>. 목표 RIR ' + state.plan.targetRir);
      state.session.warnings.forEach(function (warning) {
        pushLog(WARNING_LABELS[warning.kind] || '알림', warning.text);
      });
    }
  }

  function rebuildPlan() {
    state.plan = E.planNextWeek({
      sessions: state.history,
      checkIns: state.checkIns,
      index: index,
      landmarks: landmarks,
      asOf: E.addDays(state.monday, -1),
      weekInBlock: 2,
      lastWeekPhase: 'accumulation',
      painfulMuscles: painfulMuscles(),
    });
  }

  function rebuildSession() {
    // 통증이 바뀌어 세션을 다시 짜도, 이미 끝낸 세트까지 되돌리면 안 된다.
    var previous = {};
    state.lifts.forEach(function (lift) { previous[lift.exercise.id] = lift.sets; });

    state.session = E.buildSession({
      template: state.program.templates[todayIndex() % state.program.templates.length],
      date: state.todayDate,
      plan: state.plan,
      history: state.history,
      index: index,
      pain: activePain(),
      gym: state.gym,
      lifter: state.lifter,
    });

    state.lifts = state.session.exercises.map(function (item) {
      return {
        exercise: item.exercise,
        substitutedFrom: item.substitutedFrom,
        swapReason: item.swapReason,
        startingLoad: item.startingLoad,
        loading: item.loading,
        note: item.note,
        ruling: item.painRuling,
        repRange: item.sets[0].targetReps,
        targetRir: item.sets[0].targetRir,
        sets: item.sets.map(function (set, order) {
          var kept = (previous[item.exercise.id] || [])[order];
          if (kept && kept.done) return kept;
          return {
            weightKg: set.weightKg === null ? (START_WEIGHT[item.exercise.id] || 40) : set.weightKg,
            estimated: set.weightKg === null,
            targetReps: set.targetReps,
            targetRir: set.targetRir,
            reps: set.targetReps.max,
            rir: null,
            done: false,
            adjustment: null,
          };
        }),
      };
    });
  }

  /** 오늘 완료한 세트까지 포함한 이번 주 세션 목록. */
  function weekSessions() {
    var sunday = E.addDays(state.monday, 6);
    var sessions = state.history.filter(function (s) { return s.date >= state.monday && s.date <= sunday; });
    if (state.todaySets.length > 0) sessions = sessions.concat([{ date: state.todayDate, sets: state.todaySets }]);
    return sessions;
  }

  function pushLog(kind, body) {
    state.log.unshift({ kind: kind, body: body });
    if (state.log.length > 8) state.log.pop();
  }

  /* ── 세트 완료 ─────────────────────────────────── */

  function completeSet(liftIndex, setIndex, rir) {
    var lift = state.lifts[liftIndex];
    var set = lift.sets[setIndex];
    var rule = { repRange: lift.repRange, targetRir: lift.targetRir };

    set.rir = rir;
    set.done = true;

    var logged = {
      exerciseId: lift.exercise.id,
      weightKg: set.weightKg,
      reps: set.reps,
      rir: rir,
    };
    state.todaySets.push(logged);

    var next = lift.sets[setIndex + 1];
    if (next && !next.done) {
      var adjustment = E.adjustWithinSession(lift.exercise, logged, rule);
      next.weightKg = lift.loading
        ? E.nearestLoadable(adjustment.weightKg, lift.loading, adjustment.deltaKg > 0 ? 'up' : adjustment.deltaKg < 0 ? 'down' : 'nearest')
        : adjustment.weightKg;
      next.estimated = false;
      if (adjustment.deltaKg !== 0) {
        next.adjustment = adjustment;
        pushLog('세트 간 보정', lift.exercise.name + ' ' + (setIndex + 2) + '세트 — ' + adjustment.reason);
      }
    }

    var report = E.volumeReport(weekSessions(), landmarks, index);
    var muscle = E.primaryMuscle(lift.exercise);
    var status = report.filter(function (row) { return row.muscle === muscle; })[0];
    if (status && (status.zone === 'mavToMrv' || status.zone === 'overMrv')) {
      pushLog('볼륨 경보', '<b>' + E.MUSCLE_LABELS_KO[status.muscle] + '</b> 주간 ' + fmt(status.effectiveSets) +
        '세트 — ' + (status.zone === 'overMrv' ? 'MRV 초과' : 'MAV 초과') +
        ' (MRV ' + status.landmark.mrv + ')');
    }

    render();
  }

  function setReps(liftIndex, setIndex, delta) {
    var set = state.lifts[liftIndex].sets[setIndex];
    set.reps = clamp(set.reps + delta, 1, 50);
    render();
  }

  /* ── 렌더링 ────────────────────────────────────── */

  var screen = document.getElementById('screen');
  var tabbar = document.getElementById('tabbar');
  var logEl = document.getElementById('log');
  var scenariosEl = document.getElementById('scenarios');
  var scenarioNote = document.getElementById('scenario-note');
  var statusMeta = document.getElementById('status-meta');

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), attrs[key]);
      else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function zoneClass(zone) {
    return { underMev: 'low', mevToMav: 'ok', mavToMrv: 'hard', overMrv: 'over' }[zone];
  }

  function fmt(value) {
    return Math.round(value * 10) / 10;
  }

  function render() {
    var onboarding = state.onboarding.active;
    tabbar.hidden = onboarding;

    screen.textContent = '';
    if (onboarding) {
      statusMeta.textContent = '초기 설정';
      renderOnboarding();
    } else {
      renderTabs();
      renderStatus();
      renderScreen();
    }
    renderLog();
    renderScenarios();
  }

  function renderStatus() {
    var phase = state.plan.phase === 'deload' ? '디로드' : '축적 ' + state.plan.weekInBlock + '주차';
    statusMeta.textContent = phase + ' · RIR ' + state.plan.targetRir;
  }

  function renderTabs() {
    tabbar.textContent = '';
    TABS.forEach(function (tab) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'glyph');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', tab.icon);
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);

      var button = el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(state.tab === tab.id),
        onclick: function () { state.tab = tab.id; render(); },
      }, [svg, el('span', { text: tab.label })]);
      tabbar.appendChild(button);
    });
  }

  function renderScreen() {
    if (state.tab === 'today') renderToday();
    else if (state.tab === 'volume') renderVolume();
    else if (state.tab === 'week') renderWeek();
    else if (state.tab === 'gym') renderGym();
    else renderCheckin();
  }

  /* 오늘 */
  function renderToday() {
    var phaseBadge = el('span', {
      class: 'badge ' + (state.plan.phase === 'deload' ? 'deload' : 'accum'),
      text: state.plan.phase === 'deload' ? '디로드' : '축적 ' + state.plan.weekInBlock + '주차',
    });

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('div', { class: 'title' }, [
        el('h2', { text: state.session.name }),
        phaseBadge,
      ]),
      el('p', {
        class: 'meta',
        text: state.session.date + ' · 목표 RIR ' + state.plan.targetRir + ' · ' + state.lifts.length + '개 종목',
      }),
    ]));

    state.session.warnings.forEach(function (warning) {
      screen.appendChild(el('div', { class: 'notice' + (warning.medical ? ' stop' : '') }, [
        el('div', { class: 'label', text: WARNING_LABELS[warning.kind] || '알림' }),
        el('div', { text: warning.text }),
      ]));
    });

    state.lifts.forEach(function (lift, liftIndex) {
      var nameRow = el('div', { class: 'lift-name' }, [el('span', { text: lift.exercise.name })]);
      if (lift.substitutedFrom) {
        nameRow.appendChild(el('span', { class: 'swap-tag', text: '← ' + lift.substitutedFrom.name }));
      }

      if (lift.startingLoad && lift.startingLoad.needsCalibration) {
        nameRow.appendChild(el('span', {
          class: 'est-tag',
          text: lift.startingLoad.method === 'related-lift' ? '환산 추정' : '기준선 추정',
        }));
      }

      var card = el('div', { class: 'lift' }, [
        el('div', { class: 'lift-head' }, [
          nameRow,
          el('div', { class: 'lift-note', text: lift.note }),
        ]),
      ]);

      lift.sets.forEach(function (set, setIndex) {
        card.appendChild(renderSetRow(lift, liftIndex, set, setIndex));
      });

      screen.appendChild(card);
    });
  }

  function renderSetRow(lift, liftIndex, set, setIndex) {
    var load = el('div', { class: 'set-load' }, [
      el('span', { text: set.weightKg > 0 ? set.weightKg + '' : '맨몸' }),
      set.weightKg > 0 ? el('span', { class: 'unit', text: 'kg' }) : null,
      el('span', {
        class: 'target',
        text: '목표 ' + (set.targetReps.min === set.targetReps.max
          ? set.targetReps.max + '회'
          : set.targetReps.min + '–' + set.targetReps.max + '회'),
      }),
    ]);

    var main = el('div', { class: 'set-main' }, [load]);

    var plates = set.weightKg > 0 && lift.loading ? E.platePlan(set.weightKg, lift.loading) : null;
    if (plates) {
      main.appendChild(el('div', { class: 'plates', text: E.describePlates(plates) }));
    }

    if (set.done) {
      main.appendChild(el('div', { class: 'set-result' }, [
        el('span', { text: set.reps + '회 · RIR ' + set.rir + ' · 완료' }),
      ]));
      if (set.adjustment) {
        main.appendChild(el('div', { class: 'set-result' }, [
          el('em', { text: '다음 세트 ' + (set.adjustment.deltaKg > 0 ? '+' : '') + set.adjustment.deltaKg + 'kg' }),
        ]));
      }
    } else {
      var reps = el('div', { class: 'reps' }, [
        el('button', { type: 'button', 'aria-label': '반복 수 줄이기', text: '−', onclick: function () { setReps(liftIndex, setIndex, -1); } }),
        el('output', { text: set.reps + '회' }),
        el('button', { type: 'button', 'aria-label': '반복 수 늘리기', text: '+', onclick: function () { setReps(liftIndex, setIndex, 1); } }),
      ]);

      load.appendChild(reps);
      var chips = el('div', { class: 'rir-row' }, [
        el('span', { class: 'rir-label', text: 'RIR' }),
      ]);

      [0, 1, 2, 3, 4].forEach(function (rir) {
        chips.appendChild(el('button', {
          type: 'button',
          class: 'chip' + (rir === 0 ? ' fail' : ''),
          'aria-pressed': 'false',
          'aria-label': rir === 0 ? '실패 지점까지 수행' : '남은 반복 ' + rir + '회',
          text: rir === 0 ? '실패' : String(rir),
          onclick: function () { completeSet(liftIndex, setIndex, rir); },
        }));
      });

      main.appendChild(chips);
    }

    return el('div', { class: 'setrow' + (set.done ? ' done' : '') }, [
      el('div', { class: 'set-no', text: String(setIndex + 1) }),
      main,
    ]);
  }

  /* 볼륨 */
  function renderVolume() {
    var report = E.volumeReport(weekSessions(), landmarks, index)
      .filter(function (row) { return row.effectiveSets > 0; })
      .sort(function (a, b) { return b.mrvRatio - a.mrvRatio; });

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '주간 볼륨' }),
      el('p', { class: 'meta', text: state.monday + ' 주 · 유효 세트 기준 · 오늘 포함 4회차' }),
    ]));

    if (report.length === 0) {
      screen.appendChild(el('div', { class: 'notice' }, [el('div', { text: '이번 주 기록이 아직 없습니다.' })]));
      return;
    }

    var body = el('div', { class: 'sheet-body' }, []);
    report.forEach(function (row) { body.appendChild(gaugeRow(row)); });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '부위별 현황' }),
        el('span', { class: 'meta', text: 'MEV · MAV · MRV' }),
      ]),
      body,
    ]));
  }

  function gaugeRow(row) {
    var scale = row.landmark.mrv * 1.2;
    var pct = function (value) { return clamp((value / scale) * 100, 0, 100); };
    var zone = zoneClass(row.zone);

    var marks = [
      { label: 'MEV', value: row.landmark.mev },
      { label: 'MAV', value: row.landmark.mav },
      { label: 'MRV', value: row.landmark.mrv },
    ];

    var gauge = el('div', { class: 'gauge' }, [
      el('div', { class: 'redline', style: 'left:' + pct(row.landmark.mrv) + '%;right:0' }),
      el('div', { class: 'fill zone-' + zone, style: 'width:calc(' + pct(row.effectiveSets) + '% - 4px)' }),
    ]);
    marks.forEach(function (mark) {
      gauge.appendChild(el('div', { class: 'tick', style: 'left:' + pct(mark.value) + '%' }));
    });

    var axis = el('div', { class: 'gauge-axis' }, []);
    marks.forEach(function (mark) {
      axis.appendChild(el('span', {
        style: 'left:' + pct(mark.value) + '%',
        text: mark.label + ' ' + mark.value,
      }));
    });

    return el('div', { class: 'gauge-row' }, [
      el('div', { class: 'gauge-top' }, [
        el('span', { class: 'name', text: E.MUSCLE_LABELS_KO[row.muscle] }),
        el('span', { class: 'value zone-text-' + zone }, [
          document.createTextNode(fmt(row.effectiveSets) + ' '),
          el('span', { text: '세트 · ' + row.zoneLabel }),
        ]),
      ]),
      gauge,
      axis,
    ]);
  }

  /* 주간 */
  function renderWeek() {
    var plan = state.plan;
    var deload = plan.phase === 'deload';

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('div', { class: 'title' }, [
        el('h2', { text: deload ? '디로드 주간' : '축적 ' + plan.weekInBlock + '주차' }),
        el('span', { class: 'badge ' + (deload ? 'deload' : 'accum'), text: 'RIR ' + plan.targetRir }),
      ]),
      el('p', { class: 'meta', text: plan.summary }),
    ]));

    var bar = el('div', { class: 'fatigue-bar' }, []);
    for (var i = 1; i <= 10; i += 1) {
      var cls = i <= plan.fatigue.score ? (plan.fatigue.score >= plan.fatigue.threshold ? 'on over' : 'on') : '';
      bar.appendChild(el('i', { class: cls }));
    }

    var signals = el('div', {}, []);
    if (plan.fatigue.signals.length === 0) {
      signals.appendChild(el('p', { class: 'meta', text: '감지된 피로 신호가 없습니다.' }));
    }
    plan.fatigue.signals.forEach(function (signal) {
      signals.appendChild(el('div', { class: 'signal' }, [
        el('span', { class: 'w', text: '+' + signal.weight }),
        el('span', { text: signal.label }),
      ]));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '피로 신호' }),
        el('span', { class: 'meta', text: plan.fatigue.score + ' / 디로드 기준 ' + plan.fatigue.threshold }),
      ]),
      el('div', { class: 'sheet-body' }, [
        el('div', { class: 'fatigue' }, [bar]),
        signals,
      ]),
    ]));

    var changed = plan.volume
      .filter(function (item) { return item.prescribedSets > 0; })
      .sort(function (a, b) { return Math.abs(b.deltaSets) - Math.abs(a.deltaSets); })
      .slice(0, 8);

    var list = el('div', { class: 'delta-list' }, []);
    changed.forEach(function (item) {
      var cls = item.deltaSets > 0 ? 'up' : item.deltaSets < 0 ? 'down' : 'flat';
      var sign = item.deltaSets > 0 ? '+' : '';
      list.appendChild(el('div', { class: 'delta' }, [
        el('span', { text: item.label }),
        el('span', { class: 'num', text: fmt(item.currentSets) + ' → ' + item.prescribedSets }),
        el('span', { class: 'num ' + cls, text: item.deltaSets === 0 ? '유지' : sign + fmt(item.deltaSets) }),
      ]));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '다음 주 볼륨 처방' }),
        el('span', { class: 'meta', text: '지난주 → 이번주' }),
      ]),
      el('div', { class: 'sheet-body' }, [list]),
    ]));

    if (plan.frequency.length > 0) {
      var freqBody = el('div', { class: 'sheet-body' }, []);
      plan.frequency.forEach(function (item) {
        freqBody.appendChild(el('div', { class: 'freq' }, [
          el('div', { class: 'freq-top' }, [
            el('span', { class: 'name', text: item.label }),
            el('span', { class: 'num', text: '주 ' + item.sessionCount + '회 → ' + item.recommendedSessions + '회' }),
          ]),
          el('div', { class: 'freq-advice', text: item.advice }),
        ]));
      });

      screen.appendChild(el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-head' }, [
          el('h3', { text: '분배 조정' }),
          el('span', { class: 'meta', text: '볼륨보다 먼저' }),
        ]),
        freqBody,
      ]));
    }

    if (plan.neglected.length > 0) {
      screen.appendChild(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '프로그램 구멍' }),
        el('div', {
          text: plan.neglected.map(function (muscle) { return E.MUSCLE_LABELS_KO[muscle]; }).join(', ') +
            ' — 최근 4주간 기록이 없습니다.',
        }),
      ]));
    }
  }

  /* 체크인 */
  function renderCheckin() {
    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '오늘 체크인' }),
      el('p', { class: 'meta', text: '30초면 끝납니다. 통증은 세션 구성에 바로 반영됩니다.' }),
    ]));

    var body = el('div', { class: 'sheet-body' }, []);
    state.pain.forEach(function (report, i) {
      body.appendChild(sliderRow({
        name: E.JOINT_LABELS_KO[report.joint] + ' 통증',
        value: report.score,
        max: 10,
        id: 'pain-' + report.joint,
        onInput: function (value) {
          state.pain[i].score = value;
          rebuildSession();
          rebuildPlan();
          logPainChange(report.joint, value);
          render();
        },
      }));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '관절 통증' }),
        el('span', { class: 'meta', text: '0 없음 · 10 극심' }),
      ]),
      body,
    ]));

    var verdicts = el('div', { class: 'verdict' }, []);
    var changed = state.session.exercises.filter(function (item) { return item.painRuling.action !== 'allow'; });
    if (changed.length === 0) {
      verdicts.appendChild(el('p', { text: '현재 통증 보고로 제한되는 종목이 없습니다.' }));
    }
    changed.forEach(function (item) {
      verdicts.appendChild(el('p', {}, [
        el('b', { text: (item.substitutedFrom || item.exercise).name }),
        document.createTextNode(' — ' + item.painRuling.message),
      ]));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [el('h3', { text: '오늘 세션에 미친 영향' })]),
      el('div', { class: 'sheet-body' }, [verdicts]),
    ]));

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '판정 기준' }),
      el('div', { text: '3점 이상이면 해당 관절 부담이 큰 종목을 대체하고, 7점 이상이면 그 관절을 쓰는 동작을 오늘 세션에서 제외합니다.' }),
    ]));
  }

  /* 헬스장 */
  var BAR_OPTIONS = [
    { kg: 20, label: '20kg 올림픽' },
    { kg: 15, label: '15kg 여성용' },
  ];
  var STACK_OPTIONS = [
    { step: 5, label: '5kg' },
    { step: 2.5, label: '2.5kg' },
  ];
  var TOGGLE_EQUIPMENT = [
    { id: 'smith', label: '스미스머신' },
    { id: 'cable', label: '케이블' },
    { id: 'machine', label: '머신' },
  ];
  var LEVELS = [
    { id: 'beginner', label: '초급' },
    { id: 'intermediate', label: '중급' },
    { id: 'advanced', label: '고급' },
  ];

  function applyGymChange(message) {
    loadScenario(state.scenario, true);
    pushLog('기구 설정', message);
    render();
  }

  function renderGym() {
    var gym = state.gym;
    var bench = index.get('barbell-bench-press');
    var benchSpec = E.loadingFor(bench, gym);

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '내 헬스장' }),
      el('p', { class: 'meta', text: '기구가 만들 수 있는 중량만 처방합니다' }),
    ]));

    // 바 무게
    var barBody = el('div', { class: 'sheet-body' }, [
      segmented(BAR_OPTIONS.map(function (option) {
        return {
          label: option.label,
          active: gym.defaults.barbell.barKg === option.kg,
          onSelect: function () {
            gym.defaults.barbell.barKg = option.kg;
            applyGymChange('바 무게를 ' + option.kg + 'kg으로 변경했습니다. 바벨 종목 처방이 다시 계산됩니다');
          },
        };
      })),
      el('p', { class: 'hint-line', text: '벤치프레스에서 만들 수 있는 중량: ' + sampleWeights(benchSpec) }),
    ]);

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '바벨' }),
        el('span', { class: 'meta', text: '빈 바 무게' }),
      ]),
      barBody,
    ]));

    // 스택 간격
    var stackSpec = E.loadingFor(index.get('triceps-pushdown'), gym);
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '머신 · 케이블' }),
        el('span', { class: 'meta', text: '스택 간격' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        segmented(STACK_OPTIONS.map(function (option) {
          return {
            label: option.label,
            active: gym.defaults.stack.stepKg === option.step,
            onSelect: function () {
              gym.defaults.stack.stepKg = option.step;
              applyGymChange('스택 간격을 ' + option.step + 'kg으로 변경했습니다');
            },
          };
        })),
        el('p', { class: 'hint-line', text: '만들 수 있는 중량: ' + sampleWeights(stackSpec) }),
      ]),
    ]));

    // 없는 기구
    var missing = gym.missingEquipment || [];
    var toggles = el('div', { class: 'toggle-row' }, []);
    TOGGLE_EQUIPMENT.forEach(function (item) {
      var has = missing.indexOf(item.id) === -1;
      toggles.appendChild(el('button', {
        type: 'button',
        class: 'toggle',
        'aria-pressed': String(has),
        text: item.label,
        onclick: function () {
          gym.missingEquipment = has
            ? missing.concat([item.id])
            : missing.filter(function (id) { return id !== item.id; });
          applyGymChange(item.label + (has ? '이(가) 없는 것으로 설정했습니다. 해당 종목은 대체됩니다' : '을(를) 보유로 되돌렸습니다'));
        },
      }));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '보유 기구' }),
        el('span', { class: 'meta', text: '켜진 것이 보유' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        toggles,
        el('p', { class: 'hint-line', text: '없는 기구를 끄면 오늘 세션의 해당 종목이 자동으로 대체됩니다.' }),
      ]),
    ]));

    // 신체 정보 — 첫 수행 종목의 시작 중량 추정에 쓰인다
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '내 정보' }),
        el('span', { class: 'meta', text: '첫 중량 추정용' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        sliderRow({
          name: '체중 (kg)',
          value: state.lifter.bodyweightKg,
          min: 40,
          max: 130,
          id: 'lifter-bw',
          marks: ['40', '70', '100', '130'],
          onInput: function (value) {
            state.lifter.bodyweightKg = value;
            loadScenario(state.scenario, true);
            render();
          },
        }),
        segmented(LEVELS.map(function (level) {
          return {
            label: level.label,
            active: state.lifter.level === level.id,
            onSelect: function () {
              state.lifter.level = level.id;
              applyGymChange('경력을 ' + level.label + '으로 변경했습니다. 기준선 추정치가 달라집니다');
            },
          };
        })),
        el('p', { class: 'hint-line', text: startingLoadPreview() }),
      ]),
    ]));

    screen.appendChild(el('div', { class: 'wizard-nav' }, [
      el('button', { type: 'button', class: 'ghost', text: '초기 설정 다시 하기', onclick: startOnboarding }),
    ]));

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '추정은 출발점일 뿐' }),
      el('div', { text: '처음 하는 종목은 체중·경력 기준선이나 이미 하는 종목에서 환산해 제안합니다. 첫 세트의 RIR을 입력하면 실측으로 대체됩니다.' }),
    ]));
  }

  function sampleWeights(spec) {
    if (!spec) return '없음';
    var all = E.loadableWeights(spec);
    return all.slice(0, 5).join(' · ') + ' … ' + all[all.length - 1] + 'kg';
  }

  function startingLoadPreview() {
    var squat = index.get('back-squat');
    var suggestion = E.suggestStartingLoad({
      exercise: squat,
      repRange: { min: 8, max: 12 },
      targetRir: 3,
      profile: state.lifter,
      loading: E.loadingFor(squat, state.gym),
    });
    return suggestion.weightKg === null
      ? '기록이 없으면 탐색 세트부터 시작합니다.'
      : '기록이 전혀 없을 때 백 스쿼트 제안 중량: ' + suggestion.weightKg + 'kg';
  }

  function segmented(options) {
    var row = el('div', { class: 'segmented' }, []);
    options.forEach(function (option) {
      row.appendChild(el('button', {
        type: 'button',
        'aria-pressed': String(option.active),
        text: option.label,
        onclick: option.onSelect,
      }));
    });
    return row;
  }

  function sliderRow(config) {
    var output = el('span', { class: 'score', text: String(config.value) });
    var input = el('input', {
      type: 'range',
      min: String(config.min === undefined ? 0 : config.min),
      max: String(config.max),
      step: '1',
      value: String(config.value),
      id: config.id,
      oninput: function (event) {
        var value = Number(event.target.value);
        output.textContent = String(value);
        config.onInput(value);
      },
    });

    return el('div', { class: 'slider-row' }, [
      el('div', { class: 'slider-top' }, [
        el('label', { class: 'name', for: config.id, text: config.name }),
        output,
      ]),
      input,
      el('div', { class: 'scale-marks' },
        (config.marks || ['0', '3', '7', '10']).map(function (mark) {
          return el('span', { text: mark });
        })),
    ]);
  }

  var painLogTimer = null;
  function logPainChange(joint, score) {
    clearTimeout(painLogTimer);
    painLogTimer = setTimeout(function () {
      var swapped = state.session.exercises.filter(function (item) { return item.substitutedFrom; });
      var dropped = state.session.warnings.filter(function (w) { return w.medical; });
      var label = E.JOINT_LABELS_KO[joint] + ' 통증 ' + score + '점';

      if (swapped.length > 0) {
        pushLog('종목 대체', label + ' → ' + swapped.map(function (item) {
          return '<b>' + item.substitutedFrom.name + '</b> ✕ → ' + item.exercise.name;
        }).join(', '));
      } else if (dropped.length > 0) {
        pushLog('종목 제외', label + ' → 대체 종목 없음. 해당 부위를 오늘 세션에서 제외했습니다.');
      } else if (score === 0) {
        pushLog('통증 해제', label + ' → 원래 종목으로 복귀했습니다.');
      } else {
        pushLog('통증 반영', label + ' → 대체 없이 중량만 조정합니다.');
      }
      renderLog();
    }, 260);
  }

  /* 우측 패널 */
  function renderScenarios() {
    scenariosEl.textContent = '';
    SCENARIOS.forEach(function (scenario) {
      scenariosEl.appendChild(el('button', {
        type: 'button',
        class: 'scenario',
        'aria-pressed': String(state.scenario === scenario.id),
        text: scenario.label,
        onclick: function () { loadScenario(scenario.id); render(); },
      }));
    });
    var active = SCENARIOS.filter(function (s) { return s.id === state.scenario; })[0];
    scenarioNote.textContent = active.note;
  }

  function renderLog() {
    logEl.textContent = '';
    if (state.log.length === 0) {
      logEl.appendChild(el('p', { class: 'log-empty', text: '세트의 RIR을 탭하거나 통증을 조절하면 엔진의 판단이 여기에 쌓입니다.' }));
      return;
    }
    state.log.forEach(function (entry) {
      logEl.appendChild(el('div', { class: 'log-item' }, [
        el('div', { class: 'kind', text: entry.kind }),
        el('div', { class: 'body', html: entry.body }),
      ]));
    });
  }

  /* ── 온보딩 ────────────────────────────────────── */

  var GOALS = [
    { id: 'hypertrophy', label: '근비대', hint: '근육량을 늘립니다' },
    { id: 'strength', label: '근력', hint: '드는 무게를 올립니다' },
    { id: 'fatLoss', label: '체지방 감량', hint: '근육을 지키며 체중을 줄입니다' },
    { id: 'general', label: '건강 유지', hint: '무리 없이 꾸준히' },
  ];

  var STEPS = [
    { id: 'level', title: '경력', render: stepLevel },
    { id: 'profile', title: '내 정보', render: stepProfile },
    { id: 'gym', title: '헬스장 기구', render: stepGym },
    { id: 'measure', title: '실측', render: stepMeasure },
    { id: 'result', title: '프로그램', render: stepResult },
  ];

  function startOnboarding() {
    state.answers = JSON.parse(JSON.stringify(DEFAULT_ANSWERS));
    state.answers.gym.measurements = {};
    state.onboarding = { active: true, step: 0 };
    render();
  }

  function completeOnboarding() {
    var result = E.runOnboarding(state.answers);
    state.gym = result.gym;
    state.lifter = result.lifter;
    state.program = result.program;
    state.onboarding = { active: false, step: 0, result: result };
    state.tab = 'today';
    loadScenario('normal');
    result.notes.forEach(function (note) { pushLog('온보딩', note); });
    render();
  }

  function renderOnboarding() {
    var step = STEPS[state.onboarding.step];

    var dots = el('div', { class: 'steps' }, []);
    STEPS.forEach(function (item, i) {
      dots.appendChild(el('span', {
        class: 'step' + (i === state.onboarding.step ? ' on' : i < state.onboarding.step ? ' done' : ''),
        text: item.title,
      }));
    });

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: step.title }),
      dots,
    ]));

    step.render();

    var isLast = state.onboarding.step === STEPS.length - 1;
    var nav = el('div', { class: 'wizard-nav' }, []);
    if (state.onboarding.step > 0) {
      nav.appendChild(el('button', {
        type: 'button', class: 'ghost', text: '이전',
        onclick: function () { state.onboarding.step -= 1; render(); },
      }));
    }
    nav.appendChild(el('button', {
      type: 'button', class: 'primary', text: isLast ? '이 프로그램으로 시작' : '다음',
      onclick: function () {
        if (isLast) completeOnboarding();
        else { state.onboarding.step += 1; render(); }
      },
    }));
    screen.appendChild(nav);
  }

  function stepLevel() {
    var body = el('div', { class: 'sheet-body' }, []);
    E.TRAINING_LEVELS.forEach(function (level) {
      var profile = E.levelProfile(level);
      body.appendChild(el('button', {
        type: 'button',
        class: 'choice',
        'aria-pressed': String(state.answers.selfReportedLevel === level),
        onclick: function () { state.answers.selfReportedLevel = level; render(); },
      }, [
        el('span', { class: 'choice-title', text: profile.label }),
        el('span', { class: 'choice-hint', text: profile.description }),
      ]));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [el('h3', { text: '어느 단계라고 생각하세요?' })]),
      body,
    ]));

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '꾸준히 훈련한 기간' }),
        el('span', { class: 'meta', text: '단계 검증에 씁니다' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        sliderRow({
          name: '개월 수', value: state.answers.monthsTraining, min: 0, max: 84,
          id: 'months', marks: ['0', '24', '48', '84'],
          onInput: function (value) { state.answers.monthsTraining = value; renderPreviewNote(); },
        }),
        el('p', { class: 'hint-line', id: 'level-preview', text: levelPreview() }),
      ]),
    ]));
  }

  function levelPreview() {
    var check = E.assessLevel({
      selfReported: state.answers.selfReportedLevel,
      monthsTraining: state.answers.monthsTraining,
    });
    return check.adjusted
      ? '→ ' + E.LEVEL_LABELS_KO[check.level] + ' 볼륨으로 시작합니다. ' + check.note
      : '→ ' + E.LEVEL_LABELS_KO[check.level] + ' 기준으로 시작합니다.';
  }

  function renderPreviewNote() {
    var node = document.getElementById('level-preview');
    if (node) node.textContent = levelPreview();
  }

  function stepProfile() {
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '신체' }),
        el('span', { class: 'meta', text: '첫 중량 추정용' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        sliderRow({
          name: '체중 (kg)', value: state.answers.bodyweightKg, min: 40, max: 130,
          id: 'bw', marks: ['40', '70', '100', '130'],
          onInput: function (value) { state.answers.bodyweightKg = value; },
        }),
        segmented([
          { label: '남성', active: state.answers.sex === 'male', onSelect: function () { state.answers.sex = 'male'; render(); } },
          { label: '여성', active: state.answers.sex === 'female', onSelect: function () { state.answers.sex = 'female'; render(); } },
        ]),
      ]),
    ]));

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '주당 훈련 일수' }),
        el('span', { class: 'meta', text: '분할이 달라집니다' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        segmented([2, 3, 4, 5, 6].map(function (days) {
          return {
            label: days + '일',
            active: state.answers.daysPerWeek === days,
            onSelect: function () { state.answers.daysPerWeek = days; render(); },
          };
        })),
        el('p', { class: 'hint-line', text: splitPreview() }),
      ]),
    ]));

    var goals = el('div', { class: 'sheet-body' }, []);
    GOALS.forEach(function (goal) {
      goals.appendChild(el('button', {
        type: 'button', class: 'choice',
        'aria-pressed': String(state.answers.goal === goal.id),
        onclick: function () { state.answers.goal = goal.id; render(); },
      }, [
        el('span', { class: 'choice-title', text: goal.label }),
        el('span', { class: 'choice-hint', text: goal.hint }),
      ]));
    });
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [el('h3', { text: '목표' })]),
      goals,
    ]));
  }

  function splitPreview() {
    var program = E.buildProgram(state.answers, state.answers.selfReportedLevel);
    return program.name + ' — ' + program.templates.map(function (t) { return t.name; }).join(' · ');
  }

  function stepGym() {
    var selected = state.answers.gym.equipmentIds;
    var available = E.availableExercises(selected).length;

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '가능한 종목' }),
      el('div', { text: available + ' / ' + E.EXERCISES.length + '개 — 있는 기구를 켜면 종목이 열립니다.' }),
    ]));

    var categories = {};
    E.EQUIPMENT_CATALOG.forEach(function (item) {
      (categories[item.category] = categories[item.category] || []).push(item);
    });

    Object.keys(categories).forEach(function (category) {
      var body = el('div', { class: 'sheet-body' }, []);
      var row = el('div', { class: 'toggle-row' }, []);

      categories[category].forEach(function (item) {
        var has = selected.indexOf(item.id) >= 0;
        var unlocks = has ? [] : E.wouldEnable(item.id, selected);
        var label = item.name + (unlocks.length > 0 ? ' +' + unlocks.length : '');

        row.appendChild(el('button', {
          type: 'button', class: 'toggle', 'aria-pressed': String(has), text: label,
          onclick: function () {
            state.answers.gym.equipmentIds = has
              ? selected.filter(function (id) { return id !== item.id; })
              : selected.concat([item.id]);
            render();
          },
        }));
      });

      body.appendChild(row);
      screen.appendChild(el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-head' }, [el('h3', { text: E.CATEGORY_LABELS_KO[category] })]),
        body,
      ]));
    });

    var gaps = E.coverageReport(selected).filter(function (item) { return !item.sufficient; });
    if (gaps.length > 0) {
      screen.appendChild(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '아직 부족한 부위' }),
        el('div', { text: gaps.map(function (gap) {
          return gap.label + (gap.suggestion ? ' (' + gap.suggestion.name + ')' : '');
        }).join(', ') }),
      ]));
    }
  }

  function stepMeasure() {
    var selected = state.answers.gym.equipmentIds;
    var measurable = E.EQUIPMENT_CATALOG.filter(function (item) {
      return item.measurement && selected.indexOf(item.id) >= 0;
    });

    if (measurable.length === 0) {
      screen.appendChild(el('div', { class: 'notice' }, [
        el('div', { text: '실측할 항목이 없습니다. 다음으로 넘어가세요.' }),
      ]));
      return;
    }

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '왜 묻나' }),
      el('div', { text: '기구마다 만들 수 있는 중량이 다릅니다. 모르면 기본값으로 두고 나중에 고쳐도 됩니다.' }),
    ]));

    measurable.forEach(function (item) {
      var measurement = item.measurement;
      var current = (state.answers.gym.measurements[item.id] || {})[measurement.field];
      if (current === undefined) current = measurement.default;

      screen.appendChild(el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-head' }, [
          el('h3', { text: item.name }),
          el('span', { class: 'meta', text: measurement.label }),
        ]),
        el('div', { class: 'sheet-body' }, [
          segmented(measurement.options.map(function (option) {
            return {
              label: option + 'kg',
              active: current === option,
              onSelect: function () {
                var store = state.answers.gym.measurements;
                store[item.id] = store[item.id] || {};
                store[item.id][measurement.field] = option;
                render();
              },
            };
          })),
          measurement.hint ? el('p', { class: 'hint-line', text: measurement.hint }) : null,
        ]),
      ]));
    });
  }

  function stepResult() {
    var result = E.runOnboarding(state.answers);

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: result.program.name }),
        el('span', {
          class: 'badge accum',
          text: E.LEVEL_LABELS_KO[result.level.level] + ' · RIR ' + result.firstWeek.targetRir,
        }),
      ]),
      el('div', { class: 'sheet-body' }, result.notes.map(function (note) {
        return el('p', { class: 'hint-line', text: note });
      })),
    ]));

    result.program.templates.forEach(function (template) {
      var body = el('div', { class: 'sheet-body' }, []);
      template.slots.forEach(function (slot) {
        var exercise = index.get(slot.exerciseId);
        body.appendChild(el('div', { class: 'delta' }, [
          el('span', { text: exercise ? exercise.name : slot.exerciseId }),
          el('span', { class: 'num', text: slot.sets + '세트' }),
          el('span', { class: 'num flat', text: slot.repRange.min + '-' + slot.repRange.max + '회' }),
        ]));
      });
      screen.appendChild(el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-head' }, [el('h3', { text: template.name })]),
        body,
      ]));
    });
  }

  /* ── 시작 ──────────────────────────────────────── */
  state.answers = JSON.parse(JSON.stringify(DEFAULT_ANSWERS));
  state.answers.gym.measurements = {};
  state.program = E.buildProgram(state.answers, state.answers.selfReportedLevel);
  loadScenario('normal', true);
  render();
})();

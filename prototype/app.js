/* 볼륨 코치 프로토타입 — 저장소의 트레이닝 엔진(FitEngine)을 그대로 구동한다. */
(function () {
  'use strict';

  var E = window.FitEngine;
  var index = E.buildExerciseIndex();
  var baseLandmarks = E.landmarksFor('intermediate');

  /* ── PWA · 알림 · 화면 유지 ─────────────────────── */

  /**
   * 설치와 알림 상태.
   *
   * 프로토타입을 링크로 여는 동안에는 아무것도 안 되는 게 정상이다 —
   * 서비스 워커는 출처마다 스코프가 다르고, iOS는 홈 화면에 추가해야만
   * 알림을 허용한다. 그래서 상태를 감추지 않고 그대로 보여준다.
   */
  var pwa = {
    worker: null,
    swError: null,
    installEvent: null,
    installed: false,
    wakeLock: null,
    notified: false,
  };

  function supportsNotifications() {
    return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
  }

  function notificationState() {
    if (!supportsNotifications()) return 'unsupported';
    return Notification.permission;
  }

  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    } catch (err) {
      return false;
    }
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function registerWorker() {
    pwa.installed = isStandalone();
    if (!('serviceWorker' in navigator)) {
      pwa.swError = '이 브라우저는 오프라인 설치를 지원하지 않습니다.';
      return;
    }
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (registration) {
      pwa.worker = registration;
      render();
    }, function (err) {
      // 아티팩트처럼 워커를 못 붙이는 곳도 있다. 앱은 그대로 돌아간다.
      pwa.swError = String(err && err.message ? err.message : err);
      render();
    });

    navigator.serviceWorker.addEventListener('message', function (event) {
      var data = event.data || {};
      if (data.type !== 'rest:action') return;
      if (data.action === 'extend') extendRest(30);
      else stopRest();
      render();
    });
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    pwa.installEvent = event;
    render();
  });

  window.addEventListener('appinstalled', function () {
    pwa.installEvent = null;
    pwa.installed = true;
    render();
  });

  function promptInstall() {
    if (!pwa.installEvent) return;
    pwa.installEvent.prompt();
    pwa.installEvent.userChoice.then(function () {
      pwa.installEvent = null;
      render();
    });
  }

  function askNotificationPermission() {
    if (!supportsNotifications()) return;
    Notification.requestPermission().then(function () { render(); });
  }

  /**
   * 화면 꺼짐 방지.
   *
   * 휴식 중에 화면이 꺼지면 남은 시간을 볼 수 없다. 세트 사이에만 잡고
   * 끝나면 바로 놓는다 — 계속 잡고 있으면 배터리를 먹는다.
   */
  function acquireWakeLock() {
    if (!navigator.wakeLock || pwa.wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (lock) {
      pwa.wakeLock = lock;
      lock.addEventListener('release', function () { pwa.wakeLock = null; });
    }, function () { /* 배터리 절약 모드 등에서 거부된다 */ });
  }

  function releaseWakeLock() {
    if (!pwa.wakeLock) return;
    pwa.wakeLock.release().catch(function () {});
    pwa.wakeLock = null;
  }

  function notifyWorker(message) {
    var target = pwa.worker && (pwa.worker.active || navigator.serviceWorker.controller);
    if (target) target.postMessage(message);
  }

  function buzz(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (err) { /* 데스크톱에는 진동이 없다 */ }
  }

  /** 헬스장 지하에는 신호가 없다. 로컬이 원본이고 서버는 나중에 붙는다. */
  var storage = E.createStore(browserAdapter(), { namespace: 'volume-coach.proto' });

  function browserAdapter() {
    try {
      var probe = '__probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      // 시크릿 창이나 저장소가 막힌 환경 — 이번 세션만 메모리에 남는다.
      return E.memoryAdapter();
    }
  }

  function persist() {
    storage.patch({
      answers: state.answers,
      program: state.program,
      lifter: state.lifter,
      settings: {
        scenario: state.scenario,
        onboarded: !state.onboarding.active,
        tab: state.tab,
        todaySets: state.todaySets,
        style: state.style,
        blockHistory: state.blockHistory,
        timeBudget: state.timeBudget,
        gymBook: state.gymBook,
      },
    });
  }

  /**
   * 저장된 설정으로 복원한다.
   * 시드 이력은 시나리오에서 다시 만들지만, 사용자가 고른 것과 오늘 기록한
   * 세트는 되살려야 한다 — 앱을 껐다 켰다고 오늘 한 운동이 사라지면 안 된다.
   */
  function restore() {
    var saved = storage.load();
    var settings = saved.settings || {};
    if (!settings.onboarded || !saved.answers || !saved.program) return false;

    try {
      state.answers = saved.answers;
      state.program = saved.program;
      state.lifter = saved.lifter || state.lifter;
      state.gym = E.gymFromCatalog(saved.answers.gym);
      state.onboarding = { active: false, step: 0 };
      state.scenario = settings.scenario || 'normal';
      state.tab = settings.tab || 'today';
      state.style = settings.style || 'hypertrophy';
      state.timeBudget = settings.timeBudget || null;
      state.blockHistory = settings.blockHistory || ['hypertrophy'];
      state.gymBook = settings.gymBook || E.createGymBook({
        id: 'my-gym', name: '내 헬스장', equipmentIds: saved.answers.gym.equipmentIds.slice(),
      });

      loadScenario(state.scenario, true);

      // 오늘 기록한 세트를 되살리고, 해당 세트를 완료 상태로 표시한다.
      var todaySets = Array.isArray(settings.todaySets) ? settings.todaySets : [];
      if (todaySets.length > 0) {
        state.todaySets = todaySets;

        // 값이 똑같은 세트가 여러 개일 수 있으므로 종목별 큐에서 순서대로 꺼낸다.
        var queues = {};
        todaySets.forEach(function (logged) {
          (queues[logged.exerciseId] = queues[logged.exerciseId] || []).push(logged);
        });

        state.lifts.forEach(function (lift) {
          var queue = queues[lift.exercise.id] || [];
          lift.sets.forEach(function (set) {
            var logged = queue.shift();
            if (!logged) return;
            set.done = true;
            set.rir = logged.rir;
            set.reps = logged.reps;
            set.weightKg = logged.weightKg;
          });
        });
        pushLog('복원', '저장된 기록에서 오늘 <b>' + todaySets.length + '세트</b>를 되살렸습니다.');
      }
      return true;
    } catch (err) {
      // 저장 형식이 바뀌었거나 깨졌으면 처음부터 시작한다.
      storage.reset();
      return false;
    }
  }

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
    { id: 'progress', label: '진행', icon: 'M4 18l5-6 4 3 7-8' },
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
    rest: null,
    restTicker: null,
    progressExerciseId: null,
    monday: E.weekStart(todayISO()),
    todayDate: null,
    program: null,
    answers: null,
    gymBook: null,
    landmarks: baseLandmarks,
    personalization: null,
    summary: null,
    demo: null,
    sessionStartedAt: null,
    busyEquipment: [],
    occupied: {},
    // 사용자가 직접 등록한 곳. 공개 디렉터리에 없는 아파트·회사 헬스장이 여기 쌓인다.
    myDirectory: [],
    gymDraft: null,
    style: 'hypertrophy',
    blockHistory: ['hypertrophy'],
    conditioning: null,
    timeBudget: null,
    timeFit: null,
    warmupOpen: {},
    gymQuery: '',
    maxTest: null,
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
   * 지난 9주 전체 + 이번 주 앞 세 번의 훈련을 생성한다.
   * 오늘이 그 주의 네 번째 세션이라, 앱을 열면 볼륨 게이지가 실제로 쌓인 상태로 보인다.
   *
   * 2주가 아니라 10주를 만드는 이유 — 개인 랜드마크 보정은 8주 이상의
   * 관측이 있어야 시작한다. 그보다 짧으면 컨디션 나쁜 한 주를 그 사람의
   * 한계로 오해한다.
   */
  var SEED_WEEKS = 10;

  function seedHistory(scenario) {
    var history = [];
    var checkIns = [];
    var pain = JOINTS
      .map(function (joint) { return { joint: joint, score: scenario.pain[joint] || 0 }; })
      .filter(function (report) { return report.score > 0; });

    for (var week = 0; week < SEED_WEEKS; week += 1) {
      var monday = E.addDays(state.monday, (week - (SEED_WEEKS - 1)) * 7);
      // 블록은 4주마다 돈다 — 3주 쌓고 한 주 덜어내는 실제 주기를 흉내낸다.
      var weekInBlock = (week % 4) + 1;
      var plan = week === 0
        ? coldStartPlan(monday)
        : E.planNextWeek({
            sessions: history,
            checkIns: checkIns,
            index: index,
            landmarks: state.landmarks,
            asOf: E.addDays(monday, -1),
            weekInBlock: weekInBlock,
            lastWeekPhase: 'accumulation',
          });

      // 마지막 주는 오늘 세션을 남겨둔다.
      var offsets = trainingDays();
      var days = week === SEED_WEEKS - 1 ? offsets.slice(0, -1) : offsets;

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
        history.push(perform(planned, scenario.decay * weekInBlock));
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
    stopRest();
    var seeded = seedHistory(scenario);
    state.history = seeded.history;
    state.checkIns = seeded.checkIns;
    state.todaySets = [];
    state.summary = null;
    state.sessionStartedAt = null;
    state.busyEquipment = [];
    state.occupied = {};
    refreshLandmarks();
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

  /** 8주 이상 쌓이면 개인 관측으로 랜드마크를 옮긴다. */
  function refreshLandmarks() {
    var result = E.personalizeLandmarks({
      history: state.history,
      index: index,
      level: state.lifter.level,
      baseLandmarks: E.landmarksFor(state.lifter.level),
    });
    state.personalization = result;
    state.landmarks = result.landmarks;
    return result;
  }

  function rebuildPlan() {
    state.plan = E.planNextWeek({
      sessions: state.history,
      checkIns: state.checkIns,
      index: index,
      landmarks: state.landmarks,
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

    // 블록 유형이 그 주의 목표 RIR과 반복 범위를 정한다
    var styled = Object.assign({}, state.plan, {
      targetRir: state.plan.phase === 'deload'
        ? state.plan.targetRir
        : E.targetRirFor(state.style, state.plan.weekInBlock),
    });
    state.plan = styled;

    var built = E.buildSession({
      template: state.program.templates[todayIndex() % state.program.templates.length],
      date: state.todayDate,
      plan: state.plan,
      history: state.history,
      index: index,
      pain: activePain(),
      gym: state.gym,
      lifter: state.lifter,
    });

    // 오늘 쓸 수 있는 시간이 정해져 있으면 그 안에 들어오게 줄인다.
    state.timeFit = null;
    if (state.timeBudget) {
      var profile = E.styleProfile(state.style);
      state.timeFit = E.fitToTimeBudget(built, state.timeBudget, {
        restMultiplier: profile.restMultiplier,
        allowShortRest: state.style === 'density',
      });
      built = state.timeFit.session;
    }
    state.session = built;

    var warmed = [];
    state.lifts = state.session.exercises.map(function (item) {
      // 워밍업은 본세트 중량에 맞춘 램프다. 앞 종목이 데운 부위는 짧게 끝낸다.
      var firstSet = item.sets[0];
      var warmup = E.planWarmup({
        exercise: item.exercise,
        workingWeightKg: firstSet && firstSet.weightKg ? firstSet.weightKg : 0,
        workingReps: firstSet ? firstSet.targetReps.max : 10,
        level: state.lifter.level,
        alreadyWarmedMuscles: warmed.slice(),
        loading: item.loading,
        barKg: item.loading && item.loading.kind === 'barbell' ? item.loading.barKg : undefined,
      });
      E.warmedMusclesOf(item.exercise).forEach(function (m) {
        if (warmed.indexOf(m) < 0) warmed.push(m);
      });

      return {
        exercise: item.exercise,
        substitutedFrom: item.substitutedFrom,
        swapReason: item.swapReason,
        startingLoad: item.startingLoad,
        loading: item.loading,
        warmup: warmup,
        decision: null,
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

  /** 신고 RIR에 개인 편향 보정을 실은 집계 옵션. */
  function rirOptions() {
    var calibration = state.session && state.session.rirCalibration;
    return { rirOffset: calibration && calibration.applied ? calibration.offset : 0 };
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
    if (!state.sessionStartedAt) state.sessionStartedAt = Date.now();

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

    updateDecision(lift);
    startRest(lift, setIndex);

    var report = E.volumeReport(weekSessions(), state.landmarks, index);
    var muscle = E.primaryMuscle(lift.exercise);
    var status = report.filter(function (row) { return row.muscle === muscle; })[0];
    if (status && (status.zone === 'mavToMrv' || status.zone === 'overMrv')) {
      pushLog('볼륨 경보', '<b>' + E.MUSCLE_LABELS_KO[status.muscle] + '</b> 주간 ' + fmt(status.effectiveSets) +
        '세트 — ' + (status.zone === 'overMrv' ? 'MRV 초과' : 'MAV 초과') +
        ' (MRV ' + status.landmark.mrv + ')');
    }

    render();
  }

  /** 수행을 보고 세트를 더 할지 여기서 멈출지 정한다. */
  function updateDecision(lift) {
    var completed = lift.sets
      .filter(function (set) { return set.done; })
      .map(function (set) {
        return { exerciseId: lift.exercise.id, weightKg: set.weightKg, reps: set.reps, rir: set.rir };
      });

    var muscle = E.primaryMuscle(lift.exercise);
    var report = E.volumeReport(weekSessions(), state.landmarks, index);
    var status = report.filter(function (row) { return row.muscle === muscle; })[0];
    var calibration = state.session.rirCalibration;

    lift.decision = E.decideNextSet({
      completed: completed,
      plannedSets: lift.sets.length,
      rule: {
        repRange: lift.repRange,
        targetRir: lift.targetRir,
        rirOffset: calibration && calibration.applied ? calibration.offset : 0,
      },
      zone: status ? status.zone : undefined,
    });

    if (lift.decision.verdict === 'stop' && completed.length < lift.sets.length) {
      pushLog('세트 조정', '<b>' + lift.exercise.name + '</b> — ' + lift.decision.reason);
    } else if (lift.decision.verdict === 'continue' && completed.length >= lift.sets.length) {
      pushLog('세트 조정', '<b>' + lift.exercise.name + '</b> — ' + lift.decision.reason);
    }
  }

  function addSet(lift) {
    var last = lift.sets[lift.sets.length - 1];
    lift.sets.push({
      weightKg: last ? last.weightKg : 0,
      estimated: false,
      targetReps: lift.repRange,
      targetRir: lift.targetRir,
      reps: lift.repRange.max,
      rir: null,
      done: false,
      adjustment: null,
    });
    lift.decision = null;
    render();
  }

  /* ── 휴식 타이머 ───────────────────────────────── */

  function startRest(lift, setIndex) {
    var isLast = setIndex === lift.sets.length - 1;
    var prescription = E.restFor({
      exercise: lift.exercise,
      reps: lift.sets[setIndex].reps,
      targetRir: lift.targetRir,
      isLastSet: isLast,
    });

    state.rest = {
      exerciseName: lift.exercise.name,
      setNumber: setIndex + 1,
      total: prescription.seconds,
      endsAt: Date.now() + prescription.seconds * 1000,
      reason: prescription.reason,
    };

    if (state.restTicker) clearInterval(state.restTicker);
    // 1초마다 전체를 다시 그리면 입력이 끊긴다. 숫자 노드만 직접 갱신한다.
    state.restTicker = setInterval(tickRest, 250);

    // 화면은 켜두고, 알림은 워커에 맡긴다 — 주머니에 넣어도 손목까지 간다.
    acquireWakeLock();
    notifyWorker({
      type: 'rest:start',
      endsAt: state.rest.endsAt,
      body: lift.exercise.name + ' ' + (setIndex + 2 <= lift.sets.length
        ? (setIndex + 2) + '세트를 시작하세요.'
        : '다음 종목으로 넘어가세요.'),
    });
    renderRest();
  }

  /** 알림에서 "+30초"를 눌렀을 때. 타이머를 다시 예약한다. */
  function extendRest(seconds) {
    if (!state.rest) return;
    state.rest.endsAt += seconds * 1000;
    state.rest.total += seconds;
    notifyWorker({ type: 'rest:start', endsAt: state.rest.endsAt, body: '연장한 휴식이 끝났습니다.' });
    renderRest();
  }

  function restRemaining() {
    if (!state.rest) return 0;
    return Math.max(0, Math.ceil((state.rest.endsAt - Date.now()) / 1000));
  }

  function tickRest() {
    if (!state.rest) return stopRest();
    var node = document.getElementById('rest-remaining');
    var bar = document.getElementById('rest-bar');
    var remaining = restRemaining();

    if (node) node.textContent = E.formatDuration(remaining);
    if (bar) bar.style.width = (100 - (remaining / state.rest.total) * 100) + '%';

    if (remaining <= 0) {
      pushLog('휴식 완료', '<b>' + state.rest.exerciseName + '</b> ' + state.rest.setNumber +
        '세트 후 휴식이 끝났습니다. 다음 세트를 시작하세요.');
      buzz([220, 120, 220]);
      stopRest();
      renderLog();
    }
  }

  function stopRest() {
    if (state.restTicker) clearInterval(state.restTicker);
    state.restTicker = null;
    state.rest = null;
    releaseWakeLock();
    notifyWorker({ type: 'rest:stop' });
    renderRest();
  }

  /*
   * 화면이 꺼지면 페이지 타이머는 느려지거나 멈춘다. 그래서 남은 시간을
   * 세는 대신 끝나는 시각을 저장해두고, 돌아올 때 그 시각과 대조한다.
   * 이렇게 하면 몇 분을 잠가뒀다 열어도 숫자가 틀리지 않는다.
   */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') {
      releaseWakeLock();
      return;
    }
    if (!state.rest) return;
    if (restRemaining() <= 0) tickRest();
    else {
      acquireWakeLock();
      renderRest();
    }
  });

  function renderRest() {
    var host = document.getElementById('rest-host');
    if (!host) return;
    host.textContent = '';
    host.hidden = !state.rest;
    if (!state.rest) return;

    var remaining = restRemaining();
    host.appendChild(el('div', { class: 'rest-bar-track' }, [
      el('div', {
        class: 'rest-bar-fill',
        id: 'rest-bar',
        style: 'width:' + (100 - (remaining / state.rest.total) * 100) + '%',
      }),
    ]));
    host.appendChild(el('div', { class: 'rest-body' }, [
      el('div', { class: 'rest-info' }, [
        el('span', { class: 'rest-label', text: '휴식' }),
        el('span', { class: 'rest-time', id: 'rest-remaining', text: E.formatDuration(remaining) }),
      ]),
      el('div', { class: 'rest-why', text: state.rest.reason }),
      el('button', { type: 'button', class: 'rest-skip', text: '+30초', onclick: function () { extendRest(30); } }),
      el('button', { type: 'button', class: 'rest-skip', text: '건너뛰기', onclick: stopRest }),
    ]));

    // 알림 권한은 여기서 묻는다 — 필요한 순간에 물어야 의미가 전달된다.
    if (notificationState() === 'default') {
      host.appendChild(el('button', {
        type: 'button',
        class: 'rest-ask',
        text: '알림을 켜면 폰을 넣어둬도 손목에서 끝나는 걸 알려줍니다 — 켜기',
        onclick: askNotificationPermission,
      }));
    }
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
  var modal = document.getElementById('modal');

  function disposeDemo() {
    if (!state.demo) return;
    state.demo.dispose();
    state.demo = null;
  }

  modal.addEventListener('close', function () {
    disposeDemo();
    modal.textContent = '';
  });

  /**
   * 모달 하나를 돌려쓴다. 제목과 본문만 갈아끼운다.
   *
   * 열려 있을 때 close()부터 부르면 안 된다 — close 이벤트가 비동기로 와서
   * 방금 그린 내용을 나중에 지워버린다. 내용만 갈고 열려 있으면 그대로 둔다.
   */
  function openModal(title, tag, body) {
    disposeDemo();
    modal.textContent = '';
    modal.appendChild(el('div', { class: 'modal-head' }, [
      el('h3', { id: 'modal-title', text: title }),
      tag ? el('span', { class: 'pattern', text: tag }) : null,
      el('button', {
        type: 'button',
        class: 'modal-close',
        'aria-label': '닫기',
        text: '\u00d7',
        onclick: function () { modal.close(); },
      }),
    ]));
    modal.appendChild(el('div', { class: 'modal-body' }, body));
    if (!modal.open) modal.showModal();
  }

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
    renderRest();
    renderLog();
    renderScenarios();
    persist();
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
    else if (state.tab === 'progress') renderProgress();
    else if (state.tab === 'gym') renderGym();
    else renderCheckin();
  }

  /* ── 세션 요약 ─────────────────────────────────── */

  /**
   * 세션이 끝나면 "오늘 뭘 했지"가 남아야 한다.
   * 세트 목록이 아니라, 오늘이 이번 주 계획의 어디쯤이고 무엇이 늘었는지를 보여준다.
   */
  function openSummary() {
    var summary = E.summarizeSession({
      date: state.todayDate,
      name: state.session.name,
      sets: state.todaySets,
      history: state.history,
      index: index,
      landmarks: state.landmarks,
      plan: state.plan,
      durationSeconds: state.sessionStartedAt
        ? Math.round((Date.now() - state.sessionStartedAt) / 1000)
        : undefined,
      volumeOptions: rirOptions(),
    });
    state.summary = summary;

    var body = [];

    body.push(el('div', { class: 'summary-stats' }, [
      el('div', { class: 'summary-stat' }, [
        el('span', { class: 'value', text: String(summary.setsCompleted) }),
        el('span', { class: 'key', text: '세트' }),
      ]),
      el('div', { class: 'summary-stat' }, [
        el('span', { class: 'value', text: String(summary.totalReps) }),
        el('span', { class: 'key', text: '총 반복' }),
      ]),
      el('div', { class: 'summary-stat' }, [
        el('span', { class: 'value', text: fmt(summary.tonnageKg / 1000) + '톤' }),
        el('span', { class: 'key', text: '든 무게' }),
      ]),
    ]));

    var best = E.bestEffort(state.todaySets, rirOptions().rirOffset || 0);
    if (best) {
      var bestExercise = index.get(best.set.exerciseId);
      body.push(el('p', {
        class: 'asset-note',
        text: '오늘 최고 수행 · ' + (bestExercise ? bestExercise.name : best.set.exerciseId) + ' ' +
          best.set.weightKg + 'kg × ' + best.set.reps + '회 (RIR ' + best.set.rir + ') → 추정 1RM ' +
          fmt(best.value) + 'kg' +
          (summary.durationMinutes ? ' · 소요 ' + summary.durationMinutes + '분' : ''),
      }));
    }

    if (summary.records.length > 0) {
      body.push(el('div', { class: 'list-label', text: '오늘 세운 기록' }));
      body.push(el('div', { class: 'summary-list' }, summary.records.map(function (record) {
        return el('div', { class: 'record' }, [
          el('span', { class: 'pr', text: 'PR' }),
          el('span', { text: record.name }),
          el('span', {
            class: 'detail',
            text: record.weightKg + 'kg × ' + record.reps + ' · 1RM ' + fmt(record.estimated1RM),
          }),
        ]);
      })));
    }

    if (summary.highlights.length > 0) {
      body.push(el('div', { class: 'list-label', text: '올린 것' }));
      body.push(el('ul', { class: 'cue-list' }, summary.highlights.map(function (highlight) {
        return el('li', {}, [el('span', { text: highlight.name + ' — ' + highlight.message })]);
      })));
    }

    if (summary.byMuscle.length > 0) {
      body.push(el('div', { class: 'list-label', text: '부위별 · 오늘 / 이번 주' }));
      body.push(el('div', { class: 'summary-list' }, summary.byMuscle.map(function (row) {
        return el('div', { class: 'summary-row' }, [
          el('span', { class: 'muscle', text: row.label }),
          el('span', {
            class: 'nums',
            text: fmt(row.today) + ' / ' + fmt(row.week) + '세트 · MEV ' + row.landmark.mev + ' MRV ' + row.landmark.mrv,
          }),
          el('span', {
            class: 'zone ' + zoneClass(E.zoneOf(row.week, row.landmark)),
            text: row.zone,
          }),
        ]);
      })));
    }

    if (summary.notes.length > 0 || summary.nextWeek) {
      body.push(el('div', { class: 'list-label', text: '다음' }));
      var notes = summary.notes.slice();
      if (summary.nextWeek) notes.push('다음 주 처방 — ' + summary.nextWeek);
      body.push(el('ul', { class: 'cue-list' }, notes.map(function (note) {
        return el('li', {}, [el('span', { text: note })]);
      })));
    }

    openModal(state.session.name, state.todayDate, body);
    pushLog('세션 요약', '<b>' + summary.setsCompleted + '세트</b> · ' + summary.totalReps + '회 · ' +
      fmt(summary.tonnageKg / 1000) + '톤' +
      (summary.records.length > 0 ? ' · 개인 기록 ' + summary.records.length + '건' : ''));
  }

  /* ── 기구 점유 ─────────────────────────────────── */

  /**
   * "스쿼트랙에 사람 있어요."
   *
   * 앱이 이걸 모르면 사용자는 앱을 끄고 아무거나 한다. 엔진은 세 가지 중
   * 하나를 고른다 — 순서를 바꾸거나, 대체하거나, 기다리거나. 순서를 바꾸는
   * 쪽이 항상 먼저다. 대체하면 자극이 달라지지만 미루면 잃는 게 없다.
   */
  function openOccupancy(exercise) {
    var planned = state.lifts.map(function (lift) {
      return { exercise: lift.exercise, sets: lift.sets, painRuling: lift.ruling, note: lift.note };
    });

    var plan = E.planAroundOccupied({
      exercises: planned,
      exerciseId: exercise.id,
      completed: state.lifts
        .filter(function (lift) { return lift.sets.every(function (set) { return set.done; }); })
        .map(function (lift) { return lift.exercise.id; }),
      gym: state.gym,
      pain: activePain(),
      busyEquipment: state.busyEquipment,
    });

    var ACTION = { reorder: '순서 바꾸기', substitute: '대체하기', wait: '기다리기' };
    var body = [];

    body.push(el('div', { class: 'verdict-head ' + plan.action }, [
      el('span', { class: 'verdict-tag', text: ACTION[plan.action] }),
      plan.now ? el('span', { class: 'verdict-now', text: '→ ' + plan.now.name }) : null,
    ]));
    body.push(el('p', { class: 'asset-note', text: plan.reason }));

    if (plan.action === 'reorder' && plan.now) {
      body.push(el('button', {
        type: 'button',
        class: 'finish',
        text: plan.now.name + ' 먼저 하기',
        onclick: function () { applyOccupancy(exercise, plan.now, 'reorder'); },
      }));
    } else if (plan.action === 'substitute' && plan.now) {
      body.push(el('button', {
        type: 'button',
        class: 'finish',
        text: withParticleJs(plan.now.name, '으로/로') + ' 바꾸기',
        onclick: function () { applyOccupancy(exercise, plan.now, 'substitute'); },
      }));
    }

    if (plan.options.length > 0) {
      body.push(el('div', { class: 'list-label', text: '직접 고르기' }));
      body.push(el('div', { class: 'summary-list' }, plan.options.map(function (option) {
        return el('button', {
          type: 'button',
          class: 'option-row',
          onclick: function () { applyOccupancy(exercise, option.exercise, 'substitute'); },
        }, [
          el('span', { class: 'name', text: option.exercise.name }),
          el('span', { class: 'detail', text: option.note }),
        ]);
      })));
    }

    // 한 대가 아니라 구역 전체가 붐빌 때가 있다.
    body.push(el('div', { class: 'list-label', text: '지금 붐비는 기구' }));
    var EQUIPMENT = [
      { id: 'barbell', label: '바벨 · 랙' },
      { id: 'smith', label: '스미스' },
      { id: 'machine', label: '머신' },
      { id: 'cable', label: '케이블' },
      { id: 'dumbbell', label: '덤벨' },
    ];
    body.push(el('div', { class: 'chip-row' }, EQUIPMENT.map(function (item) {
      var on = state.busyEquipment.indexOf(item.id) >= 0;
      return el('button', {
        type: 'button',
        class: 'pick',
        'aria-pressed': String(on),
        text: item.label,
        onclick: function () {
          state.busyEquipment = on
            ? state.busyEquipment.filter(function (id) { return id !== item.id; })
            : state.busyEquipment.concat([item.id]);
          openOccupancy(exercise);
        },
      });
    })));

    openModal(exercise.name, '기구 사용 중', body);
  }

  /** 고른 대안을 오늘 세션에 반영한다. */
  function applyOccupancy(blocked, replacement, action) {
    modal.close();
    var from = state.lifts.findIndex(function (lift) { return lift.exercise.id === blocked.id; });
    if (from < 0) return;

    if (action === 'reorder') {
      var to = state.lifts.findIndex(function (lift) { return lift.exercise.id === replacement.id; });
      if (to < 0) return;
      // 막힌 종목을 당겨온 종목 자리로 민다. 세트 기록은 그대로 따라간다.
      var moved = state.lifts.splice(from, 1)[0];
      state.lifts.splice(to, 0, moved);
      state.occupied[blocked.id] = 'deferred';
      pushLog('기구 점유', '<b>' + replacement.name + '</b>' + particleOf(replacement.name, '을/를') +
        ' 먼저 합니다. ' + withParticleJs(blocked.name, '은/는') + ' 비는 대로 돌아와서 합니다.');
    } else {
      var swapped = buildReplacementLift(state.lifts[from], replacement);
      if (!swapped) return;
      state.lifts[from] = swapped;
      state.occupied[blocked.id] = 'substituted';
      pushLog('기구 점유', '<b>' + blocked.name + '</b> 기구가 사용 중 → <b>' +
        replacement.name + '</b>' + particleOf(replacement.name, '으로/로') + ' 대체했습니다.');
    }
    render();
  }

  /**
   * 대체 종목의 세트를 다시 만든다.
   * 세트 수와 반복 범위는 그대로 두고, 중량만 그 종목 기준으로 다시 잡는다.
   */
  function buildReplacementLift(original, exercise) {
    var loading = E.loadingFor(exercise, state.gym);
    var startingLoad = E.suggestStartingLoad({
      exercise: exercise,
      history: state.history,
      index: index,
      repRange: original.repRange,
      targetRir: original.targetRir,
      loading: loading,
      profile: state.lifter,
    });

    var prescription = E.prescribeLoad(exercise, lastSetsFor(exercise.id), {
      repRange: original.repRange,
      targetRir: original.targetRir,
      rirOffset: rirOptions().rirOffset,
    });

    var weight = prescription.weightKg !== null
      ? prescription.weightKg
      : (startingLoad.weightKg !== null ? startingLoad.weightKg : 20);
    if (loading) weight = E.nearestLoadable(weight, loading, 'down');

    return {
      exercise: exercise,
      substitutedFrom: original.exercise,
      swapReason: 'occupied',
      startingLoad: startingLoad.weightKg !== null && prescription.weightKg === null ? startingLoad : undefined,
      loading: loading,
      warmup: E.planWarmup({
        exercise: exercise,
        workingWeightKg: weight,
        workingReps: original.repRange.max,
        level: state.lifter.level,
        alreadyWarmedMuscles: [],
        loading: loading,
        barKg: loading && loading.kind === 'barbell' ? loading.barKg : undefined,
      }),
      decision: null,
      note: prescription.reason,
      ruling: original.ruling,
      repRange: original.repRange,
      targetRir: original.targetRir,
      sets: original.sets.map(function (set, order) {
        return {
          weightKg: weight,
          estimated: prescription.weightKg === null,
          targetReps: original.repRange,
          targetRir: original.targetRir,
          reps: original.repRange.max,
          rir: null,
          done: false,
          adjustment: null,
        };
      }),
    };
  }

  /** 그 종목을 마지막으로 한 세션의 세트들. 중량 처방의 기준이 된다. */
  function lastSetsFor(exerciseId) {
    for (var i = state.history.length - 1; i >= 0; i -= 1) {
      var sets = state.history[i].sets;
      if (sets.some(function (set) { return set.exerciseId === exerciseId; })) return sets;
    }
    return undefined;
  }

  /** 엔진의 조사 규칙을 화면 문구에도 쓴다. */
  function withParticleJs(word, pair) {
    return E.withParticle(word, pair);
  }

  /** <b>…</b> 뒤에 조사만 붙일 때. 태그가 끼어 있어 단어와 떨어져 있다. */
  function particleOf(word, pair) {
    return E.particle(word, pair);
  }

  /* ── 동작 시연 ─────────────────────────────────── */

  /**
   * 종목 하나의 동작을 3D로 돌린다.
   *
   * 실제 제품에서는 촬영 영상이나 구매한 3D 에셋이 이 자리에 온다. 지금은
   * 엔진의 관절 키프레임으로 절차적 애니메이션을 돌려, 어떤 데이터가
   * 필요하고 화면이 어떻게 생기는지를 먼저 확인한다.
   */
  function openDemo(exercise) {
    var demo = E.demoFor(exercise);
    var body = [];

    var caption = el('div', { class: 'demo-caption', text: '' });
    var fill = el('div', { class: 'demo-track-fill' });
    var track = el('div', { class: 'demo-track' }, [fill]);
    var canvas = el('canvas', { class: 'demo-canvas' });
    var supported = window.FitDemo3D && window.FitDemo3D.available();

    var stage = el('div', { class: 'demo-stage' }, supported
      ? [canvas, caption]
      : [el('div', {
          class: 'demo-fallback',
          text: '이 브라우저에서는 시연을 띄울 수 없습니다. 아래 수행 큐를 참고하세요.',
        })]);
    body.push(stage);

    if (supported) {
      body.push(track);

      var playButton = el('button', { type: 'button', class: 'chip', text: '일시정지' });
      var controls = el('div', { class: 'demo-controls' }, [playButton]);

      var speedChips = [0.5, 1, 1.5].map(function (speed) {
        return el('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(speed === 1),
          text: speed + '\u00d7',
          onclick: function () {
            if (state.demo) state.demo.setSpeed(speed);
            speedChips.forEach(function (chip, i) {
              chip.setAttribute('aria-pressed', String([0.5, 1, 1.5][i] === speed));
            });
          },
        });
      });
      speedChips.forEach(function (chip) { controls.appendChild(chip); });
      controls.appendChild(el('span', {
        class: 'spacer',
        text: '1회 ' + demo.cycleSeconds + '초 · ' +
          (window.FitDemo3D.is3d() ? (demo.view === 'front' ? '정면' : demo.view === 'side' ? '측면' : '사선') : '측면 2D'),
      }));
      body.push(controls);

      playButton.addEventListener('click', function () {
        if (!state.demo) return;
        playButton.textContent = state.demo.toggle() ? '일시정지' : '재생';
      });
    }

    if (demo.cues.length > 0) {
      body.push(el('div', { class: 'list-label', text: '수행 큐' }));
      body.push(el('ul', { class: 'cue-list' }, demo.cues.map(function (cue) {
        return el('li', {}, [el('span', { text: cue })]);
      })));
    }

    if (demo.mistakes.length > 0) {
      body.push(el('div', { class: 'list-label', text: '흔한 실수' }));
      body.push(el('ul', { class: 'cue-list mistakes' }, demo.mistakes.map(function (mistake) {
        return el('li', {}, [el('span', { text: mistake })]);
      })));
    }

    body.push(el('p', {
      class: 'asset-note',
      text: '이 시연은 관절 각도 키프레임으로 그린 예시입니다' +
        (window.FitDemo3D.is3d() ? '' : ' (three.js를 받지 못해 평면으로 그렸습니다)') +
        '. 동작 패턴 10개를 공유하고 종목별로 큐와 실수만 덧붙이는 구조라, ' +
        '나중에 촬영 영상이나 3D 에셋으로 바꿀 때도 종목 ' + index.size + '개를 하나씩 찍지 않고 패턴 단위로 교체하면 됩니다.',
    }));

    openModal(exercise.name, E.PATTERN_LABELS_KO[demo.pattern], body);

    if (!supported) return;

    state.demo = window.FitDemo3D.mount(canvas, demo, {
      dark: prefersDark(),
      onProgress: function (t, label) {
        fill.style.width = (t * 100).toFixed(1) + '%';
        if (label && caption.textContent !== label) caption.textContent = label;
      },
    });
  }

  function prefersDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (err) {
      return false;
    }
  }

  /* 오늘 */
  function renderToday() {
    var phaseBadge = el('span', {
      class: 'badge ' + (state.plan.phase === 'deload' ? 'deload' : 'accum'),
      text: state.plan.phase === 'deload' ? '디로드' : '축적 ' + state.plan.weekInBlock + '주차',
    });

    var estimate = E.estimateSessionTime(state.session, {
      restMultiplier: E.styleProfile(state.style).restMultiplier,
    });

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('div', { class: 'title' }, [
        el('h2', { text: state.session.name }),
        phaseBadge,
      ]),
      el('p', {
        class: 'meta',
        text: state.session.date + ' · 목표 RIR ' + state.plan.targetRir + ' · ' +
          state.lifts.length + '개 종목 · 약 ' + estimate.totalMinutes + '분',
      }),
    ]));

    renderTimeBudget(estimate);

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
      if (state.occupied[lift.exercise.id] === 'deferred') {
        nameRow.appendChild(el('span', { class: 'occupied-tag', text: '뒤로 미룸' }));
      }

      if (lift.startingLoad && lift.startingLoad.needsCalibration) {
        nameRow.appendChild(el('span', {
          class: 'est-tag',
          text: lift.startingLoad.method === 'related-lift' ? '환산 추정' : '기준선 추정',
        }));
      }

      // 이름만으로는 동작을 모른다 — 처방 옆에 늘 시연을 붙여둔다.
      nameRow.appendChild(el('button', {
        type: 'button',
        class: 'demo-open',
        text: '시연',
        'aria-label': lift.exercise.name + ' 동작 시연 보기',
        onclick: function () { openDemo(lift.exercise); },
      }));

      // 헬스장에서 계획이 깨지는 가장 흔한 이유 — 기구에 사람이 있다.
      nameRow.appendChild(el('button', {
        type: 'button',
        class: 'demo-open busy',
        text: '사람 있어요',
        'aria-label': lift.exercise.name + ' 기구가 사용 중일 때 대안 보기',
        onclick: function () { openOccupancy(lift.exercise); },
      }));

      var card = el('div', { class: 'lift' }, [
        el('div', { class: 'lift-head' }, [
          nameRow,
          el('div', { class: 'lift-note', text: lift.note }),
        ]),
      ]);

      card.appendChild(renderWarmup(lift));

      lift.sets.forEach(function (set, setIndex) {
        card.appendChild(renderSetRow(lift, liftIndex, set, setIndex));
      });

      var decision = renderDecision(lift);
      if (decision) card.appendChild(decision);
      card.appendChild(renderTechniques(lift));
      screen.appendChild(card);
    });

    renderMaxTest();
    renderConditioning();
    renderFinish();
  }

  /** 오늘을 닫고 요약을 본다. 세트를 하나도 안 했으면 닫을 것도 없다. */
  function renderFinish() {
    var done = state.todaySets.length;
    screen.appendChild(el('button', {
      type: 'button',
      class: 'finish',
      disabled: done === 0 ? '' : null,
      text: done === 0 ? '세트를 완료하면 세션을 마칠 수 있습니다' : '세션 완료 · ' + done + '세트 요약 보기',
      onclick: function () { if (done > 0) openSummary(); },
    }));
  }

  /** 마지막 세트에 붙일 수 있는 강도 기법. 지금 쓰면 손해인 건 이유와 함께 잠근다. */
  function renderTechniques(lift) {
    var muscle = E.primaryMuscle(lift.exercise);
    var report = E.volumeReport(weekSessions(), state.landmarks, index);
    var status = report.filter(function (row) { return row.muscle === muscle; })[0];

    var options = E.availableTechniques({
      exercise: lift.exercise,
      level: state.lifter.level,
      style: state.style,
      zone: status ? status.zone : 'mevToMav',
      deloadWeek: state.plan.phase === 'deload',
      pain: activePain(),
      isLastSet: true,
    });

    var allowedOnes = options.filter(function (o) { return o.allowed; });
    var wrap = el('div', { class: 'tech-row' }, [
      el('span', { class: 'rir-label', text: '강도 기법' }),
    ]);

    if (allowedOnes.length === 0) {
      wrap.appendChild(el('span', { class: 'tech-blocked', text: options[0] ? options[0].reason : '사용 불가' }));
      return wrap;
    }

    allowedOnes.slice(0, 4).forEach(function (option) {
      wrap.appendChild(el('button', {
        type: 'button', class: 'pick', text: option.technique.label,
        onclick: function () {
          var effect = E.techniqueEffect(option.technique.id);
          pushLog('강도 기법', '<b>' + lift.exercise.name + '</b> 마지막 세트에 ' +
            option.technique.label + ' — ' + option.technique.howTo + ' ' + effect.note);
          renderLog();
        },
      }));
    });
    return wrap;
  }

  /** 한계 돌파 블록에서만 뜨는 최대 중량 시도 계획. */
  function renderMaxTest() {
    if (state.style !== 'peak') return;

    var lift = state.lifts[0];
    if (!lift) return;

    var history = state.history;
    var records = E.personalRecords(history, index);
    var record = records.filter(function (r) { return r.exerciseId === lift.exercise.id; })[0];
    var estimated = record ? record.estimated1RM : 100;
    var loading = lift.loading;

    var plan = E.planMaxTest({
      exercise: lift.exercise,
      estimated1RM: estimated,
      level: state.lifter.level,
      justDeloaded: state.plan.phase !== 'deload',
      weeksAccumulated: 4,
      pain: activePain(),
      snap: loading ? function (w) { return E.nearestLoadable(w, loading, 'nearest'); } : undefined,
    });

    var body = el('div', { class: 'sheet-body' }, []);

    if (!plan.eligible) {
      plan.blockers.forEach(function (blocker) {
        body.appendChild(el('p', { class: 'hint-line warn', text: '✕ ' + blocker }));
      });
    } else {
      var steps = el('div', { class: 'delta-list' }, []);
      plan.warmups.forEach(function (step) {
        steps.appendChild(el('div', { class: 'delta' }, [
          el('span', { text: '워밍업' }),
          el('span', { class: 'num', text: step.weightKg + 'kg × ' + step.reps + '회' }),
          el('span', { class: 'num flat', text: Math.round(step.percent * 100) + '%' }),
        ]));
      });
      plan.attempts.forEach(function (attempt, i) {
        steps.appendChild(el('div', { class: 'delta' }, [
          el('span', { text: (i + 1) + '차 시도' }),
          el('span', { class: 'num up', text: attempt.weightKg + 'kg' }),
          el('span', { class: 'num flat', text: plan.testReps + 'RM' }),
        ]));
      });
      body.appendChild(steps);
      plan.safety.forEach(function (note) {
        body.appendChild(el('p', { class: 'hint-line warn', text: '⚠ ' + note }));
      });
    }

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '한계 테스트 — ' + plan.name }),
        el('span', { class: 'meta', text: plan.testReps + 'RM · 추정 ' + plan.estimated1RM + 'kg' }),
      ]),
      body,
    ]));
  }

  var CONDITIONING_FORMATS = ['amrap', 'emom', 'forTime', 'circuit'];

  function renderConditioning() {
    var body = el('div', { class: 'sheet-body' }, []);

    body.appendChild(el('div', { class: 'chip-row' }, CONDITIONING_FORMATS.map(function (format) {
      return el('button', {
        type: 'button', class: 'pick',
        'aria-pressed': String(state.conditioning && state.conditioning.format === format),
        text: E.FORMAT_LABELS_KO[format],
        onclick: function () {
          var todayMuscles = [];
          state.lifts.forEach(function (lift) {
            var muscle = E.primaryMuscle(lift.exercise);
            if (muscle && todayMuscles.indexOf(muscle) < 0) todayMuscles.push(muscle);
          });
          state.conditioning = E.buildConditioning({
            format: format, minutes: 12, level: state.lifter.level,
            equipmentIds: currentGymEntry() ? currentGymEntry().equipmentIds : E.COMMON_EQUIPMENT_IDS,
            pain: activePain(), avoidMuscles: todayMuscles,
          });
          pushLog('컨디셔닝', '<b>' + state.conditioning.label + ' ' + state.conditioning.durationMinutes +
            '분</b> — 오늘 근력 세션과 겹치는 부위를 피해 구성했습니다. 피로 ' + state.conditioning.fatigueLoad + '세트분');
          render();
        },
      });
    })));

    if (state.conditioning) {
      var workout = state.conditioning;
      body.appendChild(el('p', { class: 'hint-line', text: workout.description + ' · ' + workout.scoring }));

      var moves = el('div', { class: 'delta-list' }, []);
      workout.movements.forEach(function (movement) {
        moves.appendChild(el('div', { class: 'delta' }, [
          el('span', { text: movement.name }),
          el('span', { class: 'num', text: movement.display }),
          el('span', { class: 'num flat', text: movement.note || '' }),
        ]));
      });
      body.appendChild(moves);
      workout.notes.forEach(function (note) {
        body.appendChild(el('p', { class: 'hint-line', text: note }));
      });
      body.appendChild(el('button', {
        type: 'button', class: 'pick', text: '지우기',
        onclick: function () { state.conditioning = null; render(); },
      }));
    } else {
      body.appendChild(el('p', { class: 'hint-line', text:
        '형식을 고르면 12분 세션이 만들어집니다. 오늘 근력 세션과 겹치는 부위는 피하고, 시간에 쫓기면 위험한 동작은 넣지 않습니다.' }));
    }

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '컨디셔닝 추가' }),
        el('span', { class: 'meta', text: '볼륨과 따로 계산' }),
      ]),
      body,
    ]));
  }

  var TIME_BUDGETS = [30, 45, 60, 90];

  /** 오늘 쓸 수 있는 시간. 현실에서 가장 흔한 제약인데 대부분의 앱이 안 받아준다. */
  function renderTimeBudget(estimate) {
    var chips = el('div', { class: 'chip-row' }, []);

    TIME_BUDGETS.concat([null]).forEach(function (minutes) {
      chips.appendChild(el('button', {
        type: 'button', class: 'pick',
        'aria-pressed': String(state.timeBudget === minutes),
        text: minutes === null ? '제한 없음' : minutes + '분',
        onclick: function () {
          state.timeBudget = minutes;
          rebuildSession();
          if (state.timeFit && state.timeFit.adjustments.length > 0) {
            pushLog('시간 예산', '<b>' + minutes + '분</b>에 맞춰 조정했습니다 — ' + state.timeFit.notes[0]);
          }
          render();
        },
      }));
    });

    var body = el('div', { class: 'sheet-body' }, [chips]);

    if (state.timeFit) {
      var fit = state.timeFit;
      body.appendChild(el('p', {
        class: 'hint-line' + (fit.fits ? '' : ' warn'),
        text: Math.round(fit.beforeSeconds / 60) + '분 → ' + Math.round(fit.afterSeconds / 60) + '분' +
          (fit.fits ? '' : ' (예산 초과)'),
      }));

      var dropped = fit.adjustments.filter(function (a) { return a.action === 'drop'; });
      var trimmed = fit.adjustments.filter(function (a) { return a.action === 'trimSets'; });
      if (dropped.length > 0) {
        body.appendChild(el('p', { class: 'hint-line', text:
          '제외: ' + dropped.map(function (a) { return a.name; }).join(', ') }));
      }
      if (trimmed.length > 0) {
        body.appendChild(el('p', { class: 'hint-line', text: '세트 축소 ' + trimmed.length + '건' }));
      }
      fit.notes.forEach(function (note) {
        body.appendChild(el('p', { class: 'hint-line', text: note }));
      });
    } else {
      body.appendChild(el('p', { class: 'hint-line', text:
        '시간을 고르면 그 안에 들어오게 줄입니다. 고립 운동부터 자르고 메인 복합 동작은 지킵니다.' }));
    }

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '오늘 쓸 수 있는 시간' }),
        el('span', { class: 'meta', text: '워밍업 · 휴식 포함' }),
      ]),
      body,
    ]));
  }

  /** 워밍업 램프 — 본세트 중량에 맞춰 올라간다. 볼륨에는 세지 않는다. */
  function renderWarmup(lift) {
    var warmup = lift.warmup;
    var open = state.warmupOpen[lift.exercise.id] !== false;

    var head = el('button', {
      type: 'button', class: 'warmup-head', 'aria-expanded': String(open),
      onclick: function () {
        state.warmupOpen[lift.exercise.id] = !open;
        render();
      },
    }, [
      el('span', { class: 'warmup-label', text: '워밍업' }),
      el('span', { class: 'warmup-summary', text:
        warmup.sets.length === 0
          ? '없음'
          : warmup.sets.length + '세트 · 약 ' + Math.round(warmup.estimatedSeconds / 60) + '분' }),
      el('span', { class: 'warmup-toggle', text: open ? '접기' : '펼치기' }),
    ]);

    var wrap = el('div', { class: 'warmup' }, [head]);
    if (!open) return wrap;

    warmup.sets.forEach(function (set, i) {
      wrap.appendChild(el('div', { class: 'warmup-set' }, [
        el('span', { class: 'set-no', text: 'W' + (i + 1) }),
        el('span', { class: 'warmup-load', text: set.weightKg + 'kg × ' + set.reps + '회' }),
        el('span', { class: 'warmup-pct', text: Math.round(set.percent * 100) + '%' + (set.note ? ' · ' + set.note : '') }),
      ]));
    });
    wrap.appendChild(el('div', { class: 'warmup-note', text: warmup.note }));
    return wrap;
  }

  /** 자동 세트 판단 결과 — 계획보다 잘 나오면 늘리고, 무너지면 멈춘다. */
  function renderDecision(lift) {
    if (!lift.decision) return null;
    var decision = lift.decision;
    var tone = decision.verdict === 'stop' ? ' stop' : decision.verdict === 'continue' ? ' go' : '';

    var row = el('div', { class: 'decision' + tone }, [
      el('span', { class: 'decision-label', text:
        decision.verdict === 'stop' ? '여기까지' : decision.verdict === 'lastSet' ? '마지막 세트' : '계속' }),
      el('span', { class: 'decision-why', text: decision.reason }),
    ]);

    var allDone = lift.sets.every(function (set) { return set.done; });
    if (decision.verdict === 'continue' && allDone) {
      row.appendChild(el('button', {
        type: 'button', class: 'pick', text: '한 세트 추가',
        onclick: function () { addSet(lift); },
      }));
    }
    return row;
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
        el('span', {
          class: 'rir-label',
          title: 'RIR = 이 세트에서 몇 회 더 할 수 있었는지. 세트마다 기록합니다. 0 = 실패 지점.',
          text: 'RIR',
        }),
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
    var report = E.volumeReport(weekSessions(), state.landmarks, index)
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

    renderPersonalization();
  }

  /** 그 부위의 랜드마크가 개인 관측으로 움직였는가. */
  function personalShift(muscle) {
    var result = state.personalization;
    if (!result || !result.applied) return null;
    var match = result.observations.filter(function (obs) {
      return obs.muscle === muscle && obs.moved;
    })[0];
    return match || null;
  }

  /**
   * 개인 볼륨 랜드마크.
   *
   * MEV·MAV·MRV는 개인차가 가장 큰 값인데 지금까지는 모두가 교과서 평균을
   * 썼다. 8주가 쌓이면 그 사람의 기록이 직접 말하게 한다 — 무엇을 보고
   * 얼마나 움직였는지까지 같이 보여줘야 숫자를 믿을 수 있다.
   */
  function renderPersonalization() {
    var result = state.personalization;
    if (!result) return;

    // 숫자가 실제로 바뀐 것만 위에 세우고, 근거만 쌓인 부위는 아래에 따로 적는다.
    var shifted = result.observations.filter(function (obs) { return obs.moved; });
    var watching = result.observations.filter(function (obs) {
      return !obs.moved && (obs.mrvShift !== undefined || obs.mevShift !== undefined);
    });

    var card = el('div', { class: 'person' }, [
      el('div', { class: 'person-head' }, [
        el('div', { class: 'title' }, [
          el('span', { text: '개인 볼륨 랜드마크' }),
          result.applied ? el('span', { class: 'tag-personal', text: '적용됨' }) : null,
        ]),
        el('div', { class: 'meta', text: result.note }),
      ]),
    ]);

    var base = E.landmarksFor(state.lifter.level);

    if (shifted.length === 0 && watching.length === 0) {
      card.appendChild(el('div', { class: 'obs' }, [
        el('div', {
          class: 'why',
          text: result.weeksOfData + '주 기록 · 기준값을 그대로 씁니다. ' +
            '한 주의 컨디션으로 한 사람의 한계를 정할 수는 없습니다.',
        }),
      ]));
      screen.appendChild(card);
      return;
    }

    shifted.forEach(function (obs) {
      var shifts = [];
      if (obs.mevShift !== undefined) {
        shifts.push(shiftNode('MEV', base[obs.muscle].mev, state.landmarks[obs.muscle].mev));
      }
      if (obs.mrvShift !== undefined) {
        shifts.push(shiftNode('MRV', base[obs.muscle].mrv, state.landmarks[obs.muscle].mrv));
      }

      card.appendChild(el('div', { class: 'obs' }, [
        el('div', { class: 'name', text: obs.label }),
        el('div', { class: 'shift' }, shifts),
        el('div', { class: 'why', text: obs.note }),
      ]));
    });

    watching.forEach(function (obs) {
      card.appendChild(el('div', { class: 'obs' }, [
        el('div', { class: 'name', text: obs.label + ' — 관측 중' }),
        el('div', {
          class: 'why',
          text: obs.note + '. 다만 기본값과 차이가 작아 아직 숫자를 옮기지 않았습니다.',
        }),
      ]));
    });

    screen.appendChild(card);
  }

  /** "MRV 25 → 24" — 기준값에서 실제로 적용된 값까지. 관측값은 아래 설명에 따로 쓴다. */
  function shiftNode(label, from, to) {
    return el('span', {}, [
      document.createTextNode(label + ' ' + fmt(from) + ' → '),
      el('span', { class: to > from ? 'up' : 'down', text: fmt(to) + '  ' }),
    ]);
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
        el('span', { class: 'name' }, [
          document.createTextNode(E.MUSCLE_LABELS_KO[row.muscle] + ' '),
          personalShift(row.muscle) ? el('span', { class: 'tag-personal', text: '개인값' }) : null,
        ]),
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

    // 다음 블록 — 하고 싶은 걸 막는 게 아니라 지금 고르면 손해인 걸 알려준다
    var styleContext = {
      level: state.lifter.level,
      recentStyles: state.blockHistory,
      justDeloaded: plan.phase === 'deload',
      painPresent: activePain().some(function (r) { return r.score >= 3; }),
    };
    var suggestion = E.suggestNextStyle(styleContext);
    var styleBody = el('div', { class: 'sheet-body' }, []);

    E.availableStyles(styleContext).forEach(function (option) {
      var isCurrent = option.style === state.style;
      var card = el('button', {
        type: 'button',
        class: 'choice' + (option.allowed ? '' : ' blocked'),
        'aria-pressed': String(isCurrent),
        disabled: option.allowed ? null : 'disabled',
        onclick: function () {
          state.style = option.style;
          state.blockHistory = state.blockHistory.concat([option.style]).slice(-4);
          pushLog('블록 전환', '<b>' + option.profile.label + '</b> 블록으로 바꿨습니다 — ' +
            option.profile.repRanges.primary.min + '-' + option.profile.repRanges.primary.max +
            '회 · 휴식 ×' + option.profile.restMultiplier + ' · ' + option.profile.blockWeeks + '주');
          render();
        },
      }, [
        el('span', { class: 'choice-title', text:
          option.profile.label + (option.style === suggestion.style && option.allowed ? '  · 권장' : '') }),
        el('span', { class: 'choice-hint', text: option.allowed ? option.profile.description : option.reason }),
      ]);
      styleBody.appendChild(card);
    });
    styleBody.appendChild(el('p', { class: 'hint-line', text: '권장 이유: ' + suggestion.reason }));

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '블록 유형' }),
        el('span', { class: 'meta', text: E.styleProfile(state.style).label + ' 진행 중' }),
      ]),
      styleBody,
    ]));

    // RIR 신뢰도 — 엔진 전체가 이 신고값 위에 서 있다
    var calibration = state.session.rirCalibration;
    var calBody = el('div', { class: 'sheet-body' }, [
      el('div', { class: 'reliability' }, [
        el('div', { class: 'reliability-track' }, [
          el('div', {
            class: 'reliability-fill' + (calibration.reliability >= 0.85 ? ' good' : ''),
            style: 'width:' + Math.round(calibration.reliability * 100) + '%',
          }),
        ]),
        el('span', { class: 'num', text: Math.round(calibration.reliability * 100) + '%' }),
      ]),
      el('p', { class: 'hint-line', text: calibration.note }),
    ]);
    calibration.signals.forEach(function (signal) {
      calBody.appendChild(el('p', { class: 'hint-line warn', text: '⚠ ' + signal }));
    });
    if (calibration.applied) {
      calBody.appendChild(el('p', {
        class: 'hint-line',
        text: '적용 보정: 신고 RIR ' + (calibration.offset > 0 ? '+' : '') + calibration.offset +
          ' · 기준 실패 세트 ' + calibration.anchorCount + '개',
      }));
    }

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: 'RIR 신뢰도' }),
        el('span', { class: 'meta', text: calibration.confidence }),
      ]),
      calBody,
    ]));

    // 이번 주 일정
    var schedule = E.buildSchedule({
      templates: state.program.templates,
      daysPerWeek: state.program.daysPerWeek,
      level: state.lifter.level,
      index: index,
    });
    var days = el('div', { class: 'week-strip' }, []);
    E.WEEKDAY_LABELS_KO.forEach(function (label, weekday) {
      var planned = schedule.sessions.filter(function (s) { return s.weekday === weekday; })[0];
      days.appendChild(el('div', { class: 'day' + (planned ? ' on' : '') }, [
        el('span', { class: 'day-label', text: label }),
        el('span', { class: 'day-name', text: planned ? planned.templateName : '휴식' }),
      ]));
    });

    var scheduleBody = el('div', { class: 'sheet-body' }, [days]);
    schedule.notes.forEach(function (note) {
      scheduleBody.appendChild(el('p', { class: 'hint-line', text: note }));
    });
    schedule.warnings.forEach(function (warning) {
      scheduleBody.appendChild(el('p', { class: 'hint-line warn', text: '⚠ ' + warning }));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '이번 주 일정' }),
        el('span', { class: 'meta', text: '주 ' + schedule.daysPerWeek + '회' }),
      ]),
      scheduleBody,
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

  /* 진행 */
  function renderProgress() {
    var calibration = state.session.rirCalibration;
    var options = rirOptions();
    var history = weekSessions().length > 0 ? state.history.concat(
      state.todaySets.length > 0 ? [{ date: state.todayDate, sets: state.todaySets }] : []
    ) : state.history;

    var lifts = E.liftProgress(history, index, options);
    var records = E.personalRecords(history, index, options);

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '진행' }),
      el('p', { class: 'meta', text: '추정 1RM · 주간 볼륨 · 개인 기록' }),
    ]));

    if (lifts.length === 0) {
      screen.appendChild(el('div', { class: 'notice' }, [
        el('div', { text: '같은 종목을 두 번 이상 수행하면 추이가 나타납니다.' }),
      ]));
      return;
    }

    if (!state.progressExerciseId || !lifts.some(function (l) { return l.exerciseId === state.progressExerciseId; })) {
      // 오늘 세션의 첫 종목을 기본으로 둔다. 기록 수로만 고르면 보조 운동이 앞에 온다.
      var todayFirst = state.lifts[0] && state.lifts[0].exercise.id;
      var preferred = lifts.filter(function (l) { return l.exerciseId === todayFirst; })[0];
      state.progressExerciseId = (preferred || lifts[0]).exerciseId;
    }
    var selected = lifts.filter(function (l) { return l.exerciseId === state.progressExerciseId; })[0];

    var todayIds = state.lifts.map(function (l) { return l.exercise.id; });
    var ordered = lifts.slice().sort(function (a, b) {
      var ai = todayIds.indexOf(a.exerciseId), bi = todayIds.indexOf(b.exerciseId);
      if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return b.sessionCount - a.sessionCount;
    });

    var chips = el('div', { class: 'chip-row' }, []);
    ordered.slice(0, 6).forEach(function (lift) {
      chips.appendChild(el('button', {
        type: 'button',
        class: 'pick',
        'aria-pressed': String(lift.exerciseId === state.progressExerciseId),
        text: lift.name,
        onclick: function () { state.progressExerciseId = lift.exerciseId; render(); },
      }));
    });

    var trendClass = selected.trend === 'up' ? 'zone-text-ok' : selected.trend === 'down' ? 'zone-text-over' : 'zone-text-low';
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '추정 1RM' }),
        el('span', {
          class: 'num ' + trendClass,
          text: (selected.changePercent > 0 ? '+' : '') + selected.changePercent + '%',
        }),
      ]),
      el('div', { class: 'sheet-body' }, [
        chips,
        lineChart(selected),
        el('p', { class: 'hint-line', text:
          selected.name + ' · ' + selected.sessionCount + '회 기록 · 최고 ' + selected.best + 'kg' }),
      ]),
    ]));

    // 주간 볼륨 추이 — 주동근 기준
    var muscle = E.primaryMuscle(index.get(selected.exerciseId));
    var trend = E.volumeTrend(history, index, muscle, options);
    if (trend.length >= 2) {
      screen.appendChild(el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-head' }, [
          el('h3', { text: E.MUSCLE_LABELS_KO[muscle] + ' 주간 볼륨' }),
          el('span', { class: 'meta', text: '유효 세트' }),
        ]),
        el('div', { class: 'sheet-body' }, [volumeChart(trend, state.landmarks[muscle])]),
      ]));
    }

    var prList = el('div', { class: 'delta-list' }, []);
    records.slice(0, 6).forEach(function (record) {
      prList.appendChild(el('div', { class: 'delta' }, [
        el('span', { text: record.name + (record.isRecent ? ' ●' : '') }),
        el('span', { class: 'num', text: record.weightKg + 'kg × ' + record.reps + '회' }),
        el('span', { class: 'num', text: record.estimated1RM + 'kg' }),
      ]));
    });
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '개인 기록' }),
        el('span', { class: 'meta', text: '● 최근' }),
      ]),
      el('div', { class: 'sheet-body' }, [prList]),
    ]));
  }

  var SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  /** 추정 1RM 추이 — 단일 계열이라 범례 없이 제목이 계열을 말한다. */
  function lineChart(lift) {
    var W = 320, H = 130, pad = { top: 12, right: 52, bottom: 20, left: 34 };
    var values = lift.points.map(function (p) { return p.value; });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (max - min < 2) { min -= 1; max += 1; }

    var x = function (i) { return pad.left + (W - pad.left - pad.right) * (lift.points.length === 1 ? 0.5 : i / (lift.points.length - 1)); };
    var y = function (v) { return pad.top + (H - pad.top - pad.bottom) * (1 - (v - min) / (max - min)); };

    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': lift.name + ' 추정 1RM 추이' });

    // 격자는 뒤로 물러나 있어야 한다
    [0, 0.5, 1].forEach(function (t) {
      var gy = pad.top + (H - pad.top - pad.bottom) * t;
      root.appendChild(svg('line', { x1: pad.left, y1: gy, x2: W - pad.right, y2: gy,
        stroke: 'var(--grid)', 'stroke-width': 1 }));
      root.appendChild(svg('text', { x: pad.left - 5, y: gy + 3.5, 'text-anchor': 'end',
        'font-size': 8.5, fill: 'var(--muted)', text: String(Math.round(max - (max - min) * t)) }));
    });

    var d = lift.points.map(function (p, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(p.value); }).join(' ');
    root.appendChild(svg('path', { d: d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    lift.points.forEach(function (p, i) {
      var isLast = i === lift.points.length - 1;
      var dot = svg('circle', { cx: x(i), cy: y(p.value), r: isLast ? 4.5 : 3,
        fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2 });
      dot.appendChild(svg('title', { text: p.date + ' · ' + p.value + 'kg' }));
      root.appendChild(dot);
    });

    // 끝점만 직접 라벨링한다 — 모든 점에 숫자를 붙이면 읽을 수 없다
    var last = lift.points[lift.points.length - 1];
    root.appendChild(svg('text', { x: x(lift.points.length - 1) + 7, y: y(last.value) + 3.5,
      'font-size': 10, 'font-weight': 600, fill: 'var(--ink)', text: last.value + 'kg' }));

    root.appendChild(svg('text', { x: pad.left, y: H - 5, 'font-size': 8.5, fill: 'var(--muted)',
      text: lift.points[0].date.slice(5).replace('-', '/') }));
    root.appendChild(svg('text', { x: W - pad.right, y: H - 5, 'text-anchor': 'end',
      'font-size': 8.5, fill: 'var(--muted)', text: last.date.slice(5).replace('-', '/') }));

    return el('div', { class: 'chart' }, [root]);
  }

  /** 주간 볼륨 추이 — MEV/MRV 기준선을 함께 그려 색에만 기대지 않는다. */
  function volumeChart(points, landmark) {
    var W = 320, H = 120, pad = { top: 10, right: 30, bottom: 20, left: 30 };
    var max = Math.max(landmark.mrv * 1.1, Math.max.apply(null, points.map(function (p) { return p.sets; })));
    var plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;
    var slot = plotW / points.length;
    var barW = Math.max(6, slot * 0.6);
    var y = function (v) { return pad.top + plotH * (1 - v / max); };

    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '주간 볼륨 추이' });

    [{ v: landmark.mev, label: 'MEV' }, { v: landmark.mrv, label: 'MRV' }].forEach(function (mark) {
      root.appendChild(svg('line', { x1: pad.left, y1: y(mark.v), x2: W - pad.right, y2: y(mark.v),
        stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
      root.appendChild(svg('text', { x: W - pad.right + 3, y: y(mark.v) + 3,
        'font-size': 8, fill: 'var(--muted)', text: mark.label }));
    });

    points.forEach(function (point, i) {
      var zone = point.sets < landmark.mev ? 'low' : point.sets <= landmark.mav ? 'ok'
        : point.sets <= landmark.mrv ? 'hard' : 'over';
      var height = Math.max(0, plotH - (y(point.sets) - pad.top));
      var rect = svg('rect', {
        x: pad.left + slot * i + (slot - barW) / 2, y: y(point.sets),
        width: barW, height: height, rx: 3, fill: 'var(--zone-' + zone + ')',
      });
      rect.appendChild(svg('title', { text: point.weekStart + ' 주 · ' + point.sets + '세트' }));
      root.appendChild(rect);
    });

    var lastPoint = points[points.length - 1];
    root.appendChild(svg('text', {
      x: pad.left + slot * (points.length - 1) + slot / 2, y: y(lastPoint.sets) - 4,
      'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 600, fill: 'var(--ink)',
      text: String(lastPoint.sets),
    }));
    root.appendChild(svg('text', { x: pad.left, y: H - 5, 'font-size': 8.5, fill: 'var(--muted)',
      text: points[0].weekStart.slice(5).replace('-', '/') }));
    root.appendChild(svg('text', { x: W - pad.right, y: H - 5, 'text-anchor': 'end',
      'font-size': 8.5, fill: 'var(--muted)', text: lastPoint.weekStart.slice(5).replace('-', '/') }));

    return el('div', { class: 'chart' }, [root]);
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

    renderAppStatus();
  }

  /**
   * 설치 · 알림 · 시계 상태.
   *
   * 되는 척하지 않는다. 아티팩트 링크로 열면 서비스 워커가 안 붙고, iOS는
   * 홈 화면에 추가해야 알림이 열린다. 안 되는 이유와 되게 하는 방법을
   * 그대로 적는다.
   */
  function renderAppStatus() {
    var rows = [];

    var installState = pwa.installed
      ? { tone: 'ok', text: '홈 화면에 설치됨 — 오프라인에서도 열립니다' }
      : pwa.installEvent
        ? { tone: 'todo', text: '아직 브라우저에서 보고 있습니다' }
        : isIOS()
          ? { tone: 'todo', text: '공유 버튼 → "홈 화면에 추가"를 눌러 설치합니다' }
          : { tone: 'todo', text: '브라우저 메뉴에서 "앱 설치"를 누르면 설치됩니다' };

    var installRow = el('div', { class: 'status-row' }, [
      el('span', { class: 'status-key', text: '설치' }),
      el('span', { class: 'status-val ' + installState.tone, text: installState.text }),
    ]);
    if (pwa.installEvent) {
      installRow.appendChild(el('button', {
        type: 'button', class: 'pick', text: '설치하기', onclick: promptInstall,
      }));
    }
    rows.push(installRow);

    var offline = pwa.worker
      ? { tone: 'ok', text: '오프라인 준비됨 — 지하에서도 그대로 돕니다' }
      : { tone: 'warn', text: pwa.swError
          ? '이 주소에서는 오프라인 캐시를 붙일 수 없습니다 (' + pwa.swError.slice(0, 60) + ')'
          : '서비스 워커를 등록하는 중입니다' };
    rows.push(el('div', { class: 'status-row' }, [
      el('span', { class: 'status-key', text: '오프라인' }),
      el('span', { class: 'status-val ' + offline.tone, text: offline.text }),
    ]));

    var permission = notificationState();
    var notifyText = {
      granted: '켜짐 — 휴식이 끝나면 알려줍니다',
      denied: '거부됨 — 브라우저 사이트 설정에서 다시 허용해야 합니다',
      default: '아직 묻지 않았습니다',
      unsupported: '이 브라우저는 웹 알림을 지원하지 않습니다',
    }[permission];
    var notifyRow = el('div', { class: 'status-row' }, [
      el('span', { class: 'status-key', text: '알림' }),
      el('span', {
        class: 'status-val ' + (permission === 'granted' ? 'ok' : permission === 'denied' ? 'warn' : 'todo'),
        text: notifyText,
      }),
    ]);
    if (permission === 'default') {
      notifyRow.appendChild(el('button', {
        type: 'button', class: 'pick', text: '켜기', onclick: askNotificationPermission,
      }));
    }
    rows.push(notifyRow);

    rows.push(el('div', { class: 'status-row' }, [
      el('span', { class: 'status-key', text: '화면' }),
      el('span', {
        class: 'status-val ' + (navigator.wakeLock ? 'ok' : 'todo'),
        text: navigator.wakeLock
          ? '휴식 중에는 화면이 꺼지지 않습니다'
          : '이 브라우저는 화면 유지를 지원하지 않습니다',
      }),
    ]));

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '앱 · 알림' }),
        el('span', { class: 'meta', text: 'PWA' }),
      ]),
      el('div', { class: 'sheet-body' }, rows),
    ]));

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '애플워치 · 갤럭시워치' }),
      el('div', {
        text: '두 시계 모두 폰 알림을 그대로 손목에 띄웁니다. 휴식 종료 알림도 같이 갑니다 — ' +
          '갤럭시워치(Wear OS)에서는 "다음 세트 · +30초"를 손목에서 바로 누를 수 있고, ' +
          '애플워치는 알림을 펼쳤을 때 보입니다. ' +
          'iOS는 홈 화면에 추가한 뒤에만 웹 알림이 열립니다(16.4 이상).',
      }),
    ]));

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '한계' }),
      el('div', {
        text: '폰 화면을 끈 채로 오래 두면 브라우저가 타이머를 재우기 때문에, 알림이 몇 초 늦거나 ' +
          '뜨지 않을 수 있습니다. 앱으로 돌아오면 남은 시간은 항상 정확합니다 — 시간을 세는 게 아니라 ' +
          '끝나는 시각을 기억하기 때문입니다. 손목 알림을 100% 보장하려면 서버에서 예약 푸시를 ' +
          '보내야 하고, 받는 쪽 준비는 이미 돼 있습니다.',
      }),
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

  function currentGymEntry() {
    return state.gymBook ? E.activeGym(state.gymBook) : null;
  }

  function useGym(entry) {
    var previous = currentGymEntry();
    state.gymBook = E.switchGym(E.addGym(state.gymBook, entry), entry.id, todayISO());
    state.gym = E.activeProfile(state.gymBook);
    state.answers.gym = { equipmentIds: entry.equipmentIds.slice(), measurements: entry.measurements || {} };

    if (previous && previous.id !== entry.id) {
      var diff = E.compareGyms(previous, entry);
      pushLog('헬스장 전환', '<b>' + entry.name + '</b>' + particleOf(entry.name, '으로/로') + ' 옮겼습니다. ' +
        (diff.lost.length ? '못 하게 되는 종목 ' + diff.lost.length + '개 → 대체됩니다.' : '종목 손실 없음.'));
    }
    loadScenario(state.scenario, true);
    render();
  }

  function renderGym() {
    var book = state.gymBook;
    var active = currentGymEntry();
    var gym = state.gym;

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '헬스장' }),
      el('p', { class: 'meta', text: '여러 곳을 등록해 두고 그날 가는 곳으로 바꿉니다' }),
    ]));

    // 내 헬스장 목록
    var list = el('div', { class: 'sheet-body' }, []);
    book.gyms.forEach(function (entry) {
      var isActive = entry.id === book.activeId;
      var count = E.availableExercises(entry.equipmentIds).length;
      var row = el('button', {
        type: 'button', class: 'gym-row', 'aria-pressed': String(isActive),
        onclick: function () { if (!isActive) useGym(entry); },
      }, [
        el('span', { class: 'gym-name', text: entry.name }),
        el('span', { class: 'gym-meta', text: (entry.note ? entry.note + ' · ' : '') + '종목 ' + count + '개' }),
      ]);
      if (isActive) row.appendChild(el('span', { class: 'gym-badge', text: '사용 중' }));
      list.appendChild(row);
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '내 헬스장' }),
        el('span', { class: 'meta', text: book.gyms.length + '곳' }),
      ]),
      list,
    ]));

    // 찾기
    var searchInput = el('input', {
      type: 'search', id: 'gym-search', value: state.gymQuery,
      placeholder: '이름이나 지역으로 검색',
      oninput: function (event) { state.gymQuery = event.target.value; renderSearchResults(); },
    });

    var resultsHost = el('div', { class: 'search-results', id: 'gym-results' }, []);
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '헬스장 찾기' }),
        el('span', { class: 'meta', text: '내 프로그램 기준' }),
      ]),
      el('div', { class: 'sheet-body' }, [searchInput, resultsHost]),
    ]));
    renderSearchResults();

    // 기구 · 실측 (선택된 곳)
    var benchSpec = E.loadingFor(index.get('barbell-bench-press'), gym);
    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: (active ? active.name : '내 헬스장') + ' 설정' }),
        el('span', { class: 'meta', text: '빈 바 무게 · 스택 간격' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        segmented(BAR_OPTIONS.map(function (option) {
          return {
            label: option.label,
            active: gym.defaults.barbell.barKg === option.kg,
            onSelect: function () {
              gym.defaults.barbell.barKg = option.kg;
              applyGymChange('바 무게를 ' + option.kg + 'kg으로 변경했습니다');
            },
          };
        })),
        el('p', { class: 'hint-line', text: benchSpec ? '벤치프레스 가능 중량: ' + sampleWeights(benchSpec) : '이 헬스장에는 바벨이 없습니다' }),
        segmented(STACK_OPTIONS.map(function (option) {
          return {
            label: '스택 ' + option.label,
            active: gym.defaults.stack.stepKg === option.step,
            onSelect: function () {
              gym.defaults.stack.stepKg = option.step;
              applyGymChange('스택 간격을 ' + option.step + 'kg으로 변경했습니다');
            },
          };
        })),
      ]),
    ]));

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '내 정보' }),
        el('span', { class: 'meta', text: '첫 중량 추정용' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        sliderRow({
          name: '체중 (kg)', value: state.lifter.bodyweightKg, min: 40, max: 130,
          id: 'lifter-bw', marks: ['40', '70', '100', '130'],
          onInput: function (value) {
            state.lifter.bodyweightKg = value;
            loadScenario(state.scenario, true);
            render();
          },
        }),
        el('p', { class: 'hint-line', text: startingLoadPreview() }),
      ]),
    ]));

    screen.appendChild(el('div', { class: 'wizard-nav' }, [
      el('button', { type: 'button', class: 'ghost', text: '초기 설정 다시 하기', onclick: startOnboarding }),
    ]));
  }

  function renderSearchResults() {
    var host = document.getElementById('gym-results');
    if (!host) return;
    host.textContent = '';

    var results = E.searchGyms(state.gymQuery, {
      near: { lat: 37.5, lng: 127.03 },
      program: state.program,
      directory: fullDirectory(),
    });

    if (results.length === 0) {
      host.appendChild(el('p', {
        class: 'hint-line',
        text: state.gymQuery.trim().length === 0
          ? '이름이나 지역을 입력하면 근처 헬스장을 찾습니다.'
          : '검색 결과가 없습니다. 아파트나 회사 헬스장은 원래 검색에 나오지 않습니다.',
      }));
      host.appendChild(registerButton());
      return;
    }

    results.forEach(function (result) {
      var fit = Math.round((result.programFit || 0) * 100);
      var already = state.gymBook.gyms.some(function (g) { return g.id === result.entry.id; });

      var card = el('div', { class: 'search-row' }, [
        el('div', { class: 'search-main' }, [
          el('span', { class: 'gym-name', text: result.entry.name }),
          el('span', { class: 'gym-meta', text:
            (result.distanceKm !== undefined ? result.distanceKm + 'km · ' : '') +
            '종목 ' + result.exerciseCount + '개 · 프로그램 ' + fit + '%' }),
        ]),
        el('button', {
          type: 'button', class: 'pick', text: already ? '등록됨' : '추가',
          disabled: already ? 'disabled' : null,
          onclick: function () { if (!already) useGym(E.toGymEntry(result.entry)); },
        }),
      ]);

      if (result.missing.length > 0) {
        card.appendChild(el('div', { class: 'search-missing', text:
          '불가: ' + result.missing.slice(0, 3).map(function (e) { return e.name; }).join(', ') +
          (result.missing.length > 3 ? ' 외 ' + (result.missing.length - 3) + '개' : '') }));
      }
      host.appendChild(card);
    });

    host.appendChild(registerButton());
    host.appendChild(el('p', { class: 'hint-line', text:
      '표시된 목록은 구조를 보여주는 예시 데이터입니다. 실제로는 지도 API와 사용자가 올린 기구 정보로 채워집니다.' }));
  }

  /**
   * 직접 등록으로 가는 문.
   *
   * 검색 결과 아래에만 둔다. 먼저 찾아보게 만드는 것이 중복을 막는 가장 싼
   * 방법이다 — 대부분의 중복은 악의가 아니라 검색을 안 해봐서 생긴다.
   */
  function registerButton() {
    return el('button', {
      type: 'button',
      class: 'register-open',
      text: '찾는 곳이 없나요? 직접 등록하기',
      onclick: function () { openGymRegister(); },
    });
  }

  /** 지금 판정에 쓰는 전체 목록 — 공개 예시 + 내가 만든 것. */
  function fullDirectory() {
    return E.SAMPLE_DIRECTORY.concat(state.myDirectory);
  }

  /* ── 헬스장 직접 등록 ───────────────────────────── */

  /**
   * 아파트 커뮤니티 헬스장, 회사 헬스장, 홈짐은 검색에 절대 안 나온다.
   * 그래서 등록 경로가 반드시 있어야 하는데, 그 경로가 중복을 만드는 문이
   * 되면 안 된다. 그래서 유형 → 이름 → 중복 확인 순으로만 진행한다.
   */
  function openGymRegister(draft) {
    state.gymDraft = draft || state.gymDraft || {
      presetId: null,
      name: state.gymQuery.trim(),
      floor: '',
      step: 'type',
    };
    renderGymRegister();
  }

  function renderGymRegister() {
    var draft = state.gymDraft;
    var body = [];

    if (draft.step === 'type') {
      body.push(el('p', { class: 'asset-note', text:
        '어떤 곳인지 고르면 기구가 대부분 채워집니다. 틀린 건 운동하면서 ' +
        '"이 기구 없어요"로 빼면 되니 정확하지 않아도 됩니다.' }));

      E.GYM_PRESETS.forEach(function (preset) {
        var row = el('button', {
          type: 'button',
          class: 'choice',
          'aria-pressed': String(draft.presetId === preset.id),
          onclick: function () {
            draft.presetId = preset.id;
            draft.step = 'detail';
            renderGymRegister();
          },
        }, [
          el('span', { class: 'choice-title', text: preset.label }),
          el('span', { class: 'choice-hint', text: preset.hint }),
          el('span', { class: 'choice-hint', text:
            '기구 ' + E.presetEquipment(preset.id).length + '개' +
            (preset.visibility === 'private' ? ' · 나만 봅니다' : '') }),
        ]);
        body.push(row);
      });

      openModal('헬스장 등록', '1 / 2', body);
      return;
    }

    var preset = E.gymPreset(draft.presetId);
    var nameInput = el('input', {
      type: 'search', value: draft.name, placeholder: '헬스장 이름',
      oninput: function (event) { draft.name = event.target.value; },
    });
    var floorInput = el('input', {
      type: 'search', value: draft.floor, placeholder: '층 (예: 3층, 지하 1층)',
      oninput: function (event) { draft.floor = event.target.value; },
    });

    body.push(el('div', { class: 'verdict-head' }, [
      el('span', { class: 'verdict-tag', text: preset.label }),
      el('button', {
        type: 'button', class: 'pick', text: '유형 바꾸기',
        onclick: function () { draft.step = 'type'; renderGymRegister(); },
      }),
    ]));
    body.push(el('div', { class: 'list-label', text: '이름' }));
    body.push(nameInput);
    body.push(el('div', { class: 'list-label', text: '층' }));
    body.push(floorInput);
    body.push(el('p', { class: 'asset-note', text:
      '같은 건물 3층과 5층에 다른 헬스장이 있는 경우가 흔합니다. 층을 적어두면 ' +
      '다른 사람이 등록한 곳과 헷갈리지 않습니다.' }));

    if (preset.visibility === 'private') {
      body.push(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '나만 봅니다' }),
        el('div', { text: withParticleJs(preset.label, '은/는') + ' 검색에 올리지 않습니다. 이 기록은 내 목록에만 남습니다.' }),
      ]));
    }

    body.push(el('button', {
      type: 'button', class: 'finish',
      text: '등록하기',
      onclick: function () { submitGymRegister(false); },
    }));

    openModal('헬스장 등록', '2 / 2', body);
  }

  /** 등록 시도. 겹치는 곳이 있으면 만들지 않고 먼저 보여준다. */
  function submitGymRegister(force) {
    var draft = state.gymDraft;
    var name = (draft.name || '').trim();
    if (name.length === 0) return;

    var result = E.registerGym({
      name: name,
      address: draft.floor,
      // 프로토타입에는 GPS가 없다. 실제 앱에서는 현재 좌표가 들어온다.
      location: { lat: 37.5, lng: 127.03 },
      presetId: draft.presetId,
      directory: fullDirectory(),
      force: force,
      today: todayISO(),
    });

    if (result.outcome === 'confirm') {
      showGymCandidates(result);
      return;
    }

    if (result.outcome === 'joined') {
      pushLog('헬스장', '<b>' + result.entry.name + '</b>' + particleOf(result.entry.name, '은/는') +
        ' 이미 등록된 곳이라 그대로 씁니다.');
    } else {
      state.myDirectory = state.myDirectory.concat([result.entry]);
      pushLog('헬스장', '<b>' + result.entry.name + '</b>' + particleOf(result.entry.name, '을/를') +
        ' 새로 등록했습니다. ' +
        '기구 ' + result.entry.equipmentIds.length + '개로 시작합니다.');
    }

    state.gymDraft = null;
    modal.close();
    useGym(E.toGymEntry(result.entry));
  }

  /**
   * "혹시 이거 아닌가요?"
   *
   * 여기서 만들지 않는 것이 핵심이다. 사용자가 고르기 전에는 새 항목이
   * 생기지 않는다.
   */
  function showGymCandidates(result) {
    var body = [];
    body.push(el('p', { class: 'asset-note', text: result.message }));

    body.push(el('div', { class: 'summary-list' }, result.candidates.map(function (hit) {
      return el('button', {
        type: 'button', class: 'option-row',
        onclick: function () {
          state.gymDraft = null;
          modal.close();
          pushLog('헬스장', '<b>' + hit.entry.name + '</b>' + particleOf(hit.entry.name, '으로/로') +
            ' 합쳤습니다. ' + hit.match.reason);
          useGym(E.toGymEntry(hit.entry));
        },
      }, [
        el('span', { class: 'name', text: hit.entry.name }),
        el('span', { class: 'detail', text: hit.match.verdict === 'same' ? '같은 곳' : '확인 필요' }),
        el('span', { class: 'why', text: hit.match.reason }),
      ]);
    })));

    body.push(el('button', {
      type: 'button', class: 'finish',
      text: '아니요, 다른 곳입니다 — 새로 등록',
      onclick: function () { submitGymRegister(true); },
    }));

    openModal('혹시 이 곳인가요?', '중복 확인', body);
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
    storage.reset();
    state.todaySets = [];
    state.answers = JSON.parse(JSON.stringify(DEFAULT_ANSWERS));
    state.answers.gym.measurements = {};
    state.onboarding = { active: true, step: 0 };
    render();
  }

  function completeOnboarding() {
    var result = E.runOnboarding(state.answers);
    state.gymBook = E.createGymBook({
      id: 'my-gym', name: '내 헬스장',
      equipmentIds: state.answers.gym.equipmentIds.slice(),
      measurements: state.answers.gym.measurements,
    });
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

  if (!restore()) loadScenario('normal', true);
  registerWorker();
  render();
})();

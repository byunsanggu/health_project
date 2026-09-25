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
        /*
         * 어디까지 했는지도 저장한다. 헬스장에서 화면이 꺼지거나 앱이
         * 다시 뜨는 일은 늘 있는데, 그때마다 목록 화면으로 돌아가서
         * 몇 번째였는지 다시 찾게 하면 안 된다.
         */
        started: state.started,
        sessionClosed: state.sessionClosed,
        liftCursor: state.liftCursor,
        dayOverride: state.dayOverride,
        liftOrder: state.liftOrder,
        supersets: state.supersets,
        wodResults: state.wodResults,
        sessionStartedAt: state.sessionStartedAt,
        gymBook: state.gymBook,
        consent: state.consent,
        consentRecord: state.consentRecord,
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

    /*
     * 동의 문구가 바뀌었으면 다시 묻는다. 사용자는 이전 판에 동의했을 뿐,
     * 바뀐 내용에 동의한 적이 없다. 필수 동의가 빠져도 마찬가지다.
     */
    if (E.needsReconsent(settings.consentRecord) || !E.canUseService(settings.consent || [])) {
      return false;
    }

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
      state.started = Boolean(settings.started);
      state.sessionClosed = Boolean(settings.sessionClosed);
      state.liftCursor = settings.liftCursor || 0;
      state.dayOverride = settings.dayOverride == null ? null : settings.dayOverride;
      state.liftOrder = settings.liftOrder || null;
      state.supersets = settings.supersets || [];
      state.wodResults = settings.wodResults || [];
      state.sessionStartedAt = settings.sessionStartedAt || null;
      state.consent = settings.consent || [];
      state.consentRecord = settings.consentRecord || null;
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
    goals: ['hypertrophy'],
    gym: { equipmentIds: E.COMMON_EQUIPMENT_IDS.slice() },
  };

  /** 주당 일수별 훈련 요일 (월=0). */
  var WEEK_OFFSETS = {
    1: [2],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
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

  /** 프로그램상 오늘 할 차례. */
  function scheduledTemplateIndex() {
    return todayIndex() % state.program.templates.length;
  }

  /** 실제로 오늘 할 날. 직접 고른 게 있으면 그것. */
  function currentTemplateIndex() {
    var count = state.program.templates.length;
    if (state.dayOverride == null) return scheduledTemplateIndex();
    // 프로그램을 다시 만들면 날 수가 줄 수 있다. 밖으로 나가지 않게 잡는다.
    return Math.min(state.dayOverride, count - 1);
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
    homeGymId: null,
    equipmentQuery: '',
    // 동의한 항목. 이게 비면 아무것도 묻지 않는다.
    consent: [],
    consentRecord: null,
    // 사용자가 직접 등록한 곳. 공개 디렉터리에 없는 아파트·회사 헬스장이 여기 쌓인다.
    myDirectory: [],
    gymDraft: null,
    style: 'hypertrophy',
    blockHistory: ['hypertrophy'],
    conditioning: null,
    timeBudget: null,
    timeFit: null,
    warmupOpen: {},
    doneOpen: {},
    // 위쪽 요약 카드 중 펼쳐진 것. null이면 둘 다 접힘.
    statOpen: null,
    /*
     * 직접 바꾼 종목 순서(id 배열). null이면 프로그램이 짜 준 순서.
     * 세션이 다시 짜여도 유지된다 — 시간을 줄였다고 순서가 돌아가면 안 된다.
     */
    liftOrder: null,
    /*
     * 묶은 것들. [[종목id, 종목id, ...], ...] — 둘이면 슈퍼세트,
     * 셋에서 다섯이면 크로스핏 세트다. 배열 순서가 곧 바퀴 도는 순서다.
     */
    supersets: [],
    // 지금 담는 중인 바퀴(종목 id 배열). 하나씩 눌러 담는 방식이다.
    supersetPick: [],
    // 와드 설정. 길이와 바벨 여부가 성격을 크게 바꾼다.
    wodMinutes: 12,
    wodBarbell: false,
    conditioningFormat: null,
    /* 와드 기록. 같은 구성끼리만 비교한다 — 다른 와드를 비교하면 거짓말이다. */
    wodResults: [],
    wodDraft: null,
    gymQuery: '',
    maxTest: null,
    /*
     * 오늘을 시작했는가. 시작 전에는 목록만 보여주고, 시작한 뒤에는
     * 한 종목씩만 보여준다. 한 화면에 일곱 개가 깔려 있으면 시작하기
     * 전에 지친다 — 헬스장에서 실제로 필요한 건 "지금 이거" 하나다.
     */
    started: false,
    // 오늘을 마쳤는가. 마치면 목록 대신 "오늘 끝" 화면이 나온다.
    sessionClosed: false,
    liftCursor: 0,
    /*
     * 오늘 할 날을 직접 고른 경우의 템플릿 번호. null이면 프로그램 순서대로.
     * 현장에서는 순서대로 안 온다 — "오늘 상체 하고 싶다"가 매주 있다.
     */
    dayOverride: null,
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
  function perform(planned, decay, gymId) {
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
    return { date: planned.date, sets: sets, gymId: gymId };
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
        history.push(perform(planned, scenario.decay * weekInBlock, homeGymId()));
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
    // 통증 기록에 동의하지 않았으면 쓰지 않는다. 화면에서만 감추면 동의가 아니다.
    if (!E.allows(state.consent, 'painGate')) return [];
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
      template: state.program.templates[currentTemplateIndex()],
      date: state.todayDate,
      plan: state.plan,
      history: state.history,
      index: index,
      pain: activePain(),
      gym: state.gym,
      // 머신·케이블 중량은 이 헬스장 기록만 본다 — 기계마다 표기가 다르다.
      gymId: state.gymBook ? state.gymBook.activeId : undefined,
      lifter: state.lifter,
    });

    // 오늘 운동 할 수 있는 시간이 정해져 있으면 그 안에 들어오게 줄인다.
    state.timeFit = null;
    if (state.timeBudget) {
      var profile = E.styleProfile(state.style);
      state.timeFit = E.fitToTimeBudget(built, state.timeBudget, {
        restMultiplier: profile.restMultiplier,
        allowShortRest: state.style === 'density',
      });
      built = state.timeFit.session;
    }
    /*
     * 직접 바꾼 순서를 여기서 적용한다. 워밍업을 계산하기 **전**이어야
     * 한다 — "앞 종목이 데운 부위는 짧게"가 순서에 달려 있다.
     */
    /*
     * 종목이 교체되거나 빠지면 짝이 깨진다. 한쪽만 남은 슈퍼세트는
     * 그냥 단일 종목이므로 버린다.
     */
    var presentIds = built.exercises.map(function (item) { return item.exercise.id; });
    state.supersets = E.pruneGroups(state.supersets, presentIds);

    var ordered = E.applyOrder(built.exercises, state.liftOrder, function (item) {
      return item.exercise.id;
    });
    /*
     * 묶은 짝은 나란히 놓는다 — 떨어져 있으면 번갈아 할 수가 없다.
     * 순서를 적용한 뒤에 해야 사용자가 앞에 둔 것이 앞에 남는다.
     */
    var laid = E.orderWithGroups(
      ordered.map(function (item) { return item.exercise.id; }), state.supersets);
    built = Object.assign({}, built, {
      exercises: E.applyOrder(ordered, laid, function (item) { return item.exercise.id; }),
    });
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
        gymWeightNote: item.gymWeightNote,
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
    if (state.todaySets.length > 0) {
      sessions = sessions.concat([{ date: state.todayDate, sets: state.todaySets, gymId: activeGymId() }]);
    }
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
    // 되돌릴 때 이 항목만 정확히 빼려고 붙여 둔다. 같은 중량·반복이 여러 번
    // 나오므로 값으로 찾으면 엉뚱한 세트가 지워진다.
    set.logged = logged;

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

    /*
     * 슈퍼세트로 묶였으면 짝과 번갈아 간다.
     *
     * A1 → (짧게) → B1 → (원래 휴식) → A2 → ... 가 한 바퀴다. 끝낸 세트
     * 수를 비교해서 짝이 덜 했으면 짝으로 넘어가고, 같으면 한 바퀴가
     * 끝난 것이므로 제대로 쉰다.
     */
    var pairState = supersetTurn(lift, liftIndex);
    startRest(lift, setIndex, pairState ? pairState.rest : null);
    if (pairState && pairState.nextIndex >= 0) state.liftCursor = pairState.nextIndex;

    /*
     * 그 종목의 세트를 다 했으면 다음 종목으로 옮겨준다.
     *
     * 헬스장에서는 끝나면 다음 기구로 걸어간다. 화면이 그 자리에 머물러
     * 있으면 사용자가 버튼을 찾아 눌러야 하는데, 그건 앱이 할 일이다.
     * 휴식 타이머는 화면 아래에 계속 있으므로 걸어가면서 쉬면 된다.
     *
     * 다만 "한 세트 더" 판단이 붙었으면 옮기지 않는다 — 그걸 물어보려고
     * 계산한 것인데 화면을 넘겨버리면 물어볼 기회가 사라진다.
     */
    var remaining = lift.sets.filter(function (item) { return !item.done; }).length;
    var wantsMore = lift.decision && lift.decision.verdict === 'continue';
    // 짝이 아직 남았으면 위에서 이미 그쪽으로 옮겼다. 여기서 또 건드리지 않는다.
    if (!pairState && state.started && remaining === 0 && !wantsMore && liftIndex < state.lifts.length - 1) {
      state.liftCursor = liftIndex + 1;
      var nextName = state.lifts[liftIndex + 1].exercise.name;
      pushLog('다음 종목',
        '<b>' + lift.exercise.name + '</b>' + particleOf(lift.exercise.name, '을/를') +
        ' 마치고 <b>' + nextName + '</b>' + particleOf(nextName, '으로/로') + ' 넘어갑니다.');
    }

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

  /**
   * 묶인 종목에서 지금 어디로 가야 하는가.
   *
   * 둘이면 슈퍼세트, 셋 이상이면 크로스핏 세트다. 계산은 같다 —
   * 바퀴 안에서는 옮기는 만큼만 쉬고, 한 바퀴를 마치면 제대로 쉰다.
   *
   * 묶이지 않았으면 null — 평소대로 간다.
   */
  function supersetTurn(lift, liftIndex) {
    if (!state.started) return null;
    var group = E.groupOf(state.supersets, lift.exercise.id);
    if (!group) return null;

    // 묶인 순서대로, 지금 세션에 남아 있는 종목만 모은다
    var members = [];
    group.forEach(function (id) {
      for (var i = 0; i < state.lifts.length; i += 1) {
        if (state.lifts[i].exercise.id === id) { members.push({ index: i, lift: state.lifts[i] }); return; }
      }
    });
    if (members.length < 2) return null;

    var here = -1;
    for (var m = 0; m < members.length; m += 1) {
      if (members[m].lift.exercise.id === lift.exercise.id) { here = m; break; }
    }
    if (here < 0) return null;

    /*
     * 바퀴를 한 칸씩 돌며 아직 남은 종목을 찾는다. 목록 끝을 넘어
     * 처음으로 돌아왔으면 한 바퀴가 끝난 것이다.
     */
    var next = null;
    var wrapped = false;
    for (var step = 1; step <= members.length; step += 1) {
      var at = (here + step) % members.length;
      if (at <= here) wrapped = true;
      var candidate = members[at];
      if (candidate.lift.exercise.id === lift.exercise.id) continue;
      if (candidate.lift.sets.some(function (set) { return !set.done; })) { next = candidate; break; }
    }
    if (!next) return null;

    var timing = E.circuitTiming(
      members.map(function (item) { return item.lift.exercise; }),
      E.restFor({
        exercise: lift.exercise,
        reps: lift.sets[0] ? lift.sets[0].reps : 10,
        targetRir: lift.targetRir,
      }).seconds,
    );
    var label = E.groupLabel(group);

    // 아직 바퀴 안이면 옮기는 시간만 쉰다
    if (!wrapped) {
      return {
        nextIndex: next.index,
        rest: {
          /*
           * 휴식 줄은 한 줄이라 뒤가 잘린다. 지금 어디로 가야 하는지를
           * 앞에 쓴다 — 잘려도 읽을 수 있어야 하는 건 그쪽이다.
           */
          seconds: E.transitionRest(lift.exercise, next.lift.exercise),
          reason: withParticleJs(next.lift.exercise.name, '으로/로') +
            ' 옮기는 동안만 쉽니다 · ' + label,
        },
      };
    }

    // 한 바퀴가 끝났다. 제대로 쉬고 바퀴의 처음으로 돌아간다.
    return {
      nextIndex: next.index,
      rest: {
        seconds: timing.afterSeconds,
        reason: label + ' 한 바퀴를 마쳤습니다. 여기서는 제대로 쉽니다.',
      },
    };
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

  function startRest(lift, setIndex, override) {
    var isLast = setIndex === lift.sets.length - 1;
    var prescription = E.restFor({
      exercise: lift.exercise,
      reps: lift.sets[setIndex].reps,
      targetRir: lift.targetRir,
      isLastSet: isLast,
    });

    /*
     * 슈퍼세트로 묶였으면 짝으로 넘어가는 동안만 쉰다. 한 바퀴를 마친
     * 뒤에는 원래 휴식을 그대로 쓴다 — 거기서 깎으면 뒤 세트가 무너진다.
     */
    var seconds = override ? override.seconds : prescription.seconds;
    var reason = override ? override.reason : prescription.reason;

    state.rest = {
      exerciseName: lift.exercise.name,
      setNumber: setIndex + 1,
      total: seconds,
      endsAt: Date.now() + seconds * 1000,
      reason: reason,
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
  /**
   * 휴식을 늘리거나 줄인다.
   *
   * 줄여서 남은 시간이 없어지면 그냥 끝낸다 — 0초짜리 타이머를 띄워 두는
   * 것보다 다음 세트로 넘어가는 게 사용자가 원한 것이다.
   */
  function extendRest(seconds) {
    if (!state.rest) return;
    if (restRemaining() + seconds <= 0) return stopRest();

    state.rest.endsAt += seconds * 1000;
    // 진행 막대가 100%를 넘지 않게 총량도 같이 줄인다.
    state.rest.total = Math.max(restRemaining(), state.rest.total + seconds);
    notifyWorker({
      type: 'rest:start',
      endsAt: state.rest.endsAt,
      body: seconds > 0 ? '연장한 휴식이 끝났습니다.' : '휴식이 끝났습니다.',
    });
    renderRest();
  }

  /**
   * 시작하고 나서 얼마나 지났는가.
   *
   * 남은 시간을 세는 대신 시작한 시각을 저장해두고 매번 지금과 뺀다.
   * 화면이 꺼져 있던 동안도 정확하고, 앱이 다시 떠도 이어진다.
   */
  function elapsedSeconds() {
    if (!state.sessionStartedAt) return 0;
    return Math.max(0, Math.round((Date.now() - state.sessionStartedAt) / 1000));
  }

  function elapsedText() {
    var total = elapsedSeconds();
    var hours = Math.floor(total / 3600);
    var rest = total % 3600;
    var body = E.formatDuration(rest);
    // 한 시간을 넘기면 분만으로는 못 읽는다
    return hours > 0 ? hours + ':' + body.padStart(4, '0') : body;
  }

  function tickElapsed() {
    var node = document.getElementById('session-elapsed');
    if (node) node.textContent = elapsedText();
  }

  // 화면 전체를 다시 그리지 않고 숫자만 바꾼다 — 1초마다 다시 그리면 못 쓴다.
  setInterval(tickElapsed, 1000);

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
      // 버튼은 한 묶음으로 — 셋을 그리드 칸에 하나씩 흘리면 줄이 무너진다.
      /*
       * 버튼은 한 묶음으로 — 셋을 그리드 칸에 하나씩 흘리면 줄이 무너진다.
       *
       * aria-label로 "휴식 30초 늘리기"를 주면 보이는 글자("+30초")와
       * 읽히는 이름이 달라진다. 음성으로 "플러스 삼십초"라고 말하는
       * 사용자는 그 버튼을 못 누른다. 설명은 title로 주고 이름은 글자
       * 그대로 둔다.
       */
      el('div', { class: 'rest-actions' }, [
        el('button', { type: 'button', class: 'rest-skip', text: '−30초',
          title: '휴식을 30초 줄입니다', onclick: function () { extendRest(-30); } }),
        el('button', { type: 'button', class: 'rest-skip', text: '+30초',
          title: '휴식을 30초 늘립니다', onclick: function () { extendRest(30); } }),
        el('button', { type: 'button', class: 'rest-skip', text: '건너뛰기',
          title: '휴식을 끝내고 다음 세트로', onclick: stopRest }),
      ]),
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

  function typeReps(liftIndex, setIndex, raw) {
    var value = parseInt(raw, 10);
    // 빈칸이나 이상한 값이면 원래 값을 그대로 둔다 — 0회를 기록할 일은 없다.
    if (!Number.isFinite(value) || value < 1) return render();
    state.lifts[liftIndex].sets[setIndex].reps = clamp(value, 1, 100);
    render();
  }

  function setWeight(liftIndex, setIndex, weightKg) {
    var set = state.lifts[liftIndex].sets[setIndex];
    set.weightKg = Math.round(weightKg * 100) / 100;
    // 직접 정한 값이므로 더 이상 추정이 아니다. 화면의 "추정" 표시가 사라진다.
    set.estimated = false;
    render();
  }

  function typeWeight(liftIndex, setIndex, raw) {
    var value = parseFloat(raw);
    if (!Number.isFinite(value) || value < 0) return render();
    setWeight(liftIndex, setIndex, Math.min(999, value));
  }

  /**
   * ± 한 번에 얼마나 움직일까.
   *
   * 종목마다 다르다 — 바벨은 플레이트 한 쌍(보통 2.5kg), 덤벨은 사다리
   * 간격, 스택 머신은 한 판. 1kg씩 움직이면 바벨에서 못 만드는 무게만
   * 나온다.
   */
  function stepWeight(liftIndex, setIndex, direction) {
    var lift = state.lifts[liftIndex];
    var set = lift.sets[setIndex];
    if (!lift.loading) {
      return setWeight(liftIndex, setIndex, Math.max(0, set.weightKg + direction * (lift.exercise.increment || 2.5)));
    }
    /*
     * 만들 수 있는 무게 목록에서 한 칸 옮긴다. 증분을 더하는 것보다
     * 정확하다 — 덤벨은 간격이 일정하지 않다(20, 22.5, 25, 30...).
     */
    var moved = E.neighborLoad(set.weightKg, lift.loading, direction);
    if (moved !== set.weightKg) setWeight(liftIndex, setIndex, moved);
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

  /*
   * 화면이 바뀌면 맨 위로 올린다.
   *
   * #screen은 재사용되므로 스크롤 위치가 그대로 남는다. 초기 설정에서
   * 한참 내려간 상태로 오늘 탭에 들어오면 세션 이름과 시간 설정을 지나친
   * 자리에서 시작한다. 반대로 RIR을 탭할 때마다 위로 튀면 못 쓴다 —
   * 그래서 "어느 화면인가"가 바뀔 때만 올린다.
   */
  function viewKey() {
    if (state.onboarding.active) return 'onboarding:' + state.onboarding.step;
    return state.tab + ':' + (state.started ? 'lift:' + state.liftCursor : 'plan');
  }
  var lastViewKey = null;

  function render() {
    var onboarding = state.onboarding.active;
    tabbar.hidden = onboarding;

    var key = viewKey();
    var moved = key !== lastViewKey;
    lastViewKey = key;

    screen.textContent = '';
    if (onboarding) {
      statusMeta.textContent = '초기 설정';
      renderOnboarding();
    } else {
      renderTabs();
      renderStatus();
      renderScreen();
    }
    if (moved) screen.scrollTop = 0;

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

    /*
     * "오늘 몇 세트 했다"는 끝나고 나면 아무 감흥이 없다. 알고 싶은 건
     * 늘었는가이고, 그건 지난번의 나와 비교해야 나온다.
     *
     * 무게를 그냥 비교하면 안 된다 — 지난주 60kg 10회와 오늘 80kg 5회 중
     * 어느 쪽이 나은지는 무게만 봐서는 모른다. 추정 1RM으로 환산해 재되,
     * 환산값만 내보내지 않고 실제로 든 세트를 같이 붙인다.
     */
    var comparisons = E.compareToPast({
      todaySets: state.todaySets,
      today: state.todayDate,
      history: state.history,
      index: index,
      rirOffset: rirOptions().rirOffset || 0,
    });

    if (comparisons.length > 0) {
      var rollup = E.summarizeComparison(comparisons);
      body.push(el('div', { class: 'list-label', text: '지난번과 비교' }));
      body.push(el('p', { class: 'compare-headline', text: rollup.headline }));

      body.push(el('div', { class: 'summary-list' }, comparisons.map(function (row) {
        var dir = E.directionOf(row.deltaPrevious);
        return el('div', { class: 'compare-row' }, [
          el('span', { class: 'compare-main' }, [
            el('span', { class: 'name', text: row.name }),
            el('span', { class: 'compare-line', text: E.describeComparison(row, 'previous') }),
            row.monthAgo
              ? el('span', { class: 'compare-line month', text: '한 달 · ' + E.describeComparison(row, 'month') })
              : null,
          ]),
          /*
           * 고반복이면 큰 kg 숫자를 옆에 세우지 않는다. 102.5kg 15회를
           * "+13.7kg"으로 보여주면 실제로 늘어난 것보다 훨씬 커 보인다.
           */
          el('span', { class: 'compare-delta ' + (row.reliable ? dir : 'same'), text:
            row.deltaPrevious === undefined ? '처음'
              : !row.reliable ? '고반복'
              : (row.deltaPrevious > 0 ? '+' : '') + fmt(row.deltaPrevious) + 'kg' }),
        ]);
      })));

      var gain = E.biggestGain(comparisons);
      if (gain) {
        var monthText = E.monthLine(gain);
        body.push(el('p', { class: 'asset-note', text:
          '오늘 가장 많이 오른 건 ' + gain.name + '입니다.' + (monthText ? ' ' + monthText : '') }));
      }

      body.push(el('p', { class: 'asset-note', text:
        '환산값은 추정 1RM입니다. RIR 신고가 흔들리면 같이 흔들리므로 ' +
        E.MEANINGFUL_KG + 'kg 미만 변화는 "비슷하다"로 봅니다.' }));
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

    /*
     * 요약을 닫으면 아무 데도 안 간다는 게 문제였다. 여기서 오늘을
     * 닫아야 세션이 끝난 것이고, 그래야 내일 다시 열었을 때 어제 것이
     * 안 남아 있다.
     */
    body.push(el('button', {
      type: 'button', class: 'finish',
      text: '오늘 마치기',
      onclick: closeToday,
    }));

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

  function activeGymId() {
    return state.gymBook ? state.gymBook.activeId : undefined;
  }

  /**
   * 시드 이력이 쌓인 헬스장.
   *
   * 헬스장을 옮겼다고 과거 기록까지 새 헬스장 것이 되면 안 된다. 그러면
   * 머신 중량이 헬스장별로 갈리는 것을 볼 수가 없다 — 이력이 늘 현재
   * 헬스장을 따라다니기 때문이다.
   */
  function homeGymId() {
    if (!state.homeGymId) state.homeGymId = activeGymId();
    return state.homeGymId;
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

  /**
   * 사용하는 근육 그림 + 범례.
   *
   * 경쟁 앱들은 종목마다 근육이 칠해진 그림 한 장을 붙여 둡니다. 우리는
   * 그림이 한 장뿐이고 색을 계산해서 넣습니다 — 엔진이 이미 종목별 근육
   * 기여도를 갖고 있기 때문입니다. 그래서 데드리프트의 둔근(100%)과
   * 대퇴사두(30%)가 같은 색으로 보이지 않습니다.
   *
   * 주동근/협응근을 나누는 기준은 0.7입니다. 그보다 아래는 "같이 쓰이는"
   * 근육이지 그 종목으로 키우는 근육이 아닙니다.
   */
  function musclePanel(exercise) {
    var map = window.FitBodyMap;
    var contribution = exercise.contribution || {};
    var ranked = Object.keys(contribution)
      .filter(function (muscle) { return contribution[muscle] > 0; })
      .sort(function (a, b) { return contribution[b] - contribution[a]; });
    if (ranked.length === 0) return [];

    var out = [];
    out.push(el('div', { class: 'list-label', text: '쓰는 근육' }));
    if (map) out.push(map.render(contribution, exercise.name + '에서 쓰는 근육'));

    out.push(el('div', { class: 'body-legend' }, ranked.map(function (muscle) {
      var weight = contribution[muscle];
      var primary = weight >= 0.7;
      return el('div', { class: 'body-legend-row' }, [
        el('span', { class: 'name' }, [
          el('span', { text: E.MUSCLE_LABELS_KO[muscle] || muscle }),
          primary ? el('span', { class: 'role', text: '주동근' }) : null,
        ]),
        el('span', { class: 'bar' }, [
          el('i', { style: 'width:' + Math.round(Math.min(1, weight) * 100) + '%' }),
        ]),
        el('span', { class: 'pct', text: Math.round(weight * 100) + '%' }),
      ]);
    })));

    out.push(el('p', { class: 'asset-note', text:
      '진한 곳이 그 종목으로 키우는 근육입니다. 흐린 곳도 쓰이긴 하지만 ' +
      '주된 자극은 아닙니다 — 주간 볼륨도 이 비율대로 나눠서 쌓입니다.' }));
    return out;
  }

  /**
   * 기구 그림 한 칸.
   *
   * 그림이 없는 기구가 있어도 목록이 들쭉날쭉해지면 안 되므로, 없으면 같은
   * 크기의 빈 칸을 돌려준다. 그림은 장식이 아니라 "이게 그거 맞나"를
   * 확인하는 장치라서, 이름·생김새 설명과 나란히 놓는다.
   */
  function equipArt(id, label) {
    var art = window.FitEquipmentArt;
    var svg = art && art.has(id) ? art.render(id, label + ' 그림') : null;
    return svg || el('span', { class: 'equip-art-blank', 'aria-hidden': 'true' });
  }

  /* ── 이 기구 없어요 ─────────────────────────────── */

  /**
   * 그 종목에 필요한 기구 중 무엇이 없는지 고르게 한다.
   *
   * "이 종목 빼기"가 아니라 "이 기구 없음"으로 받는 이유가 있다. 종목만 빼면
   * 같은 기구를 쓰는 다른 종목이 내일 또 나온다. 기구를 끄면 그 기구를 쓰는
   * 종목이 전부 한 번에 정리된다.
   */
  function openMissingEquipment(exercise) {
    var entry = currentGymEntry();
    if (!entry) return;

    var candidates = E.equipmentBehind(exercise, entry);
    var body = [];

    body.push(el('p', { class: 'asset-note', text:
      exercise.name + '에 필요한 기구입니다. 헬스장에 없는 것을 골라 주세요. ' +
      '그 기구를 쓰는 다른 종목도 같이 정리됩니다.' }));

    body.push(el('div', { class: 'summary-list' }, candidates.map(function (id) {
      var item = E.equipmentItem(id);
      var guide = E.equipmentGuide(id);
      // 무엇이 사라지는지 누르기 전에 보여준다.
      var preview = E.setEquipmentPresent(state.gymBook, entry.id, id, false);

      return el('button', {
        type: 'button', class: 'equip-row',
        onclick: function () { applyMissingEquipment(id); },
      }, [
        el('span', { class: 'mark', text: '' }),
        equipArt(id, item ? item.name : id),
        el('span', { class: 'equip-main' }, [
          el('span', { class: 'name', text: item ? item.name : id }),
          guide ? el('span', { class: 'look', text: guide.look }) : null,
          el('span', { class: 'aka', text: preview.lost.length > 0
            ? '없애면 종목 ' + preview.lost.length + '개가 대체됩니다'
            : '없애도 다른 종목에는 영향이 없습니다' }),
        ]),
      ]);
    })));

    body.push(el('p', { class: 'asset-note', text:
      '잘못 눌러도 됩니다 — 헬스장 탭에서 언제든 다시 켤 수 있습니다.' }));

    openModal(exercise.name, '기구 없음', body);
  }

  function applyMissingEquipment(equipmentId) {
    var entry = currentGymEntry();
    if (!entry) return;

    var result = E.setEquipmentPresent(state.gymBook, entry.id, equipmentId, false);
    state.gymBook = result.book;
    state.gym = E.activeProfile(state.gymBook);
    state.answers.gym = {
      equipmentIds: E.activeGym(state.gymBook).equipmentIds.slice(),
      measurements: state.answers.gym.measurements,
    };

    modal.close();
    // 오늘 세션을 다시 짜야 그 기구를 쓰는 종목이 대체된다.
    loadScenario(state.scenario, true);
    pushLog('기구 없음', '<b>' + ((E.equipmentItem(equipmentId) || {}).name || equipmentId) +
      '</b> 없음으로 바꿨습니다. ' +
      (result.lost.length > 0 ? '종목 ' + result.lost.length + '개가 대체됩니다. ' : '') +
      '헬스장 탭에서 다시 켤 수 있습니다.');
    render();
  }

  /* ── 동작 시연 ─────────────────────────────────── */

  /**
   * 종목 하나의 동작을 3D로 돌린다.
   *
   * 실제 제품에서는 촬영 영상이나 구매한 3D 에셋이 이 자리에 온다. 지금은
   * 엔진의 관절 키프레임으로 절차적 애니메이션을 돌려, 어떤 데이터가
   * 필요하고 화면이 어떻게 생기는지를 먼저 확인한다.
   */
  /**
   * 직접 찍은 영상이 있으면 그걸 쓴다.
   *
   * 애니메이션은 관절 각도를 보여줄 뿐이고, 초보자가 따라 하려면 사람이
   * 하는 걸 봐야 한다. 다만 영상이 없다고 빈 칸이 나오면 안 되므로,
   * 없는 종목은 지금까지대로 애니메이션이 그대로 돈다.
   *
   * 실수 컷을 같이 찍었으면 전환 버튼이 생긴다. 초보자에게는 "이렇게
   * 하세요"보다 "이러면 안 됩니다"가 더 잘 박힌다.
   */
  function filmedStage(exercise) {
    var clips = window.FitDemoClips;
    if (!clips || !clips.has(exercise.id)) return null;

    var video = el('video', {
      class: 'demo-video',
      src: clips.src(exercise.id),
      loop: '', muted: '', playsinline: '', autoplay: '', preload: 'metadata',
      'aria-label': exercise.name + ' 시연 영상',
    });
    video.muted = true;  // 속성만으로는 일부 브라우저가 자동재생을 막는다

    var stage = el('div', { class: 'demo-stage' }, [video]);
    var controls = null;

    if (clips.hasMistake(exercise.id)) {
      var showing = 'normal';
      var swap = function (which) {
        showing = which;
        video.src = which === 'normal' ? clips.src(exercise.id) : clips.mistakeSrc(exercise.id);
        video.play().catch(function () { /* 자동재생이 막히면 사용자가 누른다 */ });
        takes.forEach(function (button, i) {
          button.setAttribute('aria-pressed', String((i === 0 ? 'normal' : 'mistake') === showing));
        });
      };
      var takes = [
        el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', text: '정상',
          onclick: function () { swap('normal'); } }),
        el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: '흔한 실수',
          onclick: function () { swap('mistake'); } }),
      ];
      controls = el('div', { class: 'demo-controls demo-take' }, takes.concat([
        el('span', { class: 'spacer', text: '직접 촬영' }),
      ]));
    } else {
      controls = el('div', { class: 'demo-controls demo-take' }, [
        el('span', { class: 'filmed', text: '직접 촬영' }),
      ]);
    }

    return { stage: stage, controls: controls };
  }

  function openDemo(exercise) {
    var demo = E.demoFor(exercise);
    var body = [];

    var filmed = filmedStage(exercise);
    if (filmed) {
      body.push(filmed.stage);
      body.push(filmed.controls);
      buildDemoBody(exercise, demo, body, true);
      openModal(exercise.name, E.PATTERN_LABELS_KO[demo.pattern] || demo.pattern, body);
      return;
    }

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

    buildDemoBody(exercise, demo, body, false);
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

  /**
   * 시연 아래 붙는 것들. 영상이든 애니메이션이든 같다.
   *
   * 순서가 중요하다 — 동작을 본 다음 큐, 그 다음 실수, 근육은 맨 뒤다.
   * 초보자가 필요한 건 "어떻게 하는가"이고 "어디에 오는가"는 그 다음이다.
   */
  function buildDemoBody(exercise, demo, body, filmed) {
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

    musclePanel(exercise).forEach(function (node) { body.push(node); });

    body.push(el('p', {
      class: 'asset-note',
      text: filmed
        ? '직접 촬영한 영상입니다. 저작권이 이쪽에 있어 사용에 제약이 없습니다.'
        : '이 시연은 관절 각도 키프레임으로 그린 예시입니다' +
          (window.FitDemo3D.is3d() ? '' : ' (three.js를 받지 못해 평면으로 그렸습니다)') +
          '. 촬영본이 들어오면 이 자리가 영상으로 바뀝니다 — 종목마다 따로 켤 수 있어서 ' +
          '다 찍을 때까지 기다리지 않아도 됩니다.',
    }));
  }

  function prefersDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (err) {
      return false;
    }
  }

  /* 오늘 */
  /* ── 오늘 ────────────────────────────────────────

     화면을 둘로 나눈다.

     시작 전에는 목록만 보여준다 — 오늘 뭘 하는지, 얼마나 걸리는지,
     시간이 없으면 뭘 자를지. 여기서 정하고 나면 더 볼 게 없다.

     시작한 뒤에는 한 종목만 보여준다. 헬스장에서 필요한 건 "지금 이거"
     하나고, 일곱 개가 한 화면에 깔려 있으면 세 번째 종목쯤에서 스크롤을
     잃는다. 남은 개수는 위에 숫자로만 있으면 된다.
  ── */

  function sessionHead() {
    var phaseBadge = el('span', {
      class: 'badge ' + (state.plan.phase === 'deload' ? 'deload' : 'accum'),
      text: state.plan.phase === 'deload' ? '디로드' : '축적 ' + state.plan.weekInBlock + '주차',
    });
    var estimate = E.estimateSessionTime(state.session, {
      restMultiplier: E.styleProfile(state.style).restMultiplier,
    });
    return {
      estimate: estimate,
      node: el('div', { class: 'session-head' }, [
        el('div', { class: 'title' }, [
          // 제목을 눌러서 오늘 할 날을 바꾼다. 순서대로만 되면 앱을 무시하게 된다.
          el('button', {
            type: 'button', class: 'day-switch',
            'aria-label': '오늘 할 날 바꾸기 — 지금은 ' + state.session.name,
            onclick: openDayPicker,
          }, [
            el('h2', { text: state.session.name }),
            el('span', { class: 'day-switch-caret', text: '바꾸기' }),
          ]),
          phaseBadge,
        ]),
        el('p', {
          class: 'meta',
          text: state.session.date + ' · 목표 RIR ' + state.plan.targetRir + ' · ' +
            state.lifts.length + '개 종목 · 약 ' + estimate.totalMinutes + '분',
        }),
      ]),
    };
  }

  /**
   * 오늘 어느 날을 할 것인가.
   *
   * 순서를 강제하면 사용자는 앱을 무시하고 자기 마음대로 한다. 그러면
   * 기록이 안 남고, 기록이 없으면 볼륨 계산도 처방도 다 틀어진다.
   * 그래서 막지 않고, 대신 그 부위를 마지막으로 언제 했는지 말해준다.
   */
  function openDayPicker() {
    var current = currentTemplateIndex();
    var options = E.dayOptions(state.program.templates, {
      scheduledIndex: scheduledTemplateIndex(),
      sessions: state.history.concat(todaySessionLog()),
      today: state.todayDate,
      exerciseById: function (id) { return index.get(id); },
    });

    var body = [];
    body.push(el('p', { class: 'asset-note', text:
      '순서를 바꿔도 됩니다. 건너뛴 날은 없어지지 않고 다음으로 밀립니다 — ' +
      '주간 볼륨은 한 주 전체로 계산하므로 목표는 그대로입니다.' }));

    body.push(el('div', { class: 'summary-list' }, options.map(function (option) {
      var templateIndex = state.program.templates.indexOf(option.template);
      var picked = templateIndex === current;
      return el('button', {
        type: 'button',
        class: 'day-row',
        'aria-pressed': String(picked),
        onclick: function () { chooseDay(templateIndex); },
      }, [
        el('span', { class: 'mark', text: picked ? '✓' : '' }),
        el('span', { class: 'day-main' }, [
          el('span', { class: 'name' }, [
            el('span', { text: option.template.name }),
            option.scheduled ? el('span', { class: 'day-tag', text: '오늘 차례' }) : null,
          ]),
          el('span', { class: 'day-muscles', text: option.muscles.slice(0, 4).map(function (muscle) {
            return E.MUSCLE_LABELS_KO[muscle];
          }).join(' · ') }),
          el('span', { class: 'day-note ' + option.readiness, text: option.note }),
        ]),
      ]);
    })));

    openModal('오늘 뭐 할까요', state.program.name, body);
  }

  function chooseDay(templateIndex) {
    var after = state.program.templates[templateIndex];
    if (!after) return;

    /*
     * 날을 바꾸면 오늘 기록한 세트는 지운다. 다른 날의 종목이라 그대로
     * 두면 어느 세션에 속한 세트인지 알 수 없게 된다. 그래서 세트가
     * 있으면 먼저 물어본다.
     *
     * window.confirm은 쓰지 않는다. 앱이 iframe 안에서 돌면(아티팩트,
     * 웹뷰, 일부 인앱 브라우저) 확인창이 뜨지도 않고 조용히 "취소"로
     * 처리된다. 그러면 눌러도 아무 일이 안 일어난다 — 실제로 그랬다.
     */
    if (state.todaySets.length > 0) {
      confirmDayChange(templateIndex, after);
      return;
    }
    applyDayChange(templateIndex);
  }

  /** 기록이 지워진다는 걸 모달 안에서 묻는다. 브라우저 확인창을 쓰지 않는다. */
  function confirmDayChange(templateIndex, after) {
    var body = [
      el('p', { class: 'asset-note', text:
        '오늘 기록한 ' + state.todaySets.length + '세트가 지워집니다. ' +
        withParticleJs(after.name, '은/는') + ' 다른 날이라 종목이 달라서, ' +
        '기록을 남겨두면 어느 세션의 세트인지 알 수 없게 됩니다.' }),
      el('div', { class: 'sheet-body' }, [
        el('button', {
          type: 'button', class: 'finish danger',
          text: after.name + '로 바꾸고 기록 지우기',
          onclick: function () { applyDayChange(templateIndex); },
        }),
        el('button', {
          type: 'button', class: 'finish quiet', text: '그대로 두기',
          onclick: openDayPicker,
        }),
      ]),
    ];
    openModal('기록이 지워집니다', after.name + '로 바꾸기', body);
  }

  function applyDayChange(templateIndex) {
    var before = state.program.templates[currentTemplateIndex()];
    var after = state.program.templates[templateIndex];
    if (!after) return;

    state.todaySets = [];
    // 다른 날은 종목이 아예 다르다. 앞 날의 순서와 묶음을 끌고 가면 안 된다.
    state.liftOrder = null;
    state.supersets = [];
    state.dayOverride = templateIndex === scheduledTemplateIndex() ? null : templateIndex;
    state.started = false;
    state.sessionClosed = false;
    state.liftCursor = 0;
    state.occupied = {};
    state.sessionStartedAt = null;
    rebuildSession();

    var note = E.skipNote(before, after);
    if (note) pushLog('오늘 바꿈', note);
    modal.close();
    render();
  }

  /** 오늘 기록한 세트를 세션 하나로 본다 — 회복 판정에 오늘 것도 넣어야 한다. */
  function todaySessionLog() {
    if (state.todaySets.length === 0) return [];
    return [{ date: state.todayDate, sets: state.todaySets }];
  }

  function renderWarnings() {
    state.session.warnings.forEach(function (warning) {
      screen.appendChild(el('div', { class: 'notice' + (warning.medical ? ' stop' : '') }, [
        el('div', { class: 'label', text: WARNING_LABELS[warning.kind] || '알림' }),
        el('div', { text: warning.text }),
      ]));
    });
  }

  /** 종목 한 줄 요약 — "4세트 × 65kg × 8회". 목록에서는 이것만 있으면 된다. */
  function liftSummaryLine(lift) {
    var sets = lift.sets.length;
    var first = lift.sets[0];
    if (!first) return sets + '세트';
    var reps = first.targetReps.min === first.targetReps.max
      ? first.targetReps.max + '회'
      : first.targetReps.min + '–' + first.targetReps.max + '회';
    var load = first.weightKg > 0 ? first.weightKg + 'kg' : '맨몸';
    return sets + '세트 · ' + load + ' · ' + reps;
  }

  /**
   * 종목 썸네일.
   *
   * 촬영본이 들어오면 여기가 영상 첫 프레임이 된다. 그전까지 빈 회색
   * 네모를 두느니 그 종목을 하는 **기구**를 그려 둔다 — 목록에서 어느
   * 자리로 가야 하는지가 바로 보이므로 자리만 채우는 그림이 아니다.
   */
  var EQUIPMENT_ART_FOR = {
    barbell: 'barbell-set',
    dumbbell: 'dumbbells',
    machine: 'chest-press-machine',
    cable: 'cable-station',
    smith: 'smith-machine',
    bodyweight: 'floor',
  };

  function liftThumb(exercise) {
    var art = window.FitEquipmentArt;
    var id = EQUIPMENT_ART_FOR[exercise.equipment];
    var svg = art && id && art.has(id) ? art.render(id, '') : null;
    var box = el('span', { class: 'lift-thumb', 'aria-hidden': 'true' }, []);
    if (svg) { svg.setAttribute('class', 'thumb-art'); box.appendChild(svg); }
    return box;
  }

  /** 위쪽 요약 카드 하나. 누르면 펼쳐진다. */
  function statCard(key, label, value, unit, body) {
    var open = state.statOpen === key;
    var card = el('div', { class: 'stat-card' + (open ? ' open' : '') }, [
      el('button', {
        type: 'button', class: 'stat-head', 'aria-expanded': String(open),
        onclick: function () { state.statOpen = open ? null : key; render(); },
      }, [
        el('span', { class: 'stat-label', text: label }),
        el('span', { class: 'stat-value' }, [
          el('b', { text: value }),
          unit ? el('span', { text: unit }) : null,
        ]),
        el('span', { class: 'stat-caret', text: open ? '▴' : '▾' }),
      ]),
    ]);
    if (open) card.appendChild(el('div', { class: 'stat-body' }, body()));
    return card;
  }

  /** 컨디션 — 피로 점수를 뒤집어 보여준다. 지어낸 숫자가 아니다. */
  function conditionPercent() {
    var f = state.plan.fatigue;
    if (!f || !f.threshold) return 100;
    return Math.max(0, Math.min(100, Math.round((1 - f.score / f.threshold) * 100)));
  }

  /** 시작 전 — 오늘 할 것 목록. */
  function renderPlanList() {
    var head = sessionHead();
    screen.appendChild(head.node);

    var estimate = head.estimate;
    var condition = conditionPercent();

    screen.appendChild(el('div', { class: 'stat-row' }, [
      statCard('time', '운동 시간',
        String(state.timeBudget || estimate.totalMinutes), '분',
        function () { return timeBudgetControls(estimate); }),
      statCard('condition', '컨디션', String(condition), '%',
        function () { return conditionDetail(); }),
    ]));

    renderWarnings();

    var rows = [];

    // 워밍업은 종목이 아니라 준비라 맨 위에 한 줄로 둔다.
    var warmupSets = state.lifts.reduce(function (sum, lift) {
      return sum + (lift.warmup && lift.warmup.sets ? lift.warmup.sets.length : 0);
    }, 0);
    if (warmupSets > 0) {
      rows.push(el('div', { class: 'plan-row' }, [
        el('span', { class: 'lift-thumb warm', 'aria-hidden': 'true', text: '↗' }),
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name' }, [el('span', { text: '워밍업' })]),
          el('span', { class: 'plan-sets', text: warmupSets + '세트 · 종목마다 자동' }),
        ]),
      ]));
    }

    state.lifts.forEach(function (lift) {
      var done = lift.sets.filter(function (set) { return set.done; }).length;
      rows.push(el('div', { class: 'plan-row' }, [
        liftThumb(lift.exercise),
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name' }, [
            el('span', { text: lift.exercise.name }),
            lift.substitutedFrom
              ? el('span', { class: 'swap-tag', text: '← ' + lift.substitutedFrom.name })
              : null,
          ]),
          el('span', { class: 'plan-sets', text: liftSummaryLine(lift) }),
        ]),
        done > 0 ? el('span', { class: 'plan-done', text: done + '/' + lift.sets.length }) : null,
        el('button', {
          type: 'button', class: 'row-menu', text: '⋯',
          'aria-label': lift.exercise.name + ' 더보기',
          onclick: function () { openLiftMenu(lift); },
        }),
      ]));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '오늘 할 것' }),
        el('span', { class: 'head-actions' }, [
          el('span', { class: 'meta', text: '총 ' + state.lifts.length + '개' }),
          el('button', {
            type: 'button', class: 'demo-open', text: '순서 변경',
            onclick: openReorder,
          }),
          el('button', {
            type: 'button', class: 'demo-open', text: '묶기',
            title: '슈퍼세트 · 크로스핏 세트로 묶어 시간을 줄입니다',
            onclick: openSupersets,
          }),
        ]),
      ]),
      el('div', { class: 'sheet-body tight' }, [el('div', { class: 'summary-list' }, rows)]),
    ]));

    renderMaxTest();
    renderConditioning();

    var doneSets = state.todaySets.length;
    screen.appendChild(el('button', {
      type: 'button', class: 'finish start-cta',
      text: doneSets > 0 ? '이어서 하기 · ' + doneSets + '세트 완료' : '시작하기',
      onclick: function () {
        state.started = true;
        // 시계는 여기서 돈다. 세트를 기록해야 시작하면 워밍업 시간이 빠진다.
        if (!state.sessionStartedAt) state.sessionStartedAt = Date.now();
        // 이어서 할 때는 아직 안 끝낸 첫 종목으로 간다.
        var next = state.lifts.findIndex(function (lift) {
          return lift.sets.some(function (set) { return !set.done; });
        });
        state.liftCursor = next >= 0 ? next : 0;
        render();
      },
    }));

    // 시간이 없어 중간에 끝내야 하는 날도 있다. 길은 열어 두되 조용히 둔다.
    if (doneSets > 0) renderFinish(!allSetsDone() ? true : false);
  }

  /**
   * 종목 묶기 — 슈퍼세트와 크로스핏 세트.
   *
   * 둘을 묶으면 슈퍼세트, 셋에서 다섯을 묶으면 한 바퀴를 도는 크로스핏
   * 세트다. 둘 다 같은 볼륨을 더 짧은 시간에 끝내는 방법이고, 이 앱이
   * 이미 받고 있는 "오늘 40분밖에 없다"에 대한 제일 직접적인 답이다.
   *
   * 여기서 묶는 것은 **오늘 하기로 한 그 종목들**이다. 프로그램을
   * 크로스핏으로 바꾸는 게 아니다. 중량도 세트 수도 그대로고, 쉬는
   * 방식만 달라진다. 묶지 않으면 아무것도 달라지지 않는다.
   *
   * 고르는 방식은 "하나씩 담기"다. 끌어다 겹치는 방식은 땀난 손으로
   * 안 되고, 체크박스만 있으면 무엇과 무엇이 한 바퀴인지 안 보인다.
   */
  function openSupersets() {
    // 담는 중인 바퀴. 순서가 곧 도는 순서다.
    if (!Array.isArray(state.supersetPick)) state.supersetPick = [];

    var pickedExercises = function () {
      return state.supersetPick.map(function (id) { return index.get(id); })
        .filter(function (item) { return !!item; });
    };

    var draw = function () {
      var body = [];
      var picking = state.supersetPick;

      body.push(el('p', { class: 'asset-note', text:
        '번갈아 하면 한쪽이 쉬는 동안 다른 쪽을 합니다. 둘을 묶으면 슈퍼세트, ' +
        '셋부터 다섯까지는 한 바퀴를 도는 크로스핏 세트입니다. ' +
        '중량도 세트 수도 그대로고 쉬는 방식만 바뀝니다 — ' +
        '다만 한 바퀴를 마친 뒤에는 제대로 쉽니다. 거기서 깎으면 다음 바퀴가 무너집니다.' }));

      // 담는 중인 바퀴를 늘 위에 보여준다 — 뭘 묶고 있는지가 제일 궁금하다
      if (picking.length > 0) {
        var chosen = pickedExercises();
        var label = picking.length >= 3 ? '크로스핏 세트' : (picking.length === 2 ? '슈퍼세트' : '묶는 중');
        var lines = [
          el('div', { class: 'label', text: label + ' · ' + picking.length + '종목' }),
          el('div', { text: chosen.map(function (item, i) {
            return (i + 1) + '. ' + item.name;
          }).join('   ') }),
        ];
        if (picking.length === 1) {
          lines.push(el('div', { class: 'hint-line', text: '하나 더 고르면 슈퍼세트, 셋부터는 크로스핏 세트가 됩니다.' }));
        } else {
          var restGuess = liftById(picking[0]) && liftById(picking[0]).restSeconds
            ? liftById(picking[0]).restSeconds : 70;
          var t = E.circuitTiming(chosen, restGuess);
          lines.push(el('div', { class: 'hint-line', text:
            '사이 ' + t.betweenSeconds + '초 · 한 바퀴 뒤 ' + t.afterSeconds + '초' }));

          /*
           * 담을 때 나온 주의는 담고 나면 줄에서 사라진다. 막지 않은
           * 것일수록 여기 남겨야 한다 — 무엇을 감수하고 묶는지는 묶기
           * 전에 알아야 하는 것이다.
           */
          for (var c = 1; c < chosen.length; c += 1) {
            var verdict = E.checkAdd(chosen.slice(0, c), chosen[c]);
            if (verdict.quality === 'caution') {
              lines.push(el('div', { class: 'hint-line warn', text: '⚠ ' + verdict.reason }));
            }
          }
        }
        body.push(el('div', { class: 'notice' }, lines));
      }

      body.push(el('div', { class: 'summary-list' }, state.lifts.map(function (lift) {
        var id = lift.exercise.id;
        var group = E.groupOf(state.supersets, id);
        var spot = picking.indexOf(id);

        // 담는 중이면 지금 바퀴에 넣을 수 있는지 미리 본다
        var check = spot < 0 && picking.length > 0 && !group
          ? E.checkAdd(pickedExercises(), lift.exercise)
          : null;

        // 묶인 줄은 "몇 번째 · 다음 뭐"로 읽는다 — 바퀴는 순서가 전부다
        var spotInGroup = group ? group.indexOf(id) : -1;
        var nextInGroup = group ? index.get(group[(spotInGroup + 1) % group.length]) : null;

        return el('button', {
          type: 'button',
          class: 'pair-row' + (spot >= 0 ? ' picking' : '') + (group ? ' paired' : '') +
            (check && !check.allowed ? ' blocked' : ''),
          disabled: check && !check.allowed ? '' : null,
          onclick: function () { pickForSuperset(id); },
        }, [
          el('span', { class: 'pair-mark', text:
            group ? String(spotInGroup + 1) : (spot >= 0 ? String(spot + 1) : '') }),
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'name', text: lift.exercise.name }),
            el('span', { class: 'plan-sets', text:
              group ? E.groupLabel(group) + ' ' + (spotInGroup + 1) + '/' + group.length +
                  (nextInGroup ? ' · 다음 ' + nextInGroup.name : '')
                : spot >= 0 ? '이 바퀴 ' + (spot + 1) + '번째 — 다시 누르면 뺍니다'
                : check ? check.reason
                : liftSummaryLine(lift) }),
          ]),
          group ? el('span', { class: 'detail', text: '풀기' }) : null,
        ]);
      })));

      // 담은 게 둘 이상이면 이제 묶을 수 있다
      if (picking.length >= 2) {
        body.push(el('button', {
          type: 'button', class: 'finish',
          text: (picking.length >= 3 ? '크로스핏 세트로 묶기' : '슈퍼세트로 묶기') + ' · ' + picking.length + '종목',
          onclick: commitGroup,
        }));
      }
      if (picking.length > 0) {
        body.push(el('button', {
          type: 'button', class: 'demo-open wide', text: '담은 것 비우기',
          onclick: function () { state.supersetPick = []; draw(); },
        }));
      }

      if (state.supersets.length > 0) {
        var saved = state.supersets.reduce(function (sum, group) {
          var members = group.map(function (memberId) { return index.get(memberId); })
            .filter(function (item) { return !!item; });
          if (members.length < 2) return sum;
          var lift = liftById(group[0]);
          var rounds = lift ? lift.sets.length : 3;
          var rest = lift && lift.restSeconds ? lift.restSeconds : 70;
          return sum + E.circuitTiming(members, rest).savedSeconds * rounds;
        }, 0);
        if (saved >= 60) {
          body.push(el('p', { class: 'hint-line', text:
            '묶은 ' + state.supersets.length + '개로 약 ' + Math.round(saved / 60) + '분 줄었습니다.' }));
        }
      }

      body.push(el('button', {
        type: 'button', class: 'finish', text: '이대로 하기',
        onclick: function () { state.supersetPick = []; modal.close(); render(); },
      }));

      openModal('묶기', state.supersets.length > 0 ? state.supersets.length + '개 묶음' : '슈퍼세트 · 크로스핏 세트', body);
    };
    draw();

    function liftById(id) {
      return state.lifts.filter(function (item) { return item.exercise.id === id; })[0];
    }

    function pickForSuperset(id) {
      var group = E.groupOf(state.supersets, id);
      if (group) {
        // 이미 묶여 있으면 그 묶음을 통째로 푼다
        state.supersets = state.supersets.filter(function (item) { return item !== group; });
        state.supersetPick = [];
        rebuildSession();
        pushLog('묶기', E.groupLabel(group) + ' 묶음을 풀었습니다.');
        render();
        return draw();
      }

      var spot = state.supersetPick.indexOf(id);
      if (spot >= 0) {
        // 담은 것을 다시 누르면 뺀다
        state.supersetPick = state.supersetPick.filter(function (item) { return item !== id; });
        return draw();
      }

      var candidate = index.get(id);
      if (!candidate) return draw();
      if (state.supersetPick.length > 0 && !E.checkAdd(pickedExercises(), candidate).allowed) return draw();

      state.supersetPick = state.supersetPick.concat([id]);
      return draw();
    }

    function commitGroup() {
      var picked = state.supersetPick.slice();
      if (picked.length < 2) return draw();

      var members = pickedExercises();
      state.supersets = state.supersets.concat([picked]);
      state.supersetPick = [];
      rebuildSession();
      pushLog(E.groupLabel(picked),
        members.map(function (item) { return '<b>' + item.name + '</b>'; }).join(' + '));
      render();
      draw();
    }
  }

  /**
   * 순서 바꾸기.
   *
   * 끌어서 옮기는 방식이 보기는 좋지만, 땀난 손으로 스크롤하는 목록 위에서
   * 끌기는 잘 안 잡힌다. ↑↓ 버튼은 눌리기만 하면 되고, 키보드와 스크린
   * 리더에서도 그대로 동작한다.
   *
   * 바꾼 결과가 괜찮은지는 엔진이 봐준다 — 막지는 않는다.
   */
  function openReorder() {
    var render2 = function () {
      var ids = state.lifts.map(function (lift) { return lift.exercise.id; });
      var body = [];

      body.push(el('p', { class: 'asset-note', text:
        '기구가 막혔거나 먼저 하고 싶은 게 있으면 바꾸세요. ' +
        '바꾼 순서는 오늘 하루 유지되고, 워밍업도 새 순서에 맞춰 다시 잡힙니다.' }));

      var issues = E.reviewOrder(state.lifts.map(function (lift) { return lift.exercise; }));
      issues.forEach(function (issue) {
        body.push(el('div', { class: 'notice' + (issue.severity === 'warn' ? ' stop' : '') }, [
          el('div', { class: 'label', text: issue.severity === 'warn' ? '순서 주의' : '참고' }),
          el('div', { text: issue.text }),
        ]));
      });

      body.push(el('div', { class: 'summary-list' }, state.lifts.map(function (lift, index) {
        var flagged = issues.some(function (issue) {
          return issue.exerciseId === lift.exercise.id && issue.severity === 'warn';
        });
        var locked = lift.sets.some(function (set) { return set.done; });

        return el('div', { class: 'order-row' + (flagged ? ' flagged' : '') }, [
          el('span', { class: 'order-no', text: String(index + 1) }),
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'name' }, [
              el('span', { text: lift.exercise.name }),
              locked ? el('span', { class: 'plan-done', text: '기록 있음' }) : null,
            ]),
            el('span', { class: 'plan-sets', text: liftSummaryLine(lift) }),
          ]),
          el('span', { class: 'order-moves' }, [
            el('button', {
              type: 'button', class: 'nudge', text: '↑',
              disabled: index === 0 ? '' : null,
              'aria-label': lift.exercise.name + ' 위로',
              onclick: function () { moveLift(index, index - 1); render2(); },
            }),
            el('button', {
              type: 'button', class: 'nudge', text: '↓',
              disabled: index === state.lifts.length - 1 ? '' : null,
              'aria-label': lift.exercise.name + ' 아래로',
              onclick: function () { moveLift(index, index + 1); render2(); },
            }),
          ]),
        ]);
      })));

      if (state.liftOrder) {
        body.push(el('button', {
          type: 'button', class: 'finish quiet', text: '프로그램 순서로 되돌리기',
          onclick: function () {
            state.liftOrder = null;
            rebuildSession();
            pushLog('순서 변경', '프로그램이 짜 준 순서로 되돌렸습니다.');
            render();
            render2();
          },
        }));
      }

      body.push(el('button', {
        type: 'button', class: 'finish', text: '이 순서로 하기',
        onclick: function () { modal.close(); render(); },
      }));

      void ids;
      openModal('순서 변경', state.lifts.length + '개 종목', body);
    };
    render2();
  }

  /**
   * 한 칸 옮긴다.
   *
   * 이미 기록한 세트는 종목에 붙어 있으므로 순서를 옮겨도 그대로 간다.
   * 다만 진행 중이면 커서가 다른 종목을 가리키게 되므로 같이 따라가게 한다.
   */
  function moveLift(from, to) {
    var ids = state.lifts.map(function (lift) { return lift.exercise.id; });
    var moving = ids[from];
    state.liftOrder = E.moveItem(ids, from, to);
    rebuildSession();

    // 진행 중이었다면 보고 있던 종목을 계속 본다.
    if (state.started) {
      var at = state.lifts.findIndex(function (lift) { return lift.exercise.id === moving; });
      if (at >= 0) state.liftCursor = at;
    }
    pushLog('순서 변경', '<b>' + (index.get(moving) ? index.get(moving).name : moving) +
      '</b> ' + (to < from ? '위로' : '아래로') + ' 옮겼습니다.');
  }

  /**
   * 종목 한 줄의 더보기.
   *
   * 시연·사람 있어요·없어요를 목록에 다 늘어놓으면 줄마다 버튼이 셋이라
   * 이름이 안 보인다. 한 곳에 모은다.
   */
  function openLiftMenu(lift) {
    var entry = currentGymEntry() || { equipmentIds: [] };
    var options = [
      { label: '동작 시연', hint: '수행 큐 · 흔한 실수 · 쓰는 근육', run: function () { openDemo(lift.exercise); } },
      { label: '사람 있어요', hint: '순서 변경 · 대체 · 대기 중에서 고릅니다', run: function () { openOccupancy(lift.exercise); } },
    ];
    if (E.equipmentBehind(lift.exercise, entry).length > 0) {
      options.push({
        label: '이 기구 없어요',
        hint: '그 기구를 쓰는 종목이 한 번에 정리됩니다',
        run: function () { openMissingEquipment(lift.exercise); },
      });
    }

    openModal(lift.exercise.name, liftSummaryLine(lift), [
      el('div', { class: 'summary-list' }, options.map(function (option) {
        return el('button', {
          type: 'button', class: 'menu-row',
          onclick: option.run,
        }, [
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'name', text: option.label }),
            el('span', { class: 'plan-sets', text: option.hint }),
          ]),
          el('span', { class: 'detail', text: '›' }),
        ]);
      })),
    ]);
  }

  /** 시작한 뒤 — 지금 할 종목 하나. */
  function renderActiveLift() {
    // 시간 예산을 바꾸면 종목이 줄어든다. 커서가 밖으로 나가지 않게 잡아둔다.
    if (state.liftCursor >= state.lifts.length) state.liftCursor = Math.max(0, state.lifts.length - 1);
    var lift = state.lifts[state.liftCursor];
    if (!lift) { state.started = false; renderPlanList(); return; }

    var total = state.lifts.length;
    var position = state.liftCursor + 1;

    // 지금 몇 세트째인가. 다 했으면 "완료"라고 쓴다.
    var pending = lift.sets.filter(function (set) { return !set.done; }).length;
    var doneHere = lift.sets.length - pending;
    var setPosition = pending > 0
      ? { now: String(doneHere + 1), total: '/ ' + lift.sets.length }
      : { now: '완료', total: '' };

    screen.appendChild(el('div', { class: 'progress-head' }, [
      el('button', {
        type: 'button', class: 'demo-open', text: '목록',
        'aria-label': '오늘 할 것 목록으로',
        onclick: function () { state.started = false; render(); },
      }),
      /*
       * 종목과 세트를 둘 다 여기 둔다.
       *
       * 세트 수를 카드 안에 두었더니 스크롤하면 이 머리띠가 그 줄을
       * 덮었다. 게다가 "2 / 5"(종목)와 "세트 1 / 5"가 한 화면에 같이
       * 떠서 어느 게 어느 건지도 알 수 없었다. 라벨을 붙여 한곳에 모은다.
       */
      el('span', { class: 'progress-counts' }, [
        el('span', { class: 'progress-count' }, [
          el('i', { text: '종목' }),
          el('b', { text: String(position) }),
          el('span', { text: '/ ' + total }),
        ]),
        el('span', { class: 'progress-count set' }, [
          el('i', { text: '세트' }),
          el('b', { text: setPosition.now }),
          el('span', { text: setPosition.total }),
        ]),
      ]),
      el('span', { class: 'progress-bar' }, [
        el('i', { style: 'width:' + Math.round((position / total) * 100) + '%' }),
      ]),
      /*
       * 운동한 지 얼마나 됐는지. 헬스장에서 제일 자주 하는 질문인데
       * 폰 시계로는 "몇 시"만 알지 "얼마나 했는지"는 모른다.
       */
      // 숫자만 있으면 휴식 시간과 헷갈린다. 무엇을 재는 시계인지 붙여둔다.
      el('span', { class: 'elapsed' }, [
        el('i', { text: '운동' }),
        el('span', { id: 'session-elapsed', text: elapsedText() }),
      ]),
    ]));

    renderWarnings();
    screen.appendChild(buildLiftCard(lift, state.liftCursor));

    var remaining = lift.sets.filter(function (set) { return !set.done; }).length;
    var last = state.liftCursor >= total - 1;

    var finished = allSetsDone();

    /*
     * 다 끝냈으면 "이전"만 남는다. 그 버튼 하나가 막다른 길처럼 보이면
     * 안 되므로, 완료 버튼을 바로 아래에 붙이고 "이전"은 좁게 둔다.
     */
    var nav = el('div', { class: 'step-nav' + (finished ? ' done' : '') }, [
      state.liftCursor > 0
        ? el('button', {
            /* "이전"만 있으면 세트 얘긴지 종목 얘긴지 모른다. "다음 종목"과 짝을 맞춘다. */
            type: 'button', class: 'ghost', text: '← 이전 종목',
            onclick: function () { state.liftCursor -= 1; render(); },
          })
        : null,
      last
        ? null
        : el('button', {
            /* 세트가 남았는데 넘어가는 것도 막지 않는다 — 기구가 막혀서
               순서를 바꾸는 일이 헬스장에서는 늘 있다. 다만 티는 낸다. */
            type: 'button',
            class: remaining === 0 ? 'primary' : 'ghost',
            text: remaining === 0 ? '다음 종목' : '다음 종목 (' + remaining + '세트 남음)',
            onclick: function () { state.liftCursor += 1; render(); },
          }),
    ]);
    if (nav.childNodes.length > 0) screen.appendChild(nav);

    /*
     * 완료 버튼이 컨디셔닝·맥스테스트 시트 아래에 묻혀 있었다. 다 끝냈는데
     * 다음 행동이 스크롤 두 번 아래에 있으면 "아무 일도 안 일어난다"로
     * 읽힌다. 끝났으면 이게 제일 먼저 와야 한다.
     */
    if (finished) renderFinish(false);

    if (last) {
      renderMaxTest();
      renderConditioning();
    }
  }

  /**
   * 세트를 한 번에 하나씩.
   *
   * 6세트를 다 펼쳐 놓으면 똑같이 생긴 줄이 여섯 개 쌓인다. 화면에서
   * 스크롤을 잃고, 지금 몇 세트째인지 세어 봐야 알게 된다. 헬스장에서
   * 숨차는 채로 할 일이 아니다.
   *
   * 그래서 지금 할 세트 하나만 크게 띄우고, 끝난 것은 접어서 위에 둔다.
   * 어디쯤인지는 점으로 본다 — 세어 볼 필요가 없다.
   */
  function renderSetTrack(lift, liftIndex) {
    var sets = lift.sets;
    var doneCount = sets.filter(function (set) { return set.done; }).length;
    var cursor = -1;
    for (var i = 0; i < sets.length; i += 1) {
      if (!sets[i].done) { cursor = i; break; }
    }

    var wrap = el('div', { class: 'set-track' }, []);

    /*
     * 몇 세트째인가. 헬스장에서 흘끗 볼 때 중량 다음으로 필요한 숫자인데
     * 11px 회색 글자였다. 점은 세어 보지 않고 아는 용이고, 숫자는 정확히
     * 아는 용이다 — 둘 다 한 줄에 두되 숫자를 읽을 수 있게 키운다.
     */
    wrap.appendChild(el('div', { class: 'set-dots-row' }, [
      el('span', { class: 'set-dots' }, sets.map(function (set, setIndex) {
        return el('i', {
          class: set.done ? 'on' : (setIndex === cursor ? 'now' : ''),
          'aria-hidden': 'true',
        });
      })),
      /*
       * 숫자는 머리띠에 있다. 여기서 또 세면 한 화면에 같은 숫자가 두 번
       * 뜨고, 스크롤하면 머리띠가 이 줄을 덮어서 잘린 숫자만 보인다.
       */
      el('span', { class: 'set-count ' + (cursor >= 0 ? 'quiet' : 'done'), text:
        cursor >= 0 ? doneCount + '세트 완료 · ' + (sets.length - doneCount) + '세트 남음'
          : sets.length + '세트 완료' }),
    ]));

    /* 끝낸 세트는 접어 둔다. 기록을 고칠 일은 있지만 늘 보일 필요는 없다. */
    if (doneCount > 0) {
      var open = state.doneOpen[lift.exercise.id] === true;
      wrap.appendChild(el('button', {
        type: 'button', class: 'done-head', 'aria-expanded': String(open),
        onclick: function () {
          state.doneOpen[lift.exercise.id] = !open;
          render();
        },
      }, [
        el('span', { class: 'warmup-label', text: '완료' }),
        el('span', { class: 'warmup-summary', text: doneCount + '세트' }),
        el('span', { class: 'warmup-toggle', text: open ? '접기' : '보기' }),
      ]));

      if (open) {
        sets.forEach(function (set, setIndex) {
          if (!set.done) return;
          wrap.appendChild(el('div', { class: 'done-set' }, [
            el('span', { class: 'set-no', text: String(setIndex + 1) }),
            el('span', { class: 'done-detail', text:
              (set.weightKg > 0 ? set.weightKg + 'kg' : '맨몸') + ' × ' + set.reps + '회 · RIR ' + set.rir }),
            el('button', {
              type: 'button', class: 'demo-open', text: '고치기',
              'aria-label': (setIndex + 1) + '세트 기록 고치기',
              onclick: function () { undoSet(liftIndex, setIndex); },
            }),
          ]));
        });
      }
    }

    if (cursor >= 0) {
      wrap.appendChild(renderCurrentSet(lift, liftIndex, sets[cursor], cursor));
    } else {
      wrap.appendChild(el('div', { class: 'set-cleared', text: '이 종목은 끝났습니다.' }));
    }

    return wrap;
  }

  /** 지금 할 세트. 화면에서 제일 커야 한다 — 지금 할 일은 이것 하나다. */
  function renderCurrentSet(lift, liftIndex, set, setIndex) {
    var plates = set.weightKg > 0 && lift.loading ? E.platePlan(set.weightKg, lift.loading) : null;
    var target = set.targetReps.min === set.targetReps.max
      ? set.targetReps.max + '회'
      : set.targetReps.min + '–' + set.targetReps.max + '회';

    var body = [];

    /*
     * 중량과 반복은 직접 친다.
     *
     * ± 버튼만 두면 105에서 60으로 내리는 데 열여덟 번을 눌러야 한다.
     * 처방과 다르게 한 날이 오히려 기록이 중요한 날이고, 그때 입력이
     * 번거로우면 아예 기록을 안 한다. 버튼은 미세 조정용으로 남긴다.
     */
    if (set.weightKg > 0) {
      body.push(el('div', { class: 'now-load' }, [
        el('div', { class: 'big-field' }, [
          el('button', { type: 'button', class: 'nudge', 'aria-label': '중량 줄이기', text: '−',
            onclick: function () { stepWeight(liftIndex, setIndex, -1); } }),
          el('input', {
            type: 'number', min: '0', max: '999', step: 'any', inputmode: 'decimal',
            class: 'big-input', value: String(set.weightKg),
            'aria-label': (setIndex + 1) + '세트 중량 (kg)',
            onfocus: function (event) { event.target.select(); },
            onchange: function (event) { typeWeight(liftIndex, setIndex, event.target.value); },
          }),
          el('span', { class: 'big-unit', text: 'kg' }),
          el('button', { type: 'button', class: 'nudge', 'aria-label': '중량 늘리기', text: '+',
            onclick: function () { stepWeight(liftIndex, setIndex, 1); } }),
        ]),
      ]));
    } else {
      body.push(el('div', { class: 'now-load' }, [el('span', { class: 'weight', text: '맨몸' })]));
    }

    if (plates) body.push(el('div', { class: 'plates', text: E.describePlates(plates) }));

    /*
     * 친 무게를 이 헬스장에서 만들 수 있는지 본다. 못 만들면 고쳐주지
     * 않고 알려만 준다 — 다른 바를 쓰거나 눈금이 다른 기계일 수도 있고,
     * 그건 사용자가 더 잘 안다.
     */
    if (set.weightKg > 0 && lift.loading) {
      var loadable = E.nearestLoadable(set.weightKg, lift.loading, 'nearest');
      if (Math.abs(loadable - set.weightKg) > 0.01) {
        body.push(el('button', {
          type: 'button', class: 'snap-note',
          onclick: function () { setWeight(liftIndex, setIndex, loadable); },
        }, [
          el('span', { text: set.weightKg + 'kg — 이 헬스장 기구로는 만들 수 없는 무게입니다.' }),
          el('span', { class: 'snap-to', text: loadable + 'kg로 맞추기' }),
        ]));
      }
    }

    if (set.adjustment) {
      body.push(el('div', { class: 'set-result' }, [
        el('em', { text: (set.adjustment.deltaKg > 0 ? '+' : '') + set.adjustment.deltaKg + 'kg — ' + set.adjustment.reason }),
      ]));
    }

    body.push(el('div', { class: 'now-reps' }, [
      el('span', { class: 'rir-label', text: '반복' }),
      el('span', { class: 'now-target', text: '목표 ' + target }),
      el('div', { class: 'big-field small' }, [
        el('button', { type: 'button', class: 'nudge', 'aria-label': '반복 수 줄이기', text: '−',
          onclick: function () { setReps(liftIndex, setIndex, -1); } }),
        el('input', {
          type: 'number', min: '1', max: '100', step: '1', inputmode: 'numeric',
          class: 'big-input', value: String(set.reps),
          'aria-label': (setIndex + 1) + '세트 반복 수',
          onfocus: function (event) { event.target.select(); },
          onchange: function (event) { typeReps(liftIndex, setIndex, event.target.value); },
        }),
        el('span', { class: 'big-unit', text: '회' }),
        el('button', { type: 'button', class: 'nudge', 'aria-label': '반복 수 늘리기', text: '+',
          onclick: function () { setReps(liftIndex, setIndex, 1); } }),
      ]),
    ]));

    var chips = el('div', { class: 'rir-row now-rir' }, [
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
    body.push(chips);

    // 세트 번호는 바로 위 점 줄에 크게 있다. 여기 또 쓰면 두 번 읽게 된다.
    return el('div', { class: 'set-now' }, [
      el('div', { class: 'now-body' }, body),
    ]);
  }

  /** 잘못 누른 세트를 되돌린다. 기록도 같이 빼야 볼륨이 부풀지 않는다. */
  function undoSet(liftIndex, setIndex) {
    var set = state.lifts[liftIndex].sets[setIndex];
    if (!set.done) return;
    if (set.logged) {
      var at = state.todaySets.indexOf(set.logged);
      if (at >= 0) state.todaySets.splice(at, 1);
      set.logged = null;
    }
    set.done = false;
    set.rir = undefined;
    render();
  }

  /** 종목 카드 하나. 목록 화면에서는 안 쓰고 진행 화면에서만 쓴다. */
  function buildLiftCard(lift, liftIndex) {
    var nameRow = el('div', { class: 'lift-name' }, [el('span', { text: lift.exercise.name })]);
    if (lift.substitutedFrom) {
      nameRow.appendChild(el('span', { class: 'swap-tag', text: '← ' + lift.substitutedFrom.name }));
    }
    if (state.occupied[lift.exercise.id] === 'deferred') {
      nameRow.appendChild(el('span', { class: 'occupied-tag', text: '뒤로 미룸' }));
    }

    /*
     * 묶인 종목이면 같은 바퀴에 뭐가 있는지 알려준다 — 번갈아 하는
     * 중이라는 걸 화면이 말해야 한다. 셋 이상이면 이름을 다 쓰면 길어져서
     * 다음 것 하나와 몇 번째인지만 쓴다.
     */
    var pair = E.groupOf(state.supersets, lift.exercise.id);
    if (pair) {
      var spot = pair.indexOf(lift.exercise.id);
      var nextId = pair[(spot + 1) % pair.length];
      var mate = index.get(nextId);
      nameRow.appendChild(el('span', { class: 'pair-tag', text:
        pair.length > 2
          ? '↻ ' + E.groupLabel(pair) + ' ' + (spot + 1) + '/' + pair.length +
            (mate ? ' · 다음 ' + mate.name : '')
          : '⇄ ' + (mate ? mate.name : E.groupLabel(pair)) }));
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

    /*
     * 첫 화면에서 기구 31개를 정확히 고르게 할 수는 없다 — "플랫 벤치"와
     * "인클라인 벤치"가 뭔지 모르는 사람이 훨씬 많다. 대충 시작하고 여기서
     * 고친다. 지금은 눈앞에 기구가 있으니 틀릴 수가 없다.
     */
    if (E.equipmentBehind(lift.exercise, currentGymEntry() || { equipmentIds: [] }).length > 0) {
      nameRow.appendChild(el('button', {
        type: 'button',
        class: 'demo-open missing',
        text: '없어요',
        'aria-label': lift.exercise.name + '에 필요한 기구가 헬스장에 없을 때',
        onclick: function () { openMissingEquipment(lift.exercise); },
      }));
    }

    var card = el('div', { class: 'lift' }, [
      el('div', { class: 'lift-head' }, [
        nameRow,
        el('div', { class: 'lift-note', text: lift.note }),
      ]),
    ]);

    // 다른 헬스장에서 하던 기계면 표기 중량이 다르다. 숨기면 안 된다.
    if (lift.gymWeightNote) {
      card.appendChild(el('div', { class: 'machine-note' }, [
        el('span', { class: 'label', text: '처음 쓰는 기계' }),
        el('span', { text: lift.gymWeightNote }),
      ]));
    }

    card.appendChild(renderWarmup(lift));
    card.appendChild(renderSetTrack(lift, liftIndex));

    var decision = renderDecision(lift);
    if (decision) card.appendChild(decision);

    /*
     * 강도 기법은 "마지막 세트에 붙일" 것이다. 세트를 다 기록한 뒤에도
     * 떠 있으면 끝난 종목 밑에 할 일이 남은 것처럼 보이고, 정작 다음
     * 행동인 완료 버튼을 화면 밖으로 밀어낸다.
     */
    var pending = lift.sets.some(function (set) { return !set.done; });
    if (pending) card.appendChild(renderTechniques(lift));
    return card;
  }

  function renderToday() {
    if (state.sessionClosed) renderClosedToday();
    else if (state.started) renderActiveLift();
    else renderPlanList();
  }

  /**
   * 오늘을 마친 뒤의 화면.
   *
   * 끝났는데 목록이 또 나오면 "아직 안 끝났나?" 싶어진다. 끝났다고
   * 분명히 말하고, 요약을 다시 볼 길과 되돌릴 길만 남긴다.
   */
  function renderClosedToday() {
    var head = sessionHead();
    screen.appendChild(head.node);

    var minutes = state.sessionStartedAt
      ? Math.max(1, Math.round((Date.now() - state.sessionStartedAt) / 60000))
      : null;

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '오늘 운동을 마쳤습니다' }),
        el('span', { class: 'meta', text: state.todaySets.length + '세트' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        el('p', { class: 'hint-line', text: minutes
          ? minutes + '분 동안 ' + state.todaySets.length + '세트를 했습니다. 기록은 볼륨·진행 탭에 반영됐습니다.'
          : '기록은 볼륨·진행 탭에 반영됐습니다.' }),
        el('button', { type: 'button', class: 'finish', text: '요약 다시 보기', onclick: openSummary }),
        el('button', {
          type: 'button', class: 'finish quiet', text: '아직 안 끝났어요 — 이어서 하기',
          onclick: function () {
            // 잘못 눌렀을 수 있다. 되돌아가는 길을 막지 않는다.
            state.sessionClosed = false;
            state.started = true;
            render();
          },
        }),
      ]),
    ]));
  }

  /**
   * 오늘을 닫고 요약을 본다. 세트를 하나도 안 했으면 닫을 것도 없다.
   *
   * 마지막 종목이 아니면 조용히 둔다. 운동 중에 화면에서 제일 큰 버튼이
   * "세션 완료"면 다음에 뭘 해야 하는지 잘못 읽힌다 — 지금 할 일은
   * 다음 종목이다.
   */
  /**
   * 오늘을 닫는다.
   *
   * 기록을 이력으로 넘기고 진행 화면에서 빠져나온다. 요약은 다시 볼 수
   * 있게 남겨둔다 — 닫자마자 사라지면 방금 본 숫자를 확인할 길이 없다.
   */
  function closeToday() {
    if (state.todaySets.length === 0) return;
    state.sessionClosed = true;
    state.started = false;
    modal.close();
    render();
  }

  /** 오늘 할 세트가 하나도 안 남았는가. */
  function allSetsDone() {
    return state.lifts.length > 0 && state.lifts.every(function (lift) {
      return lift.sets.every(function (set) { return set.done; });
    });
  }

  /**
   * 오늘을 닫고 요약을 본다.
   *
   * 운동 중에는 안 보여준다. 3세트째에 "세션 완료 · 2세트 요약 보기"가
   * 화면에서 제일 큰 버튼이면 다음에 뭘 해야 하는지 잘못 읽힌다 — 지금
   * 할 일은 다음 세트고, 요약은 다 끝나고 볼 것이다.
   *
   * 중간에 끝내야 하는 날도 있으므로 길을 막지는 않는다. 그건 목록
   * 화면에 조용한 버튼으로 둔다.
   */
  function renderFinish(quiet) {
    var done = state.todaySets.length;
    if (done === 0) return;
    screen.appendChild(el('button', {
      type: 'button',
      class: 'finish' + (quiet ? ' quiet' : ' major'),
      text: quiet
        ? '여기서 끝내기 · ' + done + '세트 요약'
        : '오늘 운동 완료 · 요약 보기',
      onclick: openSummary,
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

  /**
   * 와드 기록 남기기.
   *
   * 형식마다 남기는 것이 다르다 — For Time은 걸린 시간, AMRAP은 라운드,
   * EMOM은 끝까지 했는가. 한 가지 칸을 모든 형식에 쓰면 기록이 못 쓰게
   * 된다.
   */
  function openWodScore(workout) {
    var kind = E.scoreKindOf(workout.format);
    var draft = { seconds: workout.durationMinutes * 60, rounds: 3, extraReps: 0,
      completed: true, stoppedAtMinute: Math.max(1, workout.durationMinutes - 2) };

    var draw = function () {
      var body = [];
      body.push(el('p', { class: 'asset-note', text: E.wodLabel(workout) }));

      if (kind === 'time') {
        var mins = Math.floor(draft.seconds / 60);
        var secs = draft.seconds % 60;
        body.push(el('div', { class: 'list-label', text: '걸린 시간' }));
        body.push(el('div', { class: 'time-free' }, [
          numberBox(mins, '분', 0, 120, function (value) {
            draft.seconds = value * 60 + (draft.seconds % 60); draw();
          }),
          numberBox(secs, '초', 0, 59, function (value) {
            draft.seconds = Math.floor(draft.seconds / 60) * 60 + value; draw();
          }),
        ]));
      } else if (kind === 'rounds') {
        body.push(el('div', { class: 'list-label', text: '완료한 라운드' }));
        body.push(el('div', { class: 'time-free' }, [
          numberBox(draft.rounds, '라운드', 0, 99, function (value) { draft.rounds = value; draw(); }),
          numberBox(draft.extraReps, '회 더', 0, 999, function (value) { draft.extraReps = value; draw(); }),
        ]));
        body.push(el('p', { class: 'hint-line', text:
          '마지막 라운드를 다 못 채웠으면 채운 만큼을 "회 더"에 적으세요.' }));
      } else {
        body.push(el('div', { class: 'list-label', text: '끝까지 했나요' }));
        body.push(el('div', { class: 'chip-row' }, [
          el('button', { type: 'button', class: 'pick', 'aria-pressed': String(draft.completed),
            text: '완주', onclick: function () { draft.completed = true; draw(); } }),
          el('button', { type: 'button', class: 'pick', 'aria-pressed': String(!draft.completed),
            text: '중간에 멈춤', onclick: function () { draft.completed = false; draw(); } }),
        ]));
        if (!draft.completed) {
          body.push(el('div', { class: 'time-free' }, [
            numberBox(draft.stoppedAtMinute, '분에서', 1, workout.durationMinutes,
              function (value) { draft.stoppedAtMinute = value; draw(); }),
          ]));
        }
      }

      body.push(el('button', {
        type: 'button', class: 'finish', text: '기록하기',
        onclick: function () { saveWodScore(workout, draft); },
      }));

      openModal('와드 기록', E.formatLabel(workout.format) + ' ' + workout.durationMinutes + '분', body);
    };
    draw();
  }

  /** 숫자 한 칸. 직접 치고 ±로 미세 조정한다 — 중량 입력과 같은 방식이다. */
  function numberBox(value, unit, min, max, onChange) {
    var input = el('input', {
      type: 'number', min: String(min), max: String(max), step: '1', inputmode: 'numeric',
      class: 'big-input', value: String(value), 'aria-label': unit,
      onfocus: function (event) { event.target.select(); },
      onchange: function (event) {
        var next = parseInt(event.target.value, 10);
        onChange(Number.isFinite(next) ? clamp(next, min, max) : value);
      },
    });
    return el('div', { class: 'big-field small' }, [
      el('button', { type: 'button', class: 'nudge', text: '−', 'aria-label': unit + ' 줄이기',
        onclick: function () { onChange(clamp(value - 1, min, max)); } }),
      input,
      el('span', { class: 'big-unit', text: unit }),
      el('button', { type: 'button', class: 'nudge', text: '+', 'aria-label': unit + ' 늘리기',
        onclick: function () { onChange(clamp(value + 1, min, max)); } }),
    ]);
  }

  function saveWodScore(workout, draft) {
    var result = E.recordWod(workout, state.todayDate, draft);
    var comparison = E.compareWod(result, state.wodResults);
    state.wodResults = state.wodResults.concat([result]);

    pushLog('와드 기록', '<b>' + E.formatLabel(workout.format) + ' ' +
      workout.durationMinutes + '분</b> — ' + E.describeScore(result) + '. ' + comparison.text);

    /*
     * close()를 먼저 부르지 않는다. close 이벤트가 비동기로 와서 방금 그린
     * 내용을 나중에 지워버린다 — openModal이 내용만 갈아끼운다.
     */
    // 비교 결과를 바로 보여준다. 기록만 남기고 아무 말이 없으면 남길 이유가 없다.
    openModal('와드 기록', E.describeScore(result), [
      el('p', { class: 'compare-headline', text: comparison.text }),
      el('p', { class: 'asset-note', text: E.wodLabel(workout) }),
      comparison.attempts > 1
        ? el('div', { class: 'summary-list' },
            E.historyOf(state.wodResults, result.signature).map(function (r) {
              return el('div', { class: 'record' }, [
                el('span', { text: r.date }),
                r === comparison.best ? el('span', { class: 'pr', text: '최고' }) : null,
                el('span', { class: 'detail', text: E.describeScore(r) }),
              ]);
            }))
        : el('p', { class: 'hint-line', text:
            '다음에 같은 와드를 하면 여기서 비교해 드립니다. 다른 구성으로 하면 비교하지 않습니다 — ' +
            '동작이 다르면 라운드 수를 견줘도 의미가 없습니다.' }),
      el('button', { type: 'button', class: 'finish', text: '닫기',
        onclick: function () { modal.close(); render(); } }),
    ]);
    render();
  }

  /** 오늘 근력 세션이 쓰는 부위. 와드는 여기를 피한다. */
  function wodAvoid() {
    var out = [];
    state.lifts.forEach(function (lift) {
      var muscle = E.primaryMuscle(lift.exercise);
      if (muscle && out.indexOf(muscle) < 0) out.push(muscle);
    });
    return out;
  }

  /**
   * 와드 한 판을 만든다.
   *
   * 몸풀기가 같이 나온다. 근력 세션의 워밍업은 종목마다 본세트 중량에
   * 맞춰 올라가는 램프지만, 와드는 시작하자마자 최대 강도로 들어간다 —
   * 들어가기 전에 다 풀려 있어야 하고, 와드 중간에는 풀 시간이 없다.
   */
  function buildWod(format, todayMuscles) {
    var gym = currentGymEntry();
    state.conditioning = E.buildWodSession({
      format: format,
      minutes: state.wodMinutes,
      level: state.lifter.level,
      equipmentIds: gym ? gym.equipmentIds : E.COMMON_EQUIPMENT_IDS,
      pain: activePain(),
      avoidMuscles: todayMuscles || [],
      allowBarbell: state.wodBarbell,
      standalone: !todayMuscles || todayMuscles.length === 0,
    });
    state.conditioningFormat = format;

    var w = state.conditioning.workout;
    pushLog('컨디셔닝', '<b>' + w.label + ' ' + w.durationMinutes + '분</b> — 몸풀기 ' +
      state.conditioning.warmup.minutes + '분 포함 총 ' + state.conditioning.totalMinutes +
      '분. 피로 ' + w.fatigueLoad + '세트분' +
      (todayMuscles && todayMuscles.length ? ' · 오늘 근력 세션과 겹치는 부위를 피했습니다' : ''));
    render();
  }

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
          buildWod(format, todayMuscles);
        },
      });
    })));

    /* 길이와 바벨 여부. 둘 다 와드의 성격을 크게 바꾼다. */
    var options = el('div', { class: 'chip-row' }, []);
    [8, 12, 16, 20].forEach(function (minutes) {
      options.appendChild(el('button', {
        type: 'button', class: 'pick', 'aria-pressed': String(state.wodMinutes === minutes),
        text: minutes + '분',
        onclick: function () {
          state.wodMinutes = minutes;
          if (state.conditioningFormat) buildWod(state.conditioningFormat, wodAvoid());
          else render();
        },
      }));
    });
    options.appendChild(el('button', {
      type: 'button', class: 'pick', 'aria-pressed': String(state.wodBarbell),
      text: '바벨 넣기',
      title: '데드리프트 같은 바벨 동작을 넣습니다. 무게를 낮게 잡아야 합니다.',
      onclick: function () {
        state.wodBarbell = !state.wodBarbell;
        if (state.conditioningFormat) buildWod(state.conditioningFormat, wodAvoid());
        else render();
      },
    }));
    body.appendChild(options);

    if (state.conditioning) {
      var session = state.conditioning;
      var workout = session.workout;

      body.appendChild(el('p', { class: 'hint-line', text:
        '총 ' + session.totalMinutes + '분 — 몸풀기 ' + session.warmup.minutes +
        '분 + ' + workout.label + ' ' + workout.durationMinutes + '분' }));

      // 몸풀기 — 와드 앞에 와야 하는 것이라 와드보다 먼저 그린다
      body.appendChild(el('div', { class: 'list-label', text: '몸풀기 ' + session.warmup.minutes + '분' }));
      body.appendChild(el('ul', { class: 'cue-list' }, session.warmup.steps.map(function (step) {
        return el('li', {}, [el('span', { text: step })]);
      })));

      body.appendChild(el('div', { class: 'list-label', text: workout.label }));
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

      session.cautions.forEach(function (caution) {
        body.appendChild(el('div', { class: 'notice stop' }, [
          el('div', { class: 'label', text: '주의' }),
          el('div', { text: caution }),
        ]));
      });

      workout.notes.forEach(function (note) {
        body.appendChild(el('p', { class: 'hint-line', text: note }));
      });
      // 같은 구성으로 전에 한 적이 있으면 미리 보여준다 — 목표가 생긴다
      var past = E.historyOf(state.wodResults, E.wodSignature(workout));
      if (past.length > 0) {
        body.appendChild(el('p', { class: 'hint-line', text:
          '같은 구성 지난 기록 — ' + past.slice(0, 3).map(function (r) {
            return r.date + ' ' + E.describeScore(r);
          }).join(' · ') }));
      }

      body.appendChild(el('button', {
        type: 'button', class: 'finish', text: '끝냈습니다 — 기록하기',
        onclick: function () { openWodScore(workout); },
      }));

      body.appendChild(el('button', {
        type: 'button', class: 'pick', text: '지우기',
        onclick: function () { state.conditioning = null; state.conditioningFormat = null; render(); },
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

  /** 오늘 운동 할 수 있는 시간. 현실에서 가장 흔한 제약인데 대부분의 앱이 안 받아준다. */
  function applyTimeBudget(minutes) {
    state.timeBudget = minutes;
    rebuildSession();
    if (minutes && state.timeFit && state.timeFit.adjustments.length > 0) {
      pushLog('시간 예산', '<b>' + minutes + '분</b>에 맞춰 조정했습니다 — ' + state.timeFit.notes[0]);
    }
    render();
  }

  /**
   * 시간 조절 알맹이. 요약 카드를 펼치면 이게 나온다.
   *
   * 예전에는 화면에 늘 펼쳐진 시트였는데, 시작 전 화면에서 제일 중요한 건
   * "오늘 뭘 하는가"라 목록이 먼저 와야 한다. 시간은 필요할 때만 연다.
   */
  function timeBudgetControls(estimate) {
    /*
     * 미리 정해둔 몇 개만 고르게 하면 "오늘은 37분밖에 없다"를 못 받는다.
     * 칩은 빠른 선택일 뿐이고, 실제 값은 직접 적는다.
     */
    var chips = el('div', { class: 'chip-row' }, []);
    TIME_BUDGETS.forEach(function (minutes) {
      chips.appendChild(el('button', {
        type: 'button', class: 'pick',
        'aria-pressed': String(state.timeBudget === minutes),
        text: minutes + '분',
        onclick: function () { applyTimeBudget(minutes); },
      }));
    });

    var input = el('input', {
      type: 'number', min: '10', max: '300', step: '1', inputmode: 'numeric',
      value: state.timeBudget == null ? '' : String(state.timeBudget),
      // 빈칸에 오늘 예상 시간을 흐리게 띄운다 — 몇 자리를 적는 칸인지 바로 안다
      placeholder: String(estimate.totalMinutes),
      'aria-label': '오늘 운동 할 수 있는 시간 (분)',
      onchange: function (event) {
        var value = parseInt(event.target.value, 10);
        // 비우면 제한 없음. 0이나 음수를 적어도 같게 본다.
        applyTimeBudget(Number.isFinite(value) && value >= 10 ? Math.min(300, value) : null);
      },
    });
    var step = function (delta) {
      var base = state.timeBudget == null ? Math.round(estimate.totalMinutes / 5) * 5 : state.timeBudget;
      applyTimeBudget(Math.max(10, Math.min(300, base + delta)));
    };
    var field = el('div', { class: 'number-field' }, [
      el('button', { type: 'button', class: 'nudge', text: '−', 'aria-label': '5분 줄이기',
        onclick: function () { step(-5); } }),
      input,
      el('span', { class: 'unit', text: '분' }),
      el('button', { type: 'button', class: 'nudge', text: '+', 'aria-label': '5분 늘리기',
        onclick: function () { step(5); } }),
    ]);

    var out = [
      chips,
      el('div', { class: 'time-free' }, [
        field,
        el('button', {
          type: 'button', class: 'pick',
          'aria-pressed': String(state.timeBudget == null),
          text: '제한 없음',
          onclick: function () { applyTimeBudget(null); },
        }),
      ]),
    ];

    if (state.timeFit) {
      var fit = state.timeFit;
      out.push(el('p', {
        class: 'hint-line' + (fit.fits ? '' : ' warn'),
        text: Math.round(fit.beforeSeconds / 60) + '분 → ' + Math.round(fit.afterSeconds / 60) + '분' +
          (fit.fits ? '' : ' (예산 초과)'),
      }));

      var dropped = fit.adjustments.filter(function (a) { return a.action === 'drop'; });
      var trimmed = fit.adjustments.filter(function (a) { return a.action === 'trimSets'; });
      if (dropped.length > 0) {
        out.push(el('p', { class: 'hint-line', text:
          '제외: ' + dropped.map(function (a) { return a.name; }).join(', ') }));
      }
      if (trimmed.length > 0) {
        out.push(el('p', { class: 'hint-line', text: '세트 축소 ' + trimmed.length + '건' }));
      }
      fit.notes.forEach(function (note) {
        out.push(el('p', { class: 'hint-line', text: note }));
      });
    } else {
      out.push(el('p', { class: 'hint-line', text:
        '분 단위로 직접 적으면 됩니다. 그 안에 들어오게 고립 운동부터 자르고 메인 복합 동작은 지킵니다. ' +
        '비워 두면 프로그램을 그대로 합니다.' }));
    }

    return out;
  }

  /**
   * 컨디션 카드를 펼쳤을 때.
   *
   * 퍼센트 하나만 던지면 무슨 근거인지 모른다. 피로 신호를 그대로 보여준다 —
   * 엔진이 이미 "왜"를 계산하고 있으므로 지어낼 것이 없다.
   */
  function conditionDetail() {
    var f = state.plan.fatigue;
    var out = [el('p', { class: 'hint-line', text:
      '피로 점수 ' + f.score + ' / 디로드 기준 ' + f.threshold + '. 낮을수록 좋습니다.' })];

    if (!f.signals || f.signals.length === 0) {
      out.push(el('p', { class: 'hint-line', text: '잡힌 피로 신호가 없습니다.' }));
    } else {
      f.signals.forEach(function (signal) {
        out.push(el('p', { class: 'hint-line', text: '· ' + signal.label }));
      });
    }

    if (f.deloadRecommended) {
      out.push(el('p', { class: 'hint-line warn', text:
        '디로드 기준을 넘었습니다. 주간 탭에서 처방을 확인하세요.' }));
    }
    return out;
  }

  /** 워밍업 램프 — 본세트 중량에 맞춰 올라간다. 볼륨에는 세지 않는다. */
  function renderWarmup(lift) {
    var warmup = lift.warmup;
    /*
     * 워밍업은 첫 본세트 전에만 볼 것이다. 4세트짜리 램프가 계속 펼쳐져
     * 있으면 정작 지금 할 세트가 화면 밖으로 밀린다. 그래서 본세트를
     * 하나라도 끝내면 접는다 — 사용자가 직접 연 경우는 그대로 둔다.
     */
    var started = lift.sets.some(function (set) { return set.done; });
    var choice = state.warmupOpen[lift.exercise.id];
    var open = choice === undefined ? !started : choice;

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
      state.todaySets.length > 0 ? [{ date: state.todayDate, sets: state.todaySets, gymId: activeGymId() }] : []
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

    if (!E.allows(state.consent, 'painGate')) {
      body.appendChild(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '동의하지 않은 항목' }),
        el('div', { text: '통증 기록은 민감정보라 별도 동의가 필요합니다. ' +
          '동의하면 아픈 관절에 부담이 큰 종목을 자동으로 대체합니다.' }),
        el('button', {
          type: 'button', class: 'pick', text: '통증 기록에 동의하기',
          onclick: function () { grantConsent('painData'); },
        }),
      ]));
    }

    state.pain.forEach(function (report, i) {
      if (!E.allows(state.consent, 'painGate')) return;
      body.appendChild(numberRow({
        name: E.JOINT_LABELS_KO[report.joint] + ' 통증',
        value: report.score,
        min: 0,
        max: 10,
        unit: '/ 10',
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

    renderPrivacy();
    renderAppStatus();
  }

  /** 동의 하나를 추가로 받는다. 기록도 같이 갱신한다. */
  function grantConsent(id) {
    if (state.consent.indexOf(id) < 0) state.consent = state.consent.concat([id]);
    state.consentRecord = E.recordConsent(state.consent, todayISO());
    var item = E.consentItem(id);
    pushLog('동의', '<b>' + (item ? item.label : id) + '</b>에 동의했습니다.');
    rebuildSession();
    render();
  }

  /**
   * 내 정보.
   *
   * 열람권(제35조)과 삭제 요구권(제36조)은 "어딘가 적혀 있다"로는 부족하다.
   * 앱에서 지금 바로 보고 지울 수 있어야 한다.
   */
  function renderPrivacy() {
    var rows = el('div', { class: 'sheet-body' }, []);

    E.CONSENT_ITEMS.forEach(function (item) {
      var on = state.consent.indexOf(item.id) >= 0;
      var row = el('div', { class: 'status-row' }, [
        el('span', { class: 'status-key', text: item.required ? '필수' : '선택' }),
        el('span', {
          class: 'status-val ' + (on ? 'ok' : 'todo'),
          text: item.label + (item.sensitive ? ' · 민감정보' : ''),
        }),
      ]);

      row.appendChild(el('button', {
        type: 'button', class: 'pick',
        text: on ? '철회' : '동의',
        onclick: function () {
          if (!on) return grantConsent(item.id);
          var result = E.withdrawConsent(
            state.consentRecord || E.recordConsent(state.consent, todayISO()),
            item.id,
            todayISO(),
          );
          if (result.stopsService) {
            // 필수를 철회하면 서비스가 멈춘다. 되돌릴 수 없으니 먼저 알린다.
            confirmWithdrawal(item);
            return;
          }
          state.consent = result.record.given;
          state.consentRecord = result.record;
          purgeFor(item.id);
          pushLog('동의 철회', '<b>' + item.label + '</b>' + particleOf(item.label, '을/를') +
            ' 철회하고 해당 기록을 지웠습니다.');
          rebuildSession();
          render();
        },
      }));
      rows.appendChild(row);
    });

    rows.appendChild(el('div', { class: 'chip-row' }, [
      el('button', {
        type: 'button', class: 'pick', text: '내 데이터 내려받기',
        onclick: exportMyData,
      }),
      el('button', {
        type: 'button', class: 'pick danger', text: '전부 삭제',
        onclick: function () { confirmWipe(); },
      }),
    ]));

    if (state.consentRecord) {
      rows.appendChild(el('p', { class: 'hint-line', text:
        state.consentRecord.at + '에 ' + state.consentRecord.version + ' 판 문구로 동의했습니다.' }));
    }

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '내 정보' }),
        el('span', { class: 'meta', text: '동의 · 내려받기 · 삭제' }),
      ]),
      rows,
    ]));
  }

  /** 철회한 항목의 기록을 실제로 지운다. 동의만 끄고 데이터를 남기면 안 된다. */
  function purgeFor(id) {
    if (id === 'painData') {
      state.pain = JOINTS.map(function (joint) { return { joint: joint, score: 0 }; });
      state.checkIns = state.checkIns.map(function (entry) {
        return Object.assign({}, entry, { pain: [] });
      });
    }
  }

  function confirmWithdrawal(item) {
    openModal('동의 철회', '필수 항목', [
      el('p', { class: 'asset-note', text:
        withParticleJs(item.label, '은/는') + ' 이 앱의 핵심 기능에 필요합니다. 철회하면 ' + item.ifDeclined }),
      el('p', { class: 'asset-note', text:
        '철회하면 저장된 기록을 모두 지우고 처음 화면으로 돌아갑니다. 되돌릴 수 없습니다.' }),
      el('button', {
        type: 'button', class: 'finish danger', text: '철회하고 전부 삭제',
        onclick: function () { modal.close(); wipeEverything(); },
      }),
    ]);
  }

  function confirmWipe() {
    openModal('전부 삭제', '되돌릴 수 없음', [
      el('p', { class: 'asset-note', text:
        '동의 기록, 운동 기록, 체중, 통증, 등록한 헬스장을 모두 지웁니다. 되돌릴 수 없습니다. ' +
        '먼저 내려받아 두시겠습니까?' }),
      el('button', {
        type: 'button', class: 'pick', text: '내려받기',
        onclick: exportMyData,
      }),
      el('button', {
        type: 'button', class: 'finish danger', text: '네, 전부 삭제합니다',
        onclick: function () { modal.close(); wipeEverything(); },
      }),
    ]);
  }

  function wipeEverything() {
    storage.reset();
    state.consent = [];
    state.consentRecord = null;
    state.myDirectory = [];
    state.history = [];
    state.checkIns = [];
    state.todaySets = [];
    state.log = [];
    startOnboarding();
  }

  /**
   * 내려받기.
   *
   * 자기 기록을 가져갈 수 없으면 그건 사용자의 데이터가 아니다.
   * 사람이 읽을 수 있는 JSON으로 그대로 준다.
   */
  function exportMyData() {
    var payload = {
      내보낸시각: new Date().toISOString(),
      동의: state.consentRecord,
      설문: state.answers,
      신체: state.lifter,
      프로그램: state.program,
      헬스장: { 목록: state.gymBook, 직접등록: state.myDirectory },
      운동기록: state.history.concat(
        state.todaySets.length > 0
          ? [{ date: state.todayDate, sets: state.todaySets, gymId: activeGymId() }]
          : [],
      ),
      체크인: state.checkIns,
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = el('a', { href: url, download: '볼륨코치-내데이터.json' });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    pushLog('내 정보', '내 데이터를 JSON으로 내려받았습니다.');
    renderLog();
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

    renderPendingMerges();

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
        numberRow({
          name: '체중', value: state.lifter.bodyweightKg, min: 30, max: 200,
          step: 0.5, unit: 'kg', id: 'lifter-bw',
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
      // 위치 동의가 없으면 좌표를 아예 넘기지 않는다.
      near: myLocation(),
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

  /**
   * 지금 위치.
   *
   * 위치 동의가 없으면 없는 셈 친다 — 화면에서만 감추고 좌표를 계속 쓰면
   * 동의를 받은 게 아니다. 프로토타입에는 GPS가 없어 고정값을 쓴다.
   */
  function myLocation() {
    if (!E.allows(state.consent, 'nearbyGyms')) return undefined;
    return { lat: 37.5, lng: 127.03 };
  }

  /**
   * 지금 판정에 쓰는 전체 목록 — 공개 예시 + 내가 만든 것.
   * 같은 id가 겹치면 내가 손댄 쪽이 이긴다. 합치고 나면 내 기록이 원본이다.
   */
  function fullDirectory() {
    var mine = {};
    state.myDirectory.forEach(function (entry) { mine[entry.id] = entry; });
    var merged = E.SAMPLE_DIRECTORY.filter(function (entry) { return !mine[entry.id]; });
    return merged.concat(state.myDirectory);
  }

  /**
   * 나중에 확인하기로 미뤄둔 중복.
   *
   * 등록 순간에 막아 세우면 등록 자체를 포기한다. 일단 쓰게 두고, 헬스장
   * 탭에 왔을 때 다시 묻는다 — 그때가 사용자가 헬스장을 생각하고 있는
   * 순간이라 대답하기 쉽다.
   */
  function renderPendingMerges() {
    // 후보는 예시 디렉터리에 있을 수도 있다. 전체를 두고 봐야 짝이 풀린다.
    var pending = E.pendingMerges(fullDirectory());
    if (pending.length === 0) return;

    var item = pending[0];
    var other = item.others[0];

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '확인이 남았습니다' }),
      el('div', { text: '"' + item.entry.name + '"' + particleOf(item.entry.name, '과/와') +
        ' "' + other.name + '"' + particleOf(other.name, '이/가') + ' 같은 곳인가요? ' +
        '같은 곳이면 기구 정보가 한 곳에 모입니다.' }),
      el('div', { class: 'chip-row' }, [
        el('button', {
          type: 'button', class: 'pick',
          text: '"' + other.name + '"' + particleOf(other.name, '과/와') + ' 같은 곳',
          onclick: function () { settlePending(item.entry.id, other.id); },
        }),
        el('button', {
          type: 'button', class: 'pick',
          text: '다른 곳입니다',
          onclick: function () { settlePending(item.entry.id); },
        }),
      ]),
    ]));
  }

  function settlePending(entryId, mergedInto) {
    var all = fullDirectory();
    var before = all.filter(function (e) { return e.id === entryId; })[0];
    var resolved = E.resolvePending(all, entryId, mergedInto);

    /*
     * 예시 디렉터리는 읽기 전용이다. 손댄 것만 내 쪽에 남긴다 — 합친 대상은
     * 이제 내 기록이 섞였으니 내가 들고 있어야 한다.
     */
    var touched = {};
    state.myDirectory.forEach(function (e) { touched[e.id] = true; });
    if (mergedInto) touched[mergedInto] = true;
    state.myDirectory = resolved.filter(function (e) { return touched[e.id]; });

    if (mergedInto) {
      var target = state.myDirectory.filter(function (e) { return e.id === mergedInto; })[0];
      // 합쳐서 사라진 쪽을 쓰고 있었다면 남은 쪽으로 옮겨준다.
      state.gymBook = E.removeGym(state.gymBook, entryId);
      if (target) useGym(E.toGymEntry(target));
      var fromName = before ? before.name : '';
      var toName = target ? target.name : '';
      pushLog('헬스장', '<b>' + fromName + '</b>' + particleOf(fromName, '을/를') + ' <b>' +
        toName + '</b>' + particleOf(toName, '으로/로') + ' 합쳤습니다. 기구 정보가 한 곳에 모입니다.');
    } else {
      pushLog('헬스장', '다른 곳으로 확인했습니다. 다시 묻지 않습니다.');
    }
    render();
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

      body.push(el('p', { class: 'asset-note', text:
        '기구 이름을 몰라도 됩니다. 아래 "내 기구"에서 생김새로 찾을 수 있고, ' +
        '운동하면서 "이 기구 없어요"로 빼면 됩니다.' }));

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
      onclick: function () { submitGymRegister(); },
    }));

    openModal('헬스장 등록', '2 / 2', body);
  }

  /** 등록 시도. 겹치는 곳이 있으면 만들지 않고 먼저 보여준다. */
  function submitGymRegister(options) {
    options = options || {};
    var draft = state.gymDraft;
    var name = (draft.name || '').trim();
    if (name.length === 0) return;

    var result = E.registerGym({
      name: name,
      address: draft.floor,
      location: myLocation(),
      presetId: draft.presetId,
      directory: fullDirectory(),
      force: options.force,
      defer: options.defer,
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
        '기구 ' + result.entry.equipmentIds.length + '개로 시작합니다.' +
        ((result.entry.pendingMergeWith || []).length > 0
          ? ' 비슷한 곳 ' + result.entry.pendingMergeWith.length + '곳은 나중에 확인합니다.'
          : ''));
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
      onclick: function () { submitGymRegister({ force: true }); },
    }));

    /*
     * 지금 판단하기 어려울 수 있다. 막아 세우면 등록 자체를 포기한다.
     * 일단 쓰게 두고, 헬스장 탭에 올 때 다시 묻는다.
     */
    body.push(el('button', {
      type: 'button', class: 'register-open',
      text: '잘 모르겠어요 — 일단 쓰고 나중에 확인',
      onclick: function () { submitGymRegister({ defer: true }); },
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

  /**
   * 숫자 입력.
   *
   * 스크롤로는 정확한 값을 맞추기 어렵다 — 체중 78kg을 슬라이더로 맞추려면
   * 손가락을 몇 번씩 미세하게 움직여야 한다. 직접 치는 쪽이 빠르고, 옆에
   * ± 버튼을 두면 한두 칸 조정도 된다.
   */
  function numberRow(config) {
    var step = config.step || 1;
    var input = el('input', {
      type: 'number',
      inputmode: 'decimal',
      min: String(config.min),
      max: String(config.max),
      step: String(step),
      value: String(config.value),
      id: config.id,
      onchange: function (event) { commit(Number(event.target.value)); },
    });

    function commit(raw) {
      var value = clamp(isNaN(raw) ? config.value : raw, config.min, config.max);
      // 0.5kg 단위까지만 — 소수점이 길게 붙으면 읽기 어렵다
      value = Math.round(value / step) * step;
      value = Math.round(value * 100) / 100;
      input.value = String(value);
      config.onInput(value);
    }

    var nudge = function (delta) {
      return el('button', {
        type: 'button', class: 'nudge', text: delta > 0 ? '+' : '−',
        'aria-label': config.name + (delta > 0 ? ' 늘리기' : ' 줄이기'),
        onclick: function () { commit(Number(input.value) + delta); },
      });
    };

    return el('div', { class: 'number-row' }, [
      el('label', { class: 'name', for: config.id, text: config.name }),
      el('div', { class: 'number-field' }, [
        nudge(-step),
        input,
        config.unit ? el('span', { class: 'unit', text: config.unit }) : null,
        nudge(step),
      ]),
      config.hint ? el('p', { class: 'hint-line', text: config.hint }) : null,
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

  var STEPS = [
    { id: 'consent', title: '동의', render: stepConsent },
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
    // 언제 · 어느 판 문구에 동의했는지 남긴다. 증빙이 없으면 동의가 아니다.
    state.consentRecord = E.recordConsent(state.consent, todayISO());

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
    // 필수 동의 전에는 아무것도 묻지 않는다. 동의가 수집보다 먼저다.
    var blocked = step.id === 'consent' && !E.canUseService(state.consent);

    nav.appendChild(el('button', {
      type: 'button', class: 'primary',
      disabled: blocked ? '' : null,
      text: isLast ? '이 프로그램으로 시작' : '다음',
      onclick: function () {
        if (blocked) return;
        if (isLast) completeOnboarding();
        else { state.onboarding.step += 1; render(); }
      },
    }));
    screen.appendChild(nav);
  }

  /**
   * 동의 화면.
   *
   * 체중·통증·운동 기록은 건강에 관한 정보라 민감정보다. 개인정보보호법은
   * 이걸 다른 동의와 묶지 말라고 한다 — 이용약관에 끼워 넣고 한 번에 받으면
   * 동의로 치지 않는다.
   *
   * 그래서 "전체 동의" 버튼을 두지 않았다. 하나씩 읽고 하나씩 누른다.
   * 그리고 이 화면이 첫 화면이다 — 체중을 묻기 전에 동의를 받는다.
   */
  function stepConsent() {
    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '먼저 확인해 주세요' }),
      el('div', { text:
        '체중과 운동·통증 기록은 건강에 관한 정보라 따로 동의를 받아야 합니다. ' +
        '무엇을 왜 받고 얼마나 갖고 있는지 아래에 그대로 적었습니다. ' +
        '선택 항목은 거부해도 앱을 쓰는 데 지장이 없습니다.' }),
    ]));

    E.CONSENT_ITEMS.forEach(function (item) {
      var on = state.consent.indexOf(item.id) >= 0;

      var head = el('div', { class: 'consent-head' }, [
        el('span', { class: 'consent-title', text: item.label }),
        el('span', {
          class: 'consent-tag ' + (item.required ? 'req' : 'opt'),
          text: item.required ? '필수' : '선택',
        }),
        item.sensitive ? el('span', { class: 'consent-tag sensitive', text: '민감정보' }) : null,
      ]);

      var rows = el('div', { class: 'consent-body' }, [
        consentRow('수집 항목', item.items.join(' · ')),
        consentRow('이용 목적', item.purpose),
        consentRow('보유 기간', item.retention),
        consentRow('거부하면', item.ifDeclined),
      ]);

      screen.appendChild(el('div', { class: 'consent-card' }, [
        head,
        rows,
        el('button', {
          type: 'button',
          class: 'consent-toggle',
          'aria-pressed': String(on),
          text: on ? '동의함' : '동의하기',
          onclick: function () {
            state.consent = on
              ? state.consent.filter(function (id) { return id !== item.id; })
              : state.consent.concat([item.id]);
            render();
          },
        }),
      ]));
    });

    var missing = E.missingRequired(state.consent);
    if (missing.length > 0) {
      screen.appendChild(el('p', { class: 'hint-line warn', text:
        '필수 항목 ' + missing.length + '개가 남았습니다 — ' +
        missing.map(function (item) { return item.label; }).join(', ') }));
    } else {
      var blockedList = E.blockedFeatures(state.consent);
      screen.appendChild(el('p', { class: 'hint-line', text: blockedList.length === 0
        ? '모두 동의했습니다. 모든 기능을 쓸 수 있습니다.'
        : '거부한 선택 항목 때문에 꺼지는 기능: ' +
          blockedList.map(function (gate) { return gate.label; }).join(', ') +
          '. 나머지는 그대로 동작합니다.' }));
    }

    screen.appendChild(el('p', { class: 'asset-note', text:
      '동의는 언제든 철회할 수 있습니다(체크인 탭 → 내 정보). 철회하면 해당 기록을 바로 지웁니다. ' +
      '이 문구는 프로토타입용이며, 실제 출시 전에는 법률 검토가 필요합니다.' }));
  }

  function consentRow(label, value) {
    return el('div', { class: 'consent-row' }, [
      el('span', { class: 'consent-key', text: label }),
      el('span', { text: value }),
    ]);
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
        numberRow({
          name: '꾸준히 훈련한 기간', value: state.answers.monthsTraining,
          min: 0, max: 360, unit: '개월', id: 'months',
          hint: '고른 단계가 실제와 맞는지 대조합니다.',
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
        numberRow({
          name: '체중', value: state.answers.bodyweightKg, min: 30, max: 200,
          step: 0.5, unit: 'kg', id: 'bw',
          hint: '첫 종목의 시작 중량을 여기서 환산합니다.',
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
        el('h3', { text: '주당 운동 일수' }),
        el('span', { class: 'meta', text: '분할이 달라집니다' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        segmented([1, 2, 3, 4, 5, 6, 7].map(function (days) {
          return {
            label: days + '일',
            active: state.answers.daysPerWeek === days,
            onSelect: function () { state.answers.daysPerWeek = days; render(); },
          };
        })),
        el('p', { class: 'hint-line', text: splitPreview() }),
        splitCaution(),
      ]),
    ]));

    /*
     * 목표는 여러 개를 고를 수 있다. "근비대도 하고 근력도 늘리면서 살도
     * 빼고 싶다"가 현장에서 가장 흔한 대답인데, 하나만 고르게 하면 그걸
     * 담지 못한다. 대신 상충되는 부분은 아래에 그대로 적는다.
     */
    var goals = el('div', { class: 'sheet-body' }, []);
    Object.keys(E.GOAL_LABELS_KO).forEach(function (id) {
      var on = state.answers.goals.indexOf(id) >= 0;
      goals.appendChild(el('button', {
        type: 'button', class: 'choice',
        'aria-pressed': String(on),
        onclick: function () {
          state.answers.goals = on
            ? state.answers.goals.filter(function (item) { return item !== id; })
            : state.answers.goals.concat([id]);
          render();
        },
      }, [
        el('span', { class: 'choice-title' }, [
          document.createTextNode(E.GOAL_LABELS_KO[id] + ' '),
          on ? el('span', { class: 'tag-personal', text: '선택' }) : null,
        ]),
        el('span', { class: 'choice-hint', text: E.GOAL_HINTS_KO[id] }),
      ]));
    });

    var plan = E.planGoals(state.answers.goals);
    plan.notes.forEach(function (note) {
      goals.appendChild(el('p', { class: 'hint-line', text: note }));
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '목표' }),
        el('span', { class: 'meta', text: '여러 개 고를 수 있습니다' }),
      ]),
      goals,
    ]));
  }

  function splitPreview() {
    var program = E.buildProgram(state.answers, state.answers.selfReportedLevel);
    return program.name + ' — ' + program.templates.map(function (t) { return t.name; }).join(' · ');
  }

  /** 이 일수로 안 되는 것이 있으면 처음에 말한다. */
  function splitCaution() {
    var program = E.buildProgram(state.answers, state.answers.selfReportedLevel);
    if (!program.caution) return null;
    return el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '알아두세요' }),
      el('div', { text: program.caution }),
    ]);
  }

  /**
   * 기구 목록.
   *
   * 이름 옆에 생김새를 같이 적는다. "펙덱 (플라이 머신)"만 보면 모르지만
   * "앉아서 양팔을 안으로 모으는 기계. 나비처럼 생겼습니다"를 보면 안다.
   */
  function renderEquipmentList() {
    var host = document.getElementById('equipment-list');
    if (!host) return;
    host.textContent = '';

    var selected = state.answers.gym.equipmentIds;
    var matches = E.findEquipment(state.equipmentQuery || '');

    if (matches.length === 0) {
      host.appendChild(el('p', { class: 'hint-line', text:
        '찾는 기구가 없습니다. 다르게 불러 보세요 — "줄 당기는", "다리 미는" 처럼요.' }));
      return;
    }

    var list = el('div', { class: 'summary-list' }, []);
    matches.forEach(function (item) {
      var has = selected.indexOf(item.id) >= 0;
      var guide = E.equipmentGuide(item.id);
      var unlocks = has ? [] : E.wouldEnable(item.id, selected);

      list.appendChild(el('button', {
        type: 'button',
        class: 'equip-row',
        'aria-pressed': String(has),
        onclick: function () {
          state.answers.gym.equipmentIds = has
            ? selected.filter(function (id) { return id !== item.id; })
            : selected.concat([item.id]);
          render();
        },
      }, [
        el('span', { class: 'mark', text: has ? '✓' : '' }),
        equipArt(item.id, item.name),
        el('span', { class: 'equip-main' }, [
          el('span', { class: 'name', text: item.name }),
          guide ? el('span', { class: 'look', text: guide.look }) : null,
          guide ? el('span', { class: 'aka', text: '또는 ' + guide.aka.slice(0, 3).join(' · ') }) : null,
        ]),
        unlocks.length > 0
          ? el('span', { class: 'detail', text: '+' + unlocks.length + '종목' })
          : null,
      ]));
    });
    host.appendChild(list);
  }

  function stepGym() {
    var selected = state.answers.gym.equipmentIds;
    var available = E.availableExercises(selected).length;

    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '가능한 종목' }),
      el('div', { text: available + ' / ' + E.EXERCISES.length + '개 — 있는 기구를 켜면 종목이 열립니다.' }),
    ]));

    /*
     * 기구 이름을 모르는 사람이 훨씬 많다. "펙덱"이 뭔지 모르면 고를 수가
     * 없으니, 유형으로 한 번에 채우는 길과 생김새로 찾는 길을 둘 다 연다.
     */
    var presets = el('div', { class: 'chip-row' }, E.GYM_PRESETS.map(function (preset) {
      return el('button', {
        type: 'button', class: 'pick', text: preset.label,
        onclick: function () {
          state.answers.gym.equipmentIds = E.presetEquipment(preset.id);
          pushLog('기구 설정', '<b>' + preset.label + '</b> 기준으로 기구 ' +
            state.answers.gym.equipmentIds.length + '개를 켰습니다.');
          render();
        },
      });
    }));

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '어떤 곳인가요?' }),
        el('span', { class: 'meta', text: '한 번에 채우기' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        presets,
        el('p', { class: 'hint-line', text:
          '고르면 기구가 대부분 채워집니다. 정확하지 않아도 됩니다 — ' +
          '운동하다 그 종목이 나왔을 때 "없어요"를 누르면 그때 빠집니다.' }),
      ]),
    ]));

    /*
     * "플랫 벤치"와 "인클라인 벤치"가 뭔지 모르는 사람이 훨씬 많다.
     * 여기서 붙잡아 두면 앱을 닫는다. 그냥 넘어가는 길을 눈에 보이게 둔다.
     */
    screen.appendChild(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '몰라도 괜찮습니다' }),
      el('div', { text:
        '기구 이름을 지금 다 알 필요는 없습니다. 흔한 것들로 시작해두고, ' +
        '운동하다 없는 기구가 나오면 그때 빼면 됩니다. 눈앞에 기구가 있을 때가 제일 정확합니다.' }),
      el('button', {
        type: 'button', class: 'pick',
        text: '잘 모르겠어요 — 나중에 할게요',
        onclick: function () {
          state.answers.gym.equipmentIds = E.presetEquipment('unknown');
          state.answers.gym.measurements = {};
          pushLog('기구 설정', '흔한 기구 ' + state.answers.gym.equipmentIds.length +
            '개로 시작합니다. 없는 건 운동하면서 뺍니다.');
          /*
           * 실측까지 건너뛴다. 기구를 모르겠다고 한 사람에게 바로 "빈 바 무게가
           * 몇 kg인가요"를 묻는 건 더 모르는 걸 묻는 것이다. 기본값(20kg·5kg)이
           * 한국 헬스장의 대부분이고, 틀리면 헬스장 탭에서 고치면 된다.
           */
          state.onboarding.step = stepIndex('result');
          render();
        },
      }),
    ]));

    var search = el('input', {
      type: 'search', value: state.equipmentQuery || '',
      placeholder: '생김새로 찾기 (예: 굽은 봉, 나비, 철장)',
      oninput: function (event) { state.equipmentQuery = event.target.value; renderEquipmentList(); },
    });
    var listHost = el('div', { id: 'equipment-list' }, []);

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '내 기구' }),
        el('span', { class: 'meta', text: selected.length + '개 켜짐' }),
      ]),
      el('div', { class: 'sheet-body' }, [search, listHost]),
    ]));
    renderEquipmentList();

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

  function stepIndex(id) {
    for (var i = 0; i < STEPS.length; i += 1) {
      if (STEPS[i].id === id) return i;
    }
    return STEPS.length - 1;
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
      el('div', { text:
        '기구마다 만들 수 있는 중량이 다릅니다. 다만 한국 헬스장은 대부분 ' +
        '빈 바 20kg · 스택 5kg이라, 몰라도 기본값이 거의 맞습니다.' }),
      el('button', {
        type: 'button', class: 'pick',
        text: '모르겠어요 — 기본값으로 시작',
        onclick: function () {
          state.answers.gym.measurements = {};
          pushLog('실측', '기본값(빈 바 20kg · 스택 5kg)으로 시작합니다. 헬스장 탭에서 고칠 수 있습니다.');
          state.onboarding.step = stepIndex('result');
          render();
        },
      }),
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

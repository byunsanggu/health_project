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
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        window.navigator.standalone === true;
    } catch (err) {
      void err;
      return false;
    }
  }

  /*
   * 설치된 앱으로 열렸다고 문서에 표시해 둔다.
   *
   * CSS의 display-mode 질의만으로 대부분 되지만, 홈 화면에서 연 옛날
   * iOS는 그 질의를 모르고 navigator.standalone만 안다. 표시를 붙여
   * 두면 같은 규칙을 선택자로 한 번 더 적어 둘 수 있다.
   *
   * 설치 여부는 창이 살아 있는 동안 바뀌지 않으므로 한 번만 본다.
   */
  function markStandalone() {
    if (isStandalone()) document.documentElement.setAttribute('data-standalone', '');
    /*
     * 소개 글·시나리오·엔진 로그는 만드는 사람이 보는 판이다. 실제 사용자
     * 화면에 "프로토타입 · 실제 엔진 구동"이 뜨면 안 된다. 내 컴퓨터에서
     * 열었거나 주소에 ?dev를 붙였을 때만 보인다.
     */
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]dev\b/.test(location.search)) {
      document.documentElement.setAttribute('data-dev', '');
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
    // 화면 상태와 별개로, 오늘 기록은 저장소의 세션으로도 남겨야 서버에 간다.
    if (state.todayDate && state.lifts) recordTodaySession();
    if (state.todayDate && state.pain) recordTodayCheckIn();
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
        shortDay: state.shortDay,
        promise: state.promise,
        /*
         * "같은 기계예요"라고 답한 종목. 날짜를 같이 적는다 — 하루짜리
         * 답이라 내일까지 들고 가면 영영 안 묻게 된다.
         *
         * 고른 기계(machinePick)는 여기 없다. 그건 세트마다 machine 칸에
         * 이미 붙어 있어서, 복원할 때 세트에서 거꾸로 읽는 쪽이 어긋날
         * 여지가 없다.
         */
        machineSame: { date: state.todayDate, ids: state.machineSame },
        machineKnown: state.machineKnown,
        machinePound: state.machinePound,
        coach: state.coach,
        machineSettings: state.machineSettings,
        diet: state.diet,
        comeback: state.comeback,
        comebackDeclined: state.comebackDeclined,
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
        restBand: state.restBand,
        restOverrides: state.restOverrides,
        extraLifts: state.extraLifts,
        voiceOn: state.voiceOn,
        tempo: state.tempo,
        autoCount: state.autoCount,
        nudgeOn: state.nudgeOn,
        friendName: state.friendName,
        friendCode: state.friendCode,
        voiceRate: state.voiceRate,
        reportSeenWeek: state.reportSeenWeek,
        lastSyncedAt: state.lastSyncedAt,
        settingsUpdatedAt: state.settingsUpdatedAt,
        cardioToday: state.cardioToday,
        cardioLog: state.cardioLog,
        wodResults: state.wodResults,
        sessionStartedAt: state.sessionStartedAt,
        gymBook: state.gymBook,
        consent: state.consent,
        consentRecord: state.consentRecord,
      },
    });
    // 판단이 달라질 만한 것이 바뀌었으면 알림 예약도 다시 올린다.
    scheduleNudgeSoon();
    // 친구에게 보이는 주간 요약도. 안에서 안 바뀌었으면 그냥 넘어간다.
    pushMyWeek();
    // 기록과 설정을 서버로. 올릴 것이 없으면 안에서 그냥 돌아간다.
    syncSoon();
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
      state.shortDay = settings.shortDay || null;
      state.promise = settings.promise || null;
      state.comeback = settings.comeback || null;
      state.comebackDeclined = settings.comebackDeclined || null;
      state.started = Boolean(settings.started);
      state.sessionClosed = Boolean(settings.sessionClosed);
      state.liftCursor = settings.liftCursor || 0;
      state.dayOverride = settings.dayOverride == null ? null : settings.dayOverride;
      state.liftOrder = settings.liftOrder || null;
      state.supersets = settings.supersets || [];
      state.restBand = settings.restBand || null;
      state.restOverrides = settings.restOverrides || {};
      state.extraLifts = settings.extraLifts || [];
      state.voiceOn = Boolean(settings.voiceOn);
      state.tempo = settings.tempo || null;
      state.autoCount = Boolean(settings.autoCount);
      state.nudgeOn = Boolean(settings.nudgeOn);
      state.friendName = settings.friendName || null;
      state.friendCode = settings.friendCode || null;
      state.voiceRate = settings.voiceRate || 1;
      state.reportSeenWeek = settings.reportSeenWeek || null;
      state.lastSyncedAt = settings.lastSyncedAt || null;
      state.settingsUpdatedAt = settings.settingsUpdatedAt || null;
      state.cardioToday = settings.cardioToday || [];
      state.cardioLog = settings.cardioLog || [];
      state.wodResults = settings.wodResults || [];
      state.sessionStartedAt = settings.sessionStartedAt || null;
      state.consent = settings.consent || [];
      state.consentRecord = settings.consentRecord || null;
      state.blockHistory = settings.blockHistory || ['hypertrophy'];
      state.gymBook = settings.gymBook || E.createGymBook({
        id: 'my-gym', name: '내 헬스장', equipmentIds: saved.answers.gym.equipmentIds.slice(),
      });

      loadScenario(state.scenario, true);

      /*
       * 실제로 적은 체크인을 되살린다.
       *
       * loadScenario는 시나리오 체크인으로 state.checkIns를 통째로 갈아
       * 끼운다. 그대로 두면 **사용자가 적은 것이 앱을 껐다 켤 때마다
       * 사라진다** — 오늘 잰 체중도, 어제 적은 통증도. 저장소에 있는
       * 것이 진짜이므로 같은 날짜는 저장소 쪽이 이긴다.
       */
      var kept = {};
      (saved.checkIns || []).forEach(function (item) {
        if (item && item.date) kept[item.date] = item;
      });
      state.checkIns = state.checkIns
        .filter(function (item) { return !kept[item.date]; })
        .concat(Object.keys(kept).map(function (date) { return kept[date]; }))
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

      // 오늘 기록한 세트를 되살리고, 해당 세트를 완료 상태로 표시한다.
      state.machineKnown = settings.machineKnown || {};
      state.machinePound = settings.machinePound || {};
      state.coach = settings.coach && settings.coach.mode
        ? { mode: settings.coach.mode === 'pt' ? 'pt' : 'solo', style: settings.coach.style || 'calm' }
        : { mode: 'solo', style: 'calm' };
      state.machineSettings = settings.machineSettings || {};
      state.diet = E.normalizeDiet(settings.diet);
      var sameAnswer = settings.machineSame;
      state.machineSame = sameAnswer && sameAnswer.date === state.todayDate
        ? (sameAnswer.ids || {}) : {};

      var todaySets = Array.isArray(settings.todaySets) ? settings.todaySets : [];
      if (todaySets.length > 0) {
        state.todaySets = todaySets;

        // 오늘 어느 기계로 했는지는 세트에 적혀 있다. 거기서 거꾸로 읽는다.
        state.machinePick = {};
        todaySets.forEach(function (logged) {
          if (logged.machine) state.machinePick[logged.exerciseId] = logged.machine;
        });

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
    // id는 그대로 둔다 — 저장된 설정에 'checkin'이 남아 있어도 같은 탭이 열려야 한다.
    { id: 'checkin', label: '식단', icon: 'M4 11h16a8 8 0 0 1-16 0zM9 7c0-1.5 1.5-1.5 1.5-3M13.5 7c0-1.5 1.5-1.5 1.5-3' },
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
    /* 오늘 하루만 짧게 — { date, minutes }. 내일이면 저절로 풀린다. */
    shortDay: null,
    /* 복귀 — { startedOn, plan }. 다 끝나면 저절로 풀린다. */
    promise: null,
    comeback: null,
    comebackDeclined: null,
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
    /*
     * 휴식 띠. 숫자 하나가 아니라 띠인 이유는 rest.ts에 적어 두었다 —
     * 어느 종목을 띠의 어디에 둘지는 계산이 맡고, 전체를 길게 갈지
     * 짧게 갈지는 사람이 정한다.
     */
    restBand: null,
    /* 종목별로 직접 정한 휴식(초). { 종목id: 초 } */
    restOverrides: {},
    /*
     * 오늘 따로 끼워 넣은 종목. [{ exerciseId, sets }]
     *
     * 프로그램이 짜 준 것 말고 더 하고 싶은 날이 있다. 세션은 다시
     * 짜일 때마다 템플릿에서 새로 만들어지므로, 끼운 것은 따로 들고
     * 있다가 매번 다시 붙여야 한다 — 순서·묶음과 같은 이유다.
     */
    extraLifts: [],
    /*
     * 음성 카운트. 혼자 하면 힘들어질수록 저절로 빨라지고, 빨라지면
     * 반동이 붙어서 같은 10회가 다른 10회가 된다. 옆에서 세어 주는
     * 사람이 하는 일의 절반이 이것이다.
     */
    voiceOn: false,
    tempo: null,
    autoCount: false,
    nudgeOn: false,
    friendName: null,
    friendCode: null,
    friends: [],
    cheersIn: [],
    autoCountedFor: null,
    voiceRate: 1,
    /* 이번 주 리포트를 본 주(월요일). 같은 주에 두 번 조르지 않는다. */
    reportSeenWeek: null,
    /* 오늘 한 유산소. [{exerciseId, minutes, zone, distanceKm, before}] */
    cardioToday: [],
    /* 이번 주 유산소 (날짜별) — 주간 부담을 세는 데 쓴다 */
    cardioLog: [],
    cardioDraft: null,
    /* 같이 가야 하는 설정이 마지막으로 바뀐 때 */
    settingsUpdatedAt: null,
    lastSettingsBody: null,
    /* 마지막으로 서버와 맞춘 때 */
    lastSyncedAt: null,
    syncing: false,
    /* 로그인 화면을 띄우고 있는가. 탭바를 가리고 화면 하나만 쓴다. */
    authOpen: false,
    /* 로그인 화면의 입력값 — 화면을 다시 그려도 날아가면 안 된다 */
    authForm: { email: '', password: '', mode: 'signin', notice: null, busy: false },
    /* 지금 세는 중인 세트. { liftIndex, setIndex, startedAt, rep, timers } */
    counting: null,
    // 와드 설정. 길이와 바벨 여부가 성격을 크게 바꾼다.
    wodMinutes: 12,
    wodBarbell: false,
    conditioningFormat: null,
    /* 와드 기록. 같은 구성끼리만 비교한다 — 다른 와드를 비교하면 거짓말이다. */
    wodResults: [],
    wodDraft: null,
    gymQuery: '',
    /*
     * 실제 헬스장 검색 결과. null은 "아직 안 찾아봤다"이고 빈 배열은
     * "찾아봤는데 없다"다. 둘을 한 값으로 뭉뚱그리면 화면이 처음부터
     * "없습니다"라고 말하게 된다.
     */
    placeResults: null,
    placeBusy: false,
    /* 서버 주소를 직접 넣는 칸을 펼쳤는가. 박아 넣은 값이 있을 때만 쓴다. */
    showServerFields: false,
    /* 이 헬스장에 대해 남들이 올린 것. gymId가 바뀔 때만 다시 받는다. */
    crowd: null,
    /* 진짜 GPS 좌표. 모르면 null이고, 그때는 아무 데도 좌표를 안 보낸다. */
    here: null,
    hereAsked: false,
    /*
     * 뺀 종목. "싫어요" 하나가 아니라 이유가 같이 남는다 — 이유에 따라
     * 하는 일이 완전히 다르고, 아파서 뺀 것은 남에게 보내지 않는다.
     */
    exclusions: [],
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
    /*
     * 오늘 어느 기계로 하는가. { 종목id: 기계열쇠 }
     *
     * 하루짜리다. 같은 사람이 어제는 안쪽 기계, 오늘은 창가 기계를 쓸 수
     * 있으므로 어제 고른 것을 오늘로 끌고 오면 안 된다.
     */
    machinePick: {},
    /*
     * 나눠 둔 기계 목록. { "헬스장id|종목id": ['a','b'] }
     *
     * 하루짜리가 아니다 — 그 헬스장에 기계가 두 대 있다는 사실은
     * 내일도 그대로다.
     */
    machineKnown: {},
    /*
     * 파운드 표기 기계. { "헬스장id|종목id|기계": true }
     *
     * 수입 기계는 스택에 파운드가 찍혀 있다. 거기 보이는 90을 그대로
     * 적으면 90kg이 들어가는데 실제는 40.8kg이다 — 2.2배다.
     */
    machinePound: {},
    /*
     * PT 모드. 기본은 혼자다 — 켜지 않았는데 휴대폰이 말을 시작하면
     * 헬스장에서 다들 쳐다본다. 오늘 화면에서 고른다.
     */
    coach: { mode: 'solo', style: 'calm' },
    /** 끼니 예시를 사람에 맞추는 것 — 못 먹는 것, 예산, 평일 점심 */
    diet: { avoid: [], budget: 'normal', lunch: 'cook' },
    /** 기계 세팅 ("시트 4 · 등받이 2"). 헬스장|종목|기계 → 글 */
    machineSettings: {},
    /** 지금 코치가 한 말. 소리가 안 나는 기기에서도 읽을 수 있게 화면에 띄운다 */
    coachLine: null,
    /** 이미 말한 자리. 다시 그릴 때마다 같은 말을 반복하지 않게 */
    coachSaid: {},
    /*
     * "같은 기계예요"라고 답한 종목. 이 날은 다시 묻지 않는다.
     * 하루 안에 같은 질문을 두 번 받으면 읽지 않고 아무거나 누르게 된다.
     */
    machineSame: {},
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
    // 통증은 "그 관절을 쓴 다음 날" 올라온다. 바로 앞 세션을 들고 다닌다.
    var previous = null;
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
        var performed = perform(planned, scenario.decay * weekInBlock, homeGymId());
        history.push(performed);

        /*
         * 통증을 매일 같은 점수로 깔면 이력이 선이 아니라 직선이 된다 —
         * 언제부터인지도, 나아지는지도, 어떤 동작 뒤였는지도 안 보인다.
         *
         * 실제 통증은 그 관절을 쓴 다음 날 올라오고, 놔두면 조금씩
         * 심해진다. 그렇게 심는다.
         */
        var todayPain = pain.filter(function (report) {
          /*
           * 그 관절을 "조금 쓰는" 날이 아니라 "제일 크게 쓰는" 날 다음에
           * 올라온다. 실제 통증이 그렇고, 0.3으로 깔면 스쿼트까지
           * 어깨 통증 유발 후보가 되어 목록을 못 믿게 된다.
           */
          var loaded = previous && previous.sets.some(function (set) {
            var exercise = index.get(set.exerciseId);
            return exercise && (exercise.jointStress[report.joint] || 0) >= 0.8;
          });
          return loaded;
        }).map(function (report) {
          // 주가 갈수록 한 점씩 올라간다. 놔두면 심해지는 것이 보통이다.
          return { joint: report.joint, score: Math.min(8, report.score + Math.floor(week / 3)) };
        });

        checkIns.push({
          id: 'seed-checkin-' + date,
          date: date,
          sleepHours: scenario.sleep,
          soreness: scenario.soreness,
          motivation: scenario.heavy ? 3 : 7,
          pain: todayPain,
        });
        previous = performed;
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
    // 오늘 고른 기계도 하루짜리다. 세트가 비면 같이 비운다.
    state.machinePick = {};
    state.machineSame = {};
    // 코치가 한 말도 하루짜리다. 날이 바뀌었는데 "이미 말했다"로 남으면 아무 말도 안 한다.
    state.coachSaid = {};
    state.coachLine = null;
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

  /**
   * 이 헬스장에서 할 수 있는 종목.
   *
   * 기구 id 목록을 대체 찾기에 그대로 넘기면 안 된다 — 헬스장 기구는
   * 'leg-press-machine' 같은 id이고 종목의 equipment는 'machine' 같은
   * 갈래라 서로 안 맞는다. 그러면 "대체가 없습니다"가 늘 뜬다.
   */
  function gymPool(entry) {
    return entry ? E.availableExercises(entry.equipmentIds) : undefined;
  }

  /** 지금 빠져 있는 종목 id. */
  function excludedSet() {
    return E.excludedIds(state.exclusions, state.todayDate);
  }

  /** 지금 가벼운 무게로 배우는 중인 종목 id. */
  function coachingSet() {
    var out = {};
    E.coaching(state.exclusions, state.todayDate).forEach(function (item) {
      out[item.exerciseId] = true;
    });
    return out;
  }

  /**
   * 뺀 종목 자리에 대체를 끼운다.
   *
   * 대체를 고를 때 오늘 이미 하는 종목과 이미 뺀 종목은 후보에서 뺀다.
   * 같은 종목이 두 번 나오거나, 빼 달라고 한 종목이 대체로 다시 들어오면
   * 사용자는 앱이 말을 안 듣는다고 느낀다.
   */
  function withExclusions(template) {
    var excluded = excludedSet();
    if (excluded.size === 0) return template;

    var entry = currentGymEntry();
    var taken = {};
    template.slots.forEach(function (slot) { taken[slot.exerciseId] = true; });

    var slots = [];
    template.slots.forEach(function (slot) {
      if (!excluded.has(slot.exerciseId)) { slots.push(slot); return; }

      var exercise = index.get(slot.exerciseId);
      if (!exercise) return;

      var banned = new Set(excluded);
      Object.keys(taken).forEach(function (id) { banned.add(id); });

      var replacement = E.replacementFor(exercise, {
        excluded: banned,
        pool: gymPool(entry),
        limit: 1,
      });
      var pick = replacement.substitutes[0];
      if (!pick) return;   // 대체가 없으면 그 자리는 빈다

      taken[pick.id] = true;
      slots.push({
        exerciseId: pick.id,
        sets: slot.sets,
        repRange: slot.repRange,
        replacedFrom: slot.exerciseId,
      });
    });

    return { name: template.name, slots: slots };
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

    /*
     * 끼워 넣은 종목을 템플릿 뒤에 붙인다.
     *
     * 앞이 아니라 뒤다. 프로그램이 짜 준 것이 먼저고, 더 하고 싶은
     * 것은 그다음이다 — 순서는 직접 바꿀 수 있다.
     */
    var baseTemplate = state.program.templates[currentTemplateIndex()];
    var template = state.extraLifts.length === 0 ? baseTemplate : {
      name: baseTemplate.name,
      slots: baseTemplate.slots.concat(
        state.extraLifts
          .filter(function (extra) {
            var exercise = index.get(extra.exerciseId);
            // 이미 오늘 하는 종목이면 또 넣지 않는다.
            return exercise && !baseTemplate.slots.some(function (slot) {
              return slot.exerciseId === extra.exerciseId;
            });
          })
          .map(function (extra) {
            var exercise = index.get(extra.exerciseId);
            /*
             * 반복 범위는 동작의 성격을 따른다. 복합 동작에 15회를,
             * 고립 운동에 5회를 주면 그건 처방이 아니라 아무 숫자다.
             */
            var isolation = exercise.pattern === 'isolation' || exercise.pattern === 'core';
            return {
              exerciseId: extra.exerciseId,
              sets: extra.sets || 3,
              repRange: isolation ? { min: 10, max: 15 } : { min: 6, max: 10 },
            };
          }),
      ),
    };

    /*
     * 뺀 종목을 대체로 바꾼다.
     *
     * 슬롯을 지우지 않고 **갈아 끼운다.** 세트 수와 반복 범위를 그대로
     * 물려주면 그 부위 주간 볼륨이 유지된다 — 그냥 지우면 사용자는 왜
     * 등이 안 크는지 모르게 된다. 대체가 없을 때만 슬롯이 빠진다.
     */
    template = withExclusions(template);

    var built = E.buildSession({
      template: template,
      date: state.todayDate,
      plan: state.plan,
      history: state.history,
      index: index,
      pain: activePain(),
      gym: state.gym,
      // 머신·케이블 중량은 이 헬스장 기록만 본다 — 기계마다 표기가 다르다.
      gymId: state.gymBook ? state.gymBook.activeId : undefined,
      // 같은 헬스장에 같은 기계가 둘 있으면 오늘 선 쪽의 기록만 본다.
      machines: state.machinePick,
      lifter: state.lifter,
    });

    /*
     * 쉬었다 돌아온 사람은 무게부터 내린다.
     *
     * 시간 예산보다 **먼저** 먹인다. 복귀가 이미 세트를 줄였으면 세션이
     * 짧아져서 시간 예산이 더 깎을 일이 없어진다. 순서가 반대면 같은
     * 종목을 두 번 깎는다.
     */
    var comeback = activeComeback();
    if (comeback) {
      var factor = E.loadFactorAt(comeback.plan, comeback.week);
      var setDrop = E.setDropAt(comeback.plan, comeback.week);
      built = Object.assign({}, built, {
        exercises: built.exercises.map(function (item) {
          var keep = E.setsAfterDrop(item.sets.length, setDrop);
          return Object.assign({}, item, {
            sets: item.sets.slice(0, keep).map(function (set) {
              if (set.weightKg == null || factor >= 1) return set;
              /*
               * 끼울 수 있는 무게로 내린다. 87.3kg이라고 적어 두면 그걸
               * 맞추려다 사람이 시간을 버린다. 아래쪽으로 맞춘다 —
               * 복귀 주에 반올림으로 올라가면 안 된다.
               */
              var scaled = item.loading
                ? E.nearestLoadable(set.weightKg * factor, item.loading, 'down')
                : E.roundToIncrement(set.weightKg * factor, item.exercise.increment);
              return Object.assign({}, set, { weightKg: scaled });
            }),
          });
        }),
      });
    }

    // 오늘 운동 할 수 있는 시간이 정해져 있으면 그 안에 들어오게 줄인다.
    state.timeFit = null;
    var budget = shortBudget() || state.timeBudget;
    if (budget) {
      var profile = E.styleProfile(state.style);
      state.timeFit = E.fitToTimeBudget(built, budget, {
        restMultiplier: profile.restMultiplier,
        // 휴식을 2분으로 늘렸는데 "50분이면 6종목"이라고 하면 거짓말이 된다
        restBand: state.restBand || undefined,
        restOverrides: state.restOverrides,
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
    /*
     * 가벼운 무게로 배우는 중인 종목은 여기서 무게를 낮춘다.
     *
     * "자신 없어요"라고 한 사람에게 필요한 건 안 하는 것이 아니라 가벼운
     * 무게로 여러 번 해 보는 것이다. 화면이 "가벼운 무게로 배우는 중"이라고
     * 말하는 이상, 실제로 가벼워야 한다.
     */
    var learning = coachingSet();

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
          var planned = set.weightKg === null ? (START_WEIGHT[item.exercise.id] || 40) : set.weightKg;
          if (learning[item.exercise.id]) {
            planned = item.loading
              ? E.nearestLoadable(planned * E.COACH_LOAD_RATIO, item.loading, 'down')
              : Math.round(planned * E.COACH_LOAD_RATIO);
          }
          return {
            weightKg: planned,
            /*
             * 처방된 중량. weightKg는 사용자가 치면 바뀌지만 이건 안 바뀐다 —
             * "계획은 105였는데 100으로 했다"를 화면이 말할 수 있어야 한다.
             */
            plannedKg: planned,
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
    /*
     * 오늘 것은 아직 history에 없다. 여기서 붙일 때 유산소도 같이 붙여야
     * 한다 — 안 그러면 주간 요약에서 오늘 한 유산소만 조용히 빠진다.
     */
    if (state.todaySets.length > 0 || state.cardioToday.length > 0) {
      sessions = sessions.concat([{
        date: state.todayDate,
        sets: state.todaySets,
        gymId: activeGymId(),
        cardio: state.cardioToday,
      }]);
    }
    return sessions;
  }

  function pushLog(kind, body) {
    state.log.unshift({ kind: kind, body: body });
    if (state.log.length > 8) state.log.pop();
  }

  /* ── 세트 완료 ─────────────────────────────────── */

  function completeSet(liftIndex, setIndex, rir) {
    // 세는 중에 RIR을 누를 수 있다. 소리가 혼자 남으면 다음 세트와 겹친다.
    // 이미 답을 눌렀다. 여기서 "무게 어땠어요?"를 또 물으면 답한 사람에게 다시 묻는 꼴이다.
    if (state.counting) stopCounting(true, true);
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
    /*
     * 어느 기계로 했는가. 고른 적이 없으면 칸을 비워 둔다 — 비면 첫 번째
     * 기계로 읽히므로, 기계를 나눈 적 없는 사람의 기록에는 이 칸이
     * 아예 생기지 않는다.
     */
    var pickedMachine = state.machinePick[lift.exercise.id];
    if (pickedMachine) logged.machine = pickedMachine;
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
      /*
       * 이건 코치가 다시 내린 처방이므로 계획도 같이 움직인다. 사용자가
       * 직접 친 무게만 계획과 갈라진다 — 그래야 "계획 105"가 뜻을 갖는다.
       */
      next.plannedKg = next.weightKg;
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
    /*
     * 다른 기계인지 묻는 일은 세트를 **마친 뒤**에 한다.
     *
     * 기록을 막아 세우고 물으면 세트 사이에 설문을 받는 꼴이 된다.
     * 기록은 이미 들어갔고, 답에 따라 나중에 옮긴다.
     */
    maybeAskMachine(lift, set, logged);

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
      E.restFor(restInput(lift, lift.sets[0] ? lift.sets[0].reps : 10, false)).seconds,
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
      plannedKg: last ? last.weightKg : 0,
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

  /** 지금 설정(띠 · 종목별 직접 지정)을 실은 휴식 계산 입력. */
  function restInput(lift, reps, isLastSet) {
    return {
      exercise: lift.exercise,
      reps: reps,
      targetRir: lift.targetRir,
      isLastSet: Boolean(isLastSet),
      band: state.restBand || undefined,
      overrideSeconds: state.restOverrides[lift.exercise.id],
    };
  }

  function startRest(lift, setIndex, override) {
    var isLast = setIndex === lift.sets.length - 1;
    var prescription = E.restFor(restInput(lift, lift.sets[setIndex].reps, isLast));

    /*
     * 슈퍼세트로 묶였으면 짝으로 넘어가는 동안만 쉰다. 한 바퀴를 마친
     * 뒤에는 원래 휴식을 그대로 쓴다 — 거기서 깎으면 뒤 세트가 무너진다.
     */
    var seconds = override ? override.seconds : prescription.seconds;
    var reason = override ? override.reason : prescription.reason;

    state.rest = {
      exerciseId: lift.exercise.id,
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

    state.rest.adjusted = true;
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
    coachDuringRest(remaining);

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
    // PT 모드는 운동 내내 화면을 켜 둔다. 쉬는 시간만 켜 두면 세트 중에 말이 끊긴다.
    if (!(ptOn() && state.started)) releaseWakeLock();
    notifyWorker({ type: 'rest:stop' });
    renderRest();
    /*
     * 평소에는 휴식 막대만 다시 그린다 — 쉬는 동안 손대던 숫자칸이
     * 끊기지 않게 하려는 것이다.
     *
     * 세트마다 자동으로 셀 때는 그러면 안 된다. 쉬는 동안 미뤄 둔 시작이
     * 이 순간에 열리는데, 세트 화면을 안 그리면 그 순간이 영영 안 온다.
     */
    if (state.autoCount || ptOn()) render();
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
    if (ptOn() && state.started) acquireWakeLock();
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
      /*
       * 시간을 누르면 휴식 설정이 열린다.
       *
       * 설정은 원래 종목 메뉴 안에만 있었다. 쉬는 중에 "좀 길다" 싶은
       * 사람이 그걸 찾아 들어갈 리가 없다 — 지금 눈에 보이는 건 이 숫자뿐이다.
       */
      el('button', {
        type: 'button', class: 'rest-info',
        title: '휴식 길이를 바꿉니다',
        onclick: function () { openRestSettings(state.rest && state.rest.exerciseId); },
      }, [
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

    /*
     * ±30초는 이번 한 번만이다. 매 세트 같은 만큼 늘리는 사람은 그걸
     * 세트마다 다시 누르게 된다 — 그건 앱이 아직 못 알아들은 것이다.
     * 한 번 고친 뒤에만 묻는다. 묻지도 않고 고정해 버리면, 오늘만 길게
     * 쉬려던 사람의 설정이 조용히 바뀐다.
     */
    var fixable = state.rest.exerciseId && state.rest.adjusted;
    if (fixable && state.restOverrides[state.rest.exerciseId] !== state.rest.total) {
      host.appendChild(el('div', { class: 'rest-fix' }, [
        el('span', { text: '이 종목은 앞으로 ' + E.formatDuration(state.rest.total) + '로 할까요?' }),
        el('button', {
          type: 'button', class: 'rest-skip', text: '고정',
          title: state.rest.exerciseName + ' 휴식을 ' + E.formatDuration(state.rest.total) + '로 고정합니다',
          onclick: function () {
            state.restOverrides[state.rest.exerciseId] = state.rest.total;
            pushLog('휴식', '<b>' + state.rest.exerciseName + '</b> 휴식을 ' +
              E.formatDuration(state.rest.total) + '로 고정했습니다');
            persist();
            // 기록 줄도 같이 갱신돼야 한다 — 막대만 다시 그리면 로그가 안 바뀐다.
            render();
          },
        }),
      ]));
    }

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

  /* ── 같은 헬스장, 다른 기계 ──────────────────────

     체스트프레스가 두 대 있는 헬스장은 흔하다. 지금까지는 헬스장으로만
     이력을 나눴기 때문에 두 기계 기록이 한 줄로 섞였고, 80kg과 140kg이
     번갈아 들어오면 중량 처방이 망가졌다.

     **등록 화면을 만들지 않는다.** "이 헬스장 기계 목록을 적으세요"를
     만나면 사람들은 거기서 앱을 닫는다. 실제로 어긋났을 때 한 번만
     묻고, 문제가 없는 사람은 이 기능의 존재도 모른다.
  ── */

  /** 오늘 이 종목에서 쓰는 기계 열쇠. 고른 적 없으면 첫 번째. */
  function machineFor(exerciseId) {
    return state.machinePick[exerciseId] || E.FIRST_MACHINE;
  }

  /** 나눠 둔 기계를 기억하는 열쇠. 헬스장이 다르면 다른 기계다. */
  function machineKey(exerciseId) {
    return (activeGymId() || '-') + '|' + exerciseId;
  }

  /*
   * 파운드 표기는 **기계마다** 다르다. 같은 헬스장에 kg 기계와 lb 기계가
   * 섞여 있는 것이 수입 기계를 들인 헬스장의 보통 모습이다. 그래서
   * 나눠 둔 기계까지 열쇠에 넣는다.
   */
  function poundKey(exerciseId) {
    return machineKey(exerciseId) + '|' + machineFor(exerciseId);
  }

  function inPounds(exerciseId) {
    return Boolean(state.machinePound[poundKey(exerciseId)]);
  }

  function togglePounds(exerciseId) {
    var key = poundKey(exerciseId);
    if (state.machinePound[key]) delete state.machinePound[key];
    else state.machinePound[key] = true;

    /*
     * 단위를 바꾸면 적히는 kg이 2.2배 달라진다. 그대로 두면 바로 다음
     * 세트에서 "다른 기계인가요?"가 뜬다 — 같은 기계인데 단위만 바꾼
     * 것이라 틀린 질문이고, 거기서 "다른 기계예요"를 누르면 있지도 않은
     * 기계가 생긴다.
     *
     * 어긋난 이유를 이미 아는 경우이므로, 오늘은 묻지 않는다고 적어
     * 둔다. 며칠 지나 이력이 같은 단위로 쌓이면 처방이 다시 맞아떨어져서
     * 이 질문도 제 뜻을 되찾는다.
     */
    state.machineSame[exerciseId] = true;

    persist();
    render();
  }

  /**
   * 이 헬스장에서 이 종목에 써 온 기계들. 오늘 것까지 센다.
   *
   * 한 번 나눈 기계는 세트가 하나도 없어도 남는다 — 나눈 것은 오늘
   * 세트가 아니라 그 헬스장에 대한 사실이다.
   */
  function machinesSeen(exerciseId) {
    /*
     * 이름은 **지난 기록만** 보고 짓는다. 오늘 적은 세트까지 넣으면
     * 이름이 작업 중에 움직인다 — 46kg을 적은 순간 "102.5kg 쓰던 것"이
     * "46kg 쓰던 것"으로 바뀌고, 그러면 기계를 알아보는 단서가 아니라
     * 방금 내가 한 일의 메아리가 된다.
     *
     * 오늘 막 나눈 기계는 지난 기록이 없으므로 아래에서 붙는다.
     */
    var seen = E.machinesFor(state.history, exerciseId, activeGymId());
    return E.mergeKnownMachines(seen, state.machineKnown[machineKey(exerciseId)] || []);
  }

  function maybeAskMachine(lift, set, logged) {
    var id = lift.exercise.id;
    if (!E.shouldAskSplit({
      exercise: lift.exercise,
      gymId: activeGymId(),
      plannedKg: set.plannedKg,
      loggedKg: logged.weightKg,
      warmup: false,
      estimated: set.estimated,
      dismissed: !!state.machineSame[id],
      picked: !!state.machinePick[id],
    })) return;

    var body = [];
    body.push(el('p', { class: 'asset-note', text:
      E.splitQuestion(lift.exercise.name, set.plannedKg, logged.weightKg) }));
    body.push(el('p', { class: 'hint-line', text:
      '같은 종목이라도 기계가 다르면 표기 중량이 다릅니다. 나눠 두면 기계별로 ' +
      '무게를 이어서 올릴 수 있습니다.' }));

    body.push(el('div', { class: 'sheet-body' }, [
      el('button', {
        type: 'button', class: 'finish', text: '다른 기계예요 — 따로 세기',
        onclick: function () { splitMachine(lift, logged); },
      }),
      el('button', {
        type: 'button', class: 'finish quiet', text: '같은 기계예요',
        onclick: function () {
          /*
           * 오늘은 다시 안 묻는다. 하루에 같은 질문을 두 번 받으면
           * 읽지 않고 아무거나 누르게 되고, 그때부터 이 기능은 기록을
           * 망치는 쪽으로 돈다.
           */
          state.machineSame[id] = true;
          persist();
          modal.close();
        },
      }),
    ]));

    openModal('다른 기계인가요', lift.exercise.name, body);
  }

  /**
   * 기계를 나눈다.
   *
   * 오늘 이 종목으로 적은 세트를 전부 새 기계로 옮긴다. 방금 한 세트만
   * 옮기면 앞 세트들이 엉뚱한 기계에 남는다 — 한 세션 안에서 기계를
   * 바꿔 가며 하지는 않는다.
   */
  function splitMachine(lift, logged) {
    var id = lift.exercise.id;
    var used = machinesSeen(id).map(function (m) { return m.id; });
    var fresh = E.nextMachineId(used);

    state.machinePick[id] = fresh;
    // 나눴다는 사실을 적어 둔다. 오늘 세트를 되돌려도 기계는 남는다.
    var key = machineKey(id);
    var known = state.machineKnown[key] || [E.FIRST_MACHINE];
    if (known.indexOf(fresh) < 0) known = known.concat([fresh]);
    state.machineKnown[key] = known;

    state.todaySets.forEach(function (item) {
      if (item.exerciseId === id) item.machine = fresh;
    });
    // logged는 state.todaySets 안의 같은 객체라 위에서 이미 바뀌었다.
    void logged;

    recordTodaySession();
    rebuildSession();
    persist();
    modal.close();
    render();
    pushLog('기계 나누기', '<b>' + lift.exercise.name + '</b>' +
      ' 기계를 따로 세기 시작했습니다. 이 기계 기록으로만 다음 무게를 정합니다.');
  }

  /**
   * 기계 고르는 줄.
   *
   * 기계가 둘 이상일 때만 나온다. 한 대뿐인 사람에게는 아무것도 안 보인다.
   */
  function machineRow(lift, liftIndex) {
    var seen = machinesSeen(lift.exercise.id);
    if (seen.length < 2) return null;
    var current = machineFor(lift.exercise.id);

    return el('div', { class: 'machine-row' }, [
      el('span', { class: 'machine-label', text: '어느 기계' }),
    ].concat(seen.map(function (item) {
      return el('button', {
        type: 'button', class: 'chip',
        'aria-pressed': String(item.id === current),
        text: E.machineLabel(item),
        onclick: function () { pickMachine(liftIndex, item.id); },
      });
    })));
  }

  function pickMachine(liftIndex, machineId) {
    var lift = state.lifts[liftIndex];
    var id = lift.exercise.id;
    if (machineFor(id) === machineId) return;

    state.machinePick[id] = machineId;
    // 오늘 이미 적은 세트도 같이 옮긴다. 기계를 잘못 골랐다가 고치는 길이다.
    state.todaySets.forEach(function (item) {
      if (item.exerciseId === id) item.machine = machineId;
    });
    recordTodaySession();
    rebuildSession();
    persist();
    render();
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
    /*
     * 파운드 기계면 사용자가 친 것은 파운드다. **기록은 늘 kg으로
     * 남긴다** — 안 그러면 주간 볼륨도 추정 1RM도 다른 종목과의 비교도
     * 전부 2.2배로 틀어진다.
     */
    var lift = state.lifts[liftIndex];
    if (lift && inPounds(lift.exercise.id)) {
      return setWeight(liftIndex, setIndex, E.lbToKg(Math.min(2200, value)));
    }
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
    /*
     * 파운드 기계는 파운드로 센다. kg 격자로 움직인 뒤 파운드로 보여주면
     * 45 → 54.9처럼 기계에 없는 숫자가 뜬다.
     */
    if (inPounds(lift.exercise.id)) {
      return setWeight(liftIndex, setIndex, E.stepLbFromKg(set.weightKg, direction));
    }
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
    /*
     * 모달 안에서 바꾼 것이 화면에 반영돼야 한다. 리포트를 보고 닫았는데
     * "리포트가 나왔습니다" 줄이 그대로 있으면 앱이 안 듣는 것처럼 보인다.
     */
    if (state.lifts) render();
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
    if (state.authOpen) return 'auth:' + state.authForm.mode;
    return state.tab + ':' + (state.started ? 'lift:' + state.liftCursor : 'plan');
  }
  var lastViewKey = null;

  /*
   * 지금 할 세트가 바뀌었는가.
   *
   * 세트를 기록하면 카드 위쪽이 자란다(완료 줄이 생기고, 남은 세트 줄이
   * 하나 줄어든다). 스크롤은 그대로라서 화면이 조금씩 밀리고, 몇 세트를
   * 하고 나면 정작 지금 칠 중량이 머리띠 위로 올라가 버린다.
   *
   * 화면 전체를 위로 올리는 건 답이 아니다 — 그러면 RIR을 누를 때마다
   * 위로 튄다. 지금 할 세트만 머리띠 바로 아래로 가져온다.
   */
  function setKey() {
    if (!state.started) return null;
    var lift = state.lifts[state.liftCursor];
    if (!lift) return null;
    return state.liftCursor + ':' + lift.sets.filter(function (set) { return set.done; }).length;
  }
  var lastSetKey = null;

  /*
   * 눌러야 할 것이 화면 밖에 있으면 안 된다.
   *
   * 종목에 막 들어왔을 때는 맨 위(종목 이름·워밍업)부터 보여주는 게 맞다.
   * 그런데 화면이 짧은 폰에서는 딱 몇십 px 모자라서 RIR 버튼이 아래로
   * 잘린다 — 그러면 "다음 세트로 어떻게 가느냐"가 된다.
   *
   * 그래서 모자란 만큼만 내린다. 10px 모자라면 10px만 내려간다.
   */
  function ensureActionVisible() {
    var rir = screen.querySelector('.now-rir');
    if (!rir) return;
    var over = rir.getBoundingClientRect().bottom + 10 - screen.getBoundingClientRect().bottom;
    if (over > 0) screen.scrollTop += over;
  }

  function focusCurrentSet() {
    var now = screen.querySelector('.set-now');
    if (!now) return;
    /*
     * 기준은 머리띠의 아래쪽이다. #screen 위쪽 패딩만큼 어긋나므로
     * 화면 높이에서 머리띠 높이를 빼는 식으로 계산하면 16px 모자라고,
     * 딱 그만큼 "이번 세트" 줄이 잘린다.
     */
    var head = screen.querySelector('.progress-head');
    var limit = head
      ? head.getBoundingClientRect().bottom
      : screen.getBoundingClientRect().top;
    var delta = now.getBoundingClientRect().top - limit;
    screen.scrollTop = Math.max(0, screen.scrollTop + delta - 8);
  }

  function render() {
    var onboarding = state.onboarding.active;
    /*
     * 로그인은 화면 하나를 통째로 쓴다. 모달 안에 넣어 봤더니 주소·열쇠·
     * 이메일·비밀번호가 한 상자에 다 들어가서, 뭘 하는 화면인지 알 수가
     * 없었다. 계정은 계정 화면에서 만든다.
     */
    /*
     * 로그인 화면은 설문보다 앞에 온다.
     *
     * 전에는 설문이 이겼다. 그래서 설문 첫 화면에서 "로그인"을 눌러도
     * 아무 일이 안 일어났다 — 누른 사람은 앱이 고장났다고 본다.
     * 닫으면 설문의 그 자리로 되돌아가므로 잃는 것은 없다.
     */
    /*
     * 계정이 없으면 앱을 쓸 수 없다.
     *
     * 서버가 붙어 있는데 로그인이 안 돼 있으면, 설문 중이 아닌 한 로그인
     * 화면으로 보낸다. 기록이 계정에 있어야 폰을 바꿔도 남고, 헬스장
     * 기구 정보도 계정 단위로 모인다.
     *
     * 서버가 없는 빌드(로컬)에서는 막지 않는다 — 로그인할 곳이 없는데
     * 막으면 앱을 아예 못 연다.
     */
    if (!onboarding && loginRequired() && !state.authOpen) {
      state.authForm = {
        email: Remote.email() || '', password: '',
        mode: Remote.email() ? 'signin' : 'signup', notice: null, busy: false,
      };
      state.authOpen = true;
    }

    var auth = state.authOpen;
    if (auth) onboarding = false;
    tabbar.hidden = onboarding || auth;
    if (meButton) meButton.hidden = onboarding || auth;

    var key = viewKey();
    var moved = key !== lastViewKey;
    lastViewKey = key;

    screen.textContent = '';
    if (onboarding) {
      statusMeta.textContent = '초기 설정';
      renderOnboarding();
    } else if (auth) {
      statusMeta.textContent = '계정';
      renderAuth();
    } else {
      renderTabs();
      renderStatus();
      renderScreen();
    }
    var nowKey = setKey();
    var setMoved = nowKey !== null && nowKey !== lastSetKey;
    lastSetKey = nowKey;

    if (moved) {
      screen.scrollTop = 0;
      ensureActionVisible();
    } else if (setMoved) {
      focusCurrentSet();
      ensureActionVisible();
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
    else if (state.tab === 'me') renderMe();
    else renderDiet();
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
          plannedKg: weight,
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
    /*
     * 없다는 사실도 올린다. "없음"이 안 올라가면 아무도 없음을 못 세고,
     * 그러면 잘못 올라간 기구가 영영 안 지워진다.
     */
    shareGymNow(E.activeGym(state.gymBook));
    /*
     * 이 기구를 쓰는 종목들도 "기구가 없어서 못 한다"로 같이 센다.
     * 그래야 "열 중 여섯이 기구가 없다고 했다"가 만들어지고, 관장이
     * 기구를 사야 하는지 알 수 있다.
     */
    (result.lost || []).forEach(function (lost) {
      shareSkipNow(lost.id, 'noEquipment');
    });
    state.crowd = null;

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
      restBand: state.restBand || undefined,
      restOverrides: state.restOverrides,
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
    state.machinePick = {};
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

  /**
   * 오늘 기록한 세트를 세션 하나로 본다 — 회복 판정에 오늘 것도 넣어야 한다.
   *
   * 헬스장도 같이 적는다. 안 적으면 헬스장으로 거르는 계산(기계 나누기,
   * 머신 중량 이력)에서 **오늘 것만 조용히 빠진다** — 방금 나눈 기계가
   * 화면에 안 나타나는 식으로 드러난다.
   */
  function todaySessionLog() {
    if (state.todaySets.length === 0) return [];
    return [{ date: state.todayDate, sets: state.todaySets, gymId: activeGymId() }];
  }

  /**
   * 오늘 기록을 저장소에 남긴다.
   *
   * 지금까지는 화면 상태(settings)에만 있었다. 그걸로 앱은 돌아가지만
   * 서버로는 못 간다 — 동기화는 저장소의 세션과 아웃박스를 보기 때문이다.
   *
   * 날짜 하나에 세션 하나다. id를 날짜로 고정해야 세트를 더할 때마다
   * 새 세션이 생기지 않고, 아웃박스도 한 줄로 유지된다.
   */
  /**
   * 오늘 체크인을 남긴다.
   *
   * 지금까지 통증은 화면 상태(state.pain)에만 있었다. 그날 종목만
   * 바꾸고 버린 것이다 — 그러면 "3주째"를 영영 알 수 없다. 이력이
   * 쌓여야 한 점이 선이 된다.
   */
  function recordTodayCheckIn() {
    if (!E.allows(state.consent, 'painGate')) return;
    var reported = activePain();
    var existing = state.checkIns.filter(function (item) { return item.date === state.todayDate; })[0];
    // 아픈 데가 없고 전에 적은 것도 없으면 빈 줄을 만들지 않는다.
    if (reported.length === 0 && !existing) return;

    var entry = Object.assign({}, existing, {
      id: (existing && existing.id) || 'checkin-' + state.todayDate,
      date: state.todayDate,
      pain: reported,
    });
    var saved = storage.putCheckIn(entry);
    state.checkIns = state.checkIns
      .filter(function (item) { return item.date !== state.todayDate; })
      .concat([saved]);
  }

  function recordTodaySession() {
    // 유산소만 한 날도 운동한 날이다.
    if (state.todaySets.length === 0 && state.cardioToday.length === 0) return;
    var existing = storage.load().sessions.filter(function (item) {
      return item.date === state.todayDate;
    })[0];
    storage.putSession({
      id: (existing && existing.id) || 'session-' + state.todayDate,
      date: state.todayDate,
      sets: state.todaySets.slice(),
      gymId: activeGymId(),
      /*
       * 유산소와 와드를 같은 기록에 담는다. 따로 두면 동기화도 두 번
       * 해야 하고, 주간 요약에서 한쪽이 빠진다.
       */
      cardio: state.cardioToday.slice(),
      wod: state.wodResults.filter(function (item) { return item.date === state.todayDate; }),
    });
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

  /**
   * 유산소 썸네일.
   *
   * 근력 줄과 달리 **점 하나를 같이 지고 있다.** 오늘 근력과 얼마나
   * 부딪히는지를 색으로 알려 주던 점인데, 그림이 들어오면서 자리를
   * 빼앗길 뻔했다. 지우지 않고 그림 모서리에 얹는다 — 목록을 훑을 때
   * 색으로 거르는 사람이 있고, 그 사람의 길을 그림 때문에 막을 이유가 없다.
   *
   * 색만으로는 못 읽는 사람이 있으므로 줄 안의 설명은 그대로 둔다.
   *
   * **level을 안 주면 점도 안 찍는다.** 하나를 고른 뒤의 화면에는 바로
   * 아래에 경고가 문장으로 다 나와 있다. 훑을 목록이 없는 자리에 훑기용
   * 점을 또 찍으면, 그림 위에 겹쳐 앉아 그림만 지저분해진다.
   */
  function cardioThumb(exercise, level) {
    var art = window.FitEquipmentArt;
    var svg = art && art.hasCardio(exercise.id) ? art.renderCardio(exercise.id, '') : null;
    var box = el('span', { class: 'lift-thumb cardio-thumb' }, []);
    if (svg) { svg.setAttribute('class', 'thumb-art'); box.appendChild(svg); }
    if (level) box.appendChild(el('span', { class: 'cardio-mark ' + level, 'aria-hidden': 'true' }));
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
  /* ── 약속 ──────────────────────────────────────── */

  /**
   * 이번 주 약속.
   *
   * 없으면 프로그램이 고른 요일에 기본 시각을 붙여 만든다. 빈칸으로
   * 두고 고르라고 하면 아무도 안 고른다.
   *
   * 프로그램의 요일이 바뀌면(주 3회 → 4회) 약속도 따라간다. 요일 수가
   * 안 맞는 약속을 들고 있으면, 화면은 셋을 약속받았다고 하면서 볼륨은
   * 넷으로 계산한다.
   */
  function promiseSlots() {
    var want = trainingDays();
    var saved = state.promise;
    if (saved && saved.length === want.length) {
      var sameDays = saved.every(function (slot, i) { return slot.weekday === want[i]; });
      if (sameDays) return saved;
      // 요일만 바뀌었으면 시각은 지킨다 — 사람이 정한 값이다.
      return want.map(function (weekday, i) {
        return { weekday: weekday, minutes: saved[i] ? saved[i].minutes : E.DEFAULT_WEEKDAY_MINUTES };
      });
    }
    return E.defaultSlots(want);
  }

  /** 오늘 요일(월=0)과 지금 몇 분인지. 진짜 시계로 본다. */
  function nowWeekday() {
    return (new Date().getDay() + 6) % 7;
  }

  function nowMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function nextPromise() {
    return E.nextSlot(promiseSlots(), nowWeekday(), nowMinutes());
  }

  /* ── 다음 운동 예고 ──────────────────────────────

     요약은 닫힌 문장이다. 다 했고, 숫자가 이만큼이고, 끝.
     끝난 이야기에는 돌아올 이유가 없다.

     그래서 마지막 줄을 열어둔다 — 다음에 **언제, 무엇을, 몇 킬로로**.
     "운동해야지"로는 안 오고 "목요일에 벤치 105 올려야지"로는 온다.

     숫자는 지어내지 않는다. 여기 뜨는 무게는 그날 실제로 처방될
     무게를 같은 엔진으로 그 자리에서 계산한 것이다. 예고가 105인데
     막상 100이 나오면 다음부터 예고를 안 믿는다.
  ── */

  /** 다음 약속. 오늘 것은 방금 했으니 지난 것으로 친다. */
  function promiseAfterToday() {
    return E.nextSlot(promiseSlots(), nowWeekday(), 24 * 60);
  }

  /** 그 종목을 마지막으로 했을 때의 톱세트 무게. 없으면 null. */
  function lastTopWeight(history, exerciseId) {
    for (var i = history.length - 1; i >= 0; i -= 1) {
      var top = E.topWorkingSet(history[i].sets, exerciseId);
      if (top && top.weightKg != null) return top.weightKg;
    }
    return null;
  }

  /**
   * 다음에 할 날을 지금 계산한다.
   *
   * 순서는 오늘 한 날의 **다음 날**이다. 오늘 날을 직접 바꿔서 했다면
   * 거기서 이어간다 — 프로그램 순서가 아니라 그 사람이 실제로 한
   * 순서를 따라가야 예고가 맞는다.
   */
  function nextPreview() {
    if (!state.program || !state.program.templates || state.program.templates.length === 0) {
      return null;
    }
    var templates = state.program.templates;
    var template = templates[(currentTemplateIndex() + 1) % templates.length];
    if (!template) return null;

    var next = promiseAfterToday();
    var date = state.todayDate;
    if (next) {
      var day = new Date(state.todayDate + 'T00:00:00');
      day.setDate(day.getDate() + next.daysAhead);
      date = day.toISOString().slice(0, 10);
    }

    // 오늘 한 것까지 넣어야 "지난번"이 오늘이 된다.
    var history = state.history.concat(todaySessionLog());

    var built;
    try {
      built = E.buildSession({
        template: withExclusions(template),
        date: date,
        plan: state.plan,
        history: history,
        index: index,
        pain: activePain(),
        gym: state.gym,
        gymId: state.gymBook ? state.gymBook.activeId : undefined,
        // 오늘 선 기계를 그대로 본다. 다음에도 같은 기계일 확률이 높다.
        machines: state.machinePick,
        lifter: state.lifter,
      });
    } catch (err) {
      // 예고는 덤이다. 계산이 안 되면 조용히 빠진다.
      return null;
    }

    var comeback = activeComeback();
    var factor = comeback ? E.loadFactorAt(comeback.plan, comeback.week) : 1;

    var exercises = built.exercises.map(function (item) {
      var top = item.sets[0] || null;
      var weight = top && top.weightKg != null ? top.weightKg : null;
      if (weight != null && factor < 1) {
        weight = item.loading
          ? E.nearestLoadable(weight * factor, item.loading, 'down')
          : E.roundToIncrement(weight * factor, item.exercise.increment);
      }
      return {
        name: item.exercise.name,
        equipment: item.exercise.equipment,
        pattern: item.exercise.pattern,
        weightKg: weight,
        sets: item.sets.length,
        repMin: top ? top.targetReps.min : 8,
        repMax: top ? top.targetReps.max : 12,
        previousKg: lastTopWeight(history, item.exercise.id),
      };
    });

    return E.buildPreview({
      sessionName: template.name,
      whenLabel: E.nextSlotShort(next) || null,
      exercises: exercises,
      drop: state.plan.phase === 'deload' ? 'deload' : (comeback ? 'comeback' : null),
    });
  }

  /**
   * 예고 카드.
   *
   * 끝낸 화면에만 둔다. 운동 중에 다음 날이 보이면 지금 할 것에서
   * 눈이 떠난다. 다 끝난 사람에게만 다음 문을 열어 보인다.
   */
  function previewCard() {
    var preview = nextPreview();
    if (!preview) return null;
    return el('div', { class: 'preview-card' }, [
      el('span', { class: 'preview-tag', text: '다음 운동' }),
      el('span', { class: 'preview-head', text: preview.headline }),
      el('span', { class: 'preview-detail', text: preview.detail }),
    ]);
  }

  /**
   * 약속 카드.
   *
   * "주 4회"는 지켜지지 않고 "화요일 저녁 7시"는 지켜진다. 현장에서도
   * 그렇다 — "일주일에 네 번 나오세요"보다 "화·목·토 7시에 뵐게요"다.
   *
   * 연속 카드 바로 위에 둔다. "이번 주 3/4"를 읽은 사람이 바로 다음에
   * 봐야 하는 것은 **언제 한 번 더 가는가**다.
   */
  function promiseCard() {
    var next = nextPromise();
    if (!next) return null;

    return el('button', {
      type: 'button', class: 'promise-row' + (next.daysAhead === 0 ? ' today' : ''),
      title: '약속한 요일과 시각을 바꿉니다',
      onclick: openPromise,
    }, [
      el('span', { class: 'plan-main' }, [
        el('span', { class: 'name', text: E.nextSlotLine(next) }),
        el('span', { class: 'plan-sets', text: E.promiseSummary(promiseSlots()) }),
      ]),
      el('span', { class: 'detail', text: '›' }),
    ]);
  }

  /** 요일마다 시각을 고른다. 요일 자체는 프로그램이 정한다. */
  function openPromise() {
    var slots = promiseSlots().map(function (slot) {
      return { weekday: slot.weekday, minutes: slot.minutes };
    });

    var draw = function () {
      var body = [];
      body.push(el('p', { class: 'asset-note', text:
        '"주 ' + slots.length + '회"보다 "화요일 7시"가 훨씬 잘 지켜집니다. ' +
        '가실 수 있는 시각으로 바꿔 두시면 그 한 시간 전에 알려 드립니다.' }));

      slots.forEach(function (slot, i) {
        var row = el('div', { class: 'promise-edit' }, [
          el('span', { class: 'promise-day', text: E.WEEKDAY_LABELS_KO[slot.weekday] }),
        ]);
        var chips = el('div', { class: 'chip-row promise-times' }, []);
        E.timeChoices().forEach(function (minutes) {
          var on = minutes === slot.minutes;
          chips.appendChild(el('button', {
            type: 'button', class: 'chip', 'aria-pressed': String(on),
            text: E.minutesLabel(minutes),
            onclick: function () { slots[i].minutes = minutes; draw(); },
          }));
        });
        row.appendChild(chips);
        body.push(row);
      });

      body.push(el('p', { class: 'hint-line', text:
        '요일은 프로그램이 정합니다 — 주 횟수를 바꾸시려면 설정에서 프로그램을 바꾸세요.' }));

      body.push(el('button', {
        type: 'button', class: 'finish', text: '이렇게 약속하기',
        onclick: function () {
          state.promise = slots.map(function (slot) {
            return { weekday: slot.weekday, minutes: E.clampMinutes(slot.minutes) };
          });
          persist();
          modal.close();
          pushLog('약속', '<b>' + E.promiseSummary(state.promise) + '</b>에 가기로 했습니다. ' +
            '한 시간 전에 알려 드립니다.');
          scheduleNudge();
          render();
        },
      }));

      openModal('언제 가세요?', E.promiseSummary(slots), body);
      /*
       * 줄마다 고른 칩이 보이게 민다. 시각이 서른다섯 개라, 저녁 7시를
       * 골라 둔 사람이 열면 05:00만 보인다.
       *
       * scrollIntoView를 쓰면 모달 자체가 같이 위아래로 튄다. 가로
       * 스크롤만 손대려고 scrollLeft를 직접 계산한다.
       */
      Array.prototype.forEach.call(modal.querySelectorAll('.promise-times'), function (rowEl) {
        var chosen = rowEl.querySelector('.chip[aria-pressed="true"]');
        if (!chosen) return;
        rowEl.scrollLeft = chosen.offsetLeft - (rowEl.clientWidth - chosen.offsetWidth) / 2;
      });
    };
    draw();
  }

  /* ── 돌아왔을 때 ───────────────────────────────── */

  /**
   * 마지막으로 **실제로 운동한** 날.
   *
   * state.history를 보면 안 된다. 거기엔 앱이 첫날부터 돌아가게 만들어 둔
   * **데모 이력**이 들어 있어서, 누가 언제 오든 "방금 했음"으로 읽힌다 —
   * 그러면 복귀 조정은 영원히 안 뜬다.
   *
   * 저장소에 실제로 적힌 세션만 본다. 한 번도 안 한 사람은 null이고,
   * 그때는 묻지 않는다 — 처음 온 사람에게 "오랜만이네요"는 이상하다.
   *
   * 날을 세는 기준은 주간 기록과 같게 맞춘다(streak.ts). 두 곳이 갈리면
   * "이번 주 3번 나왔다"면서 "한 달 쉬었다"고 하는 화면이 나온다.
   */
  function lastTrainedDate() {
    var saved = storage.load().sessions || [];
    var dates = saved
      .filter(function (session) {
        if (session.deleted || !session.sets) return false;
        return session.sets.some(function (set) { return !set.warmup && set.reps > 0; });
      })
      .map(function (session) { return session.date; })
      .sort();
    if (state.todaySets.length > 0) dates.push(state.todayDate);
    return dates.length > 0 ? dates[dates.length - 1] : null;
  }

  /**
   * 하는 중인 복귀. 다 끝났으면 null이고, 그때 스스로 치운다.
   *
   * 끝난 계획을 들고 있으면 다음 달에 앱을 열었을 때 "복귀 3주차"가
   * 다시 뜬다. 끝난 것은 끝난 것으로 지운다.
   */
  function activeComeback() {
    var saved = state.comeback;
    if (!saved || !saved.plan) return null;
    var week = E.comebackWeek(saved.startedOn, state.todayDate);
    if (week >= saved.plan.weeks) {
      state.comeback = null;
      return null;
    }
    return { plan: saved.plan, week: week };
  }

  /** 물어볼 만한 공백이 있는가. 이미 하는 중이거나 거절했으면 안 묻는다. */
  function pendingComeback() {
    if (state.comeback) return null;
    var last = lastTrainedDate();
    if (!last || state.comebackDeclined === last) return null;
    var plan = E.planComeback({ lastTrainedISO: last, today: state.todayDate });
    return plan.needed ? { plan: plan, last: last } : null;
  }

  /**
   * 복귀 카드.
   *
   * 화면 제일 위다. 오늘 세션의 **무게를 통째로 바꾸는 이야기**라, 종목
   * 목록을 보기 전에 정해져 있어야 한다.
   *
   * 이유를 먼저 묻는다. 바빠서 쉰 2주와 다쳐서 쉰 2주는 전혀 다른 2주다 —
   * 종목을 뺄 때 "왜요?"를 먼저 묻는 것과 같은 이유다.
   */
  function comebackCard() {
    var running = activeComeback();
    if (running) {
      return el('div', { class: 'sheet comeback on' }, [
        el('div', { class: 'sheet-head' }, [
          el('h3', { text: '돌아오는 중' }),
          el('span', { class: 'meta', text: (running.week + 1) + ' / ' + running.plan.weeks + '주차' }),
        ]),
        el('div', { class: 'sheet-body' }, [
          el('p', { class: 'hint-line', text: E.comebackLine(running.plan, running.week) }),
          el('button', {
            type: 'button', class: 'finish quiet', text: '그만두고 원래 무게로',
            onclick: function () {
              state.comeback = null;
              state.comebackDeclined = lastTrainedDate();
              rebuildSession();
              persist();
              pushLog('복귀', '복귀 조정을 껐습니다. 오늘부터 원래 무게입니다.');
              render();
            },
          }),
        ]),
      ]);
    }

    var pending = pendingComeback();
    if (!pending) return null;

    var body = el('div', { class: 'sheet-body' }, [
      el('p', { class: 'hint-line', text: '왜 쉬셨나요? 답에 따라 내리는 폭이 다릅니다.' }),
    ]);

    body.appendChild(el('div', { class: 'summary-list' }, E.LAYOFF_REASONS.map(function (item) {
      return el('button', {
        type: 'button', class: 'menu-row',
        onclick: function () { startComeback(pending.last, item.reason); },
      }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: item.label }),
          el('span', { class: 'plan-sets', text: item.note }),
        ]),
        el('span', { class: 'detail', text: '›' }),
      ]);
    })));

    body.appendChild(el('button', {
      type: 'button', class: 'finish quiet', text: '아니요, 원래 무게로 하겠습니다',
      onclick: function () {
        state.comebackDeclined = pending.last;
        persist();
        pushLog('복귀', '원래 무게로 갑니다. 무겁거든 세트 화면에서 내리셔도 됩니다.');
        render();
      },
    }));

    return el('div', { class: 'sheet comeback' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: pending.plan.title }),
        el('span', { class: 'meta', text: pending.plan.gapDays + '일' }),
      ]),
      body,
    ]);
  }

  function startComeback(lastTrained, reason) {
    var plan = E.planComeback({
      lastTrainedISO: lastTrained, today: state.todayDate, reason: reason,
    });
    state.comeback = { startedOn: state.todayDate, plan: plan };
    state.comebackDeclined = null;
    rebuildSession();
    persist();
    pushLog('복귀', '<b>' + plan.title + '</b> ' + plan.note);

    /*
     * 다쳐서 쉬었다고 한 사람은 통증부터 적게 한다. 무게를 내리는 것과
     * 아픈 관절을 피하는 것은 다른 일이고, 둘 다 필요하다.
     */
    if (reason === 'injury') {
      pushLog('복귀', '아픈 곳을 <b>체크인</b>에 적어 주시면 그 관절에 부담이 큰 종목도 같이 바꿉니다.');
    }
    render();
  }

  /* ── 시간이 없는 날 ─────────────────────────────── */

  /**
   * 오늘만 짧게 가기로 한 시간.
   *
   * **날짜를 같이 들고 있는 것이 전부다.** 야근한 화요일에 15분을 눌렀는데
   * 그게 설정으로 굳으면, 그 사람은 다음 주에도 15분짜리를 받는다. 오늘이
   * 지나면 저절로 풀린다.
   */
  function shortBudget() {
    var short = state.shortDay;
    if (!short || short.date !== state.todayDate) return null;
    return short.minutes;
  }

  function shortFitOptions() {
    return {
      restMultiplier: E.styleProfile(state.style).restMultiplier,
      restBand: state.restBand || undefined,
      restOverrides: state.restOverrides,
      allowShortRest: state.style === 'density',
    };
  }

  /**
   * "오늘 시간이 없으신가요" 카드.
   *
   * 습관 앱이 사람을 붙잡는 진짜 장치는 연속 기록이 아니라 **"한 문제만
   * 풀어도 인정"** 이다. 야근하고 온 사람에게 "60분 6종목"을 보여주면
   * 앱을 끈다. 그 사람이 여는 것은 "15분이면 됩니다"다.
   *
   * 종목 목록보다 **위**에 둔다. 아래에 두면 이미 긴 목록을 보고 닫은
   * 뒤라서 아무도 못 본다.
   */
  function shortDayCard() {
    var minutes = shortBudget();

    if (minutes) {
      var kept = E.keptLine(state.session);
      return el('div', { class: 'sheet short-day on' }, [
        el('div', { class: 'sheet-head' }, [
          el('h3', { text: '오늘은 짧게' }),
          el('span', { class: 'meta', text: minutes + '분 안에' }),
        ]),
        el('div', { class: 'sheet-body' }, [
          el('p', { class: 'hint-line', text: kept }),
          /*
           * 이 문장이 이 기능의 전부다. 짧게 한 날이 "안 한 날"로 세어지면
           * 아무도 안 누른다. streak.ts는 본 세트가 하나라도 있으면 그날을
           * 센다 — 그래서 이 말은 참이다(shortSession.test.ts가 지킨다).
           */
          el('p', { class: 'hint-line', text:
            '짧게 해도 이번 주 나온 날로 셉니다.' }),
          el('button', {
            type: 'button', class: 'finish quiet', text: '원래대로 되돌리기',
            onclick: function () {
              state.shortDay = null;
              rebuildSession();
              persist();
              render();
            },
          }),
        ]),
      ]);
    }

    var full = E.estimateSessionTime(state.session, shortFitOptions()).totalMinutes;
    var options = E.shortOptions(state.session, full, shortFitOptions());
    if (options.length === 0) return null;

    var rows = el('div', { class: 'summary-list' }, options.map(function (option) {
      return el('button', {
        type: 'button', class: 'menu-row',
        onclick: function () {
          state.shortDay = { date: state.todayDate, minutes: option.budgetMinutes };
          rebuildSession();
          pushLog('오늘', '<b>' + option.budgetMinutes + '분</b> 안에 끝내기로 했습니다 — ' + option.kept);
          persist();
          render();
        },
      }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: option.budgetMinutes + '분 안에 끝내기' }),
          el('span', { class: 'plan-sets', text: option.kept }),
        ]),
        el('span', { class: 'detail', text: '\u203a' }),
      ]);
    }));

    return el('div', { class: 'sheet short-day' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '시간이 없는 날' }),
        el('span', { class: 'meta', text: '오늘 ' + Math.round(full) + '분' }),
      ]),
      el('div', { class: 'sheet-body' }, [
        el('p', { class: 'hint-line', text:
          '고립 운동부터 덜어내고 제일 중요한 것만 남깁니다. ' +
          '아무것도 안 한 주보다 짧게 세 번이 낫습니다.' }),
        rows,
      ]),
    ]);
  }

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

    var pain = painRow();
    if (pain) screen.appendChild(pain);

    /*
     * 복귀가 제일 위다. 오늘 세션의 무게를 통째로 바꾸는 이야기라,
     * 종목 목록을 보기 전에 정해져 있어야 한다.
     */
    var back = comebackCard();
    if (back) screen.appendChild(back);

    var short = shortDayCard();
    if (short) screen.appendChild(short);

    var cheers = cheersBanner();
    if (cheers) screen.appendChild(cheers);

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
            // 프로그램이 짜 준 것과 끼워 넣은 것은 구분돼야 한다
            isExtraLift(lift.exercise.id, lift)
              ? el('span', { class: 'extra-tag', text: '추가' }) : null,
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

    /*
     * 지킨 주를 목록 바로 위에 둔다. "오늘 나왔다"가 곧 "이번 주를 지켰다"로
     * 이어지는 게 보여야 나올 이유가 생긴다.
     */
    var promise = promiseCard();
    if (promise) screen.appendChild(promise);
    screen.appendChild(streakCard(currentStreak()));
    var friends = friendsCard();
    if (friends) screen.appendChild(friends);
    var nudge = reportNudge();
    if (nudge) screen.appendChild(nudge);
    /*
     * 뺀 지 4주가 된 종목을 여기서 묻는다. 오늘 할 것을 보는 순간이라
     * "이거 다시 해볼래요?"가 자연스럽게 읽힌다.
     */
    var review = excludeReviewCard();
    if (review) screen.appendChild(review);

    screen.appendChild(el('div', { class: 'sheet' }, [
      /*
       * 버튼이 넷이 되니 390px 폰에서 제목이 두 줄로 쪼개졌다. 제목은
       * 제목 줄에 두고, 버튼은 아래 한 줄에 모아 넘치면 옆으로 민다.
       */
      el('div', { class: 'sheet-head stacked' }, [
        el('div', { class: 'head-title' }, [
          el('h3', { text: '오늘 할 것' }),
          el('span', { class: 'meta', text: '총 ' + state.lifts.length + '개' }),
        ]),
        el('span', { class: 'head-actions' }, [
          el('button', {
            type: 'button', class: 'demo-open', text: '다른 운동',
            title: '프로그램에 없는 종목을 오늘만 끼워 넣습니다',
            onclick: openAddLift,
          }),
          el('button', {
            type: 'button', class: 'demo-open', text: '세어주기',
            title: '템포와 음성 카운트를 정합니다',
            onclick: openVoiceSettings,
          }),
          el('button', {
            type: 'button', class: 'demo-open', text: '휴식',
            title: '세트 간 휴식 시간을 정합니다',
            onclick: openRestSettings,
          }),
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
    renderCardio();
    renderConditioning();

    var doneSets = state.todaySets.length;
    screen.appendChild(coachPicker());
    screen.appendChild(el('button', {
      type: 'button', class: 'finish start-cta',
      text: doneSets > 0 ? '이어서 하기 · ' + doneSets + '세트 완료' : '시작하기',
      onclick: function () {
        state.started = true;
        if (ptOn()) {
          /*
           * 손으로 누른 이 순간에 한 번 말해야 iOS가 뒤에 오는 말을 막지
           * 않는다. 그리고 화면을 켜 둔다 — 운동 중에 화면이 꺼지면 말도
           * 끊긴다.
           */
          speak(state.coach.style === 'fired' ? '시작합니다!' : '시작할게요.');
          acquireWakeLock();
        }
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
  /**
   * 다른 운동 하기.
   *
   * 프로그램이 짜 준 것 말고 더 하고 싶은 날이 있다. "오늘은 팔 좀 더",
   * "이 기구 비었으니 해보자" — 그걸 못 하게 막으면 사용자는 앱 밖에서
   * 하고, 그러면 그 세트는 볼륨 계산에서 빠진다. **기록되지 않는 운동이
   * 제일 나쁘다.**
   *
   * 다만 아무거나 앞에 내놓지 않는다. 이 헬스장에 있는 기구부터,
   * 그리고 오늘 아픈 데에 부담이 큰 것은 뒤로 민다.
   */
  function openAddLift() {
    var draw = function () {
      var entry = currentGymEntry();
      var query = (state.addLiftQuery || '').trim();
      var body = [];

      body.push(el('p', { class: 'asset-note', text:
        '프로그램에 없는 종목을 오늘만 끼워 넣습니다. 기록은 똑같이 남고 볼륨에도 들어갑니다 — ' +
        '앱 밖에서 하면 그 세트는 어디에도 안 남습니다.' }));

      var search = el('input', {
        type: 'search', class: 'text-input', value: state.addLiftQuery || '',
        placeholder: '종목 이름 (예: 컬, 레그)',
        'aria-label': '종목 찾기',
        oninput: function (event) { state.addLiftQuery = event.target.value; draw(); },
      });
      body.push(search);

      var already = {};
      state.lifts.forEach(function (lift) { already[lift.exercise.id] = true; });

      var candidates = E.EXERCISES.filter(function (exercise) {
        if (already[exercise.id]) return false;
        if (!query) return true;
        return exercise.name.indexOf(query) >= 0
          || (exercise.nameEn || '').toLowerCase().indexOf(query.toLowerCase()) >= 0;
      });

      /*
       * 이 헬스장에 기구가 없는 종목은 뒤로. 목록에서 아예 빼지는
       * 않는다 — 기구 등록이 안 끝났을 수도 있고, 오늘만 다른 데서
       * 할 수도 있다.
       */
      var painful = activePain();

      /*
       * 이 헬스장에 "없는" 기구. equipmentBehind()는 반대로 — 있는 것 중
       * 무엇을 꺼야 하는지를 주므로 여기서는 쓸 수 없다.
       */
      var gymIds = entry ? entry.equipmentIds : [];
      var missingFor = function (exercise) {
        var required = E.EXERCISE_REQUIREMENTS[exercise.id] || [];
        return required
          .filter(function (id) { return gymIds.indexOf(id) < 0; })
          .map(function (id) {
            var item = E.equipmentItem(id);
            return item ? item.name : id;
          });
      };

      /*
       * 오늘 쓰는 부위를 앞에 둔다. 하체 날에 벤치프레스가 맨 위에
       * 뜨면 목록을 안 믿게 된다 — 끼워 넣는 종목은 대개 오늘 하는
       * 부위의 보조 종목이다.
       */
      var todayMuscles = todayMuscleList();
      var rank = function (exercise) {
        var offToday = todayMuscles.indexOf(E.primaryMuscle(exercise)) < 0 ? 1 : 0;
        var missing = entry && missingFor(exercise).length > 0 ? 2 : 0;
        var hurts = painful.some(function (report) {
          return report.score >= 3 && (exercise.jointStress[report.joint] || 0) >= 0.5;
        }) ? 4 : 0;
        return offToday + missing + hurts;
      };
      candidates = candidates.slice().sort(function (a, b) { return rank(a) - rank(b); }).slice(0, 40);

      if (candidates.length === 0) {
        body.push(el('p', { class: 'hint-line', text: '그 이름으로는 없습니다. 다르게 쳐 보세요.' }));
      }

      body.push(el('div', { class: 'summary-list' }, candidates.map(function (exercise) {
        var missing = entry ? missingFor(exercise) : [];
        var hurts = painful.filter(function (report) {
          return report.score >= 3 && (exercise.jointStress[report.joint] || 0) >= 0.5;
        })[0];

        return el('button', {
          type: 'button', class: 'add-lift-row',
          onclick: function () { addExtraLift(exercise); },
        }, [
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'name', text: exercise.name }),
            el('span', { class: 'plan-sets', text:
              hurts ? '⚠ ' + E.JOINT_LABELS_KO[hurts.joint] + '에 부담이 큽니다'
                : missing.length > 0
                  ? '이 헬스장에 ' + withParticleJs(missing[0], '이/가') + ' 없습니다'
                : E.MUSCLE_LABELS_KO[E.primaryMuscle(exercise)] || exercise.pattern }),
          ]),
          el('span', { class: 'detail', text: '＋' }),
        ]);
      })));

      openModal('다른 운동 하기', state.extraLifts.length > 0
        ? state.extraLifts.length + '개 추가됨' : '오늘만', body);
    };
    draw();
  }

  function addExtraLift(exercise) {
    state.extraLifts = state.extraLifts.concat([{ exerciseId: exercise.id, sets: 3 }]);
    state.addLiftQuery = '';
    rebuildSession();
    pushLog('다른 운동', '<b>' + exercise.name + '</b>' +
      particleOf(exercise.name, '을/를') + ' 오늘 목록에 넣었습니다.');
    modal.close();
    render();
  }

  /** 끼운 종목을 뺀다. 프로그램이 짜 준 것은 못 뺀다 — 그건 순서 변경이 할 일이다. */
  function removeExtraLift(exerciseId) {
    state.extraLifts = state.extraLifts.filter(function (extra) {
      return extra.exerciseId !== exerciseId;
    });
    rebuildSession();
    render();
  }

  /**
   * 끼워 넣은 종목인가.
   *
   * 기구가 없어서 대체됐을 수 있다. 레그 익스텐션을 넣었는데 레그프레스로
   * 바뀌면 id가 달라지므로, 바뀌기 전 것도 같이 본다 — 안 그러면
   * "추가" 표시가 사라지고 뺄 수도 없게 된다.
   */
  function isExtraLift(exerciseId, lift) {
    var ids = [exerciseId];
    if (lift && lift.substitutedFrom) ids.push(lift.substitutedFrom.id);
    return state.extraLifts.some(function (extra) {
      return ids.indexOf(extra.exerciseId) >= 0;
    });
  }

  /** 뺄 때도 바뀌기 전 id로 찾아야 한다. */
  function extraIdFor(lift) {
    var ids = [lift.exercise.id];
    if (lift.substitutedFrom) ids.push(lift.substitutedFrom.id);
    var found = state.extraLifts.filter(function (extra) {
      return ids.indexOf(extra.exerciseId) >= 0;
    })[0];
    return found ? found.exerciseId : lift.exercise.id;
  }

  function openLiftMenu(lift) {
    var entry = currentGymEntry() || { equipmentIds: [] };
    var options = [
      { label: '동작 시연', hint: '수행 큐 · 흔한 실수 · 쓰는 근육', run: function () { openDemo(lift.exercise); } },
      { label: '사람 있어요', hint: '순서 변경 · 대체 · 대기 중에서 고릅니다', run: function () { openOccupancy(lift.exercise); } },
    ];
    if (isExtraLift(lift.exercise.id, lift)) {
      options.push({
        label: '오늘 목록에서 빼기',
        hint: '따로 끼워 넣은 종목입니다',
        run: function () { modal.close(); removeExtraLift(extraIdFor(lift)); },
      });
    }
    options.push({
      label: '이 종목 휴식 시간',
      hint: restOverrideHint(lift),
      run: function () { openRestSettings(lift.exercise.id); },
    });
    if (E.equipmentBehind(lift.exercise, entry).length > 0) {
      options.push({
        label: '이 기구 없어요',
        hint: '그 기구를 쓰는 종목이 한 번에 정리됩니다',
        run: function () { openMissingEquipment(lift.exercise); },
      });
    }
    options.push({
      label: '이 종목 빼기',
      hint: '왜 빼는지에 따라 하는 일이 다릅니다',
      run: function () { openExclude(lift.exercise); },
    });

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

  /* ── 종목 빼기 ─────────────────────────────────── */

  /**
   * "왜요?"를 먼저 묻는다.
   *
   * 종목 옆에 "싫어요" 하나만 달면 초보는 해야 할 것을 전부 뺀다. 스쿼트는
   * 힘들어서, 데드는 무서워서, 풀업은 하나도 못 해서 — 남는 건 머신 컬이다.
   * 트레이너는 그렇게 하지 않는다.
   *
   * 이유를 물으면 네 갈래가 되는데 진짜 "빼기"는 하나뿐이다. 나머지 셋은
   * 앱이 이미 더 잘 처리하는 길이 있다.
   */
  function openExclude(exercise) {
    var body = [];

    body.push(el('p', { class: 'asset-note', text:
      '왜 빼려고 하시는지에 따라 하는 일이 다릅니다. 아파서 빼는 것과 ' +
      '기구가 없어서 빼는 것은 같은 문제가 아닙니다.' }));

    body.push(el('div', { class: 'summary-list' }, E.EXCLUDE_REASONS.map(function (spec) {
      return el('button', {
        type: 'button', class: 'menu-row',
        onclick: function () { pickExcludeReason(exercise, spec); },
      }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: spec.label }),
          el('span', { class: 'plan-sets', text: spec.hint }),
        ]),
        el('span', { class: 'detail', text: '›' }),
      ]);
    })));

    openModal(exercise.name, '이 종목 빼기', body);
  }

  /**
   * 뺀 종목을 남들 것과 같이 센다.
   *
   * **아파서 뺀 것은 안 올린다.** 건강 정보라서 익명으로 모아도 "이 헬스장
   * 사람들이 허리가 아프다"는 말이 만들어지는데, 그건 우리가 만들어도 되는
   * 말이 아니다. 여기서 한 번, DB의 check 제약에서 한 번 막는다 — 앱은
   * 여러 버전이 돌아다니지만 DB는 하나다.
   */
  function shareSkipNow(exerciseId, reason) {
    if (typeof Remote === 'undefined' || !Remote.signedIn()) return;
    if (reason !== 'noEquipment' && reason !== 'dislike') return;
    var entry = currentGymEntry();
    if (!shareableGym(entry)) return;
    Remote.shareSkip(entry.id, exerciseId, reason).catch(function () { /* 조용히 */ });
  }

  /** 다시 하기로 했으면 집계에서도 뺀다. */
  function unshareSkipNow(exerciseId) {
    if (typeof Remote === 'undefined' || !Remote.signedIn()) return;
    var entry = currentGymEntry();
    if (!shareableGym(entry)) return;
    Remote.unshareSkip(entry.id, exerciseId).catch(function () { /* 조용히 */ });
  }

  /**
   * 카카오·구글 화면으로 떠난다.
   *
   * 이 함수는 페이지를 통째로 다른 주소로 보낸다. 그래서 떠나기 전에
   * **여기까지 답한 것을 저장해 둬야** 돌아왔을 때 다시 묻지 않는다.
   *
   * 다만 **설문을 끝내 버리지는 않는다.** 가입이 맨 앞으로 오기 전에는
   * 여기서 completeOnboarding()을 불렀다 — 그때는 뒤에 남은 단계가 없어서
   * 그게 맞았다. 지금 그러면 아무것도 안 물어본 기본값으로 프로그램이
   * 만들어지고, 돌아온 사람은 자기가 고른 적 없는 프로그램을 받는다.
   *
   * 돌아와서 할 일은 두 갈래이고 둘 다 저절로 된다.
   *   · 쓰던 계정 → 동기화가 프로그램을 되살리고 설문을 건너뛴다
   *   · 새 계정  → 가입 단계가 목록에서 빠져 동의부터 이어서 한다
   */
  function startOAuth(provider) {
    persist();
    Remote.oauthStart(provider);
  }

  /**
   * 돌아왔을 때 거둔다.
   *
   * 앱이 켜질 때 딱 한 번 본다. 토큰은 주소의 # 뒤에 실려 오는데 거두는
   * 즉시 주소창에서 지운다 — 그대로 두면 주소를 복사해 공유하는 순간
   * 로그인 정보가 같이 간다.
   */
  function finishOAuth() {
    if (typeof Remote === 'undefined' || !Remote.configured()) return;
    var result = Remote.captureOAuth();
    if (!result) return;

    if (!result.ok) {
      pushLog('로그인', '로그인하지 못했습니다 — ' + result.message +
        ' 체크인 탭에서 다시 해 보실 수 있습니다.');
      openAuth('signin');
      return;
    }

    Remote.loadIdentity().then(function () {
      pushLog('로그인', '<b>' + (Remote.email() || '계정') + '</b>으로 로그인했습니다.');
      return syncNow();
    }).then(function () { render(); }, function () { render(); });
  }

  /** 카카오·구글 줄. 두 화면이 같이 쓴다. */
  function oauthRows() {
    return el('div', { class: 'summary-list' }, ['kakao', 'google'].map(function (provider) {
      return el('button', {
        type: 'button', class: 'menu-row oauth-row',
        onclick: function () { startOAuth(provider); },
      }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: Remote.providerLabel(provider) + '로 시작하기' }),
          el('span', { class: 'plan-sets', text: '이미 쓰시는 계정으로 — 비밀번호를 새로 만들지 않습니다' }),
        ]),
        el('span', { class: 'detail', text: '›' }),
      ]);
    }));
  }

  function pickExcludeReason(exercise, spec) {
    if (spec.route === 'equipment') {
      // 이미 있는 길이 더 낫다 — 그 기구를 쓰는 종목이 한 번에 정리된다.
      openMissingEquipment(exercise);
      return;
    }
    if (spec.route === 'pain') { openExcludePain(exercise); return; }
    if (spec.route === 'coach') { startCoaching(exercise); return; }
    openExcludeConfirm(exercise);
  }

  /**
   * 어디가 아픈지 묻는다.
   *
   * 관절을 알면 이 종목 하나가 아니라 **그 관절에 부담이 큰 종목 전부**가
   * 같이 조정된다. 종목 하나만 빼면 다음 주에 같은 자리가 또 아프다.
   */
  function openExcludePain(exercise) {
    var joints = Object.keys(exercise.jointStress || {})
      .filter(function (joint) { return (exercise.jointStress[joint] || 0) >= 0.4; })
      .sort(function (a, b) { return exercise.jointStress[b] - exercise.jointStress[a]; });
    if (joints.length === 0) joints = Object.keys(E.JOINT_LABELS_KO);

    var body = [];
    body.push(el('p', { class: 'asset-note', text:
      '어디가 아프신가요? 관절을 알면 이 종목만이 아니라 그 관절에 부담이 큰 ' +
      '종목이 같이 조정됩니다. 이 기록은 서버의 공유 목록에 올라가지 않습니다.' }));

    body.push(el('div', { class: 'summary-list' }, joints.map(function (joint) {
      return el('button', {
        type: 'button', class: 'menu-row',
        onclick: function () {
          state.exclusions = E.addExclusion(state.exclusions, {
            exerciseId: exercise.id, reason: 'pain', today: state.todayDate, joint: joint,
          });

          /*
           * 통증도 같이 적는다.
           *
           * 이 종목 하나만 빼면 다음 주에 같은 자리가 또 아프다 — 그 관절에
           * 부담이 큰 종목이 프로그램에 여럿 있기 때문이다. 화면에 "그 관절에
           * 부담이 큰 종목이 같이 조정됩니다"라고 적어 놓고 이 종목만 빼면,
           * 그건 말과 동작이 갈라진 것이다.
           *
           * 이미 더 아프다고 적어 둔 것이 있으면 덮어쓰지 않는다. 종목 하나
           * 빼려고 누른 것이 체크인에 적은 값을 낮추면 안 된다.
           */
          var PAIN_FROM_SKIP = 4;   // pain.ts가 "대체"로 넘어가는 선
          state.pain = state.pain.map(function (report) {
            if (report.joint !== joint) return report;
            return { joint: joint, score: Math.max(report.score || 0, PAIN_FROM_SKIP) };
          });

          modal.close();
          rebuildSession();

          var moved = (state.session ? state.session.exercises : []).filter(function (item) {
            return item.substitutedFrom;
          }).length;

          pushLog('종목 빼기', '<b>' + exercise.name + '</b>' +
            particleOf(exercise.name, '을/를') + ' 뺐습니다 — ' +
            E.JOINT_LABELS_KO[joint] + '이 아파서. ' +
            (moved > 0
              ? '같은 관절에 부담이 큰 종목 ' + moved + '개도 같이 바꿨습니다.'
              : '체크인에서 통증 정도를 더 정확히 적으실 수 있습니다.'));
          render();
        },
      }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: E.JOINT_LABELS_KO[joint] || joint }),
        ]),
        el('span', { class: 'detail', text: '›' }),
      ]);
    })));

    openModal(exercise.name, '어디가 아프신가요', body);
  }

  /**
   * 빼지 않고 가르친다.
   *
   * 못 하는 것과 하기 싫은 것은 다르다. 무서운 동작을 빼 버리면 영영 못
   * 하게 되고, 그 부위는 영영 안 큰다.
   */
  function startCoaching(exercise) {
    state.exclusions = E.addExclusion(state.exclusions, {
      exerciseId: exercise.id, reason: 'unsure', today: state.todayDate,
    });
    modal.close();
    rebuildSession();
    pushLog('배우는 중', '<b>' + exercise.name + '</b>' +
      particleOf(exercise.name, '은/는') + ' 빼지 않습니다. ' +
      Math.round(E.COACH_LOAD_RATIO * 100) + '% 무게로 ' + E.REVIEW_WEEKS +
      '주 해 보고, 그래도 아니면 그때 뺍니다.');
    render();
    openDemo(exercise);
  }

  /**
   * 진짜 빼기. 기간을 고르게 하고, 빠진 자리를 뭘로 채우는지 먼저 보여준다.
   *
   * 기본은 "당분간"이다. 영구를 기본으로 두면 한 번 힘들었던 날의 기분이
   * 프로그램에 영영 남는다.
   */
  function openExcludeConfirm(exercise) {
    var entry = currentGymEntry();
    var replacement = E.replacementFor(exercise, {
      excluded: excludedSet(),
      pool: gymPool(entry),
    });

    var body = [];
    body.push(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '빠진 자리는 이렇게 채웁니다' }),
      el('div', { text: replacement.text }),
    ]));

    var commit = function (forever) {
      state.exclusions = E.addExclusion(state.exclusions, {
        exerciseId: exercise.id, reason: 'dislike', today: state.todayDate, forever: forever,
      });
      shareSkipNow(exercise.id, 'dislike');
      modal.close();
      rebuildSession();
      pushLog('종목 빼기', '<b>' + exercise.name + '</b>' +
        particleOf(exercise.name, '을/를') + ' 뺐습니다. ' +
        (forever ? '다시 여쭤보지 않습니다.' : E.REVIEW_WEEKS + '주 뒤에 한 번 여쭤봅니다.'));
      render();
    };

    body.push(el('button', {
      type: 'button', class: 'finish',
      text: '당분간 빼기 (' + E.REVIEW_WEEKS + '주)',
      onclick: function () { commit(false); },
    }));
    body.push(el('button', {
      type: 'button', class: 'finish quiet',
      text: '영원히 빼기',
      onclick: function () { commit(true); },
    }));
    body.push(el('p', { class: 'hint-line', text:
      '당분간을 고르시면 ' + E.REVIEW_WEEKS + '주 뒤에 딱 한 번 여쭤봅니다. ' +
      '사람은 바뀝니다 — 어깨가 나으면 오버헤드를 다시 합니다.' }));

    openModal(exercise.name, '얼마나 뺄까요', body);
  }

  /**
   * 다시 여쭤보는 줄.
   *
   * 기간이 끝난 것을 슬그머니 되돌리지 않는다. 사용자가 뺀 것을 앱이 말없이
   * 되살리면, 그때부터 프로그램이 자기 것이 아니게 된다.
   */
  function excludeReviewCard() {
    var due = E.dueForReview(state.exclusions, state.todayDate);
    if (due.length === 0) return null;

    var item = due[0];
    var exercise = index.get(item.exerciseId);
    if (!exercise) return null;

    var after = function () { modal.close(); rebuildSession(); render(); };

    return el('button', {
      type: 'button', class: 'report-nudge',
      onclick: function () {
        openModal(exercise.name, E.REVIEW_WEEKS + '주가 지났습니다', [
          el('p', { class: 'asset-note', text: E.reviewQuestion(item, exercise) }),
          el('button', {
            type: 'button', class: 'finish', text: '다시 해볼게요',
            onclick: function () {
              state.exclusions = E.removeExclusion(state.exclusions, item.exerciseId);
              unshareSkipNow(item.exerciseId);
              pushLog('다시 넣기', '<b>' + exercise.name + '</b>' +
                particleOf(exercise.name, '을/를') + ' 다시 넣었습니다.');
              after();
            },
          }),
          el('button', {
            type: 'button', class: 'finish quiet', text: '계속 빼둘게요',
            onclick: function () {
              state.exclusions = E.keepExcluded(state.exclusions, item.exerciseId, state.todayDate);
              pushLog('종목 빼기', '<b>' + exercise.name + '</b>' +
                particleOf(exercise.name, '은/는') + ' 계속 뺍니다. ' +
                E.REVIEW_WEEKS + '주 뒤에 한 번 더 여쭤봅니다.');
              after();
            },
          }),
          el('button', {
            type: 'button', class: 'ghost', text: '다시는 여쭤보지 마세요',
            onclick: function () {
              state.exclusions = E.excludeForever(state.exclusions, item.exerciseId);
              pushLog('종목 빼기', '<b>' + exercise.name + '</b>' +
                particleOf(exercise.name, '은/는') + ' 이제 여쭤보지 않습니다.');
              after();
            },
          }),
        ]);
      },
    }, [
      el('span', { class: 'plan-main' }, [
        el('span', { class: 'name', text: exercise.name + ' — 다시 해보시겠어요?' }),
        el('span', { class: 'plan-sets', text: E.describeExclusion(item, state.todayDate) }),
      ]),
      el('span', { class: 'detail', text: '보기 ›' }),
    ]);
  }

  /**
   * 휴식 초를 정하는 줄.
   *
   * ±는 5초씩 움직인다 — 1초씩이면 1분을 고치는 데 예순 번을 눌러야 한다.
   * 초만 쓰면 150이 몇 분인지 암산해야 하므로 mm:ss를 옆에 같이 쓴다.
   */
  function restBox(label, seconds, onChange) {
    var set = function (next) { onChange(clamp(Math.round(next / 5) * 5, 10, 900)); };
    return el('div', { class: 'rest-box' }, [
      el('span', { class: 'rest-box-label' }, [
        el('span', { text: label }),
        el('span', { class: 'rest-box-clock', text: E.formatDuration(seconds) }),
      ]),
      el('div', { class: 'big-field small' }, [
        el('button', { type: 'button', class: 'nudge', text: '−',
          'aria-label': label + ' 휴식 5초 줄이기',
          onclick: function () { set(seconds - 5); } }),
        el('input', {
          type: 'number', min: '10', max: '900', step: '5', inputmode: 'numeric',
          class: 'big-input', value: String(seconds), 'aria-label': label + ' 휴식 (초)',
          onfocus: function (event) { event.target.select(); },
          onchange: function (event) {
            var next = parseInt(event.target.value, 10);
            set(Number.isFinite(next) ? next : seconds);
          },
        }),
        el('span', { class: 'big-unit', text: '초' }),
        el('button', { type: 'button', class: 'nudge', text: '+',
          'aria-label': label + ' 휴식 5초 늘리기',
          onclick: function () { set(seconds + 5); } }),
      ]),
    ]);
  }

  /** 이 종목의 휴식이 지금 몇 초인지 — 메뉴 줄에 그대로 쓴다. */
  function restOverrideHint(lift) {
    var fixed = state.restOverrides[lift.exercise.id];
    var seconds = E.restFor(restInput(lift, lift.sets[0] ? lift.sets[0].reps : 10, false)).seconds;
    return fixed != null
      ? '직접 정함 · ' + E.formatDuration(seconds)
      : '자동 ' + E.formatDuration(seconds) + ' · 직접 정할 수 있습니다';
  }

  /* ── 음성 카운트 ───────────────────────────────── */

  /*
   * 말하기.
   *
   * 브라우저 음성합성은 공짜지만 믿을 게 못 된다. 한국어 목소리가 아예
   * 없는 기기가 있고, iOS는 사용자가 뭔가 누르기 전에는 소리를 안 낸다.
   * 그래서 "되면 말하고, 안 되면 조용히 지나간다" — 소리 때문에 카운트가
   * 멈추면 안 된다. 박자는 화면이 들고 있다.
   */
  var voiceCache = null;

  function koreanVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (voiceCache !== null) return voiceCache;
    var voices = window.speechSynthesis.getVoices() || [];
    voiceCache = voices.filter(function (voice) {
      return /^ko/i.test(voice.lang || '');
    })[0] || null;
    return voiceCache;
  }

  function speak(text) {
    // PT 모드는 말하는 모드다. 소리 스위치를 따로 켜게 하면 켠 사람이 또 켜야 한다.
    if ((!state.voiceOn && !ptOn()) || !('speechSynthesis' in window)) return;
    try {
      var utter = new SpeechSynthesisUtterance(text);
      var voice = koreanVoice();
      if (voice) utter.voice = voice;
      utter.lang = 'ko-KR';
      // 카운트는 조금 빨라야 박자에 맞는다. 설명하듯 읽으면 늦는다.
      utter.rate = clamp(state.voiceRate || 1, 0.5, 2);
      window.speechSynthesis.speak(utter);
    } catch (err) {
      void err;
    }
  }

  /* ── PT 모드 ───────────────────────────────────── */

  /** 서버가 있는데 로그인이 안 됐는가. 그러면 앱을 쓰기 전에 로그인부터 한다. */
  function loginRequired() {
    return typeof Remote !== 'undefined' && Remote.configured() && !Remote.signedIn();
  }

  var meButton = document.getElementById('me-btn');
  if (meButton) {
    meButton.addEventListener('click', function () {
      state.tab = state.tab === 'me' ? 'today' : 'me';
      if (modal.open) modal.close();
      render();
    });
  }

  function ptOn() {
    return Boolean(state.coach && state.coach.mode === 'pt');
  }

  /**
   * 코치가 말한다 — 소리와 화면 둘 다.
   *
   * 소리만 내면 소리가 안 나는 기기(무음 모드, 이어폰 빠짐)에서는 아무
   * 일도 없는 것처럼 보인다. 화면에도 같은 말을 띄운다.
   */
  function coachSay(lines) {
    var text = (lines || []).filter(Boolean).join(' ');
    if (!text) return '';
    state.coachLine = text;
    var bubble = document.getElementById('coach-say');
    if (bubble) bubble.textContent = text;
    speak(E.forSpeech(text));
    return text;
  }

  function coachScope(lift) {
    return { gymId: activeGymId(), machine: state.machinePick[lift.exercise.id] };
  }

  function settingKeyFor(lift) {
    return E.settingKey(activeGymId(), lift.exercise.id, state.machinePick[lift.exercise.id]);
  }

  /** 이 종목을 해 본 적이 있는가 — 어느 헬스장이든. 처음이면 사용법부터 말한다. */
  function triedBefore(exercise) {
    return state.history.some(function (session) {
      return session.date < state.todayDate && session.sets.some(function (set) {
        return set.exerciseId === exercise.id && !set.warmup && set.reps > 0;
      });
    });
  }

  /** 세트 전에 하는 말. 이미 한 자리면 다시 하지 않는다. */
  function coachBefore(liftIndex, setIndex) {
    var key = liftIndex + ':' + setIndex + ':before';
    if (state.coachSaid[key]) return '';
    state.coachSaid[key] = true;

    var lift = state.lifts[liftIndex];
    var set = lift && lift.sets[setIndex];
    if (!set) return '';
    var demo = E.demoFor(lift.exercise);
    var first = !triedBefore(lift.exercise);
    return coachSay(E.beforeSetLines({
      style: state.coach.style,
      exerciseName: lift.exercise.name,
      setIndex: setIndex,
      totalSets: lift.sets.length,
      weightKg: set.weightKg,
      pounds: inPounds(lift.exercise.id),
      repsMin: set.targetReps.min,
      repsMax: set.targetReps.max,
      targetRir: typeof set.targetRir === 'number' ? set.targetRir : lift.targetRir,
      last: E.lastTimeFor(state.history, lift.exercise, state.todayDate, coachScope(lift)),
      cues: demo ? demo.cues : [],
      firstTime: first,
      setup: first ? E.setupFor(lift.exercise) : [],
      machineSetting: state.machineSettings[settingKeyFor(lift)] || null,
      liftIndex: liftIndex,
    }));
  }

  /**
   * 무게 체감으로 세트를 마친다.
   *
   * 체감을 남은 횟수로 바꿔 기존 completeSet에 넘긴다 — 기록 형식도
   * 다음 무게 계산도 혼자 모드와 똑같다. 말만 다르다.
   */
  function finishByFeel(liftIndex, setIndex, feel) {
    var lift = state.lifts[liftIndex];
    var set = lift.sets[setIndex];
    var target = typeof set.targetRir === 'number' ? set.targetRir : lift.targetRir;
    var reps = set.reps;
    var weight = set.weightKg;

    if (feel === 'hurt') return stopForPain(liftIndex, setIndex, target);

    completeSet(liftIndex, setIndex, E.feelToRir(feel, target));
    coachAfter(liftIndex, setIndex, feel, weight, reps);
  }

  function coachAfter(liftIndex, setIndex, feel, weight, reps) {
    if (!ptOn()) return;
    var lift = state.lifts[liftIndex];
    var next = lift.sets[setIndex + 1];
    var remaining = lift.sets.filter(function (item) { return !item.done; }).length;
    var decision = lift.decision;
    var stopEarly = decision && decision.verdict === 'stop' && remaining > 0;
    var more = decision && decision.verdict === 'continue';

    var lines = E.afterSetLines({
      style: state.coach.style,
      feel: feel || 'right',
      lastOfLift: remaining === 0 && !more,
      nextWeightKg: next ? next.weightKg : undefined,
      deltaKg: next && next.adjustment ? next.adjustment.deltaKg : 0,
      pounds: inPounds(lift.exercise.id),
      stopReason: stopEarly ? decision.reason : null,
      growth: E.growthAt(state.history, lift.exercise, state.todayDate, weight, reps, coachScope(lift)),
      setsDone: lift.sets.filter(function (item) { return item.done; }).length,
    });
    if (allSetsDone()) lines = lines.concat(coachWrapUp());
    coachSay(lines);
  }

  /**
   * 아프다고 했다.
   *
   * 그 세트는 목표 강도로 적는다 — 아파서 멈춘 세트로 다음 무게를 움직이면
   * 안 된다. 남은 세트는 지우고 다음 종목으로 넘어간다. 빡센 트레이너도
   * 여기서는 밀지 않는다.
   */
  function stopForPain(liftIndex, setIndex, target) {
    var lift = state.lifts[liftIndex];
    completeSet(liftIndex, setIndex, target);
    lift.sets = lift.sets.filter(function (item) { return item.done; });
    lift.decision = null;
    if (state.rest) stopRest();
    pushLog('통증', '<b>' + lift.exercise.name + '</b> — 아프다고 하셔서 남은 세트를 뺐습니다.');
    var next = state.lifts.findIndex(function (item, at) {
      return at > liftIndex && item.sets.some(function (one) { return !one.done; });
    });
    if (next >= 0) {
      state.liftCursor = next;
      /*
       * 다음 종목을 저절로 시작하지 않는다.
       *
       * "아프다"는 말 바로 뒤에 "오늘 인생을 갈아 넣는다는 느낌으로!"가
       * 나오면 그건 트레이너가 아니다. 트레이너는 거기서 멈추고 괜찮은지
       * 본다. 준비되면 ▶를 누르게 한다 — 그때 세트 전 말을 한다.
       */
      var firstOpen = state.lifts[next].sets.findIndex(function (one) { return !one.done; });
      state.autoCountedFor = next + ':' + Math.max(0, firstOpen);
    }
    coachSay(E.afterSetLines({ style: state.coach.style, feel: 'hurt', lastOfLift: true }).concat(
      next >= 0 ? ['괜찮아지시면 다음 종목에서 시작을 눌러 주세요.'] : []));
    render();
  }

  /** 오늘 끝. 늘어난 종목과 총량을 센다. */
  function coachWrapUp() {
    var key = 'wrap:' + state.todayDate;
    if (state.coachSaid[key]) return [];
    state.coachSaid[key] = true;
    var grew = 0;
    var liftsDone = 0;
    state.lifts.forEach(function (lift) {
      var done = lift.sets.filter(function (set) { return set.done; });
      if (done.length === 0) return;
      liftsDone += 1;
      var top = done.reduce(function (best, set) {
        return set.weightKg > best.weightKg || (set.weightKg === best.weightKg && set.reps > best.reps) ? set : best;
      });
      var last = E.lastTimeFor(state.history, lift.exercise, state.todayDate, coachScope(lift));
      if (last && (top.weightKg > last.weightKg || (top.weightKg === last.weightKg && top.reps > last.reps))) grew += 1;
    });
    var volume = state.todaySets.reduce(function (sum, set) {
      return sum + (set.warmup ? 0 : set.weightKg * set.reps);
    }, 0);
    return E.wrapUpLines({
      style: state.coach.style,
      setsDone: state.todaySets.length,
      liftsDone: liftsDone,
      grew: grew,
      volumeKg: volume,
    });
  }

  /** 쉬는 동안 — 중간에 한마디, 10초 전에 한마디. 각각 한 번만. */
  function coachDuringRest(remaining) {
    if (!ptOn() || !state.rest) return;
    var rest = state.rest;
    if (!rest.tipSaid && rest.total >= E.TIP_MIN_REST_SECONDS && remaining <= rest.total / 2) {
      rest.tipSaid = true;
      coachSay([E.restTipLine(state.coach.style, rest.setNumber)]);
    }
    if (!rest.readySaid && remaining <= 10 && remaining > 0 && rest.total > 15) {
      rest.readySaid = true;
      coachSay([E.readySoonLine(state.coach.style)]);
    }
  }

  /**
   * 오늘 어떻게 할까요 — 혼자 / PT.
   *
   * 시작 버튼 바로 위에 둔다. 설정 화면에 넣으면 아무도 모른다(소리
   * 스위치가 그랬다). 말투를 누르면 그 말투로 한마디 들려준다 — 고르는
   * 데 그게 제일 빠르고, iOS는 손으로 누른 순간에 한 번 소리를 내야
   * 그 뒤에도 말할 수 있다.
   */
  function coachPicker() {
    var pt = ptOn();
    var box = el('div', { class: 'sheet coach-pick' }, []);
    box.appendChild(el('div', { class: 'sheet-head' }, [
      el('h3', { text: '오늘 어떻게 할까요?' }),
    ]));
    var body = el('div', { class: 'sheet-body' }, []);
    var modes = el('div', { class: 'coach-modes', role: 'group', 'aria-label': '운동 방식' }, [
      el('button', {
        type: 'button', class: 'coach-mode', 'aria-pressed': String(!pt),
        onclick: function () {
          state.coach = { mode: 'solo', style: state.coach.style };
          releaseWakeLock();
          persist();
          render();
        },
      }, [
        el('b', { text: '혼자' }),
        el('span', { text: '처방과 기록만, 조용히' }),
      ]),
      el('button', {
        type: 'button', class: 'coach-mode', 'aria-pressed': String(pt),
        onclick: function () {
          state.coach = { mode: 'pt', style: state.coach.style || 'calm' };
          persist();
          speak(E.forSpeech(E.coachStyleInfo(state.coach.style).sample));
          render();
        },
      }, [
        el('b', { text: 'PT' }),
        el('span', { text: '옆에서 세어 주고 말해 줍니다' }),
      ]),
    ]);
    body.appendChild(modes);

    if (pt) {
      var styles = el('div', { class: 'coach-styles' }, []);
      E.COACH_STYLES.forEach(function (item) {
        var on = state.coach.style === item.id;
        styles.appendChild(el('button', {
          type: 'button', class: 'coach-style', 'aria-pressed': String(on),
          onclick: function () {
            state.coach = { mode: 'pt', style: item.id };
            persist();
            speak(E.forSpeech(item.sample));
            render();
          },
        }, [
          el('b', { text: item.label }),
          el('span', { text: item.hint }),
        ]));
      });
      body.appendChild(styles);
      body.appendChild(el('p', { class: 'hint-line', text:
        '세트 전에 지난 기록과 오늘 목표를 말하고, 박자를 세고, 끝나면 무게가 어땠는지 묻습니다. ' +
        '운동하는 동안 화면은 켜 둡니다.' }));
    }
    box.appendChild(body);
    return box;
  }

  function tempoOf() {
    return state.tempo || E.DEFAULT_TEMPO;
  }

  /** 세는 중이면 멈춘다. 화면을 떠날 때도 반드시 불러야 한다. */
  function stopCounting(keepReps, silent) {
    var run = state.counting;
    if (!run) return;
    run.timers.forEach(function (id) { clearTimeout(id); });
    state.counting = null;
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (err) { void err; }
    }

    /*
     * 멈춘 자리까지를 기록으로 제안한다. 앱은 실제 반복을 못 봤으므로
     * 이건 "제안"이고, 숫자칸은 그대로 고칠 수 있게 둔다.
     */
    var asked = false;
    if (keepReps !== false && run.rep > 0) {
      var lift = state.lifts[run.liftIndex];
      var set = lift && lift.sets[run.setIndex];
      if (set && !set.done) set.reps = run.rep;
      // 트레이너는 세트가 끝나면 묻는다. 버튼을 찾게 두지 않는다.
      asked = Boolean(ptOn() && !silent && set && !set.done);
      if (asked) coachSay([E.askFeelLine(state.coach.style)]);
    }
    render();
    /*
     * 물었으면 답할 버튼을 눈앞에 둔다. 묻기만 하고 버튼이 화면 아래에
     * 있으면, 땀난 손으로 스크롤부터 해야 한다.
     */
    if (asked) {
      var row = document.querySelector('.feel-row');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /**
   * 저절로 시작할 때 주는 준비 시간.
   *
   * 손으로 누를 때는 3초면 된다 — 이미 바 앞에 서서 누른 것이기 때문이다.
   * 저절로 시작하는 카운트는 그렇지 않다. 앉아 있다가, 물 마시다가,
   * 원판 갈다가 시작된다. 랙에서 바를 빼기 전에 "하나"가 나가면 그 세트는
   * 내내 박자가 어긋나고, 어긋난 박자는 없느니만 못하다.
   */
  var AUTO_LEAD_SECONDS = 8;

  /**
   * 세는 중의 큰 숫자와 그 아래 한마디.
   *
   * 전체를 다시 그리지 않고 두 칸만 바꾼다 — 세트 중에 화면이 통째로
   * 깜빡이면 숫자를 놓친다.
   *
   * '준비 8'처럼 글자가 길어질 때는 작게 쓴다. 76px 그대로 두면 화면
   * 밖으로 나가서, 정작 기다리라는 그 숫자가 안 보인다.
   */
  function showCount(big, word) {
    var box = document.getElementById('count-now');
    if (box) {
      box.textContent = big;
      box.classList.toggle('wide', big.length > 2);
    }
    var say = document.getElementById('count-say');
    if (say) say.textContent = word;
  }

  function startCounting(liftIndex, setIndex, leadSeconds) {
    stopCounting(false);
    var lift = state.lifts[liftIndex];
    var set = lift && lift.sets[setIndex];
    if (!set) return;

    var lead = typeof leadSeconds === 'number' ? leadSeconds : 3;
    var input = { repRange: set.targetReps, tempo: tempoOf(), leadInSeconds: lead };
    var cues = E.buildCues(input);
    var run = { liftIndex: liftIndex, setIndex: setIndex, rep: 0, timers: [], startedAt: Date.now() };
    state.counting = run;

    /*
     * 준비 시간을 세어 보여 준다.
     *
     * 안 그러면 화면이 "준비"에서 멈춰 있다. 언제 시작하는지 모르는 채로
     * 8초를 보는 것은 고장난 화면을 보는 것과 같다.
     *
     * 그리고 **"시작"은 준비가 끝나는 자리로 옮긴다.** 엔진은 0초에
     * "시작"을 넣어 두는데, 화면은 8초를 세고 있는데 소리는 벌써
     * 시작이라고 하면 둘 중 하나를 믿어야 한다. 셋 다 같은 순간을 가리키게
     * 맞춘다 — 준비 1 다음이 시작이고, 그다음이 하나다.
     */
    for (var left = lead; left > 0; left -= 1) {
      (function (remaining) {
        run.timers.push(setTimeout(function () {
          if (state.counting !== run) return;
          showCount('준비 ' + remaining, '');
        }, (lead - remaining) * 1000));
      })(left);
    }
    run.timers.push(setTimeout(function () {
      if (state.counting !== run) return;
      showCount('시작', '');
      speak('시작');
    }, lead * 1000));

    cues.forEach(function (cue) {
      // 0번 신호("시작")는 준비가 끝나는 자리에서 이미 내보냈다.
      if (cue.rep === 0) return;
      run.timers.push(setTimeout(function () {
        if (state.counting !== run) return;
        run.rep = cue.rep;
        speak(cue.say);
        // 끝나기 두 개 전. 숫자 사이에 들어가야 해서 짧은 말만 한다.
        if (ptOn() && set.targetReps.max >= 5 && cue.rep === set.targetReps.max - 2) {
          speak(E.forSpeech(E.pushLine(state.coach.style)));
        }
        // 화면의 숫자도 같이 올라간다 — 소리가 안 나는 기기에서도 세어진다.
        showCount(String(cue.rep), cue.say);
        if (cue.rep >= set.targetReps.max) {
          run.timers.push(setTimeout(function () {
            if (state.counting === run) stopCounting(true);
          }, 700));
        }
      }, cue.atMs));
    });

    render();
  }

  /**
   * 세어 주기 판 — 시작 버튼, 속도, 세트마다 자동.
   *
   * 셋 다 여기 둔다. 속도와 자동은 원래 설정 모달 안에 있었는데, 거기
   * 있다는 걸 아무도 몰랐다. 쓰는 자리에 없는 설정은 없는 설정이다.
   */
  function countPanel(liftIndex, setIndex) {
    var tempo = tempoOf();
    var speed = E.speedOf(tempo);
    var box = el('div', { class: 'count-panel' }, []);

    box.appendChild(el('button', {
      type: 'button', class: 'count-start',
      title: '한 회에 ' + E.repSeconds(tempo) + '초로 세어 줍니다 (' + E.tempoLabel(tempo) + ')',
      onclick: function () {
        // 손으로 시작해도 PT면 세트 전 말을 먼저 하고, 그 길이만큼 기다린다.
        var said = ptOn() ? coachBefore(liftIndex, setIndex) : '';
        startCounting(liftIndex, setIndex,
          said ? Math.max(3, Math.ceil(E.speechSeconds(said)) + 2) : undefined);
      },
    }, [
      el('span', { class: 'count-play', text: '▶', 'aria-hidden': 'true' }),
      el('span', { text: '박자 맞춰 세어주기' }),
      el('span', { class: 'count-tempo', text: '한 회 ' + E.repSeconds(tempo) + '초' }),
    ]));

    /*
     * 속도는 초로 줄 세운 축이다. 유튜브 배속과 다른 점이 하나 있다 —
     * 배속은 같은 것을 빨리 돌리는 것이지만, 여기서는 **다른 세트가 된다.**
     * 그래서 고를 때 그 말을 같이 띄운다.
     */
    var speeds = el('div', { class: 'count-speed' }, [
      el('span', { class: 'rir-label', text: '속도' }),
    ]);
    E.TEMPO_SPEEDS.forEach(function (item) {
      var on = speed === item.id;
      speeds.appendChild(el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(on),
        title: item.note,
        text: item.label,
        onclick: function () {
          state.tempo = item.tempo;
          pushLog('템포', '<b>' + item.label + '</b> · 한 회 ' +
            E.repSeconds(item.tempo) + '초 — ' + item.note);
          persist();
          render();
        },
      }));
    });
    /*
     * 어느 속도에도 안 맞으면(멈췄다 같은 것) 아무것도 켜지 않고, 대신
     * 지금 템포를 적어 둔다. 가까운 것을 켜 주면 사용자가 정한 템포가
     * 조용히 바뀐 것처럼 보인다.
     */
    if (!speed) speeds.appendChild(el('span', { class: 'count-tempo', text: E.tempoLabel(tempo) }));
    box.appendChild(speeds);

    /*
     * 세트마다 자동.
     *
     * 여섯 세트면 ▶를 여섯 번 누른다. 그 여섯 번이 전부 **바벨을 잡기
     * 직전**에 온다 — 제일 누르기 싫은 순간이다.
     *
     * 켜면 휴식이 끝나고 준비 시간을 준 뒤 저절로 시작한다. 준비 시간을
     * 길게 잡는 이유는, 저절로 시작하는 카운트는 랙에서 바를 빼기 전에
     * 이미 "하나"를 세고 있으면 그 세트 내내 박자가 어긋나기 때문이다.
     */
    var auto = Boolean(state.autoCount);
    var toggles = el('div', { class: 'count-toggles' }, []);

    /*
     * 소리를 여기에 둔다.
     *
     * "박자 맞춰 세어주기"를 누른 사람은 **목소리를 기대한다.** 그런데
     * 소리는 기본이 꺼짐이고, 켜는 자리가 설정 모달 안에 있었다. 화면
     * 숫자만 올라가는 것을 보고 고장난 줄 안다. 속도와 자동을 여기로
     * 내리면서 소리만 두고 온 것이 잘못이었다.
     *
     * 켜는 순간 한마디 읽는다. 보기 좋으라고가 아니라 **iOS 때문이다** —
     * 손으로 누른 그 순간에 한 번 소리를 내지 않으면, 그 뒤로는 앱이
     * 말하려 해도 브라우저가 막는다.
     */
    var voice = Boolean(state.voiceOn);
    var canSpeak = 'speechSynthesis' in window;
    toggles.appendChild(el('button', {
      type: 'button', class: 'count-auto', 'aria-pressed': String(voice && canSpeak),
      disabled: canSpeak ? null : '',
      title: canSpeak
        ? (voice ? '끄면 화면 숫자로만 셉니다' : '켜면 목소리로 세어 줍니다')
        : '이 기기는 말하기를 지원하지 않습니다. 화면 숫자로 셉니다.',
      onclick: function () {
        state.voiceOn = !voice;
        if (state.voiceOn) speak('하나');
        persist();
        render();
      },
    }, [
      el('span', { text: '소리' }),
      el('span', { class: 'count-tempo', text: !canSpeak ? '안 됨' : voice ? '켜짐' : '꺼짐' }),
    ]));

    toggles.appendChild(el('button', {
      type: 'button', class: 'count-auto', 'aria-pressed': String(auto),
      title: auto ? '끄면 ▶를 누를 때만 셉니다' : '켜면 세트마다 저절로 시작합니다',
      onclick: function () {
        state.autoCount = !auto;
        if (!state.autoCount) stopCounting(false);
        /*
         * 켜는 순간 지금 세트를 시작하지 않는다.
         *
         * 스위치를 켠 사람은 화면을 보고 있지, 바를 잡고 있지 않다. 켜자마자
         * 등 뒤에서 카운트가 돌면 그 세트는 버린 세트가 된다. **다음
         * 세트부터** 적용한다 — 지금 세고 싶으면 ▶가 바로 위에 있다.
         */
        state.autoCountedFor = liftIndex + ':' + setIndex;
        persist();
        render();
      },
    }, [
      el('span', { text: '세트마다 자동' }),
      el('span', { class: 'count-tempo', text: auto ? '켜짐' : '꺼짐' }),
    ]));

    box.appendChild(toggles);
    if (auto) {
      box.appendChild(el('p', { class: 'hint-line', text:
        '휴식이 끝나면 준비 ' + AUTO_LEAD_SECONDS + '초를 세고 저절로 시작합니다.' }));
    }

    return box;
  }

  /** 지금 세는 중인 세트의 화면. 숫자가 크고, 멈추는 버튼 하나뿐이다. */
  function renderCounting(liftIndex, setIndex) {
    var run = state.counting;
    var live = run && run.liftIndex === liftIndex && run.setIndex === setIndex;
    if (!live) return null;

    return el('div', { class: 'count-live' }, [
      el('div', { class: 'count-num' }, [
        el('b', { id: 'count-now', text: run.rep > 0 ? String(run.rep) : '준비' }),
        el('span', { id: 'count-say', text: '' }),
      ]),
      el('button', {
        type: 'button', class: 'finish quiet', text: '멈추기',
        onclick: function () { stopCounting(true); },
      }),
    ]);
  }

  /**
   * 음성 카운트 설정.
   *
   * 템포를 여기서 정한다. 템포는 같은 10회를 다른 10회로 만드는 값이라
   * 소리를 끄고 써도 뜻이 있다 — 화면 숫자만으로도 박자는 잡힌다.
   */
  function openVoiceSettings() {
    var draw = function () {
      var tempo = tempoOf();
      var body = [];

      body.push(el('p', { class: 'asset-note', text:
        '옆에서 세어 주는 사람이 하는 일의 절반이 박자입니다. 힘들어지면 저절로 빨라지고, ' +
        '빨라지면 반동이 붙어서 같은 10회가 다른 10회가 됩니다. ' +
        '앱은 실제 반복을 보지 못하므로 박자만 주고, 멈춘 자리를 기록으로 제안합니다.' }));

      body.push(el('button', {
        type: 'button', class: 'pair-row', onclick: function () {
          state.voiceOn = !state.voiceOn;
          if (state.voiceOn) speak('하나');
          persist();
          draw();
        },
      }, [
        el('span', { class: 'pair-mark', text: state.voiceOn ? '켜짐' : '꺼짐' }),
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: '소리로 세어 주기' }),
          el('span', { class: 'plan-sets', text: voiceStatusLine() }),
        ]),
      ]));

      body.push(el('div', { class: 'list-label', text: '템포 — 내리고 · 멈추고 · 올리고 · 멈추고' }));
      body.push(el('div', { class: 'chip-row' }, E.TEMPO_PRESETS.map(function (preset) {
        var on = E.tempoLabel(preset.tempo) === E.tempoLabel(tempo);
        return el('button', {
          type: 'button', class: 'pick', 'aria-pressed': String(on),
          title: preset.note,
          text: preset.label + ' ' + E.tempoLabel(preset.tempo),
          onclick: function () {
            state.tempo = preset.tempo;
            pushLog('템포', '<b>' + preset.label + '</b> ' + E.tempoLabel(preset.tempo) +
              ' — ' + preset.note);
            persist();
            draw();
          },
        });
      })));

      var seconds = E.repSeconds(tempo);
      body.push(el('p', { class: 'hint-line', text:
        '반복 하나에 ' + seconds + '초 · 10회면 ' + Math.round(seconds * 10) + '초짜리 세트입니다.' }));

      body.push(el('div', { class: 'list-label', text: '말 속도' }));
      body.push(el('div', { class: 'chip-row' }, [
        { label: '느리게', rate: 0.85 },
        { label: '보통', rate: 1 },
        { label: '빠르게', rate: 1.2 },
      ].map(function (option) {
        return el('button', {
          type: 'button', class: 'pick',
          'aria-pressed': String(Math.abs((state.voiceRate || 1) - option.rate) < 0.01),
          text: option.label,
          onclick: function () {
            state.voiceRate = option.rate;
            speak('하나, 둘, 셋');
            persist();
            draw();
          },
        });
      })));

      body.push(el('button', {
        type: 'button', class: 'finish', text: '이대로 하기',
        onclick: function () { modal.close(); render(); },
      }));

      openModal('세어 주기', state.voiceOn ? '켜짐 · ' + E.tempoLabel(tempo) : E.tempoLabel(tempo), body);
    };
    draw();
  }

  /** 이 기기에서 소리가 실제로 날지 — 안 되면 미리 말해 준다. */
  function voiceStatusLine() {
    if (!('speechSynthesis' in window)) {
      return '이 브라우저는 음성합성을 지원하지 않습니다 · 화면 숫자로만 셉니다';
    }
    if (!koreanVoice()) {
      return '한국어 목소리가 없는 기기입니다 · 화면 숫자로만 셉니다';
    }
    return state.voiceOn ? '세트마다 세어 줍니다' : '눌러서 켭니다';
  }

  /**
   * 휴식 시간 설정.
   *
   * 숫자 하나가 아니라 **띠**를 받는다. "휴식 90초"로 고정하면 데드리프트도
   * 90초, 레그 익스텐션도 90초가 된다 — 그건 휴식을 관리하는 게 아니라
   * 안 하는 것이다. 띠를 주면 어느 종목을 띠의 어디에 둘지는 계산이 맡고,
   * 전체를 길게 갈지 짧게 갈지는 사람이 정한다.
   *
   * 그래도 "이 종목만은 3분"이 있는 법이라, 종목별로 못 박는 길도 연다.
   */
  function openRestSettings(focusExerciseId) {
    var draw = function () {
      var band = E.normalizeBand(state.restBand);
      var body = [];

      body.push(el('p', { class: 'asset-note', text:
        '휴식 범위를 정하면, 그 안에서 어느 종목을 얼마나 쉴지는 앱이 정합니다. ' +
        '데드리프트는 위쪽, 고립 운동은 아래쪽입니다 — 한 숫자로 고정하면 둘이 같아집니다.' }));

      // 미리 준비된 띠
      var presets = el('div', { class: 'chip-row' }, E.REST_PRESETS.map(function (preset) {
        var on = preset.band.minSeconds === band.minSeconds && preset.band.maxSeconds === band.maxSeconds;
        return el('button', {
          type: 'button', class: 'pick', 'aria-pressed': String(on),
          title: preset.note,
          text: preset.label + ' ' + E.describeBand(preset.band),
          onclick: function () {
            state.restBand = { minSeconds: preset.band.minSeconds, maxSeconds: preset.band.maxSeconds };
            rebuildSession();
            pushLog('휴식', '<b>' + preset.label + '</b> ' + E.describeBand(preset.band) + ' — ' + preset.note);
            render();
            draw();
          },
        });
      }));
      body.push(el('div', { class: 'sheet-body tight rest-presets' }, [presets]));

      // 직접 치기
      body.push(el('div', { class: 'rest-range' }, [
        restBox('가장 짧게', band.minSeconds, function (value) {
          state.restBand = E.normalizeBand({ minSeconds: value, maxSeconds: band.maxSeconds });
          rebuildSession(); render(); draw();
        }),
        restBox('가장 길게', band.maxSeconds, function (value) {
          state.restBand = E.normalizeBand({ minSeconds: band.minSeconds, maxSeconds: value });
          rebuildSession(); render(); draw();
        }),
      ]));

      /*
       * 오늘 종목에 실제로 몇 초가 붙는지 바로 보여준다. 띠만 보여주면
       * "1분 30초~2분 30초"가 내 벤치에 몇 초인지 알 수가 없다.
       */
      body.push(el('div', { class: 'list-label', text: '오늘 종목에 붙는 휴식' }));
      body.push(el('div', { class: 'summary-list' }, state.lifts.map(function (lift) {
        var fixed = state.restOverrides[lift.exercise.id];
        var seconds = E.restFor(restInput(lift, lift.sets[0] ? lift.sets[0].reps : 10, false)).seconds;
        return el('div', { class: 'rest-row' + (lift.exercise.id === focusExerciseId ? ' focus' : '') }, [
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'name', text: lift.exercise.name }),
            el('span', { class: 'plan-sets', text: fixed != null ? '직접 정함' : '자동' }),
          ]),
          el('span', { class: 'rest-value', text: E.formatDuration(seconds) }),
          el('button', {
            type: 'button', class: 'demo-open',
            text: fixed != null ? '자동으로' : '직접',
            'aria-label': lift.exercise.name + (fixed != null ? ' 휴식을 자동으로 되돌리기' : ' 휴식 직접 정하기'),
            onclick: function () {
              if (fixed != null) {
                delete state.restOverrides[lift.exercise.id];
                pushLog('휴식', '<b>' + lift.exercise.name + '</b> 휴식을 자동으로 되돌렸습니다.');
              } else {
                state.restOverrides[lift.exercise.id] = seconds;
              }
              rebuildSession(); render(); draw();
            },
          }),
        ]);
      })));

      // 직접 정한 종목만 숫자칸을 연다 — 전부 열면 화면이 숫자칸 밭이 된다
      state.lifts.forEach(function (lift) {
        var fixed = state.restOverrides[lift.exercise.id];
        if (fixed == null) return;
        body.push(restBox(lift.exercise.name, fixed, function (value) {
          state.restOverrides[lift.exercise.id] = value;
          rebuildSession(); render(); draw();
        }));
      });

      /*
       * 휴식을 늘리면 같은 시간에 들어가는 종목이 준다. 이건 숨기면 안 된다 —
       * 종목이 조용히 사라지면 앱이 마음대로 바꾼 것처럼 보인다.
       */
      var estimate = E.estimateSessionTime(state.session, {
        restMultiplier: E.styleProfile(state.style).restMultiplier,
        restBand: state.restBand || undefined,
        restOverrides: state.restOverrides,
      });
      body.push(el('p', { class: 'hint-line', text:
        '지금 설정으로 오늘 ' + state.lifts.length + '종목 · 약 ' +
        Math.round(estimate.totalSeconds / 60) + '분' +
        (state.timeBudget ? ' (예산 ' + state.timeBudget + '분)' : '') }));

      if (state.restBand || Object.keys(state.restOverrides).length > 0) {
        body.push(el('button', {
          type: 'button', class: 'demo-open wide', text: '기본값으로 되돌리기',
          onclick: function () {
            state.restBand = null;
            state.restOverrides = {};
            rebuildSession();
            pushLog('휴식', '기본 띠(1:00~1:30)로 되돌렸습니다.');
            render();
            draw();
          },
        }));
      }

      body.push(el('button', {
        type: 'button', class: 'finish', text: '이대로 하기',
        onclick: function () { modal.close(); render(); },
      }));

      openModal('휴식 시간', E.describeBand(band), body);
    };
    draw();
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
    var currentSet = null;
    for (var c = 0; c < lift.sets.length; c += 1) {
      if (!lift.sets[c].done) { currentSet = lift.sets[c]; break; }
    }

    /*
     * 머리띠는 "몇 번째 종목인가"와 시계만 든다. 한 줄이어야 한다 —
     * 두 줄이 되는 순간 그만큼 카드가 아래로 밀리고, 화면이 짧은 폰에서는
     * 정작 눌러야 할 RIR 버튼이 화면 밖으로 나간다.
     *
     * 세트 번호와 그 세트의 처방은 카드가 크게 말한다. 거기가 눈이 가는
     * 자리이고, 기록할 때마다 그 자리를 머리띠 바로 밑으로 끌어온다.
     */
    void currentSet;
    void doneHere;

    screen.appendChild(el('div', { class: 'progress-head' }, [
      el('div', { class: 'progress-top' }, [
        el('button', {
          type: 'button', class: 'demo-open', text: '목록',
          'aria-label': '오늘 할 것 목록으로',
          onclick: function () { state.started = false; render(); },
        }),
        el('span', { class: 'progress-count' }, [
          el('i', { text: '종목' }),
          el('b', { text: String(position) }),
          el('span', { text: '/ ' + total }),
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
    /*
     * 마지막 종목에서 "← 이전 종목" 하나만 덜렁 남아 있었다.
     *
     * 화면에 버튼이 그것뿐이면 그게 다음 행동으로 읽힌다 — "종목 6/6인데
     * 왜 이전이냐"가 나온 이유다. 앞으로 갈 곳이 없으면 없다고 쓰고,
     * 대신 지금 해야 할 일(세트가 남았다 / 끝낼 수 있다)을 말한다.
     */
    var forward = last
      ? null
      : el('button', {
          /* 세트가 남았는데 넘어가는 것도 막지 않는다 — 기구가 막혀서
             순서를 바꾸는 일이 헬스장에서는 늘 있다. 다만 티는 낸다. */
          type: 'button',
          class: remaining === 0 ? 'primary' : 'ghost',
          text: remaining === 0 ? '다음 종목' : '다음 종목 (' + remaining + '세트 남음)',
          onclick: function () { state.liftCursor += 1; render(); },
        });

    var nav = el('div', { class: 'step-nav' + (finished ? ' done' : '') + (last ? ' last' : '') }, [
      state.liftCursor > 0
        ? el('button', {
            /* "이전"만 있으면 세트 얘긴지 종목 얘긴지 모른다. "다음 종목"과 짝을 맞춘다. */
            type: 'button', class: 'ghost', text: '← 이전 종목',
            onclick: function () { state.liftCursor -= 1; render(); },
          })
        : null,
      forward,
      last && !finished
        ? el('span', { class: 'step-state', text:
            remaining > 0
              ? '마지막 종목입니다 · ' + remaining + '세트 남으면 오늘이 끝납니다'
              : '마지막 종목을 마쳤습니다 · 남은 종목이 있습니다' })
        : null,
    ]);
    if (nav.childNodes.length > 0) screen.appendChild(nav);

    /*
     * 마지막 종목인데 아직 다 못 채웠을 때도 끝낼 길은 열어 둔다.
     * 시간이 없어 중간에 나가는 날이 실제로 있고, 그때 길이 없으면
     * 기록을 통째로 버리고 나간다.
     */
    if (last && !finished && state.todaySets.length > 0) renderFinish(true);

    // 다 했는데 더 하고 싶은 날. 끝내기 버튼 옆에 조용히 둔다.
    if (finished) {
      screen.appendChild(el('button', {
        type: 'button', class: 'finish quiet', text: '다른 운동 더 하기',
        onclick: openAddLift,
      }));
    }

    /*
     * 완료 버튼이 컨디셔닝·맥스테스트 시트 아래에 묻혀 있었다. 다 끝냈는데
     * 다음 행동이 스크롤 두 번 아래에 있으면 "아무 일도 안 일어난다"로
     * 읽힌다. 끝났으면 이게 제일 먼저 와야 한다.
     */
    if (finished) renderFinish(false);

    if (last) {
      renderMaxTest();
      renderCardio();
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
     * 점은 "이번 세트" 줄 안으로 들어갔다 — 같은 이야기를 두 줄에 쓰면
     * 그 한 줄만큼 눌러야 할 것이 화면 밖으로 밀린다. 다 끝낸 종목일
     * 때만 여기서 한 줄로 말한다.
     */
    if (cursor < 0) {
      wrap.appendChild(el('div', { class: 'set-dots-row' }, [
        el('span', { class: 'set-dots' }, sets.map(function (set) {
          return el('i', { class: set.done ? 'on' : '', 'aria-hidden': 'true' });
        })),
        el('span', { class: 'set-count done', text: sets.length + '세트 완료' }),
      ]));
    }
    void doneCount;

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
              (set.weightKg > 0 ? set.weightKg + 'kg' : '맨몸') + ' × ' + set.reps + '회 · RIR ' + set.rir +
              // 계획과 다르게 한 세트는 그 사실이 남아야 한다
              (set.plannedKg != null && set.plannedKg !== set.weightKg
                ? '  (계획 ' + (set.plannedKg > 0 ? set.plannedKg + 'kg' : '맨몸') + ')' : '') }),
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

      /*
       * 남은 세트도 세트마다 한 줄씩 적는다.
       *
       * 세트마다 처방이 다를 수 있고(램프업, 백오프), 다르지 않더라도
       * "앞으로 몇 kg으로 몇 번씩 몇 세트가 남았는지"는 지금 이 세트를
       * 어떻게 할지에 영향을 준다. 지금 할 것보다 작고 조용히 둔다.
       */
      var ahead = [];
      sets.forEach(function (set, setIndex) {
        if (set.done || setIndex <= cursor) return;
        ahead.push(el('div', { class: 'set-plan' }, [
          el('span', { class: 'set-no', text: (setIndex + 1) + '세트' }),
          el('span', { class: 'set-plan-line', text: setPlanLine(set) }),
        ]));
      });
      if (ahead.length > 0) {
        wrap.appendChild(el('div', { class: 'set-plan-list' }, ahead));
      }
    } else {
      wrap.appendChild(el('div', { class: 'set-cleared', text: '이 종목은 끝났습니다.' }));
    }

    return wrap;
  }

  /**
   * 세트 하나의 처방을 한 줄로.
   *
   * "40kg × 15회" — 이 세트에 뭘 하기로 했는지다. 친 무게(weightKg)가
   * 아니라 처방(plannedKg)을 쓴다. 둘이 다른 날이 기록이 중요한 날이다.
   */
  function setPlanLine(set, pounds) {
    var planned = set.plannedKg == null ? set.weightKg : set.plannedKg;
    var reps = set.targetReps.min === set.targetReps.max
      ? set.targetReps.max + '회'
      : set.targetReps.min + '–' + set.targetReps.max + '회';
    // 숫자칸과 다른 단위를 쓰면 바로 위아래에서 두 숫자가 안 맞아 보인다.
    return (planned > 0 ? E.weightLabelIn(planned, pounds) : '맨몸') + ' × ' + reps;
  }

  /**
   * 세트마다 자동으로 셀 때, 지금 세트를 시작할 때가 됐는지 본다.
   *
   * 지키는 것 셋.
   *   · 쉬는 중에는 시작하지 않는다 — 쉬는 사람에게 "하나"를 세면 안 된다.
   *   · 세트 하나당 한 번만 시작한다. 그러지 않으면 화면을 다시 그릴 때마다
   *     카운트가 처음으로 돌아간다.
   *   · **멈추기를 누른 세트는 다시 시작하지 않는다.** 그 사람은 지금
   *     세지 말라고 말한 것이다.
   */
  function maybeAutoCount(liftIndex, setIndex) {
    var auto = state.autoCount || ptOn();
    if (!auto || state.rest || state.counting || !state.started) return;
    var key = liftIndex + ':' + setIndex;
    if (state.autoCountedFor === key) return;
    state.autoCountedFor = key;
    // 그리는 중에 다시 그릴 수 없다. 이번 그리기가 끝난 뒤로 미룬다.
    setTimeout(function () {
      if (!(state.autoCount || ptOn()) || state.rest || state.counting) return;
      var lift = state.lifts[liftIndex];
      var set = lift && lift.sets[setIndex];
      if (!set || set.done) return;
      /*
       * PT 모드는 세트 전에 말을 먼저 한다. 그 말이 끝나기 전에 "하나"가
       * 나가면 박자가 처음부터 어긋나므로, 준비 시간을 말 길이에 맞춰
       * 늘린다. 첫 세트는 사용법·지난 기록까지 말해서 15초를 넘기도 한다.
       */
      var lead = AUTO_LEAD_SECONDS;
      if (ptOn()) {
        var said = coachBefore(liftIndex, setIndex);
        if (said) lead = Math.max(AUTO_LEAD_SECONDS, Math.ceil(E.speechSeconds(said)) + 3);
      }
      startCounting(liftIndex, setIndex, lead);
    }, 0);
  }

  /** 지금 할 세트. 화면에서 제일 커야 한다 — 지금 할 일은 이것 하나다. */
  function renderCurrentSet(lift, liftIndex, set, setIndex) {
    maybeAutoCount(liftIndex, setIndex);
    var pounds = inPounds(lift.exercise.id);
    var plates = set.weightKg > 0 && lift.loading ? E.platePlan(set.weightKg, lift.loading) : null;
    var target = set.targetReps.min === set.targetReps.max
      ? set.targetReps.max + '회'
      : set.targetReps.min + '–' + set.targetReps.max + '회';

    var body = [];

    /*
     * 이번 세트가 무엇인가 — 카드에서 제일 먼저 읽는 두 줄.
     *
     * "1세트 진행중"과 "30kg × 10–15회". 머리띠에 작게 넣어 봤지만
     * 그건 흘끗 보는 용이었고, 기구 앞에서 실제로 보는 자리는 숫자칸
     * 바로 위다. 세트마다 처방이 다를 수 있으니 세트마다 그 세트의
     * 것을 쓴다.
     */
    /*
     * 이 헬스장에 이 종목 기계가 둘 이상이면 어느 쪽인지 고른다.
     *
     * 카드 맨 위에 뒀다가 옮겼다. 화면은 지금 할 세트로 스크롤되므로
     * 카드 위쪽은 기구 앞에서 보이지 않는다. "102.5kg이라는데 나는
     * 다른 기계 앞인데"를 깨닫는 자리는 숫자칸이고, 고치는 버튼도
     * 거기 있어야 한다.
     */
    var machines = machineRow(lift, liftIndex);
    if (machines) body.push(machines);

    if (ptOn()) {
      var ptBits = ptSetBits(lift, liftIndex, setIndex);
      ptBits.forEach(function (bit) { body.push(bit); });
    }

    body.push(el('div', { class: 'now-head' }, [
      el('div', { class: 'now-line' }, [
        el('b', { text: (setIndex + 1) + '세트 진행중' }),
        el('span', { class: 'of', text: '/ ' + lift.sets.length + '세트' }),
        // 점은 세어 보지 않고 어디쯤인지 아는 용이다. 숫자 옆이 제자리다.
        el('span', { class: 'set-dots' }, lift.sets.map(function (item, order) {
          return el('i', {
            class: item.done ? 'on' : (order === setIndex ? 'now' : ''),
            'aria-hidden': 'true',
          });
        })),
      ]),
      el('div', { class: 'plan', text: setPlanLine(set, pounds) }),
    ]));

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
            type: 'number', min: '0', max: pounds ? '2200' : '999', step: 'any',
            inputmode: 'decimal',
            class: 'big-input',
            value: String(pounds ? E.kgToLb(set.weightKg) : set.weightKg),
            'aria-label': (setIndex + 1) + '세트 중량 (' + (pounds ? '파운드' : 'kg') + ')',
            onfocus: function (event) { event.target.select(); },
            onchange: function (event) { typeWeight(liftIndex, setIndex, event.target.value); },
          }),
          /*
           * 단위를 눌러서 바꾼다.
           *
           * 따로 설정 화면을 만들지 않는다. 파운드 기계인 걸 깨닫는
           * 자리는 기계 앞에서 숫자를 보는 순간이고, 고치는 자리도
           * 거기여야 한다. 칸 옆에 이미 'kg'이 적혀 있으니 그걸 누르게
           * 하면 새로 배울 것이 없다.
           */
          el('button', {
            type: 'button', class: 'big-unit unit-pick',
            text: pounds ? 'lb' : 'kg',
            'aria-pressed': String(pounds),
            'aria-label': pounds
              ? '파운드로 보는 중 — 눌러서 kg으로'
              : 'kg으로 보는 중 — 파운드 표기 기계면 눌러서 lb로',
            onclick: function () { togglePounds(lift.exercise.id); },
          }),
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
    /*
     * 파운드 기계에는 이 안내를 띄우지 않는다. 비교하는 격자가 kg 스택
     * 명세라 파운드 기계와는 상관이 없고, "만들 수 없는 무게"라고 해 봐야
     * 틀린 말이다.
     */
    if (set.weightKg > 0 && lift.loading && !pounds) {
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

    /*
     * 세는 중이면 숫자 하나만 크게 띄운다. 세트 중에 볼 수 있는 건 하나뿐이고,
     * 그 하나는 "지금 몇 개째"다.
     */
    var live = renderCounting(liftIndex, setIndex);
    if (live) {
      body.push(live);
      return el('div', { class: 'set-now counting' }, [el('div', { class: 'now-body' }, body)]);
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

    body.push(countPanel(liftIndex, setIndex));

    /*
     * 세트를 넘기는 버튼이 따로 없다는 게 문제였다. RIR 숫자를 누르면
     * 기록되고 다음 세트로 가는데, 화면 어디에도 그 말이 없으니 "다음
     * 세트로 어떻게 가느냐"가 된다. 누르기 전에 무슨 일이 일어나는지를
     * 쓴다 — 버튼을 하나 더 두면 세트마다 탭이 한 번씩 는다.
     */
    var nextLabel = setIndex + 1 < lift.sets.length
      ? (setIndex + 2) + '세트로 넘어갑니다'
      : '이 종목을 마칩니다';
    /*
     * PT 모드는 "몇 회 더?"가 아니라 "무게 어땠어요?"로 묻는다. 트레이너가
     * 실제로 하는 말이고, 초보는 남은 횟수를 몰라도 가벼웠는지는 안다.
     * 남은 횟수 버튼은 아래에 그대로 둔다 — 정확히 아는 사람은 그걸 누른다.
     */
    if (ptOn()) {
      body.push(el('div', { class: 'rir-ask' }, [
        el('b', { text: (setIndex + 1) + '세트 끝내기' }),
        el('span', { text: E.askFeelLine(state.coach.style) }),
      ]));
      body.push(el('div', { class: 'feel-row' }, E.FEELS.map(function (feel) {
        return el('button', {
          type: 'button',
          class: 'feel' + (feel.id === 'hurt' ? ' hurt' : ''),
          'aria-label': feel.label + ' — 기록하고 ' + nextLabel,
          text: feel.label,
          onclick: function () { finishByFeel(liftIndex, setIndex, feel.id); },
        });
      })));
    }
    body.push(el('div', { class: 'rir-ask' + (ptOn() ? ' quiet' : '') }, [
      el('b', { text: ptOn() ? '정확히 아시면' : (setIndex + 1) + '세트 끝내기' }),
      el('span', { text: '방금 세트, 몇 회 더 할 수 있었나요?' }),
    ]));

    /*
     * 버튼에 숫자만 있으면 무엇을 묻는지 안 보인다.
     *
     * 20년 하신 트레이너가 "이 1 2 3 4 실패가 뭘 요구하는 거냐"고 물으셨다.
     * 위에 질문을 써 뒀지만, 사람은 질문이 아니라 **버튼을 읽는다.** 버튼이
     * 스스로 답이 되게 쓴다 — "2"가 아니라 "2회 더".
     *
     * 실패도 글자를 바꾼다. 실패까지 가는 건 일부러 하는 일인데 "실패"라고
     * 적어 두면 잘못한 것처럼 읽힌다.
     */
    var chips = el('div', { class: 'rir-row now-rir' }, []);
    [0, 1, 2, 3, 4].forEach(function (rir) {
      var label = rir === 0 ? '못 함' : rir === 4 ? '4회+' : rir + '회';
      chips.appendChild(el('button', {
        type: 'button',
        class: 'chip' + (rir === 0 ? ' fail' : ''),
        'aria-pressed': 'false',
        'aria-label': (rir === 0 ? '더 못 들었음, 실패 지점까지 수행' : rir + '회 더 할 수 있었음') +
          '으로 기록하고 ' + nextLabel,
        text: label,
        onclick: function () {
          var weight = set.weightKg;
          var reps = set.reps;
          completeSet(liftIndex, setIndex, rir);
          coachAfter(liftIndex, setIndex, 'right', weight, reps);
        },
      }));
    });
    body.push(chips);
    /*
     * **왜 묻는지**까지 써 둔다. 아무 뜻 없이 누르는 버튼이 되면 사람은
     * 대충 누르고, 대충 누른 값으로 다음 주 무게가 정해진다.
     */
    body.push(el('p', { class: 'hint-line', text:
      '누르면 기록되고 ' + nextLabel + '. 이 답으로 다음 세트와 다음 주 무게가 정해집니다.' }));

    return el('div', { class: 'set-now' }, [
      el('div', { class: 'now-body' }, body),
    ]);
  }

  /**
   * PT 모드에서 세트 칸 위에 붙는 것들 — 코치가 한 말, 처음이면 사용법,
   * 기계 세팅 적는 칸.
   */
  function ptSetBits(lift, liftIndex, setIndex) {
    var bits = [];

    // 소리가 안 나도 읽을 수 있게. 무음 모드인 헬스장이 많다.
    bits.push(el('p', { class: 'coach-say', id: 'coach-say', 'aria-live': 'polite',
      text: state.coachLine || E.coachStyleInfo(state.coach.style).label + ' 코치가 함께합니다.' }));

    if (setIndex !== 0) return bits;

    if (!triedBefore(lift.exercise)) {
      var steps = E.setupFor(lift.exercise);
      if (steps.length > 0) {
        bits.push(el('div', { class: 'setup-box' }, [
          el('b', { text: '처음 하시는 종목 — 자리 잡기' }),
          el('ol', {}, steps.map(function (step) { return el('li', { text: step }); })),
        ]));
      }
    }

    /*
     * 기계 세팅을 적어 둔다. 헬스장마다 기계가 달라서 앱에 적힌 사용법보다
     * "지난번 시트 4번"이 훨씬 쓸모 있다. 다음에 이 종목을 하면 세트 전에
     * 이걸 읽어 준다.
     */
    if (E.hasSetting(lift.exercise)) {
      var key = settingKeyFor(lift);
      bits.push(el('label', { class: 'setting-row' }, [
        el('span', { text: '기계 세팅' }),
        el('input', {
          type: 'text', class: 'text-input setting-input',
          maxlength: String(E.SETTING_MAX),
          placeholder: E.settingPlaceholder(lift.exercise),
          value: state.machineSettings[key] || '',
          onchange: function (event) {
            var clean = E.cleanSetting(event.target.value);
            if (clean) state.machineSettings[key] = clean;
            else delete state.machineSettings[key];
            event.target.value = clean;
            persist();
          },
        }),
      ]));
    }
    return bits;
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
      el('div', { class: 'lift-head' }, [nameRow]),
    ]);

    // 다른 헬스장에서 하던 기계면 표기 중량이 다르다. 숨기면 안 된다.
    if (lift.gymWeightNote) {
      card.appendChild(el('div', { class: 'machine-note' }, [
        el('span', { class: 'label', text: '처음 쓰는 기계' }),
        el('span', { text: lift.gymWeightNote }),
      ]));
    }


    /*
     * 워밍업 줄은 첫 세트에만 둔다. 한 세트라도 했으면 이미 데운 뒤이고,
     * 그 줄이 차지한 34px만큼 눌러야 할 RIR이 화면 밖으로 밀린다.
     */
    var anyDone = lift.sets.some(function (set) { return set.done; });
    if (!anyDone) card.appendChild(renderWarmup(lift));
    card.appendChild(renderSetTrack(lift, liftIndex));

    /*
     * 처방 설명("10회 × RIR 2→3으로 목표 상단에 도달했습니다")은 읽을
     * 값어치가 있지만, 카드 맨 위에 두면 딱 그 높이만큼 중량칸과 RIR을
     * 아래로 민다. 행동 다음에 읽어도 되는 것은 행동 다음에 둔다.
     */
    if (lift.note) card.appendChild(el('div', { class: 'lift-note below', text: lift.note }));

    var decision = renderDecision(lift);
    if (decision) card.appendChild(decision);

    /*
     * 강도 기법은 "마지막 세트에 붙일" 것이다. 세트를 다 기록한 뒤에도
     * 떠 있으면 끝난 종목 밑에 할 일이 남은 것처럼 보이고, 정작 다음
     * 행동인 완료 버튼을 화면 밖으로 밀어낸다.
     */
    /*
     * 진짜 마지막 세트일 때만 띄운다. "마지막 세트에 붙일 것"인데 1세트째부터
     * 떠 있으면 화면 반을 먹고, 짧은 폰에서는 그만큼 RIR 버튼이 아래로 밀린다.
     */
    var left = lift.sets.filter(function (set) { return !set.done; }).length;
    if (left === 1) card.appendChild(renderTechniques(lift));
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

    /*
     * 예고가 맨 위다. 방금 끝낸 사람이 가장 먼저 봐야 하는 것은 오늘
     * 한 세트 수가 아니라 **다음에 언제 오는가**다. 요약은 그 아래에서
     * 기다려도 된다 — 어차피 다시 볼 버튼이 있다.
     */
    var preview = previewCard();
    if (preview) screen.appendChild(preview);

    // 막 마친 자리가 이번 주를 돌아볼 마음이 제일 드는 자리다.
    screen.appendChild(streakCard(currentStreak()));
    var closedFriends = friendsCard();
    if (closedFriends) screen.appendChild(closedFriends);
    var closedNudge = reportNudge();
    if (closedNudge) screen.appendChild(closedNudge);

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
        /*
         * "이어서 하기"만 있으면 오늘 계획한 것을 다 한 사람은 갈 곳이
         * 없다. 더 하고 싶은 날이 있고, 그걸 못 하게 막으면 앱 밖에서
         * 해서 그 세트가 어디에도 안 남는다.
         */
        el('button', {
          type: 'button', class: 'finish', text: '다른 운동 더 하기',
          onclick: openAddLift,
        }),
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
    /*
     * 휴식 타이머도 같이 멈춘다. "오늘 운동을 마쳤습니다" 밑에서
     * 휴식 0:44가 계속 돌면 끝난 게 아닌 것처럼 보이고, 화면을 끈 뒤에도
     * 다 쉬었다고 알림이 한 번 더 울린다.
     */
    state.sessionClosed = true;
    state.started = false;
    stopRest();
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

  /* ── 유산소 ────────────────────────────────────── */

  /** 오늘 근력으로 쓴 부위 — 간섭을 보려면 이게 있어야 한다. */
  function todayMuscleList() {
    var seen = [];
    state.lifts.forEach(function (lift) {
      var muscle = E.primaryMuscle(lift.exercise);
      if (muscle && seen.indexOf(muscle) < 0) seen.push(muscle);
    });
    return seen;
  }

  function cardioWeekLogs() {
    var sunday = E.addDays(state.monday, 6);
    return state.cardioLog
      .filter(function (item) { return item.date >= state.monday && item.date <= sunday; })
      .concat(state.cardioToday.map(function (item) {
        return Object.assign({ date: state.todayDate }, item);
      }));
  }

  /**
   * 유산소 붙이기.
   *
   * 근력 앱에 유산소를 그냥 목록으로 끼워 넣으면, 다리 하고 나서 바로
   * 뛰어서 방금 한 하체 운동을 반쯤 버리는 사람이 나온다. 그래서 종목을
   * 고르는 자리에서 **오늘 근력 세션과 부딪히는지**를 같이 보여준다.
   */
  function renderCardio() {
    var body = el('div', { class: 'sheet-body' }, []);
    var muscles = todayMuscleList();
    var draft = state.cardioDraft;

    if (!draft) {
      body.appendChild(el('p', { class: 'hint-line', text:
        '오늘 근력으로 쓴 부위와 겹치는 것은 아래로 내려 둡니다. ' +
        '겹치는 유산소는 방금 한 운동의 효과를 깎습니다.' }));

      var ranked = E.rankForToday(muscles);
      var list = el('div', { class: 'summary-list' }, ranked.map(function (exercise) {
        var check = E.interference({
          exercise: exercise, zone: 'steady', minutes: 25,
          todayMuscles: muscles, before: false,
        });
        return el('button', {
          type: 'button',
          class: 'cardio-row' + (check.level === 'avoid' ? ' blocked' : ''),
          onclick: function () {
            state.cardioDraft = { exerciseId: exercise.id, minutes: 20, zone: 'steady', before: false };
            render();
          },
        }, [
          cardioThumb(exercise, check.level),
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'name', text: exercise.name }),
            el('span', { class: 'plan-sets', text:
              check.level === 'none' ? exercise.note : check.text }),
          ]),
          el('span', { class: 'detail', text: '›' }),
        ]);
      }));
      body.appendChild(list);
    } else {
      var exercise = E.cardioById(draft.exerciseId);
      var check = E.interference({
        exercise: exercise, zone: draft.zone, minutes: draft.minutes,
        todayMuscles: muscles, before: draft.before,
      });

      body.appendChild(el('div', { class: 'cardio-head' }, [
        cardioThumb(exercise),
        el('b', { text: exercise.name }),
        el('button', {
          type: 'button', class: 'demo-open', text: '다른 종목',
          onclick: function () { state.cardioDraft = null; render(); },
        }),
      ]));

      if (check.level !== 'none') {
        body.appendChild(el('div', { class: 'notice' + (check.level === 'avoid' ? ' stop' : '') }, [
          el('div', { class: 'label', text: check.level === 'avoid' ? '권하지 않습니다' : '알아두세요' }),
          el('div', { text: check.text }),
          check.fix ? el('div', { class: 'hint-line', text: '→ ' + check.fix }) : null,
        ]));
      }

      body.appendChild(el('div', { class: 'list-label', text: '얼마나' }));
      body.appendChild(el('div', { class: 'chip-row' }, [10, 20, 30, 45, 60].map(function (minutes) {
        return el('button', {
          type: 'button', class: 'pick', 'aria-pressed': String(draft.minutes === minutes),
          text: minutes + '분',
          onclick: function () { draft.minutes = minutes; render(); },
        });
      })));

      body.appendChild(el('div', { class: 'list-label', text: '강도 — 숨이 어떤지로 정합니다' }));
      body.appendChild(el('div', { class: 'chip-row' }, E.ZONES.map(function (zone) {
        return el('button', {
          type: 'button', class: 'pick', 'aria-pressed': String(draft.zone === zone.id),
          title: zone.talk,
          text: zone.label,
          onclick: function () { draft.zone = zone.id; render(); },
        });
      })));
      body.appendChild(el('p', { class: 'hint-line', text:
        E.cardioZoneOf(draft.zone).talk + ' · 심박계가 있으면 최대심박의 '
        + E.cardioZoneOf(draft.zone).hrPercent.join('~') + '%' }));

      body.appendChild(el('button', {
        type: 'button', class: 'finish', text: '기록하기',
        onclick: function () {
          state.cardioToday = state.cardioToday.concat([{
            exerciseId: draft.exerciseId,
            minutes: draft.minutes,
            zone: draft.zone,
            before: draft.before,
          }]);
          state.cardioDraft = null;
          pushLog('유산소', '<b>' + exercise.name + '</b> ' + draft.minutes + '분 · '
            + E.cardioZoneOf(draft.zone).label);
          render();
        },
      }));
    }

    // 오늘 한 것
    if (state.cardioToday.length > 0) {
      state.cardioToday.forEach(function (log, index) {
        body.appendChild(el('div', { class: 'cardio-done' }, [
          el('span', { text: E.describeCardio(log) }),
          el('button', {
            type: 'button', class: 'demo-open', text: '지우기',
            'aria-label': E.describeCardio(log) + ' 기록 지우기',
            onclick: function () {
              state.cardioToday = state.cardioToday.filter(function (_, i) { return i !== index; });
              render();
            },
          }),
        ]));
      });
    }

    var load = E.weeklyLoad(cardioWeekLogs());
    body.appendChild(el('p', { class: 'hint-line', text: load.text }));

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '유산소 추가' }),
        el('span', { class: 'meta', text: '근력과 따로 계산' }),
      ]),
      body,
    ]));
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
  /* ── 서버 ──────────────────────────────────────── */

  /*
   * 접속 정보는 관장님이 앱에 직접 넣는다. 코드에 박아 두지 않는다 —
   * 열쇠를 남한테 보낼 일도 없고, 나중에 다른 사람이 자기 서버로 쓰고
   * 싶을 때도 그대로 된다.
   */

  /*
   * 기기를 건너가야 하는 설정과, 이 기기에만 있어야 하는 설정.
   *
   * 프로그램·헬스장·기구·휴식 띠는 같이 가야 한다 — 폰을 바꿨는데
   * 처음부터 다시 고르게 하면 서버를 붙인 뜻이 없다.
   *
   * 반대로 "지금 몇 번째 종목인가", "어느 탭을 보고 있었나"는 같이
   * 가면 안 된다. 집 태블릿이 헬스장 폰의 화면을 끌고 가면 그건
   * 도와주는 게 아니라 방해다.
   */
  var SHARED_SETTINGS = [
    'program', 'lifter', 'answers', 'gymBook', 'gym', 'style', 'blockHistory',
    'timeBudget', 'restBand', 'restOverrides', 'voiceOn', 'tempo', 'voiceRate', 'autoCount',
    'consent', 'consentRecord', 'landmarks', 'exclusions', 'comeback', 'promise',
  ];

  function sharedSettings() {
    var out = {};
    SHARED_SETTINGS.forEach(function (key) {
      if (state[key] !== undefined && state[key] !== null) out[key] = state[key];
    });
    return out;
  }

  /** 같이 가야 하는 설정이 마지막으로 바뀐 때. */
  function settingsStamp() {
    var body = JSON.stringify(sharedSettings());
    if (body !== state.lastSettingsBody) {
      state.lastSettingsBody = body;
      state.settingsUpdatedAt = new Date().toISOString();
    }
    return { updatedAt: state.settingsUpdatedAt || new Date(0).toISOString(), body: sharedSettings() };
  }

  /** 서버에서 받은 설정을 얹는다. 받은 것이 이겼으므로 그대로 쓴다. */
  function applyRemoteSettings(settings) {
    var body = settings && settings.body;
    if (!body || typeof body !== 'object') return;
    SHARED_SETTINGS.forEach(function (key) {
      if (body[key] !== undefined) state[key] = body[key];
    });
    state.settingsUpdatedAt = settings.updatedAt;
    state.lastSettingsBody = JSON.stringify(sharedSettings());
    rebuildSession();
  }

  /**
   * 계정에 있던 프로그램을 그대로 쓴다 — 설문은 건너뛴다.
   *
   * 폰을 바꾼 사람이 로그인했을 때 부른다. 프로그램도 헬스장도 동의 기록도
   * 서버에서 이미 받아 왔으므로, 설문을 다시 돌려 **계산할 것이 없다.**
   * completeOnboarding()을 부르면 안 되는 이유가 그것이다 — 그건 답을
   * 가지고 프로그램을 새로 짜는 함수라, 받아 온 프로그램을 덮어쓴다.
   *
   * 앱을 껐다 켠 사람이 지나는 길(restore)과 같은 자리에 내려놓는다.
   */
  function adoptAccountProgram(wasOnboarding) {
    state.onboarding = { active: false, step: 0 };
    state.tab = 'today';
    loadScenario(state.scenario || 'normal', true);
    persist();
    pushLog('로그인', wasOnboarding
      ? '쓰던 프로그램을 불러왔습니다 — <b>설문은 건너뜁니다.</b>'
      : '쓰던 프로그램을 불러왔습니다.');
  }

  /**
   * 알아서 맞춘다.
   *
   * 이게 없으면 기록이 이 기기에만 쌓인다. 로그인을 필수로 만들어 둔 이유가
   * "폰을 바꿔도 남는다"인데, 올라가지 않으면 그 말이 거짓말이 된다.
   *
   * 예전에는 가입 직후에 한 번 올리고 그 뒤로는 사람이 **버튼을 눌러야**
   * 올라갔다. 그 버튼을 누르는 사람은 없다.
   *
   * 바로 안 올리고 8초 미룬다. 세트를 칠 때마다 persist가 도는데 거기서
   * 바로 올리면 한 세션에 스무 번 넘게 서버를 부른다. 올릴 것이 없으면
   * 깨어나서 그냥 돌아간다.
   */
  var syncTimer = null;

  function settingsChanged() {
    return JSON.stringify(sharedSettings()) !== state.lastSettingsBody;
  }

  function syncSoon() {
    if (!Remote.configured() || !Remote.signedIn()) return;
    if (syncTimer) return;
    syncTimer = setTimeout(function () {
      syncTimer = null;
      if (storage.outbox().length === 0 && !settingsChanged()) return;
      syncNow();
    }, 8000);
  }

  /**
   * 이 기기에 다른 사람의 기록이 있을 때.
   *
   * 조용히 지우지 않는다. 지우면 돌이킬 수 없고, 아직 안 올라간 세트가
   * 있으면 그건 어디에도 없는 기록이다. 몇 개가 걸려 있는지 세어서
   * 보여주고 고르게 한다.
   *
   * 자동으로 고르지도 않는다. "알아서 해 주는" 선택이 남의 건강 기록을
   * 지우는 일이면 그건 알아서 할 일이 아니다.
   */
  function askAccountSwitch() {
    if (state.askingSwitch) return;
    state.askingSwitch = true;

    var pending = storage.outbox().length;
    var mine = Remote.email() || '새 계정';

    var body = [];
    body.push(el('p', { class: 'asset-note', text:
      '이 기기에는 다른 계정의 운동 기록이 남아 있습니다. ' +
      withParticleJs(mine, '으로/로') + ' 쓰시려면 그 기록을 먼저 치워야 합니다 — ' +
      '남의 기록이 이 계정으로 올라가면 안 되니까요.' }));

    if (pending > 0) {
      body.push(el('div', { class: 'notice stop' }, [
        el('div', { class: 'label', text: '아직 안 올라간 기록이 있습니다' }),
        el('div', { text: pending + '개가 이 기기에만 있습니다. 지우면 되돌릴 수 없습니다. ' +
          '그 기록이 필요하면 먼저 원래 계정으로 로그인해서 올리세요.' }),
      ]));
    } else {
      body.push(el('p', { class: 'hint-line', text:
        '이 기기의 기록은 원래 계정에 전부 올라가 있습니다. 지워도 그쪽에는 그대로 남습니다.' }));
    }

    body.push(el('div', { class: 'sheet-body' }, [
      el('button', {
        type: 'button', class: 'finish danger',
        text: '이 기기 기록을 지우고 ' + mine + '으로 쓰기',
        onclick: function () {
          state.askingSwitch = false;
          var me = Remote.userId();
          modal.close();
          wipeEverything();
          Remote.claimData(me);
          render();
          pushLog('계정', '이 기기의 기록을 치우고 <b>' + mine + '</b> 기록을 받아옵니다.');
          syncNow();
        },
      }),
      el('button', {
        type: 'button', class: 'finish quiet',
        text: '원래 계정으로 돌아가기',
        onclick: function () {
          state.askingSwitch = false;
          modal.close();
          Remote.signOut().then(function () {
            render();
            pushLog('계정', '로그아웃했습니다. 이 기기의 기록은 그대로 있습니다.');
          });
        },
      }),
    ]));

    openModal('다른 계정의 기록이 있습니다', mine, body);
  }

  function syncStatusLine() {
    var pending = storage.outbox().length;
    return E.syncAgeLine(state.lastSyncedAt || null, Date.now(), pending);
  }

  /** 지금 한 번 맞춘다. 실패해도 기록은 이 기기에 그대로 있다. */
  /* ── 이 기기의 기록은 누구 것인가 ────────────────────

     로그아웃해도 기록은 이 기기에 남는다. 그게 맞다 — 신호 없는 지하에서
     적은 것이 로그아웃 한 번에 날아가면 안 된다.

     그런데 그 상태에서 다른 사람이 로그인하면 앞 사람의 밀린 기록이
     **뒷사람 계정으로** 올라간다. 운동 기록은 민감정보(개인정보보호법
     제23조)라 그냥 둘 일이 아니다.

     그래서 올리기 전에 주인을 본다. 올리는 길은 syncNow 하나뿐이므로
     여기만 막으면 샐 데가 없다.
  ── */

  /**
   * 올려도 되는가.
   *
   *   주인이 없다  → 이 사람 것으로 적는다. 로그인 전에 쓰던 기록이
   *                 그 사람 것이 되는 길이라 막으면 안 된다.
   *   주인이 같다  → 평소대로.
   *   주인이 다르다 → 멈추고 묻는다.
   */
  function dataOwnerCheck() {
    var me = Remote.userId();
    // 누구인지 모르면 판단할 근거가 없다. 부르는 쪽에서 먼저 물어 온다.
    if (!me) return 'unknown';
    var owner = Remote.dataOwner();
    if (!owner) { Remote.claimData(me); return 'mine'; }
    return owner === me ? 'mine' : 'other';
  }

  function syncNow(after) {
    if (!Remote.configured() || !Remote.signedIn()) return Promise.resolve(null);
    if (state.syncing) return Promise.resolve(null);

    /*
     * 누구인지 모르면 먼저 물어보고 다시 들어온다. 모른 채로 올리면
     * 주인을 확인하는 뜻이 없어진다.
     */
    if (dataOwnerCheck() === 'unknown') {
      return Remote.loadIdentity().then(function () {
        return Remote.userId() ? syncNow(after) : null;
      });
    }
    if (dataOwnerCheck() === 'other') {
      askAccountSwitch();
      return Promise.resolve(null);
    }

    state.syncing = true;
    if (after) after();

    /*
     * 이 기기가 이 계정과 설정을 맞춰 본 적이 있는가.
     *
     * 없으면 계정 쪽이 이긴다. 그러지 않으면 폰을 바꾼 사람이 설문을
     * 다시 하고 로그인했을 때, 방금 만든 설문이 제일 나중이라 서버의
     * 진짜 프로그램을 덮어쓴다.
     */
    var firstPull = !Remote.read().settingsSynced;

    return E.syncOnce(storage, Remote.transport(), {
      cursor: Remote.read().cursor || null,
      settings: settingsStamp(),
      settingsFirstPull: firstPull,
      onSettings: applyRemoteSettings,
    })
      .then(function (result) {
        state.syncing = false;
        Remote.patch({ cursor: result.cursor });
        // 설정이 한 번이라도 오갔으면 이제 이 기기도 이 계정의 기기다.
        if (result.settings && result.settings !== undefined) Remote.patch({ settingsSynced: true });
        if (!result.error) {
          state.lastSyncedAt = new Date().toISOString();
          storage.patch({});
        }
        if (result.pulled > 0) {
          // 받은 기록을 화면에 반영한다.
          var saved = storage.load().sessions.filter(function (item) { return !item.deleted; });
          state.history = saved;
          /*
           * 오늘 기록을 다른 기기에서 먼저 했을 수 있다. 그 날의 유산소를
           * 화면에도 되살려야 "올라갔는데 안 보인다"가 안 생긴다.
           */
          var today = saved.filter(function (item) { return item.date === state.todayDate; })[0];
          if (today && today.cardio && state.cardioToday.length === 0) {
            state.cardioToday = today.cardio.slice();
          }
        }
        pushLog('서버', result.message);
        /*
         * 설문 도중에 로그인했고, 계정에 프로그램이 있었다면 남은 설문은
         * 물어볼 것이 없다. 답은 이미 서버에서 왔다.
         *
         * 'pushed'일 때는 하지 않는다 — 그건 서버가 비어 있어서 방금 한
         * 설문이 올라간 경우다. 새로 가입한 사람의 설문을 건너뛰면
         * 프로그램이 없는 채로 앱이 열린다.
         */
        /*
         * 이 기기가 이 계정과 처음 만난 순간이다('restored'). 방금 계정
         * 쪽 프로그램을 통째로 받았으므로, 주간 처방도 그 프로그램 기준으로
         * 다시 세워야 한다.
         *
         * **설문 중인지를 조건으로 걸면 안 된다.** 카카오·구글로 들어오는
         * 사람은 떠나기 전에 온보딩이 이미 끝나 있다(startOAuth) — 돌아온
         * 시점에는 "설문 중"이 아니라서, 그 조건이면 이 길에서만 조용히
         * 안 돈다. 받아 온 프로그램에 엉뚱한 주차·목표 RIR이 붙는다.
         *
         * 'pulled'(두 기기가 같이 써 온 사이의 평범한 당겨오기)는 설문
         * 중일 때만 본다. 평소에 그걸로 세션을 다시 세우면, 운동 중에
         * 동기화가 돌 때 화면이 통째로 갈아엎인다.
         */
        var firstContact = result.settings === 'restored';
        var midOnboarding = Boolean(state.onboarding && state.onboarding.active);
        var adopt = firstContact || (result.settings === 'pulled' && midOnboarding);
        if (adopt && state.program && state.answers) {
          adoptAccountProgram(midOnboarding);
        }
        persist();
        if (after) after();
        return result;
      }, function (error) {
        state.syncing = false;
        pushLog('서버', '맞추지 못했습니다 — ' + error.message);
        if (after) after();
        return null;
      });
  }

  /**
   * 로그인 화면.
   *
   * 화면 하나를 통째로 쓴다. 모달 안에 이메일·비밀번호를 끼워 넣으면
   * "설정 어딘가에 있는 것"이 되는데, 계정은 설정이 아니라 문이다.
   *
   * **로그인을 강요하지 않는다.** 앱은 계정 없이도 전부 돌아간다 —
   * 서버는 같은 사람의 다른 기기를 잇는 역할만 한다. 그래서 "나중에
   * 할게요"가 늘 있고, 눌러도 아무것도 잃지 않는다.
   */
  function renderAuth() {
    var form = state.authForm;
    var signUp = form.mode === 'signup';

    screen.appendChild(el('div', { class: 'auth-head' }, [
      el('div', { class: 'auth-mark', text: '볼륨 코치' }),
      el('h2', { text: signUp ? '계정 만들기' : '로그인' }),
      el('p', { class: 'auth-why', text: signUp
        ? '폰을 바꿔도 기록이 남습니다. 지금까지 이 기기에 쌓인 기록은 그대로 올라갑니다.'
        : '다른 기기에 있던 기록을 이 기기로 가져옵니다.' }),
    ]));

    if (!Remote.configured()) {
      /*
       * 주소와 열쇠가 없으면 로그인할 곳이 없다. 로그인 칸을 띄워 놓고
       * 눌렀을 때 실패하게 두면 사용자는 자기 비밀번호를 의심한다.
       */
      screen.appendChild(el('div', { class: 'notice stop' }, [
        el('div', { class: 'label', text: '서버가 아직 없습니다' }),
        el('div', { text: '먼저 서버 주소와 열쇠를 넣어야 합니다. 처음 한 번만 하면 됩니다.' }),
      ]));
      screen.appendChild(el('button', {
        type: 'button', class: 'finish', text: '서버 연결하기',
        onclick: function () { state.authOpen = false; render(); openServerSettings(); },
      }));
      screen.appendChild(el('button', {
        type: 'button', class: 'finish quiet', text: '나중에 할게요',
        onclick: closeAuth,
      }));
      return;
    }

    if (form.notice) {
      screen.appendChild(el('div', { class: 'notice' + (form.notice.bad ? ' stop' : '') }, [
        el('div', { class: 'label', text: form.notice.bad ? '확인 필요' : '알림' }),
        el('div', { text: form.notice.text }),
      ]));
    }

    var mailInput = el('input', {
      type: 'email', class: 'text-input', placeholder: '이메일',
      value: form.email, 'aria-label': '이메일',
      autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      oninput: function (event) { form.email = event.target.value; },
    });
    var passInput = el('input', {
      type: 'password', class: 'text-input',
      placeholder: signUp ? '비밀번호 (6자 이상)' : '비밀번호',
      value: form.password, 'aria-label': '비밀번호',
      autocomplete: signUp ? 'new-password' : 'current-password',
      oninput: function (event) { form.password = event.target.value; },
      onkeydown: function (event) { if (event.key === 'Enter') submit(); },
    });

    /*
     * 카카오·구글을 위에 둔다.
     *
     * 이메일 가입은 확인 메일을 기다려야 하고, 새 비밀번호를 하나 더
     * 만들어야 한다. 대부분은 이미 가진 계정으로 들어오는 편이 빠르다.
     */
    screen.appendChild(oauthRows());
    screen.appendChild(el('div', { class: 'list-label', text: '또는 이메일로' }));

    screen.appendChild(el('div', { class: 'auth-form' }, [mailInput, passInput]));

    function submit() {
      form.email = mailInput.value;
      form.password = passInput.value;

      if (!form.email.trim()) {
        form.notice = { bad: true, text: '이메일을 넣어 주세요.' };
        return render();
      }
      if (form.password.length < 6) {
        form.notice = { bad: true, text: '비밀번호는 6자 이상이어야 합니다.' };
        return render();
      }

      form.busy = true;
      form.notice = { bad: false, text: signUp ? '계정을 만드는 중…' : '로그인하는 중…' };
      render();

      var run = signUp ? Remote.signUp : Remote.signIn;
      run(form.email.trim(), form.password).then(function (result) {
        form.busy = false;
        // 비밀번호는 성공하든 말든 화면에 남겨 두지 않는다.
        form.password = '';

        if (result && result.needsConfirm) {
          form.mode = 'signin';
          form.notice = { bad: false, text:
            '가입했습니다. 받은 메일의 확인 링크를 누른 뒤 로그인하세요. ' +
            '(Supabase에서 Confirm email을 끄면 이 단계가 없습니다.)' };
          return render();
        }

        return Remote.checkSchema().then(function (check) {
          if (!check.ok) {
            form.notice = { bad: true, text: check.reason };
            return render();
          }
          /*
           * 로그인하자마자 맞춘다. 로그인의 목적이 그것이므로, 버튼을
           * 한 번 더 누르게 할 이유가 없다.
           */
          Remote.patch({ email: form.email.trim() });
          return syncNow().then(function () {
            closeAuth();
            pushLog('서버', '<b>' + (Remote.email() || '계정') + '</b>으로 로그인했습니다.');
            renderLog();
          });
        });
      }, function (error) {
        form.busy = false;
        form.password = '';
        form.notice = { bad: true, text: error.message };
        render();
      });
    }

    screen.appendChild(el('button', {
      type: 'button', class: 'finish',
      text: form.busy ? '잠시만요…' : (signUp ? '계정 만들기' : '로그인'),
      disabled: form.busy ? '' : null,
      onclick: submit,
    }));

    /*
     * 설문 도중에 들어왔으면 되돌아갈 길이 있어야 한다. 없으면 계정이
     * 없는 사람이 이 화면에 갇힌다.
     */
    if (state.onboarding && state.onboarding.active) {
      screen.appendChild(el('button', {
        type: 'button', class: 'finish quiet', text: '← 설문으로 돌아가기',
        onclick: closeAuth,
      }));
    }

    screen.appendChild(el('button', {
      type: 'button', class: 'finish quiet',
      text: signUp ? '이미 계정이 있어요 — 로그인' : '처음이에요 — 계정 만들기',
      onclick: function () {
        form.mode = signUp ? 'signin' : 'signup';
        form.notice = null;
        form.password = '';
        render();
      },
    }));

    /*
     * 건너뛰기는 없다. 계정이 있어야 쓰는 앱이다 — 기록이 계정에
     * 남아야 폰을 바꿔도 그대로이고, 헬스장 기구 정보도 계정 단위로
     * 모인다. 이미 로그인한 사람이 계정을 바꾸러 온 경우에만 닫는 길을 둔다.
     */
    if (!loginRequired()) {
      screen.appendChild(el('button', {
        type: 'button', class: 'auth-skip', text: '닫기',
        onclick: closeAuth,
      }));
    }

    /*
     * 서버가 앱에 박혀 있으면 이 화면으로 바로 오게 되는데, 그러면 서버를
     * 바꿀 길이 로그인 뒤에만 남는다. 자기 서버를 쓰려는 사람은 **로그인
     * 전에** 바꿔야 하므로 여기에도 문을 하나 둔다. 조용한 줄로 둔다 —
     * 대부분의 사람은 누를 일이 없다.
     */
    /*
     * 로그인 없이는 못 나가므로, 서버 주소를 잘못 넣은 사람이 갇히지 않게
     * 여기서 고칠 길은 늘 둔다.
     */
    if (Remote.baked() || loginRequired()) {
      screen.appendChild(el('button', {
        type: 'button', class: 'auth-skip', text: '서버 설정',
        onclick: function () { state.authOpen = false; render(); openServerSettings(); },
      }));
    }

    screen.appendChild(el('p', { class: 'asset-note', text:
      '볼륨 코치는 계정이 있어야 쓸 수 있습니다. 기록은 이 기기에 먼저 저장되고 ' +
      '계정으로 올라가서, 폰을 바꿔도 그대로 남습니다. ' +
      '건강 기록은 민감정보라 올리기 전에 동의를 받고, 언제든 서버에서 지울 수 있습니다.' }));
  }

  function openAuth(mode) {
    state.authForm = {
      email: Remote.email() || '',
      password: '',
      mode: mode || 'signin',
      notice: null,
      busy: false,
    };
    state.authOpen = true;
    if (modal.open) modal.close();
    render();
  }

  function closeAuth() {
    state.authOpen = false;
    state.authForm.password = '';
    render();
  }

  /**
   * 서버 설정 화면.
   *
   * 세 단계다. ① 주소와 열쇠 넣기 ② 로그인 ③ 맞추기. 각 단계가 끝나야
   * 다음이 열리게 해서, 뭘 해야 하는지 화면이 말하게 한다.
   */
  function openServerSettings() {
    var notice = null;
    /*
     * 친 값을 들고 있는다.
     *
     * 화면을 다시 그릴 때마다 저장된 값에서 칸을 채우면, 주소 하나가
     * 틀렸다고 말해 주는 사이에 방금 붙여 넣은 긴 열쇠가 날아간다.
     * 저장 전의 값도 화면의 상태다.
     */
    var form = {
      url: Remote.read().url || '',
      key: Remote.read().anonKey || '',
      email: Remote.read().email || '',
      password: '',
    };

    var draw = function () {
      var conf = Remote.read();
      var body = [];

      body.push(el('p', { class: 'asset-note', text:
        '서버는 같은 사람의 다른 기기를 잇는 역할만 합니다. 앱은 서버 없이도 그대로 돌아가고, ' +
        '기록은 늘 이 기기에 먼저 저장됩니다 — 서버가 죽어도 운동은 계속됩니다.' }));

      if (notice) {
        body.push(el('div', { class: 'notice' + (notice.bad ? ' stop' : '') }, [
          el('div', { class: 'label', text: notice.bad ? '확인 필요' : '알림' }),
          el('div', { text: notice.text }),
        ]));
      }

      /*
       * 주소와 열쇠가 빌드에 박혀 있으면 넣으라고 하지 않는다.
       *
       * 서버는 하나인데 그 주소를 사용자가 알아야 할 이유가 없다. 넣는 칸을
       * 띄워 두면 앱을 받은 사람은 거기서 멈춘다 — 뭘 넣어야 하는지 알 길이
       * 없기 때문이다.
       *
       * 그래도 길은 남겨 둔다. 자기 서버를 쓰려는 사람이 있을 수 있고, 그
       * 사람이 넣은 값은 박아 넣은 값을 이긴다.
       */
      var preset = Remote.baked();
      if (preset) {
        body.push(el('div', { class: 'list-label', text: '① 서버' }));
        body.push(el('div', { class: 'server-row' }, [
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'name', text: '연결돼 있습니다' }),
            el('span', { class: 'plan-sets', text: conf.url.replace(/^https:\/\//, '') }),
          ]),
        ]));
        body.push(el('p', { class: 'hint-line', text:
          '주소와 열쇠는 앱에 들어 있습니다. 아래에서 계정만 만들면 됩니다.' }));

        if (!state.showServerFields) {
          body.push(el('button', {
            type: 'button', class: 'ghost', text: '다른 서버 쓰기',
            onclick: function () { state.showServerFields = true; draw(); },
          }));
        }
      }

      if (!preset || state.showServerFields) {
      body.push(el('div', { class: 'list-label', text: preset ? '다른 서버 주소와 열쇠' : '① 서버 주소와 열쇠' }));
      var urlInput = el('input', {
        type: 'url', class: 'text-input', placeholder: 'https://xxxx.supabase.co',
        value: form.url, 'aria-label': '서버 주소',
        autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        oninput: function (event) { form.url = event.target.value; },
      });
      var keyInput = el('input', {
        type: 'password', class: 'text-input', placeholder: 'anon / public 열쇠',
        value: form.key, 'aria-label': 'anon 열쇠',
        autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        oninput: function (event) { form.key = event.target.value; },
      });
      void conf;
      body.push(urlInput);
      body.push(keyInput);
      body.push(el('p', { class: 'hint-line', text:
        'Supabase → Settings → API 에서 Project URL과 anon / public 을 복사하세요. ' +
        'service_role 열쇠는 넣으면 안 됩니다 — 보안 정책을 전부 무시하는 열쇠입니다.' }));
      body.push(el('button', {
        type: 'button', class: 'finish quiet', text: '저장하고 확인',
        onclick: function () {
          form.url = urlInput.value;
          form.key = keyInput.value;
          var problems = Remote.looksValid(form.url, form.key);
          if (problems.length > 0) {
            notice = { bad: true, text: problems.join(' ') };
            return draw();
          }
          Remote.patch({ url: form.url.trim(), anonKey: form.key.trim() });
          notice = { bad: false, text: '저장했습니다. 이제 아래에서 가입하거나 로그인하세요.' };
          draw();
        },
      }));
      }

      // ── ② 로그인
      if (Remote.configured()) {
        body.push(el('div', { class: 'list-label', text: '② 계정' }));

        if (Remote.signedIn()) {
          body.push(el('div', { class: 'server-row' }, [
            el('span', { class: 'plan-main' }, [
              el('span', { class: 'name', text: Remote.email() || '로그인됨' }),
              el('span', { class: 'plan-sets', text: syncStatusLine() }),
            ]),
            el('button', {
              type: 'button', class: 'demo-open', text: '로그아웃',
              onclick: function () {
                Remote.signOut().then(function () {
                  notice = { bad: false, text: '로그아웃했습니다. 이 기기의 기록은 그대로 있습니다.' };
                  draw();
                });
              },
            }),
          ]));
        } else {
          /*
           * 계정은 여기서 만들지 않는다. 주소·열쇠와 이메일·비밀번호가
           * 한 상자에 있으면 뭘 하는 화면인지 알 수가 없다.
           */
          body.push(el('button', {
            type: 'button', class: 'finish', text: '로그인 / 계정 만들기',
            onclick: function () { modal.close(); openAuth('signin'); },
          }));
        }
      }

      // ── ③ 맞추기
      if (Remote.signedIn()) {
        body.push(el('div', { class: 'list-label', text: '③ 기록 맞추기' }));
        body.push(el('p', { class: 'hint-line', text:
          '올릴 것 ' + storage.outbox().length + '개 · ' + syncStatusLine() }));
        body.push(el('button', {
          type: 'button', class: 'finish', text: state.syncing ? '맞추는 중…' : '지금 맞추기',
          disabled: state.syncing ? '' : null,
          onclick: function () { syncNow(draw); },
        }));

        /*
         * 지우는 길이 없으면 개인정보를 받을 자격이 없다. 되돌릴 수 없는
         * 일이므로 한 번 더 묻는다.
         */
        body.push(el('button', {
          type: 'button', class: 'finish danger', text: '서버에서 내 기록 지우기',
          onclick: function () {
            notice = { bad: true, text: '정말 지울까요? 서버의 기록이 모두 사라집니다. 이 기기의 기록은 남습니다.' };
            draw();
            body.push(null);
            var confirmBtn = el('button', {
              type: 'button', class: 'finish danger', text: '네, 서버에서 지웁니다',
              onclick: function () {
                Remote.deleteEverything().then(function () {
                  Remote.patch({ cursor: null });
                  notice = { bad: false, text: '서버에서 지웠습니다.' };
                  draw();
                }, function (error) {
                  notice = { bad: true, text: error.message };
                  draw();
                });
              },
            });
            modal.querySelector('.modal-body').appendChild(confirmBtn);
          },
        }));
      }

      body.push(el('p', { class: 'asset-note', text:
        '건강 기록은 민감정보입니다. 서버에 올리면 개인정보 처리방침에 위탁·보관 위치를 ' +
        '적어야 합니다. 자세한 내용은 저장소의 server/README.md에 있습니다.' }));

      openModal('서버', Remote.signedIn() ? (Remote.email() || '로그인됨')
        : (Remote.configured() ? '로그인 필요' : '설정 안 됨'), body);
    };

    draw();
  }

  /* ── 약속을 지킨 주 ────────────────────────────── */

  /**
   * 주 단위 연속.
   *
   * "며칠 연속"이 아니라 "이번 주에 하기로 한 횟수를 지켰나"다. 쉬는 날은
   * 약속에 이미 들어 있으므로 쉬어도 불이 꺼지지 않는다 — 죄책감 없이
   * 쉴 수 있어야 다음 주에 앱을 다시 연다.
   */
  /* ── 몸 ────────────────────────────────────────── */

  /**
   * 체중을 어느 쪽으로 가져가는가.
   *
   * 목표에서 읽는다. 따로 묻지 않는다 — 온보딩에서 이미 "체지방 감량"을
   * 골랐는데 다시 "빼실 건가요"를 물으면 그건 안 들은 것이다.
   */
  function bodyGoal() {
    return E.bodyGoalOf((state.answers && state.answers.goals) || []);
  }

  /** 체크인에 적힌 체중만 모은다. */
  function weighIns() {
    return (state.checkIns || [])
      .filter(function (item) { return item && typeof item.bodyweightKg === 'number'; })
      .map(function (item) { return { date: item.date, kg: item.bodyweightKg }; });
  }

  function bodyTrend() {
    return E.buildBodyTrend({
      weighIns: weighIns(),
      today: isoOf(new Date()),
      goal: bodyGoal(),
    });
  }

  /** 오늘 적은 단백질 답. */
  function proteinToday() {
    return E.proteinWeek(state.checkIns || [], isoOf(new Date()));
  }

  /**
   * 오늘 체크인에 한 칸을 적는다.
   *
   * 통증과 같은 줄에 담는다. 체중도 민감정보라 다루는 규칙이 같고,
   * 표를 따로 만들면 동기화·삭제·동의 철회를 두 벌 관리하게 된다.
   *
   * 날짜는 **진짜 오늘**이다. state.todayDate는 "오늘 할 운동 날"이라
   * 이번 주 뒤쪽 날짜일 수 있는데, 체중을 내일 날짜로 적으면 추세선이
   * 앞으로 넘어간다.
   */
  function saveBody(patch) {
    var today = isoOf(new Date());
    var existing = (state.checkIns || []).filter(function (item) {
      return item.date === today;
    })[0];
    var entry = Object.assign({}, existing, patch, {
      id: (existing && existing.id) || 'checkin-' + today,
      date: today,
    });
    var saved = storage.putCheckIn(entry);
    state.checkIns = (state.checkIns || [])
      .filter(function (item) { return item.date !== today; })
      .concat([saved]);
    syncSoon();
  }

  /* ── 티어 ──────────────────────────────────────── */

  /**
   * 등급.
   *
   * 아팠던 주는 빼고 센다. 통증을 적은 주에 등급을 깎으면 앱이 아픈 날
   * 나오라고 미는 셈이 되고, 그건 부상을 만드는 앱이다.
   */
  function currentTier() {
    var streak = currentStreak();
    var hurt = {};
    (state.checkIns || []).forEach(function (item) {
      if (!item || !item.pain) return;
      var bad = item.pain.filter(function (report) { return report.score >= 5; });
      if (bad.length === 0) return;
      hurt[mondayOf(item.date)] = true;
    });
    return E.buildTier({ weeks: streak.weeks, excused: Object.keys(hurt) });
  }

  /** 어느 주의 월요일인가. */
  function mondayOf(date) {
    var time = Date.parse(date + 'T00:00:00Z');
    if (isNaN(time)) return date;
    var at = new Date(time);
    var back = (at.getUTCDay() + 6) % 7;
    return new Date(time - back * 86400000).toISOString().slice(0, 10);
  }

  function currentStreak() {
    var sessions = state.history.slice();
    if (state.todaySets.length > 0) {
      sessions = sessions.concat([{ date: state.todayDate, sets: state.todaySets }]);
    }
    return E.buildStreak({
      sessions: sessions,
      thisMonday: state.monday,
      target: trainingDays().length,
      // 덜어내는 주는 프로그램이 정한다. 그 주는 절반만 나와도 지킨 것이다.
      deloadWeeks: state.plan.phase === 'deload' ? [state.monday] : [],
      today: state.todayDate,
    });
  }

  /**
   * 이번 주 리포트를 보여줄 때가 됐는가.
   *
   * 금요일부터, 또는 약속한 횟수를 이미 채운 날부터. 이미 본 주에는
   * 다시 말하지 않는다 — 같은 말을 두 번 하면 그때부터 잔소리다.
   */
  function reportReady() {
    if (state.reportSeenWeek === state.monday) return false;
    var streak = currentStreak();
    if (streak.thisWeek.kept) return true;
    // 월요일을 0으로 센 요일. 금요일이면 4다.
    var dayIndex = Math.round(
      (Date.parse(state.todayDate + 'T00:00:00Z') - Date.parse(state.monday + 'T00:00:00Z')) / 86400000);
    return dayIndex >= 4 && streak.thisWeek.days > 0;
  }

  /**
   * 주가 끝나갈 때 딱 한 번 뜨는 줄.
   *
   * 사람을 돌아오게 하는 건 알림 그 자체가 아니라 "뭔가 기다리고 있다"는
   * 것이다. 그래서 조르는 말이 아니라 보상이 준비됐다는 말만 쓰고, 같은
   * 주에 두 번 말하지 않는다 — 같은 말을 두 번 하면 그때부터 잔소리다.
   *
   * 진짜 푸시 알림(앱을 안 열어도 오는 것)은 서버가 있어야 한다. 여기
   * 있는 건 "열었을 때 보이는 것"이고, 그 이상을 약속하지 않는다.
   */
  function reportNudge() {
    if (!reportReady()) return null;
    return el('button', {
      type: 'button', class: 'report-nudge', onclick: openWeeklyReport,
    }, [
      el('span', { class: 'plan-main' }, [
        el('span', { class: 'name', text: '이번 주 리포트가 나왔습니다' }),
        el('span', { class: 'plan-sets', text: thisWeekReport().headline }),
      ]),
      el('span', { class: 'detail', text: '보기 ›' }),
    ]);
  }

  /** 연속 카드. 숫자 하나와 이번 주 점, 그리고 한 줄. */
  /* ── 친구 ──────────────────────────────────────── */

  /**
   * 친구에게 보이는 것을 올린다.
   *
   * **나온 날 수·목표·연속뿐이다.** 무게도 종목도 통증도 안 올라간다.
   * 서버가 내 기록을 뒤져 만들지 않고 내가 직접 올린다 — 그 통로를 안
   * 여는 것이 이 설계의 요점이다.
   */
  var lastWeekKey = null;

  function pushMyWeek() {
    if (!Remote.configured() || !Remote.signedIn() || !state.friendName) return Promise.resolve(null);
    var streak = currentStreak();
    var tier = currentTier();
    var key = [state.monday, streak.thisWeek.days, streak.thisWeek.target,
      streak.current, tier.score].join('|');
    if (key === lastWeekKey) return Promise.resolve(null);
    lastWeekKey = key;
    return Remote.putWeek(
      state.monday, streak.thisWeek.days, streak.thisWeek.target, streak.current, tier.score,
    ).catch(function () { return null; });
  }

  /** 친구 목록과 받은 응원을 새로 읽는다. */
  function loadFriends() {
    if (!Remote.configured() || !Remote.signedIn() || !state.friendName) return Promise.resolve(null);
    return Promise.all([Remote.myFriends(state.monday), Remote.myCheers()])
      .then(function (both) {
        state.friends = both[0] || [];
        state.cheersIn = both[1] || [];
        render();
      }, function () { return null; });
  }

  /**
   * 친구 카드.
   *
   * 연속 카드 바로 아래다. "한 번만 더 나오면 이번 주도 지킵니다"를 읽은
   * 직후가 남이 어떻게 하고 있는지 궁금해지는 자리다.
   */
  function friendsCard() {
    if (!Remote.configured() || !Remote.signedIn()) return null;

    var body = el('div', { class: 'sheet-body' }, []);

    /*
     * 이름부터 정한다. 본명이 아니라 헬스장에서 쓰는 별명이면 된다 —
     * 본명을 받아 두면 언젠가 그게 새는 사고가 난다.
     */
    if (!state.friendName) {
      body.appendChild(el('p', { class: 'hint-line', text:
        '친구와 서로 이번 주에 몇 번 나왔는지만 봅니다. ' +
        '무게도 종목도 아픈 곳도 보이지 않습니다.' }));
      body.appendChild(el('button', {
        type: 'button', class: 'finish', text: '친구 기능 켜기',
        onclick: openFriendName,
      }));
      return el('div', { class: 'sheet friends-card' }, [
        el('div', { class: 'sheet-head' }, [el('h3', { text: '함께' })]),
        body,
      ]);
    }

    var streak = currentStreak();
    var rows = (state.friends || []).map(function (row) {
      var made = E.friendRow({
        userId: row.user_id,
        name: row.name,
        days: row.days,
        target: row.target,
        streakWeeks: row.streak,
        lastCheerAt: row.last_cheer_at || undefined,
      // 하루 한 번은 **진짜 달력** 기준이다. 서버도 current_date로 막는다.
      // state.todayDate는 "오늘 할 날"이라 이번 주 뒤쪽 날짜일 수 있다.
      }, isoOf(new Date()));
      made.tier = E.tierBadge(row.tier_score || 0);
      return made;
    });

    /*
     * 챌린지.
     *
     * 목표는 나와 친구들이 **각자 하기로 한 횟수의 합**이다. 앱이 "이번 주
     * 10번!"을 정해 주면 주 3회 하기로 한 사람이 친구 때문에 5번 나온다.
     * 그건 챌린지가 아니라 부상이다.
     */
    var quest = E.groupQuest(
      { days: streak.thisWeek.days, target: streak.thisWeek.target },
      rows);

    if (quest) {
      var pct = Math.min(100, Math.round((quest.done / quest.target) * 100));
      body.appendChild(el('div', { class: 'quest' + (quest.kept ? ' kept' : '') }, [
        el('div', { class: 'quest-top' }, [
          el('span', { class: 'quest-text', text: quest.text }),
          el('span', { class: 'quest-count', text: quest.done + ' / ' + quest.target }),
        ]),
        el('div', { class: 'quest-track' }, [
          el('div', { class: 'quest-fill', style: 'width:' + pct + '%' }),
        ]),
        el('p', { class: 'hint-line', text: quest.kept
          ? '각자 자기 약속을 지켜서 채운 것입니다.'
          : '각자 하기로 한 횟수를 합친 목표입니다 — 더 하실 필요 없습니다.' }),
      ]));
    }

    if (rows.length === 0) {
      body.appendChild(el('p', { class: 'hint-line', text:
        '아직 친구가 없습니다. 코드를 주고받으면 서로 보입니다.' }));
    }

    rows.forEach(function (row) {
      /*
       * 점을 안 찍는다. 내 연속 카드에는 점이 있지만 여기서는 글이 이미
       * 같은 말을 하고 있어서("3번 다 채웠습니다"), 점을 더하면 좁은 줄에
       * 같은 정보가 두 번 들어가 글만 접힌다.
       */
      body.appendChild(el('div', { class: 'friend-row' + (row.kept ? ' kept' : '') }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name' }, [
            document.createTextNode(row.name),
            /*
             * 등급은 이름 옆 작은 꼬리표다. 숫자를 같이 쓰지 않는다 —
             * 점수가 보이면 친구끼리 점수를 비교하게 되고, 그 순간
             * 등수를 안 매기려고 한 설계가 무너진다.
             */
            row.tier ? el('span', { class: 'tier-chip', text: row.tier }) : null,
          ]),
          el('span', { class: 'plan-sets', text: row.text +
            (row.streakWeeks > 0 ? ' · ' + row.streakWeeks + '주 연속' : '') }),
        ]),
        el('button', {
          type: 'button', class: 'chip',
          disabled: row.canCheer ? null : '',
          title: row.canCheer ? row.name + '에게 응원 보내기' : '오늘은 이미 보냈습니다',
          text: row.canCheer ? '응원' : '보냄',
          onclick: function () { openCheer(row); },
        }),
      ]));
    });

    body.appendChild(el('button', {
      type: 'button', class: 'finish quiet', text: '친구 추가 · 내 코드',
      onclick: openFriendCode,
    }));

    return el('div', { class: 'sheet friends-card' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '함께' }),
        el('span', { class: 'meta', text: rows.length > 0 ? rows.length + '명' : '' }),
      ]),
      body,
    ]);
  }

  /**
   * 처음 켤 때 — 닉네임을 정하고 코드를 받는다.
   *
   * 이 이름은 **낯선 사람에게 보인다.** 그래서 규칙이 있고(nickname.ts),
   * 막을 때는 무엇을 고치면 되는지까지 말한다. "사용할 수 없는
   * 이름입니다"만 띄우면 사용자는 뭘 고쳐야 할지 모른 채 글자를 지웠다
   * 썼다 한다.
   */
  function openFriendName() {
    var draft = {
      name: state.friendName || '',
      notice: null,
      // 빈칸으로 두면 아무도 안 고친다. 누를 수 있는 후보를 깔아 둔다.
      seed: Math.floor(Math.random() * 100000),
    };
    var draw = function () {
      var body = [];
      body.push(el('p', { class: 'asset-note', text:
        '친구에게 보일 닉네임입니다. 본명은 쓰지 마세요 — 모르는 사람에게도 이대로 보입니다.' }));
      if (draft.notice) {
        body.push(el('div', { class: 'notice' }, [el('div', { text: draft.notice })]));
      }
      var input = el('input', {
        type: 'text', class: 'text-input', maxlength: String(E.NICKNAME_MAX),
        value: draft.name, placeholder: '예: 새벽리프터',
        oninput: function (event) { draft.name = event.target.value; },
      });
      body.push(input);

      body.push(el('div', { class: 'nick-suggest' }, [el('span', {
        class: 'asset-note', text: '생각나는 게 없으면',
      })].concat(E.suggestNicknames(draft.seed).map(function (name) {
        return el('button', {
          type: 'button', class: 'chip', text: name,
          onclick: function () {
            draft.name = name;
            draft.notice = null;
            draw();
          },
        });
      }))));

      body.push(el('button', {
        type: 'button', class: 'finish', text: '정하기',
        onclick: function () {
          var checked = E.checkNickname(draft.name);
          if (!checked.ok) {
            draft.notice = checked.message;
            return draw();
          }
          var clean = checked.value;
          Remote.setProfile(clean).then(function (code) {
            if (!code) {
              draft.notice = '이름을 저장하지 못했습니다. 잠시 뒤 다시 해 보세요.';
              return draw();
            }
            state.friendName = clean;
            state.friendCode = code;
            persist();
            /*
             * 닫았다 바로 여는 대신 내용만 갈아끼운다. 닫는 순간에
             * 딸려 오는 정리 작업과 다시 여는 것이 겹치면 빈 모달이 뜬다.
             */
            pushLog('함께', '<b>' + clean + '</b>' + E.particle(clean, '으로/로') +
              ' 친구 기능을 켰습니다. 내 코드는 ' + E.formatFriendCode(code) + '입니다.');
            pushMyWeek();
            loadFriends();
            render();
            openFriendCode();
          }, function () {
            draft.notice = '이름을 저장하지 못했습니다.';
            draw();
          });
        },
      }));
      openModal('닉네임 정하기', null, body);
      input.focus();
    };
    draw();
  }

  /** 내 코드를 보여주고 남의 코드를 받는다. */
  function openFriendCode() {
    var draft = { code: '', notice: null, busy: false };
    var draw = function () {
      var body = [];

      body.push(el('div', { class: 'my-code' }, [
        el('span', { class: 'list-label', text: '내 코드' }),
        el('b', { text: E.formatFriendCode(state.friendCode || '') }),
      ]));
      body.push(el('p', { class: 'hint-line', text:
        '이 코드를 아는 사람만 친구가 될 수 있습니다. ' +
        '이름이나 번호로는 찾을 수 없습니다 — 모르는 사람이 붙지 않게 하려는 것입니다.' }));

      body.push(el('div', { class: 'list-label', text: '친구 코드 넣기' }));
      if (draft.notice) {
        body.push(el('div', { class: 'notice' }, [el('div', { text: draft.notice })]));
      }
      var input = el('input', {
        type: 'text', class: 'text-input', maxlength: '8',
        value: draft.code, placeholder: 'ABC-123', autocapitalize: 'characters',
        oninput: function (event) { draft.code = event.target.value; },
      });
      body.push(input);
      body.push(el('button', {
        type: 'button', class: 'finish', disabled: draft.busy ? '' : null,
        text: draft.busy ? '찾는 중…' : '친구 추가',
        onclick: function () {
          var code = E.normalizeFriendCode(draft.code);
          if (!code) {
            draft.notice = '코드는 여섯 글자입니다. 0·O·1·I·L은 쓰지 않습니다.';
            return draw();
          }
          draft.busy = true; draw();
          Remote.addFriend(code).then(function (result) {
            draft.busy = false;
            if (!result || !result.ok) {
              draft.notice = result && result.reason === 'notFound'
                ? '그런 코드를 쓰는 분이 없습니다. 다시 확인해 주세요.'
                : result && result.reason === 'self'
                  ? '본인 코드입니다.'
                  : '코드를 확인해 주세요.';
              return draw();
            }
            draft.code = '';
            draft.notice = null;
            modal.close();
            pushLog('함께', '<b>' + result.name + '</b> 님과 친구가 됐습니다.');
            loadFriends();
          }, function () {
            draft.busy = false;
            draft.notice = '지금은 추가하지 못했습니다.';
            draw();
          });
        },
      }));

      if ((state.friends || []).length > 0) {
        body.push(el('div', { class: 'list-label', text: '친구 끊기' }));
        body.push(el('p', { class: 'hint-line', text:
          '끊으면 서로 안 보입니다. 상대에게는 알리지 않습니다.' }));
        (state.friends || []).forEach(function (row) {
          body.push(el('div', { class: 'friend-row' }, [
            el('span', { class: 'plan-main' }, [el('span', { class: 'name', text: row.name })]),
            el('button', {
              type: 'button', class: 'chip', text: '끊기',
              onclick: function () {
                Remote.removeFriend(row.user_id).then(function () {
                  pushLog('함께', row.name + ' 님과 친구를 끊었습니다.');
                  return loadFriends();
                }).then(function () { modal.close(); });
              },
            }),
          ]));
        });
      }

      openModal('친구', state.friendName || null, body);
    };
    draw();
  }

  /** 응원 보내기 — 정해진 문구만. */
  function openCheer(row) {
    var body = [];
    body.push(el('p', { class: 'asset-note', text:
      row.name + ' 님에게 보낼 말을 고르세요. 하루에 한 번 보낼 수 있습니다.' }));
    body.push(el('div', { class: 'summary-list' }, E.CHEERS.map(function (cheer) {
      return el('button', {
        type: 'button', class: 'menu-row',
        onclick: function () {
          Remote.sendCheer(row.userId, cheer.kind).then(function () {
            modal.close();
            pushLog('함께', row.name + ' 님에게 <b>' + cheer.text + '</b> 보냈습니다.');
            return loadFriends();
          });
        },
      }, [
        el('span', { class: 'plan-main' }, [el('span', { class: 'name', text: cheer.text })]),
        el('span', { class: 'detail', text: '›' }),
      ]);
    })));
    openModal('응원 보내기', row.name, body);
  }

  /** 받은 응원 한 줄. 읽으면 지운다. */
  function cheersBanner() {
    var cheers = state.cheersIn || [];
    if (cheers.length === 0) return null;

    var names = cheers.slice(0, 3).map(function (item) {
      return item.name + ' 님이 "' + E.cheerText(item.kind) + '"';
    }).join(' · ');

    return el('button', {
      type: 'button', class: 'cheer-banner',
      onclick: function () {
        Remote.markCheersSeen().then(function () {
          state.cheersIn = [];
          render();
        });
      },
    }, [
      el('span', { text: names }),
      el('span', { class: 'count-tempo', text: '확인' }),
    ]);
  }

  /* ── 다시 부르기 ───────────────────────────────── */

  /**
   * 다음에 부를 시각.
   *
   * 늘 가던 시각 한 시간 전이다(nudge.ts). 다만 **지금으로부터 두 시간
   * 안이면 내일로 미룬다** — 방금 앱을 연 사람에게 한 시간 뒤에 "나오세요"는
   * 도움이 아니라 잔소리다.
   */
  var NUDGE_MIN_LEAD_MS = 2 * 60 * 60 * 1000;

  function nudgeSlots() {
    /*
     * 약속이 있으면 짐작하지 않는다.
     *
     * 전에는 지금까지 운동을 시작한 시각의 중앙값으로 때를 맞췄다. 그건
     * 짐작이고, 짐작으로 울리는 알림은 "늘 이쯤 가시던데요"밖에 못 된다.
     * 약속이 있으면 **그 사람이 직접 정한 자리**를 가리킬 수 있다.
     */
    var promised = nextPromise();
    var first = new Date();
    if (promised) {
      first.setDate(first.getDate() + promised.daysAhead);
      var at = E.leadMinutesFor(promised.slot);
      first.setHours(Math.floor(at / 60), at % 60, 0, 0);
    } else {
      var starts = state.history
        .map(function (session) { return session.startedAt; })
        .filter(Boolean)
        .slice(-12)
        .map(function (stamp) { return new Date(stamp).getHours(); });
      first.setHours(E.nudgeHour(starts), 0, 0, 0);
    }
    if (first.getTime() - Date.now() < NUDGE_MIN_LEAD_MS) first.setDate(first.getDate() + 1);

    /*
     * 하루만 보고 포기하지 않는다.
     *
     * 오늘 이미 운동한 사람은 오늘 부를 이유가 없다. 그렇다고 예약을
     * 지워 버리면, 그 사람이 앱을 다시 안 여는 한 이번 주 내내 아무
     * 알림도 안 간다. 부를 만한 첫날을 찾을 때까지 앞으로 걸어 본다.
     *
     * 이번 주까지만 본다. 다음 주가 되면 횟수도 남은 날도 달라져서,
     * 지금 정한 말이 그때는 틀린 말이 된다.
     */
    var slots = [];
    for (var i = 0; i < 7; i += 1) {
      var at = new Date(first);
      at.setDate(at.getDate() + i);
      if (isoOf(at) > E.addDays(E.weekStart(isoOf(first)), 6)) break;
      slots.push(at);
    }
    return slots;
  }

  /** 그 날짜(YYYY-MM-DD) 기준으로 이번 주에 몇 번 나왔고 며칠 남았나. */
  function weekShapeOn(dateISO) {
    var monday = E.weekStart(dateISO);
    var sunday = E.addDays(monday, 6);
    var sessions = state.history.concat(
      state.todaySets.length > 0 ? [{ date: state.todayDate, sets: state.todaySets }] : []);

    var days = {};
    sessions.forEach(function (session) {
      if (session.date < monday || session.date > sunday) return;
      if (!session.sets || session.sets.length === 0) return;
      days[session.date] = true;
    });

    var left = 0;
    for (var d = dateISO; d <= sunday; d = E.addDays(d, 1)) left += 1;

    return {
      daysThisWeek: Object.keys(days).length,
      daysLeftInWeek: left,
      trainedOnThatDay: Boolean(days[dateISO]),
      isThisWeek: monday === state.monday,
    };
  }

  /**
   * 알림을 예약한다 — 또는 지운다.
   *
   * 앱을 열 때, 세트를 기록할 때, 체크인할 때마다 다시 계산해 덮어쓴다.
   * 쌓이지 않고 늘 하나만 남는다.
   *
   * **판단은 여기서 끝낸다.** 서버로 올라가는 것은 "언제, 뭐라고"뿐이라
   * 서버는 통증도 세션도 볼 필요가 없다.
   */
  function scheduleNudge() {
    if (typeof FitPush === 'undefined' || !FitPush.configured()) return Promise.resolve(null);
    if (!Remote.configured() || !Remote.signedIn()) return Promise.resolve(null);

    return FitPush.current().then(function (subscription) {
      if (!subscription) return null;

      var streak = currentStreak();
      var worstPain = state.pain.reduce(function (worst, report) {
        return Math.max(worst, report.score || 0);
      }, 0);
      var slots = nudgeSlots();

      for (var i = 0; i < slots.length; i += 1) {
        var at = slots[i];
        var shape = weekShapeOn(isoOf(at));
        var decision = E.decideNudge({
          daysThisWeek: shape.daysThisWeek,
          target: shape.isThisWeek ? streak.thisWeek.target : trainingDays().length,
          daysLeftInWeek: shape.daysLeftInWeek,
          worstPain: worstPain,
          streakWeeks: streak.current,
          sentThisWeek: 0,
          trainedToday: shape.trainedOnThatDay,
        });

        if (decision.send) {
          return Remote.queueNudge(subscription, at.toISOString(), decision.title, decision.body);
        }
        /*
         * 아프거나 이번 주 약속을 이미 지켰으면 그 뒤 날을 봐도 같은
         * 답이다. 더 걸어 보지 않는다.
         */
        if (decision.skip === 'pain' || decision.skip === 'done') break;
      }

      /*
       * 부를 날이 없으면 예약을 지운다. 남겨 두면 어제 정한 말이 오늘
       * 울린다 — 이미 운동하고 나온 사람에게.
       */
      return Remote.cancelNudge();
    }).catch(function () {
      // 예약에 실패해도 앱은 그대로 돈다. 알림은 있으면 좋은 것이지 기록이 아니다.
      return null;
    });
  }

  /**
   * 다시 계산할 때가 됐을 때만 부른다.
   *
   * persist()는 세트를 하나 칠 때마다 돌기 때문에, 거기서 바로 예약을
   * 올리면 한 세션에 스무 번 넘게 서버를 부른다. **판단이 달라질 만한
   * 것이 바뀌었을 때만** 올린다 — 오늘 처음 한 세트, 통증, 날이 바뀐 것.
   */
  var nudgeKey = null;
  var nudgeTimer = null;

  function scheduleNudgeSoon() {
    if (!state.nudgeOn) return;
    var worst = state.pain.reduce(function (max, report) {
      return Math.max(max, report.score || 0);
    }, 0);
    var key = [state.todayDate, state.todaySets.length > 0, worst, state.history.length].join('|');
    if (key === nudgeKey) return;
    nudgeKey = key;

    // 연달아 바뀌면 마지막 것만 올린다.
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(function () {
      nudgeTimer = null;
      scheduleNudge();
    }, 4000);
  }

  /** Date → YYYY-MM-DD. 그 기기의 달력 기준이다. */
  function isoOf(date) {
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  /**
   * 티어 카드.
   *
   * 연속 카드 바로 아래 둔다. 둘은 같은 숫자를 다르게 보는 것이다 —
   * 연속은 "지금 몇 주째", 티어는 "지금까지 전부 몇 주". 연속이 끊긴
   * 주에 티어가 그대로인 것을 눈으로 봐야 "다 날아간 게 아니구나"가
   * 전해진다. 그 한 장면이 돌아오게 만든다.
   */
  function tierCard(tier) {
    var ladder = el('div', { class: 'tier-ladder', 'aria-hidden': 'true' }, []);
    E.TIERS.forEach(function (step) {
      var reached = tier.tier && step.weeks <= tier.tier.weeks;
      ladder.appendChild(el('i', { class: reached ? 'on' : '' }));
    });

    // 다음 등급까지 얼마나 왔나. 등수가 아니라 거리다.
    var bar = null;
    if (tier.next) {
      var floor = tier.tier ? tier.tier.weeks : 0;
      var pct = Math.max(0, Math.min(100,
        Math.round(((tier.score - floor) / (tier.next.weeks - floor)) * 100)));
      bar = el('div', { class: 'tier-track' }, [
        el('div', { class: 'tier-fill', style: 'width:' + pct + '%' }),
      ]);
    }

    return el('div', { class: 'tier-card' + (tier.tier ? ' lit' : '') + (tier.atRisk ? ' risk' : '') }, [
      el('div', { class: 'tier-top' }, [
        el('span', { class: 'tier-name', text: tier.tier ? tier.tier.name : '아직 등급 없음' }),
        ladder,
        el('span', { class: 'tier-score', text: '지킨 주 ' + tier.score }),
      ]),
      bar,
      /*
       * 등급 이름이 제목에 이미 있다. 엔진이 주는 줄은 알림이나 친구
       * 화면에서 혼자 서야 해서 이름을 달고 오는데, 이 카드에서는 같은
       * 말이 두 번 된다. 앞머리만 떼고 쓴다.
       */
      el('p', { class: 'tier-msg', text:
        tier.tier ? tier.message.replace(tier.tier.name + ' · ', '') : tier.message }),
      /*
       * 무엇을 기준으로 나누는지는 **처음 몇 주만** 말한다. 실버까지 온
       * 사람은 이미 안다 — 매주 같은 설명이 붙으면 그 자리부터 안 읽는다.
       */
      !tier.tier || tier.tier.id === 'bronze'
        ? el('p', { class: 'hint-line', text:
          '드는 무게가 아니라 약속을 지킨 주로 나눕니다. 주 3회를 여덟 주 지킨 사람이 ' +
          '주 1회 나오는 사람보다 위입니다.' })
        : null,
    ]);
  }

  function streakCard(streak) {
    var dots = E.weekDots(streak.thisWeek);
    var row = el('span', { class: 'streak-dots', 'aria-hidden': 'true' }, []);
    for (var i = 0; i < dots.done; i += 1) row.appendChild(el('i', { class: 'on' }));
    for (var j = 0; j < dots.left; j += 1) row.appendChild(el('i', {}));

    return el('div', { class: 'streak-card' + (streak.current > 0 ? ' lit' : '') }, [
      el('div', { class: 'streak-top' }, [
        el('span', { class: 'streak-num' }, [
          el('b', { text: String(streak.current) }),
          el('span', { text: '주 연속' }),
        ]),
        row,
        el('span', { class: 'streak-count', text:
          streak.thisWeek.days + ' / ' + streak.thisWeek.target +
          (streak.thisWeek.deload ? ' · 덜어내는 주' : '') }),
      ]),
      el('p', { class: 'streak-msg', text: streak.message }),
      streak.best > streak.current
        ? el('p', { class: 'hint-line', text: '최고 ' + streak.best + '주 연속' })
        : null,
      streak.freezeAvailable
        ? el('p', { class: 'hint-line', text: '쉼표 1개 — 한 주 쉬어도 연속이 이어집니다.' })
        : null,
      nudgeRow(),
    ]);
  }

  /**
   * "다시 불러 드릴까요" 한 줄.
   *
   * 연속 카드 안에 둔다. 알림을 켤 마음이 드는 자리는 설정 화면이 아니라
   * **"한 번만 더 나오면 이번 주도 지킵니다"를 읽은 직후**다.
   *
   * 권한은 누른 그 순간에 묻는다. 앱을 켜자마자 뜨는 브라우저 창은 대개
   * 거절당하고, 한 번 거절되면 다시 못 묻는다.
   */
  function nudgeRow() {
    if (typeof FitPush === 'undefined' || !FitPush.configured()) return null;
    if (!Remote.configured() || !Remote.signedIn()) return null;

    /*
     * iOS는 홈 화면에 설치한 PWA만 알림을 받는다. 사파리 탭에서는 권한
     * 창조차 안 뜬다 — 눌러도 아무 일이 없는 버튼 대신 왜 안 되는지 적는다.
     */
    var iosTab = /iphone|ipad|ipod/i.test(navigator.userAgent) && !state.standalone;
    if (iosTab) {
      return el('p', { class: 'hint-line', text:
        '다시 불러 드리려면 홈 화면에 설치하셔야 합니다 — 아이폰은 설치한 앱에만 알림이 옵니다.' });
    }

    if (FitPush.permission() === 'denied') {
      return el('p', { class: 'hint-line', text:
        '알림이 막혀 있습니다. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.' });
    }

    if (state.nudgeOn) {
      return el('button', {
        type: 'button', class: 'nudge-row', 'aria-pressed': 'true',
        onclick: function () {
          state.nudgeOn = false;
          persist();
          FitPush.disable();
          Remote.cancelNudge();
          pushLog('알림', '다시 부르기를 껐습니다.');
          render();
        },
      }, [
        el('span', { text: '이번 주가 빡빡하면 한 번 불러 드립니다' }),
        el('span', { class: 'count-tempo', text: '켜짐' }),
      ]);
    }

    return el('button', {
      type: 'button', class: 'nudge-row', 'aria-pressed': 'false',
      onclick: function () {
        FitPush.enable().then(function (result) {
          if (!result.ok) {
            pushLog('알림', result.reason === 'denied'
              ? '알림이 거절됐습니다. 브라우저 설정에서 허용하시면 켤 수 있습니다.'
              : '알림을 켜지 못했습니다.');
            return render();
          }
          state.nudgeOn = true;
          persist();
          pushLog('알림', '이번 주가 빡빡하면 한 번 불러 드립니다. ' +
            '<b>아프다고 적으신 날은 부르지 않습니다.</b>');
          return scheduleNudge().then(render, render);
        });
      },
    }, [
      el('span', { text: '이번 주가 빡빡하면 불러 드릴까요?' }),
      el('span', { class: 'count-tempo', text: '꺼짐' }),
    ]);
  }

  /* ── 주간 리포트 한 장 ─────────────────────────── */

  function thisWeekReport() {
    return E.buildWeeklyReport({
      sessions: weekSessions(),
      history: state.history,
      landmarks: state.landmarks,
      index: index,
      from: state.monday,
      to: E.addDays(state.monday, 6),
      targetSessions: trainingDays().length,
    });
  }

  /**
   * 한 주를 이미지 한 장으로.
   *
   * 회원을 붙잡는 건 기능이 아니라 **한 주가 끝났을 때 손에 남는 것**이다.
   * 카톡으로 보낼 수 있는 한 장이 있으면 그 주가 기억에 남고, 다음 주에
   * 앱을 다시 연다.
   *
   * 카카오톡·인스타에 맞춰 1080×1350으로 그린다. 글꼴은 기기에 있는 것을
   * 쓰되, 없으면 기본 산세리프로 떨어뜨린다 — 글꼴 때문에 그림이 안 나오면
   * 안 된다.
   */
  var CARD_W = 1080;
  var CARD_H = 1350;

  function drawReportCard(report, dark, streak) {
    var canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var ink = dark ? '#e7e9ee' : '#14161b';
    var muted = dark ? '#949bab' : '#656c7a';
    var accent = dark ? '#8b87ff' : '#4540c9';
    var line = dark ? '#2b3038' : '#d3d7de';
    var sans = '"IBM Plex Sans KR", -apple-system, "Apple SD Gothic Neo", sans-serif';
    var mono = '"IBM Plex Mono", ui-monospace, monospace';

    ctx.fillStyle = dark ? '#0f1116' : '#faf9f5';
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    var pad = 84;
    var y = 118;

    // 머리 — 앱 이름은 작게, 주차는 크게
    ctx.fillStyle = muted;
    ctx.font = '400 30px ' + mono;
    ctx.fillText('VOLUME COACH', pad, y);
    y += 74;
    ctx.fillStyle = ink;
    ctx.font = '600 68px ' + sans;
    ctx.fillText(report.weekLabel, pad, y);

    /*
     * 연속 주는 오른쪽 위에. "7주 연속"은 "37일 연속"보다 말하기 좋고,
     * 카톡에 올렸을 때 사람들이 제일 먼저 보는 숫자다.
     */
    if (streak && streak.current > 0) {
      var tag = streak.current + '주 연속';
      ctx.font = '600 40px ' + sans;
      var tagW = ctx.measureText(tag).width + 48;
      ctx.fillStyle = dark ? '#262346' : '#e7e6fa';
      roundRect(ctx, CARD_W - pad - tagW, y - 48, tagW, 66, 33);
      ctx.fillStyle = accent;
      ctx.fillText(tag, CARD_W - pad - tagW + 24, y - 2);
    }

    // 한 줄 제목 — 이 장에서 제일 큰 글씨여야 한다
    y += 82;
    ctx.fillStyle = accent;
    ctx.font = '600 46px ' + sans;
    wrapText(ctx, report.headline, pad, y, CARD_W - pad * 2, 60);
    y += 60 * countLines(ctx, report.headline, CARD_W - pad * 2) + 42;

    // 숫자 셋
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(CARD_W - pad, y); ctx.stroke();
    y += 66;

    var stats = [
      { value: String(report.sessionCount), unit: '회', key: '운동' },
      { value: String(report.setCount), unit: '세트', key: '기록' },
      { value: (report.tonnage / 1000).toFixed(1), unit: 't', key: '든 무게' },
    ];
    var colW = (CARD_W - pad * 2) / 3;
    stats.forEach(function (stat, i) {
      var x = pad + colW * i;
      ctx.fillStyle = ink;
      ctx.font = '600 72px ' + mono;
      ctx.fillText(stat.value, x, y);
      var w = ctx.measureText(stat.value).width;
      ctx.fillStyle = muted;
      ctx.font = '400 30px ' + sans;
      ctx.fillText(stat.unit, x + w + 10, y);
      ctx.font = '400 26px ' + sans;
      ctx.fillText(stat.key, x, y + 44);
    });
    y += 96;

    /*
     * 유산소. 근력 숫자와 같은 줄에 섞지 않는다 — 세트와 분은 단위가
     * 다르고, 섞으면 둘 다 안 읽힌다. 한 줄 아래에 조용히 둔다.
     */
    if (report.cardio && report.cardio.count > 0) {
      ctx.fillStyle = muted;
      ctx.font = '400 28px ' + sans;
      ctx.fillText('유산소 ' + report.cardio.count + '회 · ' + report.cardio.minutes + '분', pad, y);
      y += 46;
    }

    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(CARD_W - pad, y); ctx.stroke();
    y += 58;

    // 부위별 게이지 — 부족한 주는 부족하게 그려야 다음 장을 믿는다
    ctx.fillStyle = muted;
    ctx.font = '400 26px ' + mono;
    ctx.fillText('부위별 주간 볼륨', pad, y);
    y += 46;

    var zoneColor = {
      underMev: dark ? '#8a92a1' : '#7a8290',
      mevToMav: dark ? '#34b37c' : '#17784f',
      mavToMrv: dark ? '#d79a2e' : '#a66a00',
      overMrv: dark ? '#e4695b' : '#c0392b',
    };
    /*
     * 아래 "다음 주" 상자와 겹치면 안 된다. 잘린 글씨가 있는 이미지를
     * 카톡에 올리면 앱이 허술해 보이고, 그게 회원한테 그대로 간다.
     * 남은 자리를 먼저 계산하고 들어가는 만큼만 그린다.
     */
    var floor = CARD_H - 278;
    var gainRoom = report.gains.length > 0 ? 20 + 44 + 46 * report.gains.length : 0;
    var muscleRoom = floor - gainRoom;
    var drawn = report.muscles.filter(function () { return true; }).slice(0, 6);

    drawn.forEach(function (row) {
      if (y + 50 > muscleRoom) return;
      ctx.fillStyle = ink;
      ctx.font = '500 32px ' + sans;
      ctx.fillText(row.label, pad, y + 26);

      var barX = pad + 180;
      var barW = CARD_W - pad * 2 - 180 - 150;
      ctx.fillStyle = dark ? '#1f232a' : '#eceef2';
      roundRect(ctx, barX, y, barW, 34, 8);
      ctx.fillStyle = zoneColor[row.zone] || muted;
      roundRect(ctx, barX, y, Math.max(8, barW * Math.min(1, row.fill)), 34, 8);

      ctx.fillStyle = muted;
      ctx.font = '400 28px ' + mono;
      ctx.fillText(row.sets + '세트', barX + barW + 20, y + 26);
      y += 50;
    });

    // 오른 종목
    if (report.gains.length > 0 && y + 44 + 46 <= floor) {
      y += 34;
      ctx.fillStyle = muted;
      ctx.font = '400 26px ' + mono;
      ctx.fillText('이번 주에 오른 것', pad, y);
      y += 44;
      report.gains.forEach(function (gain) {
        if (y > floor) return;
        ctx.fillStyle = ink;
        ctx.font = '500 34px ' + sans;
        ctx.fillText(gain.name, pad, y);
        ctx.fillStyle = dark ? '#34b37c' : '#17784f';
        ctx.font = '600 34px ' + mono;
        var text = gain.detail;
        ctx.fillText(text, CARD_W - pad - ctx.measureText(text).width, y);
        y += 46;
      });
    }

    // 다음 주 지시 — 칭찬이 아니라 지시다
    var boxY = CARD_H - 236;
    ctx.fillStyle = dark ? '#181b21' : '#ffffff';
    roundRect(ctx, pad, boxY, CARD_W - pad * 2, 160, 20);
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.fillStyle = muted;
    ctx.font = '400 24px ' + mono;
    ctx.fillText('다음 주', pad + 36, boxY + 50);
    ctx.fillStyle = ink;
    ctx.font = '500 32px ' + sans;
    wrapText(ctx, report.advice, pad + 36, boxY + 96, CARD_W - pad * 2 - 72, 42);

    return canvas;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  /** 캔버스에는 줄바꿈이 없다. 글자 폭을 재서 직접 끊는다. */
  function splitLines(ctx, text, maxWidth) {
    var words = String(text).split(' ');
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    splitLines(ctx, text, maxWidth).forEach(function (line, i) {
      ctx.fillText(line, x, y + lineHeight * i);
    });
  }

  function countLines(ctx, text, maxWidth) {
    return splitLines(ctx, text, maxWidth).length;
  }

  /**
   * 주간 리포트 화면.
   *
   * 미리보기를 화면에 그대로 띄운다 — 보내기 전에 뭘 보내는지 봐야 한다.
   */
  function openWeeklyReport() {
    state.reportSeenWeek = state.monday;
    persist();
    var report = thisWeekReport();
    var dark = document.documentElement.getAttribute('data-theme') === 'dark'
      || (document.documentElement.getAttribute('data-theme') !== 'light'
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

    var streak = currentStreak();
    var canvas = drawReportCard(report, dark, streak);
    var body = [];

    if (canvas) {
      canvas.className = 'report-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', report.weekLabel + ' 주간 리포트 — ' + report.headline);
      body.push(canvas);
    }

    /*
     * 이미지를 못 만드는 기기가 있다. 그때도 빈손으로 두지 않는다 —
     * 글로 복사해서 보내면 된다.
     */
    body.push(el('div', { class: 'report-actions' }, [
      el('button', {
        type: 'button', class: 'finish',
        text: canvas ? '이미지로 저장 · 공유' : '글로 복사하기',
        onclick: function () { shareReport(report, canvas); },
      }),
      el('button', {
        type: 'button', class: 'demo-open wide', text: '글로 복사하기',
        onclick: function () { copyReportText(report); },
      }),
    ]));

    body.push(el('p', { class: 'asset-note', text:
      '건강 정보가 담긴 이미지입니다. 어디로 보낼지는 직접 고르시고, ' +
      '단톡방처럼 여러 사람이 보는 곳에는 올리기 전에 한 번 더 생각해 보세요.' }));

    openModal('주간 리포트', report.weekLabel, body);
  }

  function shareReport(report, canvas) {
    if (!canvas || !canvas.toBlob) return copyReportText(report);

    canvas.toBlob(function (blob) {
      if (!blob) return copyReportText(report);
      var name = '볼륨코치-' + report.to + '.png';
      var file = null;
      try { file = new File([blob], name, { type: 'image/png' }); } catch (err) { void err; }

      // 폰이면 공유 시트가 뜬다 — 카톡이 거기 있다.
      if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], text: E.reportText(report) })
          .catch(function () { downloadBlob(blob, name); });
        return;
      }
      downloadBlob(blob, name);
    }, 'image/png');
  }

  function downloadBlob(blob, name) {
    /*
     * 미리보기(아티팩트 뷰어) 안에서는 보통의 다운로드 링크가 아무 일도
     * 하지 않는다. 거기서만 쓰는 저장 통로가 따로 있으므로, 있으면 그걸
     * 쓰고 없으면 평소대로 간다 — 진짜 폰에서는 아래 링크가 맞다.
     */
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('downloads').then(function (downloads) {
        if (!downloads) return saveByLink(blob, name);
        downloads.save({ filename: name, data: blob }).then(function () {
          pushLog('주간 리포트', '<b>' + name + '</b>으로 저장했습니다.');
          renderLog();
        }, function () {
          // 사용자가 거절했거나 이 화면에서는 저장이 안 된다. 다시 묻지 않는다.
          pushLog('주간 리포트', '저장하지 않았습니다. 글로 복사하는 길이 아래에 있습니다.');
          renderLog();
        });
      }, function () { saveByLink(blob, name); });
      return;
    }
    saveByLink(blob, name);
  }

  function saveByLink(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    pushLog('주간 리포트', '<b>' + name + '</b>으로 저장했습니다.');
    renderLog();
  }

  function copyReportText(report) {
    var text = E.reportText(report);
    var done = function () {
      pushLog('주간 리포트', '글로 복사했습니다. 카톡에 붙여 넣으면 됩니다.');
      renderLog();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (err) { void err; }
    area.remove();
  }

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

    /*
     * 한 주가 끝났을 때 손에 남는 것. 회원을 붙잡는 건 기능이 아니라
     * 이것이고, 그래서 주간 탭 맨 위에 둔다.
     */
    screen.appendChild(streakCard(currentStreak()));
    screen.appendChild(tierCard(currentTier()));
    var nudge = reportNudge();
    if (nudge) screen.appendChild(nudge);

    var weekReport = thisWeekReport();
    screen.appendChild(el('button', {
      type: 'button', class: 'report-cta',
      onclick: openWeeklyReport,
    }, [
      el('span', { class: 'plan-main' }, [
        el('span', { class: 'name', text: '이번 주 리포트' }),
        el('span', { class: 'plan-sets', text: weekReport.headline }),
      ]),
      el('span', { class: 'detail', text: '카톡으로 ›' }),
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
  /* ── 통증 이력 ─────────────────────────────────── */

  function painTimeline() {
    if (!E.allows(state.consent, 'painGate')) return [];
    return E.painHistory({
      checkIns: state.checkIns,
      sessions: state.history,
      index: index,
      today: state.todayDate,
    });
  }

  /**
   * 통증 이력.
   *
   * "오늘 어깨가 아프다"는 한 번 듣고 종목을 바꾸면 끝나는 정보다.
   * 20년 한 트레이너가 실제로 쓰는 건 **"왼쪽 어깨, 3주째, 항상
   * 오버헤드 다음 날"** 이다. 한 점이 아니라 선을 본다.
   *
   * 진단하지 않는다. 여기 있는 건 "언제부터, 얼마나, 어떤 동작 뒤에
   * 보고됐는가"뿐이다.
   */
  function renderPainHistory() {
    var history = painTimeline();
    if (history.length === 0) return;

    var body = el('div', { class: 'sheet-body tight' }, []);
    var list = el('div', { class: 'summary-list' }, []);

    history.forEach(function (item) {
      var row = el('div', { class: 'pain-row' + (item.latest >= 3 ? ' live' : '') }, [
        el('div', { class: 'pain-top' }, [
          el('b', { text: item.label }),
          el('span', { class: 'pain-score ' + trendClass(item.trend), text:
            item.latest >= 3 ? item.latest + '점' : '지금은 없음' }),
          el('span', { class: 'pain-spark' }, sparkFor(item)),
        ]),
        el('p', { class: 'pain-line', text: item.summary }),
      ]);

      /*
       * 유발 후보는 "같이 나왔다"까지만 말한다. 원인이라고 말하는
       * 순간 앱이 진단을 하는 것이고, 그건 넘으면 안 되는 선이다.
       */
      if (item.triggers.length > 0) {
        row.appendChild(el('p', { class: 'pain-trigger', text:
          item.triggers.map(function (trigger) {
            return trigger.label + ' ' + Math.round(trigger.rate * 100) + '%';
          }).join(' · ') + ' · 안 한 날 ' +
          Math.round(item.triggers[0].baseRate * 100) + '%' }));
        row.appendChild(el('p', { class: 'pain-trigger quiet', text:
          item.ambiguous
            ? '늘 같은 날에 해서 어느 쪽인지는 이 기록으로 가릴 수 없습니다. 한 번씩 빼 보면 알 수 있습니다.'
            : '같이 나왔다는 뜻이지 원인이라는 뜻은 아닙니다.' }));
      }

      if (item.referral) {
        row.appendChild(el('div', { class: 'notice stop' }, [
          el('div', { class: 'label', text: '전문의' }),
          el('div', { text: item.referral }),
        ]));
      }

      list.appendChild(row);
    });

    body.appendChild(list);

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '통증 이력' }),
        el('span', { class: 'meta', text: '최근 4개월' }),
      ]),
      body,
    ]));
  }

  function trendClass(trend) {
    if (trend === 'better') return 'better';
    if (trend === 'worse') return 'worse';
    if (trend === 'gone') return 'gone';
    return '';
  }

  /*
   * 점수 흐름을 막대 몇 개로.
   *
   * 그래프를 그릴 만큼의 이야기가 아니다. "올라가는 중인가 내려가는
   * 중인가"만 보이면 되고, 그건 막대 여덟 개면 충분하다.
   */
  function sparkFor(item) {
    return item.points.slice(-8).map(function (point) {
      return el('i', {
        style: 'height:' + Math.max(3, Math.round(point.score / 10 * 18)) + 'px',
        title: point.date + ' · ' + point.score + '점',
      });
    });
  }

  /**
   * 몸 — 체중 추세와 단백질.
   *
   * 식단표를 만들지 않는다. 끼니를 적게 하는 앱은 3주를 못 간다.
   * 여기서 묻는 것은 하루에 두 가지뿐이다 — **아침 체중 한 번**과
   * **단백질 채웠나 한 번.** 둘 다 10초다.
   *
   * 통증 카드 위에 둔다. 체중은 아침에 재고 통증은 운동 직전에 적는데,
   * 체크인 탭을 여는 사람의 절반은 아침에 연다.
   */
  function bodyCard() {
    /*
     * 체중은 민감정보다(제23조). healthData 동의가 그 근거이고, 그 동의가
     * 없으면 칸 자체를 띄우지 않는다 — 적을 수 있게 해 놓고 저장만 안 하면
     * 동의를 안 받은 채로 받은 것이 된다.
     */
    if ((state.consent || []).indexOf('healthData') < 0) return null;

    var today = isoOf(new Date());
    var mine = (state.checkIns || []).filter(function (item) { return item.date === today; })[0];
    var trend = bodyTrend();
    var goal = bodyGoal();
    var shown = (mine && mine.bodyweightKg)
      || (trend.latest && trend.latest.kg)
      || (state.lifter && state.lifter.bodyweightKg)
      || 70;

    var body = el('div', { class: 'sheet-body' }, []);

    body.appendChild(numberRow({
      name: '오늘 아침 체중',
      value: shown,
      min: 30,
      max: 250,
      step: 0.1,
      unit: 'kg',
      id: 'today-weight',
      hint: mine && typeof mine.bodyweightKg === 'number' ? '오늘 적었습니다.' : null,
      onInput: function (value) {
        saveBody({ bodyweightKg: value });
        /*
         * 첫 중량 추정이 체중을 본다. 추세는 평균으로 보지만 처방은
         * 지금 몸무게를 봐야 하므로 여기서 같이 갱신한다.
         */
        state.lifter = Object.assign({}, state.lifter, { bodyweightKg: value });
        persist();
        render();
      },
    }));

    body.appendChild(el('p', { class: 'trend-line', text: trend.message }));
    if (trend.warning) {
      body.appendChild(el('p', { class: 'hint-line warn', text: trend.warning }));
    }
    var hold = E.holdLoadWhileCutting(trend, goal);
    if (hold) body.appendChild(el('p', { class: 'hint-line', text: hold }));

    var spark = trendSpark(trend);
    if (spark) body.appendChild(spark);

    /* ── 단백질 ── */
    var target = E.proteinTargetG(shown, goal);
    var week = proteinToday();
    var done = week.answeredToday && week.hitToday;

    body.appendChild(el('div', { class: 'protein-head' }, [
      el('span', { class: 'protein-target', text: '하루 ' + target + 'g' }),
      el('span', { class: 'protein-week', text: '이번 주 ' + week.hits + '일 채움' }),
    ]));
    body.appendChild(el('p', { class: 'hint-line', text: E.proteinHint(target) }));

    body.appendChild(el('button', {
      type: 'button',
      class: 'protein-toggle',
      'aria-pressed': String(done),
      onclick: function () {
        saveBody({ proteinHit: !done });
        render();
      },
    }, [
      el('span', { text: done ? '오늘 단백질 채웠습니다' : '오늘 단백질 채웠나요?' }),
      el('span', { class: 'count-tempo', text: done ? '✓' : '누르기' }),
    ]));

    body.appendChild(el('p', { class: 'hint-line', text: week.message }));
    var risk = E.proteinRisk(week, goal, trend.pace === 'down' || trend.pace === 'fastDown');
    if (risk) body.appendChild(el('p', { class: 'hint-line warn', text: risk }));

    return el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '몸' }),
        el('span', { class: 'meta', text: '하루 10초' }),
      ]),
      body,
    ]);
  }

  /**
   * 추세선.
   *
   * 하루값은 흐리게, 7일 평균은 진하게 긋는다. 두 선을 겹쳐 놔야
   * "내 저울이 튀는 거지 내가 못한 게 아니다"가 눈으로 보인다.
   * 그 한 장면이 숫자 설명 열 줄보다 낫다.
   */
  function trendSpark(trend) {
    var points = trend.points.slice(-42);
    if (points.length < 3) return null;

    var values = points.map(function (point) { return point.kg; })
      .concat(points.map(function (point) { return point.avgKg; }));
    var low = Math.min.apply(null, values);
    var high = Math.max.apply(null, values);
    var span = Math.max(0.6, high - low);
    var W = 300;
    var H = 56;

    var at = function (index, kg) {
      var x = points.length < 2 ? 0 : (index / (points.length - 1)) * W;
      var y = H - ((kg - low) / span) * H;
      return Math.round(x * 10) / 10 + ',' + Math.round(y * 10) / 10;
    };
    var path = function (key) {
      return points.map(function (point, i) { return at(i, point[key]); }).join(' ');
    };

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'trend-spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label',
      points.length + '일 체중 추세. ' + trend.message);

    ['raw', 'avg'].forEach(function (kind) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', path(kind === 'raw' ? 'kg' : 'avgKg'));
      line.setAttribute('class', 'spark-' + kind);
      svg.appendChild(line);
    });

    var wrap = el('div', { class: 'trend-wrap' }, []);
    wrap.appendChild(svg);
    wrap.appendChild(el('p', { class: 'hint-line', text:
      '흐린 선이 매일 잰 값, 진한 선이 7일 평균입니다. 판단은 진한 선으로 합니다.' }));
    return wrap;
  }

  /**
   * 식단 탭.
   *
   * 식단표를 짜 주지 않는다. 칼로리를 정해 주는 건 영양사의 일이고,
   * 끼니마다 적게 하는 앱은 3주를 못 간다. 여기서 하는 건 셋이다 —
   * 체중 추세, 단백질 채웠나 한 번, 그리고 그 단백질을 **세 끼에 어떻게
   * 담는지의 예시.**
   *
   * 통증은 여기 없다. 통증은 오늘 처방을 바꾸는 것이라 오늘 탭에 있다.
   */
  function renderDiet() {
    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '식단' }),
      el('p', { class: 'meta', text: '체중 추세와 단백질만 봅니다. 칼로리는 정하지 않습니다.' }),
    ]));

    var mind = bodyCard();
    if (mind) screen.appendChild(mind);
    var meals = mealCard();
    if (meals) screen.appendChild(meals);

    if (!mind) {
      screen.appendChild(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '동의가 필요합니다' }),
        el('div', { text: '체중은 건강정보라 동의가 있어야 적을 수 있습니다. 위쪽 "내 정보"에서 확인하세요.' }),
      ]));
    }
  }

  /**
   * 끼니 예시.
   *
   * "하루 150g"은 숫자일 뿐이고 사람은 "그래서 점심에 뭘 먹지"에서 멈춘다.
   * 한국에서 실제로 먹는 조합으로 한 끼씩 보여 준다. 주재료 양만 목표에
   * 맞춰 바뀐다.
   */
  function mealCard() {
    if ((state.consent || []).indexOf('healthData') < 0) return null;
    var trend = bodyTrend();
    var goal = bodyGoal();
    var weight = (trend.latest && trend.latest.kg) || (state.lifter && state.lifter.bodyweightKg) || 70;
    var target = E.proteinTargetG(weight, goal);
    var perMeal = E.perMealG(target);
    var today = isoOf(new Date());
    var day = E.planMeals({ perMeal: perMeal, prefs: state.diet, date: today, goal: goal });
    if (day.meals.length === 0) return null;

    var body = el('div', { class: 'sheet-body' }, []);

    /*
     * 나에게 맞추는 칸을 맨 위에 둔다. 계란을 못 먹는 사람이 계란 네 개를
     * 먼저 보면 그 아래는 안 읽는다.
     */
    body.appendChild(el('button', {
      type: 'button', class: 'diet-prefs', onclick: openDietSettings,
    }, [
      el('span', { text: dietSummary() }),
      el('span', { class: 'pain-go', text: '바꾸기 ›' }),
    ]));

    /*
     * 저울이 말하는 양 조정. 칼로리 숫자 대신 "밥 반 공기" 단위로만
     * 말한다 — 공식은 그 사람의 몸을 모르지만 저울은 안다.
     */
    var advice = E.portionAdvice(trend, goal);
    if (advice) {
      body.appendChild(el('p', { class: 'portion-advice ' + advice.direction, text: advice.text }));
    }

    day.meals.forEach(function (idea) {
      var label = idea.items.map(function (item) {
        return item.amount ? item.food + ' ' + item.amount : item.food;
      }).join(' + ');
      var row = el('div', { class: 'meal-row' + (idea.meal === '간식' ? ' snack' : '') }, [
        el('span', { class: 'meal-name', text: idea.meal }),
        el('span', { class: 'meal-items', text: label }),
        el('span', { class: 'meal-gram', text: '≈' + idea.gram + 'g' }),
      ]);
      if (idea.note || (idea.options && idea.options.length)) {
        var more = el('div', { class: 'meal-more' }, []);
        if (idea.note) more.appendChild(el('span', { text: idea.note }));
        if (idea.options && idea.options.length) {
          more.appendChild(el('span', { class: 'meal-alt', text: '아니면 ' + idea.options.join(' · ') }));
        }
        row.appendChild(more);
      }
      body.appendChild(row);
    });

    if (day.shortfall) body.appendChild(el('p', { class: 'hint-line warn', text: day.shortfall }));
    body.appendChild(el('p', { class: 'hint-line', text:
      '한 끼 ' + perMeal + 'g 기준입니다. 숫자는 어림이고, 같은 양이면 다른 음식으로 바꿔도 됩니다. ' +
      '날마다 조합이 바뀝니다.' }));

    return el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '끼니 예시' }),
        el('span', { class: 'meta', text: '하루 ' + target + 'g · ' + (day.weekday ? '평일' : '주말') }),
      ]),
      body,
    ]);
  }

  /** "계란 빼고 · 아끼기 · 점심 사 먹음" — 지금 무엇에 맞춰져 있는지 한 줄로. */
  function dietSummary() {
    var diet = state.diet || E.DEFAULT_DIET;
    var parts = [];
    var avoid = E.FOOD_AVOID_OPTIONS.filter(function (option) { return diet.avoid.indexOf(option.id) >= 0; });
    parts.push(avoid.length === 0 ? '가리는 것 없음' : avoid.map(function (option) { return option.label; }).join('·') + ' 빼고');
    var budget = E.BUDGET_OPTIONS.filter(function (option) { return option.id === diet.budget; })[0];
    if (budget) parts.push('예산 ' + budget.label);
    var lunch = E.LUNCH_OPTIONS.filter(function (option) { return option.id === diet.lunch; })[0];
    if (lunch) parts.push('평일 점심 ' + lunch.label);
    return parts.join(' · ');
  }

  /**
   * 나에게 맞추기 — 못 먹는 것, 예산, 평일 점심.
   *
   * 키·나이·활동량은 묻지 않는다. 칼로리를 계산하지 않으니 필요가 없다.
   * 누르면 바로 바뀌고 저장된다 — "저장" 버튼을 따로 두면 누르는 걸 잊는다.
   */
  function openDietSettings() {
    var diet = state.diet || E.normalizeDiet(null);
    var save = function (next) {
      state.diet = E.normalizeDiet(next);
      persist();
      render();
      openDietSettings();
    };
    var body = [];

    body.push(el('div', { class: 'list-label', text: '못 먹는 것 (여러 개)' }));
    body.push(el('div', { class: 'chip-row' }, E.FOOD_AVOID_OPTIONS.map(function (option) {
      var on = diet.avoid.indexOf(option.id) >= 0;
      return el('button', {
        type: 'button', class: 'pick', 'aria-pressed': String(on), text: option.label,
        title: option.hint || '',
        onclick: function () {
          var next = on
            ? diet.avoid.filter(function (id) { return id !== option.id; })
            : diet.avoid.concat([option.id]);
          save({ avoid: next, budget: diet.budget, lunch: diet.lunch });
        },
      });
    })));

    body.push(el('div', { class: 'list-label', text: '예산' }));
    E.BUDGET_OPTIONS.forEach(function (option) {
      body.push(el('button', {
        type: 'button', class: 'choice', 'aria-pressed': String(diet.budget === option.id),
        onclick: function () { save({ avoid: diet.avoid, budget: option.id, lunch: diet.lunch }); },
      }, [
        el('span', { class: 'choice-title', text: option.label }),
        el('span', { class: 'choice-hint', text: option.hint }),
      ]));
    });

    body.push(el('div', { class: 'list-label', text: '평일 점심은 어디서 드세요?' }));
    E.LUNCH_OPTIONS.forEach(function (option) {
      body.push(el('button', {
        type: 'button', class: 'choice', 'aria-pressed': String(diet.lunch === option.id),
        onclick: function () { save({ avoid: diet.avoid, budget: diet.budget, lunch: option.id }); },
      }, [
        el('span', { class: 'choice-title', text: option.label }),
        el('span', { class: 'choice-hint', text: option.hint }),
      ]));
    });

    body.push(el('p', { class: 'asset-note', text:
      '키·나이는 묻지 않습니다. 칼로리를 정하지 않고, 체중 추세를 보고 ' +
      '"밥 반 공기" 단위로만 조정합니다.' }));
    openModal('나에게 맞추기', '끼니 예시', body);
  }

  /**
   * 오늘 탭의 "아픈 데 있나요?" 한 줄.
   *
   * 통증은 오늘 세션의 종목을 바꾼다. 그래서 운동을 시작하기 전에 보는
   * 자리에 둔다 — 다른 탭에 있으면 시작 버튼을 누른 뒤에야 생각난다.
   */
  function painRow() {
    /*
     * 동의가 없어도 줄은 둔다. 숨기면 통증 기록이 있다는 것도, 동의하면
     * 쓸 수 있다는 것도 알 길이 없다.
     */
    var allowed = E.allows(state.consent, 'painGate');
    var sore = allowed ? activePain() : [];
    var label = !allowed
      ? '동의 필요'
      : sore.length === 0
        ? '없음'
        : sore.map(function (report) { return E.JOINT_LABELS_KO[report.joint] + ' ' + report.score; }).join(' · ');
    return el('button', {
      type: 'button', class: 'pain-check' + (sore.length > 0 ? ' sore' : ''),
      onclick: openPainCheck,
    }, [
      el('span', { class: 'pain-q', text: '아픈 데 있나요?' }),
      el('span', { class: 'pain-now', text: label }),
      el('span', { class: 'pain-go', text: '›', 'aria-hidden': 'true' }),
    ]);
  }

  function openPainCheck() {
    var body = [];
    if (!E.allows(state.consent, 'painGate')) {
      body.push(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '동의하지 않은 항목' }),
        el('div', { text: '통증 기록은 민감정보라 별도 동의가 필요합니다. ' +
          '동의하면 아픈 관절에 부담이 큰 종목을 자동으로 대체합니다.' }),
      ]));
      body.push(el('button', {
        type: 'button', class: 'finish', text: '통증 기록에 동의하기',
        onclick: function () { grantConsent('painData'); openPainCheck(); },
      }));
      openModal('아픈 데 있나요?', '동의가 필요합니다', body);
      return;
    }
    body.push(el('p', { class: 'asset-note', text:
      '3점 이상이면 그 관절 부담이 큰 종목을 바꾸고, 7점 이상이면 그 관절을 쓰는 동작을 오늘 뺍니다.' }));

    state.pain.forEach(function (report, i) {
      body.push(numberRow({
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
          drawVerdicts();
        },
      }));
    });

    var verdicts = el('div', { class: 'verdict', id: 'pain-verdicts' }, []);
    body.push(verdicts);
    function drawVerdicts() {
      verdicts.textContent = '';
      var changed = state.session.exercises.filter(function (item) { return item.painRuling.action !== 'allow'; });
      if (changed.length === 0) {
        verdicts.appendChild(el('p', { text: '지금은 바뀌는 종목이 없습니다.' }));
      }
      changed.forEach(function (item) {
        verdicts.appendChild(el('p', {}, [
          el('b', { text: (item.substitutedFrom || item.exercise).name }),
          document.createTextNode(' — ' + item.painRuling.message),
        ]));
      });
    }
    drawVerdicts();

    openModal('아픈 데 있나요?', '0 없음 · 10 극심', body);
  }

  /**
   * 내 정보 — 계정, 동의, 설치.
   *
   * 탭 막대에 두지 않는다. 매일 여는 곳이 아니라 가끔 찾는 곳이고, 탭
   * 하나를 차지하면 매일 여는 탭이 하나 밀려난다. 화면 위쪽 모서리에서
   * 연다 — 앱들이 계정을 두는 자리다.
   */
  function renderMe() {
    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '내 정보' }),
      el('p', { class: 'meta', text: '계정 · 동의 · 설치' }),
    ]));
    renderAppStatus();
    renderPrivacy();
    /*
     * 페이지 맨 아래에 있던 안내 중에 사용자에게 필요한 것은 이것 하나다.
     * 나머지(프로토타입·예시 데이터 이야기)는 만드는 사람용이라 감췄다.
     */
    screen.appendChild(el('p', { class: 'asset-note', text:
      '볼륨 코치는 의료기기가 아니며, 의학적 진단·처방·치료를 대신하지 않습니다. ' +
      '통증이 계속되면 전문의 진료를 받으세요.' }));
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

    renderPainHistory();

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
    // 기록이 없어졌으니 주인도 없다.
    if (typeof Remote !== 'undefined') Remote.releaseData();
    state.consent = [];
    state.consentRecord = null;
    state.myDirectory = [];
    state.history = [];
    state.checkIns = [];
    state.todaySets = [];
    state.machinePick = {};
    state.machineSame = {};
    state.machinePound = {};
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

    /*
     * 서버. 폰을 바꿔도 기록이 남게 하는 유일한 길이라서, "언젠가 하는 것"이
     * 아니라 설정 화면에서 바로 보이는 자리에 둔다.
     */
    screen.appendChild(el('button', {
      type: 'button', class: 'server-cta',
      // 연결은 됐는데 로그인만 안 됐으면 곧바로 로그인 화면으로 보낸다.
      onclick: function () {
        if (Remote.configured() && !Remote.signedIn()) openAuth('signin');
        else openServerSettings();
      },
    }, [
      el('span', { class: 'plan-main' }, [
        el('span', { class: 'name', text: '서버에 기록 남기기' }),
        el('span', { class: 'plan-sets', text:
          !Remote.configured() ? '폰을 바꾸면 기록이 사라집니다 — 눌러서 연결하세요'
            : !Remote.signedIn() ? '연결됨 · 로그인이 필요합니다'
            : syncStatusLine() }),
      ]),
      el('span', { class: 'detail', text: '›' }),
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

    // 내가 아는 기구를 올린다. 같은 곳 다니는 사람이 덕을 본다.
    shareGymNow(entry);
    state.crowd = null;

    loadScenario(state.scenario, true);
    render();
  }

  /* ── 헬스장 나누기 ─────────────────────────────── */

  /**
   * 이 헬스장을 남과 나눠도 되는가.
   *
   * 홈짐은 안 된다 — 남의 집 주소다. 아파트·회사는 된다(restricted):
   * 밖에서는 뭐가 있는지 알 길이 없어서 같은 단지 사람이 채워 준 목록이
   * 제일 값어치가 크다.
   */
  /*
   * 온보딩이 만들어 주는 기본 헬스장. 이름도 id도 자리 표시자다.
   *
   * **이건 절대 안 올린다.** id가 'my-gym'으로 고정이라 올리면 모든
   * 사용자가 같은 한 줄에 써 넣게 되고, 공개 목록에는 "내 헬스장"이라는
   * 이름의 헬스장 하나가 남의 기구 정보로 뒤섞인 채 뜬다. 등록도 검색도
   * 안 거친 자리 표시자를 남에게 보낼 이유가 없다.
   */
  var PLACEHOLDER_GYM_ID = 'my-gym';

  function shareableGym(entry) {
    if (!entry) return false;
    if (entry.id === PLACEHOLDER_GYM_ID) return false;
    return (entry.visibility || 'public') !== 'private';
  }

  /**
   * 내가 아는 것을 올린다.
   *
   * 기구는 **있는 것과 없는 것을 둘 다** 보낸다. 없다는 말이 안 올라가면
   * 아무도 "없음"을 못 세고, 그러면 잘못 올라간 기구가 영영 안 지워진다.
   *
   * 실패해도 아무 말 안 한다. 운동하다가 기구 하나 고쳤는데 "서버 오류"가
   * 뜨면 그건 방해다. 기록은 이미 이 기기에 남았고, 다음에 또 고칠 때
   * 다시 올라간다.
   */
  /**
   * 목록에 있는 원본을 찾는다.
   *
   * 지금 쓰는 헬스장(GymEntry)에는 이름과 기구밖에 없다 — 주소·층·좌표·
   * 공개 범위는 목록 쪽(GymDirectoryEntry)에만 있다. 그걸 안 찾고 그냥
   * 올리면 **아파트 헬스장이 public으로 올라가서 "입주민 전용" 딱지가
   * 사라지고**, 층이 빠져서 같은 건물 3층과 5층이 한 곳으로 합쳐진다.
   */
  function directoryEntryFor(id) {
    var all = fullDirectory();
    for (var i = 0; i < all.length; i += 1) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  var shareTimer = null;

  /**
   * 조금 있다가 올린다.
   *
   * 기구를 고칠 때는 한 번에 여러 개를 켜고 끈다. 누를 때마다 올리면
   * 서른 번 올라가고, 그 서른 번이 다 같은 목록의 중간 상태다. 손이
   * 멈춘 뒤에 한 번만 보낸다.
   */
  function shareGymSoon(entry) {
    if (!entry) return;
    if (shareTimer) clearTimeout(shareTimer);
    var id = entry.id;
    shareTimer = setTimeout(function () {
      shareTimer = null;
      // 그 사이에 헬스장을 옮겼을 수 있다. 그때는 지금 것을 올린다.
      var now = currentGymEntry();
      shareGymNow(now && now.id === id ? now : entry);
    }, 3000);
  }

  function shareGymNow(entry) {
    if (typeof Remote === 'undefined' || !Remote.signedIn()) return;
    if (!entry) return;
    entry = directoryEntryFor(entry.id) || entry;
    if (!shareableGym(entry)) return;

    var known = {};
    // 남이 적은 목록을 받아 쓰는 중이면 헬스장만 올리고 기구는 내 확인으로 세지 않는다.
    if (!entry.crowdAdopted) {
      (entry.equipmentIds || []).forEach(function (id) { known[id] = true; });
      (entry.absentEquipmentIds || []).forEach(function (id) { known[id] = false; });
    }

    var equipment = Object.keys(known).map(function (id) {
      return { id: id, present: known[id] };
    });

    Remote.shareGym({
      id: entry.id,
      name: entry.name,
      address: entry.address || '',
      floor: entry.floor,
      lat: entry.location ? entry.location.lat : null,
      lng: entry.location ? entry.location.lng : null,
      visibility: entry.visibility || 'public',
    }, equipment).catch(function () { /* 조용히 넘어간다 */ });
  }

  /**
   * 남들이 뭐라고 했는지 가져온다.
   *
   * 로그인 없이도 읽는다 — 처음 켠 사람이 헬스장을 고를 때 이미 채워진
   * 목록이 보여야 하고, 그 앞에 회원가입을 세우면 이 기능의 값어치가
   * 절반으로 준다.
   */
  function loadGymCrowd(entry) {
    if (typeof Remote === 'undefined' || !Remote.configured()) return;
    if (!shareableGym(entry)) return;
    if (state.crowd && state.crowd.gymId === entry.id) return;   // 한 번만

    state.crowd = { gymId: entry.id, loading: true, equipment: [], signals: [], people: 0 };

    Promise.all([
      Remote.sharedEquipment(entry.id).catch(function () { return []; }),
      Remote.gymPeople(entry.id).catch(function () { return 0; }),
      Remote.gymSkips(entry.id).catch(function () { return []; }),
    ]).then(function (out) {
      var equipment = out[0] || [];
      var people = typeof out[1] === 'number' ? out[1] : 0;
      var skips = out[2] || [];

      /*
       * 서버가 준 것은 "몇 명이 무엇을 뺐나"까지다. 몇 명부터 말할지,
       * 몇 %부터 신호로 볼지는 제품 판단이라 앱에서 낸다 — 고치기 쉽다.
       */
      var reports = [];
      skips.forEach(function (row) {
        for (var i = 0; i < row.people; i += 1) {
          reports.push({ exerciseId: row.exercise_id, reason: row.reason });
        }
      });

      state.crowd = {
        gymId: entry.id,
        loading: false,
        equipment: equipment,
        people: people,
        signals: E.crowdSignals({ reports: reports, people: people, index: index }),
      };
      render();
    });
  }

  /**
   * "몇 명이 확인했나" 칸.
   *
   * 확인한 사람 수와 마지막 확인 시각을 같이 보여준다. 숫자만 있으면
   * 6개월 전에 한 명이 찍은 것과 어제 셋이 확인한 것이 같아 보인다.
   */
  function crowdCard() {
    var crowd = state.crowd;
    if (!crowd || crowd.loading) return null;
    if (crowd.people === 0 && crowd.signals.length === 0) return null;

    var body = el('div', { class: 'sheet-body' }, []);

    body.push = body.appendChild.bind(body);
    body.push(el('p', { class: 'hint-line', text:
      crowd.people + '명이 이 헬스장 기구를 확인했습니다. ' +
      '기구 ' + crowd.equipment.length + '개가 "있음"으로 모였습니다.' }));

    crowd.signals.forEach(function (signal) {
      var note = E.memberNote(signal);
      body.push(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: signal.name }),
        el('div', { text: note || signal.text }),
      ]));
    });

    if (crowd.signals.length === 0) {
      body.push(el('p', { class: 'hint-line', text:
        '아직 눈에 띄는 것은 없습니다. 사람이 다섯은 모여야 무슨 말이든 할 수 있습니다.' }));
    }

    return el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '여기 다니는 분들' }),
        el('span', { class: 'meta', text: crowd.people + '명' }),
      ]),
      body,
    ]);
  }

  function renderGym() {
    var book = state.gymBook;
    var active = currentGymEntry();
    var gym = state.gym;

    screen.appendChild(el('div', { class: 'session-head' }, [
      el('h2', { text: '헬스장' }),
      el('p', { class: 'meta', text: '여러 곳을 등록해 두고 그날 가는 곳으로 바꿉니다' }),
    ]));

    /*
     * 헬스장 화면에 왔을 때 위치를 물어본다. 앱 켜자마자 묻지 않는 이유는,
     * 왜 묻는지 모르는 채로 받는 허락은 허락이 아니기 때문이다. 여기서는
     * 화면이 이미 헬스장 이야기를 하고 있다.
     */
    requestLocation();
    var activeEntry = currentGymEntry();
    if (activeEntry) loadGymCrowd(activeEntry);

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

      /*
       * 지우기는 줄 **옆에** 둔다. 줄 자체가 버튼이라 안에 넣을 수 없고,
       * 넣는다 해도 헬스장을 고르려다 지우는 사고가 난다.
       *
       * 마지막 한 곳은 못 지운다 — 다니는 곳이 하나도 없으면 운동을 짤
       * 수가 없다. 그때는 버튼을 아예 안 보여준다. 눌러도 안 되는 버튼은
       * 고장 난 것처럼 보인다.
       */
      var line = el('div', { class: 'gym-line' }, [row]);
      if (book.gyms.length > 1) {
        line.appendChild(el('button', {
          type: 'button', class: 'gym-drop', text: '지우기',
          'aria-label': entry.name + ' 목록에서 지우기',
          onclick: function () { confirmDropGym(entry); },
        }));
      }
      list.appendChild(line);
    });

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '내 헬스장' }),
        el('span', { class: 'meta', text: book.gyms.length + '곳' }),
      ]),
      list,
    ]));

    // 같은 곳 다니는 사람들이 올린 것
    var crowd = crowdCard();
    if (crowd) screen.appendChild(crowd);

    // 찾기
    var searchInput = el('input', {
      type: 'search', id: 'gym-search', value: state.gymQuery,
      placeholder: '이름이나 지역으로 검색',
      oninput: function (event) {
        state.gymQuery = event.target.value;
        if (searchIsOn()) queuePlaceSearch();
        renderSearchResults();
      },
    });

    var resultsHost = el('div', { class: 'search-results', id: 'gym-results' }, []);

    /*
     * 검색이 켜져 있으면 검색이 주 경로고, 꺼져 있으면 직접 등록이 주
     * 경로다. 둘을 같은 무게로 늘어놓으면 어느 쪽을 눌러야 하는지 모른다.
     *
     * 검색이 켜져 있어도 "여기 핵스쿼트 있나"는 어차피 손으로 넣어야
     * 한다 — 그게 이 앱이 필요한 정보이고, 검색은 그 앞의 "어느
     * 헬스장인지 정하기"까지만 해 준다.
     */
    var live = searchIsOn();
    var body = [];

    if (live) {
      searchInput.placeholder = '지역이나 이름 (예: 경기도, 분당구, 스포애니)';
      body.push(el('p', { class: 'asset-note', text:
        '지역을 치면 그 동네 헬스장이 나옵니다. 고르면 이름과 주소가 채워지고, ' +
        '있는 기구만 확인하면 끝입니다.' }));
      body.push(searchInput);
      body.push(resultsHost);
    } else {
      body.push(el('p', { class: 'asset-note', text:
        '다니는 헬스장을 직접 등록하세요. 이름과 있는 기구만 넣으면 됩니다 — ' +
        '아파트·회사 헬스장도 됩니다.' }));
      body.push(registerButton());
      /*
       * 열쇠 넣는 문은 작게 둔다. 이건 만든 사람이 서버 없이 시험해 보는
       * 길이지 사용자가 할 일이 아니다. 크게 띄워 두면 앱을 받은 사람이
       * "나도 카카오 계정을 만들어야 하나" 하고 거기서 멈춘다.
       */
      body.push(el('button', {
        type: 'button', class: 'ghost search-setup',
        text: '검색을 이 기기에서만 켜기 (만든 사람용)',
        onclick: openGymSearchSetup,
      }));
      body.push(el('div', { class: 'list-label', text: '예시로 둘러보기' }));
      body.push(el('p', { class: 'hint-line', text:
        '아래 네 곳은 앱을 시험해 보시라고 넣어 둔 가상의 헬스장입니다. ' +
        '실제 헬스장을 찾으려면 위에서 검색을 켜세요.' }));
      body.push(searchInput);
      body.push(resultsHost);
    }

    screen.appendChild(el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('h3', { text: '헬스장 추가' }),
        el('span', { class: 'meta', text:
          !live ? '직접 등록'
            : GymSearch.route() === 'server' ? '전국 검색'
              : '전국 검색 · 이 기기' }),
      ]),
      el('div', { class: 'sheet-body' }, body),
    ]));
    renderSearchResults();

    /*
     * 기구 목록 (선택된 곳).
     *
     * 등록은 유형으로 대충 채워 준다. 거기 실제로 뭐가 있는지는 다니는
     * 사람이 제일 잘 아는데, 전에는 등록을 마치면 고칠 길이 없었다.
     */
    if (active) {
      var ids = active.equipmentIds || [];
      screen.appendChild(el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-head' }, [
          el('h3', { text: active.name + ' 기구' }),
          el('span', { class: 'meta', text: ids.length + '개' }),
        ]),
        el('div', { class: 'sheet-body' }, [
          el('p', { class: 'hint-line', text:
            '할 수 있는 종목 ' + E.availableExercises(ids).length + ' / ' +
            E.EXERCISES.length + '개. 없는 기구를 꺼 두면 그 종목은 처방에서 빠집니다.' }),
          el('button', {
            type: 'button', class: 'finish', text: '기구 고치기',
            onclick: openGymEquipment,
          }),
        ]),
      ]));
    }

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

  /* ── 실제 헬스장 찾기 ───────────────────────────── */

  /** 검색이 켜져 있는가. 열쇠를 넣었을 때만 켜진다. */
  function searchIsOn() {
    return typeof GymSearch !== 'undefined' && GymSearch.configured();
  }

  /*
   * 한 글자마다 보내지 않는다.
   *
   * "경기도"는 세 번의 입력이고, 그대로 보내면 세 번 부른다. 하루 한도는
   * 사용자 것이라 우리가 대신 써 버리면 안 된다. 그리고 앞의 응답이 뒤에
   * 도착하면 목록이 뒤섞이므로, 마지막 요청만 화면에 그린다.
   */
  var placeTimer = null;
  var placeToken = 0;

  function queuePlaceSearch() {
    if (placeTimer) clearTimeout(placeTimer);
    placeTimer = setTimeout(runPlaceSearch, 350);
  }

  function runPlaceSearch() {
    placeTimer = null;
    var parsed = E.parsePlaceQuery(state.gymQuery);
    if (!parsed.searchable) {
      state.placeResults = null;
      state.placeBusy = false;
      renderSearchResults();
      return;
    }

    var token = (placeToken += 1);
    state.placeBusy = true;
    renderSearchResults();

    GymSearch.search(state.gymQuery, { near: myLocation() }).then(function (result) {
      if (token !== placeToken) return; // 더 최근 요청이 있다
      state.placeBusy = false;
      state.placeResults = result;
      renderSearchResults();
    });
  }

  /**
   * 검색에서 고른 곳을 등록으로 넘긴다.
   *
   * 바로 등록해 버리지 않는다. 기구 목록이 이 앱의 전부인데 검색은 그걸
   * 모르므로, 유형이라도 고르게 해야 쓸 수 있는 프로그램이 나온다.
   */
  /**
   * 검색 결과에서 추가.
   *
   * 유형("동네 헬스장" 같은 것)을 묻지 않는다. 검색에 나온 곳은 상가
   * 헬스장이라 누가 볼 수 있는지는 이미 정해져 있고, 기구는 유형으로
   * 짐작할 게 아니라 **이미 다니는 사람이 적어 둔 것**을 쓰면 된다.
   *
   * 그래서 먼저 서버에 묻는다. 누가 등록해 뒀으면 그 목록을 그대로 쓰고,
   * 아무도 없으면 등록하자마자 기구 체크 화면을 연다 — 처음 한 사람이
   * 채우면 다음 사람부터는 고를 게 없다.
   */
  function registerFromPlace(place) {
    var draft = E.placeToDraft(place);
    var gymDraft = {
      presetId: 'unknown',
      name: draft.name,
      address: draft.address,
      location: draft.location,
      sourceId: draft.sourceId,
      floor: '',
      step: 'detail',
      fromSearch: true,
      crowd: { loading: true, equipment: [], people: 0 },
    };
    openGymRegister(gymDraft);
    lookupGymEquipment(gymDraft);
  }

  /** 이 곳을 누가 이미 등록했는가. 등록할 id를 미리 계산해서 서버에 묻는다. */
  function lookupGymEquipment(draft) {
    var done = function (crowd) {
      draft.crowd = crowd;
      // 그새 다른 화면으로 갔으면 다시 그리지 않는다.
      if (state.gymDraft === draft && modal.open) renderGymRegister();
    };
    if (typeof Remote === 'undefined' || !Remote.configured()) {
      return done({ loading: false, equipment: [], people: 0, offline: true });
    }
    var id = E.gymKey({ name: draft.name, location: draft.location, address: draft.address });
    Promise.all([
      Remote.sharedEquipment(id).catch(function () { return []; }),
      Remote.gymPeople(id).catch(function () { return 0; }),
    ]).then(function (out) {
      var known = {};
      E.EQUIPMENT_CATALOG.forEach(function (item) { known[item.id] = true; });
      var equipment = (out[0] || [])
        .map(function (row) { return row && (row.equipment_id || row.id || row); })
        .filter(function (itemId) { return typeof itemId === 'string' && known[itemId]; });
      done({ loading: false, equipment: equipment, people: typeof out[1] === 'number' ? out[1] : 0 });
    });
  }

  /**
   * 검색 열쇠 넣기.
   *
   * 열쇠가 이 기기 밖으로 안 나간다는 것과, 그래도 이 기기 안에서는
   * 보인다는 것을 둘 다 적어 둔다. 앞엣것만 적으면 반만 말한 것이다.
   */
  function openGymSearchSetup() {
    var body = [];
    var message = el('p', { class: 'hint-line' }, []);

    body.push(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '사용자는 이걸 안 합니다' }),
      el('div', { text:
        '서버(Supabase)를 붙이면 열쇠는 거기 하나만 있으면 되고, 앱을 받은 사람은 ' +
        '아무것도 안 넣고 바로 검색합니다. 이 화면은 서버를 붙이기 전에 만든 사람이 ' +
        '혼자 시험해 보는 길입니다.' }),
    ]));

    body.push(el('p', { class: 'asset-note', text:
      '카카오 개발자 사이트에서 열쇠를 하나 받으면 이 기기에서 전국 헬스장이 ' +
      '검색됩니다. 무료이고 5분이면 됩니다.' }));

    body.push(el('div', { class: 'list-label', text: '받는 곳' }));
    body.push(el('div', { class: 'summary-list' }, [
      el('div', { class: 'option-row' }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: 'developers.kakao.com' }),
          el('span', { class: 'plan-sets', text:
            '내 애플리케이션 → 앱 만들기 → 앱 키 → REST API 키' }),
        ]),
      ]),
      el('div', { class: 'option-row' }, [
        el('span', { class: 'plan-main' }, [
          el('span', { class: 'name', text: '카카오맵 켜기' }),
          el('span', { class: 'plan-sets', text:
            '그 앱의 [제품 설정 → 카카오맵]을 켜야 장소 검색이 열립니다.' }),
        ]),
      ]),
    ]));

    body.push(el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: '열쇠는 이 기기에만 둡니다' }),
      el('div', { text:
        '서버로 올리지 않고 다른 기기로도 안 갑니다 — 기록 동기화에 얹히지 않습니다. ' +
        '다만 앱이 이 기기에서 직접 부르기 때문에, 이 기기를 들여다보면 열쇠는 보입니다. ' +
        '하루 검색 한도도 이 열쇠 주인 것입니다.' }),
    ]));

    var input = el('input', {
      type: 'password', class: 'text-input', autocomplete: 'off',
      placeholder: 'REST API 키 (32자리)',
      'aria-label': '카카오 REST API 키',
    });
    body.push(el('div', { class: 'list-label', text: 'REST API 키' }));
    body.push(input);
    body.push(message);

    body.push(el('button', {
      type: 'button', class: 'finish', text: '켜기',
      onclick: function () {
        message.textContent = '확인하는 중…';
        message.className = 'hint-line';
        GymSearch.verify(input.value).then(function (result) {
          if (!result.ok) {
            message.textContent = E.describeSearchFailure(result.failure);
            message.className = 'hint-line warn';
            return;
          }
          pushLog('헬스장 검색', '검색을 켰습니다. 이제 지역을 치면 그 동네 헬스장이 나옵니다.');
          state.placeResults = null;
          modal.close();
          render();
        });
      },
    }));

    if (searchIsOn()) {
      body.push(el('button', {
        type: 'button', class: 'ghost', text: '검색 끄고 열쇠 지우기',
        onclick: function () {
          GymSearch.forget();
          state.placeResults = null;
          pushLog('헬스장 검색', '열쇠를 지웠습니다. 등록해 둔 헬스장은 그대로 있습니다.');
          modal.close();
          render();
        },
      }));
    }

    openModal('헬스장 검색 켜기', GymSearch.serverReady() ? '서버로 이미 됩니다' : '카카오 로컬', body);
  }

  /** 검색 결과 한 줄. */
  function placeRow(place) {
    var already = state.gymBook.gyms.some(function (g) { return g.name === place.name; });
    return el('div', { class: 'search-row' }, [
      el('div', { class: 'search-main' }, [
        el('span', { class: 'gym-name', text: place.name }),
        el('span', { class: 'gym-meta', text: E.placeLine(place) }),
      ]),
      el('button', {
        type: 'button', class: 'pick', text: already ? '등록됨' : '추가',
        disabled: already ? 'disabled' : null,
        onclick: function () { if (!already) registerFromPlace(place); },
      }),
    ]);
  }

  /** 검색이 켜져 있을 때의 결과 칸. */
  function renderPlaceResults(host) {
    if (state.placeBusy) {
      host.appendChild(el('p', { class: 'hint-line', text: '찾는 중…' }));
      return;
    }

    var result = state.placeResults;
    if (!result) {
      host.appendChild(el('p', { class: 'hint-line', text:
        '지역이나 헬스장 이름을 쳐 보세요. "경기도"처럼 넓게 쳐도 됩니다.' }));
      return;
    }

    if (!result.ok) {
      host.appendChild(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '검색이 안 됩니다' }),
        el('div', { text: E.describeSearchFailure(result.failure) }),
      ]));
      host.appendChild(registerButton());
      return;
    }

    if (result.places.length === 0) {
      host.appendChild(el('p', { class: 'hint-line', text:
        '그 이름으로는 안 나옵니다. 지역을 넓혀 보거나 아래에서 직접 등록하세요.' }));
      host.appendChild(registerButton());
      return;
    }

    /*
     * 우리가 '헬스장'을 붙여서 찾았으면 그렇게 말해 준다. 안 그러면
     * 사용자는 자기가 친 말과 결과가 안 맞는다고 느낀다.
     */
    if (result.parsed.appendedGymWord) {
      host.appendChild(el('p', { class: 'hint-line', text:
        '"' + result.parsed.query + '"으로 찾았습니다.' }));
    }

    result.places.forEach(function (place) { host.appendChild(placeRow(place)); });
    host.appendChild(registerButton());
    host.appendChild(el('p', { class: 'hint-line', text:
      '누가 이미 등록한 곳이면 그 기구 목록을 그대로 씁니다. 처음이면 등록할 때 있는 기구를 체크합니다.' }));
  }

  function renderSearchResults() {
    var host = document.getElementById('gym-results');
    if (!host) return;
    host.textContent = '';

    if (searchIsOn()) {
      renderPlaceResults(host);
      return;
    }

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
          ? '비워 두면 예시 네 곳이 모두 나옵니다.'
          : '그 이름은 예시 목록에 없습니다. 실제 헬스장은 아직 검색되지 않으니 위에서 직접 등록하세요.',
      }));
      // 직접 등록 버튼은 이 칸 위에 이미 크게 있다. 둘을 두면 어느 쪽을 눌러야 하는지 헷갈린다.
      return;
    }

    results.forEach(function (result) {
      var fit = Math.round((result.programFit || 0) * 100);
      var already = state.gymBook.gyms.some(function (g) { return g.id === result.entry.id; });

      var card = el('div', { class: 'search-row' }, [
        el('div', { class: 'search-main' }, [
          el('span', { class: 'gym-name', text: result.entry.name }),
          el('span', { class: 'gym-meta', text:
            (E.accessLabel(result.entry) ? E.accessLabel(result.entry) + ' · ' : '') +
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

    /*
     * 여기서는 등록 버튼을 또 달지 않는다. 이 칸 위에 이미 같은 버튼이
     * 크게 있다. 똑같은 버튼이 한 화면에 둘이면 어느 쪽을 눌러야 하는지
     * 모르게 되고, 둘 다 같은 일을 한다는 것도 알 수 없다.
     */
    host.appendChild(el('p', { class: 'hint-line', text:
      '예시 네 곳은 구조를 보여주는 가상 데이터입니다. 직접 등록한 곳은 실제 기록입니다.' }));
  }

  /**
   * 직접 등록으로 가는 문.
   *
   * 검색 결과 아래에만 둔다. 먼저 찾아보게 만드는 것이 중복을 막는 가장 싼
   * 방법이다 — 대부분의 중복은 악의가 아니라 검색을 안 해봐서 생긴다.
   */
  /**
   * 선택된 헬스장의 기구를 직접 고친다.
   *
   * 등록할 때 유형(프리셋)으로 대충 채워 주지만, 거기 실제로 뭐가 있는지는
   * **다니는 사람이 제일 잘 안다.** 유형으로 시작하고 여기서 맞추는 게
   * 처음부터 31개를 고르게 하는 것보다 낫다 — 그건 거기서 앱을 닫는다.
   */
  function openGymEquipment(options) {
    options = options || {};
    var entry = currentGymEntry();
    if (!entry) return;
    state.equipScope = 'gym';

    var body = [];
    if (options.first) {
      body.push(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '처음 등록하셨습니다' }),
        el('div', { text: '있는 기구를 체크해 주세요. 카톡에 적어 둔 목록이 있으면 "목록 붙여넣기"가 ' +
          '제일 빠릅니다. 여기 다니는 다음 분부터는 이 목록을 그대로 씁니다.' }),
      ]));
    }
    body.push(el('p', { class: 'asset-note', text:
      entry.name + '에 실제로 있는 기구만 켜 두세요. ' +
      '켠 기구에서 할 수 있는 종목만 처방에 나옵니다.' }));

    body.push(el('p', { id: 'equip-count', class: 'hint-line', text: '' }));

    // 한 대씩 고르기 전에, 유형으로 한 번에 채우는 길을 먼저 둔다.
    body.push(el('div', { class: 'list-label', text: '유형으로 한 번에' }));
    body.push(el('div', { class: 'chip-row' }, E.GYM_PRESETS.map(function (preset) {
      return el('button', {
        type: 'button', class: 'pick', text: preset.label,
        onclick: function () {
          setEquipmentIds(E.presetEquipment(preset.id));
          render();
          renderEquipmentList();
        },
      });
    })));

    /*
     * 목록을 그대로 붙여넣기.
     *
     * 자기 헬스장 기구를 다 아는 사람(트레이너, 관장)은 체크박스를 서른
     * 번 누르지 않는다. 카톡에 적어 둔 "덤벨, 바벨, 이지바, …"를 그대로
     * 붙여넣는다. **켜기만 하고 끄지 않는다** — 목록에 깜빡 빠진 플랫
     * 벤치 하나 때문에 벤치프레스가 사라지면 안 된다.
     */
    body.push(el('div', { class: 'list-label', text: '목록 붙여넣기' }));
    var paste = el('textarea', {
      class: 'text-input equip-paste', rows: '3',
      placeholder: '예: 덤벨, 바벨, 이지바, 스쿼트랙, 레그 프레스, 스미스 머신…',
    });
    var pasteNote = el('p', { class: 'hint-line', id: 'equip-paste-note', text:
      '쉼표나 줄바꿈으로 나눠 적으면 알아보는 것을 켭니다. 이미 켜진 것은 그대로 둡니다.' });
    body.push(paste);
    body.push(el('button', {
      type: 'button', class: 'finish quiet', text: '목록대로 켜기',
      onclick: function () {
        var result = E.parseEquipmentList(paste.value);
        if (result.matched.length === 0 && result.unknown.length === 0) return;
        var before = equipmentIds().slice();
        var added = result.ids.filter(function (id) { return before.indexOf(id) < 0; });
        if (added.length > 0) setEquipmentIds(before.concat(added));
        var line = result.ids.length + '개를 알아봤고, 새로 켠 것 ' + added.length + '개입니다.';
        if (result.unknown.length > 0) line += ' 못 알아본 것: ' + result.unknown.join(', ') + ' — 아래에서 직접 찾아 주세요.';
        pasteNote.textContent = line;
        pasteNote.classList.toggle('warn', result.unknown.length > 0);

        /*
         * 목록에 없는 것을 끌지는 **따로 묻는다.** 헬스장 기구를 통째로
         * 적은 사람에게는 "나머지는 없다"가 맞는 말이지만, 플랫 벤치 하나
         * 깜빡 빠뜨린 목록으로 벤치프레스가 사라지면 안 된다. 무엇을
         * 끄는지 이름을 다 보여 주고 누르게 한다.
         */
        pasteTrim.textContent = '';
        var listed = result.ids;
        var extra = equipmentIds().filter(function (id) { return listed.indexOf(id) < 0; });
        if (result.ids.length >= 5 && extra.length > 0) {
          var names = extra.map(function (id) {
            var item = E.equipmentItem(id);
            return item ? item.name : id;
          });
          pasteTrim.appendChild(el('p', { class: 'hint-line', text:
            '목록에 없는데 켜져 있는 것 ' + extra.length + '개: ' + names.join(', ') }));
          pasteTrim.appendChild(el('button', {
            type: 'button', class: 'pick', text: '이 ' + extra.length + '개 끄기 — 목록에 있는 것만 남기기',
            onclick: function () {
              var keep = equipmentIds().filter(function (id) { return extra.indexOf(id) < 0; });
              setEquipmentIds(keep);
              pasteTrim.textContent = '';
              pasteNote.textContent = extra.length + '개를 껐습니다. 목록에 있는 ' + keep.length + '개만 남았습니다.';
              pushLog('기구', entry.name + ' — 목록에 없는 ' + extra.length + '개를 껐습니다.');
              render();
              renderEquipmentList();
            },
          }));
        }
        pushLog('기구', entry.name + ' — 목록으로 ' + added.length + '개를 켰습니다.');
        render();
        renderEquipmentList();
      },
    }));
    body.push(pasteNote);
    var pasteTrim = el('div', { id: 'equip-paste-trim' }, []);
    body.push(pasteTrim);

    body.push(el('div', { class: 'list-label', text: '하나씩 고르기' }));
    body.push(el('input', {
      type: 'search', value: state.equipmentQuery || '',
      placeholder: '생김새로 찾기 (예: 굽은 봉, 나비, 철장)',
      oninput: function (event) {
        state.equipmentQuery = event.target.value;
        renderEquipmentList();
      },
    }));
    body.push(el('div', { id: 'equipment-list' }, []));

    openModal('기구 고치기', entry.name, body);
    renderEquipmentList();
  }

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
   * 동의를 받은 게 아니다.
   *
   * **모르면 모른다고 한다.** 예전에는 GPS가 없을 때 강남 좌표를 대신
   * 넣었는데, 그게 실제로 검색을 망가뜨렸다: 좌표를 보내면 카카오가 그
   * 점에서 가까운 순으로 15개를 주므로, 수원 헬스장을 이름으로 찾아도
   * 강남 근처 것들에 밀려 안 나왔다. 좌표를 아예 안 보내면 카카오가
   * 이름이 맞는 순으로 전국에서 준다. 거리를 모르는 쪽이 틀린 거리보다 낫다.
   */
  function myLocation() {
    if (!E.allows(state.consent, 'nearbyGyms')) return undefined;
    return state.here || undefined;
  }

  /**
   * 진짜 위치를 한 번 물어본다.
   *
   * 동의한 사람에게만, 그리고 세션에 한 번만 묻는다. 거절하거나 실패해도
   * 아무것도 안 한다 — 검색은 좌표 없이도 되고, 그때는 거리만 안 보인다.
   */
  function requestLocation() {
    if (state.hereAsked) return;
    if (!E.allows(state.consent, 'nearbyGyms')) return;
    if (!navigator.geolocation) return;
    state.hereAsked = true;

    navigator.geolocation.getCurrentPosition(
      function (position) {
        state.here = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        render();
      },
      function () { /* 거절했거나 못 잡았다. 좌표 없이 간다. */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
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

  /**
   * 헬스장을 지울까.
   *
   * 되돌릴 수 없으므로 먼저 묻는다. 그리고 **운동 기록은 안 지워진다**는
   * 것을 분명히 말한다 — 그걸 모르면 중복으로 만든 곳 하나를 지우는 데도
   * 손이 안 간다.
   */
  function confirmDropGym(entry) {
    var count = (state.history || []).filter(function (session) {
      return session.gymId === entry.id;
    }).length;

    openModal('헬스장 지우기', entry.name, [
      el('p', { class: 'asset-note', text:
        '목록에서 지웁니다. 여기서 한 운동 기록은 지워지지 않습니다 — ' +
        '볼륨과 진행에 그대로 남습니다.' +
        (count > 0 ? ' (이 헬스장 기록 ' + count + '일)' : '') }),
      count > 0 ? el('p', { class: 'hint-line', text:
        '다만 머신·케이블 중량은 헬스장별로 세므로, 나중에 같은 곳을 다시 ' +
        '등록하면 그 기계들은 처음 쓰는 것으로 봅니다.' }) : null,
      el('div', { class: 'sheet-body' }, [
        el('button', {
          type: 'button', class: 'finish danger', text: '지우기',
          onclick: function () { dropGym(entry); },
        }),
        el('button', {
          type: 'button', class: 'finish quiet', text: '그대로 두기',
          onclick: function () { modal.close(); },
        }),
      ]),
    ]);
  }

  function dropGym(entry) {
    var name = entry.name;
    state.gymBook = E.removeGym(state.gymBook, entry.id);
    state.myDirectory = state.myDirectory.filter(function (item) {
      return item.id !== entry.id;
    });
    state.gym = E.activeProfile(state.gymBook);

    // 지운 곳의 기계 구분도 같이 치운다. 안 치우면 쓸 데 없는 열쇠만 쌓인다.
    [state.machineKnown, state.machinePound].forEach(function (book) {
      Object.keys(book || {}).forEach(function (key) {
        if (key.indexOf(entry.id + '|') === 0) delete book[key];
      });
    });

    /*
     * 쓰던 곳을 지웠으면 남은 곳으로 옮겨 간다. 설문 답도 그 곳의
     * 기구로 맞춰 둔다 — 안 그러면 지운 헬스장의 기구 목록이 남는다.
     */
    var active = currentGymEntry();
    if (active) {
      state.answers.gym = {
        equipmentIds: (active.equipmentIds || []).slice(),
        measurements: active.measurements || {},
      };
    }

    modal.close();
    rebuildSession();
    persist();
    render();
    pushLog('헬스장', '<b>' + name + '</b>' + particleOf(name, '을/를') +
      ' 목록에서 지웠습니다. 운동 기록은 그대로 남아 있습니다.');
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

    if (!draft.fromSearch) {
      body.push(el('div', { class: 'verdict-head' }, [
        el('span', { class: 'verdict-tag', text: preset.label }),
        el('button', {
          type: 'button', class: 'pick', text: '유형 바꾸기',
          onclick: function () { draft.step = 'type'; renderGymRegister(); },
        }),
      ]));
    }
    body.push(el('div', { class: 'list-label', text: '이름' }));
    body.push(nameInput);
    /*
     * 검색으로 왔으면 주소를 보여만 준다. 고치게 두면 검색이 준 정확한
     * 주소가 오타로 덮인다 — 다른 사람 기록과 합칠 근거가 거기 있다.
     */
    if (draft.address) {
      body.push(el('div', { class: 'list-label', text: '주소' }));
      body.push(el('p', { class: 'hint-line', text: draft.address }));
    }
    /*
     * 검색으로 왔으면 층을 묻지 않는다. 검색이 준 주소에 이미 호수가
     * 들어 있고, 층을 사람마다 다르게 적으면(3층 / 3F / 안 적음) 같은
     * 곳이 서로 다른 헬스장으로 갈라져서 남이 적어 둔 기구를 못 찾는다.
     */
    if (!draft.fromSearch) {
      body.push(el('div', { class: 'list-label', text: '층' }));
      body.push(floorInput);
      body.push(el('p', { class: 'asset-note', text:
        '같은 건물 3층과 5층에 다른 헬스장이 있는 경우가 흔합니다. 층을 적어두면 ' +
        '다른 사람이 등록한 곳과 헷갈리지 않습니다.' }));
    } else {
      body.push(crowdStatus(draft.crowd));
    }

    /*
     * 무엇이 남에게 보이는지 등록하기 전에 말한다.
     *
     * 다 만들고 나서 "사실 이거 공유됩니다"를 알게 되면, 그때는 이미 올라간
     * 뒤다. 올리기 전에 말해야 고를 기회가 있다.
     */
    if (preset.visibility === 'private') {
      body.push(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '나만 봅니다' }),
        el('div', { text: withParticleJs(preset.label, '은/는') +
          ' 검색에 올리지 않습니다. 이 기록은 내 목록에만 남습니다.' }),
      ]));
    } else if (preset.visibility === 'restricted') {
      body.push(el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '같은 곳 다니는 사람끼리 나눕니다' }),
        el('div', { text:
          '여기 뭐가 있는지는 밖에서 알 길이 없어서, 같은 단지·회사 사람이 채워 준 ' +
          '기구 목록이 제일 도움이 됩니다. 검색에는 "입주민·직원 전용"으로 나오고 ' +
          '아무나 갈 수 있는 곳보다 뒤에 놓입니다. 내 운동 기록은 올라가지 않습니다.' }),
      ]));
    }

    var waiting = draft.fromSearch && draft.crowd && draft.crowd.loading;
    body.push(el('button', {
      type: 'button', class: 'finish',
      text: waiting ? '기구 목록 찾는 중…' : '등록하기',
      disabled: waiting ? '' : null,
      onclick: function () { if (!waiting) submitGymRegister(); },
    }));

    /*
     * 여기에 "기구 고르기" 버튼을 두지 않는다.
     *
     * 등록을 마치면 헬스장 탭에 그 헬스장의 기구 칸이 바로 뜬다. 등록
     * 화면은 이미 이 탭 위에 떠 있으므로, 닫으면 그 칸이 눈앞에 있다.
     * 같은 일로 가는 문을 둘 두면 어느 쪽을 눌러야 하는지만 헷갈린다.
     *
     * 등록이 끝난 뒤에 "기구 볼래요?"를 모달로 묻는 것도 해 봤는데 그건
     * 더 나빴다 — 등록을 거쳐 가기만 하는 사람 모두를 한 번씩 세운다.
     */
    // 검색으로 왔으면 한 단계뿐이다. "2 / 2"라고 하면 1단계를 건너뛴 줄 안다.
    openModal('헬스장 등록', draft.fromSearch ? '검색에서 추가' : '2 / 2', body);
  }

  /** 등록 시도. 겹치는 곳이 있으면 만들지 않고 먼저 보여준다. */
  function submitGymRegister(options) {
    options = options || {};
    var draft = state.gymDraft;
    var name = (draft.name || '').trim();
    if (name.length === 0) return;

    var floorText = (draft.floor || '').trim();
    var addressText = (draft.address || '').trim();

    var result = E.registerGym({
      /*
       * 주소와 층을 한 줄로 붙이면 안 된다. "정자일로 9" + "3층"이
       * "정자일로 9 3층"이 되고, 거기서 층을 다시 읽으면 93층이 나온다.
       * 층은 따로 넘긴다 — 층만 놓고 읽으면 틀릴 수가 없다.
       *
       * 직접 등록이면 진짜 주소가 없으므로 예전 그대로 층 문자열이 주소
       * 자리에 들어간다. 층이라도 있어야 같은 건물의 다른 헬스장과 갈린다.
       */
      name: name,
      address: addressText || floorText,
      floor: E.parseFloor(floorText),
      location: draft.location || myLocation(),
      presetId: draft.presetId,
      // 누가 이미 적어 둔 기구가 있으면 그걸로 시작한다.
      equipmentIds: crowdList(draft) || undefined,
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

    var adopted = crowdList(draft);
    if (adopted && result.outcome === 'created') {
      /*
       * 남이 적은 목록을 내 확인으로 다시 올리지 않는다. 그대로 올리면 한
       * 사람이 적은 것이 "두 명이 확인"이 된다 — 내가 직접 고친 뒤부터
       * 내 확인으로 센다.
       */
      state.myDirectory = state.myDirectory.map(function (item) {
        return item.id === result.entry.id ? Object.assign({}, item, { crowdAdopted: true }) : item;
      });
    }
    var firstHere = draft.fromSearch && !adopted && result.outcome === 'created';

    state.gymDraft = null;
    if (!firstHere) modal.close();
    useGym(E.toGymEntry(result.entry));

    /*
     * 처음 등록한 사람이면 바로 기구를 체크하게 한다. 모달을 닫지 않고
     * 내용만 바꾼다 — 닫았다 바로 열면 닫힘 이벤트가 늦게 와서 새 내용을
     * 지워 버린다.
     */
    if (firstHere) openGymEquipment({ first: true });
  }

  /** 남이 등록해 둔 기구 목록. 없으면 null. */
  function crowdList(draft) {
    var crowd = draft && draft.crowd;
    return crowd && !crowd.loading && crowd.equipment && crowd.equipment.length > 0
      ? crowd.equipment.slice()
      : null;
  }

  /**
   * 등록 전에 보여 주는 이 곳의 기구 상황.
   *
   * 누가 등록해 뒀으면 무엇이 있는지 이름으로 보여 준다 — "기구 21개"만
   * 있으면 내가 쓰는 기구가 들어 있는지 알 수 없다.
   */
  function crowdStatus(crowd) {
    crowd = crowd || { loading: true };
    if (crowd.loading) {
      return el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: '기구 목록' }),
        el('div', { text: '이 헬스장을 누가 이미 등록했는지 찾는 중입니다…' }),
      ]);
    }
    if (crowd.equipment && crowd.equipment.length > 0) {
      var names = crowd.equipment.map(function (itemId) {
        var item = E.equipmentItem(itemId);
        return item ? item.name : itemId;
      });
      var shown = names.slice(0, 12).join(', ') + (names.length > 12 ? ' 외 ' + (names.length - 12) + '개' : '');
      return el('div', { class: 'notice' }, [
        el('div', { class: 'label', text: (crowd.people > 0 ? crowd.people + '명이' : '누군가') + ' 등록한 기구 ' + names.length + '개' }),
        el('div', { text: shown }),
        el('div', { class: 'hint-line', text: '이 목록을 그대로 씁니다. 다른 게 있으면 등록한 뒤 고치면 됩니다.' }),
      ]);
    }
    return el('div', { class: 'notice' }, [
      el('div', { class: 'label', text: crowd.offline ? '기구 목록' : '처음 등록하시는 곳입니다' }),
      el('div', { text: crowd.offline
        ? '서버에 연결돼 있지 않아 다른 분이 등록한 목록을 볼 수 없습니다. 등록한 뒤 기구를 체크해 주세요.'
        : '아직 아무도 기구를 등록하지 않았습니다. 등록하면 바로 기구 체크 화면이 열립니다 — ' +
          '처음 한 분이 채우면 다음 분부터는 그대로 씁니다.' }),
    ]);
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

  var ALL_STEPS = [
    { id: 'account', title: '시작', render: stepAccount },
    { id: 'consent', title: '동의', render: stepConsent },
    { id: 'level', title: '경력', render: stepLevel },
    { id: 'profile', title: '내 정보', render: stepProfile },
    { id: 'gym', title: '헬스장 기구', render: stepGym },
    { id: 'measure', title: '실측', render: stepMeasure },
    { id: 'result', title: '프로그램', render: stepResult },
  ];

  /**
   * 오늘 보여줄 단계.
   *
   * 가입이 **맨 앞**이다.
   *
   * 처음엔 프로그램을 보여준 뒤에 뒀었다 — 아무것도 못 받아 본 사람에게
   * 이메일부터 달라고 하면 거기서 나간다는 생각이었다. 그 논리는 **로그인이
   * 선택일 때만** 맞는다. 어차피 필수라면, 설문 다섯 단계를 다 시켜 놓고
   * 마지막에 벽을 세우는 것이 된다 — 거기서 나가는 사람은 수고를 다 하고
   * 나간다.
   *
   * 폰을 바꾼 사람에게도 이쪽이 낫다. 전에는 첫 화면의 작은 글씨를 찾아야
   * 했는데, 이제 첫 화면이 곧 로그인이다.
   *
   * **로그인한 사람에게는 이 단계가 없다.** 목록에서 빠지면 그다음인 동의가
   * 저절로 첫 화면이 되므로, 돌아온 자리를 따로 계산할 필요가 없다.
   *
   * 서버가 없으면(로컬 빌드) 역시 없다. 눌러 봐야 안 되는 화면을 띄우는 것은
   * 없는 것보다 나쁘다.
   */
  function steps() {
    var usable = typeof Remote !== 'undefined' && Remote.configured();
    return ALL_STEPS.filter(function (step) {
      if (step.id !== 'account') return true;
      return usable && !Remote.signedIn();
    });
  }

  /**
   * 가입 — 건너뛸 수 없다.
   *
   * 볼륨 코치는 계정이 있어야 쓰는 앱이다. 기록이 계정에 있어야 폰을
   * 바꿔도 남고, 헬스장 기구 정보도 계정 단위로 모인다. 그 사실을 화면
   * 맨 아래에 그대로 적는다 — 벽을 세우면서 이유를 감추면 그건 속인 것이다.
   */
  function stepAccount() {
    var form = state.onboarding.account || (state.onboarding.account = {
      email: '', password: '', notice: null, busy: false, mode: 'signup',
    });
    var signUp = form.mode !== 'signin';

    // 제목은 마법사가 이미 단계 이름으로 달았다. 여기서 또 달면 h2가 둘이 된다.
    screen.appendChild(el('p', { class: 'asset-note', text:
      '폰을 바꿔도 기록이 남고, 같은 헬스장 다니는 분들과 기구 정보가 모입니다. ' +
      '이미 쓰시던 계정이 있으면 로그인만 하세요 — 설문은 건너뜁니다.' }));

    /*
     * 카카오·구글을 위에 둔다.
     *
     * 이메일 가입은 확인 메일을 기다려야 하고, 새 비밀번호를 하나 더
     * 만들어야 한다. 대부분은 이미 가진 계정으로 들어오는 편이 빠르다.
     */
    screen.appendChild(oauthRows());
    screen.appendChild(el('div', { class: 'list-label', text: '또는 이메일로' }));


    if (form.notice) {
      screen.appendChild(el('div', { class: 'notice' + (form.notice.bad ? ' stop' : '') }, [
        el('div', { class: 'label', text: form.notice.bad ? '확인 필요' : '알림' }),
        el('div', { text: form.notice.text }),
      ]));
    }

    var mailInput = el('input', {
      type: 'email', class: 'text-input', placeholder: '이메일',
      value: form.email, 'aria-label': '이메일',
      autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      oninput: function (event) { form.email = event.target.value; },
    });
    var passInput = el('input', {
      type: 'password', class: 'text-input',
      placeholder: signUp ? '비밀번호 (6자 이상)' : '비밀번호',
      value: form.password, 'aria-label': '비밀번호',
      autocomplete: signUp ? 'new-password' : 'current-password',
      oninput: function (event) { form.password = event.target.value; },
      onkeydown: function (event) { if (event.key === 'Enter') submit(); },
    });
    screen.appendChild(el('div', { class: 'auth-form' }, [mailInput, passInput]));

    function submit() {
      form.email = mailInput.value;
      form.password = passInput.value;

      if (!form.email.trim()) {
        form.notice = { bad: true, text: '이메일을 넣어 주세요.' };
        return render();
      }
      if (form.password.length < 6) {
        form.notice = { bad: true, text: '비밀번호는 6자 이상이어야 합니다.' };
        return render();
      }

      form.busy = true;
      form.notice = { bad: false, text: signUp ? '계정을 만드는 중…' : '로그인하는 중…' };
      render();

      var run = signUp ? Remote.signUp : Remote.signIn;
      run(form.email.trim(), form.password).then(function (result) {
        form.busy = false;
        // 비밀번호는 성공하든 말든 화면에 남겨 두지 않는다.
        form.password = '';
        Remote.patch({ email: form.email.trim() });

        /*
         * 메일 확인이 필요해도 여기서 멈추지 않는다. 확인 링크를 누르러
         * 간 사이에 온보딩이 끝나지 않은 채로 남으면, 돌아와서 처음부터
         * 다시 하게 된다. 기록은 어차피 이 기기에 먼저 쌓이므로, 나중에
         * 로그인하면 그때 올라간다.
         */
        if (result && result.needsConfirm) {
          /*
           * 계정이 있어야 쓰는 앱이라 여기서 기다려야 한다. 그 사실을 화면에
           * 말한다 — 아무 말 없이 같은 화면이 다시 뜨면 고장 난 줄 안다.
           * 카카오·구글은 확인 메일이 없으니 그쪽을 같이 권한다.
           */
          form.mode = 'signin';
          form.notice = { bad: false, text:
            '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 여기서 로그인하세요. ' +
            '기다리기 싫으시면 위의 카카오·구글로 바로 시작할 수 있습니다.' };
          pushLog('계정', '가입했습니다. 확인 메일의 링크를 누른 뒤 로그인하세요.');
        } else {
          pushLog('계정', '<b>' + form.email.trim() + '</b>' +
            (signUp ? '으로 가입했습니다.' : '으로 로그인했습니다.'));
        }

        /*
         * 가입과 로그인은 여기서 갈린다.
         *
         * **가입**은 빈 계정이다. 방금 한 설문이 전부이므로 먼저 프로그램을
         * 만들고 올린다.
         *
         * **로그인**은 다르다. 계정에 쓰던 프로그램이 있을 수 있고, 그
         * 사람에게 필요한 건 방금 한 설문이 아니라 그것이다. 먼저 맞춰
         * 보고, 되살아났으면 설문 결과를 덮어쓰지 않는다 —
         * completeOnboarding()은 답을 가지고 프로그램을 새로 짜는 함수라,
         * 되살린 프로그램을 그 자리에서 날려 버린다.
         */
        /*
         * **여기서 프로그램을 만들지 않는다.**
         *
         * 가입이 맨 뒤에 있을 때는 이 자리가 마지막이라 completeOnboarding()을
         * 불렀다. 지금은 설문이 뒤에 남아 있다 — 여기서 만들면 아무것도 안
         * 물어본 기본값으로 프로그램이 나온다.
         *
         * 그릴 일만 남는다. 로그인한 사람에게는 가입 단계가 목록에서
         * 빠지므로(steps), 다음인 동의가 저절로 첫 화면이 된다.
         *
         * 로그인은 하나 더 한다 — 계정에 쓰던 프로그램이 있으면 설문을
         * 통째로 건너뛴다(syncNow → adoptAccountProgram).
         */
        var finish = function () { render(); };
        if (signUp || !Remote.signedIn()) render();
        else syncNow().then(finish, finish);
      }, function (error) {
        form.busy = false;
        form.password = '';
        form.notice = { bad: true, text: error.message };
        render();
      });
    }

    screen.appendChild(el('button', {
      type: 'button', class: 'finish',
      disabled: form.busy ? '' : null,
      text: form.busy ? (signUp ? '만드는 중…' : '로그인하는 중…')
        : (signUp ? '계정 만들기' : '로그인'),
      onclick: submit,
    }));

    /*
     * 동의를 두 번에 나눠 받는다.
     *
     * 여기서 받는 것은 계정을 만드는 데 필요한 것(이메일·계정 정보)뿐이다.
     * **체중·통증·운동 기록은 민감정보라 따로 받아야 한다** — 개인정보보호법은
     * 이걸 다른 동의와 묶지 말라고 하고, 묶어서 한 번에 받으면 동의로 치지
     * 않는다.
     *
     * 그래서 다음 화면이 동의 화면이고, 여기서는 그 사실만 미리 말해 둔다.
     * 가입 버튼을 누르는 사람이 "이걸로 다 끝났다"고 생각하면 안 된다.
     */
    screen.appendChild(el('p', { class: 'hint-line', text:
      '계정을 만들 때는 이메일과 계정 정보만 씁니다. ' +
      '체중·통증·운동 기록 같은 건강 정보는 다음 화면에서 따로 여쭤봅니다.' }));

    /*
     * 이미 계정이 있는 사람이 들어올 길이 반드시 있어야 한다.
     *
     * 가입만 있으면 폰을 바꿨거나 앱을 지웠다 깐 사람이 못 들어온다 —
     * 기록을 지키라고 만든 계정인데 정작 그 기록을 못 찾게 되는 것이다.
     */
    screen.appendChild(el('button', {
      type: 'button', class: 'finish quiet',
      text: signUp ? '이미 계정이 있어요 — 로그인' : '처음이에요 — 계정 만들기',
      onclick: function () {
        form.mode = signUp ? 'signin' : 'signup';
        form.notice = null;
        form.password = '';
        render();
      },
    }));

    /*
     * 이 줄은 가입이 맨 뒤에 있을 때 "동의를 받았고"라고 과거형으로 적혀
     * 있었다. 그때는 동의가 이미 지나간 단계였으니 맞는 말이었다.
     *
     * 가입이 맨 앞으로 오면서 그 문장이 거짓말이 됐다 — 아직 아무 동의도
     * 안 받았다. 화면이 하는 말과 실제가 어긋나는 것은 기능이 하나 빠진
     * 것보다 나쁘다.
     */
    screen.appendChild(el('p', { class: 'hint-line', text:
      '가입 확인 메일이 늦게 와도 앱은 바로 쓰실 수 있고, 그동안의 기록은 ' +
      '확인되는 대로 올라갑니다. 계정과 기록은 언제든 서버에서 지울 수 있습니다.' }));
  }

  function startOnboarding() {
    storage.reset();
    state.todaySets = [];
    state.machinePick = {};
    state.machineSame = {};
    state.answers = JSON.parse(JSON.stringify(DEFAULT_ANSWERS));
    state.answers.gym.measurements = {};
    state.onboarding = { active: true, step: 0, account: null };
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
    /*
     * 방금 만든 프로그램이 이 계정의 첫 내용이다. 여기서 안 올리면 폰을
     * 바꿨을 때 되살릴 것이 없다 — 8초를 기다릴 이유가 없는 순간이다.
     */
    if (Remote.configured() && Remote.signedIn()) syncNow();
    render();
  }

  function renderOnboarding() {
    var STEPS = steps();
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

    /*
     * 가입 단계의 주 버튼은 그 화면 안에 있다(계정 만들기 · 로그인).
     * 여기서는 건너뛰는 길만 둔다 — 건너뛰기가 "다음"과 똑같이 생기면
     * 둘 중 뭘 누른 건지 모르게 된다.
     */
    /*
     * 가입 단계에는 "다음"이 없다. 그 화면의 버튼으로만 넘어간다.
     *
     * 계정을 안 만들면 기구 정보를 나눌 수도, 폰을 바꿨을 때 기록을 찾을
     * 수도 없다. 그 둘이 이 앱의 뼈대라서 건너뛰는 길을 두지 않았다.
     *
     * 대신 **가입 확인 메일을 기다리게 하지는 않는다.** 계정만 만들어지면
     * 바로 넘어가고, 메일 확인은 나중에 해도 된다 — 링크 누르러 간 사이에
     * 설정이 반쯤 된 채로 남으면 돌아와서 처음부터 다시 하게 된다.
     *
     * "이 프로그램으로 시작"은 프로그램을 본 그 화면에 있어야 한다. 뒤에
     * 가입 단계가 붙었다고 그 자리가 "다음"으로 바뀌면, 정작 고르는 순간에
     * 아무 말도 안 하는 버튼이 놓인다.
     */
    if (step.id !== 'account') {
      nav.appendChild(el('button', {
        type: 'button', class: 'primary',
        disabled: blocked ? '' : null,
        text: (step.id === 'result' || isLast) ? '이 프로그램으로 시작' : '다음',
        onclick: function () {
          if (blocked) return;
          if (isLast) completeOnboarding();
          else { state.onboarding.step += 1; render(); }
        },
      }));
    }
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
    /*
     * 전에는 여기에 "이미 계정이 있으신가요? 로그인" 한 줄이 있었다.
     * 가입이 맨 앞으로 오면서 **첫 화면이 곧 로그인**이 됐으므로 지운다 —
     * 로그인하고 들어온 사람에게 또 로그인을 권하는 줄이 된다.
     */

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
  /* ── 기구 목록 고치기 ────────────────────────────

     같은 목록을 두 곳에서 쓴다. 설문에서 한 번(처음 다니는 곳),
     헬스장 탭에서 또 한 번(두 번째 헬스장을 등록했을 때).

     처음에는 설문에만 뒀는데, 그러면 **등록을 마친 뒤에는 기구를 고칠
     길이 없다.** 프리셋이 찍어 준 목록으로 고정되고, 운동 중에 "이 기구
     없어요"를 종목마다 누르는 수밖에 없었다. 직접 등록하는 사람은 거기
     뭐가 있는지 본인이 제일 잘 아는데도 말이다.
  ── */

  /** 지금 고치는 목록이 어느 것인가. 'gym'이면 선택된 헬스장, 아니면 설문 답. */
  function equipmentScope() {
    return state.equipScope === 'gym' ? 'gym' : 'answers';
  }

  function equipmentIds() {
    if (equipmentScope() === 'gym') {
      var entry = currentGymEntry();
      return entry ? entry.equipmentIds : [];
    }
    return state.answers.gym.equipmentIds;
  }

  /**
   * 고른 것을 되돌려 놓는다.
   *
   * 헬스장 쪽은 손댈 데가 여럿이다. 운동을 짜는 건 gymBook의 항목이고,
   * 검색·합치기가 보는 건 myDirectory의 항목이라, 한쪽만 고치면 다음에
   * 헬스장을 다시 고를 때 옛 목록이 되살아난다.
   */
  function setEquipmentIds(next) {
    if (equipmentScope() !== 'gym') {
      state.answers.gym.equipmentIds = next;
      return;
    }

    var entry = currentGymEntry();
    if (!entry) return;
    var updated = Object.assign({}, entry, { equipmentIds: next });

    state.gymBook = E.addGym(state.gymBook, updated);
    state.gym = E.activeProfile(state.gymBook);
    state.answers.gym.equipmentIds = next.slice();
    /*
     * 끈 기구는 "없음"으로 기억한다.
     *
     * 전에는 켠 것만 올렸다. 그래서 한 번 "있음"으로 올라간 기구는 꺼도
     * 서버에 "있음"으로 남았고, 다음 사람은 없는 기구를 받았다. 남이 적은
     * 목록을 그대로 쓰게 하려면 그 목록이 고쳐질 수 있어야 한다.
     *
     * 고친 순간부터는 남의 목록이 아니라 내 확인이다(crowdAdopted 해제).
     */
    var removed = entry.equipmentIds.filter(function (id) { return next.indexOf(id) < 0; });
    state.myDirectory = state.myDirectory.map(function (item) {
      if (item.id !== entry.id) return item;
      var absent = (item.absentEquipmentIds || []).filter(function (id) { return next.indexOf(id) < 0; });
      removed.forEach(function (id) { if (absent.indexOf(id) < 0) absent.push(id); });
      return Object.assign({}, item, {
        equipmentIds: next.slice(), absentEquipmentIds: absent, crowdAdopted: false,
      });
    });

    // 기구가 바뀌면 오늘 할 수 있는 종목이 바뀐다.
    rebuildSession();
    // 내가 아는 기구를 올린다 — 같은 곳 다니는 사람이 덕을 본다.
    shareGymSoon(updated);
    persist();
  }

  function renderEquipmentList() {
    var host = document.getElementById('equipment-list');
    if (!host) return;
    host.textContent = '';

    var selected = equipmentIds();
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
          setEquipmentIds(has
            ? selected.filter(function (id) { return id !== item.id; })
            : selected.concat([item.id]));
          render();
          // 모달 안에서 고칠 때는 render()가 이 목록을 다시 그리지 않는다.
          renderEquipmentList();
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

    /*
     * 개수 줄을 여기서 같이 갱신한다. 토글 핸들러에서 따로 부르게 두면
     * 길이 여럿이라(하나씩 고르기·유형으로 한 번에) 반드시 한쪽을 빠뜨린다.
     */
    var count = document.getElementById('equip-count');
    if (count) {
      var ids = equipmentIds();
      count.textContent = '기구 ' + ids.length + '개 · 할 수 있는 종목 ' +
        E.availableExercises(ids).length + ' / ' + E.EXERCISES.length + '개';
    }
  }

  function stepGym() {
    state.equipScope = 'answers';
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
          var next = E.presetEquipment(preset.id);
          setEquipmentIds(next);
          pushLog('기구 설정', '<b>' + preset.label + '</b> 기준으로 기구 ' +
            next.length + '개를 켰습니다.');
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
    var list = steps();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return i;
    }
    return list.length - 1;
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
  // 카카오·구글에서 돌아왔으면 여기서 거둔다. 주소에 실려 온 토큰도 같이 지운다.
  finishOAuth();
  markStandalone();
  registerWorker();
  render();
  /*
   * 며칠 만에 연 사람의 예약은 오래된 판단으로 들어 있다. 화면을 다 그린
   * 뒤에 한 번 다시 올린다 — 첫 화면이 늦어지면 안 되므로 뒤로 미룬다.
   */
  setTimeout(scheduleNudge, 3000);
  // 지난번에 못 올린 것이 있을 수 있다. 첫 화면을 다 그린 뒤에 맞춘다.
  setTimeout(syncSoon, 2500);
  // 친구 목록과 받은 응원. 첫 화면이 늦어지면 안 되므로 뒤로 미룬다.
  setTimeout(function () { pushMyWeek(); loadFriends(); }, 1200);
})();

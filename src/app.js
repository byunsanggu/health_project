/* 건강 기록 - 브라우저 로컬 저장 기반 단일 페이지 앱 */
(function () {
  'use strict';

  var ENTRIES_KEY = 'health_project.entries.v1';
  var SETTINGS_KEY = 'health_project.settings.v1';

  var NUMERIC_FIELDS = [
    { key: 'weight', label: '체중', unit: 'kg', min: 0, max: 500 },
    { key: 'exercise', label: '운동', unit: '분', min: 0, max: 1440 },
    { key: 'calories', label: '칼로리', unit: 'kcal', min: 0, max: 20000 },
    { key: 'sleep', label: '수면', unit: '시간', min: 0, max: 24 },
    { key: 'water', label: '물', unit: '잔', min: 0, max: 50 }
  ];

  var state = { entries: [], settings: {} };

  /* ---------- 저장소 ---------- */

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn('저장된 데이터를 읽지 못했습니다:', err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('저장에 실패했습니다:', err);
      return false;
    }
  }

  function load() {
    var entries = readJSON(ENTRIES_KEY, []);
    state.entries = Array.isArray(entries) ? entries.filter(isValidEntry).map(normalizeEntry) : [];
    sortEntries();
    var settings = readJSON(SETTINGS_KEY, {});
    state.settings = settings && typeof settings === 'object' ? settings : {};
  }

  function save() {
    writeJSON(ENTRIES_KEY, state.entries);
  }

  /* ---------- 데이터 도우미 ---------- */

  function isValidEntry(entry) {
    return entry && typeof entry === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date);
  }

  function normalizeEntry(entry) {
    var out = { date: entry.date, memo: typeof entry.memo === 'string' ? entry.memo.slice(0, 200) : '' };
    NUMERIC_FIELDS.forEach(function (field) {
      out[field.key] = clampNumber(entry[field.key], field.min, field.max);
    });
    return out;
  }

  function clampNumber(value, min, max) {
    if (value === null || value === undefined || value === '') return null;
    var num = Number(value);
    if (!isFinite(num)) return null;
    return Math.min(max, Math.max(min, num));
  }

  function sortEntries() {
    state.entries.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  function todayISO() {
    var now = new Date();
    var offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function shiftDays(iso, days) {
    var date = new Date(iso + 'T00:00:00');
    date.setDate(date.getDate() + days);
    var offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function recentEntries(days) {
    var from = shiftDays(todayISO(), -(days - 1));
    return state.entries.filter(function (entry) { return entry.date >= from; });
  }

  function latestWith(key) {
    for (var i = 0; i < state.entries.length; i += 1) {
      if (state.entries[i][key] !== null) return state.entries[i];
    }
    return null;
  }

  function average(values) {
    if (!values.length) return null;
    var sum = values.reduce(function (acc, value) { return acc + value; }, 0);
    return sum / values.length;
  }

  function collect(entries, key) {
    return entries
      .map(function (entry) { return entry[key]; })
      .filter(function (value) { return value !== null; });
  }

  function round(value, digits) {
    var factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined) return '–';
    return round(value, digits).toLocaleString('ko-KR');
  }

  /* ---------- 요약 ---------- */

  function bmi(weightKg, heightCm) {
    if (!weightKg || !heightCm) return null;
    var meters = heightCm / 100;
    return weightKg / (meters * meters);
  }

  function bmiLabel(value) {
    if (value === null) return '';
    if (value < 18.5) return '저체중';
    if (value < 23) return '정상';
    if (value < 25) return '과체중';
    return '비만';
  }

  function renderSummary() {
    var container = document.getElementById('summary');
    var last = latestWith('weight');
    var weight = last ? last.weight : null;
    var target = clampNumber(state.settings.targetWeight, 0, 500);
    var height = clampNumber(state.settings.heightCm, 50, 260);
    var bmiValue = bmi(weight, height);

    var week = recentEntries(7);
    var exerciseTotal = collect(week, 'exercise').reduce(function (a, b) { return a + b; }, 0);
    var sleepAvg = average(collect(week, 'sleep'));
    var calorieAvg = average(collect(week, 'calories'));

    var cards = [
      {
        label: '최근 체중',
        value: weight === null ? '–' : formatNumber(weight, 1) + ' kg',
        sub: last ? last.date : '기록 없음'
      },
      {
        label: '목표까지',
        value: weight === null || target === null ? '–' : formatNumber(weight - target, 1) + ' kg',
        sub: target === null ? '설정에서 목표 체중 입력' : '목표 ' + formatNumber(target, 1) + ' kg'
      },
      {
        label: 'BMI',
        value: bmiValue === null ? '–' : formatNumber(bmiValue, 1),
        sub: bmiValue === null ? '설정에서 키 입력' : bmiLabel(bmiValue)
      },
      {
        label: '주간 운동',
        value: formatNumber(exerciseTotal, 0) + ' 분',
        sub: '최근 7일 합계'
      },
      {
        label: '평균 수면',
        value: sleepAvg === null ? '–' : formatNumber(sleepAvg, 1) + ' 시간',
        sub: '최근 7일'
      },
      {
        label: '평균 칼로리',
        value: calorieAvg === null ? '–' : formatNumber(calorieAvg, 0) + ' kcal',
        sub: '최근 7일'
      }
    ];

    container.textContent = '';
    cards.forEach(function (card) {
      var el = document.createElement('div');
      el.className = 'card';
      el.appendChild(createDiv('label', card.label));
      el.appendChild(createDiv('value', card.value));
      el.appendChild(createDiv('sub', card.sub));
      container.appendChild(el);
    });
  }

  function createDiv(className, text) {
    var el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
  }

  /* ---------- 차트 ---------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (key) { el.setAttribute(key, attrs[key]); });
    return el;
  }

  function seriesFor(days, key) {
    var today = todayISO();
    var byDate = {};
    state.entries.forEach(function (entry) {
      if (entry[key] !== null) byDate[entry.date] = entry[key];
    });
    var points = [];
    for (var i = days - 1; i >= 0; i -= 1) {
      var date = shiftDays(today, -i);
      points.push({ date: date, value: byDate.hasOwnProperty(date) ? byDate[date] : null });
    }
    return points;
  }

  function emptyChart(container, message) {
    container.textContent = '';
    var p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = message;
    container.appendChild(p);
  }

  function chartFrame(width, height, pad, min, max, label) {
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': label
    });
    for (var i = 0; i <= 3; i += 1) {
      var y = pad.top + ((height - pad.top - pad.bottom) * i) / 3;
      svg.appendChild(svgEl('line', {
        x1: pad.left, y1: y, x2: width - pad.right, y2: y,
        stroke: 'var(--grid)', 'stroke-width': 1
      }));
      var tick = svgEl('text', { x: pad.left - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted)' });
      tick.textContent = formatNumber(max - ((max - min) * i) / 3, 1);
      svg.appendChild(tick);
    }
    return svg;
  }

  function axisLabels(svg, points, width, height, pad) {
    var count = points.length;
    var step = Math.max(1, Math.round(count / 5));
    points.forEach(function (point, index) {
      if (index % step !== 0 && index !== count - 1) return;
      var x = pad.left + ((width - pad.left - pad.right) * index) / Math.max(1, count - 1);
      var text = svgEl('text', {
        x: x, y: height - 6, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)'
      });
      text.textContent = point.date.slice(5).replace('-', '/');
      svg.appendChild(text);
    });
  }

  function renderWeightChart() {
    var container = document.getElementById('chart-weight');
    var points = seriesFor(30, 'weight');
    var values = points.map(function (p) { return p.value; }).filter(function (v) { return v !== null; });
    if (values.length < 2) {
      emptyChart(container, '체중 기록이 2일 이상 쌓이면 그래프가 표시됩니다.');
      return;
    }

    var width = 640, height = 220;
    var pad = { top: 12, right: 12, bottom: 24, left: 40 };
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (max - min < 1) { min -= 0.5; max += 0.5; }
    var span = max - min;

    function xAt(index) {
      return pad.left + ((width - pad.left - pad.right) * index) / Math.max(1, points.length - 1);
    }
    function yAt(value) {
      return pad.top + (height - pad.top - pad.bottom) * (1 - (value - min) / span);
    }

    var svg = chartFrame(width, height, pad, min, max, '최근 30일 체중 추이');

    var path = '';
    var dots = [];
    points.forEach(function (point, index) {
      if (point.value === null) return;
      var x = xAt(index), y = yAt(point.value);
      path += (path ? ' L' : 'M') + x + ' ' + y;
      dots.push({ x: x, y: y, point: point });
    });

    svg.appendChild(svgEl('path', {
      d: path, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    dots.forEach(function (dot) {
      var circle = svgEl('circle', { cx: dot.x, cy: dot.y, r: 3, fill: 'var(--accent)' });
      var title = svgEl('title', {});
      title.textContent = dot.point.date + ' · ' + formatNumber(dot.point.value, 1) + ' kg';
      circle.appendChild(title);
      svg.appendChild(circle);
    });

    var targetWeight = clampNumber(state.settings.targetWeight, 0, 500);
    if (targetWeight !== null && targetWeight >= min && targetWeight <= max) {
      svg.appendChild(svgEl('line', {
        x1: pad.left, y1: yAt(targetWeight), x2: width - pad.right, y2: yAt(targetWeight),
        stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.6
      }));
    }

    axisLabels(svg, points, width, height, pad);
    container.textContent = '';
    container.appendChild(svg);
  }

  function renderExerciseChart() {
    var container = document.getElementById('chart-exercise');
    var points = seriesFor(14, 'exercise');
    var values = points.map(function (p) { return p.value; }).filter(function (v) { return v !== null; });
    if (!values.length) {
      emptyChart(container, '운동 기록이 없습니다.');
      return;
    }

    var width = 640, height = 200;
    var pad = { top: 12, right: 12, bottom: 24, left: 40 };
    var max = Math.max.apply(null, values);
    if (max <= 0) max = 1;
    var plotHeight = height - pad.top - pad.bottom;
    var slot = (width - pad.left - pad.right) / points.length;
    var barWidth = Math.max(4, slot * 0.6);

    var svg = chartFrame(width, height, pad, 0, max, '최근 14일 운동 시간');

    points.forEach(function (point, index) {
      var value = point.value || 0;
      var barHeight = (value / max) * plotHeight;
      var x = pad.left + slot * index + (slot - barWidth) / 2;
      var rect = svgEl('rect', {
        x: x, y: pad.top + plotHeight - barHeight, width: barWidth, height: Math.max(0, barHeight),
        rx: 3, fill: value > 0 ? 'var(--accent)' : 'var(--grid)'
      });
      var title = svgEl('title', {});
      title.textContent = point.date + ' · ' + formatNumber(value, 0) + '분';
      rect.appendChild(title);
      svg.appendChild(rect);
    });

    axisLabels(svg, points, width, height, pad);
    container.textContent = '';
    container.appendChild(svg);
  }

  /* ---------- 표 ---------- */

  function renderTable() {
    var tbody = document.querySelector('#entry-table tbody');
    var empty = document.getElementById('empty-state');
    var count = document.getElementById('entry-count');

    tbody.textContent = '';
    count.textContent = state.entries.length ? '총 ' + state.entries.length + '건' : '';
    empty.hidden = state.entries.length > 0;
    document.querySelector('.table-wrap').hidden = state.entries.length === 0;

    state.entries.forEach(function (entry) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(entry.date));
      tr.appendChild(cell(entry.weight === null ? '–' : formatNumber(entry.weight, 1)));
      tr.appendChild(cell(entry.exercise === null ? '–' : formatNumber(entry.exercise, 0)));
      tr.appendChild(cell(entry.calories === null ? '–' : formatNumber(entry.calories, 0)));
      tr.appendChild(cell(entry.sleep === null ? '–' : formatNumber(entry.sleep, 1)));
      tr.appendChild(cell(entry.water === null ? '–' : formatNumber(entry.water, 0)));

      var memo = cell(entry.memo || '');
      memo.className = 'memo';
      tr.appendChild(memo);

      var actions = document.createElement('td');
      var wrap = document.createElement('div');
      wrap.className = 'row-actions';
      wrap.appendChild(rowButton('수정', 'edit', entry.date));
      wrap.appendChild(rowButton('삭제', 'del', entry.date));
      actions.appendChild(wrap);
      tr.appendChild(actions);

      tbody.appendChild(tr);
    });
  }

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  function rowButton(label, action, date) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost ' + action;
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.date = date;
    return button;
  }

  function render() {
    renderSummary();
    renderWeightChart();
    renderExerciseChart();
    renderTable();
  }

  /* ---------- 폼 ---------- */

  var form = document.getElementById('entry-form');
  var hint = document.getElementById('form-hint');
  var hintTimer = null;

  function showHint(message) {
    hint.textContent = message;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.textContent = ''; }, 3000);
  }

  function fillForm(entry) {
    form.elements.date.value = entry.date;
    NUMERIC_FIELDS.forEach(function (field) {
      form.elements[field.key].value = entry[field.key] === null ? '' : entry[field.key];
    });
    form.elements.memo.value = entry.memo || '';
  }

  function resetForm() {
    form.reset();
    form.elements.date.value = todayISO();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var date = form.elements.date.value;
    if (!date) {
      showHint('날짜를 입력해 주세요.');
      return;
    }

    var entry = normalizeEntry({
      date: date,
      memo: form.elements.memo.value.trim(),
      weight: form.elements.weight.value,
      exercise: form.elements.exercise.value,
      calories: form.elements.calories.value,
      sleep: form.elements.sleep.value,
      water: form.elements.water.value
    });

    var hasValue = NUMERIC_FIELDS.some(function (field) { return entry[field.key] !== null; }) || entry.memo;
    if (!hasValue) {
      showHint('최소 한 가지 항목을 입력해 주세요.');
      return;
    }

    upsert(entry);
    save();
    render();
    resetForm();
    showHint(date + ' 기록을 저장했습니다.');
  });

  function upsert(entry) {
    var index = state.entries.findIndex(function (item) { return item.date === entry.date; });
    if (index >= 0) state.entries[index] = entry;
    else state.entries.push(entry);
    sortEntries();
  }

  document.getElementById('btn-reset').addEventListener('click', resetForm);

  document.querySelector('#entry-table tbody').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var date = button.dataset.date;
    var entry = state.entries.find(function (item) { return item.date === date; });
    if (!entry) return;

    if (button.dataset.action === 'edit') {
      fillForm(entry);
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showHint(date + ' 기록을 불러왔습니다. 저장하면 덮어씁니다.');
      return;
    }

    if (window.confirm(date + ' 기록을 삭제할까요?')) {
      state.entries = state.entries.filter(function (item) { return item.date !== date; });
      save();
      render();
    }
  });

  /* ---------- 설정 ---------- */

  var dialog = document.getElementById('settings-dialog');
  var settingsForm = document.getElementById('settings-form');

  document.getElementById('btn-settings').addEventListener('click', function () {
    document.getElementById('s-height').value = state.settings.heightCm || '';
    document.getElementById('s-target').value = state.settings.targetWeight || '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });

  settingsForm.addEventListener('submit', function () {
    if (dialog.returnValue === 'cancel') return;
    state.settings.heightCm = clampNumber(document.getElementById('s-height').value, 50, 260);
    state.settings.targetWeight = clampNumber(document.getElementById('s-target').value, 0, 500);
    writeJSON(SETTINGS_KEY, state.settings);
    render();
  });

  /* ---------- 내보내기 / 가져오기 ---------- */

  document.getElementById('btn-export').addEventListener('click', function () {
    var payload = { version: 1, exportedAt: new Date().toISOString(), settings: state.settings, entries: state.entries };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'health-records-' + todayISO() + '.json';
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('input-import').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var incoming = Array.isArray(data) ? data : data.entries;
        if (!Array.isArray(incoming)) throw new Error('entries 배열을 찾을 수 없습니다.');
        incoming.filter(isValidEntry).map(normalizeEntry).forEach(upsert);
        if (data.settings && typeof data.settings === 'object') {
          state.settings.heightCm = clampNumber(data.settings.heightCm, 50, 260);
          state.settings.targetWeight = clampNumber(data.settings.targetWeight, 0, 500);
          writeJSON(SETTINGS_KEY, state.settings);
        }
        save();
        render();
        showHint('가져오기를 완료했습니다.');
      } catch (err) {
        window.alert('파일을 읽지 못했습니다: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  });

  /* ---------- 시작 ---------- */

  load();
  resetForm();
  render();
})();

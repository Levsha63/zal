/* Zal — тренировочный дневник. Интерфейс приложения.
 * Логика расчётов лежит в logic.js (window.WT), здесь — экраны, ввод и хранение.
 */
(function () {
  'use strict';

  var WT = window.WT;
  var KEY = 'zal_state_v1';
  var S = null;
  var view = 'train';
  var ui = { pickerGroup: 'Все', pickerQuery: '', pickerTarget: 'active', progId: null, histId: null, routineId: null };
  var rest = { until: 0, total: 0, token: 0 };
  var saveTimer = null;
  var toastTimer = null;
  var pendingCharts = {};
  var MONTH_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var COL = { accent: '#c6f432', accent2: '#7fe0c8', line: '#2a3346', muted: '#8b97ab', gold: '#ffd166' };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attr(s) { return esc(s); }

  /* ================================================================== */
  /* Хранение                                                           */
  /* ================================================================== */

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try { S = WT.normalizeState(JSON.parse(raw)); return; } catch (e) { /* повреждённые данные — начнём заново */ }
    }
    S = WT.defaultState();
    save();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('Не получилось сохранить — возможно, закончилось место'); }
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 200); }

  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = kind ? 'show ' + kind : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, kind === 'pr' ? 2800 : 1900);
  }

  function confirmAsk(text) { return window.confirm(text); }

  /* Звук и вибрация на окончание отдыха */
  var audioCtx = null;
  function beep(times) {
    if (!S.settings.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime;
      for (var i = 0; i < (times || 1); i++) {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = 880;
        var start = t0 + i * 0.24;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(start);
        o.stop(start + 0.22);
      }
    } catch (e) { /* звук не критичен */ }
  }
  function buzz(pattern) {
    if (!S.settings.vibrate) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern || 60); } catch (e) {}
  }

  /* ================================================================== */
  /* Таймер отдыха и общий «ход часов»                                  */
  /* ================================================================== */

  function startRest(sec) {
    rest.total = Math.max(5, Math.round(WT.num(sec, S.settings.restSec) || 90));
    rest.until = Date.now() + rest.total * 1000;
    rest.token++;
    var bar = $('#timerbar');
    bar.hidden = false;
    bar.classList.remove('done');
    document.body.classList.add('resting');
    $('#rest-val').textContent = WT.fmtClock(rest.total);
    $('#rest-bar').style.width = '0%';
    tickRest();
  }

  function stopRest() {
    rest.until = 0;
    rest.token++;
    var bar = $('#timerbar');
    bar.hidden = true;
    bar.classList.remove('done');
    document.body.classList.remove('resting');
  }

  function tickRest() {
    if (!rest.until) return;
    var left = Math.max(0, Math.round((rest.until - Date.now()) / 1000));
    var bar = $('#timerbar');
    $('#rest-val').textContent = WT.fmtClock(left);
    $('#rest-bar').style.width = Math.min(100, Math.max(0, (1 - left / rest.total) * 100)) + '%';
    if (left <= 0) {
      rest.until = 0;
      bar.classList.add('done');
      $('#rest-val').textContent = 'Отдых!';
      beep(3);
      buzz([90, 70, 90]);
      var token = rest.token;
      setTimeout(function () { if (rest.token === token) stopRest(); }, 4500);
    }
  }

  function elapsedActive() {
    if (!S.active) return 0;
    return Math.max(0, Math.round((Date.now() - Date.parse(S.active.startedAt)) / 1000));
  }

  setInterval(function () {
    if (rest.until) tickRest();
    var el = document.getElementById('work-time');
    if (el && S.active) el.textContent = WT.fmtClock(elapsedActive());
  }, 1000);

  /* ================================================================== */
  /* Мелкие помощники разметки                                          */
  /* ================================================================== */

  function stat(v, k, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
  }

  function exName(id) { return WT.exerciseName(S, id); }
  function exKind(id) { return WT.exerciseKind(S, id); }
  function isTimeEx(id) { return exKind(id) === 'time'; }

  function setsPreview(sets, limit) {
    var list = (sets || []).filter(function (s) { return WT.num(s.reps) > 0; }).slice(0, limit || 4);
    if (!list.length) return '—';
    return list.map(function (s) { return WT.fmtNum(s.kg) + '×' + WT.fmtNum(s.reps); }).join(', ');
  }

  function prMap() { return WT.computePRs(S.workouts); }

  /* ================================================================== */
  /* Общая отрисовка                                                    */
  /* ================================================================== */

  function render() {
    var titles = { train: 'Тренировка', history: 'История', progress: 'Прогресс', more: 'Ещё' };
    var subs = {
      train: S.active ? 'Идёт тренировка · ' + WT.fmtClock(elapsedActive()) : 'Готов начать?',
      history: S.workouts.length + ' записей',
      progress: 'Рекорды и графики',
      more: 'Шаблоны, данные, настройки'
    };
    $('#bar-title').textContent = titles[view];
    $('#bar-sub').textContent = subs[view];
    var action = $('#bar-action');
    if (view === 'train') { action.hidden = !S.active; action.textContent = '＋'; action.title = 'Добавить упражнение'; }
    else if (view === 'progress') { action.hidden = false; action.textContent = '🔍'; action.title = 'Найти упражнение'; }
    else { action.hidden = true; }

    $$('#tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === view);
    });

    pendingCharts = {};
    var scr = $('#screen');
    if (view === 'train') scr.innerHTML = renderTrain();
    else if (view === 'history') scr.innerHTML = renderHistory();
    else if (view === 'progress') scr.innerHTML = renderProgress();
    else scr.innerHTML = renderMore();

    drawPendingCharts();
  }

  function drawPendingCharts() {
    Object.keys(pendingCharts).forEach(function (id) {
      var canvas = document.getElementById(id);
      if (!canvas) return;
      var conf = pendingCharts[id];
      drawChart(canvas, conf);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Экран «Тренировка»                                                 */
  /* ------------------------------------------------------------------ */

  function renderTrain() {
    if (!S.active) return renderTrainIdle();
    var sum = WT.activitySummary(S.workouts);
    var html = '';
    html += '<div class="card accent">' +
      '<div class="spread">' +
      '<div><b>Тренировка идёт</b>' +
      '<div class="small muted mt" style="margin-top:4px">' +
      '⏱ <span id="work-time" class="mono">' + WT.fmtClock(elapsedActive()) + '</span>' +
      ' · <span id="work-vol">' + WT.fmtVolume(WT.workoutStats(S.active).volume) + '</span>' +
      ' · подходов: <span id="work-sets">' + WT.workoutStats(S.active).sets + '</span>' +
      '</div></div>' +
      '<span class="chip accent">' + esc(S.active.routineId ? WT.routineName(S, S.active.routineId) : 'свободная') + '</span>' +
      '</div></div>';

    if (!S.active.entries.length) {
      html += '<div class="card"><div class="empty"><div class="big">🏋️</div>' +
        'Добавь первое упражнение' +
        '<div class="small mt">Подсказка: вес и повторы подставим из прошлой тренировки</div>' +
        '<div class="mt"><button class="btn primary wide" data-act="pickExercise">Выбрать упражнение</button></div>' +
        '</div></div>';
    } else {
      S.active.entries.forEach(function (entry, ei) { html += exCardHtml(ei); });
      html += '<button class="btn wide ghost mb" data-act="pickExercise">＋ Добавить упражнение</button>';
    }

    html += '<div class="card tight"><div class="row">' +
      '<button class="btn primary grow" data-act="finish">Завершить тренировку</button>' +
      '<button class="btn ghost" data-act="cancelWorkout" title="Отменить">✕</button>' +
      '</div>' +
      '<div class="tiny muted mt">Черновик сохраняется сам — можно закрыть приложение и продолжить позже.</div>' +
      '</div>';

    html += '<div class="stat-grid three">' +
      stat(sum.week, 'тренировок за 7 дней') +
      stat(sum.weeks + ' 🔥', 'недель подряд', 'slim') +
      stat(WT.fmtVolume(sum.totalVolume), 'общий объём', 'slim') +
      '</div>';
    return html;
  }

  function renderTrainIdle() {
    var sum = WT.activitySummary(S.workouts);
    var last = S.workouts[0] || null;
    var html = '';

    html += '<div class="card accent">' +
      '<h2>Готов тренироваться?</h2>' +
      '<div class="small muted mb">Все подходы, веса и рекорды сохраняются на телефоне. Интернет не нужен.</div>' +
      '<button class="btn primary wide" data-act="startEmpty">Начать пустую тренировку</button>' +
      '<div class="lbl" style="margin-top:14px">или по шаблону</div>' +
      '<div class="row wrap">' +
      S.routines.map(function (r) {
        return '<button class="pill-btn" data-act="startRoutine" data-id="' + attr(r.id) + '">' + esc(r.name) + '</button>';
      }).join('') +
      '</div></div>';

    html += '<div class="stat-grid">' +
      stat(sum.week, 'тренировок за 7 дней') +
      stat(sum.weeks + ' 🔥', 'недель подряд') +
      stat(WT.fmtVolume(sum.totalVolume), 'суммарный объём') +
      stat(sum.total, 'тренировок всего') +
      '</div>';

    if (last) {
      var st = WT.workoutStats(last);
      html += '<div class="card"><h3>Прошлая тренировка</h3>' +
        '<div class="spread"><div class="grow"><div style="font-weight:650">' + esc(last.name || (last.routineId ? WT.routineName(S, last.routineId) : 'Тренировка')) + '</div>' +
        '<div class="small muted">' + WT.dayLabel(last.startedAt) + ' · ' + WT.fmtVolume(st.volume) + ' · ' + st.sets + ' подх.' +
        (st.durationSec ? ' · ' + WT.fmtDuration(st.durationSec) : '') + '</div></div>' +
        '<button class="btn sm" data-act="histOpen" data-id="' + attr(last.id) + '">Открыть</button></div></div>';
    }

    html += '<div class="card"><h3>Подсказки</h3><div class="small muted">' +
      '• Отмечай подход галочкой — включится таймер отдыха.<br>' +
      '• Кнопка «разминка» добавит 40/60/80 % от рабочего веса.<br>' +
      '• «блины» подскажет, что вешать на штангу.<br>' +
      '• Рекорды и графики — во вкладке «Прогресс».' +
      '</div></div>';
    return html;
  }

  function fieldHtml(f, ei, si, val, unit, mode) {
    return '<div class="field"><input type="text" inputmode="' + mode + '" autocomplete="off" ' +
      'data-set="' + f + '" data-ei="' + ei + '" data-si="' + si + '" ' +
      'value="' + (WT.num(val) ? WT.fmtNum(val) : '') + '" placeholder="0">' +
      '<span class="unit">' + unit + '</span></div>';
  }

  function exCardHtml(ei) {
    var entry = S.active.entries[ei];
    var entry2 = entry || { sets: [] };
    var ex = WT.exerciseById(S, entry2.exerciseId) || { name: 'Упражнение', group: '', kind: 'barbell' };
    var st = WT.entryStats(entry2);
    var time = ex.kind === 'time';
    var last = WT.lastPerformance(S.workouts, entry2.exerciseId, S.active.startedAt);
    var hint = last
      ? 'В прошлый раз (' + WT.dayLabel(last.date) + '): <b>' + setsPreview(last.sets, 5) + '</b>'
      : (S.workouts.length ? 'Это упражнение ещё не делал' : 'Первый раз — впиши рабочий вес');
    var pr = prMap()[entry2.exerciseId];

    var rows = entry2.sets.map(function (s, si) {
      return '<div class="set-row' + (s.warmup ? ' warmup' : '') + '">' +
        '<div class="idx">' + (s.warmup ? 'Р' : (si + 1)) + '</div>' +
        fieldHtml('kg', ei, si, s.kg, 'кг', 'decimal') +
        fieldHtml('reps', ei, si, s.reps, time ? 'сек' : 'раз', 'numeric') +
        '<button class="tick' + (s.done ? ' on' : '') + '" data-act="toggleSet" data-ei="' + ei + '" data-si="' + si + '">' + (s.done ? '✓' : '') + '</button>' +
        '<button class="set-more" data-act="setMenu" data-ei="' + ei + '" data-si="' + si + '">⋯</button>' +
        '</div>';
    }).join('');

    return '<div class="card" data-card="' + ei + '">' +
      '<div class="ex-head">' +
      '<div class="grow"><div class="nm">' + esc(ex.name) + '</div>' +
      '<div class="hint">' + hint + '</div></div>' +
      '<span class="chip">' + esc(ex.group || '') + '</span>' +
      '<button class="btn icon ghost" data-act="exMenu" data-ei="' + ei + '">⋯</button>' +
      '</div>' +
      '<div class="set-row head"><div class="idx">#</div><div>вес</div><div>' + (time ? 'секунды' : 'повторы') + '</div><div></div><div></div></div>' +
      rows +
      '<div class="ex-foot">' +
      '<button class="btn sm" data-act="addSet" data-ei="' + ei + '">+ подход</button>' +
      '<button class="btn sm ghost" data-act="warmup" data-ei="' + ei + '">разминка</button>' +
      '<button class="btn sm ghost" data-act="plate" data-ei="' + ei + '">блины</button>' +
      '</div>' +
      (st.sets ? '<div class="tiny muted mt">Объём ' + WT.fmtVolume(st.volume) +
        ' · лучший подход ≈1ПМ ' + WT.fmtNum(st.best1RM) + ' кг' +
        (pr ? ' · твой рекорд ' + WT.fmtNum(pr.kg) + ' кг' : '') + '</div>' : '') +
      '</div>';
  }

  function refreshExCard(ei) {
    var node = $('[data-card="' + ei + '"]');
    if (!node || !S.active) { render(); return; }
    var holder = document.createElement('div');
    holder.innerHTML = exCardHtml(ei);
    node.parentNode.replaceChild(holder.firstChild, node);
  }

  function updateWorkoutTotals() {
    if (!S.active) return;
    var st = WT.workoutStats(S.active);
    var vol = document.getElementById('work-vol');
    var sets = document.getElementById('work-sets');
    if (vol) vol.textContent = WT.fmtVolume(st.volume);
    if (sets) sets.textContent = st.sets;
  }

  /* ------------------------------------------------------------------ */
  /* Экран «История»                                                    */
  /* ------------------------------------------------------------------ */

  function renderHistory() {
    if (!S.workouts.length) {
      return '<div class="card"><div class="empty"><div class="big">📋</div>Пока пусто' +
        '<div class="small mt">Завершённые тренировки появятся здесь.</div></div></div>';
    }
    var sum = WT.activitySummary(S.workouts);
    var prs = prMap();
    var html = '<div class="stat-grid three">' +
      stat(sum.total, 'тренировок', 'slim') +
      stat(sum.month, 'за 30 дней', 'slim') +
      stat(WT.fmtVolume(sum.totalVolume), 'общий объём', 'slim') +
      '</div>';

    var opened = false;
    var lastMonth = null;
    S.workouts.forEach(function (w) {
      var d = new Date(w.startedAt);
      var month = MONTH_FULL[d.getMonth()] + ' ' + d.getFullYear();
      if (month !== lastMonth) {
        if (opened) html += '</div>';
        html += '<div class="list-sep">' + month + '</div><div class="list">';
        opened = true;
        lastMonth = month;
      }
      var st = WT.workoutStats(w);
      var hasPr = (w.entries || []).some(function (e) {
        var p = prs[e.exerciseId];
        return p && p.workoutId === w.id;
      });
      var names = (w.entries || []).map(function (e) { return exName(e.exerciseId); });
      html += '<button class="list-item" data-act="histOpen" data-id="' + attr(w.id) + '">' +
        '<div class="ico-lg">' + (hasPr ? '🏆' : '💪') + '</div>' +
        '<div class="grow"><div class="t">' + esc(w.name || (w.routineId ? WT.routineName(S, w.routineId) : 'Тренировка')) + '</div>' +
        '<div class="d">' + WT.dayLabel(w.startedAt) + ' · ' + WT.fmtVolume(st.volume) + ' · ' + st.sets + ' подх.' +
        (st.durationSec ? ' · ' + WT.fmtDuration(st.durationSec) : '') + '</div>' +
        '<div class="d ellipsis">' + esc(names.slice(0, 3).join(', ')) + (names.length > 3 ? ' и ещё ' + (names.length - 3) : '') + '</div>' +
        '</div><div class="chev">›</div></button>';
    });
    if (opened) html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Экран «Прогресс»                                                   */
  /* ------------------------------------------------------------------ */

  function renderProgress() {
    var sum = WT.activitySummary(S.workouts);
    var prs = prMap();
    var html = '<div class="stat-grid">' +
      stat(sum.total, 'тренировок') +
      stat(sum.avgPerWeek, 'в среднем в неделю') +
      stat(sum.weeks + ' 🔥', 'недель подряд') +
      stat(WT.fmtVolume(sum.totalVolume), 'поднято всего за всё время') +
      '</div>';

    html += bodyWeightCard();

    if (ui.progId) html += exerciseProgressCard(ui.progId);

    var withData = S.exercises.filter(function (e) { return prs[e.id]; });
    withData.sort(function (a, b) { return prs[b.id].est1RM - prs[a.id].est1RM; });

    html += '<div class="card"><h3>Упражнения и рекорды</h3>';
    if (!withData.length) {
      html += '<div class="small muted">Запиши первую тренировку — здесь появятся рекорды и графики.</div>';
    } else {
      html += '<div class="list" style="border:0">';
      withData.forEach(function (e) {
        var p = prs[e.id];
        var series = WT.progressSeries(S.workouts, e.id);
        var trend = '';
        if (series.length >= 2) {
          var d = series[series.length - 1].best1RM - series[0].best1RM;
          trend = d > 0.01 ? '<span class="chip accent">+' + WT.fmtNum(d) + ' кг</span>'
            : (d < -0.01 ? '<span class="chip danger">' + WT.fmtNum(d) + ' кг</span>' : '<span class="chip">без изменений</span>');
        }
        html += '<button class="list-item" data-act="progOpen" data-id="' + attr(e.id) + '">' +
          '<div class="grow"><div class="t">' + esc(e.name) + '</div>' +
          '<div class="d">рекорд ' + WT.fmtNum(p.kg) + ' кг × ' + WT.fmtNum(p.reps) + ' · ≈1ПМ ' + WT.fmtNum(p.est1RM) + ' кг · ' + WT.dayLabel(p.date) + '</div></div>' +
          trend + '<div class="chev">›</div></button>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function bodyWeightCard() {
    var series = WT.bodyWeightSeries(S);
    var html = '<div class="card"><div class="spread"><h3>Вес тела</h3>' +
      '<button class="btn sm" data-act="bwAdd">Записать</button></div>';
    if (!series.length) {
      return html + '<div class="small muted">Записывай вес раз в неделю — увидишь динамику.</div></div>';
    }
    var last = series[series.length - 1];
    var first = series[0];
    var delta = WT.round2(last.kg - first.kg);
    html += '<div class="row" style="align-items:baseline;gap:8px">' +
      '<div style="font-size:26px;font-weight:750" class="mono">' + WT.fmtNum(last.kg) + '</div><div class="muted">кг</div>' +
      (series.length > 1 ? '<span class="chip ' + (delta <= 0 ? 'accent' : 'danger') + '">' + (delta > 0 ? '+' : '') + WT.fmtNum(delta) + ' кг с ' + WT.fmtDate(first.date) + '</span>' : '') +
      '</div>';
    if (series.length > 1) {
      var id = 'chart-bw';
      pendingCharts[id] = {
        series: series.map(function (b) { return { x: Date.parse(b.date), y: b.kg }; }),
        color: COL.accent2, unit: 'кг', decimals: 1
      };
      html += '<div class="chart-wrap mt"><canvas class="chart" id="' + id + '"></canvas></div>';
    }
    return html + '</div>';
  }

  function exerciseProgressCard(id) {
    var ex = WT.exerciseById(S, id) || { name: '?' };
    var series = WT.progressSeries(S.workouts, id);
    var last = WT.lastPerformance(S.workouts, id);
    if (!series.length) {
      return '<div class="card"><div class="spread"><h3>' + esc(ex.name) + '</h3>' +
        '<button class="btn sm ghost" data-act="progClose">убрать</button></div>' +
        '<div class="small muted">Ещё нет данных по этому упражнению.</div></div>';
    }
    var pr = prMap()[id];
    var html = '<div class="card"><div class="spread"><h3>' + esc(ex.name) + '</h3>' +
      '<button class="btn sm ghost" data-act="progClose">убрать</button></div>';

    html += '<div class="stat-grid three">' +
      stat(WT.fmtNum(pr.kg) + '<span class="small muted"> кг</span>', 'рекордный вес', 'slim') +
      stat(WT.fmtNum(pr.est1RM) + '<span class="small muted"> кг</span>', 'лучший ≈1ПМ', 'slim') +
      stat(series.length, 'тренировок в графике', 'slim') +
      '</div>';

    var chartId = 'chart-ex';
    pendingCharts[chartId] = {
      series: series.map(function (r) { return { x: Date.parse(r.date), y: r.topKg }; }),
      series2: series.map(function (r) { return { x: Date.parse(r.date), y: r.best1RM }; }),
      color: COL.accent, color2: COL.accent2, unit: 'кг', decimals: 1,
      label1: 'рабочий вес', label2: 'оценка 1ПМ'
    };
    html += '<div class="chart-wrap mt"><canvas class="chart tall" id="' + chartId + '"></canvas></div>' +
      '<div class="chart-legend"><span><i style="background:' + COL.accent + '"></i>рабочий вес</span>' +
      '<span><i style="background:' + COL.accent2 + '"></i>оценка 1ПМ</span></div>';

    if (last) {
      var hint = WT.progressionHint({ sets: last.stats.sets, reps: last.stats.reps, topKg: last.stats.topKg, topReps: last.stats.topReps }, 0, S.settings.step);
      html += '<div class="hr"></div><div class="small"><b>Последняя тренировка</b> (' + WT.dayLabel(last.date) + '): ' +
        setsPreview(last.sets, 6) + '</div>';
      if (hint) html += '<div class="small mt ' + (hint.raise ? 'accent-text' : 'muted') + '">💡 ' + esc(hint.text) + '</div>';
    }

    html += '<div class="row mt"><button class="btn sm grow" data-act="startWithExercise" data-id="' + attr(id) + '">Тренировать сейчас</button>' +
      '<button class="btn sm ghost" data-act="plateFor" data-kg="' + WT.num(pr.kg) + '">блины</button></div>';

    html += '<div class="hr"></div><h3>Все подходы по датам</h3>';
    series.slice().reverse().forEach(function (r) {
      html += '<div class="kv"><span class="k">' + WT.dayLabel(r.date) + '</span>' +
        '<span class="v">' + WT.fmtNum(r.topKg) + ' кг × ' + WT.fmtNum(r.topReps) + ' · ' + WT.fmtVolume(r.volume) + '</span></div>';
    });
    return html + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Экран «Ещё»                                                        */
  /* ------------------------------------------------------------------ */

  function renderMore() {
    var st = S.settings;
    var bytes = 0;
    try { bytes = (localStorage.getItem(KEY) || '').length; } catch (e) { bytes = 0; }

    var html = '<div class="card"><h3>Шаблоны тренировок</h3><div class="list" style="border:0">';
    S.routines.forEach(function (r) {
      html += '<button class="list-item" data-act="routineOpen" data-id="' + attr(r.id) + '">' +
        '<div class="ico-lg">📌</div>' +
        '<div class="grow"><div class="t">' + esc(r.name) + '</div>' +
        '<div class="d">' + r.items.length + ' упражнений · ' + esc(r.items.slice(0, 2).map(function (i) { return exName(i.exerciseId); }).join(', ')) + (r.items.length > 2 ? '…' : '') + '</div></div>' +
        '<div class="chev">›</div></button>';
    });
    html += '</div><button class="btn sm wide ghost mt" data-act="routineNew">＋ Новый шаблон</button></div>';

    html += '<div class="card"><h3>Данные</h3><div class="list" style="border:0">' +
      '<button class="list-item" data-act="export"><div class="ico-lg">⬇️</div><div class="grow"><div class="t">Сохранить резервную копию</div><div class="d">файл JSON со всеми тренировками</div></div><div class="chev">›</div></button>' +
      '<button class="list-item" data-act="exportCsv"><div class="ico-lg">📊</div><div class="grow"><div class="t">Таблица для Excel (CSV)</div><div class="d">все подходы построчно</div></div><div class="chev">›</div></button>' +
      '<button class="list-item" data-act="import"><div class="ico-lg">⬆️</div><div class="grow"><div class="t">Загрузить из файла</div><div class="d">объединить с текущими данными</div></div><div class="chev">›</div></button>' +
      '<button class="list-item" data-act="shareState"><div class="ico-lg">📤</div><div class="grow"><div class="t">Поделиться копией</div><div class="d">отправить файл в мессенджер или на почту</div></div><div class="chev">›</div></button>' +
      '<button class="list-item" data-act="wipe"><div class="ico-lg">🗑</div><div class="grow"><div class="t danger-text">Удалить все данные</div><div class="d">действие необратимо</div></div><div class="chev">›</div></button>' +
      '</div><div class="tiny muted mt">Занято в памяти телефона: ' + Math.max(1, Math.round(bytes / 1024)) + ' КБ</div></div>';

    html += '<div class="card"><h3>Настройки</h3>' +
      '<label class="lbl">Отдых между подходами</label>' +
      '<div class="seg">' + [60, 90, 120, 180].map(function (v) {
        return '<button class="' + (st.restSec === v ? 'on' : '') + '" data-act="setRest" data-v="' + v + '">' + (v < 120 ? v + ' с' : (v / 60) + ' мин') + '</button>';
      }).join('') + '</div>' +
      '<label class="lbl">Шаг веса для подсказок</label>' +
      '<div class="seg">' + [1.25, 2.5, 5].map(function (v) {
        return '<button class="' + (WT.num(st.step) === v ? 'on' : '') + '" data-act="setStep" data-v="' + v + '">' + WT.fmtNum(v) + ' кг</button>';
      }).join('') + '</div>' +
      '<label class="lbl">Вес штанги (грифа)</label>' +
      '<div class="seg">' + [15, 20, 25].map(function (v) {
        return '<button class="' + (WT.num(st.barKg) === v ? 'on' : '') + '" data-act="setBar" data-v="' + v + '">' + v + ' кг</button>';
      }).join('') + '</div>' +
      '<div class="hr"></div>' +
      switchRow('Автозапуск таймера отдыха', 'autoRest', st.autoRest) +
      switchRow('Звук в конце отдыха', 'sound', st.sound) +
      switchRow('Вибрация', 'vibrate', st.vibrate) +
      '</div>';

    html += '<div class="card"><h3>Как поставить на iPhone</h3><div class="small muted">' +
      '1. Открой приложение в Safari.<br>' +
      '2. Кнопка «Поделиться» → «На экран „Домой“».<br>' +
      '3. Запусти с иконки — адресной строки не будет, всё работает без интернета.<br>' +
      'Данные хранятся только на телефоне. Резервная копия — выше в разделе «Данные».' +
      '</div><div class="hr"></div>' +
      '<div class="tiny muted">Zal · дневник тренировок · версия 1.0 · ' +
      (window.navigator.standalone ? 'запущено как приложение' : 'открыто в браузере') + '</div></div>';
    return html;
  }

  function switchRow(label, key, on) {
    return '<button class="list-item" data-act="toggle" data-key="' + attr(key) + '" style="border:0;padding-left:0;padding-right:0">' +
      '<div class="grow"><div class="t">' + esc(label) + '</div></div>' +
      '<div class="switch' + (on ? ' on' : '') + '"><i></i></div></button>';
  }

  /* ================================================================== */
  /* Графики (canvas, без библиотек)                                    */
  /* ================================================================== */

  function drawChart(canvas, conf) {
    var w = canvas.clientWidth || canvas.parentNode.clientWidth || 320;
    var h = canvas.clientHeight || 170;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var padL = 40, padR = 12, padT = 14, padB = 24;
    var pts = conf.series || [];
    var pts2 = conf.series2 || [];
    if (!pts.length) return;

    var ys = pts.map(function (p) { return p.y; }).concat(pts2.map(function (p) { return p.y; }));
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);
    if (maxY - minY < 1e-6) { maxY += 1; minY -= 1; }

    // «Круглый» шаг сетки, чтобы подписи были вида 60 / 80 / 100, а не 60,8 / 83,9
    var rawStep = (maxY - minY) / 3;
    var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
    var norm = rawStep / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    minY = Math.floor(minY / step) * step;
    maxY = Math.ceil(maxY / step) * step;
    if (maxY - minY < 1e-6) maxY = minY + step;

    var minX = pts[0].x, maxX = pts[pts.length - 1].x;
    if (maxX - minX < 1) maxX = minX + 1;

    function X(x) { return padL + (w - padL - padR) * ((x - minX) / (maxX - minX)); }
    function Y(y) { return padT + (h - padT - padB) * (1 - (y - minY) / (maxY - minY)); }

    // сетка
    ctx.strokeStyle = COL.line;
    ctx.fillStyle = COL.muted;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.lineWidth = 1;
    var steps = Math.max(1, Math.round((maxY - minY) / step));
    for (var i = 0; i <= steps; i++) {
      var val = minY + (maxY - minY) * (i / steps);
      var yy = Math.round(Y(val)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(WT.fmtNum(Math.round(val * 10) / 10), padL - 6, yy + 3.5);
    }

    function line(data, color, fill) {
      if (!data.length) return;
      ctx.beginPath();
      data.forEach(function (p, idx) {
        var x = X(p.x), y = Y(p.y);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (fill) {
        ctx.lineTo(X(data[data.length - 1].x), h - padB);
        ctx.lineTo(X(data[0].x), h - padB);
        ctx.closePath();
        var grad = ctx.createLinearGradient(0, padT, 0, h - padB);
        grad.addColorStop(0, color + '44');
        grad.addColorStop(1, color + '00');
        ctx.fillStyle = grad;
        ctx.fill();
      }
      data.forEach(function (p, idx) {
        if (data.length > 14 && idx !== data.length - 1) return;
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), idx === data.length - 1 ? 4 : 2.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }

    line(pts, conf.color || COL.accent, true);
    line(pts2, conf.color2 || COL.accent2, false);

    // подпись последнего значения
    var lastP = pts[pts.length - 1];
    ctx.fillStyle = COL.muted;
    ctx.textAlign = 'left';
    ctx.fillText(WT.fmtDate(lastP.x), padL, h - 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = conf.color || COL.accent;
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillText(WT.fmtNum(lastP.y) + ' ' + (conf.unit || ''), w - padR, h - 7);
  }

  window.addEventListener('resize', function () { drawPendingCharts(); });
  window.addEventListener('orientationchange', function () { setTimeout(drawPendingCharts, 300); });

  /* ================================================================== */
  /* Шторка                                                             */
  /* ================================================================== */

  var sheetName = null;

  function openSheet(name, title, bodyHtml) {
    sheetName = name;
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = bodyHtml;
    $('#sheet').hidden = false;
    $('#sheet .body').scrollTop = 0;
  }
  function closeSheet() {
    sheetName = null;
    ui.histId = null;
    ui.replaceEi = null;
    $('#sheet').hidden = true;
    $('#sheet-body').innerHTML = '';
  }
  function renderSheet() {
    if (sheetName === 'picker') openSheet('picker', 'Выберите упражнение', pickerHtml());
    else if (sheetName === 'prog-picker') openSheet('prog-picker', 'Прогресс упражнения', pickerHtml());
  }

  /* --- выбор упражнения --------------------------------------------- */

  function recentExerciseIds(limit) {
    var out = [], seen = {};
    for (var i = 0; i < S.workouts.length && out.length < (limit || 8); i++) {
      (S.workouts[i].entries || []).forEach(function (e) {
        if (out.length < (limit || 8) && !seen[e.exerciseId]) { seen[e.exerciseId] = 1; out.push(e.exerciseId); }
      });
    }
    return out;
  }

  /** Список в шторке выбора: обновляется отдельно от поля поиска,
   *  чтобы на iPhone не закрывалась клавиатура при вводе. */
  function pickerHtml() {
    return '<input class="input" id="picker-search" placeholder="Поиск упражнения…" value="' + attr(ui.pickerQuery) + '">' +
      '<div id="picker-list">' + pickerListHtml() + '</div>' +
      '<div class="hr"></div><div class="lbl">Своё упражнение</div>' +
      '<input class="input" id="new-ex-name" placeholder="Название, например «Тяга Т-грифа»">' +
      '<div class="row mt"><select class="input grow" id="new-ex-group">' +
      WT.GROUPS.map(function (g) { return '<option>' + g + '</option>'; }).join('') + '</select>' +
      '<select class="input grow" id="new-ex-kind">' +
      '<option value="barbell">штанга</option><option value="dumbbell">гантели</option>' +
      '<option value="machine">тренажёр</option><option value="bodyweight">свой вес</option>' +
      '<option value="time">на время (сек)</option></select></div>' +
      '<button class="btn primary wide mt" data-act="createExercise">Добавить упражнение</button>';
  }

  function refreshPickerList() {
    var node = $('#picker-list');
    if (node) node.innerHTML = pickerListHtml();
  }

  function pickerListHtml() {
    var groups = ['Все'].concat(WT.GROUPS);
    var q = ui.pickerQuery.trim().toLowerCase();
    var recent = recentExerciseIds(8);
    var html = '<div class="tag-row mt">' + groups.map(function (g) {
        var n = g === 'Все' ? S.exercises.length : S.exercises.filter(function (e) { return (e.group || '') === g; }).length;
        if (!n) return '';
        return '<button class="pill-btn' + (ui.pickerGroup === g ? ' on' : '') + '" data-act="pickerGroup" data-g="' + attr(g) + '">' + esc(g) + '</button>';
      }).join('') + '</div>';

    if (recent.length && !q && ui.pickerGroup === 'Все') {
      html += '<div class="lbl">Недавние</div><div class="row wrap">' + recent.map(function (id) {
        return '<button class="pill-btn" data-act="pickOne" data-id="' + attr(id) + '">' + esc(exName(id)) + '</button>';
      }).join('') + '</div>';
    }

    var list = S.exercises.filter(function (e) {
      if (ui.pickerGroup !== 'Все' && (e.group || '') !== ui.pickerGroup) return false;
      if (q && e.name.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    html += '<div class="lbl">Все упражнения (' + list.length + ')</div>';
    if (!list.length) html += '<div class="small muted">Ничего не нашлось. Добавь своё упражнение ниже.</div>';
    else {
      html += '<div class="list" style="border:0">' + list.map(function (e) {
        return '<button class="list-item" data-act="pickOne" data-id="' + attr(e.id) + '">' +
          '<div class="grow"><div class="t">' + esc(e.name) + '</div><div class="d">' + esc(e.group || '') + (e.custom ? ' · своё' : '') + '</div></div>' +
          '<div class="chev">＋</div></button>';
      }).join('') + '</div>';
    }

    return html;
  }

  /* --- меню упражнения в тренировке --------------------------------- */

  function openExMenu(ei) {
    var entry = S.active.entries[ei];
    var id = entry.exerciseId;
    var html = '<div class="list" style="border:0">' +
      row('warmupEx', '🔥 Добавить разминку', 'три подхода 40/60/80 %', 'data-ei="' + ei + '"') +
      row('exUp', '⬆️ Поднять выше', '', 'data-ei="' + ei + '"') +
      row('exDown', '⬇️ Опустить ниже', '', 'data-ei="' + ei + '"') +
      row('exHistory', '📈 История упражнения', esc(exName(id)), 'data-id="' + attr(id) + '"') +
      row('exReplace', '🔄 Заменить упражнение', '', 'data-ei="' + ei + '"') +
      row('exDel', '🗑 Убрать из тренировки', '', 'data-ei="' + ei + '"') +
      '</div>';
    openSheet('ex-menu', esc(exName(id)), html);
  }

  function row(act, title, desc, extra) {
    return '<button class="list-item" data-act="' + act + '" ' + (extra || '') + '>' +
      '<div class="grow"><div class="t">' + title + '</div>' + (desc ? '<div class="d">' + desc + '</div>' : '') + '</div>' +
      '<div class="chev">›</div></button>';
  }

  /* --- меню подхода -------------------------------------------------- */

  function openSetMenu(ei, si) {
    var s = S.active.entries[ei].sets[si];
    var html = '<div class="list" style="border:0">' +
      row('setWarmup', s.warmup ? '➖ Снять отметку разминки' : '🔥 Сделать разминочным', '', 'data-ei="' + ei + '" data-si="' + si + '"') +
      row('setDup', '⧉ Дублировать подход', '', 'data-ei="' + ei + '" data-si="' + si + '"') +
      row('setClear', '✕ Очистить вес и повторы', '', 'data-ei="' + ei + '" data-si="' + si + '"') +
      row('setDel', '🗑 Удалить подход', '', 'data-ei="' + ei + '" data-si="' + si + '"') +
      '</div>';
    openSheet('set-menu', 'Подход ' + (si + 1), html);
  }

  /* --- блинный калькулятор ------------------------------------------- */

  function plateHtml(kg) {
    var target = WT.num(kg, 0) || WT.num(S.settings.barKg) + 20;
    return '<label class="lbl">Нужный вес, кг</label>' +
      '<input class="input" id="plate-kg" inputmode="decimal" value="' + WT.fmtNum(target) + '">' +
      '<div id="plate-out">' + plateOutHtml(target) + '</div>' +
      '<div class="small muted">Набор блинов: ' + S.settings.plates.map(WT.fmtNum).join(', ') + ' кг (по паре каждого).</div>';
  }

  function plateOutHtml(kg) {
    var p = WT.plateBreakdown(WT.num(kg, 0), S.settings.barKg, S.settings.plates);
    return '<div class="card mt">' +
      '<div class="kv"><span class="k">Гриф</span><span class="v">' + WT.fmtNum(S.settings.barKg) + ' кг</span></div>' +
      '<div class="kv"><span class="k">На каждую сторону</span><span class="v">' + (p.perSide.length ? p.text : 'пусто') + '</span></div>' +
      '<div class="kv"><span class="k">Итого получится</span><span class="v">' + WT.fmtNum(p.achieved) + ' кг</span></div>' +
      (p.exact ? '' : '<div class="kv"><span class="k warn-text">Недобор</span><span class="v warn-text">' + WT.fmtNum(p.remainder) + ' кг</span></div>') +
      '</div>';
  }

  /* --- детали тренировки из истории --------------------------------- */

  function openWorkoutDetail(id) {
    var w = null;
    S.workouts.forEach(function (x) { if (x.id === id) w = x; });
    if (!w) return;
    ui.histId = id;
    var st = WT.workoutStats(w);
    var prs = prMap();
    var html = '<div class="stat-grid three">' +
      stat(WT.fmtVolume(st.volume), 'объём', 'slim') +
      stat(st.sets, 'подходов', 'slim') +
      stat(st.durationSec ? WT.fmtDuration(st.durationSec) : '—', 'время', 'slim') +
      '</div><div class="card">';

    (w.entries || []).forEach(function (e) {
      var es = WT.entryStats(e);
      if (!es.sets && !es.warmups) return;
      var pr = prs[e.exerciseId];
      html += '<div class="spread" style="margin-top:6px"><div class="grow" style="font-weight:650">' + esc(exName(e.exerciseId)) +
        (pr && pr.workoutId === w.id ? ' <span class="badge-pr">🏆 рекорд</span>' : '') + '</div>' +
        '<div class="tiny muted">' + es.sets + ' подх.</div></div>';
      (e.sets || []).forEach(function (s, i) {
        if (!WT.num(s.reps) && !WT.num(s.kg)) return;
        html += '<div class="kv"><span class="k">' + (s.warmup ? 'разминка' : 'подход ' + (i + 1)) + '</span>' +
          '<span class="v">' + WT.fmtNum(s.kg) + ' кг × ' + WT.fmtNum(s.reps) + '</span></div>';
      });
    });
    html += '</div>';

    html += '<label class="lbl">Заметка к тренировке</label>' +
      '<textarea class="input" id="hist-note" placeholder="Как самочувствие, что улучшить…">' + esc(w.note || '') + '</textarea>' +
      '<button class="btn wide mt" data-act="saveNote" data-id="' + attr(w.id) + '">Сохранить заметку</button>';

    html += '<div class="row mt"><button class="btn primary grow" data-act="repeatWorkout" data-id="' + attr(w.id) + '">Повторить</button>' +
      '<button class="btn grow" data-act="shareWorkout" data-id="' + attr(w.id) + '">Поделиться</button></div>' +
      '<button class="btn wide danger mt" data-act="deleteWorkout" data-id="' + attr(w.id) + '">Удалить тренировку</button>';

    openSheet('workout', WT.dayLabel(w.startedAt) + ' · ' + WT.fmtDateFull(w.startedAt).split(', ')[1], html);
  }

  /* --- итог завершённой тренировки ---------------------------------- */

  function openFinishSummary(w) {
    var st = WT.workoutStats(w);
    var prsBefore = WT.computePRs(S.workouts.filter(function (x) { return x.id !== w.id; }));
    var prsAfter = WT.computePRs(S.workouts);
    var records = [];
    (w.entries || []).forEach(function (e) {
      var b = prsBefore[e.exerciseId], a = prsAfter[e.exerciseId];
      if (!a) return;
      if (!b || a.est1RM > b.est1RM + 0.001) {
        records.push({ name: exName(e.exerciseId), kg: a.kg, reps: a.reps, rm: a.est1RM, isFirst: !b });
      }
    });
    var html = '<div class="stat-grid">' +
      stat(WT.fmtVolume(st.volume), 'поднято за тренировку') +
      stat(st.sets, 'рабочих подходов') +
      stat(st.reps, 'повторений') +
      stat(st.durationSec ? WT.fmtDuration(st.durationSec) : '—', 'длительность') +
      '</div>';
    if (records.length) {
      html += '<div class="card accent"><h3>🏆 Новые рекорды</h3>' +
        records.map(function (r) {
          return '<div class="kv"><span class="k">' + esc(r.name) + '</span><span class="v">' +
            WT.fmtNum(r.kg) + ' кг × ' + WT.fmtNum(r.reps) +
            (r.isFirst ? ' <span class="chip">первый раз</span>' : ' <span class="accent-text">≈1ПМ ' + WT.fmtNum(r.rm) + '</span>') +
            '</span></div>';
        }).join('') + '</div>';
    } else {
      html += '<div class="card"><div class="small muted">Рекордов сегодня нет — но объём растёт, это тоже прогресс.</div></div>';
    }
    html += '<div class="row"><button class="btn primary grow" data-act="shareWorkout" data-id="' + attr(w.id) + '">Поделиться итогом</button>' +
      '<button class="btn grow" data-act="sheetClose">Готово</button></div>';
    openSheet('finish', 'Тренировка сохранена 💪', html);
  }

  /* --- редактор шаблона ---------------------------------------------- */

  function openRoutineSheet(id) {
    var r = null;
    S.routines.forEach(function (x) { if (x.id === id) r = x; });
    if (!r) return;
    ui.routineId = id;
    var html = '<label class="lbl">Название</label>' +
      '<input class="input" id="routine-name" value="' + attr(r.name) + '">' +
      '<div class="lbl">Упражнения</div><div class="list" style="border:0">';
    if (!r.items.length) html += '<div class="small muted">Пока пусто — добавь упражнения.</div>';
    r.items.forEach(function (it, idx) {
      html += '<div class="list-item" style="align-items:flex-start;flex-direction:column;gap:8px">' +
        '<div class="spread" style="width:100%"><div class="grow t">' + esc(exName(it.exerciseId)) + '</div>' +
        '<button class="btn icon ghost" data-act="routineDelItem" data-idx="' + idx + '">🗑</button></div>' +
        '<div class="row" style="width:100%">' +
        '<div class="field grow"><input inputmode="numeric" value="' + attr(it.sets) + '" data-ri="' + idx + '" data-rf="sets"><span class="unit">подх.</span></div>' +
        '<div class="field grow"><input inputmode="numeric" value="' + attr(it.reps) + '" data-ri="' + idx + '" data-rf="reps"><span class="unit">повт.</span></div>' +
        '</div></div>';
    });
    html += '</div>' +
      '<button class="btn wide ghost mt" data-act="routineAddEx">＋ Добавить упражнение</button>' +
      '<div class="row mt"><button class="btn primary grow" data-act="routineStart" data-id="' + attr(id) + '">Начать по шаблону</button>' +
      '<button class="btn ghost" data-act="routineDelete" data-id="' + attr(id) + '">Удалить</button></div>';
    openSheet('routine', 'Шаблон тренировки', html);
  }

  /* ================================================================== */
  /* Действия                                                           */
  /* ================================================================== */

  function activeEntry(ei) {
    if (!S.active) return null;
    return S.active.entries[WT.num(ei)] || null;
  }

  function startWorkoutFromRoutine(routineId) {
    var r = null;
    S.routines.forEach(function (x) { if (x.id === routineId) r = x; });
    var w = WT.emptyWorkout(routineId, r ? r.name : null);
    if (r) {
      r.items.forEach(function (it) {
        var entry = WT.addEntry(w, it.exerciseId);
        entry.sets = WT.setsFromLast(S, it.exerciseId, it.sets, it.reps, new Date().toISOString());
      });
    }
    S.active = w;
    save();
    view = 'train';
    render();
    toast(r ? 'Шаблон «' + r.name + '» загружен' : 'Тренировка начата');
  }

  function startWorkoutWithExercises(ids) {
    var w = WT.emptyWorkout();
    ids.forEach(function (id) {
      var entry = WT.addEntry(w, id);
      entry.sets = WT.setsFromLast(S, id, 3, 0, new Date().toISOString());
    });
    S.active = w;
    save();
    view = 'train';
    render();
  }

  /** Проверка рекорда в момент отметки подхода. */
  function checkRecord(entry, set) {
    var before = WT.computePRs(S.workouts)[entry.exerciseId];
    var rm = WT.epley1RM(set.kg, set.reps);
    if (rm <= 0) return false;
    if (before && before.est1RM >= rm - 0.001) return false;
    // исключаем другие подходы этой же тренировки, уже побившие рекорд
    var best = 0;
    S.active.entries.forEach(function (e) {
      if (e.exerciseId !== entry.exerciseId) return;
      (e.sets || []).forEach(function (s) {
        if (s === set || !s.done) return;
        best = Math.max(best, WT.epley1RM(s.kg, s.reps));
      });
    });
    if (best >= rm - 0.001) return false;
    toast('🏆 Новый рекорд: ' + WT.fmtNum(set.kg) + ' кг × ' + WT.fmtNum(set.reps) + ' (≈1ПМ ' + WT.fmtNum(rm) + ')', 'pr');
    buzz([40, 60, 40]);
    return true;
  }

  function handleAction(act, el) {
    var ei = WT.num(el.getAttribute('data-ei'), 0);
    var si = WT.num(el.getAttribute('data-si'), 0);
    var id = el.getAttribute('data-id');

    switch (act) {
      /* --- навигация --- */
      case 'tab':
        view = el.getAttribute('data-tab');
        closeSheet();
        render();
        window.scrollTo(0, 0);
        return;

      case 'sheetClose':
        closeSheet();
        return;

      case 'barAction':
        if (view === 'train') openSheet('picker', 'Выберите упражнение', pickerHtml());
        else if (view === 'progress') openSheet('prog-picker', 'Прогресс упражнения', pickerHtml());
        return;

      /* --- старт тренировки --- */
      case 'startEmpty':
        S.active = WT.emptyWorkout();
        save();
        render();
        toast('Поехали! 💪');
        return;

      case 'startRoutine':
        startWorkoutFromRoutine(id);
        return;

      case 'startWithExercise':
        startWorkoutWithExercises([id]);
        toast('Упражнение добавлено');
        return;

      case 'pickExercise':
        openSheet('picker', 'Выберите упражнение', pickerHtml());
        return;

      case 'pickerGroup':
        ui.pickerGroup = el.getAttribute('data-g');
        refreshPickerList();
        return;

      case 'pickOne':
        if (sheetName === 'prog-picker') {
          ui.progId = id;
          closeSheet();
          view = 'progress';
          render();
          return;
        }
        if (ui.replaceEi !== null && ui.replaceEi !== undefined && S.active && S.active.entries[ui.replaceEi]) {
          var rEntry = S.active.entries[ui.replaceEi];
          rEntry.exerciseId = id;
          rEntry.sets = WT.setsFromLast(S, id, rEntry.sets.length || 3, 0, S.active.startedAt);
          save();
          var rei = ui.replaceEi;
          ui.replaceEi = null;
          closeSheet();
          render();
          var rcard = $('[data-card="' + rei + '"]');
          if (rcard) rcard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast('Упражнение заменено');
          return;
        }
        if (!S.active) S.active = WT.emptyWorkout();
        var entry = WT.addEntry(S.active, id);
        entry.sets = WT.setsFromLast(S, id, 3, 0, new Date().toISOString());
        save();
        closeSheet();
        view = 'train';
        render();
        var card = $('[data-card="' + (S.active.entries.length - 1) + '"]');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;

      case 'createExercise':
        var nameEl = $('#new-ex-name');
        var nm = nameEl ? nameEl.value : '';
        if (!nm.trim()) { toast('Впиши название'); return; }
        var created = WT.addExercise(S, nm, $('#new-ex-group').value, $('#new-ex-kind').value);
        save();
        // сразу добавляем в тренировку (или в шаблон)
        if (sheetName === 'routine') {
          var rr = null;
          S.routines.forEach(function (x) { if (x.id === ui.routineId) rr = x; });
          if (rr) rr.items.push({ exerciseId: created.id, sets: 3, reps: '10' });
          save();
          openRoutineSheet(ui.routineId);
        } else {
          if (!S.active) { startWorkoutWithExercises([created.id]); closeSheet(); toast('Упражнение создано'); return; }
          var e2 = WT.addEntry(S.active, created.id);
          e2.sets = WT.setsFromLast(S, created.id, 3, 0, new Date().toISOString());
          save();
          closeSheet();
          render();
        }
        toast('Упражнение добавлено');
        return;

      /* --- подходы --- */
      case 'addSet':
        var en = activeEntry(ei);
        if (!en) return;
        var prev = en.sets[en.sets.length - 1];
        en.sets.push(prev ? WT.cloneSet(prev) : WT.newSet(0, 0, false));
        saveSoon();
        refreshExCard(ei);
        return;

      case 'toggleSet':
        var en2 = activeEntry(ei);
        if (!en2) return;
        var set = en2.sets[si];
        if (!set) return;
        set.done = !set.done;
        set.ts = set.done ? new Date().toISOString() : null;
        if (set.done) {
          buzz(35);
          var isRecord = checkRecord(en2, set);
          if (S.settings.autoRest) startRest(S.settings.restSec);
          if (isRecord) { /* сообщение уже показано */ }
        }
        saveSoon();
        updateWorkoutTotals();
        return;

      case 'setMenu':
        openSetMenu(ei, si);
        return;

      case 'setWarmup':
        var en3 = activeEntry(ei);
        if (en3 && en3.sets[si]) {
          en3.sets[si].warmup = !en3.sets[si].warmup;
          saveSoon();
          closeSheet();
          refreshExCard(ei);
        }
        return;

      case 'setDup':
        var en4 = activeEntry(ei);
        if (en4 && en4.sets[si]) {
          en4.sets.splice(si + 1, 0, WT.cloneSet(en4.sets[si]));
          saveSoon();
          closeSheet();
          refreshExCard(ei);
        }
        return;

      case 'setClear':
        var en5 = activeEntry(ei);
        if (en5 && en5.sets[si]) {
          en5.sets[si].kg = 0;
          en5.sets[si].reps = 0;
          en5.sets[si].done = false;
          saveSoon();
          closeSheet();
          refreshExCard(ei);
        }
        return;

      case 'setDel':
        var en6 = activeEntry(ei);
        if (en6 && en6.sets[si]) {
          en6.sets.splice(si, 1);
          saveSoon();
          closeSheet();
          refreshExCard(ei);
          updateWorkoutTotals();
        }
        return;

      /* --- упражнение в тренировке --- */
      case 'exMenu':
        openExMenu(ei);
        return;

      case 'warmupEx':
      case 'warmup':
        var en7 = activeEntry(ei);
        if (!en7) return;
        var work = 0;
        en7.sets.forEach(function (s) { if (!s.warmup && WT.num(s.kg) > work) work = WT.num(s.kg); });
        if (!work) {
          var lastP = WT.lastPerformance(S.workouts, en7.exerciseId, S.active.startedAt);
          if (lastP) work = lastP.stats.topKg;
        }
        if (!work) { toast('Сначала впиши рабочий вес'); closeSheet(); return; }
        var warm = WT.warmupSets(work, S.settings.step);
        en7.sets = warm.concat(en7.sets);
        saveSoon();
        closeSheet();
        refreshExCard(ei);
        toast('Добавлена разминка: ' + warm.map(function (s) { return WT.fmtNum(s.kg); }).join(' / ') + ' кг');
        return;

      case 'exUp':
        if (ei > 0) {
          var arr = S.active.entries;
          var tmp = arr[ei - 1]; arr[ei - 1] = arr[ei]; arr[ei] = tmp;
          saveSoon(); closeSheet(); render();
        } else closeSheet();
        return;

      case 'exDown':
        if (ei < S.active.entries.length - 1) {
          var arr2 = S.active.entries;
          var tmp2 = arr2[ei + 1]; arr2[ei + 1] = arr2[ei]; arr2[ei] = tmp2;
          saveSoon(); closeSheet(); render();
        } else closeSheet();
        return;

      case 'exDel':
        S.active.entries.splice(ei, 1);
        saveSoon(); closeSheet(); render();
        return;

      case 'exReplace':
        ui.replaceEi = ei;
        openSheet('picker', 'Чем заменить?', pickerHtml());
        return;

      case 'exHistory':
        ui.progId = id;
        closeSheet();
        view = 'progress';
        render();
        return;

      /* --- блины --- */
      case 'plate':
        var enP = activeEntry(ei);
        var kgP = 0;
        if (enP) enP.sets.forEach(function (s) { if (WT.num(s.kg) > kgP) kgP = WT.num(s.kg); });
        openSheet('plates', 'Блины на штангу', plateHtml(kgP));
        return;

      case 'plateFor':
        openSheet('plates', 'Блины на штангу', plateHtml(el.getAttribute('data-kg')));
        return;

      /* --- таймер отдыха --- */
      case 'restAdd':
        if (rest.until) {
          rest.until += WT.num(el.getAttribute('data-sec'), 0) * 1000;
          rest.total = Math.max(rest.total, Math.round((rest.until - Date.now()) / 1000));
          tickRest();
        } else {
          startRest(S.settings.restSec);
        }
        return;

      case 'restSkip':
        stopRest();
        return;

      /* --- завершение --- */
      case 'finish':
        var empty = S.active.entries.every(function (e) {
          return !(e.sets || []).some(function (s) { return WT.num(s.reps) > 0 || WT.num(s.kg) > 0; });
        });
        if (empty) {
          if (confirmAsk('В тренировке нет ни одного подхода. Удалить её?')) {
            S.active = null;
            save();
            render();
          }
          return;
        }
        var done = WT.finishWorkout(S);
        save();
        stopRest();
        render();
        openFinishSummary(done);
        return;

      case 'cancelWorkout':
        if (confirmAsk('Отменить текущую тренировку? Записи не сохранятся.')) {
          S.active = null;
          save();
          stopRest();
          render();
        }
        return;

      /* --- история --- */
      case 'histOpen':
        openWorkoutDetail(id);
        return;

      case 'saveNote':
        var noteEl = $('#hist-note');
        S.workouts.forEach(function (w) { if (w.id === id) w.note = noteEl ? noteEl.value : ''; });
        save();
        toast('Заметка сохранена');
        return;

      case 'repeatWorkout':
        var src = null;
        S.workouts.forEach(function (w) { if (w.id === id) src = w; });
        if (!src) return;
        if (S.active && !confirmAsk('Текущая тренировка будет заменена. Продолжить?')) return;
        var nw = WT.emptyWorkout(null, src.name);
        (src.entries || []).forEach(function (e) {
          var ne = WT.addEntry(nw, e.exerciseId);
          ne.sets = (e.sets || []).filter(function (s) { return !s.warmup; }).map(function (s) { return WT.newSet(s.kg, s.reps, false); });
        });
        S.active = nw;
        save();
        closeSheet();
        view = 'train';
        render();
        toast('Тренировка скопирована — вперёд!');
        return;

      case 'deleteWorkout':
        if (confirmAsk('Удалить эту тренировку?')) {
          WT.removeWorkout(S, id);
          save();
          closeSheet();
          render();
        }
        return;

      case 'shareWorkout':
        var w2 = null;
        S.workouts.forEach(function (x) { if (x.id === id) w2 = x; });
        if (!w2 && S.active) w2 = S.active;
        if (!w2) return;
        shareText(WT.workoutToText(S, w2));
        return;

      /* --- прогресс --- */
      case 'progOpen':
        ui.progId = id;
        closeSheet();
        view = 'progress';
        render();
        window.scrollTo({ top: 320, behavior: 'smooth' });
        return;

      case 'progClose':
        ui.progId = null;
        render();
        return;

      case 'bwAdd':
        var series = WT.bodyWeightSeries(S);
        var lastKg = series.length ? series[series.length - 1].kg : '';
        openSheet('bw', 'Вес тела', '<label class="lbl">Сегодняшний вес, кг</label>' +
          '<input class="input" id="bw-kg" inputmode="decimal" value="' + (lastKg ? WT.fmtNum(lastKg) : '') + '" placeholder="80">' +
          (series.length ? '<div class="small muted mt">Прошлое значение: ' + WT.fmtNum(lastKg) + ' кг (' + WT.fmtDate(series[series.length - 1].date) + ')</div>' : '') +
          '<button class="btn primary wide mt" data-act="bwSave">Записать</button>');
        return;

      case 'bwSave':
        var v = WT.num($('#bw-kg').value);
        if (v <= 0) { toast('Впиши вес числом'); return; }
        WT.setBodyWeight(S, v);
        save();
        closeSheet();
        render();
        toast('Вес записан: ' + WT.fmtNum(v) + ' кг');
        return;

      /* --- шаблоны --- */
      case 'routineOpen':
        openRoutineSheet(id);
        return;

      case 'routineNew':
        var nr = { id: WT.uid('rt'), name: 'Новый шаблон', items: [] };
        S.routines.push(nr);
        save();
        openRoutineSheet(nr.id);
        return;

      case 'routineAddEx':
        openSheet('picker', 'Добавить в шаблон', pickerHtml());
        return;

      case 'routineDelItem':
        var rDel = null;
        S.routines.forEach(function (x) { if (x.id === ui.routineId) rDel = x; });
        if (rDel) {
          rDel.items.splice(WT.num(el.getAttribute('data-idx')), 1);
          save();
          openRoutineSheet(rDel.id);
        }
        return;

      case 'routineStart':
        closeSheet();
        startWorkoutFromRoutine(id);
        return;

      case 'routineDelete':
        if (confirmAsk('Удалить шаблон?')) {
          S.routines = S.routines.filter(function (x) { return x.id !== id; });
          save();
          closeSheet();
          render();
        }
        return;

      /* --- данные --- */
      case 'export':
        download('zal-backup-' + WT.dateKey(new Date()) + '.json', WT.serialize(WT.exportPayload(S)), 'application/json');
        toast('Файл сохранён');
        return;

      case 'exportCsv':
        download('zal-trenirovki-' + WT.dateKey(new Date()) + '.csv', '\ufeff' + WT.workoutsToCsv(S), 'text/csv');
        toast('Таблица сохранена');
        return;

      case 'import':
        $('#import-file').click();
        return;

      case 'importMerge':
      case 'importReplace':
        if (!sheetIncoming) return;
        S = WT.mergeStates(S, sheetIncoming, act === 'importMerge' ? 'merge' : 'replace');
        sheetIncoming = null;
        save();
        closeSheet();
        render();
        toast('Данные загружены: тренировок ' + S.workouts.length);
        return;

      case 'shareState':
        shareFile(WT.serialize(WT.exportPayload(S)));
        return;

      case 'wipe':
        if (confirmAsk('Удалить ВСЕ тренировки, шаблоны и настройки? Это необратимо.')) {
          S = WT.defaultState();
          save();
          ui.progId = null;
          render();
          toast('Все данные удалены');
        }
        return;

      /* --- настройки --- */
      case 'setRest':
        S.settings.restSec = WT.num(el.getAttribute('data-v'), 90);
        save();
        render();
        return;

      case 'setStep':
        S.settings.step = WT.num(el.getAttribute('data-v'), 2.5);
        save();
        render();
        return;

      case 'setBar':
        S.settings.barKg = WT.num(el.getAttribute('data-v'), 20);
        save();
        render();
        return;

      case 'toggle':
        var key = el.getAttribute('data-key');
        S.settings[key] = !S.settings[key];
        save();
        render();
        return;

      default:
        return;
    }
  }

  /* ================================================================== */
  /* Файлы и «поделиться»                                               */
  /* ================================================================== */

  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
    } catch (e) {
      toast('Не удалось сохранить файл');
    }
  }

  function shareText(text) {
    if (navigator.share) {
      navigator.share({ title: 'Тренировка', text: text }).catch(function () {});
      return;
    }
    copyText(text);
  }

  function shareFile(text) {
    var name = 'zal-backup-' + WT.dateKey(new Date()) + '.json';
    try {
      var file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Резервная копия Zal' }).catch(function () {});
        return;
      }
    } catch (e) { /* пойдём другим путём */ }
    download(name, text, 'application/json');
    toast('Файл сохранён в «Файлы»');
  }

  function copyText(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Скопировано в буфер');
    } catch (e) { toast('Не получилось поделиться'); }
  }

  /* ================================================================== */
  /* Подписки                                                           */
  /* ================================================================== */

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    handleAction(el.getAttribute('data-act'), el);
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t || !t.dataset) return;

    // поля подходов (вес/повторы)
    if (t.dataset.set) {
      var entry = activeEntry(t.dataset.ei);
      if (!entry) return;
      var set = entry.sets[WT.num(t.dataset.si)];
      if (!set) return;
      set[t.dataset.set] = WT.num(t.value);
      saveSoon();
      updateWorkoutTotals();
      return;
    }

    // поиск в списке упражнений — обновляем только список, поле поиска не трогаем
    if (t.id === 'picker-search') {
      ui.pickerQuery = t.value;
      refreshPickerList();
      return;
    }

    // название шаблона
    if (t.id === 'routine-name') {
      S.routines.forEach(function (r) { if (r.id === ui.routineId) r.name = t.value.slice(0, 60) || 'Без названия'; });
      saveSoon();
      return;
    }

    // вес/повторы в шаблоне
    if (t.dataset.ri !== undefined && t.dataset.rf) {
      S.routines.forEach(function (r) {
        if (r.id !== ui.routineId) return;
        var it = r.items[WT.num(t.dataset.ri)];
        if (!it) return;
        it[t.dataset.rf] = t.dataset.rf === 'sets' ? (WT.num(t.value, 3) || 3) : t.value;
      });
      saveSoon();
      return;
    }

    // пересчёт блинов на лету — меняем только результат, поле ввода не пересоздаём
    if (t.id === 'plate-kg') {
      var out = $('#plate-out');
      if (out) out.innerHTML = plateOutHtml(t.value);
      return;
    }
  });

  document.addEventListener('focusout', function (ev) {
    var t = ev.target;
    if (!t || !t.dataset || !t.dataset.set) return;
    if (String(t.value).trim() === '') { t.value = ''; return; }
    t.value = WT.fmtNum(WT.num(t.value));
  });

  $('#import-file').addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming = null;
      try { incoming = WT.parseImport(String(reader.result)); }
      catch (e) { toast('Файл не читается — это не копия Zal'); return; }
      openSheet('import', 'Загрузить данные', 
        '<div class="small muted">В файле: тренировок — ' + incoming.workouts.length +
        ', упражнений — ' + incoming.exercises.length + ', записей веса — ' + incoming.body.length + '.</div>' +
        '<div class="list mt" style="border:0">' +
        row('importMerge', '🤝 Объединить с текущими', 'свои тренировки останутся, добавятся новые') +
        row('importReplace', '♻️ Заменить всё данными из файла', 'текущие записи будут удалены') +
        '</div>' +
        '<div class="tiny muted mt">Перед заменой можно сохранить резервную копию в разделе «Данные».</div>');
      sheetIncoming = incoming;
    };
    reader.onerror = function () { toast('Не удалось прочитать файл'); };
    reader.readAsText(file);
  });

  var sheetIncoming = null;

  /* --- горячие клавиши на компьютере (для отладки) --- */
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeSheet();
  });

  /* ================================================================== */
  /* Запуск                                                             */
  /* ================================================================== */

  load();
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн-режим недоступен */ });
    });
  }

  // Обновляем данные при возврате в приложение (например, после смены дня)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render();
  });

  window.ZAL = { state: function () { return S; }, render: render };
})();

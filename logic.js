/* Zal — тренировочный дневник.
 * logic.js — вся «чистая» логика: расчёты, статистика, состояние по умолчанию,
 * импорт/экспорт. Модуль не трогает DOM и работает и в браузере (window.WT),
 * и в Node.js (require) — поэтому его можно покрыть тестами.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE_VERSION = 1;

  /* ------------------------------------------------------------------ */
  /* Утилиты                                                            */
  /* ------------------------------------------------------------------ */

  function uid(prefix) {
    var s = 'xxxxxxxxyxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    return (prefix || 'id') + '_' + s + Date.now().toString(36).slice(-4);
  }

  /** Округление до 2 знаков без «плавающего» мусора (0.1+0.2). */
  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function num(v, def) {
    var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    return isFinite(n) ? n : (def === undefined ? 0 : def);
  }

  /** 62.5 -> "62,5"; 60 -> "60" */
  function fmtNum(n) {
    var v = round2(num(n));
    var s = (Math.round(v * 100) / 100).toString();
    return s.replace('.', ',');
  }

  function fmtKg(n, unit) {
    return fmtNum(n) + ' ' + (unit || 'кг');
  }

  /** Секунды -> «1 ч 05 мин» / «42 мин» / «45 с» */
  function fmtDuration(sec) {
    var s = Math.max(0, Math.round(num(sec)));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ' ч ' + (m < 10 ? '0' + m : m) + ' мин';
    if (m > 0) return m + ' мин';
    return s + ' с';
  }

  /** Секунды -> «1:05» (таймер) */
  function fmtClock(sec) {
    var s = Math.max(0, Math.round(num(sec)));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' + r : r);
  }

  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  function parseDate(d) {
    if (d instanceof Date) return d;
    if (typeof d === 'number') return new Date(d);
    var t = Date.parse(d);
    return isFinite(t) ? new Date(t) : new Date();
  }

  function dateKey(d) {
    var dt = parseDate(d);
    var m = dt.getMonth() + 1;
    var day = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function fmtDate(d) {
    var dt = parseDate(d);
    return dt.getDate() + ' ' + MONTHS[dt.getMonth()];
  }

  function fmtDateFull(d) {
    var dt = parseDate(d);
    return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear() + ', ' +
      WEEKDAYS[dt.getDay()] + ' ' + pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** «Сегодня» / «Вчера» / «12 окт» */
  function dayLabel(d, now) {
    var a = dateKey(d);
    var n = parseDate(now || new Date());
    if (a === dateKey(n)) return 'Сегодня';
    var y = new Date(n.getTime());
    y.setDate(y.getDate() - 1);
    if (a === dateKey(y)) return 'Вчера';
    return fmtDate(d);
  }

  function startOfDay(d) {
    var dt = parseDate(d);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  /* ------------------------------------------------------------------ */
  /* Спортивная математика                                              */
  /* ------------------------------------------------------------------ */

  /** Оценка разового максимума по формуле Эпли (RIR — запас повторений). */
  function epley1RM(kg, reps, rir) {
    var w = num(kg);
    var r = num(reps) + num(rir);
    if (w <= 0 || r <= 0) return 0;
    if (r === 1) return round2(w);
    return round2(w * (1 + r / 30));
  }

  /** Рабочий вес под целевое число повторений, исходя из оценки 1ПМ. */
  function weightForReps(oneRM, reps, step) {
    var r = Math.max(1, num(reps));
    var st = num(step, 2.5) || 2.5;
    if (num(oneRM) <= 0) return 0;
    var w = num(oneRM) / (1 + r / 30);
    return Math.max(0, Math.round(w / st) * st);
  }

  function recalcKg(kg, fromReps, toReps) {
    var rm = epley1RM(kg, fromReps);
    if (!rm) return num(kg);
    return round2(rm / (1 + Math.max(1, num(toReps)) / 30));
  }

  function isWarmup(set) {
    return !!(set && set.warmup);
  }

  function isCounted(set) {
    return !!set && !set.warmup && num(set.reps) > 0;
  }

  /** Объём одного подхода: вес × повторы (свой вес считаем нулевым вкладом). */
  function setVolume(set) {
    if (!isCounted(set)) return 0;
    return round2(num(set.kg) * num(set.reps));
  }

  function entryStats(entry) {
    var st = { sets: 0, warmups: 0, reps: 0, volume: 0, topKg: 0, topReps: 0, best1RM: 0, done: 0 };
    var sets = (entry && entry.sets) || [];
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      if (!s) continue;
      if (isWarmup(s)) st.warmups++;
      if (s.done) st.done++;
      if (!isCounted(s)) continue;
      st.sets++;
      st.reps += num(s.reps);
      st.volume = round2(st.volume + setVolume(s));
      var rm = epley1RM(s.kg, s.reps);
      if (rm > st.best1RM) {
        st.best1RM = rm;
        st.topKg = num(s.kg);
        st.topReps = num(s.reps);
      }
      if (num(s.kg) > st.topKg) st.topKg = num(s.kg);
    }
    return st;
  }

  function workoutStats(w) {
    var st = { sets: 0, reps: 0, volume: 0, exercises: 0, durationSec: 0, best1RM: 0, done: 0, warmups: 0 };
    var entries = (w && w.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var es = entryStats(entries[i]);
      if (es.sets > 0 || es.warmups > 0) st.exercises++;
      st.sets += es.sets;
      st.warmups += es.warmups;
      st.done += es.done;
      st.reps += es.reps;
      st.volume = round2(st.volume + es.volume);
      if (es.best1RM > st.best1RM) st.best1RM = es.best1RM;
    }
    if (w && w.startedAt && w.finishedAt) {
      st.durationSec = Math.max(0, Math.round((parseDate(w.finishedAt) - parseDate(w.startedAt)) / 1000));
    }
    return st;
  }

  /** Тоннаж за тренировку в тоннах, для подписи. */
  function fmtVolume(kg) {
    var v = num(kg);
    if (v >= 10000) return fmtNum(Math.round(v / 100) / 10) + ' т';
    if (v >= 1000) return fmtNum(Math.round(v / 10) / 100) + ' т';
    return fmtNum(Math.round(v)) + ' кг';
  }

  /**
   * Личные рекорды по каждому упражнению.
   * Возвращает { exerciseId: {kg, reps, est1RM, estReps, date, workoutId, volume} }.
   */
  function computePRs(workouts) {
    var prs = {};
    (workouts || []).forEach(function (w) {
      var when = w.finishedAt || w.startedAt;
      ((w && w.entries) || []).forEach(function (e) {
        if (!e || !e.exerciseId) return;
        var p = prs[e.exerciseId] || (prs[e.exerciseId] = {
          kg: 0, reps: 0, est1RM: 0, estReps: 0, date: null, workoutId: null, volume: 0
        });
        ((e.sets) || []).forEach(function (s) {
          if (!isCounted(s)) return;
          var kg = num(s.kg), reps = num(s.reps);
          if (kg > p.kg) { p.kg = kg; p.reps = reps; p.date = when; p.workoutId = w.id; }
          var rm = epley1RM(kg, reps);
          if (rm > p.est1RM) { p.est1RM = rm; p.estReps = reps; p.date = when; p.workoutId = w.id; }
        });
      });
    });
    return prs;
  }

  /** Последняя (не считая текущей) тренировка с этим упражнением — подсказка «в прошлый раз». */
  function lastPerformance(workouts, exerciseId, beforeTs) {
    var list = (workouts || []).filter(function (w) {
      if (!w || !w.entries) return false;
      if (beforeTs && parseDate(w.startedAt).getTime() >= parseDate(beforeTs).getTime()) return false;
      return w.entries.some(function (e) { return e && e.exerciseId === exerciseId && (e.sets || []).some(isCounted); });
    });
    list.sort(function (a, b) { return parseDate(b.startedAt) - parseDate(a.startedAt); });
    if (!list.length) return null;
    var w = list[0];
    var entry = w.entries.filter(function (e) { return e && e.exerciseId === exerciseId; })[0];
    var st = entryStats(entry);
    return { workoutId: w.id, date: w.startedAt, sets: (entry.sets || []).filter(isCounted), stats: st };
  }

  /**
   * Прогресс упражнения по датам: верхний вес, оценка 1ПМ, тоннаж.
   * Возвращает массив по возрастанию даты.
   */
  function progressSeries(workouts, exerciseId, limit) {
    var rows = [];
    (workouts || []).forEach(function (w) {
      ((w && w.entries) || []).forEach(function (e) {
        if (!e || e.exerciseId !== exerciseId) return;
        var st = entryStats(e);
        if (!st.sets) return;
        rows.push({
          date: w.finishedAt || w.startedAt,
          workoutId: w.id,
          topKg: st.topKg,
          topReps: st.topReps,
          best1RM: st.best1RM,
          volume: st.volume,
          sets: st.sets,
          reps: st.reps
        });
      });
    });
    rows.sort(function (a, b) { return parseDate(a.date) - parseDate(b.date); });
    if (limit && rows.length > limit) rows = rows.slice(rows.length - limit);
    return rows;
  }

  /**
   * Подсказка по прогрессии: если во всех рабочих подходах сделаны целевые
   * повторения — прибавить шаг; если провал — оставить вес.
   */
  function progressionHint(prevStats, targetReps, step) {
    var st = num(step, 2.5) || 2.5;
    if (!prevStats || !prevStats.sets) return null;
    var target = num(targetReps, 0);
    if (target <= 0) target = prevStats.topReps || 8;
    var totalReps = num(prevStats.reps, 0) || num(prevStats.totalReps, 0);
    var hit = prevStats.sets > 0 && totalReps >= target * prevStats.sets;
    var kg = hit ? prevStats.topKg + st : prevStats.topKg;
    return {
      kg: round2(kg),
      raise: !!hit,
      text: hit
        ? 'Прошлый раз закрыл ' + prevStats.sets + '×' + target + ' — попробуй ' + fmtKg(prevStats.topKg + st)
        : 'Прошлый раз ' + fmtKg(prevStats.topKg) + ' — закрепи вес'
    };
  }

  /**
   * Сводка: всего тренировок, за 7 дней, за 30 дней, серия недель, тоннаж.
   */
  function activitySummary(workouts, now) {
    var list = (workouts || []).slice().sort(function (a, b) { return parseDate(b.startedAt) - parseDate(a.startedAt); });
    var today = startOfDay(now || new Date());
    var res = {
      total: list.length,
      week: 0, month: 0, totalVolume: 0, totalSets: 0, lastDate: null,
      streakDays: 0, weeks: 0, avgPerWeek: 0, best: null, firstDate: null
    };
    var byWeek = {};
    list.forEach(function (w) {
      var st = workoutStats(w);
      var d = startOfDay(w.startedAt);
      var age = daysBetween(d, today);
      if (age >= 0 && age < 7) res.week++;
      if (age >= 0 && age < 30) res.month++;
      res.totalVolume = round2(res.totalVolume + st.volume);
      res.totalSets += st.sets;
      if (!res.lastDate || d > startOfDay(res.lastDate)) res.lastDate = w.startedAt;
      if (!res.firstDate || d < startOfDay(res.firstDate)) res.firstDate = w.startedAt;
      if (!res.best || st.volume > res.best.volume) res.best = { date: w.startedAt, volume: st.volume };
      // неделя от понедельника
      var monday = new Date(d.getTime());
      var dow = (monday.getDay() + 6) % 7;
      monday.setDate(monday.getDate() - dow);
      var key = dateKey(monday);
      byWeek[key] = true;
    });
    // Сколько недель подряд (включая текущую) есть хотя бы одна тренировка
    var cur = startOfDay(now || new Date());
    var dow = (cur.getDay() + 6) % 7;
    cur.setDate(cur.getDate() - dow);
    while (byWeek[dateKey(cur)]) {
      res.weeks++;
      cur.setDate(cur.getDate() - 7);
    }
    res.streakDays = res.weeks * 7; // совместимость с простым отображением
    var withData = list.filter(function (w) { return workoutStats(w).volume > 0; });
    res.avgPerWeek = res.week;
    if (withData.length) {
      var span = Math.max(1, Math.round(daysBetween(withData[withData.length - 1].startedAt, today) / 7) + 1);
      res.avgPerWeek = Math.round((withData.length / span) * 10) / 10;
    }
    return res;
  }

  /**
   * Блинный калькулятор: сколько блинов на сторону для нужного веса.
   * plates — доступные номиналы (кг), по умолчанию олимпийский набор.
   */
  function plateBreakdown(targetKg, barKg, plates) {
    var target = num(targetKg);
    var bar = num(barKg, 20);
    var avail = (plates && plates.length ? plates : [25, 20, 15, 10, 5, 2.5, 1.25])
      .slice().sort(function (a, b) { return b - a; });
    var perSide = Math.max(0, (target - bar) / 2);
    var left = perSide;
    var out = [];
    for (var i = 0; i < avail.length; i++) {
      var p = num(avail[i]);
      if (p <= 0) continue;
      while (left >= p - 1e-9) { out.push(p); left = round2(left - p); }
    }
    return {
      bar: bar,
      perSide: out,
      achieved: round2(bar + 2 * (perSide - left)),
      remainder: round2(left),
      exact: left < 1e-9,
      text: out.length ? out.map(fmtNum).join(' + ') + ' кг' : 'только гриф'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Справочники: упражнения и шаблоны тренировок                        */
  /* ------------------------------------------------------------------ */

  var GROUPS = ['Грудь', 'Спина', 'Ноги', 'Плечи', 'Бицепс', 'Трицепс', 'Пресс', 'Икры', 'Кардио'];

  // kind: barbell | dumbbell | machine | bodyweight | time
  var SEED_EXERCISES = [
    ['Жим штанги лёжа', 'Грудь', 'barbell'],
    ['Жим гантелей лёжа', 'Грудь', 'dumbbell'],
    ['Жим штанги на наклонной', 'Грудь', 'barbell'],
    ['Разводка гантелей лёжа', 'Грудь', 'dumbbell'],
    ['Отжимания на брусьях', 'Грудь', 'bodyweight'],
    ['Отжимания от пола', 'Грудь', 'bodyweight'],
    ['Кроссовер в блоке', 'Грудь', 'machine'],
    ['Становая тяга', 'Спина', 'barbell'],
    ['Тяга штанги в наклоне', 'Спина', 'barbell'],
    ['Тяга верхнего блока', 'Спина', 'machine'],
    ['Тяга гантели одной рукой', 'Спина', 'dumbbell'],
    ['Подтягивания', 'Спина', 'bodyweight'],
    ['Тяга горизонтального блока', 'Спина', 'machine'],
    ['Гиперэкстензия', 'Спина', 'bodyweight'],
    ['Приседания со штангой', 'Ноги', 'barbell'],
    ['Приседания в Смите', 'Ноги', 'machine'],
    ['Жим ногами', 'Ноги', 'machine'],
    ['Румынская тяга', 'Ноги', 'barbell'],
    ['Выпады с гантелями', 'Ноги', 'dumbbell'],
    ['Разгибания ног в тренажёре', 'Ноги', 'machine'],
    ['Сгибания ног в тренажёре', 'Ноги', 'machine'],
    ['Жим штанги стоя', 'Плечи', 'barbell'],
    ['Жим гантелей сидя', 'Плечи', 'dumbbell'],
    ['Махи гантелями в стороны', 'Плечи', 'dumbbell'],
    ['Шраги со штангой', 'Плечи', 'barbell'],
    ['Подъём штанги на бицепс', 'Бицепс', 'barbell'],
    ['Сгибания рук с гантелями', 'Бицепс', 'dumbbell'],
    ['Молотки с гантелями', 'Бицепс', 'dumbbell'],
    ['Французский жим лёжа', 'Трицепс', 'barbell'],
    ['Разгибания на трицепс в блоке', 'Трицепс', 'machine'],
    ['Отжимания узким хватом', 'Трицепс', 'bodyweight'],
    ['Планка', 'Пресс', 'time'],
    ['Скручивания', 'Пресс', 'bodyweight'],
    ['Подъём ног в висе', 'Пресс', 'bodyweight'],
    ['Боковая планка', 'Пресс', 'time'],
    ['Подъём на носки стоя', 'Икры', 'machine'],
    ['Подъём на носки сидя', 'Икры', 'machine'],
    ['Беговая дорожка', 'Кардио', 'time'],
    ['Велотренажёр', 'Кардио', 'time'],
    ['Гребной тренажёр', 'Кардио', 'time']
  ];

  function seedExercises() {
    return SEED_EXERCISES.map(function (row) {
      return { id: 'ex_' + slug(row[0]), name: row[0], group: row[1], kind: row[2] };
    });
  }

  function slug(s) {
    var map = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
      к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
      х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
    };
    var out = String(s).toLowerCase().split('').map(function (ch) {
      return map[ch] !== undefined ? map[ch] : ch;
    }).join('');
    out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return out.slice(0, 32).replace(/-+$/, '') || 'x';
  }

  var SEED_ROUTINES = [
    {
      name: 'Full Body A', items: [
        ['Приседания со штангой', 3, '8'],
        ['Жим штанги лёжа', 3, '8'],
        ['Тяга штанги в наклоне', 3, '10'],
        ['Планка', 3, '60']
      ]
    },
    {
      name: 'Full Body B', items: [
        ['Становая тяга', 3, '6'],
        ['Жим штанги стоя', 3, '8'],
        ['Подтягивания', 3, '8'],
        ['Выпады с гантелями', 3, '12']
      ]
    },
    {
      name: 'Push (грудь/плечи/трицепс)', items: [
        ['Жим штанги лёжа', 4, '8'],
        ['Жим гантелей наклонный', 3, '10'],
        ['Разводка гантелей лёжа', 3, '12'],
        ['Махи гантелями в стороны', 3, '15'],
        ['Французский жим лёжа', 3, '12']
      ]
    },
    {
      name: 'Pull (спина/бицепс)', items: [
        ['Подтягивания', 4, '8'],
        ['Тяга верхнего блока', 3, '10'],
        ['Тяга гантели одной рукой', 3, '10'],
        ['Подъём штанги на бицепс', 3, '12'],
        ['Шраги со штангой', 3, '15']
      ]
    },
    {
      name: 'Legs (ноги)', items: [
        ['Приседания со штангой', 4, '8'],
        ['Жим ногами', 3, '12'],
        ['Румынская тяга', 3, '10'],
        ['Подъём на носки стоя', 4, '15'],
        ['Скручивания', 3, '20']
      ]
    }
  ];

  function seedRoutines(exercises) {
    var byName = {};
    exercises.forEach(function (e) { byName[e.name] = e.id; });
    return SEED_ROUTINES.map(function (r) {
      return {
        id: 'rt_' + slug(r.name).slice(0, 16).replace(/-+$/, ''),
        name: r.name,
        items: r.items.filter(function (it) { return byName[it[0]]; }).map(function (it) {
          return { exerciseId: byName[it[0]], sets: it[1], reps: it[2] };
        })
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Состояние                                                          */
  /* ------------------------------------------------------------------ */

  function defaultState() {
    var exercises = seedExercises();
    return {
      v: STATE_VERSION,
      createdAt: new Date().toISOString(),
      settings: {
        unit: 'кг',
        restSec: 90,
        autoRest: true,
        sound: true,
        vibrate: true,
        barKg: 20,
        step: 2.5,
        plates: [25, 20, 15, 10, 5, 2.5, 1.25]
      },
      exercises: exercises,
      routines: seedRoutines(exercises),
      active: null,
      workouts: [],
      body: []
    };
  }

  function exerciseById(state, id) {
    var list = (state && state.exercises) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function exerciseName(state, id) {
    var e = exerciseById(state, id);
    return e ? e.name : 'Упражнение';
  }

  function exerciseKind(state, id) {
    var e = exerciseById(state, id);
    return e ? e.kind : 'barbell';
  }

  function findExerciseByName(state, name) {
    var n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    var list = (state && state.exercises) || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].name).toLowerCase() === n) return list[i];
    return null;
  }

  function addExercise(state, name, group, kind) {
    var clean = String(name || '').trim();
    if (!clean) return null;
    var found = findExerciseByName(state, clean);
    if (found) return found;
    var ex = {
      id: uid('ex'),
      name: clean.slice(0, 60),
      group: group || 'Другое',
      kind: kind || 'barbell',
      custom: true
    };
    state.exercises.push(ex);
    return ex;
  }

  function emptyWorkout(routineId, name) {
    return {
      id: uid('w'),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      routineId: routineId || null,
      name: name || null,
      note: '',
      entries: []
    };
  }

  function addEntry(workout, exerciseId) {
    var entry = { exerciseId: exerciseId, sets: [] };
    workout.entries.push(entry);
    return entry;
  }

  function newSet(kg, reps, warmup) {
    return { id: uid('s'), kg: round2(num(kg)), reps: num(reps), warmup: !!warmup, done: false, ts: null };
  }

  /** Копия подхода для следующего круга (вес/повторы те же, отметка снята). */
  function cloneSet(s, keepValues) {
    return newSet(keepValues === false ? 0 : num(s.kg), keepValues === false ? 0 : num(s.reps), isWarmup(s));
  }

  /** Разминка: 40/60/80 % от рабочего веса по 5–8 повторов. */
  function warmupSets(workKg, step) {
    var w = num(workKg);
    if (w <= 0) return [];
    var st = num(step, 2.5) || 2.5;
    var plan = [[0.4, 8], [0.6, 5], [0.8, 3]];
    return plan.map(function (p) {
      var kg = Math.max(st, Math.round((w * p[0]) / st) * st);
      return newSet(kg, p[1], true);
    });
  }

  /** Заготовка подходов из шаблона: вес берём из прошлой тренировки. */
  function setsFromLast(state, exerciseId, count, reps, beforeTs) {
    var target = num(count, 3) || 3;
    var last = lastPerformance(state.workouts, exerciseId, beforeTs);
    var sets = [];
    var baseKg = 0, baseReps = num(reps, 0);
    if (last && last.sets.length) {
      var best = last.sets[0];
      last.sets.forEach(function (s) { if (num(s.kg) >= num(best.kg)) best = s; });
      baseKg = num(best.kg);
      if (!baseReps) baseReps = num(best.reps);
    }
    if (!baseReps) baseReps = 10;
    for (var i = 0; i < target; i++) sets.push(newSet(baseKg, baseReps, false));
    return sets;
  }

  function finishWorkout(state, workout) {
    var w = workout || state.active;
    if (!w) return null;
    w.finishedAt = new Date().toISOString();
    w.entries = (w.entries || []).filter(function (e) { return (e.sets || []).length > 0; });
    state.workouts.unshift(w);
    if (state.active === w) state.active = null;
    return w;
  }

  function removeWorkout(state, id) {
    state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
  }

  function bodyWeightSeries(state) {
    return (state.body || []).slice().sort(function (a, b) { return parseDate(a.date) - parseDate(b.date); });
  }

  function setBodyWeight(state, kg, when) {
    var k = dateKey(when || new Date());
    var list = state.body || (state.body = []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].date === k) { list[i].kg = round2(num(kg)); return list[i]; }
    }
    var rec = { date: k, kg: round2(num(kg)) };
    list.push(rec);
    return rec;
  }

  /* ------------------------------------------------------------------ */
  /* Импорт / экспорт                                                   */
  /* ------------------------------------------------------------------ */

  function serialize(state) {
    return JSON.stringify(state, null, 2);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Приведение произвольного объекта к актуальной схеме. */
  function normalizeState(raw) {
    var def = defaultState();
    if (!raw || typeof raw !== 'object') return def;
    var st = {
      v: STATE_VERSION,
      createdAt: raw.createdAt || def.createdAt,
      settings: Object.assign({}, def.settings, raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
      exercises: [],
      routines: [],
      active: null,
      workouts: [],
      body: []
    };
    var seen = {};
    (Array.isArray(raw.exercises) ? raw.exercises : []).forEach(function (e) {
      if (!e || !e.name) return;
      var id = String(e.id || uid('ex'));
      if (seen[id]) id = uid('ex');
      seen[id] = true;
      st.exercises.push({
        id: id,
        name: String(e.name).slice(0, 60),
        group: String(e.group || 'Другое'),
        kind: String(e.kind || 'barbell'),
        custom: !!e.custom
      });
    });
    // Дополняем справочник базовыми упражнениями, которых нет
    def.exercises.forEach(function (e) {
      if (!findExerciseByName(st, e.name)) st.exercises.push(e);
    });

    function normSets(entry) {
      return (Array.isArray(entry.sets) ? entry.sets : []).map(function (s) {
        return {
          id: String(s && s.id || uid('s')),
          kg: round2(num(s && s.kg)),
          reps: num(s && s.reps),
          warmup: !!(s && s.warmup),
          done: !!(s && s.done),
          ts: (s && s.ts) || null
        };
      });
    }
    function normEntries(list, keepEmpty) {
      return (Array.isArray(list) ? list : []).map(function (e) {
        if (!e) return null;
        var ex = findExerciseByName(st, e.exerciseName) || exerciseById(st, e.exerciseId);
        if (!ex) return null;
        var sets = normSets(e);
        if (!keepEmpty) {
          sets = sets.filter(function (s) { return num(s.reps) > 0 || num(s.kg) > 0; });
          if (!sets.length) return null; // упражнение без единого подхода в историю не пишем
        }
        return { exerciseId: ex.id, sets: sets };
      }).filter(Boolean);
    }

    (Array.isArray(raw.workouts) ? raw.workouts : []).forEach(function (w) {
      if (!w) return;
      var entries = normEntries(w.entries);
      if (!entries.length) return;
      st.workouts.push({
        id: String(w.id || uid('w')),
        startedAt: w.startedAt || new Date().toISOString(),
        finishedAt: w.finishedAt || w.startedAt || new Date().toISOString(),
        routineId: w.routineId || null,
        name: w.name || null,
        note: String(w.note || ''),
        entries: entries
      });
    });
    st.workouts.sort(function (a, b) { return parseDate(b.startedAt) - parseDate(a.startedAt); });

    if (raw.active && Array.isArray(raw.active.entries)) {
      // черновик тренировки сохраняем целиком: пустые подходы — тоже часть записи
      var aEntries = normEntries(raw.active.entries, true);
      if (aEntries.length) {
        st.active = {
          id: String(raw.active.id || uid('w')),
          startedAt: raw.active.startedAt || new Date().toISOString(),
          finishedAt: null,
          routineId: raw.active.routineId || null,
          name: raw.active.name || null,
          note: String(raw.active.note || ''),
          entries: aEntries
        };
      }
    }

    (Array.isArray(raw.routines) ? raw.routines : []).forEach(function (r) {
      if (!r || !r.name) return;
      var items = (Array.isArray(r.items) ? r.items : []).map(function (it) {
        if (!it) return null;
        var ex = findExerciseByName(st, it.exerciseName) || exerciseById(st, it.exerciseId);
        if (!ex) return null;
        return { exerciseId: ex.id, sets: num(it.sets, 3) || 3, reps: String(it.reps || '10') };
      }).filter(Boolean);
      if (items.length) st.routines.push({ id: String(r.id || uid('rt')), name: String(r.name).slice(0, 60), items: items });
    });
    if (!st.routines.length) st.routines = seedRoutines(st.exercises);
    // Дополняем шаблоны упражнениями по имени (если импорт был частичным)
    st.routines = st.routines.map(function (r) {
      return {
        id: r.id, name: r.name,
        items: r.items.map(function (it) {
          return {
            exerciseId: it.exerciseId,
            exerciseName: exerciseName(st, it.exerciseId),
            sets: it.sets, reps: it.reps
          };
        })
      };
    });

    (Array.isArray(raw.body) ? raw.body : []).forEach(function (b) {
      if (!b) return;
      var kg = num(b.kg);
      if (kg > 0) st.body.push({ date: String(b.date || dateKey(new Date())).slice(0, 10), kg: round2(kg) });
    });
    st.body.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return st;
  }

  /** Разбор файла импорта: принимает и «сырое» состояние, и полный экспорт. */
  function parseImport(text) {
    var data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data && data.state) data = data.state;
    return normalizeState(data);
  }

  /**
   * Слияние импортированных данных с текущими.
   * mode: 'merge' (по умолчанию) — добавить новое, 'replace' — заменить всё.
   */
  function mergeStates(current, incoming, mode) {
    var inc = normalizeState(incoming);
    if (mode === 'replace') return inc;
    var out = normalizeState(current);
    // упражнения
    inc.exercises.forEach(function (e) {
      if (!findExerciseByName(out, e.name)) out.exercises.push(e);
    });
    // шаблоны по имени
    inc.routines.forEach(function (r) {
      var exists = out.routines.some(function (x) { return x.name === r.name; });
      if (!exists) out.routines.push(r);
    });
    // тренировки по id
    var ids = {};
    out.workouts.forEach(function (w) { ids[w.id] = true; });
    inc.workouts.forEach(function (w) { if (!ids[w.id]) out.workouts.push(w); });
    out.workouts.sort(function (a, b) { return parseDate(b.startedAt) - parseDate(a.startedAt); });
    // вес тела по дате (новое значение побеждает)
    var byDate = {};
    out.body.forEach(function (b) { byDate[b.date] = b; });
    inc.body.forEach(function (b) { byDate[b.date] = b; });
    out.body = Object.keys(byDate).map(function (k) { return byDate[k]; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!out.active && inc.active) out.active = inc.active;
    return out;
  }

  /** Экспорт в файл-совместимый вид (с именами упражнений — читаемо для человека). */
  function exportPayload(state) {
    var copy = clone(state);
    copy.exportedAt = new Date().toISOString();
    copy.app = 'Zal — тренировочный дневник';
    (copy.workouts || []).forEach(function (w) {
      (w.entries || []).forEach(function (e) { e.exerciseName = exerciseName(state, e.exerciseId); });
    });
    if (copy.active) {
      (copy.active.entries || []).forEach(function (e) { e.exerciseName = exerciseName(state, e.exerciseId); });
    }
    (copy.routines || []).forEach(function (r) {
      (r.items || []).forEach(function (it) { it.exerciseName = exerciseName(state, it.exerciseId); });
    });
    return copy;
  }

  /* ------------------------------------------------------------------ */
  /* Текстовый отчёт (поделиться тренировкой)                           */
  /* ------------------------------------------------------------------ */

  function workoutToText(state, w) {
    var st = workoutStats(w);
    var lines = [];
    lines.push('🏋️ ' + (w.name || (w.routineId ? routineName(state, w.routineId) : 'Тренировка')));
    lines.push(fmtDateFull(w.startedAt));
    lines.push('Объём: ' + fmtVolume(st.volume) + ' · подходов: ' + st.sets +
      (st.durationSec ? ' · время: ' + fmtDuration(st.durationSec) : ''));
    lines.push('');
    (w.entries || []).forEach(function (e) {
      var es = entryStats(e);
      if (!es.sets && !es.warmups) return;
      lines.push(exerciseName(state, e.exerciseId));
      (e.sets || []).forEach(function (s) {
        if (!num(s.reps) && !num(s.kg)) return;
        lines.push('   ' + (s.warmup ? 'разминка ' : '') + fmtNum(s.kg) + ' кг × ' + fmtNum(s.reps));
      });
      if (es.best1RM) lines.push('   ≈1ПМ ' + fmtNum(es.best1RM) + ' кг');
    });
    if (w.note) { lines.push(''); lines.push('Заметка: ' + w.note); }
    return lines.join('\n');
  }

  function routineName(state, id) {
    var list = (state && state.routines) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return 'Тренировка';
  }

  /** CSV всех подходов — можно открыть в Excel. */
  function workoutsToCsv(state) {
    var rows = [['дата', 'тренировка', 'упражнение', 'группа', 'подход', 'вес_кг', 'повторы', 'объём_кг', 'разминка']];
    (state.workouts || []).slice().sort(function (a, b) { return parseDate(a.startedAt) - parseDate(b.startedAt); })
      .forEach(function (w) {
        (w.entries || []).forEach(function (e) {
          var ex = exerciseById(state, e.exerciseId) || { name: '?', group: '' };
          (e.sets || []).forEach(function (s, i) {
            rows.push([
              dateKey(w.startedAt), w.name || routineName(state, w.routineId), ex.name, ex.group,
              i + 1, fmtNum(s.kg), fmtNum(s.reps), fmtNum(setVolume(s)), s.warmup ? 'да' : ''
            ]);
          });
        });
      });
    return rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
  }

  return {
    STATE_VERSION: STATE_VERSION,
    GROUPS: GROUPS,
    // утилиты
    uid: uid, num: num, round2: round2, fmtNum: fmtNum, fmtKg: fmtKg, fmtDuration: fmtDuration,
    fmtClock: fmtClock, fmtDate: fmtDate, fmtDateFull: fmtDateFull, dayLabel: dayLabel, dateKey: dateKey,
    slug: slug, fmtVolume: fmtVolume, pad2: pad2,
    // математика
    epley1RM: epley1RM, weightForReps: weightForReps, recalcKg: recalcKg, setVolume: setVolume,
    entryStats: entryStats, workoutStats: workoutStats, computePRs: computePRs,
    lastPerformance: lastPerformance, progressSeries: progressSeries, progressionHint: progressionHint,
    activitySummary: activitySummary, plateBreakdown: plateBreakdown,
    // состояние
    defaultState: defaultState, normalizeState: normalizeState, exerciseById: exerciseById,
    exerciseName: exerciseName, exerciseKind: exerciseKind, findExerciseByName: findExerciseByName,
    addExercise: addExercise, emptyWorkout: emptyWorkout, addEntry: addEntry, newSet: newSet,
    cloneSet: cloneSet, warmupSets: warmupSets, setsFromLast: setsFromLast, finishWorkout: finishWorkout,
    removeWorkout: removeWorkout, bodyWeightSeries: bodyWeightSeries, setBodyWeight: setBodyWeight,
    routineName: routineName, seedExercises: seedExercises, seedRoutines: seedRoutines,
    // импорт/экспорт
    serialize: serialize, parseImport: parseImport, mergeStates: mergeStates, exportPayload: exportPayload,
    workoutToText: workoutToText, workoutsToCsv: workoutsToCsv, clone: clone
  };
});

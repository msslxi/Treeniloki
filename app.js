(() => {
  'use strict';

  const DB = 'treeniloki-db';
  const KEY = 'state';
  let db;
  let state;
  let tab = 'templates';
  let modal;
  let timer;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[c]);
  const clone = o => JSON.parse(JSON.stringify(o));

  const fresh = () => ({
    settings: { effortType: 'RIR', unit: 'kg', restSeconds: 120 },
    templates: [{
      id: uid('t'),
      name: 'Push A (esimerkki)',
      slots: [{
        id: uid('s'),
        name: 'Penkkipunnerrus',
        sup: '',
        sets: [
          { id: uid('x'), type: 'normal', w: 100, r: 8, e: 2 },
          { id: uid('x'), type: 'normal', w: 100, r: 8, e: 2 },
          { id: uid('x'), type: 'normal', w: 100, r: 8, e: 2 }
        ]
      }, {
        id: uid('s'),
        name: 'Sivuvipunosto',
        sup: 'A',
        sets: [
          { id: uid('x'), type: 'normal', w: 10, r: 15, e: 2 },
          { id: uid('x'), type: 'normal', w: 10, r: 15, e: 2 },
          { id: uid('x'), type: 'normal', w: 10, r: 15, e: 2 }
        ]
      }]
    }],
    workouts: [],
    active: null
  });

  function openDb() {
    return new Promise((res, rej) => {
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore('kv');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }

  function get(k) {
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }

  function put(k, v) {
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  }

  const save = () => put(KEY, state);
  const fmt = t => new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(t));
  const dur = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };

  const aw = () => state.workouts.find(w => w.id === state.active && w.status === 'active');

  function prev(w, ex) {
    if (!w.templateId) return null;
    const workouts = state.workouts
      .filter(x => x.status === 'completed' && x.templateId === w.templateId)
      .sort((a, b) => b.finishedAt - a.finishedAt);
    for (const x of workouts) {
      const e = x.exercises.find(y => y.slotId === ex.slotId);
      if (e) return e;
    }
    return null;
  }

  const tlabel = t => ({ normal: 'N', warmup: 'W', drop: 'D', backoff: 'B', failure: 'F' }[t] || 'N');
  const tfull = t => ({ normal: 'Normal', warmup: 'Warm-up', drop: 'Drop', backoff: 'Back-off', failure: 'Failure' }[t] || 'Normal');

  function nav() {
    return `<nav class="nav">
      <button data-tab="templates" class="${tab === 'templates' ? 'active' : ''}">Templatet</button>
      <button data-tab="history" class="${tab === 'history' ? 'active' : ''}">Historia</button>
      <button data-tab="settings" class="${tab === 'settings' ? 'active' : ''}">Asetukset</button>
    </nav>`;
  }

  function bindNav() {
    $$('[data-tab]').forEach(b => b.onclick = () => {
      tab = b.dataset.tab;
      render();
    });
  }

  function renderKeep() {
    const y = scrollY;
    render();
    requestAnimationFrame(() => scrollTo(0, y));
  }

  function render() {
    clearInterval(timer);
    const w = aw();
    if (w) return workout(w);
    if (tab === 'history') return history();
    if (tab === 'settings') return settings();
    templates();
  }

  function templates() {
    const rows = state.templates.map(t => `
      <div class="card row">
        <div><b>${esc(t.name)}</b><div class="mini">${t.slots.length} liikettä</div></div>
        <div class="actions">
          <button class="btn small" data-edit="${t.id}">Muokkaa</button>
          <button class="btn small primary" data-start="${t.id}">Aloita</button>
        </div>
      </div>`).join('');

    $('#app').innerHTML = `
      <header class="top"><div><h1>Treeniloki</h1><div class="mini">Offline iPhonella</div></div></header>
      <main class="page">
        <button class="btn block primary" id="blank-workout">+ Aloita tyhjä treeni</button>
        ${rows || '<div class="card">Ei templateja.</div>'}
      </main>
      <button class="fab" id="new" aria-label="Uusi template">+</button>
      ${nav()}`;

    bindNav();
    $('#new').onclick = () => editTemplate();
    $('#blank-workout').onclick = startBlank;
    $$('[data-start]').forEach(b => b.onclick = () => start(b.dataset.start));
    $$('[data-edit]').forEach(b => b.onclick = () => editTemplate(b.dataset.edit));
  }

  async function start(id) {
    const t = state.templates.find(x => x.id === id);
    if (!t) return;
    const w = {
      id: uid('w'),
      templateId: t.id,
      templateName: t.name,
      startedAt: Date.now(),
      status: 'active',
      exercises: t.slots.map(s => ({
        id: uid('e'),
        slotId: s.id,
        name: s.name,
        sup: s.sup,
        sets: s.sets.map(x => ({
          id: uid('ws'),
          type: x.type || 'normal',
          weight: x.w ?? '',
          reps: x.r ?? '',
          effort: x.e ?? '',
          done: false
        }))
      }))
    };
    state.workouts.push(w);
    state.active = w.id;
    await save();
    render();
  }

  async function startBlank() {
    const w = {
      id: uid('w'),
      templateId: null,
      templateName: 'Tyhjä treeni',
      startedAt: Date.now(),
      status: 'active',
      exercises: []
    };
    state.workouts.push(w);
    state.active = w.id;
    await save();
    render();
    addExercise(w);
  }

  function workout(w) {
    const effort = state.settings.effortType;
    const body = w.exercises.map(ex => {
      const p = prev(w, ex);
      const rows = ex.sets.map((s, i) => `
        <div class="setrow" data-ex="${ex.id}" data-set="${s.id}">
          <button class="type" data-type>${tlabel(s.type)}</button>
          <div class="prev">${p?.sets?.[i] ? `${p.sets[i].weight || '–'}×${p.sets[i].reps || '–'}` : '–'}</div>
          <input inputmode="decimal" data-f="weight" value="${esc(s.weight)}">
          <input inputmode="numeric" data-f="reps" value="${esc(s.reps)}">
          <input inputmode="decimal" data-f="effort" value="${esc(s.effort)}">
          <button class="check ${s.done ? 'done' : ''}" data-done>${s.done ? '✓' : '○'}</button>
          <button class="setdelete" data-del-set aria-label="Poista sarja">×</button>
        </div>`).join('');

      return `<section class="card slot">
        <div class="row">
          <div><h2>${esc(ex.name)}</h2>${ex.sup ? `<div class="sup">SUPERSET ${esc(ex.sup)}</div>` : ''}</div>
          <button class="btn small danger" data-del-ex="${ex.id}">Poista</button>
        </div>
        <div class="sethead"><div>T</div><div>Ed.</div><div>${state.settings.unit}</div><div>Reps</div><div>${effort}</div><div></div><div></div></div>
        ${rows}
        <div class="actions">
          <button class="btn small" data-add="${ex.id}">+ Sarja</button>
          <button class="btn small" data-drop="${ex.id}">+ Drop</button>
        </div>
      </section>`;
    }).join('');

    $('#app').innerHTML = `
      <header class="top">
        <div><h1>${esc(w.templateName)}</h1><div class="mini" id="clock"></div></div>
        <button class="btn primary" id="finish">Lopeta</button>
      </header>
      <div class="restbar" id="restbar" ${w.restUntil ? '' : 'hidden'}>
        <span>Tauko</span>
        <b id="restclock"></b>
        <button id="rest-stop" aria-label="Lopeta taukoajastin">×</button>
      </div>
      <main class="page">
        ${body || '<div class="card"><b>Tyhjä treeni</b><div class="mini">Lisää ensimmäinen liike alta.</div></div>'}
        <button class="btn block" id="add-ex">+ Lisää liike</button>
      </main>`;

    let restExpired = false;
    const tick = () => {
      const clock = $('#clock');
      if (clock) clock.textContent = dur(Date.now() - w.startedAt);
      const bar = $('#restbar');
      const restClock = $('#restclock');
      if (w.restUntil && w.restUntil > Date.now()) {
        if (bar) bar.hidden = false;
        const left = Math.ceil((w.restUntil - Date.now()) / 1000);
        if (restClock) restClock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      } else if (w.restUntil) {
        w.restUntil = null;
        if (bar) bar.hidden = true;
        if (!restExpired) {
          restExpired = true;
          save().catch(() => {});
        }
      } else if (bar) {
        bar.hidden = true;
      }
    };
    tick();
    timer = setInterval(tick, 1000);
    $('#rest-stop').onclick = async () => {
      w.restUntil = null;
      await save();
      tick();
    };

    $$('.setrow').forEach(r => {
      const ex = w.exercises.find(x => x.id === r.dataset.ex);
      const s = ex.sets.find(x => x.id === r.dataset.set);
      $$('input', r).forEach(i => i.oninput = async e => {
        s[e.target.dataset.f] = e.target.value.replace(',', '.');
        await save();
      });
      $('[data-done]', r).onclick = async () => {
        const wasDone = s.done;
        s.done = !s.done;
        if (!wasDone && s.done) {
          const seconds = Math.max(0, Number(state.settings.restSeconds ?? 120) || 0);
          if (seconds > 0) w.restUntil = Date.now() + seconds * 1000;
        }
        await save();
        renderKeep();
      };
      $('[data-type]', r).onclick = async () => {
        const a = ['normal', 'warmup', 'drop', 'backoff', 'failure'];
        s.type = a[(a.indexOf(s.type) + 1) % a.length];
        await save();
        renderKeep();
      };
      $('[data-del-set]', r).onclick = async () => {
        if (!confirm('Poistetaanko tämä sarja?')) return;
        ex.sets = ex.sets.filter(x => x.id !== s.id);
        await save();
        renderKeep();
      };
    });

    $$('[data-add]').forEach(b => b.onclick = async () => {
      const ex = w.exercises.find(x => x.id === b.dataset.add);
      const z = ex.sets.at(-1) || {};
      ex.sets.push({ id: uid('ws'), type: 'normal', weight: z.weight ?? '', reps: z.reps ?? '', effort: z.effort ?? '', done: false });
      await save();
      renderKeep();
    });

    $$('[data-drop]').forEach(b => b.onclick = async () => {
      const ex = w.exercises.find(x => x.id === b.dataset.drop);
      const z = ex.sets.at(-1) || {};
      ex.sets.push({ id: uid('ws'), type: 'drop', weight: z.weight ?? '', reps: '', effort: '', done: false });
      await save();
      renderKeep();
    });

    $$('[data-del-ex]').forEach(b => b.onclick = async () => {
      if (confirm('Poistetaanko liike tästä treenistä?')) {
        w.exercises = w.exercises.filter(x => x.id !== b.dataset.delEx);
        await save();
        renderKeep();
      }
    });

    $('#add-ex').onclick = () => addExercise(w);
    $('#finish').onclick = () => finish(w);
  }

  function addExercise(w) {
    sheet(`<h2>Lisää liike</h2>
      <div class="field"><label>Nimi</label><input id="en" autocomplete="off"></div>
      <div class="field"><label>Superset</label><input id="es" placeholder="A" autocomplete="off"></div>
      <button class="btn block primary" id="ea">Lisää</button>
      <button class="btn block" id="ec">Peruuta</button>`);

    $('#ea').onclick = async () => {
      const n = $('#en').value.trim();
      if (!n) return;
      w.exercises.push({
        id: uid('e'),
        slotId: uid('adhoc'),
        name: n,
        sup: $('#es').value.trim().toUpperCase(),
        sets: [{ id: uid('ws'), type: 'normal', weight: '', reps: '', effort: '', done: false }]
      });
      await save();
      closeSheet();
      render();
    };
    $('#ec').onclick = closeSheet;
    setTimeout(() => $('#en')?.focus(), 50);
  }

  function finish(w) {
    if (!w.templateId) {
      sheet(`<h2>Treeni valmis</h2>
        <div class="stack">
          <button class="btn block primary" id="save-blank">Tallenna treeni</button>
          <button class="btn block" id="cancel-fin">Peruuta</button>
        </div>`);
      $('#save-blank').onclick = async () => {
        w.status = 'completed';
        w.finishedAt = Date.now();
        w.restUntil = null;
        state.active = null;
        await save();
        closeSheet();
        tab = 'history';
        render();
      };
      $('#cancel-fin').onclick = closeSheet;
      return;
    }

    sheet(`<h2>Treeni valmis</h2>
      <div class="stack">
        <button class="btn block" data-fin="none">Älä päivitä templatea</button>
        <button class="btn block primary" data-fin="loads">Päivitä painot ja toistot</button>
        <button class="btn block primary" data-fin="all">Päivitä koko template</button>
        <button class="btn block" id="cancel-fin">Peruuta</button>
      </div>`);

    $$('[data-fin]').forEach(b => b.onclick = async () => {
      const mode = b.dataset.fin;
      const t = state.templates.find(x => x.id === w.templateId);
      w.status = 'completed';
      w.finishedAt = Date.now();
      w.restUntil = null;
      state.active = null;

      if (t && mode === 'loads') {
        for (const s of t.slots) {
          const ex = w.exercises.find(e => e.slotId === s.id);
          if (ex) {
            s.sets = s.sets.map((x, i) => ({
              ...x,
              w: ex.sets[i]?.weight ?? x.w,
              r: ex.sets[i]?.reps ?? x.r,
              e: ex.sets[i]?.effort ?? x.e
            }));
          }
        }
      }

      if (t && mode === 'all') {
        t.slots = w.exercises.map(e => ({
          id: e.slotId,
          name: e.name,
          sup: e.sup,
          sets: e.sets.map(s => ({ id: uid('x'), type: s.type, w: s.weight, r: s.reps, e: s.effort }))
        }));
      }

      await save();
      closeSheet();
      tab = 'history';
      render();
    });
    $('#cancel-fin').onclick = closeSheet;
  }

  function shareText(w) {
    const a = [
      `${w.templateName} – ${fmt(w.finishedAt || Date.now())}`,
      `Kesto: ${dur((w.finishedAt || Date.now()) - w.startedAt)}`,
      ''
    ];
    for (const e of w.exercises) {
      a.push(e.sup ? `${e.name} (Superset ${e.sup})` : e.name);
      e.sets
        .filter(s => s.done || s.weight || s.reps || s.effort)
        .forEach((s, i) => a.push(
          `${i + 1}. ${s.weight || '–'} ${state.settings.unit} × ${s.reps || '–'}` +
          `${s.effort !== '' ? ` · ${state.settings.effortType} ${s.effort}` : ''}` +
          `${s.type !== 'normal' ? ` [${tfull(s.type)}]` : ''}`
        ));
      a.push('');
    }
    return a.join('\n').trim();
  }

  async function copy(w, b) {
    const txt = shareText(w);
    let ok = false;
    try {
      await navigator.clipboard.writeText(txt);
      ok = true;
    } catch {}
    if (!ok) {
      const x = document.createElement('textarea');
      x.value = txt;
      document.body.appendChild(x);
      x.select();
      ok = document.execCommand('copy');
      x.remove();
    }
    if (b) {
      const o = b.textContent;
      b.textContent = ok ? 'Kopioitu ✓' : 'Virhe';
      setTimeout(() => b.textContent = o, 1200);
    }
  }

  async function share(w) {
    const txt = shareText(w);
    if (navigator.share) {
      try {
        return await navigator.share({ title: w.templateName, text: txt });
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    await copy(w);
    alert('Treenin teksti kopioitiin.');
  }

  async function deleteWorkout(id) {
    const w = state.workouts.find(x => x.id === id && x.status === 'completed');
    if (!w) return;
    if (!confirm(`Poistetaanko treeni "${w.templateName}" (${fmt(w.finishedAt)})?\n\nTätä ei voi perua ilman varmuuskopiota.`)) return;
    state.workouts = state.workouts.filter(x => x.id !== id);
    await save();
    history();
  }

  function history() {
    const a = state.workouts
      .filter(w => w.status === 'completed')
      .sort((a, b) => b.finishedAt - a.finishedAt);

    const rows = a.map(w => `<div class="card">
      <div class="row">
        <div><b>${esc(w.templateName)}</b><div class="mini">${fmt(w.finishedAt)} · ${dur(w.finishedAt - w.startedAt)}</div></div>
        <span class="badge">${w.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)} sarjaa</span>
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn small" data-copy="${w.id}">Kopioi tekstinä</button>
        <button class="btn small primary" data-share="${w.id}">Jaa treeni</button>
        <button class="btn small danger" data-delete-workout="${w.id}">Poista</button>
      </div>
    </div>`).join('');

    $('#app').innerHTML = `
      <header class="top"><h1>Historia</h1></header>
      <main class="page">${rows || '<div class="card">Ei tehtyjä treenejä.</div>'}</main>
      ${nav()}`;

    bindNav();
    $$('[data-copy]').forEach(b => b.onclick = () => copy(state.workouts.find(w => w.id === b.dataset.copy), b));
    $$('[data-share]').forEach(b => b.onclick = () => share(state.workouts.find(w => w.id === b.dataset.share)));
    $$('[data-delete-workout]').forEach(b => b.onclick = () => deleteWorkout(b.dataset.deleteWorkout));
  }

  function settings() {
    $('#app').innerHTML = `
      <header class="top"><h1>Asetukset</h1></header>
      <main class="page">
        <div class="card stack">
          <div class="field"><label>Intensiteetti</label><select id="eff"><option ${state.settings.effortType === 'RIR' ? 'selected' : ''}>RIR</option><option ${state.settings.effortType === 'RPE' ? 'selected' : ''}>RPE</option></select></div>
          <div class="field"><label>Yksikkö</label><select id="unit"><option ${state.settings.unit === 'kg' ? 'selected' : ''}>kg</option><option ${state.settings.unit === 'lb' ? 'selected' : ''}>lb</option></select></div>
          <div class="field">
            <label>Taukoajastin (sekuntia)</label>
            <input id="rest-seconds" type="number" inputmode="numeric" min="0" max="1800" step="5" value="${esc(state.settings.restSeconds ?? 120)}">
            <div class="mini">0 = pois päältä. Ajastin käynnistyy, kun sarja merkitään tehdyksi.</div>
          </div>
        </div>
        <div class="card stack">
          <button class="btn" id="export">Vie JSON-varmuuskopio</button>
          <button class="btn" id="import">Palauta JSON-varmuuskopio</button>
          <input id="file" type="file" accept=".json,application/json" hidden>
        </div>
      </main>
      ${nav()}`;

    bindNav();
    $('#eff').onchange = async e => { state.settings.effortType = e.target.value; await save(); };
    $('#unit').onchange = async e => { state.settings.unit = e.target.value; await save(); };
    $('#rest-seconds').onchange = async e => {
      let n = Math.round(Number(e.target.value));
      if (!Number.isFinite(n)) n = 120;
      n = Math.min(1800, Math.max(0, n));
      state.settings.restSeconds = n;
      e.target.value = n;
      await save();
    };
    $('#export').onclick = () => {
      const a = document.createElement('a');
      const u = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      a.href = u;
      a.download = 'treeniloki-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    };
    $('#import').onclick = () => $('#file').click();
    $('#file').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const x = JSON.parse(await f.text());
        if (!x.templates || !x.workouts) throw Error('Virheellinen tiedosto');
        if (confirm('Korvataanko nykyiset tiedot?')) {
          state = x;
          state.settings = state.settings || {};
          if (!('restSeconds' in state.settings)) state.settings.restSeconds = 120;
          await save();
          tab = 'templates';
          render();
        }
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function editTemplate(id) {
    const orig = state.templates.find(t => t.id === id);
    const d = orig ? clone(orig) : { id: uid('t'), name: '', slots: [] };

    function draw() {
      const old = $('.sheet')?.scrollTop || 0;
      const slots = d.slots.map(s => `<div class="editor" data-slot="${s.id}">
        <div class="row"><input class="sn" value="${esc(s.name)}" placeholder="Liike"><button class="btn small danger" data-rm>×</button></div>
        <div class="field"><label>Superset</label><input class="ss" value="${esc(s.sup || '')}" placeholder="A"></div>
        ${s.sets.map(x => `<div class="grid3" data-ts="${x.id}">
          <input class="tw" inputmode="decimal" value="${esc(x.w ?? '')}" placeholder="kg">
          <input class="tr" inputmode="numeric" value="${esc(x.r ?? '')}" placeholder="reps">
          <select class="tt">
            <option value="normal" ${x.type === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="warmup" ${x.type === 'warmup' ? 'selected' : ''}>Warm-up</option>
            <option value="drop" ${x.type === 'drop' ? 'selected' : ''}>Drop</option>
            <option value="backoff" ${x.type === 'backoff' ? 'selected' : ''}>Back-off</option>
            <option value="failure" ${x.type === 'failure' ? 'selected' : ''}>Failure</option>
          </select>
        </div>`).join('')}
        <div class="actions"><button class="btn small" data-as>+ Sarja</button><button class="btn small" data-ds>− Sarja</button></div>
      </div>`).join('');

      sheet(`<h2>${orig ? 'Muokkaa templatea' : 'Uusi template'}</h2>
        <div class="field"><label>Nimi</label><input id="tn" value="${esc(d.name)}"></div>
        ${slots}
        <button class="btn block" id="add-slot">+ Lisää liike</button>
        <button class="btn block primary" id="save-t">Tallenna</button>
        ${orig ? '<button class="btn block danger" id="del-t">Poista template</button>' : ''}
        <button class="btn block" id="cancel-t">Peruuta</button>`);

      $('.sheet').scrollTop = old;
      $('#tn').oninput = e => d.name = e.target.value;

      $$('.editor').forEach(el => {
        const s = d.slots.find(x => x.id === el.dataset.slot);
        $('.sn', el).oninput = e => s.name = e.target.value;
        $('.ss', el).oninput = e => s.sup = e.target.value.toUpperCase().slice(0, 3);
        $('[data-rm]', el).onclick = () => { d.slots = d.slots.filter(x => x.id !== s.id); draw(); };
        $$('[data-ts]', el).forEach(r => {
          const x = s.sets.find(y => y.id === r.dataset.ts);
          $('.tw', r).oninput = e => x.w = e.target.value.replace(',', '.');
          $('.tr', r).oninput = e => x.r = e.target.value;
          $('.tt', r).onchange = e => x.type = e.target.value;
        });
        $('[data-as]', el).onclick = () => {
          const z = s.sets.at(-1) || {};
          s.sets.push({ id: uid('x'), type: 'normal', w: z.w ?? '', r: z.r ?? '', e: z.e ?? '' });
          draw();
        };
        $('[data-ds]', el).onclick = () => {
          if (s.sets.length > 1) s.sets.pop();
          draw();
        };
      });

      $('#add-slot').onclick = () => {
        d.slots.push({ id: uid('s'), name: '', sup: '', sets: [{ id: uid('x'), type: 'normal', w: '', r: '', e: '' }] });
        draw();
      };

      $('#save-t').onclick = async () => {
        d.name = d.name.trim();
        d.slots = d.slots.filter(s => s.name.trim());
        if (!d.name || !d.slots.length) return alert('Anna nimi ja vähintään yksi liike.');
        if (orig) state.templates[state.templates.findIndex(t => t.id === orig.id)] = d;
        else state.templates.push(d);
        await save();
        closeSheet();
        render();
      };

      $('#cancel-t').onclick = closeSheet;
      if (orig) $('#del-t').onclick = async () => {
        if (confirm('Poistetaanko template? Historia säilyy.')) {
          state.templates = state.templates.filter(t => t.id !== orig.id);
          await save();
          closeSheet();
          render();
        }
      };
    }

    draw();
  }

  function sheet(html) {
    closeSheet();
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="sheet">${html}</div>`;
    document.body.appendChild(modal);
    modal.onclick = e => { if (e.target === modal) closeSheet(); };
  }

  function closeSheet() {
    if (modal) {
      modal.remove();
      modal = null;
    }
  }

  (async () => {
    try {
      db = await openDb();
      state = await get(KEY) || fresh();
      state.settings = state.settings || {};
      if (!('restSeconds' in state.settings)) state.settings.restSeconds = 120;
      if (state.active && !aw()) state.active = null;
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
      render();
    } catch (e) {
      $('#app').innerHTML = '<main class="page"><div class="card">Käynnistysvirhe: ' + esc(e.message) + '</div></main>';
    }
  })();
})();

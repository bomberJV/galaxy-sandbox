import { createNBodyStage, sparkline } from './nbody-view.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const MODES = ['lab', 'collapse', 'collide', 'real'];
const small = matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

let current = 'lab';
const controllers = {};

function setMode(mode, { scroll = false, push = true } = {}) {
  if (!MODES.includes(mode)) mode = 'lab';
  if (mode === current && controllers[mode]) return;
  controllers[current]?.leave?.();
  current = mode;
  for (const el of $$('[data-mode-panel]')) el.hidden = el.dataset.modePanel !== mode;
  for (const b of $$('[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === mode);
  if (push) history.replaceState(null, '', mode === 'lab' ? location.pathname + location.search : `#${mode}`);
  const c = controllers[mode] || (controllers[mode] = makeController(mode));
  Promise.resolve(c).then((ctrl) => { controllers[mode] = ctrl; ctrl?.enter?.(); });
  if (scroll) $('.mode-tabs').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function makeController(mode) {
  if (mode === 'collapse') return collapseController();
  if (mode === 'collide') return collideController();
  if (mode === 'real') return import('./real-view.js').then((m) => m.createRealController($('#real')))
    .catch((e) => { $('#real-status').textContent = `Could not load the real-galaxy mode: ${e.message}`; return null; });
  return null;
}

// ---------- shared bits ----------
function wireStageControls(section, stage, { onRestart } = {}) {
  const pause = $('[data-act=pause]', section);
  const sync = () => { if (pause) pause.textContent = stage.paused ? 'Play' : 'Pause'; };
  pause?.addEventListener('click', () => { stage.setPaused(!stage.paused); sync(); });
  $('[data-act=restart]', section)?.addEventListener('click', () => onRestart?.());
  for (const b of $$('[data-speed]', section)) b.addEventListener('click', () => {
    stage.setSpeed(Number(b.dataset.speed));
    for (const o of $$('[data-speed]', section)) o.setAttribute('aria-pressed', o === b);
  });
  $('[data-cam=face]', section)?.addEventListener('click', (e) => { e.currentTarget.textContent = stage.faceOn() ? 'Tilt the view' : 'Face-on'; });
  $('[data-cam=in]', section)?.addEventListener('click', () => stage.zoomBy(1.18));
  $('[data-cam=out]', section)?.addEventListener('click', () => stage.zoomBy(1 / 1.18));
  return sync;
}

function readoutHTML(cells) {
  return cells.map((c) => `<div class="${c.wide ? 'wide' : ''}"><span>${c.label}</span><output>${c.value}</output>${c.meter !== undefined ? `<div class="meter"><i style="width:${Math.round(Math.min(1, c.meter) * 100)}%"></i></div>` : ''}</div>`).join('');
}

// ---------- 02 / Let it collapse ----------
const COLLAPSE_LABELS = { none: 'NO HALO', light: 'LIGHT HALO', heavy: 'HEAVY HALO' };
const COLLAPSE_NOTES = {
  compare: 'Same disk, same stars, same starting speeds. Left: the disk alone. Right: the disk inside a heavy dark halo. Both pull on themselves.',
  none: 'The disk is the only mass. Watch the centre stretch into a bar within a few turns.',
  light: 'A modest halo slows the instability down. The bar usually still forms, later and weaker.',
  heavy: 'The halo supplies most of the inner gravity. The disk stays round, with loose spiral wisps.',
};

function collapseController() {
  const section = $('#collapse');
  let choice = 'compare', hist = [], lastUi = 0;
  const stage = createNBodyStage({
    canvas: $('#collapse-canvas'), frame: 'first', viewRadius: 6, rate: (info) => info.tRot / 6,
    onReady: () => { $('#collapse-status').textContent = `Running. One turn of the disk takes about six seconds at 1×. The bar usually appears after one and a half to two and a half turns.${small ? ' This device runs fewer stars, so the bar comes out weaker and noisier.' : ''}`; },
    onError: (m) => { $('#collapse-status').textContent = `Simulation error: ${m}`; },
    onFrame: (i, msg, info) => {
      const rot = msg.time / info.tRot;
      const h = hist[i] || (hist[i] = { values: [], drift: 0, steps: 0 });
      if (msg.stats) {
        if (!h.values.length || rot - h.values.at(-1)[0] >= 0.02) h.values.push([rot, msg.stats.A2 ?? 0]);
        h.drift = msg.stats.energyDrift ?? 0; h.rot = rot; h.A2 = msg.stats.A2 ?? 0; h.stepMs = msg.stepMs;
      }
      const now = performance.now();
      if (now - lastUi > 250) { lastUi = now; render(); }
    },
  });
  const syncPause = wireStageControls(section, stage, { onRestart: () => start(choice) });

  function render() {
    const keys = choice === 'compare' ? ['none', 'heavy'] : [choice];
    const cells = [];
    keys.forEach((k, i) => {
      const h = hist[i]; if (!h) return;
      const tag = keys.length > 1 ? `${COLLAPSE_LABELS[k]} · ` : '';
      cells.push({ label: `${tag}BAR STRENGTH`, value: (h.A2 ?? 0).toFixed(2), meter: (h.A2 ?? 0) / 0.5 });
      cells.push({ label: `${tag}TURNS`, value: (h.rot ?? 0).toFixed(1) });
    });
    const h0 = hist[0];
    if (h0) cells.push({ label: 'ENERGY DRIFT', value: `${(100 * Math.abs(h0.drift)).toFixed(2)}%`, wide: false });
    if (h0?.stepMs) cells.push({ label: 'STEP COST', value: `${h0.stepMs.toFixed(0)} ms` });
    $('#collapse-readouts').innerHTML = readoutHTML(cells);
    sparkline($('#collapse-chart'), keys.map((k, i) => ({ values: hist[i]?.values || [], color: i ? '#e6adbc' : '#daf57c' })),
      { yMax: 0.6, xMax: Math.max(5, ...(hist.map((h) => h?.rot || 0))), xLabel: 'TURNS OF THE DISK', yLabel: 'BAR STRENGTH', marks: [{ y: 0.2, label: 'clear bar', color: '#cda2c0' }] });
  }

  function start(c) {
    choice = c; hist = [];
    for (const b of $$('[data-collapse]', section)) b.setAttribute('aria-pressed', b.dataset.collapse === c);
    const quality = small ? 'low' : 'medium';
    const keys = c === 'compare' ? ['none', 'heavy'] : [c];
    stage.start(keys.map((k) => ({ kind: 'bar', options: { preset: k, quality } })), keys.map((k) => COLLAPSE_LABELS[k]));
    $('#collapse-note').textContent = COLLAPSE_NOTES[c];
    $('#collapse-status').textContent = 'Building the disk…';
    $('#collapse-readouts').innerHTML = '';
    render();
  }
  for (const b of $$('[data-collapse]', section)) b.addEventListener('click', () => start(b.dataset.collapse));

  let started = false;
  return {
    enter() { if (!started) { started = true; start(choice); } else { stage.setPaused(false); } syncPause(); },
    leave() { stage.setPaused(true); syncPause(); },
  };
}

// ---------- 03 / Collide ----------
const PHASE_TEXT = {
  Approaching: 'The galaxies are falling towards each other.',
  'After first pass': 'First pass done. Watch the tidal tails peel off the far sides.',
  'Falling back': 'They are slowing down and falling back together.',
  'Falling back again': 'Falling back again. Each pass loses more orbital energy.',
  Merged: 'Merged: one galaxy now, with debris around it.',
};
function collideController() {
  const section = $('#collide');
  let hist = [], lastUi = 0, mode = 'live';
  const stage = createNBodyStage({
    canvas: $('#collide-canvas'), frame: 'mean', viewRadius: 14, rate: () => 2,
    onReady: () => { $('#collide-status').textContent = 'The galaxies are falling towards each other.'; },
    onError: (m) => { $('#collide-status').textContent = `Simulation error: ${m}`; },
    onFrame: (i, msg, info) => {
      const c = msg.stats?.centres;
      const h = hist[i] || (hist[i] = { values: [], minSep: Infinity, passages: 0, approaching: true });
      if (c && c.length > 1) {
        const sep = Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1], c[0][2] - c[1][2]);
        const rot = msg.time / info.tRot;
        // Hysteresis: a pass counts once the separation has climbed clearly above its latest minimum,
        // so noise in the centre estimates does not register as extra passes.
        if (h.approaching) {
          h.low = Math.min(h.low ?? Infinity, sep);
          if (sep > h.low + Math.max(0.6, 0.25 * h.low)) { h.passages++; h.approaching = false; h.high = sep; }
        } else {
          h.high = Math.max(h.high ?? 0, sep);
          if (sep < h.high - Math.max(0.6, 0.25 * h.high)) { h.approaching = true; h.low = sep; }
        }
        if (!h.values.length || rot - h.values.at(-1)[0] >= 0.02) h.values.push([rot, sep]);
        h.sep = sep; h.rot = rot; h.minSep = Math.min(h.minSep, sep);
        const ph = phase(h);
        if (i === 0 && ph !== h.lastPhase) { h.lastPhase = ph; $('#collide-status').textContent = PHASE_TEXT[ph] || ph; }
      }
      const now = performance.now();
      if (now - lastUi > 250) { lastUi = now; render(); }
    },
  });
  const syncPause = wireStageControls(section, stage);

  function phase(h) {
    if (!h || h.sep === undefined) return '—';
    if (h.passages === 0) return 'Approaching';
    if (h.sep < 1 && h.passages >= 2) return 'Merged';
    if (h.approaching) return h.passages === 1 ? 'Falling back' : 'Falling back again';
    return h.passages === 1 ? 'After first pass' : `Pass ${h.passages}`;
  }

  function render() {
    const keys = mode === 'compare' ? ['WITH HALOS', 'NO HALOS'] : [''];
    const cells = [];
    keys.forEach((k, i) => {
      const h = hist[i]; if (!h) return;
      const tag = k ? `${k} · ` : '';
      cells.push({ label: `${tag}SEPARATION`, value: h.sep !== undefined ? h.sep.toFixed(1) : '—' });
      cells.push({ label: `${tag}STAGE`, value: phase(h) });
    });
    if (hist[0]) cells.push({ label: 'TURNS OF GALAXY A', value: (hist[0].rot ?? 0).toFixed(1), wide: true });
    $('#collide-readouts').innerHTML = readoutHTML(cells);
    sparkline($('#collide-chart'), keys.map((_, i) => ({ values: hist[i]?.values || [], color: i ? '#e6adbc' : '#daf57c' })),
      { xMax: Math.max(4, ...hist.map((h) => h?.rot || 0)), xLabel: 'TURNS OF GALAXY A', yLabel: 'DISTANCE BETWEEN CENTRES (DISK SCALE LENGTHS)' });
  }

  function launch() {
    hist = [];
    mode = $('#collide-halos').value;
    const geo = $('#collide-geometry').value;
    const base = {
      massRatio: Number($('#collide-ratio').value),
      pericentre: Number($('#collide-peri').value),
      inclinationB: geo === 'retrograde' ? 180 : geo === 'tilted' ? 60 : 0,
      quality: small ? 'low' : 'medium',
    };
    const configs = mode === 'compare'
      ? [{ kind: 'collision', options: { ...base, halos: 'live' } }, { kind: 'collision', options: { ...base, halos: 'none' } }]
      : [{ kind: 'collision', options: { ...base, halos: mode } }];
    stage.start(configs, mode === 'compare' ? ['WITH DARK-MATTER HALOS', 'WITHOUT HALOS'] : [mode === 'live' ? 'WITH DARK-MATTER HALOS' : 'WITHOUT HALOS']);
    $('#collide-note').textContent = mode === 'compare'
      ? 'Same disks, same starting orbit. Left: each galaxy has a live dark-matter halo. Right: disks and bulges only. Tick “Show dark matter” to see the halos.'
      : mode === 'live' ? 'Each galaxy sits in a live dark-matter halo made of particles. Tick “Show dark matter” to see them.' : 'Disks and bulges only, no dark matter.';
    $('#collide-status').textContent = 'Building both galaxies…';
    render();
  }
  $('#collide-launch').addEventListener('click', () => { launch(); stage.setPaused(false); syncPause(); });
  $('#collide-showdm').addEventListener('change', (e) => stage.setShowHalo(e.target.checked));

  let started = false;
  return {
    enter() { if (!started) { started = true; launch(); } else stage.setPaused(false); syncPause(); },
    leave() { stage.setPaused(true); syncPause(); },
  };
}

// ---------- wiring ----------
for (const b of $$('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
const initial = location.hash.slice(1);
setMode(MODES.includes(initial) ? initial : 'lab', { push: false });
window.addEventListener('hashchange', () => setMode(location.hash.slice(1) || 'lab', { push: false }));

import { loadSparc, findGalaxy, vBaryonSq, PROFILES, modelV, chi2, fitHalo, accelerationAt, score, CHALLENGES } from './sparc.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const MYR_PER_UNIT = 977.79;           // 1 kpc / (km/s) in Myr
const STORE = 'galaxy-sandbox:challenges';
const HUBBLE = ['S0', 'Sa', 'Sab', 'Sb', 'Sbc', 'Sc', 'Scd', 'Sd', 'Sdm', 'Sm', 'Im', 'BCD'];

function loadProgress() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
function saveProgress(p) { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* storage unavailable */ } }

function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

export async function createRealController(section) {
  const status = $('#real-status');
  status.textContent = 'Loading 175 galaxies…';
  const data = await loadSparc();
  const galaxies = data.galaxies;
  const challengeNames = new Set(CHALLENGES.map((c) => c.name));

  // ---------- state ----------
  let g = null, profile = 'iso', params = {}, ml = 0.5, field = 'observed', challenge = false, revealed = false;
  let progress = loadProgress();
  let best = {};                         // cache: `${name}|${profile}|${ml}` -> fit

  // ---------- galaxy picker ----------
  const sel = $('#real-galaxy');
  const chal = CHALLENGES.filter((c) => findGalaxy(data, c.name));
  sel.innerHTML = `<optgroup label="Challenges">${chal.map((c) => `<option value="${c.name}">${c.name} · ${'●'.repeat(c.difficulty)}${'○'.repeat(3 - c.difficulty)} ${c.title || ''}</option>`).join('')}</optgroup>`
    + `<optgroup label="All 175 galaxies">${galaxies.map((x) => x.name).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((n) => `<option value="${n}">${n}</option>`).join('')}</optgroup>`;

  // ---------- star field ----------
  const canvas = $('#real-canvas'), ctx = canvas.getContext('2d');
  let stars = [], time = 0, paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let yaw = 0.3, tilt = 1.0, zoom = 1, drag = null, width = 0, height = 0, raf = 0, last = 0, visible = true, dirty = true;
  let accTable = null, rMaxScene = 10, rStart = 0;

  function buildAccTable() {
    const rTop = rMaxScene * 4;
    const n = 600, rs = new Float64Array(n), as = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = (rTop * (i + 0.5)) / n; rs[i] = r;
      as[i] = field === 'model'
        ? accelerationAt(g, r, 'model', { profile, params, ml: { disk: ml, bulge: 1.4 * ml } })
        : accelerationAt(g, r, field, { ml: { disk: ml, bulge: 1.4 * ml } });
    }
    accTable = { rs, as, rTop };
  }
  function acc(r) {
    const t = accTable; const x = Math.min(r, t.rTop) / t.rTop * t.rs.length - 0.5;
    const i = Math.max(0, Math.min(t.rs.length - 2, Math.floor(x))), f = Math.max(0, Math.min(1, x - i));
    const a = t.as[i] * (1 - f) + t.as[i + 1] * f;
    return r > t.rTop ? a * (t.rTop / r) ** 2 : a;   // beyond the table: point-mass fall-off
  }

  function seedStars() {
    const Rd = g.Rdisk > 0 ? g.Rdisk : g.R[g.R.length - 1] / 4;
    const rLast = g.R[g.R.length - 1];
    rMaxScene = rLast * 1.15;
    let seed = 12345 + g.name.length * 97;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const N = matchMedia('(max-width: 700px)').matches ? 900 : 1500;
    stars = [];
    const nGas = Math.round(N * 0.4);
    while (stars.length < N) {
      // 60% stars: exponential disk (r = -Rd ln(u1 u2)); 40% gas tracers spread evenly in radius out to the
      // last measured point, where the gas (HI) is what the outer rotation curve is measured from.
      const gas = stars.length < nGas;
      const r = gas ? g.R[0] + (rLast - g.R[0]) * rnd() : -Rd * Math.log(Math.max(1e-9, rnd() * rnd()));
      if (r > rLast || r < g.R[0] * 0.5) continue;
      const a = rnd() * Math.PI * 2;
      const v = interp(r, g.R, g.Vobs);
      stars.push({ x: Math.cos(a) * r, y: (rnd() - 0.5) * 0.08 * Rd, z: Math.sin(a) * r, vx: -Math.sin(a) * v, vy: 0, vz: Math.cos(a) * v, r0: r, gas });
    }
    time = 0;
    rStart = median(stars.map((s) => s.r0));
  }
  function median(a) { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] || 0; }

  function stepStars(dtTotal) {
    // leapfrog in units kpc, km/s; dt in kpc/(km/s)
    const rLast = g.R[g.R.length - 1], vRef = g.Vobs[g.Vobs.length - 1] || 50;
    const dtMax = 0.02 * rLast / vRef;
    let n = Math.ceil(dtTotal / dtMax); n = Math.min(n, 40);
    const dt = dtTotal / n;
    for (let k = 0; k < n; k++) for (const s of stars) {
      let r = Math.hypot(s.x, s.y, s.z) || 1e-6, a = acc(r) / r;
      s.vx -= a * s.x * dt / 2; s.vy -= a * s.y * dt / 2; s.vz -= a * s.z * dt / 2;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      r = Math.hypot(s.x, s.y, s.z) || 1e-6; a = acc(r) / r;
      s.vx -= a * s.x * dt / 2; s.vy -= a * s.y * dt / 2; s.vz -= a * s.z * dt / 2;
    }
    time += dtTotal;
  }

  function project(x, y, z) {
    const xx = x * Math.cos(yaw) - z * Math.sin(yaw), zz = x * Math.sin(yaw) + z * Math.cos(yaw);
    const yy = y * Math.cos(tilt) - zz * Math.sin(tilt);
    const s = Math.min(width, height) / (2.2 * rMaxScene) * zoom;
    return [width / 2 + xx * s, height / 2 + yy * s, s];
  }
  function draw() {
    if (!ctx || !width || !height || !g) return;
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#07100d'; ctx.fillRect(0, 0, width, height);
    // last measured radius
    ctx.strokeStyle = '#b898d340'; ctx.setLineDash([3, 6]); ctx.beginPath();
    const rLast = g.R[g.R.length - 1];
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; const [px, py] = project(Math.cos(a) * rLast, 0, Math.sin(a) * rLast); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke(); ctx.setLineDash([]);
    const [lx, ly] = project(rLast, 0, 0);
    ctx.fillStyle = '#b898d3aa'; ctx.font = '9px ui-monospace,monospace'; { const t = 'LAST MEASURED RADIUS', tw = ctx.measureText(t).width; ctx.fillText(t, lx + 6 + tw > width - 6 ? Math.max(6, lx - 6 - tw) : lx + 6, ly - 4); }
    ctx.globalCompositeOperation = 'lighter';
    const sz = Math.max(1.2, Math.min(2.4, Math.min(width, height) / 280));
    for (const s of stars) {
      const [px, py] = project(s.x, s.y, s.z);
      if (px < -4 || px > width + 4 || py < -4 || py > height + 4) continue;
      const r = Math.hypot(s.x, s.z);
      ctx.fillStyle = r > rLast * 1.05 ? '#e6adbc' : s.gas ? '#9fd5e7' : r < (g.Rdisk || 1) ? '#f4e8b4' : '#d6e7c2';
      ctx.globalAlpha = s.gas ? 0.6 : 0.85; ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#d4e9a5'; ctx.font = '10px ui-monospace,monospace';
    ctx.fillText(`${g.name.toUpperCase()} · ${({ observed: 'MEASURED SPEEDS', baryons: 'STARS AND GAS ONLY', model: 'YOUR MODEL' })[field]}`, 18, 24);
    ctx.fillStyle = '#a3b99b'; ctx.fillText(`${(time * MYR_PER_UNIT).toFixed(0)} MILLION YEARS`, 18, 40);
    dirty = false;
  }
  function running() { return !paused && visible && !document.hidden && !section.hidden; }
  function loop(now) {
    raf = 0; const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
    if (running() && g) {
      const rLast = g.R[g.R.length - 1], vLast = g.Vobs[g.Vobs.length - 1] || 50;
      const period = 2 * Math.PI * rLast / vLast;          // outer orbit, kpc/(km/s)
      stepStars(dt * period / 8);                            // one outer orbit per 8 s
      dirty = true;
      if ((now | 0) % 6 === 0) updateNote();
    }
    if (dirty) draw();
    if (running() || dirty) request(); else last = 0;
  }
  function request() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop); }
  function updateNote() {
    const rLast = g.R[g.R.length - 1];
    const radii = stars.map((s) => Math.hypot(s.x, s.z));
    const out = radii.filter((r) => r > rLast * 1.25).length / stars.length;
    $('#real-note').textContent = `Median star radius ${median(radii).toFixed(1)} kpc (started at ${rStart.toFixed(1)}). `
      + `${(100 * out).toFixed(0)}% of stars have drifted well beyond the last measured point.`
      + (field === 'baryons' ? ' Stars keep their measured speeds, but only the visible mass pulls on them.' : '');
  }

  canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw, tilt }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id) return; yaw = drag.yaw + (e.clientX - drag.x) * 0.006; tilt = Math.max(0.15, Math.min(Math.PI / 2, drag.tilt + (e.clientY - drag.y) * 0.006)); dirty = true; request(); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('keydown', (e) => {
    const k = e.key; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', ' '].includes(k)) return; e.preventDefault();
    if (k === 'ArrowLeft') yaw -= 0.12; if (k === 'ArrowRight') yaw += 0.12;
    if (k === 'ArrowUp') tilt = Math.min(Math.PI / 2, tilt + 0.1); if (k === 'ArrowDown') tilt = Math.max(0.15, tilt - 0.1);
    if (k === '+' || k === '=') zoom = Math.min(3, zoom * 1.12); if (k === '-') zoom = Math.max(0.3, zoom / 1.12);
    if (k === ' ' && !e.repeat) { paused = !paused; syncButtons(); last = 0; }
    dirty = true; request();
  });
  $('[data-cam=face]', section).addEventListener('click', (e) => { tilt = tilt > 1.4 ? 1.0 : Math.PI / 2; e.currentTarget.textContent = tilt > 1.4 ? 'Tilt the view' : 'Face-on'; dirty = true; request(); });
  $('[data-cam=in]', section).addEventListener('click', () => { zoom = Math.min(3, zoom * 1.18); dirty = true; request(); });
  $('[data-cam=out]', section).addEventListener('click', () => { zoom = Math.max(0.3, zoom / 1.18); dirty = true; request(); });
  new ResizeObserver(() => { const b = canvas.getBoundingClientRect(); width = b.width; height = b.height; const r = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(width * r); canvas.height = Math.round(height * r); ctx?.setTransform(r, 0, 0, r, 0, 0); dirty = true; request(); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; last = 0; if (visible) { dirty = true; request(); } }, { rootMargin: '80px' }).observe(canvas);

  // ---------- field + playback ----------
  function setField(f) {
    field = f; buildAccTable();
    for (const b of $$('[data-field]', section)) b.setAttribute('aria-pressed', b.dataset.field === f);
    const words = { observed: 'The field that the measured speeds imply. Stars stay on their orbits.', baryons: 'Only the stars and gas pull. The stars keep their measured speeds.', model: 'The field from your halo plus the stars and gas.' };
    status.textContent = words[f];
    updateNote(); dirty = true; request();
  }
  for (const b of $$('[data-field]', section)) b.addEventListener('click', () => setField(b.dataset.field));
  const pauseBtn = $('[data-act=pause]', section);
  function syncButtons() { pauseBtn.textContent = paused ? 'Play' : 'Pause'; }
  pauseBtn.addEventListener('click', () => { paused = !paused; last = 0; syncButtons(); request(); });
  $('[data-act=restart]', section).addEventListener('click', () => { seedStars(); updateNote(); dirty = true; request(); });

  // ---------- fitting panel ----------
  function fitKey(p = profile) { return `${g.name}|${p}|${ml.toFixed(2)}`; }
  function bestFit(p = profile) { const k = fitKey(p); return best[k] || (best[k] = fitHalo(g, p, { ml: { disk: ml, bulge: 1.4 * ml } })); }

  function buildSliders() {
    const wrap = $('#real-sliders');
    wrap.innerHTML = PROFILES[profile].params.map((p) => {
      const v = params[p.key] ?? p.default;
      const toS = (x) => (p.log ? Math.log10(x) : x);
      return `<label class="slider"><span>${p.label}${p.unit ? ` (${p.unit})` : ''} <output data-out="${p.key}"></output></span><input type="range" data-param="${p.key}" min="${toS(p.min)}" max="${toS(p.max)}" step="${p.log ? 0.005 : (p.max - p.min) / 400}" value="${toS(v)}"></label>`;
    }).join('');
    for (const inp of $$('[data-param]', wrap)) inp.addEventListener('input', () => {
      const p = PROFILES[profile].params.find((q) => q.key === inp.dataset.param);
      params[p.key] = p.log ? 10 ** Number(inp.value) : Number(inp.value);
      update();
    });
  }
  function fmt(x) {
    if (Math.abs(x) >= 1e4 || (x !== 0 && Math.abs(x) < 0.01)) { const e = Math.floor(Math.log10(Math.abs(x))); return `${(x / 10 ** e).toFixed(1)}×10${String(e).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`; }
    return Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
  }

  function update({ refit = false } = {}) {
    for (const p of PROFILES[profile].params) { const o = $(`[data-out="${p.key}"]`, section); if (o) o.textContent = fmt(params[p.key]); }
    $('#real-ml-out').textContent = ml.toFixed(2);
    const vm = modelV(g, { profile, params, ml: { disk: ml, bulge: 1.4 * ml } });
    const c = chi2(g, vm);
    const sc = score(c.chi2r);
    const starsHtml = '★'.repeat(sc.stars) + `<i>${'★'.repeat(3 - sc.stars)}</i>`;
    $('#real-score').innerHTML = `<div><small>FIT TO THE DATA · χ² PER POINT</small><strong>${c.chi2r.toFixed(2)}</strong></div><div class="stars" aria-label="${sc.stars} of 3 stars">${starsHtml}</div>`;
    drawCurve(vm);
    if (field === 'model') { buildAccTable(); }
    if (challenge && chal.some((x) => x.name === g.name)) {
      const prev = progress[g.name] || 0;
      if (sc.stars > prev) { progress[g.name] = sc.stars; saveProgress(progress); }
      if (sc.stars === 3 && !revealed) status.textContent = `Solved: ${sc.label}. Try another challenge, or press “Show best fit” to compare with the optimiser.`;
    }
    renderProgress();
    $('#real-best').textContent = challenge && (progress[g.name] || 0) < 3 && !revealed ? 'Reveal best fit' : 'Show best fit';
  }

  function drawCurve(vm) {
    const svg = $('#real-curve'), W = 360, H = 250, L = 40, R = 10, T = 14, B = 34;
    const rMax = g.R[g.R.length - 1] * 1.08;
    const vb2 = vBaryonSq(g, { disk: ml, bulge: 1.4 * ml });
    const n = 140, rr = Float64Array.from({ length: n }, (_, i) => rMax * (i + 1) / n);
    const vh = PROFILES[profile].vHalo(rr, params);
    const vbFine = rr.map((r) => interp(r, g.R, Array.from(vb2)));
    const vMax = Math.max(...g.Vobs.map((v, i) => v + (g.eV[i] || 0)), ...vh, ...vm) * 1.12;
    const X = (r) => L + (r / rMax) * (W - L - R), Y = (v) => T + (H - T - B) * (1 - Math.min(v, vMax) / vMax);
    let s = '';
    for (let i = 0; i <= 4; i++) { const v = (vMax * i) / 4; s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#34492b" stroke-width=".7"/><text x="${L - 5}" y="${Y(v) + 3}" fill="#9daf90" font-size="9" text-anchor="end">${v.toFixed(0)}</text>`; }
    for (let i = 0; i <= 4; i++) { const r = (rMax * i) / 4; s += `<text x="${X(r)}" y="${H - B + 14}" fill="#9daf90" font-size="9" text-anchor="middle">${r.toFixed(r < 10 ? 1 : 0)}</text>`; }
    const path = (xs, ys, color, w = 2, dash = '') => `<path d="${xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(Math.max(ys[i], 0)).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    s += path(Array.from(rr), Array.from(vh), '#9b84c8', 1.6);
    s += path(Array.from(rr), Array.from(vbFine, (v2) => Math.sqrt(Math.max(v2, 0))), '#cda2c0', 1.6, '5 4');
    const tot = Array.from(rr, (r, i) => Math.sqrt(Math.max(vbFine[i] + vh[i] ** 2, 0)));
    s += path(Array.from(rr), tot, '#daf57c', 2.4);
    g.R.forEach((r, i) => {
      const v = g.Vobs[i], e = g.eV[i] || 0;
      s += `<line x1="${X(r)}" x2="${X(r)}" y1="${Y(v - e)}" y2="${Y(v + e)}" stroke="#edf0df" stroke-width="1"/><circle cx="${X(r)}" cy="${Y(v)}" r="2.4" fill="#edf0df"/>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<g font-family="ui-monospace,monospace">${s}<text x="${(L + W - R) / 2}" y="${H - 6}" fill="#9daf90" font-size="9" text-anchor="middle">RADIUS · KPC</text><text x="${L}" y="9" fill="#9daf90" font-size="9">SPEED · KM/S</text></g>`;
  }

  function renderProgress() {
    if (!challenge) { $('#challenge-progress').textContent = ''; return; }
    const solved = chal.filter((c) => (progress[c.name] || 0) >= 3).length;
    const starsTot = chal.reduce((a, c) => a + (progress[c.name] || 0), 0);
    const c = chal.find((x) => x.name === g.name);
    $('#challenge-progress').textContent = `CHALLENGES · ${solved} OF ${chal.length} SOLVED · ${starsTot} OF ${chal.length * 3} STARS`
      + (c ? ` · THIS ONE: ${c.why}${c.profileHint ? ` HINT: ${PROFILES[c.profileHint].short || c.profileHint} HALOS FIT WELL.` : ''}` : ' · PICK A CHALLENGE GALAXY FROM THE TOP OF THE LIST');
  }

  function setProfile(p, { keep = false } = {}) {
    profile = p; $('#real-profile').value = p;
    if (!keep) { params = {}; for (const q of PROFILES[p].params) params[q.key] = q.default; }
    buildSliders(); update();
  }

  function setGalaxy(name) {
    g = findGalaxy(data, name); revealed = false; sel.value = name;
    const hint = CHALLENGES.find((c) => c.name === g.name);
    ml = hint?.mlHint ?? 0.5; $('#real-ml').value = ml;
    const T = HUBBLE[g.T] ?? `T=${g.T}`;
    $('#real-info').innerHTML = `<b>${g.name}</b> · ${T} · ${g.D} Mpc away · ${g.R.length} measured points out to ${g.R[g.R.length - 1].toFixed(1)} kpc`
      + (g.Vflat ? ` · flat speed ${g.Vflat} km/s` : '') + (challengeNames.has(g.name) ? ` · <b>challenge</b>` : '');
    seedStars(); setField(field); setProfile(profile);
    if (!challenge) applyBest();
    status.textContent = challenge ? 'Move the sliders until your total (lime) runs through the measured points.' : status.textContent;
    updateNote();
  }
  function applyBest() {
    const f = bestFit();
    params = { ...f.params }; buildSliders(); update();
  }

  $('#real-profile').addEventListener('change', (e) => setProfile(e.target.value));
  $('#real-ml').addEventListener('input', (e) => { ml = Number(e.target.value); if (field !== 'observed') buildAccTable(); update(); });
  $('#real-best').addEventListener('click', () => {
    if (challenge && (progress[g.name] || 0) < 3 && !revealed) { revealed = true; status.textContent = 'Best fit revealed. This galaxy keeps the stars you had already earned.'; }
    applyBest();
  });
  $('#real-nohalo').addEventListener('click', () => {
    for (const q of PROFILES[profile].params) params[q.key] = q.min;
    buildSliders(); update();
    status.textContent = 'Halo at its minimum. This is roughly what the stars and gas alone can do.';
  });
  sel.addEventListener('change', () => setGalaxy(sel.value));
  $('#real-challenge').addEventListener('change', (e) => {
    challenge = e.target.checked;
    if (challenge) { if (!challengeNames.has(g.name)) setGalaxy(chal[0].name); else { setProfile(profile); } status.textContent = 'Challenge: fit each galaxy to three stars without peeking.'; }
    else applyBest();
    renderProgress(); update();
  });

  setGalaxy(chal[0]?.name || galaxies[0].name);
  status.textContent = 'Press “Stars and gas only” to take the dark matter away.';
  syncButtons();
  return {
    enter() { last = 0; dirty = true; request(); },
    leave() { last = 0; },
  };
}

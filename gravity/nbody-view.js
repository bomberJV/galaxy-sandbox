/**
 * Renderer and worker driver for the self-gravitating modes.
 * One stage can show one or two panels side by side; each panel runs its own worker.
 * Particles are drawn as additive points; dark-matter particles are optional.
 */

const COLORS = [
  ['#d6e7c2', 0.85],  // 0 disk A
  ['#f4e8b4', 0.95],  // 1 bulge A
  ['#9b84c8', 0.22],  // 2 halo A
  ['#e9c7dd', 0.85],  // 3 disk B
  ['#f6d7b6', 0.95],  // 4 bulge B
  ['#b78bc4', 0.22],  // 5 halo B
];
const HALO_GROUPS = new Set([2, 5]);

export function createNBodyStage({ canvas, frame = 'origin', viewRadius = 7, rate = (info) => info.tRot / 6, onFrame, onReady, onError }) {
  const ctx = canvas.getContext('2d');
  const stage = canvas.closest('.stage') || canvas.parentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let panels = [];               // {worker, n, group, pos, info, time, waiting, label, centre}
  let paused = motion.matches, speed = 1, showHalo = false;
  let yaw = 0.35, tilt = 0.95, zoom = 1, drag = null;
  let width = 0, height = 0, visible = true, raf = 0, last = 0, dirty = true;
  const bg = Array.from({ length: 90 }, (_, i) => [((i * 7919) % 997) / 997, ((i * 104729) % 991) / 991, ((i * 31) % 17) / 17]);

  function layout() {
    if (panels.length < 2) return [{ x: 0, y: 0, w: width, h: height }];
    return width < 560
      ? [{ x: 0, y: 0, w: width, h: height / 2 }, { x: 0, y: height / 2, w: width, h: height / 2 }]
      : [{ x: 0, y: 0, w: width / 2, h: height }, { x: width / 2, y: 0, w: width / 2, h: height }];
  }

  function start(configs, labels = []) {
    stop();
    panels = configs.map((cfg, i) => {
      const worker = new Worker(new URL('./nbody-worker.js', import.meta.url), { type: 'module' });
      const p = { worker, n: 0, group: null, pos: null, info: null, time: 0, waiting: false, label: labels[i] || '', centre: [0, 0, 0], ready: false };
      worker.onmessage = (e) => receive(p, i, e.data);
      worker.onerror = (e) => { onError?.(e.message || 'The simulation worker failed to start.'); };
      worker.postMessage({ type: 'init', kind: cfg.kind, options: cfg.options || {} });
      return p;
    });
    dirty = true; last = 0; request();
  }

  function stop() {
    for (const p of panels) p.worker.terminate();
    panels = [];
  }

  function receive(p, i, msg) {
    if (msg.type === 'ready') {
      p.n = msg.n; p.group = msg.group; p.info = msg.info; p.ready = true; p.time = 0;
      p.pos = msg.pos || null;
      onReady?.(i, msg);
      p.waiting = false; dirty = true; request();
      if (!p.pos) { p.waiting = true; p.worker.postMessage({ type: 'tick', simDt: 0, budgetMs: 4 }); }
    } else if (msg.type === 'frame') {
      p.pos = msg.pos; p.time = msg.time; p.waiting = false;
      if (msg.stats?.centres?.length) p.centre = frameCentre(msg.stats.centres);
      onFrame?.(i, msg, p.info);
      dirty = true; request();
    } else if (msg.type === 'error') {
      onError?.(msg.message);
    }
  }

  function frameCentre(centres) {
    if (frame === 'origin') return [0, 0, 0];
    if (frame === 'first') return centres[0];
    const c = [0, 0, 0];
    for (const q of centres) { c[0] += q[0] / centres.length; c[1] += q[1] / centres.length; c[2] += q[2] / centres.length; }
    return c;
  }

  function project(x, y, z, box, c) {
    x -= c[0]; y -= c[1]; z -= c[2];
    const xx = x * Math.cos(yaw) - z * Math.sin(yaw), zz = x * Math.sin(yaw) + z * Math.cos(yaw);
    const yy = y * Math.cos(tilt) - zz * Math.sin(tilt);
    const s = Math.min(box.w, box.h) / (2.1 * viewRadius) * zoom;
    return [box.x + box.w / 2 + xx * s, box.y + box.h / 2 + yy * s];
  }

  function draw() {
    if (!ctx || !width || !height) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#07100d'; ctx.fillRect(0, 0, width, height);
    const boxes = layout();
    panels.forEach((p, i) => {
      const box = boxes[i] || boxes[0];
      ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      for (const [x, y, a] of bg) { ctx.fillStyle = `rgba(169,189,176,${0.08 + a * 0.2})`; ctx.fillRect(box.x + x * box.w, box.y + y * box.h, 1, 1); }
      if (p.pos && p.group) {
        ctx.globalCompositeOperation = 'lighter';
        const s = Math.max(1, Math.min(2.2, Math.min(box.w, box.h) / 300)) * (p.n > 4000 ? 0.9 : 1.15);
        for (let g = 0; g < COLORS.length; g++) {
          if (HALO_GROUPS.has(g) && !showHalo) continue;
          const [color, alpha] = COLORS[g];
          ctx.fillStyle = color; ctx.globalAlpha = alpha * (p.n > 4000 ? 0.75 : 1);
          const pos = p.pos, grp = p.group;
          for (let k = 0; k < p.n; k++) {
            if (grp[k] !== g) continue;
            const [px, py] = project(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2], box, p.centre);
            if (px < box.x - 2 || px > box.x + box.w + 2 || py < box.y - 2 || py > box.y + box.h + 2) continue;
            ctx.fillRect(px - s / 2, py - s / 2, s, s);
          }
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillStyle = '#8fa98a'; ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'center';
        ctx.fillText('BUILDING THE GALAXY…', box.x + box.w / 2, box.y + box.h / 2);
        ctx.textAlign = 'left';
      }
      if (p.label) {
        ctx.fillStyle = i ? '#e4bdd8' : '#d4e9a5'; ctx.font = '10px ui-monospace,monospace';
        ctx.fillText(p.label, box.x + 18, box.y + 24);
      }
      ctx.restore();
    });
    if (panels.length > 1) {
      ctx.strokeStyle = '#78946377'; ctx.lineWidth = 1; ctx.beginPath();
      if (width < 560) { ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); } else { ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); }
      ctx.stroke();
    }
    dirty = false;
  }

  function running() { return !paused && visible && !document.hidden; }

  function loop(now) {
    raf = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
    if (running()) {
      for (const p of panels) {
        if (!p.ready || p.waiting || !p.info) continue;
        // rate(info) = simulated time units per real second at 1x
        const simDt = dt * speed * rate(p.info);
        if (simDt <= 0) continue;
        p.waiting = true;
        p.worker.postMessage({ type: 'tick', simDt, budgetMs: 12 });
      }
    }
    if (dirty) draw();
    if (running() || dirty) request(); else last = 0;
  }
  function request() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop); }

  // Camera
  canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw, tilt }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    yaw = drag.yaw + (e.clientX - drag.x) * 0.006;
    tilt = Math.max(0.15, Math.min(Math.PI / 2, drag.tilt + (e.clientY - drag.y) * 0.006));
    dirty = true; request();
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', ' '].includes(k)) return;
    e.preventDefault();
    if (k === 'ArrowLeft') yaw -= 0.12; if (k === 'ArrowRight') yaw += 0.12;
    if (k === 'ArrowUp') tilt = Math.min(Math.PI / 2, tilt + 0.1); if (k === 'ArrowDown') tilt = Math.max(0.15, tilt - 0.1);
    if (k === '+' || k === '=') zoom = Math.min(3, zoom * 1.12); if (k === '-') zoom = Math.max(0.3, zoom / 1.12);
    if (k === ' ' && !e.repeat) api.setPaused(!paused);
    dirty = true; request();
  });

  new ResizeObserver(() => {
    const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
    const r = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * r); canvas.height = Math.round(height * r);
    ctx?.setTransform(r, 0, 0, r, 0, 0); dirty = true; request();
  }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; last = 0; if (visible) { dirty = true; request(); } }, { rootMargin: '80px' }).observe(canvas);
  document.addEventListener('visibilitychange', () => { last = 0; if (!document.hidden) { dirty = true; request(); } });

  const api = {
    start, stop,
    get paused() { return paused; },
    setPaused(v) { paused = v; last = 0; dirty = true; request(); },
    setSpeed(v) { speed = v; },
    setShowHalo(v) { showHalo = v; dirty = true; request(); },
    zoomBy(f) { zoom = Math.max(0.3, Math.min(3, zoom * f)); dirty = true; request(); },
    faceOn() { tilt = tilt > 1.4 ? 0.95 : Math.PI / 2; dirty = true; request(); return tilt > 1.4; },
    resetCamera() { yaw = 0.35; tilt = 0.95; zoom = 1; dirty = true; request(); },
    get panels() { return panels; },
  };
  return api;
}

/** Tiny SVG line chart: series = [{values:[[x,y],...], color}] */
export function sparkline(svg, series, { xMax, yMax, xLabel = '', yLabel = '', marks = [] } = {}) {
  const W = 340, H = 200, L = 38, R = 10, T = 18, B = 34;
  const xm = xMax || Math.max(1, ...series.flatMap((s) => s.values.map((v) => v[0])));
  const ym = yMax || Math.max(1e-6, ...series.flatMap((s) => s.values.map((v) => v[1]))) * 1.1;
  const X = (x) => L + (x / xm) * (W - L - R), Y = (y) => T + (H - T - B) * (1 - y / ym);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = (ym * i) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}" stroke="#34492b" stroke-width=".7"/><text x="${L - 6}" y="${Y(y) + 4}" fill="#9daf90" text-anchor="end" font-size="10">${y < 10 ? y.toFixed(2) : y.toFixed(0)}</text>`;
  }
  for (let i = 0; i <= 4; i++) { const x = (xm * i) / 4; g += `<text x="${X(x)}" y="${H - B + 16}" fill="#9daf90" text-anchor="middle" font-size="10">${x.toFixed(x < 10 ? 1 : 0)}</text>`; }
  for (const m of marks) g += `<line x1="${L}" x2="${W - R}" y1="${Y(m.y)}" y2="${Y(m.y)}" stroke="${m.color || '#cda2c0'}" stroke-dasharray="4 5" stroke-width="1"/><text x="${W - R}" y="${Y(m.y) - 5}" fill="${m.color || '#cda2c0'}" text-anchor="end" font-size="9">${m.label}</text>`;
  const paths = series.map((s) => s.values.length ? `<path d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${X(Math.min(v[0], xm)).toFixed(1)},${Y(Math.min(v[1], ym)).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>` : '').join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<g font-family="ui-monospace,monospace">${g}${paths}<text x="${(L + W - R) / 2}" y="${H - 4}" fill="#9daf90" text-anchor="middle" font-size="10">${xLabel}</text><text x="${L}" y="10" fill="#9daf90" font-size="9">${yLabel}</text></g>`;
}

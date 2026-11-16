/**
 * Module worker for the self-gravity and collision experiments.
 *
 * In:  {type:'init', kind:'bar'|'collision', options}
 *      {type:'tick', simDt, budgetMs = 12}   — advance about simDt time units, at most budgetMs of work
 *      {type:'reset'}                         — rebuild from the last init
 * Out: {type:'ready', n, group: Uint8Array, mass: Float32Array, info}
 *      {type:'frame', pos: Float32Array (3n, transferred), time, steps, stepMs, stats, profile?}
 *      {type:'error', message}
 *
 * The main thread sends the next tick only after a frame arrives. Steps use a fixed dt:
 *   bar:       dt = tRot / 300   (energy drift < 0.3% over 3 tRot at 4,000 particles)
 *   collision: dt = 0.05         (set by the compact bulges, not by tRot; < 0.4% of |W| over a merger)
 * When a device cannot keep up within budgetMs, the unfinished part of simDt is dropped, so
 * simulated time slows down instead of taking larger, less accurate steps.
 *
 * stats: {A2 (bar strength of galaxy A inside 1.5 Rd), energyDrift ((E − E0)/|W0|),
 *         centres: [[x, y, z] per galaxy]}; profile (every 10th frame): rotationProfile of galaxy A.
 */
import { createNBody, barStrength, centreOf, rotationProfile } from './nbody.js';
import { makeBarExperiment, makeCollision } from './ics.js';

export const SETTINGS = {
  bar: { theta: 1.0, softening: 0.05, stepsPerRot: 300 },
  collision: { theta: 1.0, softening: 0.05, dt: 0.05 },
};

export function createHandler(post, now = () => performance.now()) {
  let sim = null, ic = null, lastInit = null, dt = 0, backlog = 0, frame = 0, E0 = 0, W0 = 1, galaxies = [];

  function init(msg) {
    lastInit = msg;
    const kind = msg.kind === 'collision' ? 'collision' : 'bar';
    const o = msg.options || {};
    ic = kind === 'bar' ? makeBarExperiment(o.preset || 'none', o) : makeCollision(o);
    const cfg = { ...SETTINGS[kind], ...(o.engine || {}) };
    sim = createNBody(ic, { theta: cfg.theta, softening: cfg.softening });
    dt = kind === 'bar' ? ic.info.tRot / cfg.stepsPerRot : cfg.dt;
    const e = sim.energy();
    E0 = e.total; W0 = Math.abs(e.potential) || 1;
    backlog = 0; frame = 0;
    galaxies = ic.info.galaxies || [{ groups: [0, 1] }];
    post({
      type: 'ready', n: sim.n, group: Uint8Array.from(sim.group), mass: Float32Array.from(sim.mass),
      info: { ...ic.info, kind, dt, theta: cfg.theta, softening: cfg.softening },
    });
  }

  function tick(msg) {
    if (!sim) return post({ type: 'error', message: 'tick before init' });
    const budget = msg.budgetMs ?? 12;
    backlog += Math.max(0, msg.simDt || 0);
    const t0 = now();
    let steps = 0;
    // always take at least one step when time is owed, so a slow device still progresses
    while (backlog >= dt && (steps === 0 || now() - t0 < budget)) { sim.step(dt); backlog -= dt; steps++; }
    if (backlog > dt) backlog = dt * 0.999; // could not keep up: drop the rest
    const elapsed = now() - t0;
    const pos = new Float32Array(sim.pos);
    const e = sim.energy();
    const centres = galaxies.map((g) => centreOf(sim, g.groups, { shrink: 4 }));
    const out = {
      type: 'frame', pos, time: sim.time, steps, stepMs: steps ? elapsed / steps : 0,
      stats: { A2: barStrength(sim, galaxies[0].groups), energyDrift: (e.total - E0) / W0, centres },
    };
    if (frame % 10 === 0) out.profile = rotationProfile(sim, galaxies[0].groups, centres[0], 16, 5);
    frame++;
    post(out, [pos.buffer]);
  }

  return function handle(msg) {
    try {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'init') init(msg);
      else if (msg.type === 'tick') tick(msg);
      else if (msg.type === 'reset') { if (lastInit) init(lastInit); }
    } catch (err) {
      post({ type: 'error', message: String(err && err.message || err) });
    }
  };
}

// Wire up only inside a real worker; importing this module in Node or a page does nothing.
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  const handle = createHandler((m, transfer) => self.postMessage(m, transfer || []));
  self.onmessage = (e) => handle(e.data);
}

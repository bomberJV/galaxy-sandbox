import test from 'node:test';
import assert from 'node:assert/strict';
import { createNBody, barStrength, centreOf, rotationProfile } from '../gravity/nbody.js';
import { makeBarExperiment, makeCollision, makeDisk, makeRandom, BAR_PRESETS } from '../gravity/ics.js';
import { createHandler, SETTINGS } from '../gravity/nbody-worker.js';

function plummer(n, seed = 1) {
  const r = makeRandom(seed);
  const pos = new Float64Array(3 * n), vel = new Float64Array(3 * n), mass = new Float64Array(n).fill(1 / n), group = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.min(r(), 0.99), R = 1 / Math.sqrt(u ** (-2 / 3) - 1);
    const ct = 2 * r() - 1, st = Math.sqrt(1 - ct * ct), p = 2 * Math.PI * r();
    pos[3 * i] = R * st * Math.cos(p); pos[3 * i + 1] = R * ct; pos[3 * i + 2] = R * st * Math.sin(p);
  }
  return { pos, vel, mass, group, fixed: [] };
}

test('tree forces match direct summation (Plummer sphere, 1,000 particles, theta 0.7)', () => {
  const sim = createNBody(plummer(1000), { theta: 0.7, softening: 0.05 });
  sim.computeForces();
  const d = sim.directAccelerations(), err = [];
  for (let i = 0; i < sim.n; i++) {
    const a = Math.hypot(d[3 * i], d[3 * i + 1], d[3 * i + 2]);
    err.push(Math.hypot(sim.acc[3 * i] - d[3 * i], sim.acc[3 * i + 1] - d[3 * i + 1], sim.acc[3 * i + 2] - d[3 * i + 2]) / a);
  }
  err.sort((a, b) => a - b);
  const median = err[err.length >> 1];
  assert.ok(median < 0.01, `median relative error ${median}`);
});

test('the tree potential matches the force (energy gradient check)', () => {
  const sim = createNBody(plummer(300, 3), { theta: 0.5, softening: 0.05 });
  sim.computeForces();
  const i = 17, h = 1e-5, a = [sim.acc[3 * i], sim.acc[3 * i + 1], sim.acc[3 * i + 2]];
  for (let ax = 0; ax < 3; ax++) {
    const x0 = sim.pos[3 * i + ax];
    sim.pos[3 * i + ax] = x0 + h; sim.computeForces(); const up = sim.energy().potential;
    sim.pos[3 * i + ax] = x0 - h; sim.computeForces(); const dn = sim.energy().potential;
    sim.pos[3 * i + ax] = x0;
    const f = -(up - dn) / (2 * h) / sim.mass[i];
    assert.ok(Math.abs(f - a[ax]) < 0.02 * Math.hypot(...a) + 1e-6, `axis ${ax}: ${f} vs ${a[ax]}`);
  }
});

test('energy drift < 1% over 3 tRot and momentum conserved (bar "none", low quality)', () => {
  const ic = makeBarExperiment('none', { quality: 'low', seed: 7 });
  const sim = createNBody(ic, { theta: SETTINGS.bar.theta, softening: SETTINGS.bar.softening });
  const dt = ic.info.tRot / SETTINGS.bar.stepsPerRot;
  const E0 = sim.energy().total, P0 = sim.momentum();
  const steps = 3 * SETTINGS.bar.stepsPerRot;
  for (let s = 0; s < steps; s++) sim.step(dt);
  const drift = Math.abs((sim.energy().total - E0) / E0);
  assert.ok(drift < 0.01, `energy drift ${drift}`);
  const P = sim.momentum(), dp = Math.hypot(P[0] - P0[0], P[1] - P0[1], P[2] - P0[2]);
  // total mass 1, typical speed 0.6: tree forces are not exactly pairwise-symmetric
  assert.ok(dp < 0.01, `momentum change ${dp}`);
});

test('bar instability: a bare disk forms a bar, a halo-dominated disk does not', () => {
  // 4,000 particles: below ~3,000, Poisson noise heats the disk and the bar is weak and intermittent.
  const run = (preset, nDisk, tEnd) => {
    const ic = makeBarExperiment(preset, { nDisk, seed: 7 });
    const sim = createNBody(ic, { theta: SETTINGS.bar.theta, softening: SETTINGS.bar.softening });
    const per = SETTINGS.bar.stepsPerRot, dt = ic.info.tRot / per;
    let peak = 0;
    for (let s = 1; s <= Math.round(tEnd * per); s++) {
      sim.step(dt);
      if (s >= 2 * per && s % (per / 4) === 0) peak = Math.max(peak, barStrength(sim, [0, 1]));
    }
    return { peak, final: barStrength(sim, [0, 1]) };
  };
  const bare = run('none', 4000, 3.5);
  const heavy = run('heavy', 3000, 3.5);
  console.log(`A2 between 2 and 3.5 tRot: none peak ${bare.peak.toFixed(3)} (final ${bare.final.toFixed(3)}), heavy peak ${heavy.peak.toFixed(3)}`);
  assert.ok(bare.peak > 0.2, `no-halo A2 ${bare.peak}`);
  assert.ok(heavy.peak < 0.1, `heavy-halo A2 ${heavy.peak}`);
  assert.ok(BAR_PRESETS.heavy.halo.mass > BAR_PRESETS.light.halo.mass);
});

test('collision: live halos merge; the same encounter without halos does not', () => {
  const counts = { nDisk: 300, nBulge: 60, nHalo: 400 };
  const run = (halos) => {
    const ic = makeCollision({ halos, counts, seed: 11, separation: 16, pericentre: 2 });
    const sim = createNBody(ic, { theta: SETTINGS.collision.theta, softening: SETTINGS.collision.softening });
    const dt = SETTINGS.collision.dt, e0 = sim.energy();
    const dist = () => { const a = centreOf(sim, [0, 1], { shrink: 5 }), b = centreOf(sim, [3, 4], { shrink: 5 }); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    const d0 = dist();
    let dMin = d0, separatedAfterPeri = 0;
    for (let s = 1; s <= Math.round(66 / dt); s++) {
      sim.step(dt);
      if (s % 40 === 0) { const d = dist(); dMin = Math.min(dMin, d); if (dMin < 6) separatedAfterPeri = Math.max(separatedAfterPeri, d); }
    }
    return { d0, dMin, separatedAfterPeri, dEnd: dist(), drift: (sim.energy().total - e0.total) / Math.abs(e0.potential), tPeri: ic.info.tPeri };
  };
  const live = run('live');
  const bare = run('none');
  console.log(`live: d0 ${live.d0.toFixed(1)} min ${live.dMin.toFixed(2)} re-separated ${live.separatedAfterPeri.toFixed(1)} end ${live.dEnd.toFixed(2)} dE/|W| ${(100 * live.drift).toFixed(2)}%`);
  console.log(`none: d0 ${bare.d0.toFixed(1)} min ${bare.dMin.toFixed(2)} end ${bare.dEnd.toFixed(2)} dE/|W| ${(100 * bare.drift).toFixed(2)}%`);
  assert.ok(live.dMin < 6, 'galaxies approach');
  assert.ok(live.separatedAfterPeri > 8, 'they separate again after the first pass');
  assert.ok(live.dEnd < 1, `merged: final separation ${live.dEnd}`);
  assert.ok(bare.dEnd > 20, `without halos they fly apart: ${bare.dEnd}`);
  assert.ok(Math.abs(live.drift) < 0.01 && Math.abs(bare.drift) < 0.01);
});

test('initial disks start near equilibrium and rotate the same way as physics.js', () => {
  const ic = makeDisk({ nDisk: 1500, seed: 4, halo: { mode: 'rigid', mass: 8, scale: 2 } });
  const sim = createNBody(ic, { theta: 0.8 });
  const prof = rotationProfile(sim, [0], [0, 0, 0], 10, 5);
  for (let b = 2; b < 8; b++) {
    const ratio = prof.vMeasured[b] / prof.vCirc[b];
    assert.ok(ratio > 0.8 && ratio < 1.1, `bin ${b}: v/vc ${ratio}`);
  }
  let Ly = 0;
  for (let i = 0; i < sim.n; i++) Ly += sim.mass[i] * (sim.pos[3 * i + 2] * sim.vel[3 * i] - sim.pos[3 * i] * sim.vel[3 * i + 2]);
  assert.ok(Ly < 0, 'spin 1 has angular momentum along -y like physics.js');
  assert.ok(ic.info.tRot > 0 && Number.isFinite(ic.info.tRot));
  assert.deepEqual(makeDisk({ nDisk: 50, seed: 9 }).pos, makeDisk({ nDisk: 50, seed: 9 }).pos);
});

test('worker protocol: ready, frames with transferred positions, budgets, profiles, reset', () => {
  const sent = [];
  let clock = 0;
  const handle = createHandler((m, transfer) => sent.push({ m, transfer }), () => clock);
  handle({ type: 'tick', simDt: 1 });
  assert.equal(sent.at(-1).m.type, 'error');
  handle({ type: 'init', kind: 'bar', options: { preset: 'heavy', nDisk: 400, seed: 2 } });
  const ready = sent.at(-1).m;
  assert.equal(ready.type, 'ready');
  assert.equal(ready.n, 400);
  assert.ok(ready.group instanceof Uint8Array && ready.mass instanceof Float32Array);
  assert.ok(ready.info.dt > 0 && ready.info.tRot > 0 && ready.info.kind === 'bar');
  handle({ type: 'tick', simDt: 3 * ready.info.dt, budgetMs: 1e9 });
  const f = sent.at(-1);
  assert.equal(f.m.type, 'frame');
  assert.equal(f.m.steps, 3);
  assert.ok(f.m.pos instanceof Float32Array && f.m.pos.length === 1200);
  assert.deepEqual(f.transfer, [f.m.pos.buffer]);
  assert.ok(f.m.profile && f.m.profile.r.length === 16, 'first frame carries a rotation profile');
  assert.ok(Number.isFinite(f.m.stats.A2) && Number.isFinite(f.m.stats.energyDrift) && f.m.stats.centres.length === 1);
  // A zero budget still allows one step, and the backlog is dropped rather than carried
  const handle2 = createHandler((m) => sent.push({ m }), () => (clock += 100));
  handle2({ type: 'init', kind: 'bar', options: { preset: 'none', nDisk: 300 } });
  handle2({ type: 'tick', simDt: 1000, budgetMs: 1 });
  assert.equal(sent.at(-1).m.steps, 1);
  const t1 = sent.at(-1).m.time;
  handle2({ type: 'reset' });
  assert.equal(sent.at(-1).m.type, 'ready');
  handle2({ type: 'tick', simDt: 0 });
  assert.equal(sent.at(-1).m.time, 0);
  assert.ok(t1 > 0);
  // collision init carries two galaxy centres
  handle({ type: 'init', kind: 'collision', options: { counts: { nDisk: 60, nBulge: 10, nHalo: 60 } } });
  handle({ type: 'tick', simDt: 0.05 });
  assert.equal(sent.at(-1).m.stats.centres.length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSparc, findGalaxy, vBaryonSq, PROFILES, modelV, chi2, fitHalo, baryonsOnly,
  accelerationAt, vBaryonSqAt, score, CHALLENGES, G,
} from '../gravity/sparc.js';

const data = await loadSparc(new URL('../gravity/sparc-data.json', import.meta.url));

// χ² at disk M/L 0.5, bulge 0.7, 5 km/s floor, from dark-matter-research results/fits.json (analyze.py).
const PAPER = {
  'D631-7': { NFW: 11.8966, Burkert: 2.2653 }, DDO154: { NFW: 2.6957, Burkert: 0.356 },
  DDO161: { NFW: 4.8198, Burkert: 1.4734 }, 'ESO079-G014': { NFW: 22.1253, Burkert: 7.0391 },
  IC2574: { NFW: 15.72, Burkert: 3.3395 }, NGC2403: { NFW: 27.6741, Burkert: 114.9214 },
  NGC2841: { NFW: 73.8079, Burkert: 174.0141 }, NGC3198: { NFW: 18.5759, Burkert: 16.467 },
  NGC6503: { NFW: 8.369, Burkert: 12.631 }, NGC7814: { NFW: 11.9848, Burkert: 6.9338 },
  UGC00128: { NFW: 5.104, Burkert: 17.0745 }, 'F568-3': { NFW: 19.676, Burkert: 6.8158 },
  UGC02885: { NFW: 35.3495, Burkert: 60.2026 }, NGC5055: { NFW: 58.3119, Burkert: 19.7127 },
};

test('data: 175 galaxies with aligned arrays and source attribution', () => {
  assert.equal(data.galaxies.length, 175);
  assert.match(data.source, /Lelli, McGaugh & Schombert 2016/);
  for (const g of data.galaxies) {
    const n = g.R.length;
    assert.ok(n >= 2, g.name);
    for (const k of ['Vobs', 'eV', 'Vgas', 'Vdisk', 'Vbul']) assert.equal(g[k].length, n, `${g.name}.${k}`);
    for (let i = 0; i < n; i++) {
      assert.ok(g.R[i] > 0 && g.Vobs[i] > 0 && g.eV[i] > 0, g.name);
      if (i) assert.ok(g.R[i] > g.R[i - 1], `${g.name} radii increase`);
    }
    assert.ok([1, 2, 3].includes(g.Q));
  }
});

test('data: spot values match the raw SPARC files', () => {
  const d = findGalaxy(data, 'DDO 154');
  assert.equal(d.name, 'DDO154');
  assert.equal(d.R.length, 12);
  assert.deepEqual([d.R[0], d.Vobs[0], d.eV[0], d.Vgas[0], d.Vdisk[0], d.Vbul[0]], [0.49, 13.8, 1.6, 3.74, 12.31, 0]);
  assert.deepEqual([d.R[11], d.Vobs[11], d.eV[11]], [5.92, 45.5, 1.3]);
  assert.equal(d.D, 4.04); assert.equal(d.inc, 64); assert.equal(d.Q, 2); assert.equal(d.T, 10);
  const u = findGalaxy(data, 'UGC 2885');
  assert.equal(u.name, 'UGC02885');
  assert.equal(findGalaxy(data, 'not a galaxy'), null);
});

test('baryons: signed gas term and bulge M/L = 1.4 x disk by default', () => {
  const g = { R: [1], Vgas: [-5], Vdisk: [10], Vbul: [10] };
  assert.equal(vBaryonSq(g, { disk: 0.5 })[0], -25 + 50 + 70);
  assert.equal(vBaryonSq(g)[0], -25 + 50 + 70);
});

test('halo profiles: enclosed-mass speeds match direct numerical integration', () => {
  const dens = {
    nfw: (r, p) => p.rho / ((r / p.rs) * (1 + r / p.rs) ** 2),
    burkert: (r, p) => p.rho / ((1 + r / p.rs) * (1 + (r / p.rs) ** 2)),
    iso: (r, p) => p.rho / (1 + (r / p.rs) ** 2),
  };
  const p = { rho: 2e7, rs: 3 };
  for (const [name, rho] of Object.entries(dens)) {
    for (const r of [0.05, 0.5, 3, 30]) {
      let m = 0; const N = 20000;
      for (let i = 0; i < N; i++) { const x = (i + 0.5) * r / N; m += 4 * Math.PI * x * x * rho(x, p) * r / N; }
      const v = PROFILES[name].vHalo(Float64Array.of(r), p)[0];
      assert.ok(Math.abs(v * v / (G * m / r) - 1) < 2e-4, `${name} at ${r} kpc`);
    }
  }
});

test('fitHalo reproduces the dark-matter-research fits (χ² within 2%)', () => {
  let n = 0;
  for (const [name, ref] of Object.entries(PAPER)) {
    const g = findGalaxy(data, name);
    for (const [prof, key] of [['nfw', 'NFW'], ['burkert', 'Burkert']]) {
      const f = fitHalo(g, prof);
      const rel = (f.chi2 - ref[key]) / ref[key];
      assert.ok(Math.abs(rel) < 0.02, `${name} ${key}: ours ${f.chi2.toFixed(3)} vs paper ${ref[key]}`);
      n++;
    }
  }
  assert.ok(n >= 20);
});

test('fitHalo recovers a noiseless halo', () => {
  const R = Float64Array.from({ length: 30 }, (_, i) => 0.3 + i * 0.7);
  for (const prof of ['nfw', 'burkert', 'iso']) {
    const truth = { rho: 3e7, rs: 4 };
    const v = PROFILES[prof].vHalo(R, truth);
    const z = new Float64Array(R.length);
    const g = { R, Vobs: v, eV: new Float64Array(R.length).fill(1), Vgas: z, Vdisk: z, Vbul: z };
    const f = fitHalo(g, prof, { floor: 0 });
    assert.ok(f.chi2 < 1e-6, prof);
    assert.ok(Math.abs(Math.log10(f.params.rs / truth.rs)) < 0.01, prof);
  }
});

test('challenges: real, clean data; a halo earns 3 stars, visible matter alone earns 0', () => {
  assert.ok(CHALLENGES.length >= 10);
  for (const c of CHALLENGES) {
    const g = findGalaxy(data, c.name);
    assert.ok(g, c.name);
    assert.ok(g.Q <= 2 && g.R.length >= 10, `${c.name} clean`);
    const ml = c.mlHint ? { disk: c.mlHint, bulge: 1.4 * c.mlHint } : undefined;
    const best = Math.min(...['nfw', 'burkert', 'iso'].map((p) => fitHalo(g, p, { ml }).chi2r));
    assert.equal(score(best).stars, 3, `${c.name}: best χ²r ${best.toFixed(2)}`);
    assert.equal(score(baryonsOnly(g).chi2r).stars, 0, `${c.name}: visible matter alone`);
  }
});

test('score thresholds', () => {
  assert.equal(score(0.8).stars, 3);
  assert.equal(score(2).stars, 2);
  assert.equal(score(5).stars, 1);
  assert.equal(score(50).stars, 0);
  assert.equal(score(NaN).stars, 0);
});

test('accelerationAt: positive, continuous at the data edges, Keplerian/flat beyond', () => {
  const fit = (g) => fitHalo(g, 'burkert');
  for (const name of ['DDO154', 'NGC3198', 'NGC2841', 'NGC7814']) {
    const g = findGalaxy(data, name);
    const n = g.R.length, R0 = g.R[0], Rn = g.R[n - 1];
    const f = fit(g);
    for (const which of ['observed', 'baryons', 'model']) {
      const opts = { profile: 'burkert', params: f.params };
      for (const r of [0.01, R0 * 0.5, R0, (R0 + Rn) / 2, Rn, Rn * 2, Rn * 10]) {
        assert.ok(accelerationAt(g, r, which, opts) >= 0, `${name} ${which} ${r}`);
      }
      const lo = accelerationAt(g, Rn * (1 - 1e-7), which, opts), hi = accelerationAt(g, Rn * (1 + 1e-7), which, opts);
      assert.ok(Math.abs(lo / hi - 1) < 1e-5, `${name} ${which} continuous at last point`);
      const a0 = accelerationAt(g, R0 * (1 - 1e-7), which, opts), a1 = accelerationAt(g, R0 * (1 + 1e-7), which, opts);
      assert.ok(Math.abs(a0 / a1 - 1) < 1e-5 || Math.abs(a0 - a1) < 1e-3, `${name} ${which} continuous at first point`);
    }
    // Observed: flat speed beyond the data. Baryons: Keplerian (v^2 ∝ 1/r).
    const vObs = (r) => Math.sqrt(accelerationAt(g, r, 'observed') * r);
    assert.ok(Math.abs(vObs(Rn * 3) / g.Vobs[n - 1] - 1) < 1e-9);
    const vb = (r) => vBaryonSqAt(g, r);
    if (vb(Rn) > 0) assert.ok(Math.abs(vb(Rn * 4) / vb(Rn) - 0.25) < 1e-9);
  }
  // The model with a fitted halo tracks the observed curve inside the data.
  const g = findGalaxy(data, 'NGC3198');
  const f = fitHalo(g, 'iso');
  const v = modelV(g, { profile: 'iso', params: f.params });
  assert.ok(chi2(g, v).chi2r < 1.5);
});

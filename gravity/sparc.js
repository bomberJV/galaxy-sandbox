/**
 * Real galaxies from SPARC (Lelli, McGaugh & Schombert 2016, AJ 152, 157).
 *
 * Mass models follow the dark-matter-research analysis (analyze.py) exactly:
 *   - baryons: Vgas|Vgas| + ml.disk Vdisk^2 + ml.bulge Vbul^2 (signed gas term),
 *     baseline disk M/L 0.5 and bulge M/L 0.7 (= 1.4 x disk);
 *   - halo speeds from enclosed mass, G = 4.30091e-6 kpc (km/s)^2 / Msun;
 *   - halo parameters: central/characteristic density rho (Msun/kpc^3) and scale radius rs (kpc),
 *     fitted in log10 space within 1e3 <= rho <= 1e11 and 10^-1.5 <= rs <= 10^2.5;
 *   - uncertainties: errV combined in quadrature with a 5 km/s floor.
 * Units: R in kpc, speeds in km/s, accelerations in km^2 s^-2 kpc^-1.
 */

export const G = 4.30091e-6;
export const ERROR_FLOOR = 5;
export const DEFAULT_ML = Object.freeze({ disk: 0.5, bulge: 0.7 });
const LOG_BOUNDS = [[3, 11], [-1.5, 2.5]]; // [log10 rho, log10 rs], as in the research fits

export async function loadSparc(url = new URL('./sparc-data.json', import.meta.url)) {
  let raw;
  if (typeof window === 'undefined' && String(url).startsWith('file:')) {
    const { readFile } = await import('node:fs/promises');
    raw = JSON.parse(await readFile(new URL(url), 'utf8'));
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load SPARC data (${res.status})`);
    raw = await res.json();
  }
  const galaxies = raw.galaxies.map((g) => ({
    ...g,
    R: Float64Array.from(g.R), Vobs: Float64Array.from(g.Vobs), eV: Float64Array.from(g.eV),
    Vgas: Float64Array.from(g.Vgas), Vdisk: Float64Array.from(g.Vdisk), Vbul: Float64Array.from(g.Vbul),
  }));
  return { galaxies, source: raw.source, note: raw.note };
}

const norm = (s) => String(s).toUpperCase().replace(/[\s_]/g, '');
export function findGalaxy(data, name) {
  const key = norm(name);
  const list = data.galaxies || data;
  return list.find((g) => norm(g.name) === key)
    // tolerate "NGC 2403" vs "NGC2403" and "UGC 2885" vs "UGC02885"
    || list.find((g) => norm(g.name).replace(/^([A-Z]+)0+/, '$1') === key.replace(/^([A-Z]+)0+/, '$1'))
    || null;
}

export function vBaryonSq(g, ml = DEFAULT_ML) {
  const n = g.R.length, out = new Float64Array(n);
  const md = ml.disk ?? DEFAULT_ML.disk, mb = ml.bulge ?? 1.4 * md;
  for (let i = 0; i < n; i++) out[i] = g.Vgas[i] * Math.abs(g.Vgas[i]) + md * g.Vdisk[i] ** 2 + mb * g.Vbul[i] ** 2;
  return out;
}

// Enclosed-mass shape functions f(x), with small-x series as in analyze.py.
function massNFW(x) { return x < 1e-3 ? x * x / 2 - 2 * x ** 3 / 3 + 3 * x ** 4 / 4 : Math.log1p(x) - x / (1 + x); }
function massBurkert(x) {
  return x < 1e-3 ? 4 * x ** 3 / 3 - x ** 4 + 4 * x ** 7 / 7 - x ** 8 / 2
    : 2 * Math.log1p(x) + Math.log1p(x * x) - 2 * Math.atan(x);
}
function massIso(x) { return x < 1e-3 ? x ** 3 / 3 - x ** 5 / 5 : x - Math.atan(x); }

function makeV(massFn, prefactor) {
  return (R, p) => {
    const n = R.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = R[i];
      if (!(r > 0)) { out[i] = 0; continue; }
      const m = prefactor * Math.PI * p.rho * p.rs ** 3 * massFn(r / p.rs);
      out[i] = Math.sqrt(Math.max(G * m / r, 0));
    }
    return out;
  };
}

const PARAMS = [
  { key: 'rho', label: 'Density', unit: 'M☉/kpc³', min: 1e3, max: 1e11, log: true, default: 1e7 },
  { key: 'rs', label: 'Scale radius', unit: 'kpc', min: 10 ** -1.5, max: 10 ** 2.5, log: true, default: 5 },
];

export const PROFILES = Object.freeze({
  nfw: {
    label: 'NFW (cuspy)', short: 'NFW',
    description: 'The profile cold-dark-matter simulations predict: density keeps rising toward the centre.',
    params: PARAMS.map((p) => ({ ...p, label: p.key === 'rho' ? 'Characteristic density' : p.label })),
    vHalo: makeV(massNFW, 4),
  },
  burkert: {
    label: 'Burkert (cored)', short: 'Burkert',
    description: 'A halo with a flat-density core, often preferred by dwarf galaxies.',
    params: PARAMS.map((p) => ({ ...p, label: p.key === 'rho' ? 'Core density' : 'Core radius' })),
    vHalo: makeV(massBurkert, 1),
  },
  iso: {
    label: 'Pseudo-isothermal (cored)', short: 'Isothermal',
    description: 'The classic flat-rotation-curve halo: constant-density core, density falling as r⁻² outside it.',
    params: PARAMS.map((p) => ({ ...p, label: p.key === 'rho' ? 'Core density' : 'Core radius' })),
    vHalo: makeV(massIso, 4),
  },
});

export function vHaloSq(R, profile, params) {
  if (!profile || profile === 'none') return new Float64Array(R.length);
  const v = PROFILES[profile].vHalo(R, params);
  return v.map((x) => x * x);
}

export function modelV(g, { profile = 'none', params = {}, ml = DEFAULT_ML } = {}) {
  const b = vBaryonSq(g, ml), h = vHaloSq(g.R, profile, params);
  return b.map((x, i) => Math.sqrt(Math.max(x + h[i], 0)));
}

export function chi2(g, vModel, { floor = ERROR_FLOOR, nParams = 2 } = {}) {
  let c = 0;
  for (let i = 0; i < g.R.length; i++) {
    const err = Math.sqrt(g.eV[i] ** 2 + floor ** 2);
    c += ((vModel[i] - g.Vobs[i]) / err) ** 2;
  }
  const dof = Math.max(g.R.length - nParams, 1);
  return { chi2: c, dof, chi2r: c / dof };
}

// --- fitting --------------------------------------------------------------

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

function nelderMead(f, x0, { step = 0.3, iters = 400, tol = 1e-10 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; simplex.push(x); }
  let vals = simplex.map(f);
  for (let k = 0; k < iters; k++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = idx.map((i) => simplex[i]); vals = idx.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol * (1 + Math.abs(vals[0]))) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const pt = (t) => c.map((cj, j) => cj + t * (simplex[n][j] - cj));
    const xr = pt(-1), fr = f(xr);
    if (fr < vals[0]) {
      const xe = pt(-2), fe = f(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = fr < vals[n] ? pt(-0.5) : pt(0.5), fc = f(xc);
      if (fc < Math.min(fr, vals[n])) { simplex[n] = xc; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = f(simplex[i]); }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], f: vals[best] };
}

export function fitHalo(g, profile, { ml = DEFAULT_ML, floor = ERROR_FLOOR } = {}) {
  const vb2 = vBaryonSq(g, ml);
  const err2 = Array.from(g.eV, (e) => e * e + floor * floor);
  const V = PROFILES[profile].vHalo;
  const objective = (lp) => {
    const p = { rho: 10 ** clamp(lp[0], LOG_BOUNDS[0]), rs: 10 ** clamp(lp[1], LOG_BOUNDS[1]) };
    const vh = V(g.R, p);
    let c = 0;
    for (let i = 0; i < vh.length; i++) {
      const m = Math.sqrt(Math.max(vb2[i] + vh[i] * vh[i], 1e-12));
      c += (m - g.Vobs[i]) ** 2 / err2[i];
    }
    // Gentle wall outside the bounds so the simplex returns inside them.
    const out = Math.max(0, LOG_BOUNDS[0][0] - lp[0], lp[0] - LOG_BOUNDS[0][1]) + Math.max(0, LOG_BOUNDS[1][0] - lp[1], lp[1] - LOG_BOUNDS[1][1]);
    return c + 1e6 * out * out;
  };
  // Coarse log-space grid, then Nelder–Mead from the three best grid cells.
  const cells = [];
  for (let a = 0; a <= 32; a++) {
    for (let b = 0; b <= 32; b++) {
      const lp = [LOG_BOUNDS[0][0] + (a / 32) * 8, LOG_BOUNDS[1][0] + (b / 32) * 4];
      cells.push([objective(lp), lp]);
    }
  }
  cells.sort((x, y) => x[0] - y[0]);
  let best = null;
  for (const [, lp] of cells.slice(0, 3)) {
    let r = nelderMead(objective, lp, { step: 0.25 });
    r = nelderMead(objective, r.x, { step: 0.05 });
    if (!best || r.f < best.f) best = r;
  }
  const lp = [clamp(best.x[0], LOG_BOUNDS[0]), clamp(best.x[1], LOG_BOUNDS[1])];
  const params = { rho: 10 ** lp[0], rs: 10 ** lp[1] };
  const c = chi2(g, modelV(g, { profile, params, ml }), { floor, nParams: 2 });
  const atBound = lp.some((v, i) => v - LOG_BOUNDS[i][0] < 0.015 || LOG_BOUNDS[i][1] - v < 0.015);
  return { profile, params, logParams: lp, ...c, atBound };
}

export function baryonsOnly(g, { ml = DEFAULT_ML, floor = ERROR_FLOOR } = {}) {
  return chi2(g, modelV(g, { profile: 'none', ml }), { floor, nParams: 0 });
}

// --- forces for animation -------------------------------------------------

function interp(R, Y, r) {
  const n = R.length;
  if (r <= R[0]) return Y[0];
  if (r >= R[n - 1]) return Y[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R[mid] <= r) lo = mid; else hi = mid; }
  const t = (r - R[lo]) / (R[hi] - R[lo]);
  return Y[lo] + t * (Y[hi] - Y[lo]);
}

/** Baryonic V^2 at any radius: interpolated inside the data, solid-body inside the first point, Keplerian beyond the last. */
const VB2_CACHE = new WeakMap();
function cachedVb2(g, ml) {
  const key = `${ml.disk ?? DEFAULT_ML.disk}|${ml.bulge ?? ''}`;
  let entry = VB2_CACHE.get(g);
  if (!entry || entry.key !== key) { entry = { key, b: vBaryonSq(g, ml) }; VB2_CACHE.set(g, entry); }
  return entry.b;
}

export function vBaryonSqAt(g, r, ml = DEFAULT_ML) {
  const b = cachedVb2(g, ml);
  const R = g.R, n = R.length;
  if (r <= R[0]) return b[0] * (r / R[0]) ** 2;
  if (r >= R[n - 1]) return b[n - 1] * R[n - 1] / r;
  return interp(R, b, r);
}

/**
 * Inward acceleration (km^2 s^-2 kpc^-1) at radius r for:
 *  'observed' — interpolated Vobs^2/r; solid body inside the first point; flat Vobs beyond the last.
 *  'baryons'  — visible matter only (see vBaryonSqAt), never negative.
 *  'model'    — baryons + opts.profile halo with opts.params at opts.ml.
 */
export function accelerationAt(g, r, which = 'observed', opts = {}) {
  r = Math.max(r, 1e-4);
  const ml = opts.ml ?? DEFAULT_ML;
  const R = g.R, n = R.length;
  let v2;
  if (which === 'observed') {
    if (r <= R[0]) v2 = g.Vobs[0] ** 2 * (r / R[0]) ** 2;
    else if (r >= R[n - 1]) v2 = g.Vobs[n - 1] ** 2;
    else v2 = interp(R, g.Vobs, r) ** 2;
  } else if (which === 'baryons') {
    v2 = vBaryonSqAt(g, r, ml);
  } else if (which === 'model') {
    v2 = vBaryonSqAt(g, r, ml) + vHaloSq(Float64Array.of(r), opts.profile, opts.params)[0];
  } else throw new Error(`unknown field ${which}`);
  return Math.max(v2, 0) / r;
}

// --- scoring and challenges ----------------------------------------------

export function score(chi2r) {
  if (!(chi2r >= 0)) return { stars: 0, label: 'No fit' };
  if (chi2r <= 1.5) return { stars: 3, label: 'Within the errors' };
  if (chi2r <= 3) return { stars: 2, label: 'Close' };
  if (chi2r <= 8) return { stars: 1, label: 'Right shape, wrong amounts' };
  return { stars: 0, label: 'Does not match' };
}

export const CHALLENGES = Object.freeze([
  { name: 'NGC3198', title: 'NGC 3198: the flat curve', difficulty: 1, profileHint: 'iso',
    why: 'The galaxy whose flat rotation curve made the dark-matter case in the 1980s. Stars and gas fall short beyond a few kiloparsecs.' },
  { name: 'NGC6503', title: 'NGC 6503: textbook spiral', difficulty: 1, profileHint: 'nfw',
    why: 'Rises quickly, then stays flat for 20 kpc. A clean, well-sampled disk galaxy.' },
  { name: 'NGC2403', title: 'NGC 2403: a nearby Scd', difficulty: 1, profileHint: 'burkert',
    why: 'Seventy-three measured radii, small errors. Every bump in the curve counts against a sloppy halo.' },
  { name: 'DDO154', title: 'DDO 154: almost all dark', difficulty: 2, profileHint: 'burkert',
    why: 'A gas-rich dwarf. Stars and gas supply only a small part of the gravity; the halo does nearly everything.' },
  { name: 'IC2574', title: 'IC 2574: the slow riser', difficulty: 2, profileHint: 'burkert',
    why: 'The speed keeps climbing almost to the edge. Cuspy halos rise too fast at the centre; a core is easier.' },
  { name: 'F568-3', title: 'F568-3: low surface brightness', difficulty: 2, profileHint: 'burkert',
    why: 'A faint, diffuse disk. Its visible matter is spread thin, so the halo dominates even near the centre.' },
  { name: 'UGC00128', title: 'UGC 128: big and dim', difficulty: 2, profileHint: 'iso',
    why: 'As wide as a bright spiral but with a fraction of the stars. A classic low-surface-brightness test.' },
  { name: 'NGC7814', title: 'NGC 7814: the bulge', difficulty: 3, profileHint: 'nfw',
    why: 'An edge-on galaxy dominated by its central bulge. Here the visible matter does most of the work inside, and the halo must not overshoot.' },
  { name: 'NGC2841', title: 'NGC 2841: the heavyweight', difficulty: 3, profileHint: 'nfw',
    why: 'Speeds near 300 km/s. A massive bulge and disk leave less room for the halo than you might expect.' },
  { name: 'UGC02885', title: 'UGC 2885: the giant', difficulty: 3, profileHint: 'nfw', mlHint: 0.7,
    why: 'One of the largest spirals known, measured out past 70 kpc. No halo fits well at the default star mass; it needs heavier stars (M/L near 0.7).' },
]);

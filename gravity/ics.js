/**
 * Initial conditions for the self-gravity and collision experiments.
 * G = 1; disk mass 1 and exponential scale length Rd = 1 set the units.
 * Disk plane is x–z, y is "up"; spin = 1 rotates the same way as physics.js
 * (angular momentum along −y).
 *
 * Velocities come from the realised particles: the in-plane circular speed is
 * measured from the actual tree field (plus any rigid halo), so the disk starts
 * close to equilibrium even with Poisson noise. Disk dispersions follow
 * Hernquist (1993): σ_R ∝ exp(−R/2Rd), normalised to Toomre Q at R = 2.4 Rd;
 * σ_φ from the epicyclic ratio; σ_z from the sech² vertical profile; mean
 * rotation corrected for asymmetric drift. Spheroids (bulge, live halo) use
 * isotropic Gaussian velocities from the spherical Jeans equation.
 */
import { createNBody } from './nbody.js';

export function makeRandom(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  let u = rand();
  while (u <= 1e-12) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const DISK_RMAX = 5;     // disk truncation, in Rd
const HALO_UMAX = 0.9;   // live Hernquist halo keeps 90% of its formal mass profile (r < 18.5 a)
const BULGE_UMAX = 0.95;

export const QUALITY = {
  // particles in one bar-experiment disk, and per galaxy in a collision
  low: { nDisk: 2500, coll: { nDisk: 500, nBulge: 100, nHalo: 650 } },
  medium: { nDisk: 4000, coll: { nDisk: 900, nBulge: 150, nHalo: 950 } },
  high: { nDisk: 6000, coll: { nDisk: 1400, nBulge: 200, nHalo: 1400 } },
};

/**
 * One disk galaxy. Returns ic = {pos, vel, mass, group, fixed, info}.
 * Groups: 0 disk, 1 bulge, 2 halo (live), offset by `groupOffset`.
 */
export function makeDisk({
  nDisk = 3000, nBulge = 0, diskMass = 1, Rd = 1, z0 = 0.1, Q = 1.2,
  bulgeMass = 0, bulgeScale = 0.2,
  halo = { mode: 'none' },
  seed = 1, centre = [0, 0, 0], velocity = [0, 0, 0], spin = 1, tilt = [0, 0],
  groupOffset = 0, softening = 0.05,
} = {}) {
  const rand = makeRandom(seed);
  const nHalo = halo.mode === 'live' ? (halo.nHalo || 0) : 0;
  if (!(bulgeMass > 0)) nBulge = 0;
  const n = nDisk + nBulge + nHalo;
  const pos = new Float64Array(3 * n), vel = new Float64Array(3 * n), mass = new Float64Array(n), group = new Uint8Array(n);
  const fixed = [];
  if (halo.mode === 'rigid') fixed.push({ type: 'hernquist', mass: halo.mass, scale: halo.scale, centre: [0, 0, 0] });

  // ---- positions ----
  const rDiskMax = DISK_RMAX * Rd;
  let p = 0;
  for (let i = 0; i < nDisk; i++, p++) {
    let R;
    do { R = -Rd * Math.log(rand() * rand() + 1e-300); } while (R > rDiskMax);
    const ph = 2 * Math.PI * rand();
    let u = 2 * rand() - 1; u = Math.max(-0.999999, Math.min(0.999999, u));
    pos[3 * p] = R * Math.cos(ph); pos[3 * p + 1] = z0 * Math.atanh(u); pos[3 * p + 2] = R * Math.sin(ph);
    mass[p] = diskMass / nDisk; group[p] = groupOffset;
  }
  const sphere = (count, M, a, umax, g) => {
    for (let i = 0; i < count; i++, p++) {
      const su = Math.sqrt(rand() * umax);
      const r = a * su / (1 - su);
      const ct = 2 * rand() - 1, st = Math.sqrt(1 - ct * ct), ph = 2 * Math.PI * rand();
      pos[3 * p] = r * st * Math.cos(ph); pos[3 * p + 1] = r * ct; pos[3 * p + 2] = r * st * Math.sin(ph);
      mass[p] = M / count; group[p] = g;
    }
  };
  if (nBulge) sphere(nBulge, bulgeMass, bulgeScale, BULGE_UMAX, groupOffset + 1);
  if (nHalo) sphere(nHalo, halo.mass, halo.scale, HALO_UMAX, groupOffset + 2);

  // ---- measured circular speed in the plane (tree field of these particles + rigid halo) ----
  const probe = createNBody({ pos, vel, mass, group, fixed }, { theta: 0.6, softening });
  probe.computeForces();
  let rOuter = rDiskMax * 1.5;
  for (let i = 0; i < n; i++) rOuter = Math.max(rOuter, Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]));
  const K = 96, rMin = 0.02 * Rd;
  const grid = new Float64Array(K), vc2 = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const r = rMin * Math.pow(rOuter / rMin, k / (K - 1));
    grid[k] = r;
    let aR = 0;
    for (let a = 0; a < 12; a++) {
      const ph = (a / 12) * 2 * Math.PI, ux = Math.cos(ph), uz = Math.sin(ph);
      const f = probe.fieldAt(r * ux, 0, r * uz);
      aR += f[0] * ux + f[2] * uz;
    }
    vc2[k] = Math.max(0, -aR / 12 * r);
  }
  // light smoothing in log r to suppress Poisson noise
  const sm = Float64Array.from(vc2);
  for (let k = 1; k < K - 1; k++) sm[k] = 0.25 * vc2[k - 1] + 0.5 * vc2[k] + 0.25 * vc2[k + 1];
  const interp = (arr, r) => {
    if (r <= grid[0]) return arr[0] * r / grid[0];
    if (r >= grid[K - 1]) return arr[K - 1] * grid[K - 1] / r; // Keplerian beyond the grid (for vc²)
    const t = Math.log(r / rMin) / Math.log(rOuter / rMin) * (K - 1), k = Math.floor(t), f = t - k;
    return arr[k] * (1 - f) + arr[k + 1] * f;
  };
  const vcAt = (r) => Math.sqrt(Math.max(0, interp(sm, r)));
  // Ω², κ² on the grid
  const kappa2 = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
    const om2 = (r, v2) => v2 / (r * r);
    const d = (om2(grid[k1], sm[k1]) - om2(grid[k0], sm[k0])) / (grid[k1] - grid[k0]);
    kappa2[k] = Math.max(1e-9, grid[k] * d + 4 * om2(grid[k], sm[k]));
  }
  const kappaAt = (r) => Math.sqrt(Math.max(1e-9, r <= grid[0] ? kappa2[0] : r >= grid[K - 1] ? kappa2[K - 1] * Math.pow(grid[K - 1] / r, 3) : interp(kappa2, r)));

  // ---- disk velocities ----
  const sigmaSurf = (R) => diskMass / (2 * Math.PI * Rd * Rd) * Math.exp(-R / Rd);
  const Rq = 2.4 * Rd;
  const sigmaRq = Q * 3.36 * sigmaSurf(Rq) / kappaAt(Rq);
  const sigma0 = sigmaRq * Math.exp(Rq / (2 * Rd));
  for (let i = 0; i < nDisk; i++) {
    const x = pos[3 * i], z = pos[3 * i + 2], R = Math.hypot(x, z);
    const vc = vcAt(R), Om = vc / Math.max(R, 1e-6), kap = kappaAt(R);
    let sR = sigma0 * Math.exp(-R / (2 * Rd));
    sR = Math.min(sR, 0.8 * vc + 1e-6);
    const ratio = Math.min(1, (kap * kap) / (4 * Om * Om + 1e-12));
    const sPhi = sR * Math.sqrt(ratio);
    const sZ = Math.sqrt(Math.PI * sigmaSurf(R) * z0);
    const vphi2 = vc * vc + sR * sR * (1 - ratio - 2 * R / Rd);
    const vphi = Math.sqrt(Math.max(0, vphi2)) + sPhi * gaussian(rand);
    const vR = sR * gaussian(rand);
    const cph = R > 0 ? x / R : 1, sph = R > 0 ? z / R : 0;
    // spin = 1: tangential direction (−sinφ, cosφ) in (x, z), as in physics.js
    vel[3 * i] = vR * cph - spin * vphi * sph;
    vel[3 * i + 1] = sZ * gaussian(rand);
    vel[3 * i + 2] = vR * sph + spin * vphi * cph;
  }

  // ---- spheroid velocities: isotropic Jeans, σ²(r) = (1/ρ) ∫_r^∞ ρ vc²/r' dr' ----
  const jeansSigma = (M, a) => {
    const rho = (r) => M * a / (2 * Math.PI * r * Math.pow(r + a, 3));
    const s2 = new Float64Array(K);
    let integ = 0;
    for (let k = K - 1; k >= 0; k--) {
      if (k < K - 1) {
        const r0 = grid[k], r1 = grid[k + 1];
        integ += 0.5 * (rho(r0) * sm[k] / r0 + rho(r1) * sm[k + 1] / r1) * (r1 - r0);
      }
      s2[k] = integ / rho(grid[k]);
    }
    return (r) => Math.sqrt(Math.max(0, interp(s2, Math.max(r, grid[0]))));
  };
  const spheroidVel = (start, count, M, a) => {
    const sig = jeansSigma(M, a);
    for (let i = start; i < start + count; i++) {
      const r = Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      const s = sig(r);
      // escape-speed cap keeps the sample bound
      const vesc = Math.sqrt(2 * Math.max(0, -probe.fieldAt(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2])[3]));
      let vx, vy, vz;
      do { vx = s * gaussian(rand); vy = s * gaussian(rand); vz = s * gaussian(rand); }
      while (vx * vx + vy * vy + vz * vz > 0.9 * vesc * vesc && s > 0);
      vel[3 * i] = vx; vel[3 * i + 1] = vy; vel[3 * i + 2] = vz;
    }
  };
  if (nBulge) spheroidVel(nDisk, nBulge, bulgeMass, bulgeScale);
  if (nHalo) spheroidVel(nDisk + nBulge, nHalo, halo.mass, halo.scale);

  // remove net momentum of the live components so the galaxy does not drift
  {
    let px = 0, py = 0, pz = 0, m = 0;
    for (let i = 0; i < n; i++) { px += mass[i] * vel[3 * i]; py += mass[i] * vel[3 * i + 1]; pz += mass[i] * vel[3 * i + 2]; m += mass[i]; }
    if (!fixed.length && m > 0) for (let i = 0; i < n; i++) { vel[3 * i] -= px / m; vel[3 * i + 1] -= py / m; vel[3 * i + 2] -= pz / m; }
  }

  // ---- tilt (about x, then about z), then place ----
  const [tx, tz] = tilt;
  if (tx || tz) {
    const cx = Math.cos(tx), sx = Math.sin(tx), cz = Math.cos(tz), sz = Math.sin(tz);
    const rot = (arr, o) => {
      let x = arr[o], y = arr[o + 1], z = arr[o + 2];
      [y, z] = [cx * y - sx * z, sx * y + cx * z];
      [x, y] = [cz * x - sz * y, sz * x + cz * y];
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
    };
    for (let i = 0; i < n; i++) { rot(pos, 3 * i); rot(vel, 3 * i); }
  }
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) { pos[3 * i + d] += centre[d]; vel[3 * i + d] += velocity[d]; }
  for (const f of fixed) f.centre = [...centre];

  const vc22 = vcAt(2.2 * Rd);
  const curve = { r: [], vc: [] };
  for (let k = 0; k < K; k += 3) if (grid[k] <= 3 * rDiskMax) { curve.r.push(grid[k]); curve.vc.push(Math.sqrt(sm[k])); }
  return {
    pos, vel, mass, group, fixed,
    info: {
      tRot: 2 * Math.PI * 2.2 * Rd / vc22,
      vc22,
      Rd,
      components: { disk: nDisk, bulge: nBulge, halo: nHalo, haloMode: halo.mode || 'none' },
      masses: { disk: diskMass, bulge: nBulge ? bulgeMass : 0, halo: halo.mode && halo.mode !== 'none' ? halo.mass : 0 },
      sigmaR_at_2p4: sigmaRq,
      curve,
      notes: 'Velocities from the measured in-plane field; Hernquist (1993) disk dispersions; isotropic Jeans spheroids.',
    },
  };
}

/** Rigid-halo presets for the bar-instability experiment (Ostriker & Peebles 1973). */
export const BAR_PRESETS = {
  none: {
    label: 'No halo', Q: 1.2, z0: 0.1, halo: { mode: 'none' },
    description: 'A self-gravitating disk on its own. Within a few rotations it buckles into a bar.',
  },
  light: {
    label: 'Light halo', Q: 1.2, z0: 0.1, halo: { mode: 'rigid', profile: 'hernquist', mass: 2, scale: 3 },
    description: 'A modest halo: the disk still dominates inside 2.2 Rd, and a bar still forms.',
  },
  heavy: {
    label: 'Heavy halo', Q: 1.2, z0: 0.1, halo: { mode: 'rigid', profile: 'hernquist', mass: 8, scale: 2 },
    description: 'The halo dominates inside 2.2 Rd. The disk stays round, with only loose spiral arms.',
  },
};

/** Bar experiment. Groups: 0 disk (no bulge by default). */
export function makeBarExperiment(preset = 'none', { quality = 'high', seed = 7, nDisk } = {}) {
  const p = BAR_PRESETS[preset];
  if (!p) throw new Error(`unknown preset ${preset}`);
  const N = nDisk || (QUALITY[quality] || QUALITY.high).nDisk;
  const ic = makeDisk({ nDisk: N, Q: p.Q, z0: p.z0, halo: p.halo, seed });
  ic.info.kind = 'bar';
  ic.info.preset = preset;
  ic.info.galaxies = [{ groups: [0, 1], label: 'Disk' }];
  return ic;
}

function concatICs(parts) {
  const n = parts.reduce((s, q) => s + q.mass.length, 0);
  const pos = new Float64Array(3 * n), vel = new Float64Array(3 * n), mass = new Float64Array(n), group = new Uint8Array(n);
  let o = 0;
  const fixed = [];
  for (const q of parts) {
    pos.set(q.pos, 3 * o); vel.set(q.vel, 3 * o); mass.set(q.mass, o); group.set(q.group, o);
    o += q.mass.length; fixed.push(...q.fixed);
  }
  return { pos, vel, mass, group, fixed };
}

/**
 * Two disk galaxies on a parabolic encounter in the x–z plane.
 * Groups: 0 disk A, 1 bulge A, 2 halo A, 3 disk B, 4 bulge B, 5 halo B.
 *
 * The orbit is always computed for the halo-included masses, so `halos: 'none'`
 * keeps exactly the same starting positions and velocities and removes only the
 * halos: the same encounter, without dark matter. Galaxy A spins prograde with
 * respect to the orbit (long tidal tails); B is inclined by `inclinationB` degrees.
 */
export function makeCollision({
  massRatio = 1, pericentre = 2, separation = 18, inclinationB = 60,
  halos = 'live', quality = 'high', seed = 11, haloMass = 5, haloScale = 3,
  counts = null,
} = {}) {
  const q = counts || (QUALITY[quality] || QUALITY.high).coll;
  const withHalo = halos === 'live';
  const base = { diskMass: 1, Rd: 1, bulgeMass: 0.15, bulgeScale: 0.2, Q: 1.3, z0: 0.08 };
  const mA = base.diskMass + base.bulgeMass + haloMass * HALO_UMAX;
  const mB = massRatio * mA;
  const M = mA + mB;
  // relative orbit: parabola with pericentre q at separation d, approaching (true anomaly f < 0)
  const d = separation, qp = pericentre, pp = 2 * qp;
  const cosf = Math.min(1, Math.max(-1, pp / d - 1)), f = -Math.acos(cosf);
  const rel = [d * Math.cos(f), 0, d * Math.sin(f)];
  const h = Math.sqrt(M / pp);
  let relV = [-h * Math.sin(f), 0, h * (1 + Math.cos(f))];
  // spin = 1 has angular momentum along −y; make the orbit match it (prograde for A)
  const Ly = rel[2] * relV[0] - rel[0] * relV[2];
  if (Ly > 0) { rel[2] = -rel[2]; relV[2] = -relV[2]; }
  const cA = rel.map((v) => -v * mB / M), cB = rel.map((v) => v * mA / M);
  const vA = relV.map((v) => -v * mB / M), vB = relV.map((v) => v * mA / M);
  const scaleB = Math.sqrt(massRatio);
  const halo = (mass, scale, nH) => (withHalo ? { mode: 'live', profile: 'hernquist', mass, scale, nHalo: nH } : { mode: 'none' });
  const A = makeDisk({
    nDisk: q.nDisk, nBulge: q.nBulge, ...base, halo: halo(haloMass * HALO_UMAX, haloScale, q.nHalo),
    seed, centre: cA, velocity: vA, spin: 1, tilt: [0, 0], groupOffset: 0,
  });
  const B = makeDisk({
    nDisk: q.nDisk, nBulge: q.nBulge, diskMass: base.diskMass * massRatio, Rd: base.Rd * scaleB,
    bulgeMass: base.bulgeMass * massRatio, bulgeScale: base.bulgeScale * scaleB, Q: base.Q, z0: base.z0 * scaleB,
    halo: halo(haloMass * HALO_UMAX * massRatio, haloScale * scaleB, q.nHalo),
    seed: seed + 1000, centre: cB, velocity: vB, spin: 1, tilt: [(inclinationB * Math.PI) / 180, 0], groupOffset: 3,
  });
  const ic = concatICs([A, B]);
  // time to pericentre on the parabola (Barker's equation): t = sqrt(p³/M) (D + D³/3)/2, D = tan(f/2)
  const D = Math.tan(-f / 2);
  const tPeri = Math.sqrt(pp * pp * pp / M) * (D + D * D * D / 3) / 2;
  ic.info = {
    kind: 'collision', tRot: A.info.tRot, vc22: A.info.vc22, Rd: 1,
    tPeri, separation: d, pericentre: qp, halos, orbitMass: M,
    galaxies: [{ groups: [0, 1], label: 'Galaxy A', curve: A.info.curve }, { groups: [3, 4], label: 'Galaxy B', curve: B.info.curve }],
    components: { A: A.info.components, B: B.info.components },
    notes: 'Parabolic orbit for the halo-included masses; halos "none" keeps the same positions and velocities.',
  };
  return ic;
}

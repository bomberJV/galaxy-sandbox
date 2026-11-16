/**
 * Self-gravitating N-body engine: Barnes–Hut octree with monopole moments,
 * Plummer softening and a kick–drift–kick leapfrog. G = 1, dimensionless units.
 * Disk plane is x–z and y is "up", matching physics.js.
 *
 * The tree is rebuilt every force evaluation. All node data lives in flat typed
 * arrays; the force walk uses an explicit integer stack, so the hot loop allocates
 * nothing. Optional analytic "fixed" potentials (rigid halos) are added on top.
 */

const LEAF_SIZE = 16;
const MAX_DEPTH = 48;

export function createNBody(ic, { theta = 0.7, softening = 0.05 } = {}) {
  const n = ic.mass.length;
  const pos = Float64Array.from(ic.pos);
  const vel = Float64Array.from(ic.vel);
  const mass = Float64Array.from(ic.mass);
  const group = Uint8Array.from(ic.group);
  const fixed = (ic.fixed || []).map((f) => ({ ...f, centre: [...(f.centre || [0, 0, 0])] }));
  const acc = new Float64Array(3 * n);
  const phi = new Float64Array(n);       // potential from the particles (no self term)
  const phiExt = new Float64Array(n);    // potential from fixed components
  const eps2 = softening * softening;
  const theta2 = theta * theta;

  // ---- tree storage (grown on demand) ----
  let cap = Math.max(64, 2 * n);
  let nMass, nX, nY, nZ, nSize2, nStart, nCount, nLeaf, nChild, nQ;
  function alloc(c) {
    cap = c;
    nQ = new Float64Array(6 * cap); // traceless quadrupole about the centre of mass: xx, xy, xz, yy, yz, zz
    nMass = new Float64Array(cap); nX = new Float64Array(cap); nY = new Float64Array(cap); nZ = new Float64Array(cap);
    nSize2 = new Float64Array(cap); nStart = new Int32Array(cap); nCount = new Int32Array(cap);
    nLeaf = new Uint8Array(cap); nChild = new Int32Array(8 * cap);
  }
  alloc(cap);
  const perm = new Int32Array(n);
  const tmp = new Int32Array(n);
  const oct = new Uint8Array(n);
  const stack = new Int32Array(8 * MAX_DEPTH + 64);
  let nNodes = 0;
  let treeValid = false;

  function newNode() {
    if (nNodes >= cap) {
      const old = { nMass, nX, nY, nZ, nSize2, nStart, nCount, nLeaf, nChild, nQ };
      alloc(cap * 2);
      nQ.set(old.nQ);
      nMass.set(old.nMass); nX.set(old.nX); nY.set(old.nY); nZ.set(old.nZ); nSize2.set(old.nSize2);
      nStart.set(old.nStart); nCount.set(old.nCount); nLeaf.set(old.nLeaf); nChild.set(old.nChild);
    }
    const k = nNodes++;
    for (let c = 0; c < 8; c++) nChild[8 * k + c] = -1;
    return k;
  }

  function buildNode(start, end, cx, cy, cz, h, depth) {
    const k = newNode();
    nSize2[k] = 4 * h * h; // (side length)^2
    if (end - start <= LEAF_SIZE || depth >= MAX_DEPTH) {
      nLeaf[k] = 1; nStart[k] = start; nCount[k] = end - start;
      let m = 0, x = 0, y = 0, z = 0;
      for (let q = start; q < end; q++) {
        const i = perm[q], mi = mass[i];
        m += mi; x += mi * pos[3 * i]; y += mi * pos[3 * i + 1]; z += mi * pos[3 * i + 2];
      }
      nMass[k] = m;
      if (m > 0) { nX[k] = x / m; nY[k] = y / m; nZ[k] = z / m; } else { nX[k] = cx; nY[k] = cy; nZ[k] = cz; }
      let qxx = 0, qxy = 0, qxz = 0, qyy = 0, qyz = 0, qzz = 0;
      for (let q = start; q < end; q++) {
        const i = perm[q], mi = mass[i];
        const dx = pos[3 * i] - nX[k], dy = pos[3 * i + 1] - nY[k], dz = pos[3 * i + 2] - nZ[k], r2 = dx * dx + dy * dy + dz * dz;
        qxx += mi * (3 * dx * dx - r2); qxy += mi * 3 * dx * dy; qxz += mi * 3 * dx * dz;
        qyy += mi * (3 * dy * dy - r2); qyz += mi * 3 * dy * dz; qzz += mi * (3 * dz * dz - r2);
      }
      const o6 = 6 * k;
      nQ[o6] = qxx; nQ[o6 + 1] = qxy; nQ[o6 + 2] = qxz; nQ[o6 + 3] = qyy; nQ[o6 + 4] = qyz; nQ[o6 + 5] = qzz;
      return k;
    }
    nLeaf[k] = 0; nStart[k] = start; nCount[k] = end - start;
    const counts = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let q = start; q < end; q++) {
      const i = perm[q];
      const o = (pos[3 * i] > cx ? 1 : 0) | (pos[3 * i + 1] > cy ? 2 : 0) | (pos[3 * i + 2] > cz ? 4 : 0);
      oct[q] = o; counts[o]++;
    }
    const offs = [start, 0, 0, 0, 0, 0, 0, 0];
    for (let c = 1; c < 8; c++) offs[c] = offs[c - 1] + counts[c - 1];
    const fill = offs.slice();
    for (let q = start; q < end; q++) tmp[fill[oct[q]]++] = perm[q];
    for (let q = start; q < end; q++) perm[q] = tmp[q];
    const hh = h / 2;
    let m = 0, x = 0, y = 0, z = 0;
    for (let c = 0; c < 8; c++) {
      if (!counts[c]) continue;
      const child = buildNode(offs[c], offs[c] + counts[c],
        cx + (c & 1 ? hh : -hh), cy + (c & 2 ? hh : -hh), cz + (c & 4 ? hh : -hh), hh, depth + 1);
      nChild[8 * k + c] = child;
      const mc = nMass[child];
      m += mc; x += mc * nX[child]; y += mc * nY[child]; z += mc * nZ[child];
    }
    nMass[k] = m;
    if (m > 0) { nX[k] = x / m; nY[k] = y / m; nZ[k] = z / m; } else { nX[k] = cx; nY[k] = cy; nZ[k] = cz; }
    let qxx = 0, qxy = 0, qxz = 0, qyy = 0, qyz = 0, qzz = 0;
    for (let c = 0; c < 8; c++) {
      const ch = nChild[8 * k + c];
      if (ch < 0) continue;
      const mc = nMass[ch], dx = nX[ch] - nX[k], dy = nY[ch] - nY[k], dz = nZ[ch] - nZ[k], r2 = dx * dx + dy * dy + dz * dz;
      const o = 6 * ch;
      qxx += nQ[o] + mc * (3 * dx * dx - r2); qxy += nQ[o + 1] + mc * 3 * dx * dy; qxz += nQ[o + 2] + mc * 3 * dx * dz;
      qyy += nQ[o + 3] + mc * (3 * dy * dy - r2); qyz += nQ[o + 4] + mc * 3 * dy * dz; qzz += nQ[o + 5] + mc * (3 * dz * dz - r2);
    }
    const o6 = 6 * k;
    nQ[o6] = qxx; nQ[o6 + 1] = qxy; nQ[o6 + 2] = qxz; nQ[o6 + 3] = qyy; nQ[o6 + 4] = qyz; nQ[o6 + 5] = qzz;
    return k;
  }

  function buildTree() {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      perm[i] = i;
    }
    const h = 0.5 * Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9) * 1.0001;
    nNodes = 0;
    buildNode(0, n, 0.5 * (minX + maxX), 0.5 * (minY + maxY), 0.5 * (minZ + maxZ), h, 0);
    treeValid = true;
  }

  // Field at a point from the tree. Skips particle `self` (or -1). Writes into out[0..3] = ax, ay, az, phi.
  const out = new Float64Array(4);
  function treeField(x, y, z, self) {
    let ax = 0, ay = 0, az = 0, ph = 0, sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const k = stack[--sp];
      const dx = nX[k] - x, dy = nY[k] - y, dz = nZ[k] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (nLeaf[k]) {
        const s = nStart[k], e = s + nCount[k];
        for (let q = s; q < e; q++) {
          const j = perm[q];
          if (j === self) continue;
          const ex = pos[3 * j] - x, ey = pos[3 * j + 1] - y, ez = pos[3 * j + 2] - z;
          const r2 = ex * ex + ey * ey + ez * ez + eps2;
          const inv = 1 / Math.sqrt(r2), m = mass[j], mi3 = m * inv * inv * inv;
          ax += mi3 * ex; ay += mi3 * ey; az += mi3 * ez; ph -= m * inv;
        }
      } else if (nSize2[k] < theta2 * d2) {
        const r2 = d2 + eps2;
        const inv = 1 / Math.sqrt(r2), m = nMass[k], mi3 = m * inv * inv * inv;
        ax += mi3 * dx; ay += mi3 * dy; az += mi3 * dz; ph -= m * inv;
      } else {
        const base = 8 * k;
        for (let c = 0; c < 8; c++) { const ch = nChild[base + c]; if (ch >= 0) stack[sp++] = ch; }
      }
    }
    out[0] = ax; out[1] = ay; out[2] = az; out[3] = ph;
  }

  // Fixed analytic components (rigid halos). Writes into fx[0..3].
  const fx = new Float64Array(4);
  function fixedField(x, y, z) {
    let ax = 0, ay = 0, az = 0, ph = 0;
    for (const f of fixed) {
      const dx = x - f.centre[0], dy = y - f.centre[1], dz = z - f.centre[2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-12;
      if (f.type === 'hernquist') {
        const ra = r + f.scale;
        const g = f.mass / (ra * ra * r);
        ax -= g * dx; ay -= g * dy; az -= g * dz; ph -= f.mass / ra;
      } else if (f.type === 'plummer') {
        const s2 = r * r + f.scale * f.scale, inv = 1 / Math.sqrt(s2), g = f.mass * inv * inv * inv;
        ax -= g * dx; ay -= g * dy; az -= g * dz; ph -= f.mass * inv;
      }
    }
    fx[0] = ax; fx[1] = ay; fx[2] = az; fx[3] = ph;
  }

  // Interaction lists shared by every particle of one leaf bucket:
  // nodes as (x, y, z, m, Qxx, Qxy, Qxz, Qyy, Qyz, Qzz), particles as (x, y, z, m).
  let nodeList = new Float64Array(10 * 1024), partList = new Float64Array(4 * 2048);

  // Bucket ("group") walk: for each leaf, accept nodes using the distance from the node's
  // centre of mass to the leaf's bounding box, which is conservative for every particle in it.
  function bucketForces(L) {
    const s = nStart[L], e = s + nCount[L];
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    for (let q = s; q < e; q++) {
      const i = perm[q], x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
    }
    let nl = 0, pl = 0, sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const k = stack[--sp];
      const x = nX[k], y = nY[k], z = nZ[k];
      const dx = x < bx0 ? bx0 - x : x > bx1 ? x - bx1 : 0;
      const dy = y < by0 ? by0 - y : y > by1 ? y - by1 : 0;
      const dz = z < bz0 ? bz0 - z : z > bz1 ? z - bz1 : 0;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (k !== L && nSize2[k] < theta2 * d2) {
        if (10 * (nl + 1) > nodeList.length) { const t = new Float64Array(nodeList.length * 2); t.set(nodeList); nodeList = t; }
        const o = 10 * nl++, o6 = 6 * k;
        nodeList[o] = x; nodeList[o + 1] = y; nodeList[o + 2] = z; nodeList[o + 3] = nMass[k];
        nodeList[o + 4] = nQ[o6]; nodeList[o + 5] = nQ[o6 + 1]; nodeList[o + 6] = nQ[o6 + 2];
        nodeList[o + 7] = nQ[o6 + 3]; nodeList[o + 8] = nQ[o6 + 4]; nodeList[o + 9] = nQ[o6 + 5];
      } else if (nLeaf[k]) {
        const ss = nStart[k], ee = ss + nCount[k];
        if (4 * (pl + ee - ss) > partList.length) { const t = new Float64Array(Math.max(partList.length * 2, 4 * (pl + ee - ss))); t.set(partList); partList = t; }
        for (let q = ss; q < ee; q++) {
          const j = perm[q], o = 4 * pl++;
          partList[o] = pos[3 * j]; partList[o + 1] = pos[3 * j + 1]; partList[o + 2] = pos[3 * j + 2]; partList[o + 3] = mass[j];
        }
      } else {
        const base = 8 * k;
        for (let c = 0; c < 8; c++) { const ch = nChild[base + c]; if (ch >= 0) stack[sp++] = ch; }
      }
    }
    const N10 = 10 * nl, P4 = 4 * pl, epsInv = 1 / Math.sqrt(eps2);
    for (let q = s; q < e; q++) {
      const i = perm[q], x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      let ax = 0, ay = 0, az = 0, ph = 0;
      for (let o = 0; o < P4; o += 4) {
        const ex = partList[o] - x, ey = partList[o + 1] - y, ez = partList[o + 2] - z;
        const r2 = ex * ex + ey * ey + ez * ez + eps2;
        const inv = 1 / Math.sqrt(r2), m = partList[o + 3], mi3 = m * inv * inv * inv;
        ax += mi3 * ex; ay += mi3 * ey; az += mi3 * ez; ph -= m * inv;
      }
      for (let o = 0; o < N10; o += 10) {
        const dx = nodeList[o] - x, dy = nodeList[o + 1] - y, dz = nodeList[o + 2] - z;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const inv = 1 / Math.sqrt(r2), inv2 = inv * inv, inv3 = inv * inv2, inv5 = inv3 * inv2, inv7 = inv5 * inv2;
        const m = nodeList[o + 3];
        const qx = nodeList[o + 4] * dx + nodeList[o + 5] * dy + nodeList[o + 6] * dz;
        const qy = nodeList[o + 5] * dx + nodeList[o + 7] * dy + nodeList[o + 8] * dz;
        const qz = nodeList[o + 6] * dx + nodeList[o + 8] * dy + nodeList[o + 9] * dz;
        const dqd = dx * qx + dy * qy + dz * qz;
        const t = m * inv3 + 2.5 * dqd * inv7;
        ax += t * dx - qx * inv5; ay += t * dy - qy * inv5; az += t * dz - qz * inv5;
        ph -= m * inv + 0.5 * dqd * inv5;
      }
      // The particle itself is in the particle list: no force, but -m/eps in the potential.
      phi[i] = ph + mass[i] * epsInv;
      acc[3 * i] = ax; acc[3 * i + 1] = ay; acc[3 * i + 2] = az;
    }
  }

  function computeForces() {
    buildTree();
    for (let k = 0; k < nNodes; k++) if (nLeaf[k]) bucketForces(k);
    if (fixed.length) {
      for (let i = 0; i < n; i++) {
        fixedField(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
        acc[3 * i] += fx[0]; acc[3 * i + 1] += fx[1]; acc[3 * i + 2] += fx[2]; phiExt[i] = fx[3];
      }
    }
  }

  const sim = {
    n, pos, vel, mass, group, fixed, acc, time: 0, theta, softening,
    get nodes() { return nNodes; },
    computeForces,
    step(dt) {
      if (!treeValid) computeForces();
      const h = 0.5 * dt;
      for (let q = 0; q < 3 * n; q++) vel[q] += h * acc[q];
      for (let q = 0; q < 3 * n; q++) pos[q] += dt * vel[q];
      computeForces();
      for (let q = 0; q < 3 * n; q++) vel[q] += h * acc[q];
      sim.time += dt;
    },
    /** Acceleration and potential at an arbitrary point (uses the current tree). */
    fieldAt(x, y, z) {
      if (!treeValid) computeForces();
      treeField(x, y, z, -1);
      const r = [out[0], out[1], out[2], out[3]];
      if (fixed.length) { fixedField(x, y, z); r[0] += fx[0]; r[1] += fx[1]; r[2] += fx[2]; r[3] += fx[3]; }
      return r;
    },
    energy() {
      if (!treeValid) computeForces();
      let kinetic = 0, potential = 0;
      for (let i = 0; i < n; i++) {
        const vx = vel[3 * i], vy = vel[3 * i + 1], vz = vel[3 * i + 2];
        kinetic += 0.5 * mass[i] * (vx * vx + vy * vy + vz * vz);
        potential += 0.5 * mass[i] * phi[i] + (fixed.length ? mass[i] * phiExt[i] : 0);
      }
      return { kinetic, potential, total: kinetic + potential };
    },
    momentum() {
      let px = 0, py = 0, pz = 0;
      for (let i = 0; i < n; i++) { px += mass[i] * vel[3 * i]; py += mass[i] * vel[3 * i + 1]; pz += mass[i] * vel[3 * i + 2]; }
      return [px, py, pz];
    },
    /** Direct-summation accelerations (for tests). */
    directAccelerations() {
      const a = new Float64Array(3 * n);
      for (let i = 0; i < n; i++) {
        let ax = 0, ay = 0, az = 0;
        const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const ex = pos[3 * j] - x, ey = pos[3 * j + 1] - y, ez = pos[3 * j + 2] - z;
          const r2 = ex * ex + ey * ey + ez * ez + eps2, inv = 1 / Math.sqrt(r2), mi3 = mass[j] * inv * inv * inv;
          ax += mi3 * ex; ay += mi3 * ey; az += mi3 * ez;
        }
        a[3 * i] = ax; a[3 * i + 1] = ay; a[3 * i + 2] = az;
      }
      return a;
    },
  };
  return sim;
}

function inGroups(groupIds) {
  const s = new Set(groupIds);
  return (g) => s.has(g);
}

/** Mass-weighted centre of the selected groups (optionally refined by shrinking spheres). */
export function centreOf(sim, groupIds, { shrink = 0, rStart = Infinity } = {}) {
  const sel = inGroups(groupIds);
  let cx = 0, cy = 0, cz = 0, m = 0;
  for (let i = 0; i < sim.n; i++) {
    if (!sel(sim.group[i])) continue;
    const mi = sim.mass[i];
    m += mi; cx += mi * sim.pos[3 * i]; cy += mi * sim.pos[3 * i + 1]; cz += mi * sim.pos[3 * i + 2];
  }
  if (!m) return [0, 0, 0];
  let c = [cx / m, cy / m, cz / m];
  let r = rStart;
  for (let it = 0; it < shrink; it++) {
    if (!Number.isFinite(r)) {
      // start from the 80th-percentile radius
      const d = [];
      for (let i = 0; i < sim.n; i++) if (sel(sim.group[i])) d.push(Math.hypot(sim.pos[3 * i] - c[0], sim.pos[3 * i + 1] - c[1], sim.pos[3 * i + 2] - c[2]));
      d.sort((a, b) => a - b);
      r = d[Math.floor(0.8 * (d.length - 1))];
    }
    let sx = 0, sy = 0, sz = 0, sm = 0;
    for (let i = 0; i < sim.n; i++) {
      if (!sel(sim.group[i])) continue;
      const dx = sim.pos[3 * i] - c[0], dy = sim.pos[3 * i + 1] - c[1], dz = sim.pos[3 * i + 2] - c[2];
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const mi = sim.mass[i];
      sm += mi; sx += mi * sim.pos[3 * i]; sy += mi * sim.pos[3 * i + 1]; sz += mi * sim.pos[3 * i + 2];
    }
    if (sm > 0) c = [sx / sm, sy / sm, sz / sm];
    r *= 0.7;
  }
  return c;
}

/**
 * Bar strength: amplitude of the m = 2 Fourier mode in the x–z plane,
 * A2 = |Σ m e^{2iφ}| / Σ m, for particles of `groupIds` within rMax of their
 * mass-weighted centre (refined by shrinking spheres so ejected particles do not
 * pull it off). The default rMax = 1.5 Rd covers the bar region and excludes the
 * outer spiral arms. ~1/sqrt(N) for an axisymmetric disk; > 0.2 is a clear bar.
 */
export function barStrength(sim, groupIds, rMax = 1.5) {
  const sel = inGroups(groupIds);
  const c = centreOf(sim, groupIds, { shrink: 4 });
  let re = 0, im = 0, m = 0;
  const r2max = rMax * rMax;
  for (let i = 0; i < sim.n; i++) {
    if (!sel(sim.group[i])) continue;
    const x = sim.pos[3 * i] - c[0], z = sim.pos[3 * i + 2] - c[2];
    const R2 = x * x + z * z;
    if (R2 > r2max || R2 === 0) continue;
    // e^{2iφ} = (x + i z)^2 / R^2
    const mi = sim.mass[i];
    re += mi * (x * x - z * z) / R2; im += mi * (2 * x * z) / R2; m += mi;
  }
  return m ? Math.hypot(re, im) / m : 0;
}

/**
 * Rotation profile about `centre` in the x–z plane.
 * vMeasured: mass-weighted mean tangential speed of the selected particles in each annulus
 * (relative to their mean velocity). vCirc: sqrt(R |a_R|) from the total field, averaged
 * over 8 azimuths at the bin centres.
 */
export function rotationProfile(sim, groupIds, centre = null, nBins = 16, rMax = 5) {
  const sel = inGroups(groupIds);
  const c = centre || centreOf(sim, groupIds, { shrink: 4 });
  let vx0 = 0, vy0 = 0, vz0 = 0, m0 = 0;
  for (let i = 0; i < sim.n; i++) {
    if (!sel(sim.group[i])) continue;
    const mi = sim.mass[i]; m0 += mi;
    vx0 += mi * sim.vel[3 * i]; vy0 += mi * sim.vel[3 * i + 1]; vz0 += mi * sim.vel[3 * i + 2];
  }
  if (m0) { vx0 /= m0; vy0 /= m0; vz0 /= m0; }
  const sum = new Float64Array(nBins), wsum = new Float64Array(nBins);
  const dr = rMax / nBins;
  for (let i = 0; i < sim.n; i++) {
    if (!sel(sim.group[i])) continue;
    const x = sim.pos[3 * i] - c[0], z = sim.pos[3 * i + 2] - c[2];
    const R = Math.hypot(x, z);
    const b = Math.floor(R / dr);
    if (b < 0 || b >= nBins || R === 0) continue;
    const vx = sim.vel[3 * i] - vx0, vz = sim.vel[3 * i + 2] - vz0;
    const vt = (x * vz - z * vx) / R; // positive for counter-clockwise in (x, z)
    sum[b] += sim.mass[i] * vt; wsum[b] += sim.mass[i];
  }
  const r = [], vMeasured = [], vCirc = [];
  for (let b = 0; b < nBins; b++) {
    const R = (b + 0.5) * dr;
    r.push(R);
    vMeasured.push(wsum[b] ? Math.abs(sum[b] / wsum[b]) : null);
    let aR = 0;
    for (let k = 0; k < 8; k++) {
      const ph = (k / 8) * 2 * Math.PI, ux = Math.cos(ph), uz = Math.sin(ph);
      const f = sim.fieldAt(c[0] + R * ux, c[1], c[2] + R * uz);
      aR += f[0] * ux + f[2] * uz;
    }
    aR /= 8;
    vCirc.push(Math.sqrt(Math.max(0, -aR * R)));
  }
  return { r, vMeasured, vCirc };
}

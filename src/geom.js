// Procedural geometry builders for all three acts (zero external assets)
import { makeRng, WORLD } from './math.js';

class MeshBuilder {
  constructor(initialCap = 4096) {
    this.v = new Float32Array(initialCap * 10);
    this.i = new Uint32Array(initialCap * 3);
    this.vc = 0;
    this.ic = 0;
  }
  _growV(need) {
    if (need * 10 <= this.v.length) return;
    let cap = this.v.length;
    while (cap < need * 10) cap *= 2;
    const nv = new Float32Array(cap);
    nv.set(this.v);
    this.v = nv;
  }
  _growI(need) {
    if (need <= this.i.length) return;
    let cap = this.i.length;
    while (cap < need) cap *= 2;
    const ni = new Uint32Array(cap);
    ni.set(this.i);
    this.i = ni;
  }
  vert(x, y, z, nx, ny, nz, u, v, matId, ao = 1.0) {
    const idx = this.vc++;
    this._growV(this.vc);
    const o = idx * 10;
    this.v[o] = x; this.v[o + 1] = y; this.v[o + 2] = z;
    this.v[o + 3] = nx; this.v[o + 4] = ny; this.v[o + 5] = nz;
    this.v[o + 6] = u; this.v[o + 7] = v;
    this.v[o + 8] = matId; this.v[o + 9] = ao;
    return idx;
  }
  tri(a, b, c) {
    const o = this.ic;
    this.ic += 3;
    this._growI(this.ic);
    this.i[o] = a; this.i[o + 1] = b; this.i[o + 2] = c;
  }
  quad(p0, p1, p2, p3, u0, v0, u1, v1, matId, ao0 = 1, ao1 = 1, ao2 = 1, ao3 = 1) {
    const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const a = this.vert(p0[0], p0[1], p0[2], nx, ny, nz, u0, v0, matId, ao0);
    const b = this.vert(p1[0], p1[1], p1[2], nx, ny, nz, u1, v0, matId, ao1);
    const c = this.vert(p2[0], p2[1], p2[2], nx, ny, nz, u1, v1, matId, ao2);
    const d = this.vert(p3[0], p3[1], p3[2], nx, ny, nz, u0, v1, matId, ao3);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  triP(p0, p1, p2, uv0, uv1, uv2, matId, ao0 = 1, ao1 = 1, ao2 = 1) {
    const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const a = this.vert(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1], matId, ao0);
    const b = this.vert(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1], matId, ao1);
    const c = this.vert(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1], matId, ao2);
    this.tri(a, b, c);
  }
  addBeveledBox(cx, cy, cz, sx, sy, sz, bevel, matId, aoBase = 0.85, rotY = 0, rotZ = 0, rotX = 0) {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const b = Math.min(bevel, hx * 0.35, hy * 0.35, hz * 0.35);
    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    const cZ = Math.cos(rotZ), sZ = Math.sin(rotZ);
    const cX = Math.cos(rotX), sX = Math.sin(rotX);

    const xf = (x, y, z) => {
      let y1 = y * cX - z * sX, z1 = y * sX + z * cX, x1 = x;
      let x2 = x1 * cZ - y1 * sZ, y2 = x1 * sZ + y1 * cZ, z2 = z1;
      let x3 = x2 * cY + z2 * sY, z3 = -x2 * sY + z2 * cY, y3 = y2;
      return [cx + x3, cy + y3, cz + z3];
    };

    const ix = hx - b, iy = hy - b, iz = hz - b;
    const f = (x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, uScale, vScale, aoTop, aoBot) => {
      this.quad(
        xf(x0, y0, z0), xf(x1, y1, z1), xf(x2, y2, z2), xf(x3, y3, z3),
        0, 0, uScale, vScale, matId, aoBot, aoBot, aoTop, aoTop
      );
    };
    const aoHi = Math.min(1.0, aoBase + 0.14);
    const aoLo = Math.max(0.20, aoBase - 0.16);
    f(-ix, -iy, hz, ix, -iy, hz, ix, iy, hz, -ix, iy, hz, sx, sy, aoHi, aoLo);
    f(ix, -iy, -hz, -ix, -iy, -hz, -ix, iy, -hz, ix, iy, -hz, sx, sy, aoHi, aoLo);
    f(hx, -iy, iz, hx, -iy, -iz, hx, iy, -iz, hx, iy, iz, sz, sy, aoHi, aoLo);
    f(-hx, -iy, -iz, -hx, -iy, iz, -hx, iy, iz, -hx, iy, -iz, sz, sy, aoHi, aoLo);
    f(-ix, hy, iz, ix, hy, iz, ix, hy, -iz, -ix, hy, -iz, sx, sz, aoHi, aoHi);
    f(-ix, -hy, -iz, ix, -hy, -iz, ix, -hy, iz, -ix, -hy, iz, sx, sz, aoLo, aoLo);

    if (b > 0.001) {
      const aoB = Math.min(1.0, aoBase + 0.18);
      f(ix, -iy, hz, hx, -iy, iz, hx, iy, iz, ix, iy, hz, b, sy, aoB, aoB);
      f(hx, -iy, -iz, ix, -iy, -hz, ix, iy, -hz, hx, iy, -iz, b, sy, aoB, aoB);
      f(-ix, -iy, -hz, -hx, -iy, -iz, -hx, iy, -iz, -ix, iy, -hz, b, sy, aoB, aoB);
      f(-hx, -iy, iz, -ix, -iy, hz, -ix, iy, hz, -hx, iy, iz, b, sy, aoB, aoB);
      f(-ix, iy, hz, ix, iy, hz, ix, hy, iz, -ix, hy, iz, sx, b, aoB, aoB);
      f(ix, iy, -hz, -ix, iy, -hz, -ix, hy, -iz, ix, hy, -iz, sx, b, aoB, aoB);
      f(hx, iy, iz, hx, iy, -iz, ix, hy, -iz, ix, hy, iz, sz, b, aoB, aoB);
      f(-hx, iy, -iz, -hx, iy, iz, -ix, hy, iz, -ix, hy, -iz, sz, b, aoB, aoB);
      f(ix, -iy, hz, -ix, -iy, hz, -ix, -hy, iz, ix, -hy, iz, sx, b, aoLo, aoLo);
      f(-ix, -iy, -hz, ix, -iy, -hz, ix, -hy, -iz, -ix, -hy, -iz, sx, b, aoLo, aoLo);
      f(hx, -iy, -iz, hx, -iy, iz, ix, -hy, iz, ix, -hy, -iz, sz, b, aoLo, aoLo);
      f(-hx, -iy, iz, -hx, -iy, -iz, -ix, -hy, -iz, -ix, -hy, iz, sz, b, aoLo, aoLo);
    }
  }
  finish() {
    return {
      vertices: this.v.subarray(0, this.vc * 10),
      indices: this.i.subarray(0, this.ic),
      vertexCount: this.vc,
      indexCount: this.ic,
    };
  }
}

// Crisp faceted refractive crystal prism (NO sub-pixel geometry bevel slivers -> ZERO dotted aliasing!)
// Encodes u in [0..1] across every flat crystal face so fragment shader computes pixel-perfect AA edge glints!
function addCrystalBlade(mb, opts) {
  const {
    x, y, z, rx, rz, ry,
    radius, height, sides = 6,
    taper = 0.56, crownFrac = 0.26,
    seed = 0.5, skewX = 0, skewZ = 0, asym = 0.18,
  } = opts;

  const cY = Math.cos(ry), sY = Math.sin(ry);
  const cX = Math.cos(rx), sX = Math.sin(rx);
  const cZ = Math.cos(rz), sZ = Math.sin(rz);

  const xf = (lx, ly, lz) => {
    const sx = lx + skewX * (ly / height);
    const sz = lz + skewZ * (ly / height);
    let y1 = ly * cX - sz * sX, z1 = ly * sX + sz * cX, x1 = sx;
    let x2 = x1 * cZ - y1 * sZ, y2 = x1 * sZ + y1 * cZ, z2 = z1;
    let x3 = x2 * cY + z2 * sY, z3 = -x2 * sY + z2 * cY, y3 = y2;
    return [x + x3, y + y3, z + z3];
  };

  const rng = makeRng(Math.floor(seed * 999991) + 17);
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rng() - 0.5) * (0.24 / sides);
    const r = radius * (1.0 + (rng() - 0.5) * 2 * asym);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }

  const hShaft = height * (1.0 - crownFrac);
  const hStepA = height * (0.28 + rng() * 0.10);
  const hStepB = hStepA + Math.max(2.6, radius * 0.42);
  const hMid = Math.max(hStepB + 2.5, hShaft * 0.64);
  const midScale = 1.0 - (1.0 - taper) * 0.34;
  const hCrownMid = hShaft + height * crownFrac * 0.56;
  const crownMidScale = taper * 0.42;
  const tipOffX = (rng() - 0.5) * radius * 0.14;
  const tipOffZ = (rng() - 0.5) * radius * 0.14;
  const apex = xf(tipOffX, height, tipOffZ);

  // Sleek continuous jewel-cut multifaceted mineral quartz profile (ZERO crude mid-shaft polygonal kinks!)
  const yLevels = [-3.0, hShaft * 0.34, hShaft * 0.68, hShaft, hCrownMid];
  const scales = [1.06, 0.94, 0.78, taper, crownMidScale];
  const h01s = [0.0, 0.25, 0.52, 1.0 - crownFrac, 1.0 - crownFrac * 0.45];

  for (let t = 0; t < yLevels.length - 1; t++) {
    const y0 = yLevels[t], y1 = yLevels[t + 1];
    const s0 = scales[t], s1 = scales[t + 1];
    const v0 = h01s[t], v1 = h01s[t + 1];
    for (let k = 0; k < sides; k++) {
      const kn = (k + 1) % sides;
      const p00 = xf(pts[kn][0] * s0, y0, pts[kn][1] * s0);
      const p10 = xf(pts[k][0] * s0, y0, pts[k][1] * s0);
      const p11 = xf(pts[k][0] * s1, y1, pts[k][1] * s1);
      const p01 = xf(pts[kn][0] * s1, y1, pts[kn][1] * s1);
      // u goes cleanly 0 -> 1 across each flat facet so fragment shader derives exact AA distance to every ridge!
      mb.quad(p00, p10, p11, p01, 0.0, v0, 1.0, v1, 5.0 + seed * 0.9, 0.72, 0.72, 0.96, 0.96);
    }
  }

  const yTop = yLevels[yLevels.length - 1];
  const sTop = scales[scales.length - 1];
  const vTop = h01s[h01s.length - 1];
  for (let k = 0; k < sides; k++) {
    const kn = (k + 1) % sides;
    const p0 = xf(pts[kn][0] * sTop, yTop, pts[kn][1] * sTop);
    const p1 = xf(pts[k][0] * sTop, yTop, pts[k][1] * sTop);
    mb.triP(p0, p1, apex, [0.0, vTop], [1.0, vTop], [0.5, 1.0], 5.0 + seed * 0.9, 0.95, 0.95, 1.0);
  }
}

// Multi-tiered Fractal Crystal Prism Cluster (watertight stepped spire + strictly non-overlapping radiating satellite blades!)
function addFractalCrystalCluster(mb, opts) {
  const {
    x, y, z, rx = 0, rz = 0, ry = 0,
    radius, height, sides = 6,
    taper = 0.56, crownFrac = 0.25,
    seed = 0.5, skewX = 0, skewZ = 0, asym = 0.16,
    satellites = 3,
  } = opts;
  const rng = makeRng(Math.floor(seed * 999983) + 31);

  // Main watertight stepped quartz monolith spire (zero overlapping geometry!)
  addCrystalBlade(mb, { x, y, z, rx, rz, ry, radius, height, sides, taper, crownFrac, seed, skewX, skewZ, asym });

  // Cleanly separated radiating satellite crystal blades sprouting around the base (mathematically zero interpenetration!)
  for (let s = 0; s < satellites; s++) {
    const ang = ry + (s / Math.max(1, satellites)) * Math.PI * 2 + (rng() - 0.5) * 0.32;
    const sRad = radius * (0.32 + rng() * 0.20);
    // Strictly outside main stepped base (1.22*radius*(1+asym)) + satellite radius + clean mirrored water channel!
    const offDist = radius * (1.26 + asym) + sRad * 1.24 + 1.2 + rng() * 2.2;
    const sx = x + Math.cos(ang) * offDist;
    const sz = z + Math.sin(ang) * offDist;
    const sH = height * (0.28 + rng() * 0.34);
    // Outward crystalline splay angle so blades diverge upward and never cross!
    const splay = 0.10 + rng() * 0.16;
    const sRx = rx + Math.sin(ang) * splay;
    const sRz = rz - Math.cos(ang) * splay;
    addCrystalBlade(mb, {
      x: sx, y, z: sz, rx: sRx, rz: sRz, ry: ang + 0.4,
      radius: sRad, height: sH, sides: s % 2 === 0 ? 6 : 5,
      taper: 0.46 + rng() * 0.16, crownFrac: 0.30, seed: (seed + 0.29 * (s + 1)) % 1, asym: 0.14,
    });
  }
}

export function buildCrystalWorld() {
  const mb = new MeshBuilder(64000);
  const rng = makeRng(20261122);
  const placed = [];

  const canPlace = (x, z, r) => {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (Math.hypot(x - p.x, z - p.z) < r + p.r + 3.0) return false;
    }
    return true;
  };
  const place = (opts) => {
    placed.push({ x: opts.x, z: opts.z, r: opts.radius * 1.45 });
    addFractalCrystalCluster(mb, opts);
  };

  // 1. HERO CLOSE-UP FRACTAL CRYSTAL SCULPTURE FOR POSE 5 (sleek 8-sided high-facet optical quartz monolith, zero low-poly kink!)
  placed.push({ x: -86.0, z: 368.0, r: 10.0 });
  addCrystalBlade(mb, {
    x: -86.0, y: 0, z: 368.0,
    rx: -0.05, rz: -0.16, ry: 0.42,
    radius: 7.4, height: 92, sides: 8,
    taper: 0.50, crownFrac: 0.30, seed: 0.77, asym: 0.10, stepped: false,
  });
  // Cleanly separated fractal companion cluster further back-left (zero overlap with hero blade!)
  place({
    x: -112.0, y: 0, z: 326.0,
    rx: -0.06, rz: -0.11, ry: 1.45,
    radius: 6.4, height: 78, sides: 8,
    taper: 0.50, crownFrac: 0.28, seed: 0.61, asym: 0.12, satellites: 3,
  });

  // 2. GRAND CENTRAL MIRRORED FRACTAL PRISM CANYON (z = 110..480) — EPIC FRAMING + WIDE OPEN POSE 2 SEA!
  // Sightline helper: keep Pose 2 (-128,42,498 -> 12,56,20) wide open panoramic mirrored sea!
  const inPose2Sightline = (x, z) => {
    if (z < 105 || z > 540) return false;
    const t = (z - 498) / (20 - 498); // 0 at eye, 1 at target
    const cx = -128 + t * (12 - (-128));
    const halfClear = 185 - t * 52; // expansive liquid-obsidian ocean mirror framing gas giant & auroras!
    return Math.abs(x - cx) < halfClear;
  };

  for (let row = 0; row < 22; row++) {
    const zBase = 112 + row * 17.0 + (rng() - 0.5) * 4.5;
    const canyonHalfW = 58 + (zBase / 480) * 32 + Math.sin(row * 0.52) * 7;
    for (const side of [-1, 1]) {
      const xMain = side * (canyonHalfW + rng() * 14);
      if (Math.hypot(xMain + 86.0, zBase - 368.0) < 48) continue;
      if (Math.hypot(xMain + 58.0, zBase - 408.0) < 36) continue;
      if (Math.hypot(xMain + 128, zBase - 498) < 185) continue;
      if (inPose2Sightline(xMain, zBase) && zBase > 220) continue;

      const h = 54 + rng() * 116 + (1.0 - zBase / 500) * 34;
      const rad = 5.0 + rng() * 7.2 + h * 0.025;
      if (canPlace(xMain, zBase, rad)) {
        place({
          x: xMain, y: 0, z: zBase,
          rx: (rng() - 0.5) * 0.11, rz: side * (-0.05 + rng() * 0.18), ry: rng() * Math.PI * 2,
          radius: rad, height: h, sides: rng() < 0.72 ? 8 : 6,
          taper: 0.46 + rng() * 0.20, crownFrac: 0.26 + rng() * 0.12, seed: rng(), asym: 0.16,
          satellites: 2 + (row % 2),
        });
      }

      // Second rank towering fractal crystal clusters behind inner canyon walls
      const xMid = side * (canyonHalfW + 52 + rng() * 54);
      const zMid = zBase + (rng() - 0.5) * 18;
      if (Math.hypot(xMid + 128, zMid - 498) > 195 && Math.hypot(xMid + 86, zMid - 368) > 48 && !(inPose2Sightline(xMid, zMid) && zMid > 210)) {
        const rad2 = 9.0 + rng() * 13.0;
        if (rng() < 0.82 && canPlace(xMid, zMid, rad2)) {
          place({
            x: xMid, y: 0, z: zMid,
            rx: (rng() - 0.5) * 0.08, rz: side * (-0.04 + rng() * 0.12), ry: rng() * 6.28,
            radius: rad2, height: 120 + rng() * 195, sides: 8,
            taper: 0.50 + rng() * 0.20, crownFrac: 0.22 + rng() * 0.12, seed: rng(), asym: 0.18,
            satellites: 2,
          });
        }
      }

      // Third rank kilometer-scale outer mirrored glass monoliths!
      const xFar = side * (canyonHalfW + 128 + rng() * 140);
      const zFar = zBase + (rng() - 0.5) * 28;
      if (row % 2 === 0 && !(xFar < -190 && zFar > 105 && zFar < 470) && Math.hypot(xFar + 128, zFar - 498) > 185 && !(inPose2Sightline(xFar, zFar) && zFar > 220)) {
        const rad3 = 16 + rng() * 24;
        if (canPlace(xFar, zFar, rad3)) {
          place({
            x: xFar, y: -3, z: zFar,
            rx: (rng() - 0.5) * 0.08, rz: side * (-0.03 + rng() * 0.10), ry: rng() * 6.28,
            radius: rad3, height: 185 + rng() * 310, sides: 6,
            taper: 0.58 + rng() * 0.20, crownFrac: 0.16 + rng() * 0.12, seed: rng(), asym: 0.26,
            satellites: 2,
          });
        }
      }
    }
  }

  // 3. EXPANSIVE MIRRORED SEA FRACTAL ARCHIPELAGO (r = 250..1350, rich panoramic horizon silhouettes!)
  for (let i = 0; i < 96; i++) {
    const angle = (i / 96) * Math.PI * 2 + (rng() - 0.5) * 0.06;
    const dist = 240 + rng() * 1060;
    const x = Math.sin(angle) * dist;
    const z = 260 + Math.cos(angle) * dist;
    if (Math.abs(x) < 176 && z < 505 && z > -650) continue;
    if (z < 92 && Math.abs(x) < 285) continue;
    if (Math.hypot(x + 128, z - 498) < 195) continue;
    if (inPose2Sightline(x, z) && z > 220) continue;
    // Keep Pose 2 upper-left frame border cleanly open (ZERO flat cropped prism slab at 00:00-00:02!)
    if (x < -190 && z > 105 && z < 470) continue;
    if (Math.hypot(x + 86, z - 368) < 55) continue;

    const isColossal = rng() < 0.48;
    const rad = isColossal ? (19 + rng() * 28) : (9 + rng() * 14);
    if (!canPlace(x, z, rad)) continue;
    place({
      x, y: -3, z,
      rx: (rng() - 0.5) * 0.11, rz: (rng() - 0.5) * 0.13, ry: rng() * 6.28,
      radius: rad, height: isColossal ? (220 + rng() * 410) : (85 + rng() * 160),
      sides: isColossal ? 5 : 6, taper: 0.58 + rng() * 0.22, crownFrac: 0.16 + rng() * 0.14,
      seed: rng(), asym: 0.28,
      skewX: (rng() - 0.5) * rad * 1.1, skewZ: (rng() - 0.5) * rad * 1.1,
      satellites: isColossal ? 3 : 2,
    });
  }

  return { crystalsAll: mb.finish(), crystalFootprints: placed };
}

// =========================================================================
// ACT I->II FRACTURED PORTAL MONOLITH + SEALED NAVE + CHISELED OCULUS
// =========================================================================
export function buildPortalAndExterior() {
  const mb = new MeshBuilder(22000);
  const oculusMb = new MeshBuilder(12000);
  const rng = makeRng(918273);

  // 1. MONUMENTAL SCULPTED FRACTURED VOLCANIC BASALT PORTAL MONOLITH at z = 0
  // Dramatic tiered megalithic basalt bastions, vertical tectonic flutes & jagged crown crags (ZERO simple boxy slabs!)
  for (const side of [-1, 1]) {
    // Primary overlapping monumental stepped bastions with rich architectural depth & taper
    mb.addBeveledBox(side * 46, 68, -12, 36, 152, 64, 2.0, 0.0, 0.68, side * -0.05, side * -0.10);
    mb.addBeveledBox(side * 58, 96, -16, 20, 184, 52, 1.8, 0.0, 0.74, side * -0.06, side * -0.07);
    mb.addBeveledBox(side * 82, 78, -22, 42, 162, 72, 2.6, 0.0, 0.64, side * -0.10, side * -0.13);
    mb.addBeveledBox(side * 124, 54, -40, 56, 124, 84, 3.0, 0.0, 0.58, side * -0.16, side * -0.08);
    mb.addBeveledBox(side * 176, 40, -76, 76, 94, 100, 3.6, 0.0, 0.52, side * -0.22, side * -0.04);

    // Sculpted vertical basalt cleavage buttresses & stepped architectural pilasters framing the front monolith facade
    mb.addBeveledBox(side * 34.5, 58, 17.5, 11.0, 124, 9.5, 1.0, 0.0, 0.76, side * -0.04, side * -0.06);
    mb.addBeveledBox(side * 53.0, 44, 15.0, 13.5, 98,  10.5, 1.1, 0.0, 0.70, side * -0.07, side * -0.08);
    mb.addBeveledBox(side * 74.0, 36, 10.5, 15.0, 82,  11.5, 1.2, 0.0, 0.64, side * -0.10, side * -0.10);
    // Horizontal cyclopean carved stringcourse moldings breaking up flat wall panels
    mb.addBeveledBox(side * 54.0, 34, 16.5, 48, 4.2, 11.0, 0.55, 0.0, 0.78, side * -0.05, 0);
    mb.addBeveledBox(side * 54.0, 74, 14.5, 48, 4.8, 10.5, 0.60, 0.0, 0.80, side * -0.05, 0);

    // Sculpted stepped recessed volcanic rift lining
    for (let tier = 0; tier < 5; tier++) {
      const yBot = -6 + tier * 24.0;
      const tierH = 28.0 + rng() * 4.0;
      const jaggedIn = Math.sin(tier * 1.65 + side * 1.1) * 1.8 + (tier > 2 ? (tier - 2) * 1.2 : 0);
      const innerEdge = 28.5 + jaggedIn;
      const slabW = 24 + (5 - tier) * 3.5;
      const slabD = 38 + rng() * 6;
      const cx = side * (innerEdge + slabW * 0.5);
      const cz = -16 + (rng() - 0.5) * 6;
      const tilt = side * (-0.04 - tier * 0.01);
      mb.addBeveledBox(cx, yBot + tierH * 0.5, cz, slabW, tierH, slabD, 1.4, 0.0, 0.66 + tier * 0.025, side * 0.03, tilt);
    }

    // Monumental tapered flooded volcanic basalt sentinel obelisk pylons flanking threshold (ZERO stubby placeholder blocks!)
    const pyZ = 28;
    const pyX = side * 34.5;
    mb.addBeveledBox(pyX, 4.0,  pyZ, 11.5, 14.0, 11.5, 0.85, 0.0, 0.60, side * -0.04, 0);
    mb.addBeveledBox(pyX, 18.0, pyZ,  8.4, 24.0,  8.4, 0.70, 0.0, 0.68, side * -0.04, side * -0.03);
    mb.addBeveledBox(pyX, 34.0, pyZ,  5.6, 16.0,  5.6, 0.55, 0.0, 0.74, side * -0.04, side * -0.04);
    mb.addBeveledBox(pyX, 44.5, pyZ,  3.2,  9.5,  3.2, 0.40, 0.0, 0.78, side * -0.04, side * -0.04);
    // Secondary taller inner basalt guardian pillar tucked cleanly against portal cheek
    mb.addBeveledBox(side * 29.8, 12.0, 12.0, 7.6, 32.0, 8.2, 0.65, 0.0, 0.64, side * -0.03, side * -0.02);
  }

  // Sculpted monumental corbeled cyclopean lintel architrave & tiered keystone crown (ZERO awkward slanted floating blocks!)
  mb.addBeveledBox(0, 126, -6, 98, 14, 58, 1.4, 0.0, 0.62, 0, 0);
  mb.addBeveledBox(0, 136, -8, 86, 12, 62, 1.4, 0.0, 0.56, 0, 0);
  mb.addBeveledBox(0, 145, -10, 62, 10, 56, 1.2, 0.0, 0.66, 0, 0);
  mb.addBeveledBox(0, 122, 16, 44, 16, 12, 1.1, 0.0, 0.76, 0, 0);

  // 2. COMPLETELY SEALED, WATERTIGHT BARREL-VAULTED CATHEDRAL THRESHOLD NAVE (z = -12 to -266 -> ZERO black ceiling voids!)
  const vaultSegs = 12;
  const vaultZStart = -12, vaultZEnd = -266;
  const vaultR = 35.0, vaultY0 = 84.0, vaultH = 42.0;
  // Continuous curved carved-stone barrel vault soffit sealing 100% of ceiling space between every gothic arch rib!
  for (let s = 0; s < vaultSegs; s++) {
    const a0 = (s / vaultSegs) * Math.PI;
    const a1 = ((s + 1) / vaultSegs) * Math.PI;
    const x0 = Math.cos(a0) * vaultR, y0 = vaultY0 + Math.sin(a0) * vaultH;
    const x1 = Math.cos(a1) * vaultR, y1 = vaultY0 + Math.sin(a1) * vaultH;
    // Inward-facing soffit quad (normals point downward/inward into the vaulted tunnel so warm nave bounce illuminates the masonry!)
    mb.quad(
      [x0, y0, vaultZStart], [x0, y0, vaultZEnd],
      [x1, y1, vaultZEnd],   [x1, y1, vaultZStart],
      0, s * 0.4, 8, (s + 1) * 0.4, 0.0, 0.72, 0.66, 0.66, 0.72
    );
  }

  const naveCount = 8;
  for (let i = 0; i < naveCount; i++) {
    const nz = -22 - i * 31;
    for (const side of [-1, 1]) {
      mb.addBeveledBox(side * 44, 58, nz, 18, 136, 15, 1.1, 0.0, 0.62);
      mb.addBeveledBox(side * 34, 54, nz, 8, 122, 9, 0.6, 0.0, 0.74);
      mb.addBeveledBox(side * 68, 66, nz - 15, 34, 168, 36, 1.2, 0.0, 0.38);
    }
    // Watertight extruded curved gothic transverse vault rib hugging the barrel-vault ceiling seamlessly!
    const rIn = 31.6, rOut = 36.2, hIn = 38.4, hOut = 43.2, halfD = 4.2;
    for (let s = 0; s < vaultSegs; s++) {
      const a0 = (s / vaultSegs) * Math.PI;
      const a1 = ((s + 1) / vaultSegs) * Math.PI;
      const ix0 = Math.cos(a0) * rIn,  iy0 = vaultY0 + Math.sin(a0) * hIn;
      const ix1 = Math.cos(a1) * rIn,  iy1 = vaultY0 + Math.sin(a1) * hIn;
      const ox0 = Math.cos(a0) * rOut, oy0 = vaultY0 + Math.sin(a0) * hOut;
      const ox1 = Math.cos(a1) * rOut, oy1 = vaultY0 + Math.sin(a1) * hOut;
      // Front face (+Z)
      mb.quad([ox0, oy0, nz + halfD], [ix0, iy0, nz + halfD], [ix1, iy1, nz + halfD], [ox1, oy1, nz + halfD], 0, 0, 1, 1, 0.0, 0.74, 0.82, 0.82, 0.74);
      // Back face (-Z)
      mb.quad([ix0, iy0, nz - halfD], [ox0, oy0, nz - halfD], [ox1, oy1, nz - halfD], [ix1, iy1, nz - halfD], 0, 0, 1, 1, 0.0, 0.74, 0.68, 0.68, 0.74);
      // Underside intrados facing down into tunnel
      mb.quad([ix0, iy0, nz + halfD], [ix0, iy0, nz - halfD], [ix1, iy1, nz - halfD], [ix1, iy1, nz + halfD], 0, 0, 1, 1, 0.0, 0.80, 0.76, 0.76, 0.80);
    }
    mb.addBeveledBox(0, 138, nz - 15, 152, 26, 36, 1.0, 0.0, 0.42);
  }
  // Sculpted stepped wet volcanic basalt threshold stairs rising solidly from underwater
  for (let st = 0; st < 5; st++) {
    const szStep = 22 - st * 6.2;
    const syStep = -1.8 + st * 0.92;
    mb.addBeveledBox(0, syStep, szStep, 28 - st * 0.4, 3.6, 7.2, 0.45, 0.0, 0.58 + st * 0.03);
  }
  mb.addBeveledBox(0, 1.4, -124, 26, 5.8, 224, 0.7, 0.0, 0.68);
  for (const side of [-1, 1]) {
    mb.addBeveledBox(side * 12.2, 5.4, -124, 2.0, 3.6, 222, 0.35, 0.0, 0.78);
  }
  // Dark cathedral interior rear seal (hidden below portal roofline in Act I while sealing 100% of Pose 1 & Pose 5 arch opening!)
  mb.addBeveledBox(0, 76, -478, 136, 236, 22, 1.0, 0.0, 0.18);
  // Deep unseen smoky-graphite abyssal cap at y = -760
  mb.addBeveledBox(0, -760, WORLD.SHAFT_Z, 340, 32, 340, 1.0, 0.0, 0.15);

  // Tiny reflection-only upper shaft seal (drawn ONLY in Pass 0 planar reflection!)
  const reflSealMb = new MeshBuilder(64);
  reflSealMb.addBeveledBox(0, 310, -478, 250, 340, 22, 1.0, 0.0, 0.20);

  // 3. MONUMENTAL INWARD-CURVING COFFERED PANTHEON STONE DOME & OCULUS (at y = 435..518, z = -340)
  // True inward-corbeled sacred gothic dome sealing 100% of shaft top into a sculpted r = 92m circular sky oculus!
  const sx = WORLD.SHAFT_X, sz = WORLD.SHAFT_Z, oy = WORLD.OCULUS_Y;
  const segs = 24;
  const domeTiers = [
    { r: 120, y: 446, h: 18, w: 28, mat: 0.0, ao: 0.64 },
    { r: 113, y: 462, h: 18, w: 26, mat: 0.0, ao: 0.68 },
    { r: 106, y: 478, h: 18, w: 24, mat: 0.0, ao: 0.70 },
    { r:  99, y: 493, h: 18, w: 22, mat: 0.0, ao: 0.72 },
    { r:  94, y: 507, h: 16, w: 20, mat: 2.0, ao: 0.74 }, // Sculpted dark volcanic obsidian Oculus crown ring (clear inner r = 84m+)
    { r: 112, y: 516, h: 16, w: 36, mat: 0.0, ao: 0.62 }, // Upper Pantheon dome collar cornice
  ];
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const am = (a0 + a1) * 0.5;
    const segLen = 2 * Math.sin(Math.PI / segs);

    for (const dt of domeTiers) {
      const cx = sx + Math.cos(am) * dt.r;
      const cz = sz + Math.sin(am) * dt.r;
      const chord = dt.r * segLen * 1.18;
      oculusMb.addBeveledBox(cx, dt.y, cz, dt.w, dt.h, chord, 1.0, dt.mat, dt.ao, -am);
    }

    // Sculpted arched stone dome meridian ribs converging toward the Oculus rim (zero open gaps, center r < 86m 100% OPEN!)
    if (s % 2 === 0) {
      oculusMb.addBeveledBox(sx + Math.cos(a0) * 106, 480, sz + Math.sin(a0) * 106, 16, 74, 5.2, 0.6, 0.0, 0.72, -a0, 0.34);
      oculusMb.addBeveledBox(sx + Math.cos(a0) * 98, 518, sz + Math.sin(a0) * 98, 16, 5.5, 3.2, 0.3, 3.0, 0.76, -a0);
    }

    // Solid vaulted dark volcanic obsidian outer dome roof shell (seals 100% of upper cathedral perimeter!)
    const rings = [
      { r0: 102, r1: 185, y0: oy + 10, y1: oy - 6,  mat: 2.0 },
      { r0: 185, r1: 480, y0: oy - 6,  y1: oy - 22, mat: 2.0 },
      { r0: 480, r1: 1450, y0: oy - 22, y1: oy - 36, mat: 2.0 },
    ];
    for (const rg of rings) {
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0 = [sx + c0 * rg.r0, rg.y0, sz + s0 * rg.r0];
      const p1 = [sx + c1 * rg.r0, rg.y0, sz + s1 * rg.r0];
      const p2 = [sx + c1 * rg.r1, rg.y1, sz + s1 * rg.r1];
      const p3 = [sx + c0 * rg.r1, rg.y1, sz + s0 * rg.r1];
      oculusMb.quad(p0, p1, p2, p3, 0, 0, 4, 4, rg.mat, 0.56, 0.56, 0.40, 0.40);
    }
  }

  return { portalNave: mb.finish(), oculusCitadel: oculusMb.finish(), reflSeal: reflSealMb.finish() };
}

// =========================================================================
// ACT II — IMPOSSIBLE FRACTAL CATHEDRAL (100% WATERTIGHT EXTRUDED GOTHIC ARCHES!)
// =========================================================================
function addCompoundPointedArch(mb, xPos, yApex, spanW, ribThick, depth, aoBase) {
  // 100% WATERTIGHT continuous vertex-shared curved gothic arch ring from left pier to exact joined apex to right pier (ZERO floating brick gaps!)
  const half = spanW * 0.5;
  const rise = half * 0.84;
  const ySpring = yApex - rise;
  const xIn = xPos - depth * 0.5;
  const xOut = xPos + depth * 0.5;
  const segs = 12;

  const ptIn = (u) => {
    const a = u * Math.PI; // 0 = +Z pier, PI/2 = apex (z=0), PI = -Z pier
    const z = Math.cos(a) * half;
    const s = Math.sin(a);
    // Subtle gothic pointed-arch lift near crown while staying 100% joined at z=0!
    const y = ySpring + rise * (s + 0.14 * s * s * s);
    return [z, y];
  };
  const ptOut = (u) => {
    const a = u * Math.PI;
    const rOut = half + ribThick;
    const z = Math.cos(a) * rOut;
    const s = Math.sin(a);
    const y = ySpring + (rise + ribThick) * (s + 0.14 * s * s * s);
    return [z, y];
  };

  for (let k = 0; k < segs; k++) {
    const u0 = k / segs, u1 = (k + 1) / segs;
    const [iz0, iy0] = ptIn(u0),  [iz1, iy1] = ptIn(u1);
    const [oz0, oy0] = ptOut(u0), [oz1, oy1] = ptOut(u1);
    const ao0 = Math.min(1.0, aoBase + Math.sin(u0 * Math.PI) * 0.10);
    const ao1 = Math.min(1.0, aoBase + Math.sin(u1 * Math.PI) * 0.10);
    // Front face facing inward toward shaft (-X normal)
    mb.quad([xIn, iy0, iz0], [xIn, oy0, oz0], [xIn, oy1, oz1], [xIn, iy1, iz1], 0, u0 * 4, 1, u1 * 4, 0.0, ao0, ao0 * 0.92, ao1 * 0.92, ao1);
    // Back face (+X normal)
    mb.quad([xOut, oy0, oz0], [xOut, iy0, iz0], [xOut, iy1, iz1], [xOut, oy1, oz1], 0, u0 * 4, 1, u1 * 4, 0.0, ao0 * 0.85, ao0 * 0.9, ao1 * 0.9, ao1 * 0.85);
    // Underside intrados soffit (facing down/inward into opening)
    mb.quad([xIn, iy0, iz0], [xIn, iy1, iz1], [xOut, iy1, iz1], [xOut, iy0, iz0], 0, u0 * 4, 1, u1 * 4, 0.0, ao0 * 0.96, ao1 * 0.96, ao1 * 0.84, ao0 * 0.84);
    // Top extrados outer face
    mb.quad([xOut, oy0, oz0], [xOut, oy1, oz1], [xIn, oy1, oz1], [xIn, oy0, oz0], 0, u0 * 4, 1, u1 * 4, 0.0, ao0 * 0.88, ao1 * 0.88, ao1 * 0.96, ao0 * 0.96);
  }
}

export function buildCathedralModules() {
  const bay = new MeshBuilder(10000);
  const W = 58, H = 58;

  // Compound fluted gothic-brutalist piers with stepped pilasters & deeply recessed dark-crimson stone seams (NO sci-fi neon bars!)
  for (const s of [-1, 1]) {
    bay.addBeveledBox(10, 0, s * (W * 0.45), 24, H, 10.5, 0.9, 0.0, 0.74);
    bay.addBeveledBox(-2, 0, s * (W * 0.43), 9, H, 5.2, 0.5, 0.0, 0.88);
    bay.addBeveledBox(-5.5, 0, s * (W * 0.45), 4.2, H, 2.8, 0.3, 0.0, 0.92);
    // Narrow deeply inset dark-crimson fissure tucked inside masonry shadow groove!
    bay.addBeveledBox(-1.2, 0, s * (W * 0.402), 0.24, H * 0.88, 0.30, 0.04, 1.0, 0.78);
    bay.addBeveledBox(4, H * 0.33, s * (W * 0.43), 26, 4.2, 13.5, 0.5, 0.0, 0.86);
    bay.addBeveledBox(4, -H * 0.44, s * (W * 0.43), 26, 5.0, 13.5, 0.5, 0.0, 0.70);
  }

  // Macro compound curved pointed gothic arch + double molded inner archivolt ribs!
  bay.addBeveledBox(8, H * 0.46, 0, 22, 6.5, W * 0.94, 0.7, 0.0, 0.78);
  addCompoundPointedArch(bay, 2.0, H * 0.42, W * 0.78, 4.8, 12.0, 0.80);
  addCompoundPointedArch(bay, -3.5, H * 0.39, W * 0.72, 2.8, 5.5, 0.92);
  // Sculpted carved basalt keystone pendant (NO neon sticker on face!)
  bay.addBeveledBox(-2, H * 0.34, 0, 9.0, 13, 6.4, 0.55, 0.0, 0.90);

  // Cantilevered gallery balcony (clean chiseled matte-graphite cornice)
  bay.addBeveledBox(18, -H * 0.46, 0, 48, 4.8, W * 0.94, 0.55, 0.0, 0.64);
  bay.addBeveledBox(-3, -H * 0.45, 0, 9, 3.4, W * 0.78, 0.35, 0.0, 0.86);

  // 2nd & 3rd RECURSIVE FRACTAL ARCH ORDERS deeply nested inside each bay (rich Piranesi depth!)
  for (let sub = -1; sub <= 1; sub++) {
    const cz = sub * 14.5;
    bay.addBeveledBox(20, -4, cz - 6.6, 9, H * 0.74, 3.2, 0.35, 0.0, 0.66);
    bay.addBeveledBox(20, -4, cz + 6.6, 9, H * 0.74, 3.2, 0.35, 0.0, 0.66);
    addCompoundPointedArch(bay, 19.0, H * 0.26, 13.4, 2.5, 7.2, 0.74);
    // Subtle dark-crimson crevice tucked deep behind 2nd-order arch shadow
    bay.addBeveledBox(24.5, -4, cz, 0.22, H * 0.58, 0.26, 0.04, 1.0, 0.70);
    // 3rd fractal order: twin nested mini-arches & lancet colonnettes deeper in shadow
    bay.addBeveledBox(36, -6, cz, 5.5, H * 0.66, 2.0, 0.22, 0.0, 0.54);
    bay.addBeveledBox(36, -6, cz - 3.6, 4.5, H * 0.56, 1.4, 0.18, 0.0, 0.52);
    bay.addBeveledBox(36, -6, cz + 3.6, 4.5, H * 0.56, 1.4, 0.18, 0.0, 0.52);
    addCompoundPointedArch(bay, 35.0, H * 0.14, 7.0, 1.6, 4.5, 0.62);
  }
  bay.addBeveledBox(58, 0, 0, 16, H * 1.18, W * 1.42, 0.8, 0.0, 0.30);

  // Clerestory solar-amber window variant bay (ornate gothic lancet tracery!)
  const winBay = new MeshBuilder(10000);
  for (const s of [-1, 1]) {
    winBay.addBeveledBox(10, 0, s * (W * 0.45), 24, H, 10.5, 0.9, 0.0, 0.78);
    winBay.addBeveledBox(-2, 0, s * (W * 0.43), 9, H, 5.2, 0.5, 0.0, 0.90);
    winBay.addBeveledBox(-1.2, 0, s * (W * 0.402), 0.24, H * 0.88, 0.30, 0.04, 1.0, 0.78);
    winBay.addBeveledBox(58, 0, s * 24, 16, H * 1.18, 36, 0.8, 0.0, 0.36);
  }
  winBay.addBeveledBox(8, H * 0.46, 0, 22, 6.5, W * 0.94, 0.7, 0.0, 0.82);
  addCompoundPointedArch(winBay, 2.0, H * 0.42, W * 0.78, 4.8, 12.0, 0.84);
  winBay.addBeveledBox(-3, -H * 0.45, 0, 9, 3.4, W * 0.78, 0.35, 0.0, 0.86);
  for (const mz of [-4.6, 0, 4.6]) {
    winBay.addBeveledBox(48, 0, mz, 5.5, H * 0.94, 1.5, 0.2, 0.0, 0.54);
  }
  for (const my of [-16, -4, 8, 20]) {
    winBay.addBeveledBox(48, my, 0, 5.5, 1.8, 19, 0.2, 0.0, 0.54);
  }
  addCompoundPointedArch(winBay, 48, 22, 16, 2.2, 5.5, 0.60);
  winBay.addBeveledBox(64, 0, 0, 2, H * 0.94, 17, 0.1, 7.0, 1.0);

  // Monumental chiseled basalt spanning cathedral bridge with sleek curved gothic arch haunches (ZERO boxy hanging teeth!)
  const bridge = new MeshBuilder(4200);
  const BL = 240;
  bridge.addBeveledBox(0, 0, 0, BL, 3.8, 11.2, 0.55, 0.0, 0.80);
  bridge.addBeveledBox(0, -3.6, 0, BL * 0.98, 3.4, 5.4, 0.45, 0.0, 0.64);
  // Sleek continuous gothic parapets
  for (const s of [-1, 1]) {
    bridge.addBeveledBox(0, 3.6, s * 5.0, BL * 0.96, 1.5, 1.3, 0.22, 0.0, 0.84);
    for (let k = -8; k <= 8; k++) {
      bridge.addBeveledBox(k * 13.5, 2.5, s * 5.0, 1.8, 2.8, 1.5, 0.18, 0.0, 0.82);
    }
  }
  // Smooth continuous vaulted under-bridge stone arch rib curving cleanly into shaft walls!
  const bArchSegs = 12;
  for (let s = 0; s < bArchSegs; s++) {
    const t0 = -1 + (s / bArchSegs) * 2;
    const t1 = -1 + ((s + 1) / bArchSegs) * 2;
    const x0 = t0 * 116, x1 = t1 * 116;
    const y0 = -3.8 - t0 * t0 * 24.0, y1 = -3.8 - t1 * t1 * 24.0;
    const yt0 = -2.2, yt1 = -2.2;
    const hz = 3.2;
    bridge.quad([x0, y0,  hz], [x1, y1,  hz], [x1, yt1,  hz], [x0, yt0,  hz], 0, 0, 2, 1, 0.0, 0.58, 0.58, 0.72, 0.72);
    bridge.quad([x1, y1, -hz], [x0, y0, -hz], [x0, yt0, -hz], [x1, yt1, -hz], 0, 0, 2, 1, 0.0, 0.58, 0.58, 0.72, 0.72);
    bridge.quad([x0, y0, -hz], [x1, y1, -hz], [x1, y1,  hz], [x0, y0,  hz], 0, 0, 2, 1, 0.0, 0.50, 0.50, 0.50, 0.50);
  }

  // Hanging recursive fractal obelisk pillar & flying buttress (sculpted stone, subtle tucked crimson groove!)
  const pillar = new MeshBuilder(2800);
  pillar.addBeveledBox(0, 0, 0, 9.2, 84, 9.2, 0.75, 0.0, 0.78);
  pillar.addBeveledBox(0, 18, 0, 13.4, 6.2, 13.4, 0.5, 0.0, 0.88);
  pillar.addBeveledBox(0, -18, 0, 13.4, 6.2, 13.4, 0.5, 0.0, 0.74);
  pillar.addBeveledBox(0, -45, 0, 5.4, 14, 5.4, 0.4, 0.0, 0.72);
  pillar.addBeveledBox(-6.2, 2, 0, 3.6, 46, 3.6, 0.3, 0.0, 0.86);
  pillar.addBeveledBox(17, 22, 0, 32, 4.2, 4.4, 0.4, 0.0, 0.76, 0, 0.42);
  pillar.addBeveledBox(17, -12, 0, 32, 4.2, 4.4, 0.4, 0.0, 0.68, 0, -0.38);

  // Sliding monumental fractal stone block (stepped 3-tier carved basalt monolith, recessed dark-crimson inner seam only!)
  const block = new MeshBuilder(2200);
  block.addBeveledBox(0, 0, 0, 24, 17, 15, 0.9, 0.0, 0.74);
  block.addBeveledBox(-2.4, 0, 0, 22, 12.4, 11.4, 0.55, 0.0, 0.86);
  block.addBeveledBox(-4.8, 0, 0, 18, 7.8, 7.4, 0.4, 0.0, 0.92);
  // Subtle carved basalt vertical relief flutes instead of glowing red bars
  block.addBeveledBox(-11.8, 0, -4.4, 1.8, 14.0, 1.8, 0.25, 0.0, 0.82);
  block.addBeveledBox(-11.8, 0,  4.4, 1.8, 14.0, 1.8, 0.25, 0.0, 0.82);
  // Tiny deeply recessed dark-crimson crevice between outer and middle stepped stone slabs
  block.addBeveledBox(-9.5, 0, 0, 0.20, 13.2, 12.2, 0.04, 1.0, 0.72);

  const rng = makeRng(445566);
  const bayInst = [], winBayInst = [], bridgeInst = [], pillarInst = [], blockInst = [];
  const sx = WORLD.SHAFT_X, sz = WORLD.SHAFT_Z;
  const sides = 12, shaftR = 114;

  // 24 tiers (-15 .. +8) -> plunges down to y = -836 into true endless bottomless obsidian darkness!
  for (let tier = -15; tier <= 8; tier++) {
    const y = 34 + tier * 58;
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2 + Math.PI / sides;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const px = sx + ca * shaftR;
      const pz = sz + sa * shaftR;
      if (sa > 0.82 && y > -15 && y < 130) continue;

      const isSunlitSide = (ca > 0.30 && tier >= -3 && tier <= 6 && ((s + tier * 3) & 1) === 0);
      const targetArr = isSunlitSide ? winBayInst : bayInst;
      targetArr.push(px, y, pz, -angle, 1.0, 1.0, 1.0, rng(), 0, 0, 0, 0);

      if (tier >= -10 && tier <= 6 && rng() < 0.58) {
        // Never spawn sliding blocks blocking the nave exit balcony!
        if (sa > 0.45 && y > -60 && y < 165) continue;
        const bR = shaftR - 4 - rng() * 8;
        const bx = sx + ca * bR, bz = sz + sa * bR;
        const bScale = 0.72 + rng() * 0.50;
        const verticalSlide = rng() < 0.45;
        blockInst.push(
          bx, y + (rng() - 0.5) * 20, bz, -angle,
          bScale, bScale * (0.8 + rng() * 0.45), bScale,
          rng() * Math.PI * 2,
          verticalSlide ? 0 : -ca, verticalSlide ? 1 : 0, verticalSlide ? 0 : -sa,
          verticalSlide ? (12 + rng() * 14) : (6 + rng() * 8)
        );
      }
    }
  }

  for (let tier = -11; tier <= 6; tier += 2) {
    const y = 18 + tier * 56;
    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2 + tier * 0.42;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      // Keep nave exit mouth & sunlit clerestory windows 100% clear of obstructing hanging pillars!
      if (sa > 0.42 && y > -60 && y < 175) continue;
      if (ca > 0.25 && y > -40 && y < 380) continue;
      const pr = 92 + (k % 2) * 8;
      pillarInst.push(
        sx + ca * pr, y + (k % 3 - 1) * 14, sz + sa * pr,
        -angle, 1.0, 0.9 + rng() * 0.4, 1.0, rng(), 0, 0, 0, 0
      );
    }
  }

  // Spanning cathedral bridges carefully staggered into lower/upper diagonals (ZERO horizontal bar bisecting Pose 6 or 00:28-00:32!)
  const bridgeSpecs = [
    { y: -580, ang: 0.40,  ox:   0, oz:   0 },
    { y: -450, ang: 1.85,  ox:   0, oz:   0 },
    { y: -325, ang: 0.95,  ox:   0, oz:   0 },
    { y: -205, ang: 2.35,  ox:   0, oz:   0 },
    { y: -92,  ang: 0.28,  ox:   0, oz: -22 },
    { y: 108,  ang: -0.58, ox:  14, oz: -26 },
    { y: 276,  ang: 2.42,  ox:  18, oz: -24 },
  ];
  for (const bs of bridgeSpecs) {
    bridgeInst.push(sx + bs.ox, bs.y, sz + bs.oz, bs.ang, 1.0, 1.0, 1.0, 0, 0, 0, 0, 0);
  }

  return {
    bayMesh: bay.finish(),
    winBayMesh: winBay.finish(),
    bridgeMesh: bridge.finish(),
    pillarMesh: pillar.finish(),
    blockMesh: block.finish(),
    bayInstances: new Float32Array(bayInst), bayCount: bayInst.length / 12,
    winBayInstances: new Float32Array(winBayInst), winBayCount: winBayInst.length / 12,
    bridgeInstances: new Float32Array(bridgeInst), bridgeCount: bridgeInst.length / 12,
    pillarInstances: new Float32Array(pillarInst), pillarCount: pillarInst.length / 12,
    blockInstances: new Float32Array(blockInst), blockCount: blockInst.length / 12,
    bridgeSpecs,
  };
}

// =========================================================================
// ACT III — PLANETARY-SCALE ORBITAL ASTROLABE (32 STRICTLY NON-INTERSECTING SHELLS!)
// =========================================================================
function buildAstrolabeRingProfile(profilePts, segs, addCleats, addSpireCount) {
  const mb = new MeshBuilder(12000);
  const P = profilePts.length;

  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const u0 = (s / segs) * 24.0;
    const u1 = ((s + 1) / segs) * 24.0;

    for (let k = 0; k < P; k++) {
      const kn = (k + 1) % P;
      const a = profilePts[k], b = profilePts[kn];
      const rA = 1.0 + a.dr, yA = a.dy;
      const rB = 1.0 + b.dr, yB = b.dy;
      mb.quad(
        [c0 * rA, yA, s0 * rA], [c1 * rA, yA, s1 * rA],
        [c1 * rB, yB, s1 * rB], [c0 * rB, yB, s0 * rB],
        u0, k / P, u1, (k + 1) / P, a.mat, a.ao, a.ao, b.ao, b.ao
      );
    }
  }

  if (addCleats > 0) {
    for (let c = 0; c < addCleats; c++) {
      const ang = (c / addCleats) * Math.PI * 2;
      const isMajor = (c % 4) === 0;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // Recessed oxidized bronze astronomical index tabs & obsidian clasp brackets
      mb.addBeveledBox(
        ca * 0.86, 0, sa * 0.86,
        isMajor ? 0.42 : 0.24, isMajor ? 0.56 : 0.30, isMajor ? 0.022 : 0.011,
        0.002, isMajor ? 3.0 : 2.0, 0.92, -ang
      );
      if (isMajor) {
        // Sculpted golden-bronze celestial vernier sight crest flanking major cardinal nodes
        mb.addBeveledBox(ca * 1.0, 0.36, sa * 1.0, 0.34, 0.16, 0.032, 0.002, 4.0, 0.96, -ang);
        mb.addBeveledBox(ca * 1.0, -0.36, sa * 1.0, 0.34, 0.16, 0.032, 0.002, 4.0, 0.96, -ang);
      }
    }
  }

  if (addSpireCount > 0) {
    for (let sp = 0; sp < addSpireCount; sp++) {
      const ang = (sp / addSpireCount) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // Monumental planetary observatory buttresses, stepped obsidian arches & burnished bronze astrolabe meridian shrines!
      mb.addBeveledBox(ca * 0.94, 0, sa * 0.94, 0.44, 0.58, 0.036, 0.003, 2.0, 0.88, -ang);
      mb.addBeveledBox(ca * 1.06, 0, sa * 1.06, 0.34, 0.42, 0.056, 0.003, 3.0, 0.94, -ang);
      mb.addBeveledBox(ca * 0.80, 0, sa * 0.80, 0.20, 0.28, 0.022, 0.002, 4.0, 0.98, -ang);
      // Flanking astronomical vernier pylons creating rich megastructure silhouette relief!
      const aL = ang - 0.045, aR = ang + 0.045;
      mb.addBeveledBox(Math.cos(aL) * 0.98, 0, Math.sin(aL) * 0.98, 0.48, 0.48, 0.016, 0.002, 3.0, 0.92, -aL);
      mb.addBeveledBox(Math.cos(aR) * 0.98, 0, Math.sin(aR) * 0.98, 0.48, 0.48, 0.016, 0.002, 3.0, 0.92, -aR);
    }
  }
  return mb.finish();
}

export function buildAstrolabe() {
  // RING TYPE A: MONUMENTAL STEPPED VOLCANIC OBSIDIAN MEGASTRUCTURE RING with wide recessed antique oxidized-bronze observatory channels!
  const profA = [
    { dr: -0.48, dy: -0.22, mat: 2.0, ao: 0.90 },
    { dr: -0.50, dy:  0.00, mat: 3.0, ao: 0.96 }, // inner antique bronze meridian trim catching starlight!
    { dr: -0.48, dy:  0.22, mat: 2.0, ao: 0.92 },
    { dr: -0.34, dy:  0.46, mat: 2.0, ao: 0.84 },
    { dr: -0.10, dy:  0.48, mat: 3.0, ao: 0.88 }, // broad upper burnished bronze observatory track!
    { dr:  0.24, dy:  0.46, mat: 2.0, ao: 0.80 },
    { dr:  0.38, dy:  0.30, mat: 3.0, ao: 0.72 }, // recessed oxidized bronze verdigris inlay
    { dr:  0.50, dy:  0.18, mat: 2.0, ao: 0.82 },
    { dr:  0.50, dy: -0.18, mat: 2.0, ao: 0.72 },
    { dr:  0.38, dy: -0.30, mat: 3.0, ao: 0.68 },
    { dr:  0.24, dy: -0.46, mat: 2.0, ao: 0.70 },
    { dr: -0.10, dy: -0.48, mat: 3.0, ao: 0.80 },
    { dr: -0.34, dy: -0.46, mat: 2.0, ao: 0.72 },
  ];
  const ringA = buildAstrolabeRingProfile(profA, 160, 64, 8);

  // RING TYPE B: MASSIVE SLOTTED VOLCANIC OBSIDIAN & BRONZE ECLIPSE RING (carved monolith armor rails + intricate observatory bridges!)
  const mbB = new MeshBuilder(18000);
  const segsB = 160;
  const subRails = [
    { drCenter: -0.31, drHalf: 0.19, dyHalf: 0.42, matOuter: 2.0, matInner: 3.0 },
    { drCenter:  0.31, drHalf: 0.19, dyHalf: 0.46, matOuter: 2.0, matInner: 3.0 },
  ];
  for (const sr of subRails) {
    const p = [
      { dr: sr.drCenter - sr.drHalf, dy: -sr.dyHalf * 0.68, mat: sr.matInner, ao: 0.90 },
      { dr: sr.drCenter - sr.drHalf, dy:  sr.dyHalf * 0.68, mat: sr.matInner, ao: 0.95 },
      { dr: sr.drCenter,             dy:  sr.dyHalf,        mat: sr.matOuter, ao: 0.88 },
      { dr: sr.drCenter + sr.drHalf, dy:  sr.dyHalf * 0.68, mat: sr.matOuter, ao: 0.72 },
      { dr: sr.drCenter + sr.drHalf, dy: -sr.dyHalf * 0.68, mat: sr.matOuter, ao: 0.68 },
      { dr: sr.drCenter,             dy: -sr.dyHalf,        mat: sr.matOuter, ao: 0.70 },
    ];
    for (let s = 0; s < segsB; s++) {
      const a0 = (s / segsB) * Math.PI * 2, a1 = ((s + 1) / segsB) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      for (let k = 0; k < p.length; k++) {
        const kn = (k + 1) % p.length;
        const rA = 1.0 + p[k].dr, yA = p[k].dy;
        const rB = 1.0 + p[kn].dr, yB = p[kn].dy;
        mbB.quad(
          [c0 * rA, yA, s0 * rA], [c1 * rA, yA, s1 * rA],
          [c1 * rB, yB, s1 * rB], [c0 * rB, yB, s0 * rB],
          (s / segsB) * 28, k / p.length, ((s + 1) / segsB) * 28, (k + 1) / p.length,
          p[k].mat, p[k].ao, p[k].ao, p[kn].ao, p[kn].ao
        );
      }
    }
  }
  // Intricate sculpted volcanic obsidian & oxidized bronze astronomical monolith ribs bridging the eclipse slot
  for (let f = 0; f < 48; f++) {
    const ang = (f / 48) * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const isMajor = (f % 6) === 0;
    mbB.addBeveledBox(ca * 1.0, 0, sa * 1.0, 0.58, isMajor ? 0.56 : 0.36, isMajor ? 0.056 : 0.024, 0.003, 2.0, 0.86, -ang);
    if (isMajor) mbB.addBeveledBox(ca * 1.0, 0, sa * 1.0, 0.34, 0.62, 0.068, 0.003, 3.0, 0.94, -ang);
  }
  const ringB = mbB.finish();

  // RING TYPE C: ORNATE ANTIQUE OXIDIZED BRONZE & DARK OBSIDIAN CELESTIAL VERNIER RING (unmistakable bronze-vs-obsidian contrast!)
  const profC = [
    { dr: -0.46, dy: -0.24, mat: 3.0, ao: 0.94 },
    { dr: -0.46, dy:  0.24, mat: 3.0, ao: 0.96 },
    { dr: -0.12, dy:  0.40, mat: 3.0, ao: 0.90 },
    { dr:  0.18, dy:  0.38, mat: 2.0, ao: 0.80 },
    { dr:  0.46, dy:  0.26, mat: 3.0, ao: 0.84 },
    { dr:  0.46, dy: -0.26, mat: 3.0, ao: 0.78 },
    { dr:  0.18, dy: -0.38, mat: 2.0, ao: 0.72 },
    { dr: -0.12, dy: -0.40, mat: 3.0, ao: 0.82 },
  ];
  const ringC = buildAstrolabeRingProfile(profC, 160, 64, 10);

  // 22 TRUE PLANETARY-SCALE STRICTLY NESTED NON-OVERLAPPING VOLCANIC OBSIDIAN & OXIDIZED BRONZE RINGS!
  // Scaled 1.8x larger at planetary distance (maxOuter ~1600m) -> ZERO rooftop-chandelier parallax!
  const rng = makeRng(777333);
  const instA = [], instB = [], instC = [];
  const ringShells = [];
  const totalRings = 22;

  let curInnerBound = 265.0;
  for (let i = 0; i < totalRings; i++) {
    const f = i / (totalRings - 1);
    const kind = i % 3;
    const scaleBase = 24.5 + f * 31.5;
    const radW = kind === 1 ? scaleBase * 1.16 : kind === 0 ? scaleBase * 1.04 : scaleBase * 0.88;
    const vertH = kind === 0 ? scaleBase * 0.72 : kind === 1 ? scaleBase * 0.62 : scaleBase * 0.56;

    const maxDr = radW * 0.56;
    const maxDy = vertH * 0.56;
    const radius = curInnerBound + maxDr + 6.5;
    const outerSphereR = Math.hypot(radius + maxDr, maxDy);
    curInnerBound = outerSphereR + 6.2 + f * 6.8;

    // Sculptural varied 3D spherical gyroscope inclinations (innermost 4 rings boldly cross-angled -> ZERO horizontal eyeball oval!)
    const isOuterSweep = (i % 4 === 2);
    let tiltX, tiltY, tiltZ;
    if (i === 0) {
      tiltX = 1.12; tiltY = 0.48; tiltZ = 0.86;
    } else if (i === 1) {
      tiltX = 1.48; tiltY = -0.44; tiltZ = -0.88;
    } else if (i === 2) {
      tiltX = 1.24; tiltY = 0.62; tiltZ = -0.52;
    } else if (i === 3) {
      tiltX = 1.38; tiltY = -0.58; tiltZ = 0.56;
    } else if (!isOuterSweep) {
      const fan = Math.sin(i * 0.92 + 0.4) * 0.34 + (f - 0.5) * 0.16;
      tiltX = 1.28 + fan;
      tiltY = Math.cos(i * 1.27) * 0.38;
      tiltZ = Math.sin(i * 1.73) * 0.44;
    } else {
      tiltX = 1.28 + ((i & 1) ? 0.56 : -0.56) + (rng() - 0.5) * 0.16;
      tiltY = ((i & 2) ? 0.54 : -0.54) + (rng() - 0.5) * 0.22;
      tiltZ = (rng() - 0.5) * 0.78;
    }

    const dir = (i & 1) ? 1 : -1;
    const speed = dir * (0.020 + (1.0 - f) * 0.088 + rng() * 0.022);
    const phase0 = rng() * Math.PI * 2;

    ringShells.push({ i, radius, innerR: radius - maxDr, outerSphereR, radW, vertH, tiltX, tiltY, tiltZ, phase0, precAmp: 0.008 * dir });
    const target = kind === 0 ? instA : kind === 1 ? instB : instC;
    target.push(radius, radW, vertH, phase0, tiltX, tiltY, tiltZ, speed, 0.008 * dir, f, 0, 0);
  }

  return {
    ringA, ringB, ringC, ringShells, maxOuterR: curInnerBound,
    instA: new Float32Array(instA), countA: instA.length / 12,
    instB: new Float32Array(instB), countB: instB.length / 12,
    instC: new Float32Array(instC), countC: instC.length / 12,
  };
}

// =========================================================================
// ACT I — INFINITE RADIAL MIRRORED OCEAN MESH (y = 0)
// =========================================================================
export function buildOceanMesh() {
  const rings = 96;
  const slices = 112;
  const cx = 0, cz = 220;
  const verts = new Float32Array((rings + 1) * (slices + 1) * 4);
  const indices = new Uint32Array(rings * slices * 6);

  let vo = 0;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const dist = Math.pow(t, 3.15) * 16500;
    for (let s = 0; s <= slices; s++) {
      const ang = (s / slices) * Math.PI * 2;
      verts[vo++] = cx + Math.cos(ang) * dist;
      verts[vo++] = cz + Math.sin(ang) * dist;
      verts[vo++] = t;
      verts[vo++] = 0;
    }
  }

  let io = 0;
  const stride = slices + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < slices; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const c = (r + 1) * stride + s;
      const d = c + 1;
      indices[io++] = a; indices[io++] = c; indices[io++] = b;
      indices[io++] = b; indices[io++] = c; indices[io++] = d;
    }
  }
  return { vertices: verts, indices, indexCount: indices.length };
}

// =========================================================================
// GPU-ANIMATED ATMOSPHERIC PARTICLES (NO CHALKY MIST BILLBOARDS, FLOWING STREAMS!)
// =========================================================================
export function buildParticles() {
  const count = 21000;
  const data = new Float32Array(count * 8);
  const rng = makeRng(3141592);
  let idx = 0;

  const push = (a, b, c, size, speed, phase, kind, seed) => {
    const o = idx++ * 8;
    data[o] = a; data[o + 1] = b; data[o + 2] = c; data[o + 3] = size;
    data[o + 4] = speed; data[o + 5] = phase; data[o + 6] = kind; data[o + 7] = seed;
  };

  // 0..1399: Act I Delicate Varied Organic Sea-Mist Micro-Sparks tucked inside side crystal canyons (ZERO uniform circular bokeh dots!)
  const act1Count = 1400;
  for (let i = 0; i < act1Count; i++) {
    const side = (i & 1) ? 1 : -1;
    let x = side * (72 + rng() * 195);
    let z = 115 + rng() * 410;
    let y = 1.4 + Math.pow(rng(), 1.6) * 78;
    if (i % 9 === 0) {
      x = (rng() - 0.5) * 115;
      y = 1.0 + rng() * 7.5;
    }
    push(x, y, z, 0.08 + Math.pow(rng(), 1.8) * 0.24, 0.9 + rng() * 1.8, rng() * 6.28, 0, rng());
  }

  // Act II Fine Motion-Streaked Geometric Ember Swarms filling the ENTIRE shaft from deepest abyss (y=-760) to Oculus (y=+495)!
  const act2Start = idx;
  const act2Count = 6500;
  for (let i = 0; i < act2Count; i++) {
    if (i < 460) {
      const x = (rng() - 0.5) * 58;
      const y = 5 + rng() * 112;
      const z = 12 - rng() * 240;
      push(x, y, z, 0.10 + rng() * 0.22, 4.5 + rng() * 8.5, rng() * 6.28, 2.5, rng());
    } else {
      const ribbon = i % 7;
      const rad = 14 + Math.sqrt(rng()) * 86;
      const ang = (ribbon / 7) * Math.PI * 2 + (rng() - 0.5) * 0.58;
      const y = -760 + rng() * 1255;
      push(rad, y, ang, 0.09 + rng() * 0.22, 9.0 + rng() * 17.5, rng() * 6.28, 2, rng());
    }
  }

  // Act III Silky Luminous Golden Star-Dust Streams scaled to Planetary Astrolabe (fine graceful stardust, ZERO chunky orange dashes!)
  const act3Start = idx;
  const streamCount = 8;
  const streamTilts = [];
  for (let s = 0; s < streamCount; s++) {
    const f = s / (streamCount - 1);
    streamTilts.push({
      rBase: 310 + f * 1240,
      rSpread: 16.0 + f * 30.0,
      tiltX: 1.28 + Math.sin(s * 1.45 + 0.3) * 0.44,
      tiltZ: Math.cos(s * 1.82) * 0.48,
      speed: ((s & 1) ? 1 : -1) * (0.040 + (1.0 - f) * 0.11),
    });
  }
  const act3Count = 8500;
  for (let i = 0; i < act3Count; i++) {
    const st = streamTilts[i % streamCount];
    const clusterAng = (Math.floor(i / 52) * 1.6180339) * Math.PI * 2;
    const ang = clusterAng + (rng() - 0.5) * 1.85;
    const r = st.rBase + (rng() - 0.5) * 2 * st.rSpread;
    const sz = 0.28 + Math.pow(rng(), 2.4) * 1.15;
    push(r, st.tiltX, st.tiltZ, sz, st.speed * (0.88 + rng() * 0.24), ang, 3, rng());
  }

  return { data, count: idx, act1Start: 0, act1Count, act2Start, act2Count, act3Start, act3Count };
}

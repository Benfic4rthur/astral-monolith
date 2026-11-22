// Zero-allocation math utilities and world act blending

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mat4Perspective(out, fovY, aspect, near, far) {
  const f = 1.0 / Math.tan(fovY * 0.5);
  const nf = 1.0 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far * nf;
  out[11] = -1;
  out[14] = far * near * nf;
  return out;
}

export function mat4LookAt(out, ex, ey, ez, tx, ty, tz, ux, uy, uz) {
  let zx = ex - tx, zy = ey - ty, zz = ez - tz;
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}

export function mat4Mul(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    const b0 = b[o], b1 = b[o + 1], b2 = b[o + 2], b3 = b[o + 3];
    out[o]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[o + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[o + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[o + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

export function mat4Invert(out, m) {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

  const b00 = m00 * m11 - m01 * m10;
  const b01 = m00 * m12 - m02 * m10;
  const b02 = m00 * m13 - m03 * m10;
  const b03 = m01 * m12 - m02 * m11;
  const b04 = m01 * m13 - m03 * m11;
  const b05 = m02 * m13 - m03 * m12;
  const b06 = m20 * m31 - m21 * m30;
  const b07 = m20 * m32 - m22 * m30;
  const b08 = m20 * m33 - m23 * m30;
  const b09 = m21 * m32 - m22 * m31;
  const b10 = m21 * m33 - m23 * m31;
  const b11 = m22 * m33 - m23 * m32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return out;
  det = 1.0 / det;

  out[0]  = (m11 * b11 - m12 * b10 + m13 * b09) * det;
  out[1]  = (m02 * b10 - m01 * b11 - m03 * b09) * det;
  out[2]  = (m31 * b05 - m32 * b04 + m33 * b03) * det;
  out[3]  = (m22 * b04 - m21 * b05 - m23 * b03) * det;
  out[4]  = (m12 * b08 - m10 * b11 - m13 * b07) * det;
  out[5]  = (m00 * b11 - m02 * b08 + m03 * b07) * det;
  out[6]  = (m32 * b02 - m30 * b05 - m33 * b01) * det;
  out[7]  = (m20 * b05 - m22 * b02 + m23 * b01) * det;
  out[8]  = (m10 * b10 - m11 * b08 + m13 * b06) * det;
  out[9]  = (m01 * b08 - m00 * b10 - m03 * b06) * det;
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det;
  out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * det;
  out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * det;
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * det;
  out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * det;
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det;
  return out;
}

export const WORLD = {
  SHAFT_X: 0,
  SHAFT_Z: -340,
  OCULUS_Y: 515,
  OCULUS_R: 92,
  STAR_X: 0,
  STAR_Y: 2380,
  STAR_Z: -1780,
};

// Continuous three-act blend weights with wide smooth transitions (ZERO abrupt fog/sky snaps!)
export function computeActWeights(out, x, y, z) {
  // Smoothly cross from cathedral dome into deep space across y = 340 -> 530 (190m seamless blend!)
  const wSpace = smoothstep(340, 530, y);
  // Wide gentle spatial crossfade from mirrored prism sea into cathedral nave across z = +95 -> -115
  const inCath = smoothstep(95, -115, z);
  const wCath = inCath * (1.0 - wSpace);
  // Act I sea strictly reaches 0 inside cathedral (z <= -115) AND above y = 220 (zero leakage into Act III!)
  const wSea = (1.0 - inCath) * (1.0 - smoothstep(140, 220, y)) * (1.0 - wSpace);
  const sum = wSea + wCath + wSpace || 1.0;
  const dPortal = Math.hypot(x * 0.45, z);
  const portalProx = Math.exp(-(dPortal * dPortal) / (115 * 115)) * (1.0 - wSpace);
  out[0] = wSea / sum;
  out[1] = wCath / sum;
  out[2] = wSpace / sum;
  out[3] = portalProx;
  return out;
}

// World-consistent physical boundaries for Free Flight:
// Must enter through the Portal Monolith -> Nave -> Vertical Cathedral Shaft -> Pantheon Oculus -> Space & White Dwarf!
export function clampFreeCamera(pos, prevY = pos[1]) {
  let x = pos[0], y = pos[1], z = pos[2];
  const dxS = x - WORLD.SHAFT_X;
  const dzS = z - WORLD.SHAFT_Z;
  const rShaft = Math.hypot(dxS, dzS);

  // Realm III: Outer Space above Pantheon Dome Roof (reachable ONLY by ascending through the Oculus!)
  if (prevY >= 520) {
    if (y > 4600) y = 4600;
    if (z > 1600) z = 1600;
    if (z < -4800) z = -4800;
    if (x < -2800) x = -2800;
    if (x > 2800) x = 2800;
    // Solid outer obsidian citadel roof blocks descending except straight back down through the circular Oculus (r <= 76)!
    if (y < 528 && rShaft > 76) y = 528;
  } else if (z > 18) {
    // Realm I: Mirrored Prism Sea — cannot fly over or around the Portal Monolith to bypass the Cathedral!
    if (y < 3.4) y = 3.4;
    if (y > 118) y = 118;
    if (z > 590) z = 590;
    if (x < -540) x = -540;
    if (x > 540) x = 540;
  } else if (z > -226) {
    // Portal Threshold & Vaulted Cathedral Nave corridor (only reachable through the central portal cleft!)
    if (Math.abs(x) > 23.5) {
      if (z > 6) {
        z = 18.5;
      } else {
        x = Math.sign(x) * 23.5;
      }
    }
    if (y < 7.5) y = 7.5;
    if (y > 112) y = 112;
  } else {
    // Realm II: Vertical Fractal Cathedral Shaft & Inward-Curving Pantheon Dome (z <= -226, prevY < 520)
    if (y < -660) y = -660;
    const domeT = smoothstep(445, 515, y);
    const maxR = lerp(96, 76, domeT);
    const inNaveMouth = (z > -246 && Math.abs(x) < 23.5 && y > 6.5 && y < 114);
    if (!inNaveMouth && rShaft > maxR) {
      const s = maxR / rShaft;
      x = WORLD.SHAFT_X + dxS * s;
      z = WORLD.SHAFT_Z + dzS * s;
    }
  }

  // Keep slight buffer around White Dwarf core center
  const sx = x - WORLD.STAR_X, sy = y - WORLD.STAR_Y, sz = z - WORLD.STAR_Z;
  const sd = Math.hypot(sx, sy, sz);
  if (sd < 160 && sd > 0.001) {
    const s = 160 / sd;
    x = WORLD.STAR_X + sx * s;
    y = WORLD.STAR_Y + sy * s;
    z = WORLD.STAR_Z + sz * s;
  }
  pos[0] = x; pos[1] = y; pos[2] = z;
}

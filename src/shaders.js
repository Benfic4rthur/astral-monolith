// All WGSL shaders + GPU procedural 512x512 mipmapped PBR texture baker (100% procedural)

export const BAKE_TEX_WGSL = /* wgsl */ `
struct BakeParam { mode: f32, p1: f32, p2: f32, p3: f32 };
@group(0) @binding(0) var<uniform> bp: BakeParam;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_bake(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

// Seamless periodic 2D hash & tileable value noise (period = per)
fn phash(ip: vec2<f32>, per: vec2<f32>) -> f32 {
  let w = ((ip % per) + per) % per;
  var p3 = fract(vec3<f32>(w.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn phash2(ip: vec2<f32>, per: vec2<f32>) -> vec2<f32> {
  let a = phash(ip, per);
  let b = phash(ip + vec2<f32>(17.0, 31.0), per);
  return vec2<f32>(a, b);
}

fn pnoise(uv: vec2<f32>, per: vec2<f32>) -> f32 {
  let p = uv * per;
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(phash(i, per), phash(i + vec2<f32>(1.0, 0.0), per), u.x),
    mix(phash(i + vec2<f32>(0.0, 1.0), per), phash(i + vec2<f32>(1.0, 1.0), per), u.x),
    u.y
  );
}

// Seamless tileable 6-octave ridged/chiseled FBM
fn pfbm(uv: vec2<f32>, basePer: f32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var per = basePer;
  for (var i = 0; i < 6; i++) {
    sum += amp * pnoise(uv, vec2<f32>(per));
    per *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

fn pridge(uv: vec2<f32>, basePer: f32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var per = basePer;
  for (var i = 0; i < 6; i++) {
    let n = 1.0 - abs(pnoise(uv, vec2<f32>(per)) * 2.0 - 1.0);
    sum += amp * n * n;
    per *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

// Seamless tileable Voronoi cellular facets (F1, F2-F1 edge distance, cell ID)
fn pvoronoi(uv: vec2<f32>, per: f32) -> vec3<f32> {
  let p = uv * per;
  let n = floor(p);
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2<f32>(f32(x), f32(y));
      let o = phash2(n + g, vec2<f32>(per));
      let d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; id = o.x; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3<f32>(f1, f2 - f1, id);
}

// 1. PHOTOREAL CYCLOPEAN CHISELED VOLCANIC BASALT MONOLITH HEIGHT (layered strata + chisel grain — ZERO hexagonal Voronoi tiling!)
fn stoneHeight(uv: vec2<f32>) -> vec3<f32> {
  // Monumental cyclopean weathered basalt blocks with natural horizontal sedimentary/volcanic cleavage strata
  let row = floor(uv.y * 2.0);
  let fy = fract(uv.y * 2.0);
  let fx = fract(uv.x * 1.0 + row * 0.5);
  let blockId = phash(vec2<f32>(floor(uv.x + row * 0.5), row), vec2<f32>(1.0, 2.0));

  let jY = smoothstep(0.0, 0.018, fy) * smoothstep(1.0, 0.982, fy);
  let jX = smoothstep(0.0, 0.014, fx) * smoothstep(1.0, 0.986, fx);
  let seam = mix(0.62, 1.0, jX * jY);

  let strataWarp = pfbm(uv + vec2<f32>(blockId * 0.37, 0.13), 3.0);
  let strata = pfbm(uv * vec2<f32>(1.0, 4.0) + vec2<f32>(0.0, strataWarp * 0.22), 5.0);
  let macroCleavage = pridge(uv * vec2<f32>(1.0, 2.0) + vec2<f32>(0.21, blockId * 0.43), 4.0);
  let chiselMarks = pnoise(uv, vec2<f32>(8.0, 48.0)) * 0.55 + pnoise(uv, vec2<f32>(16.0, 96.0)) * 0.45;
  let fineGrain = pfbm(uv, 18.0);
  let pits = smoothstep(0.20, 0.44, pnoise(uv, vec2<f32>(64.0)) * 0.6 + pnoise(uv, vec2<f32>(128.0)) * 0.4);

  let h = (0.26 + 0.28 * macroCleavage + 0.22 * strata + 0.12 * chiselMarks + 0.07 * fineGrain + 0.05 * pits) * seam;
  let albedo = clamp((0.34 + 0.28 * macroCleavage + 0.20 * strata + 0.10 * chiselMarks + 0.08 * fineGrain) * seam * (0.82 + 0.18 * pits), 0.0, 1.0);
  let rough = clamp(0.94 - 0.20 * macroCleavage * pits, 0.52, 0.98);
  return vec3<f32>(h, albedo, rough);
}

// 2. PHOTOREAL ENGRAVED ASTROLABE BRUSHED BRONZE & VOLCANIC OBSIDIAN MATERIAL HEIGHT
fn metalHeight(uv: vec2<f32>) -> vec3<f32> {
  // Fine anisotropic brushed bronze streaks along circumferential U + ancient carved astronomical degree graduations!
  let brush = pnoise(vec2<f32>(uv.x, uv.y), vec2<f32>(8.0, 96.0)) * 0.6
            + pnoise(vec2<f32>(uv.x, uv.y), vec2<f32>(16.0, 192.0)) * 0.4;
  let fineScratch = pnoise(uv, vec2<f32>(4.0, 64.0));
  let vor = pvoronoi(uv, 6.0);
  // Engraved ancient celestial vernier tick grooves & recessed longitudinal inlay channels!
  let grooveY = smoothstep(0.06, 0.14, abs(fract(uv.y * 2.0) - 0.5)) * smoothstep(0.05, 0.12, abs(fract(uv.y * 4.0) - 0.5));
  let tickBand = smoothstep(0.32, 0.24, abs(uv.y - 0.5));
  let ticks = 1.0 - tickBand * smoothstep(0.08, 0.02, abs(fract(uv.x * 16.0) - 0.5)) * 0.65;
  let patinaPatch = smoothstep(0.34, 0.72, pfbm(uv, 6.0) * 0.65 + (1.0 - vor.x) * 0.25 + (1.0 - grooveY) * 0.35);
  let h = (0.36 * brush + 0.20 * fineScratch + 0.26 * vor.x + 0.18 * grooveY) * ticks;
  let grain = clamp((0.35 + 0.45 * brush + 0.20 * fineScratch) * (0.68 + 0.32 * grooveY * ticks), 0.0, 1.0);
  return vec3<f32>(h, grain, patinaPatch);
}

// 3. OPTICALLY PURE SMOOTH MINERAL QUARTZ CRYSTAL MAP (ZERO GRIDS, ZERO LINES — PURE POLISHED GLASS + SUBTLE CLOUD VEILS!)
fn crystalMap(uv: vec2<f32>) -> vec4<f32> {
  // Ultra-fine organic horizontal quartz growth micro-banding (subtle surface optical realism)
  let stria = pnoise(uv, vec2<f32>(2.0, 48.0)) * 0.6 + pnoise(uv, vec2<f32>(4.0, 96.0)) * 0.4;
  // Soft non-periodic cloudy mineral quartz internal veil (like real smoky/glacial quartz inclusions, ZERO crosshatch!)
  let veil1 = pfbm(uv * vec2<f32>(1.0, 2.0), 3.0);
  let veil2 = pfbm(uv + vec2<f32>(0.41, 0.27), 5.0);
  let cleavage = smoothstep(0.42, 0.86, veil1 * 0.65 + veil2 * 0.35);
  let caustic = pow(clamp(pridge(uv, 4.0) * 0.8 + veil2 * 0.2, 0.0, 1.0), 2.6);
  let tilt = clamp(0.5 + (veil1 - 0.5) * 0.35 + (stria - 0.5) * 0.15, 0.0, 1.0);
  return vec4<f32>(cleavage, stria, caustic, tilt);
}

@fragment
fn fs_bake(inp: VSOut) -> @location(0) vec4<f32> {
  let uv = inp.uv;
  let e = 1.0 / 512.0;

  if (bp.mode < 0.5) {
    let c = stoneHeight(uv);
    let hx = stoneHeight(uv + vec2<f32>(e, 0.0)).x - stoneHeight(uv - vec2<f32>(e, 0.0)).x;
    let hy = stoneHeight(uv + vec2<f32>(0.0, e)).x - stoneHeight(uv - vec2<f32>(0.0, e)).x;
    let nx = clamp(hx * 5.4 + 0.5, 0.0, 1.0);
    let ny = clamp(hy * 5.4 + 0.5, 0.0, 1.0);
    return vec4<f32>(nx, ny, c.y, c.z);
  } else if (bp.mode < 1.5) {
    let c = metalHeight(uv);
    let hx = metalHeight(uv + vec2<f32>(e, 0.0)).x - metalHeight(uv - vec2<f32>(e, 0.0)).x;
    let hy = metalHeight(uv + vec2<f32>(0.0, e)).x - metalHeight(uv - vec2<f32>(0.0, e)).x;
    let nx = clamp(hx * 3.2 + 0.5, 0.0, 1.0);
    let ny = clamp(hy * 3.2 + 0.5, 0.0, 1.0);
    return vec4<f32>(nx, ny, c.y, c.z);
  }
  return crystalMap(uv);
}

// Fast 4-tap box downsample for generating crisp hardware mipmaps on startup
@group(0) @binding(1) var mipSrc: texture_2d<f32>;
@group(0) @binding(2) var mipSamp: sampler;

@fragment
fn fs_mip(inp: VSOut) -> @location(0) vec4<f32> {
  return textureSampleLevel(mipSrc, mipSamp, inp.uv, 0.0);
}
`;

export const COMMON_WGSL = /* wgsl */ `
struct U {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  reflViewProj: mat4x4<f32>,
  camPos: vec4<f32>,     // xyz = pos, w = time
  camFwd: vec4<f32>,     // xyz = fwd, w = aspect
  camRight: vec4<f32>,   // xyz = right, w = tanHalfFov
  camUp: vec4<f32>,      // xyz = up, w = frameIdx
  actW: vec4<f32>,       // x=wSea, y=wCath, z=wSpace, w=portalProx
  starPos: vec4<f32>,    // xyz = white dwarf pos, w = pulsePhase
  starScreen: vec4<f32>, // xy = uv, z = depth, w = onScreenWeight
  res: vec4<f32>,        // x=w, y=h, z=1/w, w=1/h
  flags: vec4<f32>,      // x=isRefl, y=clipY, z=exposure, w=supernova
  ringPlanes: array<vec4<f32>, 22>, // xyz = unit normal of orbital ring plane at time t, w = ring radius
  ringHalfH: array<vec4<f32>, 6>,   // packed half-height (vertH * 0.48) for rings 0..21
};

const PI: f32 = 3.14159265359;
const CATH_SUN_DIR: vec3<f32> = vec3<f32>(0.64, 0.65, 0.41);
const SEA_SUN_DIR: vec3<f32> = vec3<f32>(0.72, 0.36, 0.59);
const GAS_GIANT_DIR: vec3<f32> = vec3<f32>(-0.02, 0.242, -0.970);

fn evalOceanCaustics(xz: vec2<f32>, t: f32) -> f32 {
  // Dual-wave analytical liquid refractive caustics web dancing across shallow water & crystal bases!
  let p1 = xz * 0.145 + vec2<f32>(t * 0.32, -t * 0.24);
  let p2 = vec2<f32>(xz.x * 0.12 - xz.y * 0.15, xz.x * 0.15 + xz.y * 0.12) + vec2<f32>(-t * 0.27, t * 0.35);
  let w1 = abs(sin(p1.x + cos(p1.y * 1.15 + t * 0.4)) + cos(p1.y - sin(p1.x * 1.10 - t * 0.35)));
  let w2 = abs(sin(p2.x - cos(p2.y * 1.20 - t * 0.3)) + cos(p2.y + sin(p2.x * 1.05 + t * 0.45)));
  let c1 = pow(clamp(1.0 - w1 * 0.52, 0.0, 1.0), 4.2);
  let c2 = pow(clamp(1.0 - w2 * 0.52, 0.0, 1.0), 4.2);
  return clamp((c1 + c2) * 0.72, 0.0, 1.25);
}

fn hash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash13(p3_in: vec3<f32>) -> f32 {
  var p3 = fract(p3_in * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash33(p3_in: vec3<f32>) -> vec3<f32> {
  var p3 = fract(p3_in * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i + vec2<f32>(0.0, 0.0)), hash12(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}

fn fbm2(p_in: vec2<f32>) -> f32 {
  var p = p_in;
  var a = 0.5;
  var sum = 0.0;
  for (var i = 0; i < 4; i++) {
    sum += a * noise2(p);
    p = vec2<f32>(p.x * 1.68 - p.y * 1.12, p.x * 1.12 + p.y * 1.68) + vec2<f32>(13.7, 7.3);
    a *= 0.5;
  }
  return sum;
}

fn fbm3(p_in: vec3<f32>) -> f32 {
  var p = p_in;
  var a = 0.5;
  var sum = 0.0;
  for (var i = 0; i < 3; i++) {
    sum += a * noise3(p);
    p = p * 2.07 + vec3<f32>(17.3, 9.1, 23.7);
    a *= 0.5;
  }
  return sum;
}

fn ign(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn specAAVar(v: f32, rough: f32) -> f32 {
  // Strong Kaplanyan/Toksvig geometric normal variance filtering -> eliminates specular fireflies & stair-step shimmer on rings & crystals!
  return sqrt(clamp(rough * rough + min(5.4 * v, 0.56), 0.012, 1.0));
}

fn ggxSpec(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, rough: f32, F0: vec3<f32>) -> vec3<f32> {
  let H = normalize(V + L);
  let ndl = max(dot(N, L), 0.0);
  let ndv = max(dot(N, V), 0.001);
  let ndh = max(dot(N, H), 0.0);
  let vdh = max(dot(V, H), 0.0);
  let a = rough * rough;
  let a2 = a * a;
  let dDen = ndh * ndh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dDen * dDen + 1e-5);
  let k = (rough + 1.0) * (rough + 1.0) * 0.125;
  let g1 = ndv / (ndv * (1.0 - k) + k);
  let g2 = ndl / (ndl * (1.0 - k) + k);
  let F = F0 + (vec3<f32>(1.0) - F0) * pow(1.0 - vdh, 5.0);
  return (D * g1 * g2 * F) / (4.0 * ndv * ndl + 0.001) * ndl;
}

fn evalSeaHorizonColor(rd: vec3<f32>) -> vec3<f32> {
  // Seamless deep midnight silver-navy horizon mist blending imperceptibly into upper dark aurora sky (ZERO horizontal shelf!)
  let baseMist = vec3<f32>(0.014, 0.032, 0.058);
  let cyanTint = vec3<f32>(0.008, 0.038, 0.062);
  let gAlign = pow(max(dot(normalize(vec3<f32>(rd.x, 0.0, rd.z)), normalize(vec3<f32>(GAS_GIANT_DIR.x, 0.0, GAS_GIANT_DIR.z))), 0.0), 3.0);
  return baseMist + cyanTint * 0.34 + vec3<f32>(0.018, 0.020, 0.036) * gAlign;
}

fn applyAtmosphericFog(col: vec3<f32>, wPos: vec3<f32>, dist: f32, rd: vec3<f32>, u: U) -> vec3<f32> {
  // Wide 190m seamless cathedral dome-to-space atmospheric fade (ZERO abrupt fog pop crossing the Pantheon Oculus!)
  let camInSpace = clamp(smoothstep(0.01, 0.85, u.actW.z) + smoothstep(340.0, 530.0, u.camPos.y) * 0.85, 0.0, 1.0);
  let fragSpace = smoothstep(360.0, 525.0, wPos.y);
  let wSpace = clamp(max(u.actW.z, mix(camInSpace, fragSpace, 0.45)), 0.0, 1.0);
  // Wide natural spatial Act I -> Act II transition across z = +95 .. -115
  let fragCath = smoothstep(95.0, -115.0, wPos.z) * (1.0 - wSpace);
  let wCath = mix(u.actW.y, fragCath, 0.68) * (1.0 - wSpace);
  let wSea = max(0.0, 1.0 - wCath - wSpace) * smoothstep(220.0, 120.0, u.camPos.y);

  let seaNearCol = vec3<f32>(0.006, 0.038, 0.064);
  let seaFarCol  = evalSeaHorizonColor(rd);
  let seaDistT = smoothstep(45.0, 520.0, dist);
  let seaHeightFade = exp(-max(wPos.y, 0.0) * 0.0044);
  let seaFogCol = mix(seaNearCol, seaFarCol, seaDistT);
  let seaDensity = 0.00090 * (0.48 + 0.65 * seaHeightFade);
  let seaFogF = clamp(1.0 - exp(-dist * seaDensity) + smoothstep(260.0, 1150.0, dist), 0.0, 1.0);

  // Act II: Cool chiseled slate-graphite atmospheric depth plunging into smoky abyss (ZERO muddy khaki-tan washout!)
  let sunAlign = pow(max(dot(rd, normalize(CATH_SUN_DIR)), 0.0), 6.0);
  let abyssFactor = smoothstep(-25.0, -320.0, wPos.y);
  let cathDark = mix(vec3<f32>(0.012, 0.016, 0.025), vec3<f32>(0.006, 0.009, 0.015), abyssFactor);
  let cathIvory = vec3<f32>(0.24, 0.21, 0.16);
  let cathFogCol = mix(cathDark, cathIvory, sunAlign * 0.18 * (1.0 - abyssFactor * 0.94));
  let cathDensity = mix(0.00135, 0.0054, abyssFactor);
  let cathFogF = 1.0 - exp(-dist * cathDensity);

  // Act III: Rich near-black deep space indigo
  let spaceFogCol = vec3<f32>(0.0014, 0.0028, 0.011);
  let spaceFogF = 1.0 - exp(-dist * 0.00003);

  let fogCol = seaFogCol * wSea + cathFogCol * wCath + spaceFogCol * wSpace;
  let fogF = clamp(seaFogF * wSea + cathFogF * wCath + spaceFogF * wSpace, 0.0, 1.0);
  return mix(col, fogCol, fogF);
}
`;

// =========================================================================
// 1. PROCEDURAL COSMIC SKY + PHOTOREAL BANDED GAS GIANT + GEOMETRIC AURORAS + WHITE DWARF
// =========================================================================
export const SKY_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_sky(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4<f32>(p[vi], 1.0, 1.0);
  o.uv = p[vi] * 0.5 + 0.5;
  return o;
}

fn geoFold(x: f32) -> f32 {
  return sin(x) * 0.72 + sin(x * 3.0) * 0.16 + sin(x * 5.0) * 0.05;
}

fn evalGeometricAurora(rd: vec3<f32>, t: f32) -> vec3<f32> {
  if (rd.y < 0.03) { return vec3<f32>(0.0); }
  let az = atan2(rd.x, -rd.z);
  let elev = asin(clamp(rd.y, 0.0, 1.0));
  var accum = vec3<f32>(0.0);

  // Two majestic asymmetric diagonal folded magnetic aurora curtains (ZERO evenly-stacked horizontal stripes!)
  for (var i = 0; i < 2; i++) {
    let fi = f32(i);
    let drift = t * (0.024 + fi * 0.012) * select(-1.0, 1.0, i == 0);
    let slope = select(0.11, -0.09, i == 0) * sin(az * 0.85 + fi * 1.4);
    let xCoord = az * (1.85 + fi * 0.95) + drift + fi * 2.15;
    let fold = geoFold(xCoord) * 0.088 + geoFold(xCoord * 2.3 - drift * 1.3) * 0.030;
    let baseElev = 0.14 + fi * 0.14 + slope + fold;

    let hAbove = elev - baseElev;
    let lowerEdge = smoothstep(-0.007, 0.012, hAbove);
    let upperFade = exp(-max(hAbove, 0.0) * (5.2 - fi * 0.6));
    let curtainMask = lowerEdge * upperFade;

    // Fine vertical magnetic ray striations with high-frequency crystalline shimmer
    let rayCoord = az * (38.0 + fi * 16.0) + fold * 26.0 + drift * 4.0;
    let flutes = 0.18 + 0.82 * pow(0.5 + 0.5 * sin(rayCoord) * cos(rayCoord * 0.43 + fi * 2.3), 1.9);
    let microRays = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(az * (94.0 + fi * 28.0) - drift * 6.5 + fold * 36.0), 2.4);
    let fineFilaments = 0.55 + 0.45 * fbm2(vec2<f32>(az * (28.0 + fi * 8.0) + drift, hAbove * 2.6 + fi * 4.0));
    let azEnvelope = smoothstep(0.15, 0.55, 0.5 + 0.5 * cos(az * (1.3 + fi * 0.7) + fi * 1.8));

    let vGrad = clamp(hAbove * 4.4, 0.0, 1.0);
    let cyanCol = vec3<f32>(0.04, 1.55, 1.62);
    let violetCol = vec3<f32>(0.48, 0.22, 1.15);
    let col = mix(cyanCol, violetCol, smoothstep(0.16, 0.72, vGrad));

    let spineGlow = exp(-abs(hAbove - 0.008) * 65.0) * 0.92;
    accum += col * (curtainMask + spineGlow * lowerEdge) * flutes * microRays * fineFilaments * azEnvelope * (0.72 - fi * 0.14);
  }
  return accum * smoothstep(0.03, 0.10, rd.y);
}

fn evalGasGiant(rd: vec3<f32>, t: f32, outAlpha: ptr<function, f32>) -> vec3<f32> {
  let pDir = normalize(GAS_GIANT_DIR);
  let pDist = 10.0;
  let pRad = 3.20;
  let oc = -pDir * pDist;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - pRad * pRad;
  let disc = b * b - c;

  let tilt = 0.26;
  let up0 = normalize(vec3<f32>(sin(tilt), cos(tilt), 0.08));
  let right0 = normalize(cross(up0, -pDir));
  let fwd0 = cross(right0, up0);
  // Dramatic grazing side-solar illumination -> sculptural curved crescent night-side terminator (ZERO hairline ring scratch!)
  let planetSun = normalize(vec3<f32>(0.88, 0.24, 0.18));

  let angCos = dot(rd, pDir);
  let rimHalo = pow(clamp((angCos - 0.84) / 0.16, 0.0, 1.0), 5.5) * vec3<f32>(0.12, 0.28, 0.52);

  if (disc < 0.0) {
    *outAlpha = 0.0;
    return rimHalo;
  }

  let hitT = -b - sqrt(disc);
  let hitP = rd * hitT - pDir * pDist;
  let N = normalize(hitP);

  let lx = dot(N, right0);
  let ly = dot(N, up0);
  let lz = dot(N, fwd0);
  let lon = atan2(lx, lz) + t * 0.0035;
  let lat = asin(clamp(ly, -1.0, 1.0));

  // High-resolution Cassini-grade multi-octave turbulent Kelvin-Helmholtz cloud belts & fine micro-filaments!
  let shear = sin(lat * 22.0) * 0.12 + sin(lat * 48.0) * 0.04;
  let warp1 = fbm2(vec2<f32>(lon * 5.2 + shear, lat * 14.0)) * 0.095;
  let warp2 = fbm2(vec2<f32>(lon * 19.0 + warp1 * 6.0, lat * 44.0)) * 0.032;
  let warp3 = fbm2(vec2<f32>(lon * 44.0 - warp2 * 8.0, lat * 96.0)) * 0.012;
  let bLat = lat + warp1 + warp2 + warp3;

  let z1 = 0.5 + 0.5 * sin(bLat * 28.0);
  let z2 = 0.5 + 0.5 * sin(bLat * 68.0 + 1.2 + warp2 * 14.0);
  let z3 = 0.5 + 0.5 * cos(bLat * 142.0 - 0.6 + warp3 * 22.0);
  let z4 = 0.5 + 0.5 * sin(bLat * 16.0 + 0.4);

  let creamZone  = vec3<f32>(0.97, 0.89, 0.75);
  let amberBelt  = vec3<f32>(0.68, 0.36, 0.19);
  let ochreFine  = vec3<f32>(0.84, 0.56, 0.32);
  let slateBand  = vec3<f32>(0.22, 0.28, 0.44);
  let deepBelt   = vec3<f32>(0.11, 0.15, 0.25);

  var albedo = mix(deepBelt, amberBelt, smoothstep(0.20, 0.78, z1));
  albedo = mix(albedo, ochreFine, smoothstep(0.32, 0.82, z3) * 0.55);
  albedo = mix(albedo, creamZone, smoothstep(0.42, 0.88, z2) * 0.72);
  albedo = mix(albedo, slateBand, smoothstep(0.38, 0.82, z4) * 0.36);
  let microWisp = fbm2(vec2<f32>(lon * 52.0 + warp2 * 14.0, lat * 112.0));
  albedo *= (0.76 + 0.44 * microWisp);

  // Anticyclonic storm oval with crisp swirling eye bands
  let vDelta = vec2<f32>((lon - 0.28) * 0.72, (lat + 0.10) * 1.85);
  let vDist = length(vDelta);
  if (vDist < 0.26) {
    let swirl = smoothstep(0.26, 0.02, vDist);
    let vAng = atan2(vDelta.y, vDelta.x) + swirl * 6.2;
    let vTex = 0.5 + 0.5 * sin(vAng * 2.0 + vDist * 36.0);
    let stormCol = mix(vec3<f32>(0.86, 0.34, 0.18), vec3<f32>(0.98, 0.90, 0.76), vTex * 0.54);
    albedo = mix(albedo, stormCol, swirl * 0.88);
  }

  // True 3D spherical lighting: dramatic curved night-side shadow crescent + limb darkening + ice-cyan Rayleigh rim!
  let ndl = dot(N, planetSun);
  let ndv = max(dot(N, -rd), 0.001);
  let terminator = smoothstep(-0.08, 0.44, ndl);
  let lommel = max(ndl, 0.0) / (max(ndl, 0.06) + ndv * 0.78 + 0.20) * 2.05;
  let limbDark = pow(ndv, 0.78);
  let rayleighRim = pow(1.0 - ndv, 3.4) * smoothstep(-0.18, 0.45, ndl);
  let termWarm = exp(-pow((ndl - 0.06) * 5.4, 2.0)) * vec3<f32>(0.48, 0.18, 0.08) * limbDark;

  let litPlanet = albedo * (vec3<f32>(0.0025, 0.0055, 0.015) + vec3<f32>(1.78, 1.48, 1.20) * lommel * terminator * limbDark)
                + termWarm
                + vec3<f32>(0.28, 0.72, 1.38) * rayleighRim * 1.30;

  *outAlpha = 1.0;
  return litPlanet;
}

fn evalDeepSpace(rd: vec3<f32>, t: f32) -> vec3<f32> {
  let galLat = abs(dot(rd, normalize(vec3<f32>(0.32, 0.82, 0.48))));
  let nebN1 = noise3(rd * 3.4 + vec3<f32>(1.2, 0.4, 2.7));
  let nebN2 = noise3(rd * 8.6 - vec3<f32>(nebN1 * 1.6, 0.5, nebN1 * 1.1));
  let nebBand = exp(-galLat * 4.0) * smoothstep(0.30, 0.85, nebN1 * 0.62 + nebN2 * 0.38);
  let dustFilament = exp(-galLat * 6.2) * pow(clamp(1.0 - abs(nebN2 * 2.0 - 1.0), 0.0, 1.0), 2.4);
  // Rich Webb-grade deep-space indigo backdrop + luminous cobalt-violet galactic clouds + faint golden dust wisps!
  var col = vec3<f32>(0.0014, 0.0029, 0.0115)
          + vec3<f32>(0.0092, 0.020, 0.058) * nebBand
          + vec3<f32>(0.024, 0.012, 0.048) * pow(nebBand, 2.0)
          + vec3<f32>(0.026, 0.017, 0.008) * dustFilament * 0.90;

  // Razor-crisp 3-layer astronomical pinpoint starfield (thousands of subpixel sharp stars with temperature diversity!)
  for (var layer = 0; layer < 3; layer++) {
    let scale = select(select(160.0, 325.0, layer == 1), 590.0, layer == 2);
    let sp = rd * scale;
    let id = floor(sp);
    let f = fract(sp) - 0.5;
    let h = hash33(id + f32(layer) * 23.7);
    let offset = (h - 0.5) * 0.58;
    let d = length(f - offset);
    let thresh = select(select(0.870, 0.902, layer == 1), 0.922, layer == 2);
    if (h.x > thresh) {
      let mag = pow((h.x - thresh) / (1.0 - thresh), 1.9);
      let bright = mag * select(select(6.4, 3.3, layer == 1), 1.85, layer == 2);
      let starRadius = select(select(0.062, 0.046, layer == 1), 0.036, layer == 2);
      let core = pow(smoothstep(starRadius, 0.0, d), 1.55);
      let sCol = mix(vec3<f32>(0.64, 0.89, 1.0), vec3<f32>(1.0, 0.86, 0.60), h.y);
      col += sCol * core * bright;
    }
  }
  return col;
}

fn evalWhiteDwarf(rd: vec3<f32>, camPos: vec3<f32>, starPos: vec3<f32>, t: f32, pulsePhase: f32, sn: f32) -> vec3<f32> {
  let toStar = starPos - camPos;
  let distToStar = length(toStar);
  let starDir = toStar / max(distToStar, 0.001);
  let proj = dot(toStar, rd);
  if (proj <= 0.0) { return vec3<f32>(0.0); }

  let closest = rd * proj - toStar;
  let perpDist = length(closest);
  let sn2 = sn * sn;
  let sn3 = sn2 * sn;
  // Compact hyper-dense white dwarf expanding cleanly without any sudden texture pop!
  let coreScale = 1.0 + sn2 * 2.2 + sn3 * 16.0;
  let coreR = 64.0 * coreScale;
  let rNorm = perpDist / coreR;

  let upRef = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(starDir.y) > 0.92);
  let sRight = normalize(cross(upRef, starDir));
  let sUp = cross(starDir, sRight);
  let px = dot(closest, sRight) / coreR;
  let py = dot(closest, sUp) / coreR;
  let ang = atan2(py, px);

  let ray1 = fbm2(vec2<f32>(ang * 5.5 + t * 0.14, rNorm * 0.72 - t * 0.24));
  let coronaTex = 0.55 + 0.65 * ray1;

  let coreDisk = smoothstep(1.02, 0.65, rNorm);
  let gran = 0.90 + 0.20 * noise2(vec2<f32>(px, py) * 5.0 + vec2<f32>(t * 0.35, -t * 0.25));
  let coreTint = mix(vec3<f32>(28.0, 32.0, 44.0), vec3<f32>(52.0, 48.0, 42.0), smoothstep(0.0, 0.70, sn));
  let coreCol = coreTint * coreDisk * gran;

  // Tight luminous icy-blue white-dwarf corona smoothly intensifying during supernova ignition (ZERO flat circular disc!)
  let innerGlow = exp(-max(rNorm - 0.84, 0.0) * mix(4.8, 1.6, sn)) * mix(vec3<f32>(2.2, 4.2, 8.0), vec3<f32>(5.5, 4.8, 3.8), sn) * coronaTex;
  let pulseSurge = exp(-pow((pulsePhase - 0.08) * 6.5, 2.0)) * exp(-max(rNorm - 0.88, 0.0) * 2.6) * coronaTex;
  let pulseGlow = vec3<f32>(0.42, 0.85, 1.80) * pulseSurge * 0.75;

  // RADIANT INTERSTELLAR / HUBBLE SPECTRAL SUPERNOVA SHOCKWAVE (crisp electric-sapphire & incandescent diamond-gold shock shells — ZERO muddy brown FBM noise, ZERO symmetric blob ring!)
  var snShock = vec3<f32>(0.0);
  if (sn > 0.001) {
    let rWorld = perpDist / 72.0;
    let snEase = sn * sn * (3.0 - 2.0 * sn); // C1 smooth zero-pop onset!
    let blastR = 1.0 + sn * 8.5 + sn3 * 24.0;
    let rn = rWorld / max(blastR, 0.5);

    // Fine continuous turbulent astrophysical plasma filaments (strictly high-frequency lacy filaments, NEVER muddy low-freq brown clouds!)
    let uF = vec2<f32>(cos(ang), sin(ang)) * (1.8 + rn * 2.6);
    let w1 = fbm2(uF * 2.2 - vec2<f32>(sn * 2.8, -sn * 1.9));
    let w2 = fbm2(uF * 5.4 + vec2<f32>(w1 * 2.4, -sn * 4.2));
    let lace = pow(clamp(1.0 - abs(w2 * 2.0 - 1.0), 0.0, 1.0), 2.8);
    // Gentle organic non-periodic shock front distortion (no periodic sin(13*ang) blobs!)
    let rnOrganic = rn / max(0.70, 0.88 + w1 * 0.30);

    // 1. Razor-crisp Leading Electric Sapphire-Cyan Ionized O-III Shock Shell
    let leadWave = exp(-pow((rnOrganic - 1.00) * 9.5, 2.0)) * (0.35 + 1.45 * lace);
    let leadCol = mix(vec3<f32>(0.12, 1.45, 4.20), vec3<f32>(0.85, 2.90, 4.80), lace) * leadWave * (1.8 + sn * 3.5);

    // 2. Delicate Luminous Violet-Rose & Electric Cyan Secondary Plasma Filaments strictly INSIDE the leading shock!
    let innerMask = smoothstep(1.02, 0.84, rnOrganic) * smoothstep(0.18, 0.52, rnOrganic);
    let filGlow = pow(clamp(lace * 0.78 + w1 * 0.35, 0.0, 1.0), 2.2);
    let nebCol = mix(vec3<f32>(0.45, 1.65, 3.80), vec3<f32>(2.40, 0.55, 1.85), smoothstep(0.32, 0.78, w1))
               * innerMask * filGlow * (1.6 + sn * 3.0);

    // 3. Incandescent Solar-Gold & Diamond-White Inner Shock Ring + Fine Radiant Coronal Streamers
    let goldWave = exp(-pow((rnOrganic - 0.58) * 6.0, 2.0)) * (0.45 + 1.25 * lace);
    let fineRays = pow(clamp(fbm2(vec2<f32>(ang * 11.0 + w1 * 1.8, rn * 1.2 - sn * 2.5)), 0.0, 1.0), 2.6) * exp(-rn * 1.85);
    let goldCol = mix(vec3<f32>(4.20, 2.60, 0.95), vec3<f32>(6.80, 5.40, 3.40), lace) * (goldWave + fineRays * 2.4) * (1.2 + sn * 2.8);

    // 4. Incandescent Expanding Diamond-White Fireball Core engulfing frame cleanly in final climax (sn > 0.60)
    let climax = smoothstep(0.56, 0.96, sn);
    let heartR = 0.8 + climax * climax * 24.0;
    let heart = smoothstep(heartR * 1.4, heartR * 0.22, rWorld) * (0.85 + 0.30 * w1);
    let heartCol = vec3<f32>(20.0, 19.0, 18.0) * heart * climax * climax * 4.0;

    // 5. Crisp Pinpoint Ejecta Sparks racing outward behind the shock front!
    let spGrid = noise2(vec2<f32>(ang * 48.0, rWorld * 4.2 - sn * 16.0));
    let spDot = pow(smoothstep(0.86, 0.99, spGrid), 3.0) * innerMask;
    let sparkCol = mix(vec3<f32>(1.4, 3.6, 6.2), vec3<f32>(6.5, 5.2, 2.6), w2) * spDot * 4.5;

    snShock = (leadCol + nebCol + goldCol + heartCol + sparkCol) * snEase;
  }

  // Crisp optical anamorphic horizontal flare + subtle 6-point stellar diffraction spikes!
  let anamorphic = exp(-abs(py) * mix(14.0, 4.5, sn)) * exp(-abs(px) * mix(0.32, 0.08, sn));
  let d1 = exp(-abs(px * 0.5 + py * 0.866) * mix(11.0, 4.6, sn)) * exp(-rNorm * mix(1.05, 0.36, sn));
  let d2 = exp(-abs(px * 0.5 - py * 0.866) * mix(11.0, 4.6, sn)) * exp(-rNorm * mix(1.05, 0.36, sn));
  let flareCol = mix(vec3<f32>(0.50, 0.88, 1.75), vec3<f32>(3.8, 3.1, 2.2), sn);
  let flare = (anamorphic * (0.55 + sn2 * 3.8) + (d1 + d2) * (0.28 + sn2 * 1.8)) * flareCol;

  return coreCol + innerGlow + pulseGlow + snShock + flare;
}

@fragment
fn fs_sky(inp: VSOut) -> @location(0) vec4<f32> {
  let ndc = vec4<f32>(inp.uv * 2.0 - 1.0, 1.0, 1.0);
  let wp4 = u.invViewProj * ndc;
  let rd = normalize(wp4.xyz / wp4.w - u.camPos.xyz);
  let t = u.camPos.w;

  let elev = clamp(rd.y, 0.0, 1.0);
  // Silky continuous nocturnal atmospheric gradient from horizon to zenith (ZERO horizontal mist shelf!)
  let zenithCol = vec3<f32>(0.0016, 0.0045, 0.014);
  let midSkyCol = vec3<f32>(0.007, 0.017, 0.040);
  let horizCol  = evalSeaHorizonColor(rd);
  let gradT = pow(elev, 0.62);
  var seaSky = mix(horizCol, midSkyCol, smoothstep(0.0, 0.42, gradT));
  seaSky = mix(seaSky, zenithCol, smoothstep(0.28, 0.88, gradT));

  let skyBaseAtmo = seaSky;
  seaSky += evalDeepSpace(rd, t) * smoothstep(0.14, 0.58, elev) * 0.88;

  // PHYSICALLY CORRECT DEPTH LAYERING:
  // Distant Gas Giant sits in outer space BEHIND local sky scattering & foreground atmospheric aurora curtains!
  var pAlpha = 0.0;
  let planet = evalGasGiant(rd, t, &pAlpha);
  let horizAtmo = smoothstep(-0.01, 0.11, rd.y);
  // Unlit night-side crescent merges naturally into local atmospheric sky radiance (never darker than local airglow!)
  let planetInAtmo = mix(skyBaseAtmo, max(planet, skyBaseAtmo * 0.92) + skyBaseAtmo * 0.25, horizAtmo * 0.96);
  seaSky = mix(seaSky, planetInAtmo, pAlpha);

  // Local atmospheric auroras glow IN FRONT OF the distant Gas Giant (100% physically authentic depth!)
  let aurora = evalGeometricAurora(rd, t);
  seaSky += aurora * 0.92;

  if (rd.y < 0.0) {
    seaSky = mix(horizCol, vec3<f32>(0.003, 0.012, 0.022), smoothstep(0.0, -0.25, rd.y));
  }

  var spaceSky = evalDeepSpace(rd, t);
  spaceSky += evalWhiteDwarf(rd, u.camPos.xyz, u.starPos.xyz, t, u.starPos.w, u.flags.w);

  // Seamless space reveal straight through the Pantheon dome Oculus (ZERO pop exiting rim!)
  let lookingUpOculus = u.actW.y * smoothstep(0.04, 0.24, rd.y);
  let spaceVis = clamp(u.actW.z + lookingUpOculus + smoothstep(340.0, 515.0, u.camPos.y), 0.0, 1.0);
  let cathDarkBg = vec3<f32>(0.006, 0.009, 0.015);

  let seaW = u.actW.x * smoothstep(220.0, 110.0, u.camPos.y);
  var finalSky = seaSky * seaW + cathDarkBg * (1.0 - seaW);
  finalSky = mix(finalSky, spaceSky, spaceVis);

  return vec4<f32>(finalSky, 1.0);
}
`;

// =========================================================================
// 2. UNIFIED OPAQUE PBR SHADER WITH HARDWARE-MIPMAPPED 512x512 GPU TEXTURES!
// =========================================================================
export const OPAQUE_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var texStone: texture_2d<f32>;
@group(0) @binding(2) var texMetal: texture_2d<f32>;
@group(0) @binding(4) var repSamp: sampler;

struct InstData {
  p0: vec4<f32>,
  p1: vec4<f32>,
  p2: vec4<f32>,
};
@group(1) @binding(0) var<storage, read> instances: array<InstData>;

struct VSIn {
  @location(0) pos: vec3<f32>,
  @location(1) norm: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) extra: vec2<f32>,
};

struct VSOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) wPos: vec3<f32>,
  @location(1) wNorm: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) extra: vec2<f32>,
  @location(4) ringMeta: vec4<f32>,
};

fn rotX(v: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}
fn rotY(v: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
fn rotZ(v: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

@vertex
fn vs_static(inp: VSIn) -> VSOut {
  var o: VSOut;
  o.wPos = inp.pos;
  o.wNorm = normalize(inp.norm);
  o.uv = inp.uv;
  o.extra = inp.extra;
  o.ringMeta = vec4<f32>(0.0);
  o.clipPos = u.viewProj * vec4<f32>(o.wPos, 1.0);
  return o;
}

@vertex
fn vs_cathedral_inst(inp: VSIn, @builtin(instance_index) ii: u32) -> VSOut {
  let inst = instances[ii];
  let t = u.camPos.w;
  var o: VSOut;
  // When far out at Act I sea (z > 115 && y < 145), hide ONLY upper tower tiers above corridor roof (inst.p0.y > 155)
  // so upper shaft never pokes above the portal monolith in Act I sky, while the ENTIRE cathedral interior visible through the portal NEVER pops in!
  if (u.camPos.z > 115.0 && u.camPos.y < 145.0 && inst.p0.y > 155.0) {
    o.wPos = vec3<f32>(0.0);
    o.wNorm = vec3<f32>(0.0, 1.0, 0.0);
    o.uv = vec2<f32>(0.0);
    o.extra = vec2<f32>(0.0);
    o.ringMeta = vec4<f32>(0.0);
    o.clipPos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    return o;
  }

  var lp = inp.pos * inst.p1.xyz;
  let wpRot = rotY(lp, inst.p0.w);
  let wnRot = normalize(rotY(inp.norm, inst.p0.w));

  var slideOff = vec3<f32>(0.0);
  if (inst.p2.w > 0.001) {
    let cyc = fract(t * 0.055 + inst.p1.w * 0.15915);
    let stepSlide = smoothstep(0.10, 0.34, cyc) - smoothstep(0.60, 0.84, cyc);
    slideOff = inst.p2.xyz * ((stepSlide - 0.5) * 2.0 * inst.p2.w);
  }

  o.wPos = inst.p0.xyz + wpRot + slideOff;
  o.wNorm = wnRot;
  o.uv = inp.uv;
  o.extra = inp.extra;
  o.ringMeta = vec4<f32>(0.0, 0.0, 0.0, inst.p1.w);
  o.clipPos = u.viewProj * vec4<f32>(o.wPos, 1.0);
  return o;
}

@vertex
fn vs_astrolabe_inst(inp: VSIn, @builtin(instance_index) ii: u32) -> VSOut {
  let inst = instances[ii];
  let t = u.camPos.w;
  let ringR = inst.p0.x;
  let radW = inst.p0.y;
  let vertH = inst.p0.z;

  let xzLen = max(length(inp.pos.xz), 0.0001);
  let radDir = inp.pos.xz / xzLen;
  let dr = xzLen - 1.0;
  let rPhys = ringR + dr * radW;
  let localP = vec3<f32>(radDir.x * rPhys, inp.pos.y * vertH, radDir.y * rPhys);

  let spinAng = inst.p0.w + inst.p1.w * t;
  var p = rotY(localP, spinAng);
  var n = rotY(inp.norm, spinAng);

  let prec = sin(t * 0.12 + inst.p0.w) * inst.p2.x;
  p = rotZ(rotX(rotY(p, inst.p1.y), inst.p1.x + prec), inst.p1.z);
  n = normalize(rotZ(rotX(rotY(n, inst.p1.y), inst.p1.x + prec), inst.p1.z));

  var o: VSOut;
  o.wPos = u.starPos.xyz + p;
  o.wNorm = n;
  o.uv = inp.uv;
  o.extra = inp.extra;
  o.ringMeta = vec4<f32>(1.0, ringR, atan2(radDir.y, radDir.x), inst.p0.w);
  o.clipPos = u.viewProj * vec4<f32>(o.wPos, 1.0);
  return o;
}

@fragment
fn fs_opaque(inp: VSOut) -> @location(0) vec4<f32> {
  // Uniform control-flow hardware mipmapped PBR texture lookups + geometric normal variance!
  let baseN = normalize(inp.wNorm);
  let dndx = dpdx(baseN);
  let dndy = dpdy(baseN);
  let normVar = dot(dndx, dndx) + dot(dndy, dndy);
  let dpDx = dpdx(inp.wPos);
  let dpDy = dpdy(inp.wPos);
  let pixFootprint = sqrt(max(dot(dpDx, dpDx), dot(dpDy, dpDy)));
  // Smooth distance-based micro-normal fade -> eliminates subpixel surface shimmer/serrilhado at mid & far range!
  let bumpFade = 1.0 / (1.0 + pixFootprint * 0.55);

  // Monumental cyclopean scale chiseled basalt texture (ZERO tiny repeating bricks on giant monoliths!)
  let blendW = pow(abs(baseN), vec3<f32>(4.0));
  let bw = blendW / (blendW.x + blendW.y + blendW.z + 1e-4);
  let stScale = 0.015;
  let stX = textureSample(texStone, repSamp, inp.wPos.zy * stScale);
  let stY = textureSample(texStone, repSamp, inp.wPos.xz * stScale);
  let stZ = textureSample(texStone, repSamp, inp.wPos.xy * stScale);
  let stTex = stX * bw.x + stY * bw.y + stZ * bw.z;

  // Fine high-frequency micro-rock detail overlay for close-up chiseled basalt grain!
  let stFine = textureSample(texStone, repSamp, inp.wPos.xy * 0.068 + inp.wPos.zy * 0.068);

  // Hardware-filtered brushed bronze / volcanic obsidian texture (circumferential UV on rings, triplanar on oculus!)
  let metUV = select(inp.wPos.xz * 0.045 + inp.wPos.xy * 0.025, vec2<f32>(inp.uv.x * 0.35, inp.uv.y * 2.0), inp.ringMeta.x > 0.5);
  let metTex = textureSample(texMetal, repSamp, metUV);

  if (u.flags.x > 0.5 && inp.wPos.y < u.flags.y) { discard; }

  let wPos = inp.wPos;
  let Vvec = u.camPos.xyz - wPos;
  let dist = length(Vvec);
  let V = Vvec / max(dist, 0.001);
  let rd = -V;
  var N = baseN;
  let matId = inp.extra.x;
  let ao = clamp(inp.extra.y, 0.15, 1.0);
  let t = u.camPos.w;

  // --- MAT 7: LUMINOUS TEXTURED ALABASTER-AMBER GOTHIC CLERESTORY WINDOW (mottled depth & stone-mullion AO — ZERO flat uniform cream!) ---
  if (matId > 6.5) {
    let winU = fract((inp.uv.x) * 0.12);
    let winV = clamp((fract((wPos.y - 5.0) / 58.0) - 0.5) * 2.0, -1.0, 1.0);
    let edgeVig = clamp(1.0 - winV * winV * 0.42, 0.45, 1.0);
    let alabaster = 0.58 + 0.42 * (stTex.b * 0.65 + stFine.b * 0.35);
    let coreGlow = exp(-winV * winV * 1.4);
    let winCol = mix(vec3<f32>(2.4, 1.25, 0.36), vec3<f32>(5.4, 3.85, 1.85), coreGlow * alabaster) * edgeVig * alabaster;
    return vec4<f32>(applyAtmosphericFog(winCol, wPos, dist, rd, u), 1.0);
  }

  // --- MAT 1: ORGANIC FRACTURED SMOLDERING DARK-CRIMSON STONE CREVICES (natural broken rock magma veins — ZERO 1px straight red slits!) ---
  if (matId > 0.5 && matId < 1.5) {
    let magmaTex = stTex.b * 0.45 + stFine.b * 0.55;
    let rockBreak = smoothstep(0.42, 0.78, noise3(wPos * 0.16)) * smoothstep(0.40, 0.84, magmaTex);
    let emberCore = pow(rockBreak, 1.9);
    let pulse = 0.70 + 0.30 * sin(t * 1.15 + wPos.y * 0.042 + wPos.z * 0.028);
    let distAA = smoothstep(320.0, 55.0, dist);
    let crimDeep = vec3<f32>(0.014, 0.016, 0.022);
    let crimHot  = vec3<f32>(1.35, 0.042, 0.008);
    let crim = mix(crimDeep, crimHot, emberCore * distAA) * pulse;
    return vec4<f32>(applyAtmosphericFog(crim, wPos, dist, rd, u), 1.0);
  }

  var col = vec3<f32>(0.0);

  // =========================================================================
  // JET-DARK VOLCANIC OBSIDIAN vs RICH WARM OXIDIZED ANTIQUE BRONZE (ZERO stair-stepped rim shimmer!)
  // =========================================================================
  if (matId >= 1.5 && matId < 4.5) {
    let isBronze = matId >= 2.5;
    let isBrightEdge = matId >= 3.5;

    let toStar = u.starPos.xyz - wPos;
    let starDist = max(length(toStar), 1.0);
    let Lstar = toStar / starDist;

    let mn = (metTex.rg - 0.5) * 2.0;
    let upT = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(baseN.y) > 0.9);
    let T = normalize(cross(upT, baseN));
    let B = cross(baseN, T);
    N = normalize(baseN + (T * mn.x + B * mn.y) * select(0.20, 0.16, isBronze) * bumpFade);

    var albedo: vec3<f32>;
    var metallic: f32;
    var rough: f32;

    if (!isBronze) {
      // Deep silhouetted volcanic obsidian glass (high contrast against antique gold-bronze!)
      albedo = mix(vec3<f32>(0.001, 0.0015, 0.0038), vec3<f32>(0.0045, 0.0065, 0.013), metTex.b);
      metallic = 0.08;
      rough = mix(0.28, 0.44, (1.0 - metTex.b) * 0.65 + (1.0 - ao) * 0.35);
    } else {
      // Unmistakably rich warm antique oxidized brushed gold-bronze with recessed turquoise verdigris patina!
      let patinaMask = smoothstep(0.80, 0.44, ao) * smoothstep(0.36, 0.80, metTex.a) * select(1.0, 0.08, isBrightEdge);
      let bronzeBase = mix(vec3<f32>(0.44, 0.22, 0.055), vec3<f32>(0.98, 0.60, 0.18), metTex.b * 0.72 + select(0.0, 0.28, isBrightEdge));
      let verdigris = vec3<f32>(0.04, 0.30, 0.27);
      albedo = mix(bronzeBase, verdigris, patinaMask);
      metallic = mix(0.92, 0.14, patinaMask);
      rough = mix(mix(0.24, 0.38, 1.0 - metTex.b), 0.74, patinaMask);
    }

    let safeR = max(specAAVar(normVar, rough), select(0.28, 0.30, isBronze));
    let F0 = mix(vec3<f32>(0.022), albedo, metallic);

    let sn = u.flags.w;
    let sn2 = sn * sn;
    // REAL-TIME ANALYTICAL RING-ON-RING ECLIPSE SHADOW CASTING (inner rings cast moving soft-penumbra shadows across outer rings!)
    // ringPlanes is strictly sorted by increasing radius -> early break skips all outer shells (>50% faster, bit-identical!).
    var ringEclipse = 1.0;
    if (inp.ringMeta.x > 0.5) {
      let dirOut = -Lstar;
      let maxCastR = starDist - 26.0;
      for (var ri = 0u; ri < 22u; ri++) {
        let rp = u.ringPlanes[ri];
        let rR = rp.w;
        if (rR >= maxCastR) { break; }
        let dPlane = abs(dot(dirOut, rp.xyz)) * rR;
        let pack = u.ringHalfH[ri >> 2u];
        let lane = ri & 3u;
        let hh = select(select(select(pack.x, pack.y, lane == 1u), pack.z, lane == 2u), pack.w, lane == 3u);
        let pen = 24.0 * clamp((starDist - rR) / max(rR, 120.0), 0.20, 1.85);
        let occ = smoothstep(hh - pen * 0.22, hh + pen * 0.88, dPlane);
        ringEclipse *= mix(0.20, 1.0, occ);
      }
      ringEclipse = mix(ringEclipse, 1.0, sn2 * 0.72);
    }

    // Dramatic traveling coronal light pulse sweeping outward ring-by-ring across the planetary astrolabe!
    let pulseWaveR = 250.0 + u.starPos.w * 1680.0;
    let pulseHit = exp(-pow((starDist - pulseWaveR) / 95.0, 2.0)) * (1.0 - u.starPos.w * 0.40);

    let atten = 1.0 / (1.0 + (starDist * 0.00050) * (starDist * 0.00050));
    let snTint = mix(vec3<f32>(2.9, 4.1, 6.6), vec3<f32>(8.2, 6.8, 5.2), sn);
    let starLightCol = snTint * (1.0 + pulseHit * 4.5 + sn2 * 6.5) * atten * ringEclipse;
    let ndl = max(dot(N, Lstar), 0.0);
    let diff = albedo * (1.0 - metallic) * ndl / PI;
    let spec = min(ggxSpec(N, V, Lstar, safeR, F0), vec3<f32>(1.45)) * select(0.32, 0.62, isBronze);
    col += (diff + spec) * starLightCol;

    // Anti-aliased silky icy blue-white backlighting rim silhouettes modulated by real eclipse shadows!
    let ndv = max(dot(N, V), 0.0);
    let rimAA = 1.0 / (1.0 + normVar * 16.0 + pixFootprint * 0.24);
    let fres = pow(1.0 - ndv, 4.4) * rimAA;
    let backAlign = smoothstep(-0.08, 0.88, dot(V, -Lstar));
    let rimCol = mix(vec3<f32>(0.52, 1.12, 2.40), vec3<f32>(1.85, 1.16, 0.42), select(0.0, 0.72, isBronze));
    col += rimCol * fres * (0.06 + 2.20 * backAlign + pulseHit * 3.8 + sn2 * 5.0) * (0.28 + 0.72 * ringEclipse) * ao * atten;

    // Distinct shadow readability: volcanic obsidian stays jet-dark while antique bronze retains subtle warm golden sheen!
    let ambSpace = select(vec3<f32>(0.0022, 0.0040, 0.010), vec3<f32>(0.075, 0.044, 0.016), isBronze);
    col += albedo * ambSpace * ao;

    let R = reflect(-V, N);
    let envStar = pow(max(dot(R, Lstar), 0.0), mix(24.0, 10.0, safeR)) * rimAA;
    if (isBronze) {
      col += F0 * (vec3<f32>(0.42, 0.56, 0.86) * envStar * (1.0 + pulseHit * 2.4) + vec3<f32>(0.22, 0.14, 0.045) * (0.35 + 0.65 * fres)) * ao * atten;
    } else {
      col += vec3<f32>(0.012, 0.030, 0.075) * envStar * (0.8 + pulseHit * 2.0) * ao * atten;
    }
  } else {
    // =========================================================================
    // PHOTOREAL CYCLOPEAN CHISELED COOL SLATE-GRAPHITE VOLCANIC BASALT STONE!
    // =========================================================================
    let sn = (stTex.rg - 0.5) * 2.0 + (stFine.rg - 0.5) * 0.90;
    let upT = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(baseN.y) > 0.9);
    let T = normalize(cross(upT, baseN));
    let B = cross(baseN, T);
    N = normalize(baseN + (T * sn.x + B * sn.y) * (0.46 * bumpFade));

    let stoneVal = stTex.b * 0.72 + stFine.b * 0.28;
    let edgeWear = smoothstep(0.78, 0.98, ao);
    // Cool dark chiseled slate-graphite stone -> crisp warm-amber vs cool-graphite architectural chiaroscuro!
    var albedo = mix(vec3<f32>(0.016, 0.020, 0.029), vec3<f32>(0.068, 0.078, 0.098), stoneVal);
    albedo = mix(albedo, vec3<f32>(0.125, 0.136, 0.158), edgeWear * 0.40);

    let rough = specAAVar(normVar, clamp(stTex.a * 0.95, 0.54, 0.97));
    let F0 = vec3<f32>(0.030);

    let Lcath = normalize(CATH_SUN_DIR);
    let beamPlane = dot(wPos - vec3<f32>(0.0, 180.0, -340.0), normalize(vec3<f32>(-0.68, 0.72, -0.15)));
    let shaftPool = 0.10 + 0.90 * smoothstep(0.02, 0.72, sin(beamPlane * 0.048) * 0.65 + sin(wPos.y * 0.022 + wPos.z * 0.016) * 0.35);
    let heightSun = smoothstep(-240.0, 150.0, wPos.y);
    let cathSunCol = vec3<f32>(3.20, 2.05, 0.85) * shaftPool * (0.18 + 0.92 * heightSun);

    let ndlC = max(dot(N, Lcath), 0.0);
    let cathLit = (albedo * ndlC / PI + ggxSpec(N, V, Lcath, rough, F0)) * cathSunCol;
    let ndv = max(dot(N, V), 0.0);
    let amberRim = pow(1.0 - ndv, 3.4) * shaftPool * (0.20 + 0.80 * ndlC) * vec3<f32>(0.40, 0.26, 0.10) * heightSun * ao;

    // Distinct cool slate-graphite ambient shadows + gentle warm stone bounce illuminating the curved barrel-vault tunnel ceiling!
    let abyssFade = smoothstep(-340.0, -40.0, wPos.y);
    let upBounce = 0.5 + 0.5 * N.y;
    let coolShadow = vec3<f32>(0.018, 0.025, 0.040) * (0.38 + 0.62 * abyssFade);
    let coolSkyAmb = vec3<f32>(0.068, 0.082, 0.112) * (0.34 + 0.66 * abyssFade);
    let cathAmb = mix(coolShadow, coolSkyAmb, upBounce);
    // Warm cathedral hearth bounce softly illuminating vaulted nave soffit & ribs (ZERO pitch-black ceiling!)
    let inVaultSoffit = smoothstep(-268.0, -220.0, wPos.z) * smoothstep(14.0, -14.0, wPos.z) * smoothstep(68.0, 102.0, wPos.y);
    let vaultBounce = vec3<f32>(0.24, 0.15, 0.085) * inVaultSoffit * (0.45 + 0.55 * max(-N.y, 0.0));
    var cathTotal = cathLit + amberRim + albedo * (cathAmb * ao + vaultBounce);

    // Wide smooth spatial Act I Portal exterior light penetration down the nave
    let seaMask = smoothstep(-115.0, 75.0, wPos.z) * (1.0 - smoothstep(260.0, 400.0, wPos.y));
    if (seaMask > 0.001) {
      let Lsea = normalize(SEA_SUN_DIR);
      let ndlS = max(dot(N, Lsea), 0.0);
      let auroraRim = pow(1.0 - ndv, 3.8) * vec3<f32>(0.05, 0.22, 0.34);
      let waterBounce = max(-N.y, 0.0) * exp(-max(wPos.y, 0.0) * 0.035) * vec3<f32>(0.04, 0.16, 0.24);
      let seaLit = (albedo * ndlS / PI + ggxSpec(N, V, Lsea, rough, F0)) * vec3<f32>(0.98, 0.96, 1.06)
                 + albedo * (vec3<f32>(0.032, 0.058, 0.102) + waterBounce) * ao
                 + auroraRim * 0.16 * ao;
      // Wet waterline sheen strictly confined to flooded lower steps (y < 2.2m) so upper stone causeway reads as chiseled basalt, NOT brown wood!
      let wet = exp(-max(wPos.y, 0.0) * 0.95) * smoothstep(-3.0, 0.1, wPos.y);
      let wetSpec = ggxSpec(N, V, normalize(GAS_GIANT_DIR), specAAVar(normVar, 0.16), vec3<f32>(0.05)) * vec3<f32>(0.42, 0.62, 0.85) * wet;
      cathTotal = mix(cathTotal, seaLit * (1.0 - wet * 0.50) + wetSpec, seaMask);

      let riftProx = exp(-(wPos.x * wPos.x) / (20.0 * 20.0)) * exp(-abs(wPos.z) * 0.038) * smoothstep(115.0, 6.0, wPos.y);
      cathTotal += albedo * vec3<f32>(0.95, 0.38, 0.12) * riftProx * 0.32;
    }

    if (wPos.y > 410.0) {
      let toStar = normalize(u.starPos.xyz - wPos);
      let rimS = pow(1.0 - ndv, 3.6) * smoothstep(410.0, 515.0, wPos.y);
      cathTotal += (albedo * max(dot(N, toStar), 0.0) * 0.28 + vec3<f32>(0.22, 0.48, 0.96) * rimS * 0.42) * ao;
    }

    col = cathTotal;
  }

  col = applyAtmosphericFog(col, wPos, dist, rd, u);
  return vec4<f32>(col, 1.0);
}
`;

// =========================================================================
// 3. ACT I MIRRORED RIPPLING OCEAN (PURE C-INFINITY ANALYTICAL 10-WAVE GERSTNER!)
// =========================================================================
export const WATER_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var reflTex: texture_2d<f32>;
@group(1) @binding(1) var linSamp: sampler;

struct VSIn {
  @location(0) xz: vec2<f32>,
  @location(1) extra: vec2<f32>,
};

struct VSOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) wPos: vec3<f32>,
};

@vertex
fn vs_water(inp: VSIn) -> VSOut {
  let t = u.camPos.w;
  let distFade = exp(-length(inp.xz - vec2<f32>(0.0, 220.0)) * 0.0012);
  let swell = sin(inp.xz.x * 0.042 + t * 0.38) * cos(inp.xz.y * 0.036 - t * 0.29) * 0.10 * distFade;
  var o: VSOut;
  o.wPos = vec3<f32>(inp.xz.x, swell, inp.xz.y);
  o.clipPos = u.viewProj * vec4<f32>(o.wPos, 1.0);
  return o;
}

fn waterNormal(xz: vec2<f32>, t: f32, dist: f32) -> vec3<f32> {
  var dH = vec2<f32>(0.0);
  let fadeSwell = 1.0 / (1.0 + dist * 0.0018);
  let fadeMid   = 1.0 / (1.0 + dist * 0.0068);
  let fadeCap   = 1.0 / (1.0 + dist * 0.0220);

  var dirs = array<vec2<f32>, 10>(
    vec2<f32>( 0.92,  0.39), vec2<f32>(-0.48,  0.88), vec2<f32>( 0.76, -0.65),
    vec2<f32>(-0.89, -0.45), vec2<f32>( 0.21,  0.98), vec2<f32>(-0.71,  0.70),
    vec2<f32>( 0.99, -0.14), vec2<f32>(-0.29, -0.96), vec2<f32>( 0.56,  0.83),
    vec2<f32>(-0.94,  0.34)
  );
  var freqs  = array<f32, 10>(0.15, 0.26, 0.41, 0.64, 0.98, 1.48, 2.20, 3.25, 4.75, 6.80);
  var speeds = array<f32, 10>(0.42, 0.56, 0.72, 0.91, 1.12, 1.38, 1.68, 2.02, 2.40, 2.85);
  // Crisp organic dark-ocean swell & ripple amplitudes -> clearly rippling liquid obsidian surface (ZERO flat unrippled mirror!)
  var amps   = array<f32, 10>(0.042, 0.036, 0.030, 0.025, 0.021, 0.017, 0.014, 0.011, 0.0085, 0.0065);

  for (var i = 0; i < 10; i++) {
    let phase = dot(xz, dirs[i]) * freqs[i] + t * speeds[i] + f32(i) * 1.73;
    let att = select(select(fadeSwell, fadeMid, i >= 3), fadeCap, i >= 6);
    dH += dirs[i] * (cos(phase) * amps[i] * att);
  }
  return normalize(vec3<f32>(-dH.x, 1.0, -dH.y));
}

@fragment
fn fs_water(inp: VSOut) -> @location(0) vec4<f32> {
  let wPos = inp.wPos;
  let Vvec = u.camPos.xyz - wPos;
  let dist = length(Vvec);
  let V = Vvec / max(dist, 0.001);
  let rd = -V;
  let t = u.camPos.w;

  let N = waterNormal(wPos.xz, t, dist);
  let dndx = dpdx(N);
  let dndy = dpdy(N);
  let normVar = max(dot(dndx, dndx), dot(dndy, dndy));

  if (wPos.z < -42.0) { discard; }

  let ndv = max(dot(N, V), 0.001);

  let reflClip = u.reflViewProj * vec4<f32>(wPos.x, 0.0, wPos.z, 1.0);
  var reflUV = reflClip.xy / max(reflClip.w, 0.0001) * vec2<f32>(0.5, -0.5) + 0.5;
  // Visible organic horizontal + vertical ripple distortion of reflected prisms, portal & gas giant!
  let distortScale = mix(0.056, 0.018, clamp(dist / 640.0, 0.0, 1.0));
  reflUV = clamp(reflUV + vec2<f32>(N.x * 1.45, N.z * 2.55) * distortScale, vec2<f32>(0.002), vec2<f32>(0.998));
  var reflCol = textureSampleLevel(reflTex, linSamp, reflUV, 0.0).rgb;

  let fresnel = clamp(0.14 + 0.84 * pow(1.0 - ndv, 3.0), 0.14, 0.96);
  let deepWater = mix(vec3<f32>(0.001, 0.006, 0.013), vec3<f32>(0.004, 0.018, 0.030), exp(-dist * 0.004));

  // Subtle dark liquid-glass absorption tint + underwater refractive ocean caustics web!
  let caust = evalOceanCaustics(wPos.xz, t) * exp(-dist * 0.0042) * (1.0 - fresnel * 0.65);
  let waterBody = deepWater + vec3<f32>(0.015, 0.095, 0.135) * caust * 0.48;
  var col = mix(waterBody, reflCol * vec3<f32>(0.86, 0.91, 0.95), fresnel);

  let wRough = specAAVar(normVar, mix(0.036, 0.14, clamp(dist / 850.0, 0.0, 1.0)));
  let giantSpec = ggxSpec(N, V, normalize(GAS_GIANT_DIR), wRough, vec3<f32>(0.055));
  col += giantSpec * vec3<f32>(1.15, 0.92, 0.78) * 1.35;

  let auroraSpec = ggxSpec(N, V, normalize(vec3<f32>(-0.22, 0.42, -0.88)), specAAVar(normVar, 0.065), vec3<f32>(0.045));
  col += auroraSpec * vec3<f32>(0.18, 0.72, 0.85) * 0.55;

  let portalMask = exp(-(wPos.x * wPos.x) / (26.0 * 26.0)) * exp(-pow((wPos.z - 2.0) / 38.0, 2.0));
  let portalWaveSpec = ggxSpec(N, V, normalize(vec3<f32>(0.0, 0.35, -0.94)), specAAVar(normVar, 0.08), vec3<f32>(0.06));
  col += portalWaveSpec * vec3<f32>(1.35, 0.42, 0.10) * portalMask * 1.45;

  col *= smoothstep(-42.0, -10.0, wPos.z);
  col = applyAtmosphericFog(col, wPos, dist, rd, u);
  return vec4<f32>(col, 1.0);
}
`;

// =========================================================================
// 4. LIVING MULTIFACETED REFRACTIVE CRYSTAL PRISMS (512x512 CRYSTAL FACET MAP + EDGE AA!)
// =========================================================================
export const CRYSTAL_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(3) var texCrystal: texture_2d<f32>;
@group(0) @binding(4) var repSamp: sampler;
@group(1) @binding(0) var sceneTex: texture_2d<f32>;
@group(1) @binding(1) var linSamp: sampler;

struct VSIn {
  @location(0) pos: vec3<f32>,
  @location(1) norm: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) extra: vec2<f32>,
};

struct VSOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) wPos: vec3<f32>,
  @location(1) wNorm: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) extra: vec2<f32>,
};

@vertex
fn vs_crystal(inp: VSIn) -> VSOut {
  var o: VSOut;
  o.wPos = inp.pos;
  o.wNorm = normalize(inp.norm);
  o.uv = inp.uv;
  o.extra = inp.extra;
  o.clipPos = u.viewProj * vec4<f32>(inp.pos, 1.0);
  return o;
}

fn crystalEnvReflect(R: vec3<f32>, t: f32) -> vec3<f32> {
  let elev = clamp(R.y, 0.0, 1.0);
  var env = mix(vec3<f32>(0.045, 0.125, 0.215), vec3<f32>(0.006, 0.018, 0.052), smoothstep(0.0, 0.65, elev));
  let aur = pow(max(0.0, sin(R.x * 4.5 + R.z * 2.8 + t * 0.25)), 3.0) * smoothstep(0.05, 0.45, elev);
  env += mix(vec3<f32>(0.06, 0.95, 1.28), vec3<f32>(0.55, 0.28, 1.15), elev) * aur * 0.72;
  let gDot = max(dot(R, normalize(GAS_GIANT_DIR)), 0.0);
  env += vec3<f32>(0.58, 0.66, 0.78) * pow(gDot, 9.0) * 0.62;
  return env;
}

@fragment
fn fs_crystal_refl(inp: VSOut) -> @location(0) vec4<f32> {
  if (inp.wPos.y < u.flags.y) { discard; }
  let wPos = inp.wPos;
  let Vvec = u.camPos.xyz - wPos;
  let dist = length(Vvec);
  let V = Vvec / max(dist, 0.001);
  let N = normalize(inp.wNorm);
  let h01 = inp.uv.y;
  let ndv = max(dot(N, V), 0.0);
  let fres = pow(1.0 - ndv, 3.0);

  // Luminous translucent icy-cyan / glacial-sapphire optical glass reflection (NO dark opaque navy blocks, NO beige bands!)
  let core = mix(vec3<f32>(0.012, 0.075, 0.135), vec3<f32>(0.052, 0.24, 0.36), h01 * 0.58 + fres * 0.42);
  let R = reflect(-V, N);
  let env = crystalEnvReflect(R, u.camPos.w);
  let spec = ggxSpec(N, V, normalize(SEA_SUN_DIR), 0.09, vec3<f32>(0.10)) * vec3<f32>(0.55, 1.15, 1.45);
  var col = mix(core, env, 0.42 + fres * 0.48) + spec;
  col = applyAtmosphericFog(col, wPos, dist, -V, u);
  return vec4<f32>(col, 1.0);
}

// Hero photoreal optical quartz crystal: CRYSTAL-CLEAR transparent 3D Snell glass, proportional RGB dispersion, ZERO stippled edge aliasing!
@fragment
fn fs_crystal(inp: VSOut) -> @location(0) vec4<f32> {
  let uEdge = abs(inp.uv.x - 0.5) * 2.0;
  let fwU = max(fwidth(inp.uv.x), 0.001);
  // Derivative-filtered chamfer fades smoothly to 0 on thin narrow spires -> ZERO 1px white dashed stipple aliasing!
  let chamfer = smoothstep(0.84, 1.0, uEdge) * smoothstep(0.24, 0.035, fwU);

  let wPos = inp.wPos;
  let Vvec = u.camPos.xyz - wPos;
  let dist = length(Vvec);
  let V = Vvec / max(dist, 0.001);
  let rd = -V;
  let t = u.camPos.w;
  let h01 = inp.uv.y;
  let seed = fract(inp.extra.x);

  let surfUV = vec2<f32>(inp.uv.x * 1.2 + seed, wPos.y * 0.024 + seed * 3.0);
  let cSurf = textureSample(texCrystal, repSamp, surfUV);
  let upT = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(inp.wNorm.y) > 0.9);
  let T = normalize(cross(upT, inp.wNorm));
  let B = cross(inp.wNorm, T);
  let bevelSign = select(-1.0, 1.0, inp.uv.x > 0.5);
  let bevelCurl = T * (bevelSign * chamfer * 0.12);
  let N = normalize(inp.wNorm + bevelCurl + (T * (cSurf.a - 0.5) * 0.022 + B * (cSurf.g - 0.5) * 0.016));

  let dndx = dpdx(N);
  let dndy = dpdy(N);
  let normVar = max(dot(dndx, dndx), dot(dndy, dndy));
  let ndv = max(dot(N, V), 0.001);

  // --- 1. OPTICALLY PURE 3D SNELL REFRACTION (IOR = 1.54) WITH CRISP PROPORTIONAL RGB DISPERSION ---
  let screenUV = inp.clipPos.xy * u.res.zw;
  let refrRay = refract(-V, N, 1.0 / 1.54);
  let rayLen = clamp(dist * 0.11, 4.5, 20.0);
  let refrPt = wPos + refrRay * rayLen;
  let refrClip = u.viewProj * vec4<f32>(refrPt, 1.0);
  let refrProjUV = refrClip.xy / max(refrClip.w, 0.001) * vec2<f32>(0.5, -0.5) + 0.5;
  let rawOff = clamp(refrProjUV - screenUV, vec2<f32>(-0.075), vec2<f32>(0.075));
  let refrOff = rawOff * clamp(140.0 / (dist + 28.0), 0.36, 1.0);
  // Subtle natural glass chromatic dispersion across every refracted facet (NO harsh horizontal rainbow bar!)
  let dispOff = refrOff * (0.09 + 0.06 * pow(1.0 - ndv, 1.6));

  let uvR = clamp(screenUV + refrOff - dispOff, vec2<f32>(0.003), vec2<f32>(0.997));
  let uvG = clamp(screenUV + refrOff,           vec2<f32>(0.003), vec2<f32>(0.997));
  let uvB = clamp(screenUV + refrOff + dispOff, vec2<f32>(0.003), vec2<f32>(0.997));

  let refrCol = vec3<f32>(
    textureSampleLevel(sceneTex, linSamp, uvR, 0.0).r,
    textureSampleLevel(sceneTex, linSamp, uvG, 0.0).g,
    textureSampleLevel(sceneTex, linSamp, uvB, 0.0).b
  );

  // --- 2. SUBTLE INTERNAL OPTICAL CAUSTIC SPARKLE (crystal-clear glass, ZERO cloudy/milky frosting!) ---
  let pIn1 = wPos + refrRay * 6.5;
  let pIn2 = wPos + refrRay * 15.0;
  let cIn1 = textureSample(texCrystal, repSamp, vec2<f32>((pIn1.x + pIn1.z) * 0.017 + seed, pIn1.y * 0.017));
  let cIn2 = textureSample(texCrystal, repSamp, vec2<f32>((pIn2.x - pIn2.z) * 0.011 + seed * 2.0, pIn2.y * 0.013));

  let internalCaustic = pow(clamp(cIn1.b * 0.65 + cIn2.b * 0.55, 0.0, 1.0), 2.4) * (0.30 + 0.70 * pow(1.0 - ndv, 1.6));
  let internalVeil = (cIn1.r * 0.55 + cIn2.r * 0.45) * 0.045;
  let cyanIce = vec3<f32>(0.08, 0.86, 1.28);
  let prismViolet = vec3<f32>(0.48, 0.28, 1.18);
  let internalCol = mix(cyanIce, prismViolet, cIn2.a * 0.52 + h01 * 0.48) * (internalVeil + internalCaustic * 0.36);

  // --- 3. CRYSTAL-CLEAR TRANSPARENT QUARTZ BEER-LAMBERT TRANSMISSION (ZERO milky blue-grey fog!) ---
  let estThick = mix(1.15, 0.32, chamfer) * (0.42 + 0.58 * ndv) * (1.05 - h01 * 0.45);
  let absorption = exp(-estThick * vec3<f32>(0.26, 0.08, 0.025));
  let deepCore = mix(vec3<f32>(0.003, 0.022, 0.052), vec3<f32>(0.014, 0.072, 0.135), h01 * 0.55);
  let transmitted = refrCol * absorption * 1.06 + deepCore * (1.0 - absorption) * 0.28 + internalCol;

  // --- 4. SILKY ANTI-ALIASED FRESNEL & GLASS SPECULAR (ZERO 1px stippled white dots on thin spires!) ---
  let R = reflect(-V, N);
  let envRefl = crystalEnvReflect(R, t);
  let edgeSmooth = smoothstep(0.32, 0.04, fwU);
  let fresnel = clamp(0.04 + 0.82 * pow(1.0 - ndv, 3.8), 0.04, 0.86);

  let cRough = specAAVar(normVar, max(0.072, fwU * 0.45));
  let specGiant = ggxSpec(N, V, normalize(GAS_GIANT_DIR), cRough, vec3<f32>(0.10)) * vec3<f32>(1.25, 1.05, 0.88);
  let specSun   = ggxSpec(N, V, normalize(SEA_SUN_DIR), cRough, vec3<f32>(0.10)) * vec3<f32>(0.72, 1.35, 1.72);
  let specTotal = min(specGiant + specSun, vec3<f32>(1.75));

  let prismPhase = ndv * 5.2 + h01 * 3.8 + seed * 3.1;
  let prismSheen = vec3<f32>(
    0.5 + 0.5 * cos(prismPhase),
    0.5 + 0.5 * cos(prismPhase + 2.094),
    0.5 + 0.5 * cos(prismPhase + 4.188)
  );
  let rimGlow = pow(1.0 - ndv, 4.4) * edgeSmooth * mix(vec3<f32>(0.16, 0.74, 1.15), prismSheen * 1.10, 0.34) * 0.38;

  var col = mix(transmitted, envRefl, fresnel * 0.52) + specTotal + rimGlow;

  // Smooth dark wet waterline contact + dancing reflected ocean caustics shimmering up the lower crystal facets!
  let wetContact = exp(-max(wPos.y, 0.0) * 0.85) * smoothstep(-2.0, 0.05, wPos.y);
  let rippleCrest = exp(-abs(wPos.y - 0.18) * 4.0) * (0.4 + 0.6 * sin(wPos.x * 0.9 + wPos.z * 0.8 + t * 1.6));
  let caustHeight = exp(-max(wPos.y, 0.0) * 0.16) * smoothstep(-0.5, 0.4, wPos.y) * exp(-dist * 0.0035);
  let crystCaust = evalOceanCaustics(wPos.xz + vec2<f32>(wPos.y * 0.45, -wPos.y * 0.35), t) * caustHeight;
  col = mix(col, vec3<f32>(0.003, 0.018, 0.036), wetContact * 0.65)
      + vec3<f32>(0.12, 0.42, 0.62) * rippleCrest * wetContact * 0.25
      + vec3<f32>(0.06, 0.42, 0.58) * crystCaust * 0.42;

  col = applyAtmosphericFog(col, wPos, dist, rd, u);
  return vec4<f32>(col, 1.0);
}
`;

// =========================================================================
// 5. HALF-RES VOLUMETRIC GOD RAYS (FAST 18-STEP AMBER + 24-STEP TRANSMITTANCE CREPUSCULAR RAYS!)
// =========================================================================
export const VOLUMETRIC_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var depthMsaa: texture_depth_multisampled_2d;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

fn loadDepthAtUV(uv: vec2<f32>) -> f32 {
  let dims = vec2<i32>(i32(u.res.x), i32(u.res.y));
  let coord = clamp(vec2<i32>(uv * vec2<f32>(dims)), vec2<i32>(0), dims - vec2<i32>(1));
  return textureLoad(depthMsaa, coord, 0);
}

fn worldDistFromDepth(uv: vec2<f32>, depth: f32) -> f32 {
  if (depth >= 0.99995) { return 1800.0; }
  let ndc = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let wp4 = u.invViewProj * ndc;
  return length(wp4.xyz / wp4.w - u.camPos.xyz);
}

@fragment
fn fs_volumetric(inp: VSOut) -> @location(0) vec4<f32> {
  let uv = inp.uv;
  let t = u.camPos.w;
  let pix = inp.pos.xy;
  let jitter = ign(pix + vec2<f32>(fract(u.camUp.w * 0.618) * 17.0, 0.0));

  let depth = loadDepthAtUV(uv);
  let sceneDist = worldDistFromDepth(uv, depth);
  let ndcFar = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
  let wpFar = u.invViewProj * ndcFar;
  let rd = normalize(wpFar.xyz / wpFar.w - u.camPos.xyz);

  var vol = vec3<f32>(0.0);

  // ACT I: Ultra-organic 10-step curling multi-octave sea mist gliding between crystal spires!
  if (u.actW.x > 0.01) {
    let maxD = min(sceneDist, 360.0);
    let steps = 10;
    let dt = maxD / f32(steps);
    var mistAcc = 0.0;
    for (var i = 0; i < steps; i++) {
      let d = (f32(i) + jitter) * dt;
      let p = u.camPos.xyz + rd * d;
      if (p.y > 0.2 && p.y < 22.0 && p.z > 5.0) {
        let hFall = exp(-p.y * 0.18) * smoothstep(0.0, 1.8, p.y);
        let n1 = noise3(vec3<f32>(p.x * 0.015 + t * 0.052, p.y * 0.08, p.z * 0.015 - t * 0.034));
        let n2 = noise3(vec3<f32>(p.x * 0.038 - t * 0.04, p.y * 0.16, p.z * 0.038 + t * 0.025));
        let wisp = n1 * 0.64 + n2 * 0.36;
        let patchMask = pow(smoothstep(0.44, 0.84, wisp), 1.8);
        mistAcc += hFall * patchMask * dt * 0.0017 * smoothstep(14.0, 52.0, d);
      }
    }
    let mistCol = mix(vec3<f32>(0.04, 0.26, 0.38), vec3<f32>(0.20, 0.22, 0.42), clamp(maxD / 360.0, 0.0, 1.0));
    vol += mistCol * mistAcc * u.actW.x;
  }

  // ACT II: Ultra Cinematic 24-step directional solar-amber god-ray shafts with 2-octave 3D illuminated floating dust!
  let oculusFade = smoothstep(415.0, 290.0, u.camPos.y);
  let cathVis = clamp(u.actW.y + u.actW.w * 0.36, 0.0, 1.0) * oculusFade;
  if (cathVis > 0.01) {
    let maxD = min(sceneDist, 440.0);
    let fgPreserve = smoothstep(55.0, 152.0, sceneDist);
    let steps = 24;
    let dt = maxD / f32(steps);
    let Lsun = normalize(CATH_SUN_DIR);
    let bU = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), Lsun));
    let bV = cross(Lsun, bU);

    let cosTh = dot(rd, Lsun);
    let g = 0.62;
    let phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTh, 1.5) * 0.26 + 0.24;

    var amberAcc = 0.0;
    for (var i = 0; i < steps; i++) {
      let d = (f32(i) + jitter) * dt;
      let p = u.camPos.xyz + rd * d;

      let nearClear = smoothstep(38.0, 96.0, d);
      let inShaft = smoothstep(126.0, 74.0, length(p.xz - vec2<f32>(0.0, -340.0)))
                  * smoothstep(420.0, 305.0, p.y)
                  * smoothstep(-185.0, 95.0, p.y);
      let inNave = smoothstep(38.0, 16.0, abs(p.x))
                 * smoothstep(0.0, -40.0, p.z) * smoothstep(-235.0, -165.0, p.z)
                 * smoothstep(124.0, 88.0, p.y) * smoothstep(2.0, 14.0, p.y);
      let volMask = max(inShaft, inNave * 0.40) * nearClear;
      if (volMask > 0.005) {
        let relP = p - vec3<f32>(0.0, 180.0, -340.0);
        let uBeam = dot(relP, bU);
        let vBeam = dot(relP, bV);
        let tightShafts = pow(0.5 + 0.5 * sin(vBeam * 0.068 + 0.45), 4.0) * pow(0.5 + 0.5 * cos(uBeam * 0.036 - 0.20), 2.4);
        let subStreaks = 0.55 + 0.45 * sin(vBeam * 0.14 + uBeam * 0.07);
        let sunlitWall = smoothstep(-50.0, 102.0, p.x);

        let brShad1 = smoothstep(6.0, 26.0, abs((p.y - 276.0) - (p.x * 0.62)) + abs(p.z + 340.0) * 0.14);
        let brShad2 = smoothstep(6.0, 24.0, abs((p.y - 108.0) - (p.x * 0.62)) + abs(p.z + 340.0) * 0.14);
        let brOcc = 0.22 + 0.78 * min(brShad1, brShad2);

        let d1 = noise3(p * 0.018 + vec3<f32>(0.0, -t * 0.11, t * 0.04));
        let d2 = noise3(p * 0.048 + vec3<f32>(t * 0.05, -t * 0.18, 0.0));
        let dust = 0.38 + 0.85 * (d1 * 0.65 + d2 * 0.35);
        let beam = tightShafts * subStreaks * sunlitWall * dust * brOcc * volMask;
        amberAcc += beam * dt * 0.0094;
      }
    }
    let rayCol = mix(vec3<f32>(1.55, 0.80, 0.20), vec3<f32>(2.05, 1.65, 1.05), clamp(amberAcc * 0.72, 0.0, 1.0));
    vol += rayCol * amberAcc * phase * cathVis * (0.12 + 0.88 * fgPreserve);
  }

  // ACT III: ULTRA-CRISP 48-STEP PIERCING BLUE-WHITE ECLIPSE SHAFTS SLICING THROUGH ALL 22 RING GAPS!
  let spaceRayW = smoothstep(0.06, 0.46, u.actW.z) * smoothstep(0.08, 0.42, u.starScreen.w);
  if (spaceRayW > 0.01) {
    let sn = u.flags.w;
    let sn2 = sn * sn;
    let starUV = u.starScreen.xy;
    let delta = uv - starUV;
    let radialDist = length(delta);
    let rFrac = clamp(radialDist / mix(0.95, 1.45, sn), 0.0, 1.0);
    let smoothEnv = (1.0 - rFrac) * (1.0 - rFrac) * (1.0 - rFrac);
    let radialEnv = exp(-radialDist * radialDist * mix(1.20, 0.55, sn)) * smoothEnv;
    let isSkyPixel = depth >= 0.9998;
    let gapMask = select(sn2 * 0.48, 1.0, isSkyPixel);
    if (radialEnv > 0.002 && gapMask > 0.002) {
      let steps = 48;
      let rJit = ign(pix + vec2<f32>(fract(u.camUp.w * 0.381) * 53.0, 19.7));
      var trans = 1.0;
      var scatter = 0.0;
      var occCount = 0.0;

      for (var i = 0; i < steps; i++) {
        let fStep = (f32(i) + rJit) / f32(steps);
        let sampleUV = starUV + delta * fStep;
        if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
          let sd = loadDepthAtUV(sampleUV);
          let isGap = sd >= 0.9998;
          if (!isGap) { occCount += 1.0; }
          trans *= select(mix(0.82, 0.91, sn), 1.0, isGap);
          let dFromStar = fStep * radialDist;
          let falloff = exp(-dFromStar * mix(1.42, 0.95, sn));
          scatter += trans * falloff * select(0.0, 1.0, isGap);
        }
      }

      let hasRingGap = smoothstep(0.0, 2.2, occCount);
      let closeStarCore = exp(-radialDist * 9.5);
      let shaftMask = max(hasRingGap, closeStarCore * 0.35);
      let rawInt = (scatter / f32(steps)) * pow(trans, 0.32);
      let rayIntensity = (1.0 - exp(-rawInt * 2.9)) * shaftMask;
      let pulseBoost = 1.0 + 0.65 * exp(-pow((u.starPos.w - 0.14) * 5.0, 2.0));
      let rayTint = mix(vec3<f32>(0.38, 0.88, 2.20), vec3<f32>(2.4, 1.65, 0.85), smoothstep(0.20, 0.80, sn));
      let blueWhite = rayTint * rayIntensity * (2.45 + sn2 * 7.5) * pulseBoost * radialEnv * gapMask;
      vol += blueWhite * spaceRayW;
    }
  }

  let encodedDepth = select(min(sceneDist / 6000.0, 0.98), 1.0, depth >= 0.9998);
  return vec4<f32>(vol, encodedDepth);
}

@group(0) @binding(2) var volInTex: texture_2d<f32>;
@group(0) @binding(3) var volSamp: sampler;

fn worldPosFromDepth(uv: vec2<f32>, depth: f32) -> vec3<f32> {
  let ndc = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let wp4 = u.invViewProj * ndc;
  return wp4.xyz / wp4.w;
}

@fragment
fn fs_vol_blur(inp: VSOut) -> @location(0) vec4<f32> {
  let center = textureSampleLevel(volInTex, volSamp, inp.uv, 0.0);
  let cDepth = center.a;

  // Act III: 9-tap depth-preserving directional RADIAL blur -> silky cinema eclipse searchlights strictly BEHIND dark obsidian rings!
  if (u.actW.z > 0.25 && u.starScreen.w > 0.05) {
    if (cDepth < 0.99 && u.flags.w < 0.35) {
      return vec4<f32>(center.rgb, 1.0);
    }
    let dir = inp.uv - u.starScreen.xy;
    let dLen = length(dir);
    let rDir = select(vec2<f32>(0.0), dir / dLen, dLen > 0.002);
    let rStep = rDir * (min(dLen * 0.075, 0.020) * 0.25);
    var acc = center.rgb * 0.20;
    var wAcc = 0.20;
    for (var k = -4; k <= 4; k++) {
      if (k == 0) { continue; }
      let fk = f32(k);
      let sUV = clamp(inp.uv + rStep * fk, vec2<f32>(0.002), vec2<f32>(0.998));
      let s = textureSampleLevel(volInTex, volSamp, sUV, 0.0);
      let depthMatch = select(1.0, step(0.99, s.a), u.flags.w < 0.35);
      let w = exp(-fk * fk * 0.16) * depthMatch;
      acc += s.rgb * w;
      wAcc += w;
    }
    return vec4<f32>(acc / max(wAcc, 0.001), 1.0);
  }

  let texel = vec2<f32>(2.0 * u.res.z, 2.0 * u.res.w);

  var sum = center.rgb * 0.25;
  var wSum = 0.25;
  var offs = array<vec2<f32>, 8>(
    vec2<f32>(-1.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, -1.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  var spatialW = array<f32, 8>(0.125, 0.125, 0.125, 0.125, 0.0625, 0.0625, 0.0625, 0.0625);

  for (var i = 0; i < 8; i++) {
    let s = textureSampleLevel(volInTex, volSamp, inp.uv + offs[i] * texel, 0.0);
    let dz = abs(s.a - cDepth);
    let bilateral = exp(-dz * 120.0);
    let w = spatialW[i] * bilateral;
    sum += s.rgb * w;
    wSum += w;
  }

  // ULTRA CINEMATIC 7-TAP HORIZON-AWARE WORLD-SPACE SSAO (real contact shadows in cathedral arches, piers, portal & coffers!)
  var aoOut = 1.0;
  if (cDepth < 0.99 && u.actW.z < 0.65) {
    let dC = loadDepthAtUV(inp.uv);
    if (dC < 0.9997) {
      let wC = worldPosFromDepth(inp.uv, dC);
      let distC = length(wC - u.camPos.xyz);
      if (distC < 460.0) {
        let uvR = min(inp.uv + vec2<f32>(texel.x, 0.0), vec2<f32>(0.998));
        let uvU = max(inp.uv - vec2<f32>(0.0, texel.y), vec2<f32>(0.002));
        let wR = worldPosFromDepth(uvR, loadDepthAtUV(uvR));
        let wU = worldPosFromDepth(uvU, loadDepthAtUV(uvU));
        var nC = normalize(cross(wR - wC, wU - wC));
        if (dot(nC, u.camPos.xyz - wC) < 0.0) { nC = -nC; }

        let rotAng = ign(inp.pos.xy) * 6.2831853;
        let rScreen = clamp(15.0 / max(distC * 0.085, 1.0), 0.006, 0.032);
        let aspect = u.camFwd.w;
        var occ = 0.0;
        for (var k = 0; k < 7; k++) {
          let fk = f32(k);
          let rad = sqrt((fk + 0.5) / 7.0) * rScreen;
          let theta = fk * 2.3999632 + rotAng;
          let sUV = clamp(inp.uv + vec2<f32>(cos(theta) / aspect, sin(theta)) * rad, vec2<f32>(0.002), vec2<f32>(0.998));
          let dS = loadDepthAtUV(sUV);
          if (dS < 0.9997) {
            let wS = worldPosFromDepth(sUV, dS);
            let diff = wS - wC;
            let len = length(diff);
            // Smooth world-space range falloff -> ZERO dark halos around foreground bridges/columns!
            let rangeW = smoothstep(13.5, 1.2, len) * smoothstep(0.08, 0.65, len);
            let horizon = max(0.0, dot(nC, diff / max(len, 0.001)) - 0.16);
            occ += horizon * rangeW;
          }
        }
        let distFade = smoothstep(450.0, 220.0, distC);
        let actFade = smoothstep(0.65, 0.15, u.actW.z);
        // Stronger architectural crevice weight inside Act II stone cathedral & portal, gentler on Act I glassy ocean
        let waterAvoid = smoothstep(0.6, 4.2, wC.y + (1.0 - u.actW.x) * 20.0);
        let aoStrength = mix(0.95, 1.48, u.actW.y) * distFade * actFade * waterAvoid;
        aoOut = clamp(1.0 - (occ / 7.0) * aoStrength, 0.36, 1.0);
      }
    }
  }

  return vec4<f32>(sum / max(wSum, 0.001), aoOut);
}
`;

// =========================================================================
// 6. GPU-ANIMATED ATMOSPHERIC PARTICLES
// =========================================================================
export const PARTICLE_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;

struct Part {
  a: vec4<f32>,
  b: vec4<f32>,
};
@group(1) @binding(0) var<storage, read> parts: array<Part>;

struct VSOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) localUV: vec2<f32>,
  @location(1) color: vec4<f32>,
};

fn rotXZ(p: vec3<f32>, tx: f32, tz: f32) -> vec3<f32> {
  let cx = cos(tx); let sx = sin(tx);
  let cz = cos(tz); let sz = sin(tz);
  let p1 = vec3<f32>(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  return vec3<f32>(p1.x * cz - p1.y * sz, p1.x * sz + p1.y * cz, p1.z);
}

@vertex
fn vs_part(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let pt = parts[ii];
  let kind = pt.b.z;
  let t = u.camPos.w;
  let seed = pt.b.w;
  var o: VSOut;

  var actAlpha = 1.0;
  if (kind < 1.5) {
    actAlpha = smoothstep(0.02, 0.25, u.actW.x + u.actW.w * 0.6) * smoothstep(220.0, 90.0, u.camPos.y);
  } else if (kind < 2.8) {
    // Seamlessly visible from far across Act I sea looking through the portal, ALL the way down to the bottom of the abyss, AND looking back down through the Oculus from space!
    let fromSeaApproach = smoothstep(520.0, 140.0, u.camPos.z);
    let fromSpaceAbove = smoothstep(2200.0, 950.0, u.camPos.y);
    actAlpha = clamp(max(u.actW.y, fromSeaApproach * fromSpaceAbove), 0.0, 1.0);
  } else {
    actAlpha = smoothstep(0.02, 0.25, u.actW.z);
  }
  if (actAlpha <= 0.005) {
    o.clipPos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    o.localUV = vec2<f32>(0.0);
    o.color = vec4<f32>(0.0);
    return o;
  }

  var wPos = vec3<f32>(0.0);
  var tangent = u.camUp.xyz;
  var size = pt.a.w;
  var stretch = 1.0;
  var col = vec3<f32>(1.0);
  var shapeKind = 0.0;

  if (kind < 0.5) {
    let isCorridor = abs(pt.a.x) < 62.0;
    let maxH = select(120.0, 12.0, isCorridor);
    let rise = fract((pt.a.y + t * pt.b.x) / maxH) * maxH;
    let swayX = sin(t * 0.45 + pt.b.y) * 2.8;
    let swayZ = cos(t * 0.38 + pt.b.y * 1.3) * 2.8;
    wPos = vec3<f32>(pt.a.x + swayX, 1.2 + rise, pt.a.z + swayZ);
    let distCam = length(wPos - u.camPos.xyz);
    let nearFade = smoothstep(24.0, 56.0, distCam);
    let fade = smoothstep(0.0, maxH * 0.16, rise) * smoothstep(maxH, maxH * 0.75, rise) * nearFade;
    let twinkle = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(t * 2.8 + seed * 41.0), 2.0);
    // Delicate varied aqua-cyan & violet organic micro-sparks (ZERO uniform blurry bokeh circles!)
    col = mix(vec3<f32>(0.08, 1.15, 1.45), vec3<f32>(0.62, 0.32, 1.35), seed) * fade * twinkle * 0.85;
    size = min(size, distCam * 0.0042);
    stretch = 1.65 + seed * 0.9;
    shapeKind = 0.0;
  } else if (kind < 2.2) {
    // Act II: Continuous rising ember swarms from deepest abyss (y=-760) all the way up to the Pantheon Oculus (y=+495)!
    let rad = pt.a.x;
    let yFlow = fract((pt.a.y + 760.0 + t * pt.b.x) / 1255.0) * 1255.0 - 760.0;
    // When far out at Act I sea, keep sparks strictly inside the corridor-visible height band so none float above the portal sky!
    if (u.camPos.z > 115.0 && u.camPos.y < 145.0 && yFlow > 140.0) {
      o.clipPos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
      o.localUV = vec2<f32>(0.0);
      o.color = vec4<f32>(0.0);
      return o;
    }
    let angSpeed = 0.14 + 0.16 * seed;
    let ang = pt.a.z + t * angSpeed + yFlow * 0.008;
    wPos = vec3<f32>(cos(ang) * rad, yFlow, -340.0 + sin(ang) * rad);
    let distCam = length(wPos - u.camPos.xyz);
    let nearFade = smoothstep(22.0, 56.0, distCam);
    let floorFade = smoothstep(-760.0, -700.0, wPos.y);
    let oculusVis = smoothstep(505.0, 450.0, wPos.y);
    tangent = normalize(vec3<f32>(-sin(ang) * rad * angSpeed, pt.b.x, cos(ang) * rad * angSpeed));
    let pulse = 0.65 + 0.35 * sin(t * 4.5 + seed * 27.0);
    col = mix(vec3<f32>(3.0, 1.50, 0.32), vec3<f32>(3.2, 0.22, 0.06), smoothstep(0.45, 0.90, seed)) * pulse * nearFade * floorFade * oculusVis * 1.25;
    size = min(size * 1.15, distCam * 0.0068);
    stretch = 2.4 + seed * 1.2;
    shapeKind = 2.0;
  } else if (kind < 2.8) {
    let yFlow = fract((pt.a.y + t * pt.b.x * 0.5) / 112.0) * 112.0;
    wPos = vec3<f32>(pt.a.x + sin(t + pt.b.y) * 2.2, 4.0 + yFlow, pt.a.z);
    let distCam = length(wPos - u.camPos.xyz);
    let nearFade = smoothstep(26.0, 62.0, distCam);
    tangent = normalize(vec3<f32>(cos(t + pt.b.y) * 0.4, 1.0, 0.0));
    col = mix(vec3<f32>(2.5, 1.22, 0.28), vec3<f32>(2.8, 0.20, 0.06), seed) * nearFade * 0.90;
    size = min(size * 1.10, distCam * 0.0068);
    stretch = 2.2;
    shapeKind = 2.0;
  } else {
    let orbR = pt.a.x;
    let ang = pt.b.y + t * pt.b.x;
    let flatP = vec3<f32>(cos(ang) * orbR, (seed - 0.5) * 14.0, sin(ang) * orbR);
    let flatVel = vec3<f32>(-sin(ang) * sign(pt.b.x), 0.0, cos(ang) * sign(pt.b.x));
    wPos = u.starPos.xyz + rotXZ(flatP, pt.a.y, pt.a.z);
    tangent = normalize(rotXZ(flatVel, pt.a.y, pt.a.z));

    let distCam = length(wPos - u.camPos.xyz);
    let nearFade = smoothstep(32.0, 110.0, distCam);
    let pulseR = 250.0 + u.starPos.w * 1680.0;
    let pulseHit = exp(-pow((orbR - pulseR) / 95.0, 2.0)) * (1.0 - u.starPos.w * 0.40);
    let twinkle = 0.55 + 0.45 * sin(t * 2.6 + seed * 41.0);
    let goldBase = mix(vec3<f32>(1.95, 1.42, 0.56), vec3<f32>(1.35, 0.96, 0.42), seed);
    let varyBri = 0.30 + 1.05 * pow(seed, 2.0);
    col = mix(goldBase, vec3<f32>(1.5, 2.2, 3.4), pulseHit * 0.65) * varyBri * (0.95 + pulseHit * 3.0) * twinkle * nearFade;
    stretch = 1.7 + seed * 1.8;
    shapeKind = 3.0;
  }

  if (u.flags.x > 0.5 && wPos.y < u.flags.y) {
    o.clipPos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    o.localUV = vec2<f32>(0.0);
    o.color = vec4<f32>(0.0);
    return o;
  }

  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
  );
  let c = corners[vi];

  let toCam = normalize(u.camPos.xyz - wPos);
  var sideAxis = cross(tangent, toCam);
  let sLen = length(sideAxis);
  if (sLen < 0.001) { sideAxis = u.camRight.xyz; } else { sideAxis = sideAxis / sLen; }
  let upAxis = normalize(cross(toCam, sideAxis));

  let bbPos = wPos + sideAxis * (c.x * size) + upAxis * (c.y * size * stretch);
  o.clipPos = u.viewProj * vec4<f32>(bbPos, 1.0);
  o.localUV = c;
  o.color = vec4<f32>(col * actAlpha, shapeKind);
  return o;
}

@fragment
fn fs_part(inp: VSOut) -> @location(0) vec4<f32> {
  let uv = inp.localUV;
  let k = inp.color.a;
  var a = 0.0;

  if (k > 1.5 && k < 2.5) {
    // Crisp small faceted geometric diamond head + soft tapering ember wake
    let dDia = abs(uv.x) * 1.45 + abs(uv.y - 0.22) * 1.15;
    let head = smoothstep(0.72, 0.15, dDia);
    let tail = exp(-uv.x * uv.x * 12.0) * smoothstep(-1.0, 0.35, uv.y) * smoothstep(0.85, 0.15, uv.y) * 0.45;
    a = head + tail;
  } else if (k > 2.5) {
    // Silky luminous golden stardust pinpoint sparkles (ZERO chunky short orange dashes!)
    let core = exp(-(uv.x * uv.x * 11.0 + uv.y * uv.y * 4.5));
    a = core * smoothstep(1.0, 0.1, length(uv));
  } else {
    // Crisp tiny luminous sea-mist micro-spark (ZERO uniform round bokeh circles!)
    let d = length(uv);
    a = exp(-d * d * 8.5) * smoothstep(1.0, 0.05, d);
  }

  if (a < 0.002) { discard; }
  return vec4<f32>(inp.color.rgb * a, a);
}
`;

// =========================================================================
// 7. 4-MIP PHYSICALLY BASED KARIS-AVERAGE BLOOM
// =========================================================================
export const BLOOM_WGSL = /* wgsl */ `
struct BloomParams {
  texel: vec2<f32>,
  threshold: f32,
  isFirstPass: f32,
};

@group(0) @binding(0) var<uniform> bp: BloomParams;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var linSamp: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_bloom(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

fn luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn softPrefilter(c: vec3<f32>, thresh: f32) -> vec3<f32> {
  let br = max(max(c.r, c.g), c.b);
  let knee = thresh * 0.45 + 0.0001;
  let soft = clamp(br - thresh + knee, 0.0, 2.0 * knee);
  let contrib = max(br - thresh, (soft * soft) / (4.0 * knee)) / max(br, 0.0001);
  return c * clamp(contrib, 0.0, 8.0);
}

fn karisWeight(c: vec3<f32>) -> f32 {
  return 1.0 / (1.0 + luma(c));
}

@fragment
fn fs_down(inp: VSOut) -> @location(0) vec4<f32> {
  let uv = inp.uv;
  let t = bp.texel;

  let a = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-2.0,  2.0) * t, 0.0).rgb;
  let b = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 0.0,  2.0) * t, 0.0).rgb;
  let c = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 2.0,  2.0) * t, 0.0).rgb;
  let d = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-2.0,  0.0) * t, 0.0).rgb;
  let e = textureSampleLevel(srcTex, linSamp, uv, 0.0).rgb;
  let f = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 2.0,  0.0) * t, 0.0).rgb;
  let g = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-2.0, -2.0) * t, 0.0).rgb;
  let h = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 0.0, -2.0) * t, 0.0).rgb;
  let i = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 2.0, -2.0) * t, 0.0).rgb;
  let j = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-1.0,  1.0) * t, 0.0).rgb;
  let k = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 1.0,  1.0) * t, 0.0).rgb;
  let l = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-1.0, -1.0) * t, 0.0).rgb;
  let m = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 1.0, -1.0) * t, 0.0).rgb;

  var outCol: vec3<f32>;
  if (bp.isFirstPass > 0.5) {
    let g0 = softPrefilter((a + b + d + e) * 0.25, bp.threshold);
    let g1 = softPrefilter((b + c + e + f) * 0.25, bp.threshold);
    let g2 = softPrefilter((d + e + g + h) * 0.25, bp.threshold);
    let g3 = softPrefilter((e + f + h + i) * 0.25, bp.threshold);
    let g4 = softPrefilter((j + k + l + m) * 0.25, bp.threshold);
    let w0 = karisWeight(g0) * 0.125;
    let w1 = karisWeight(g1) * 0.125;
    let w2 = karisWeight(g2) * 0.125;
    let w3 = karisWeight(g3) * 0.125;
    let w4 = karisWeight(g4) * 0.5;
    outCol = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(w0 + w1 + w2 + w3 + w4, 0.0001);
  } else {
    outCol = e * 0.125
           + (a + c + g + i) * 0.03125
           + (b + d + f + h) * 0.0625
           + (j + k + l + m) * 0.125;
  }
  return vec4<f32>(max(outCol, vec3<f32>(0.0)), 1.0);
}

@fragment
fn fs_up(inp: VSOut) -> @location(0) vec4<f32> {
  let uv = inp.uv;
  let t = bp.texel * 1.15;
  var sum = textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-1.0,  1.0) * t, 0.0).rgb * 1.0;
  sum += textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 0.0,  1.0) * t, 0.0).rgb * 2.0;
  sum += textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 1.0,  1.0) * t, 0.0).rgb * 1.0;
  sum += textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-1.0,  0.0) * t, 0.0).rgb * 2.0;
  sum += textureSampleLevel(srcTex, linSamp, uv, 0.0).rgb * 4.0;
  sum += textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 1.0,  0.0) * t, 0.0).rgb * 2.0;
  sum += textureSampleLevel(srcTex, linSamp, uv + vec2<f32>(-1.0, -1.0) * t, 0.0).rgb * 1.0;
  sum += textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 0.0, -1.0) * t, 0.0).rgb * 2.0;
  sum += textureSampleLevel(srcTex, linSamp, uv + vec2<f32>( 1.0, -1.0) * t, 0.0).rgb * 1.0;
  return vec4<f32>(sum * (1.0 / 16.0), 1.0);
}
`;

// =========================================================================
// 8. FINAL HDR COMPOSITE + BANDING-FREE AGX FILMIC + TRIANGULAR DITHER
// =========================================================================
export const COMPOSITE_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var hdrTex: texture_2d<f32>;
@group(0) @binding(2) var volTex: texture_2d<f32>;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
@group(0) @binding(4) var linSamp: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_comp(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

fn agxDefaultContrastApprox(x: vec3<f32>) -> vec3<f32> {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
       - 40.14 * x4 * x
       + 31.96 * x4
       - 6.868 * x2 * x
       + 0.4298 * x2
       + 0.1191 * x
       - 0.00232;
}

fn agxToSrgb(val: vec3<f32>) -> vec3<f32> {
  let agxMat = mat3x3<f32>(
    vec3<f32>(0.84247906, 0.04232824, 0.04237565),
    vec3<f32>(0.07843360, 0.87846864, 0.07843360),
    vec3<f32>(0.07922375, 0.07916613, 0.87914297)
  );
  let agxInv = mat3x3<f32>(
    vec3<f32>( 1.19687900, -0.05289685, -0.05297163),
    vec3<f32>(-0.09802088,  1.15190313, -0.09804345),
    vec3<f32>(-0.09902974, -0.09896118,  1.15107367)
  );

  var v = agxMat * max(val, vec3<f32>(0.0));
  v = clamp(log2(v + vec3<f32>(0.00018)), vec3<f32>(-12.47393), vec3<f32>(4.026069));
  v = (v - (-12.47393)) / (4.026069 - (-12.47393));
  v = agxDefaultContrastApprox(v);
  v = agxInv * v;
  v = max(v - vec3<f32>(0.003), vec3<f32>(0.0)) * 1.003;
  v = pow(v, vec3<f32>(1.10));
  let l = dot(v, vec3<f32>(0.2126, 0.7152, 0.0722));
  v = mix(vec3<f32>(l), v, 1.18);
  return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_comp(inp: VSOut) -> @location(0) vec4<f32> {
  let uv = inp.uv;
  var hdr = textureSampleLevel(hdrTex, linSamp, uv, 0.0).rgb;
  let volSample = textureSampleLevel(volTex, linSamp, uv, 0.0);
  let vol = volSample.rgb;
  // Smooth 4-tap bilinear box filter on half-res horizon SSAO (skipped coherently in Act III space -> zero overhead!)
  if (u.actW.z < 0.65) {
    let vT = u.res.zw * 1.5;
    let aoSmooth = (
      textureSampleLevel(volTex, linSamp, uv + vec2<f32>( vT.x,  vT.y), 0.0).a
      + textureSampleLevel(volTex, linSamp, uv + vec2<f32>(-vT.x,  vT.y), 0.0).a
      + textureSampleLevel(volTex, linSamp, uv + vec2<f32>( vT.x, -vT.y), 0.0).a
      + textureSampleLevel(volTex, linSamp, uv + vec2<f32>(-vT.x, -vT.y), 0.0).a
    ) * 0.25;
    // Preserve bright glowing clerestory windows & embers untouched by SSAO while grounding all stone architecture!
    let hdrLuma = dot(hdr, vec3<f32>(0.2126, 0.7152, 0.0722));
    let aoApply = mix(aoSmooth, 1.0, smoothstep(0.65, 2.2, hdrLuma));
    hdr *= aoApply;
  }

  let bloom = textureSampleLevel(bloomTex, linSamp, uv, 0.0).rgb;

  let bloomWeight = mix(0.22, 0.24, u.actW.z);
  hdr = hdr + vol + bloom * bloomWeight;

  let actExp = u.actW.x * 1.16 + u.actW.y * 1.28 + u.actW.z * 0.98;
  hdr *= actExp * u.flags.z;

  // Explosive HDR Supernova Climax: preserves 100% of gorgeous turquoise/rose/gold nebula detail through sn=0.72,
  // THEN the incandescent core shockfront rushes cleanly to overtake the ENTIRE viewport into pure #FFFFFF white!
  let sn = u.flags.w;
  var shockFill = 0.0;
  if (sn > 0.55) {
    let cl = clamp((sn - 0.55) / 0.45, 0.0, 1.0);
    let sDist = length((uv - u.starScreen.xy) * vec2<f32>(u.camFwd.w, 1.0));
    let frontRadius = mix(0.06, 2.45, pow(cl, 2.1));
    shockFill = smoothstep(frontRadius * 1.28, frontRadius * 0.35, sDist) * smoothstep(0.0, 0.55, cl);
    let peakBoost = pow(smoothstep(0.50, 0.94, cl), 2.0) * 65.0;
    hdr += mix(vec3<f32>(1.25, 1.02, 0.82), vec3<f32>(1.0, 1.0, 1.0), smoothstep(0.35, 0.85, cl)) * (shockFill * 28.0 + peakBoost);
  }

  let vc = uv * 2.0 - 1.0;
  let vig = 1.0 - dot(vc, vc) * (0.16 * (1.0 - smoothstep(0.70, 0.96, sn)));
  hdr *= clamp(vig, 0.68, 1.0);

  var srgb = agxToSrgb(hdr);
  if (sn > 0.82) {
    // Pure radiant #FFFFFF white driven seamlessly by the approaching shockfront overtaking 100% of viewport!
    let fullWhite = clamp(shockFill * smoothstep(0.82, 0.95, sn) + smoothstep(0.90, 0.98, sn), 0.0, 1.0);
    srgb = mix(srgb, vec3<f32>(1.0, 1.0, 1.0), fullWhite);
  }

  // Pack perceptual luma into alpha for ultra-fast single-pass post-tonemap FXAA 3.11 edge smoothing!
  let lumaOut = dot(srgb, vec3<f32>(0.299, 0.587, 0.114));
  return vec4<f32>(srgb, lumaOut);
}
`;

// =========================================================================
// 9. POST-TONEMAP FXAA 3.11 QUALITY + TRIANGULAR ANTI-BANDING DITHER!
//    (Eliminates HDR specular/rim jagged aliasing on astrolabe rings, crystals & stone!)
// =========================================================================
export const FXAA_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var ldrTex: texture_2d<f32>;
@group(0) @binding(2) var linSamp: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_fxaa(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

@fragment
fn fs_fxaa(inp: VSOut) -> @location(0) vec4<f32> {
  let uv = inp.uv;
  let rcp = u.res.zw;

  let cM = textureSampleLevel(ldrTex, linSamp, uv, 0.0);
  let lM = cM.a;
  let lN = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>( 0.0, -rcp.y), 0.0).a;
  let lS = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>( 0.0,  rcp.y), 0.0).a;
  let lW = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>(-rcp.x,  0.0), 0.0).a;
  let lE = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>( rcp.x,  0.0), 0.0).a;

  let lMin = min(lM, min(min(lN, lS), min(lW, lE)));
  let lMax = max(lM, max(max(lN, lS), max(lW, lE)));
  let lRange = lMax - lMin;

  var outCol = cM.rgb;
  if (lRange >= max(0.0312, lMax * 0.0833)) {
    let lNW = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>(-rcp.x, -rcp.y), 0.0).a;
    let lNE = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>( rcp.x, -rcp.y), 0.0).a;
    let lSW = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>(-rcp.x,  rcp.y), 0.0).a;
    let lSE = textureSampleLevel(ldrTex, linSamp, uv + vec2<f32>( rcp.x,  rcp.y), 0.0).a;

    let lNS = lN + lS;
    let lWE = lW + lE;
    let lSub = clamp(abs((lNS + lWE) * 0.25 - lM) / lRange, 0.0, 1.0);
    let subBlend = smoothstep(0.0, 1.0, lSub);
    let subFinal = subBlend * subBlend * 0.72;

    let edgeH = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
    let edgeV = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
    let isHoriz = edgeH >= edgeV;

    let l1 = select(lW, lN, isHoriz);
    let l2 = select(lE, lS, isHoriz);
    let g1 = abs(l1 - lM);
    let g2 = abs(l2 - lM);
    let stepSign = select(1.0, -1.0, g1 >= g2);
    let stepLen = select(rcp.x, rcp.y, isHoriz) * stepSign;
    let gradScaled = 0.25 * max(g1, g2);
    let lLocalAvg = 0.5 * (select(l2, l1, g1 >= g2) + lM);

    var curUV = uv;
    if (isHoriz) { curUV.y += stepLen * 0.5; } else { curUV.x += stepLen * 0.5; }
    let tangent = select(vec2<f32>(0.0, rcp.y), vec2<f32>(rcp.x, 0.0), isHoriz);

    var stepMults = array<f32, 6>(1.0, 1.5, 2.0, 2.0, 2.0, 4.0);
    var uv1 = curUV - tangent;
    var uv2 = curUV + tangent;
    var e1 = textureSampleLevel(ldrTex, linSamp, uv1, 0.0).a - lLocalAvg;
    var e2 = textureSampleLevel(ldrTex, linSamp, uv2, 0.0).a - lLocalAvg;
    var done1 = abs(e1) >= gradScaled;
    var done2 = abs(e2) >= gradScaled;

    for (var s = 0; s < 6; s++) {
      if (done1 && done2) { break; }
      let st = tangent * stepMults[s];
      if (!done1) {
        uv1 -= st;
        e1 = textureSampleLevel(ldrTex, linSamp, uv1, 0.0).a - lLocalAvg;
        done1 = abs(e1) >= gradScaled;
      }
      if (!done2) {
        uv2 += st;
        e2 = textureSampleLevel(ldrTex, linSamp, uv2, 0.0).a - lLocalAvg;
        done2 = abs(e2) >= gradScaled;
      }
    }

    let d1 = select(uv.y - uv1.y, uv.x - uv1.x, isHoriz);
    let d2 = select(uv2.y - uv.y, uv2.x - uv.x, isHoriz);
    let dMin = min(d1, d2);
    let span = max(d1 + d2, 1e-5);
    let isCloser1 = d1 < d2;
    let correctVar = (select(e2, e1, isCloser1) < 0.0) != (lM < lLocalAvg);
    let edgeBlend = select(0.0, 0.5 - dMin / span, correctVar);
    let finalOff = max(edgeBlend, subFinal);

    var sampleUV = uv;
    if (isHoriz) { sampleUV.y += finalOff * stepLen; } else { sampleUV.x += finalOff * stepLen; }
    outCol = textureSampleLevel(ldrTex, linSamp, sampleUV, 0.0).rgb;
  }

  // Final triangular anti-banding dither on 8-bit swapchain output
  let d1 = ign(inp.pos.xy);
  let d2 = ign(inp.pos.xy + vec2<f32>(17.31, 41.73));
  let triNoise = (d1 + d2 - 1.0) * (1.15 / 255.0);
  outCol = clamp(outCol + vec3<f32>(triNoise), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(outCol, 1.0);
}
`;

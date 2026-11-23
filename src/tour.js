// Scripted 90-second epic continuous guided tour (scales cleanly to 60s for verification/bench!) + Supernova climax + 6 poses
import { clamp, smoothstep } from './math.js';

export const TOUR_DURATION = 90.0;

// 6 Fixed Verification Camera Poses matching specification
export const POSES = [
  {
    name: 'pose1_hero_prism_corridor',
    label: 'Hero: Prism Corridor & Gas Giant',
    eye: [0.0, 14.0, 368.0],
    target: [-3.0, 60.0, -140.0],
    fov: 58,
    time: 10.5,
  },
  {
    name: 'pose2_wide_sea_auroras',
    label: 'Wide Sea & Auroras',
    eye: [-128.0, 42.0, 498.0],
    target: [12.0, 56.0, 20.0],
    fov: 66,
    time: 0.5,
  },
  {
    name: 'pose3_fractured_portal_monolith',
    label: 'Fractured Portal Monolith',
    eye: [4.0, 22.0, 96.0],
    target: [0.0, 50.0, -120.0],
    fov: 58,
    time: 23.0,
  },
  {
    name: 'pose4_astrolabe_white_dwarf',
    label: 'Aligned Astrolabe & White Dwarf',
    eye: [0.0, 1840.0, 140.0],
    target: [0.0, 2380.0, -1780.0],
    fov: 54,
    time: 80.5,
  },
  {
    name: 'pose5_crystal_edge_closeup',
    label: 'Refractive Crystal Edge Close-Up',
    eye: [-58.0, 9.5, 408.0],
    target: [-94.0, 26.0, 344.0],
    fov: 48,
    time: 15.0,
  },
  {
    name: 'pose6_cathedral_shaft_amber_rays',
    label: 'Fractal Cathedral Shaft & Amber Rays',
    eye: [-26.0, 192.0, -308.0],
    target: [38.0, 182.0, -392.0],
    fov: 64,
    time: 44.0,
  },
];

// Scripted 90-second seamless three-act epic camera flight keyframes
// Elevated clean nave entry, gentle stately abyss gaze (ZERO whip!), lower/upper-third diagonal bridges,
// dead-center Pantheon dome Oculus framing the planetary astrolabe BEFORE exit -> Planetary Orbit -> Supernova!
const KF = [
  // ACT I (0s - 27s): Starts seamlessly from EXACT Start Menu Hero Prism Corridor (ZERO camera cut on start OR rewind to 0s!) -> Sweeps continuously forward into Fractured Portal Monolith
  [0.0,     0,  14,  368,   -3,   60, -140,  58,  0.00], // Exact Menu pose: Hero Prism Corridor framing colossal banded gas giant
  [5.5,   -26,  22,  332,    6,   56, -110,  60,  0.03], // Sweeping forward & gently wide across rippled mirrored sea & 3D auroras
  [11.5,  -18,  11,  268,   -8,   38,  -10,  57, -0.04], // Low glide beside crystal-clear 5-band refractive quartz blades
  [17.5,   14,  15,  186,    2,   44,  -80,  57,  0.03], // Weaving across mirrored caustic ocean between prism cliffs
  [22.8,    4,  24,   96,    0,   52, -120,  58,  0.01], // Approaching Fractured Portal Monolith (Pose 3)
  [27.0,    0,  36,   16,    0,   42, -220,  59,  0.00], // Elevated graceful entry through vaulted monolithic basalt portal

  // ACT II (27s - 58.5s): Clean Elevated Nave Glide -> Stately Abyss Gaze -> Monumental Shaft -> Pantheon Dome Oculus Framing Astrolabe!
  [30.8,    0,  44, -125,    0,   30, -340,  61,  0.00], // Elevated glide through vaulted stone nave (ZERO floor/parapet scrape!)
  [34.5,    0,  48, -268,    0,  -14, -365,  62,  0.00], // Emerging cleanly high above smoky cathedral abyss
  [38.5,   14,  64, -312,  -10,   12, -358,  62,  0.02], // Stately gentle abyss gaze transitioning smoothly upward (ZERO whip!)
  [42.5,  -22, 128, -310,   24,  136, -372,  63, -0.03], // Sweeping past diagonal lower bridge cleanly in lower third
  [46.5,  -26, 192, -308,   38,  182, -392,  64, -0.03], // Pose 6 majestic multi-tier Piranesi cathedral cut by solar-amber beams!
  [50.5,  -14, 266, -290,   16,  330, -400,  62, -0.02], // Rising gracefully clear of upper diagonal skybridge
  [53.8,    0, 342, -258,    0, 2380, -1780, 61,  0.00], // Framing the gleaming planetary astrolabe DEAD-CENTER through the dome Oculus!
  [56.8,    0, 430, -298,    0, 2380, -1780, 60,  0.00], // Soaring smoothly upward straight toward the circular Pantheon dome aperture!
  [59.8,    0, 565, -372,    0, 2380, -1780, 58,  0.00], // Seamless zero-pop emergence into rich starry deep-space indigo!

  // ACT III (60s - 90s): True Planetary-Scale 3D Orbital Sweep Around 22 Colossal Obsidian/Bronze Rings -> Grand Alignment -> SUPERNOVA!
  [64.5, -260, 960, -40,     0, 2380, -1780, 57,  0.04], // Ascending across deep space toward the planetary-scale orbital astrolabe!
  [70.0, -760, 1420, 180,    0, 2380, -1780, 56,  0.07], // Sweeping dramatic 3D side-elevation orbit showcasing colossal ring tilts!
  [75.5, -520, 1890, 200,    0, 2380, -1780, 55,  0.04], // Gliding high alongside sweeping golden star-dust streams & eclipse shafts
  [81.0,    0, 1840, 140,    0, 2380, -1780, 54,  0.00], // Grand Alignment framing the blinding white dwarf dead-center (Pose 4)
  [85.2,  135, 1865, 125,    0, 2380, -1780, 53, -0.02], // Smooth orbital drift as white dwarf intensifies & spectral shock ignites!
  [88.0,   68, 1890,  90,    0, 2380, -1780, 51, -0.01], // Pushing inward as luminous sapphire-gold shockwave expands through rings!
  [90.0,   16, 1915,  55,    0, 2380, -1780, 49,  0.00], // Pure #FFFFFF incandescent white climax -> seamless return to Start Menu!
];

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function evalTourCamera(out8, timeSec, duration = TOUR_DURATION) {
  const scale = TOUR_DURATION / Math.max(1.0, duration);
  const t = clamp(timeSec * scale, 0.0, TOUR_DURATION);
  const n = KF.length;
  let seg = 0;
  while (seg < n - 2 && t > KF[seg + 1][0]) seg++;

  const k0 = KF[Math.max(0, seg - 1)];
  const k1 = KF[seg];
  const k2 = KF[Math.min(n - 1, seg + 1)];
  const k3 = KF[Math.min(n - 1, seg + 2)];

  const dt = Math.max(k2[0] - k1[0], 1e-4);
  const u = clamp((t - k1[0]) / dt, 0.0, 1.0);

  for (let c = 0; c < 8; c++) {
    out8[c] = catmullRom(k0[c + 1], k1[c + 1], k2[c + 1], k3[c + 1], u);
  }
  return out8;
}

// Normalized supernova explosion curve (0 until final 15.5% of tour -> ~14s of progressive invisible radiation spacetime warp + expanding nebula + fireball -> pure #FFFFFF white!)
export function evalSupernova(timeSec, duration = TOUR_DURATION) {
  const u = clamp(timeSec / Math.max(1.0, duration), 0.0, 1.0);
  if (u <= 0.845) return 0.0;
  const s = clamp((u - 0.845) / 0.155, 0.0, 1.0);
  // Smooth ease-in with rich time spent in radiation buildup & colorful nebula before accelerating into pure white!
  return s * (0.40 + 0.60 * s * s);
}

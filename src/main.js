// Pure WebGPU Three-Act Cosmic Journey Renderer (zero external libs, zero per-frame JS allocs)
import {
  clamp, smoothstep, mat4Perspective, mat4LookAt, mat4Mul, mat4Invert,
  computeActWeights, clampFreeCamera, WORLD,
} from './math.js';
import {
  buildCrystalWorld, buildPortalAndExterior, buildCathedralModules,
  buildAstrolabe, buildOceanMesh, buildParticles,
} from './geom.js';
import {
  BAKE_TEX_WGSL, SKY_WGSL, OPAQUE_WGSL, WATER_WGSL, CRYSTAL_WGSL,
  VOLUMETRIC_WGSL, PARTICLE_WGSL, BLOOM_WGSL, COMPOSITE_WGSL, FXAA_WGSL,
} from './shaders.js';
import { POSES, TOUR_DURATION, evalTourCamera, evalSupernova } from './tour.js';
import { CosmicAudio } from './audio.js';

const TS_SLOTS = 4;
const TS_MAX_PASSES = 18;
const MAX_PERF_FRAMES = 16384;

const ACT_NAMES = ['I · MIRRORED PRISM SEA', 'II · FRACTAL CATHEDRAL', 'III · ORBITAL ASTROLABE'];

// Preallocated frame-loop math scratchpad (ZERO allocations per frame! 196 floats includes 22 analytical ring eclipse shadow planes!)
const uMainData = new Float32Array(196);
const uReflData = new Float32Array(196);
const mProj = new Float32Array(16);
const mView = new Float32Array(16);
const mVP = new Float32Array(16);
const mInvVP = new Float32Array(16);
const mReflView = new Float32Array(16);
const mReflVP = new Float32Array(16);
const mReflInvVP = new Float32Array(16);
const actW = new Float32Array(4);
const tourEval = new Float32Array(8);
const camPos = new Float32Array(3);
const camFwd = new Float32Array(3);
const camRight = new Float32Array(3);
const camUp = new Float32Array(3);
const camTarget = new Float32Array(3);
const camVel = new Float32Array(3);

// Preallocated performance telemetry buffers (zero per-frame alloc)
const perfFrameDt = new Float64Array(MAX_PERF_FRAMES);
const perfGpuSpan = new Float64Array(MAX_PERF_FRAMES);
const perfGpuSum = new Float64Array(MAX_PERF_FRAMES);
const perfTourT = new Float64Array(MAX_PERF_FRAMES);
const perfAct = new Uint8Array(MAX_PERF_FRAMES);

// Preallocated 120-sample live frame-time & GPU-ms ring buffers for top-right sparkline graph
const GRAPH_N = 120;
const graphFtHist = new Float32Array(GRAPH_N);
const graphGpuHist = new Float32Array(GRAPH_N);
let graphHead = 0;
let lastGpuMsRaw = 0;

// DOM handles
const canvas = document.getElementById('c');
const menuEl = document.getElementById('menu');
const barFill = document.getElementById('bar-fill');
const statusEl = document.getElementById('load-status');
const actionsEl = document.getElementById('menu-actions');
const hudEl = document.getElementById('hud');
const hudActEl = document.getElementById('hud-act');
const hudModeEl = document.getElementById('hud-mode');
const hudTimeEl = document.getElementById('hud-time');
const flashEl = document.getElementById('flash');
const fpsBoxEl = document.getElementById('fps-box');
const fpsTxtEl = document.getElementById('fps-txt');
const msGraphEl = document.getElementById('ms-graph');
const msGraphCtx = msGraphEl ? msGraphEl.getContext('2d') : null;
const errEl = document.getElementById('err');
const reportEl = document.getElementById('report');

const audio = new CosmicAudio();
const gpuErrors = [];
function logGpuError(msg) {
  if (gpuErrors.length < 24) gpuErrors.push(msg);
  console.error('[WebGPU]', msg);
  if (errEl) {
    errEl.textContent = gpuErrors.slice(0, 6).join('\n');
    errEl.style.display = 'block';
    errEl.style.whiteSpace = 'pre-wrap';
    errEl.style.textAlign = 'left';
    errEl.style.maxHeight = '180px';
    errEl.style.overflow = 'auto';
  }
  if (reportEl) reportEl.dataset.errors = JSON.stringify(gpuErrors);
}

function setLoadProgress(pct, msg) {
  if (barFill) barFill.style.width = `${pct}%`;
  if (statusEl) statusEl.textContent = msg;
}
function yieldFrame() {
  return new Promise((r) => requestAnimationFrame(r));
}

function showError(msg) {
  if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  if (statusEl) statusEl.textContent = msg;
}

// Compute percentile from subarray slice (called only when generating report, not per frame)
function calcStats(arr, count) {
  if (count <= 0) return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  const sorted = Float64Array.from(arr.subarray(0, count)).sort();
  let sum = 0;
  for (let i = 0; i < count; i++) sum += sorted[i];
  const at = (p) => sorted[Math.min(count - 1, Math.floor(p * (count - 1)))];
  return {
    count,
    avg: sum / count,
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[count - 1],
  };
}

async function boot() {
  setLoadProgress(6, 'Initializing WebGPU adapter…');
  await yieldFrame();

  if (!navigator.gpu) {
    showError('WebGPU is not supported in this browser. Please open in Chrome on macOS.');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    showError('No WebGPU GPU adapter found.');
    return;
  }

  const adapterInfo = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
  const hasTimestampQuery = adapter.features.has('timestamp-query');
  const requiredFeatures = hasTimestampQuery ? ['timestamp-query'] : [];

  const device = await adapter.requestDevice({ requiredFeatures });
  device.lost.then((info) => logGpuError(`WebGPU device lost: ${info.message}`));
  device.addEventListener('uncapturederror', (ev) => {
    logGpuError(ev.error ? ev.error.message : String(ev));
  });

  const ctx = canvas.getContext('webgpu');
  const swapFormat = navigator.gpu.getPreferredCanvasFormat();

  const makeBuf = (arr, usage) => {
    const size = Math.max(16, Math.ceil(arr.byteLength / 4) * 4);
    const buf = device.createBuffer({ size, usage, mappedAtCreation: true });
    new arr.constructor(buf.getMappedRange()).set(arr);
    buf.unmap();
    return buf;
  };
  const uploadMesh = (m) => ({
    vb: makeBuf(m.vertices, GPUBufferUsage.VERTEX),
    ib: makeBuf(m.indices, GPUBufferUsage.INDEX),
    indexCount: m.indexCount,
  });

  // 1. Build procedural world geometry with real loading bar progress
  setLoadProgress(22, 'Sculpting mirrored crystal prism sea…');
  await yieldFrame();
  const crystalData = buildCrystalWorld();
  const oceanData = buildOceanMesh();

  setLoadProgress(44, 'Carving fractured monolith & fractal cathedral…');
  await yieldFrame();
  const portalExtData = buildPortalAndExterior();
  const cathData = buildCathedralModules();

  setLoadProgress(66, 'Forging planetary-scale orbital astrolabe…');
  await yieldFrame();
  const astroData = buildAstrolabe();
  const partData = buildParticles();

  setLoadProgress(82, 'Uploading GPU geometry & compiling WGSL pipelines…');
  await yieldFrame();

  // GPU Buffers
  const meshCrystals = uploadMesh(crystalData.crystalsAll);
  const meshPortalNave = uploadMesh(portalExtData.portalNave);
  const meshOculusCitadel = uploadMesh(portalExtData.oculusCitadel);
  const meshReflSeal = uploadMesh(portalExtData.reflSeal);
  const meshOcean = {
    vb: makeBuf(oceanData.vertices, GPUBufferUsage.VERTEX),
    ib: makeBuf(oceanData.indices, GPUBufferUsage.INDEX),
    indexCount: oceanData.indexCount,
  };
  const meshCathBay = uploadMesh(cathData.bayMesh);
  const meshCathWin = uploadMesh(cathData.winBayMesh);
  const meshCathBridge = uploadMesh(cathData.bridgeMesh);
  const meshCathPillar = uploadMesh(cathData.pillarMesh);
  const meshCathBlock = uploadMesh(cathData.blockMesh);

  const instCathBay = makeBuf(cathData.bayInstances, GPUBufferUsage.STORAGE);
  const instCathWin = makeBuf(cathData.winBayInstances, GPUBufferUsage.STORAGE);
  const instCathBridge = makeBuf(cathData.bridgeInstances, GPUBufferUsage.STORAGE);
  const instCathPillar = makeBuf(cathData.pillarInstances, GPUBufferUsage.STORAGE);
  const instCathBlock = makeBuf(cathData.blockInstances, GPUBufferUsage.STORAGE);

  const meshRingA = uploadMesh(astroData.ringA);
  const meshRingB = uploadMesh(astroData.ringB);
  const meshRingC = uploadMesh(astroData.ringC);
  const instRingA = makeBuf(astroData.instA, GPUBufferUsage.STORAGE);
  const instRingB = makeBuf(astroData.instB, GPUBufferUsage.STORAGE);
  const instRingC = makeBuf(astroData.instC, GPUBufferUsage.STORAGE);

  const partStorageBuf = makeBuf(partData.data, GPUBufferUsage.STORAGE);

  // Uniform buffers (1024 bytes holds camera + 22 analytical astrolabe eclipse shadow planes!)
  const uMainBuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uReflBuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // Shared samplers (clamp for screen-space passes, anisotropic repeat+trilinear for 512x512 baked PBR textures!)
  const linSamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const repSamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });

  // Compile all WGSL Shader Modules with compilation diagnostics
  const mkShader = (label, code) => {
    const mod = device.createShaderModule({ label, code });
    mod.getCompilationInfo().then((info) => {
      for (const m of info.messages) {
        if (m.type === 'error') logGpuError(`[WGSL ${label}:${m.lineNum}:${m.linePos}] ${m.message}`);
      }
    });
    return mod;
  };
  const modBake = mkShader('bake', BAKE_TEX_WGSL);
  const modSky = mkShader('sky', SKY_WGSL);
  const modOpaque = mkShader('opaque', OPAQUE_WGSL);
  const modWater = mkShader('water', WATER_WGSL);
  const modCrystal = mkShader('crystal', CRYSTAL_WGSL);
  const modVol = mkShader('volumetric', VOLUMETRIC_WGSL);
  const modPart = mkShader('particle', PARTICLE_WGSL);
  const modBloom = mkShader('bloom', BLOOM_WGSL);
  const modComp = mkShader('composite', COMPOSITE_WGSL);
  const modFxaa = mkShader('fxaa', FXAA_WGSL);

  // =========================================================================
  // GPU PROCEDURAL 512x512 MIPMAPPED PBR TEXTURE BAKER (STONE, METAL, CRYSTAL)
  // =========================================================================
  setLoadProgress(90, 'Synthesizing 512×512 procedural PBR material maps…');
  await yieldFrame();

  const bglBake = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  });
  const bglMip = device.createBindGroupLayout({
    entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const pipeBake = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglBake] }),
    vertex: { module: modBake, entryPoint: 'vs_bake' },
    fragment: { module: modBake, entryPoint: 'fs_bake', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const pipeMip = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglMip] }),
    vertex: { module: modBake, entryPoint: 'vs_bake' },
    fragment: { module: modBake, entryPoint: 'fs_mip', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });

  const bakeProceduralMap = (modeVal) => {
    const tex = device.createTexture({
      size: [512, 512],
      mipLevelCount: 10,
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const pBuf = makeBuf(new Float32Array([modeVal, 0, 0, 0]), GPUBufferUsage.UNIFORM);
    const bgB = device.createBindGroup({ layout: bglBake, entries: [{ binding: 0, resource: { buffer: pBuf } }] });
    const encB = device.createCommandEncoder();
    const p0 = encB.beginRenderPass({
      colorAttachments: [{ view: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    p0.setPipeline(pipeBake);
    p0.setBindGroup(0, bgB);
    p0.draw(3);
    p0.end();

    for (let m = 1; m < 10; m++) {
      const bgM = device.createBindGroup({
        layout: bglMip,
        entries: [
          { binding: 1, resource: tex.createView({ baseMipLevel: m - 1, mipLevelCount: 1 }) },
          { binding: 2, resource: linSamp },
        ],
      });
      const pm = encB.beginRenderPass({
        colorAttachments: [{ view: tex.createView({ baseMipLevel: m, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pm.setPipeline(pipeMip);
      pm.setBindGroup(0, bgM);
      pm.draw(3);
      pm.end();
    }
    device.queue.submit([encB.finish()]);
    return tex;
  };

  const texStone = bakeProceduralMap(0.0);
  const texMetal = bakeProceduralMap(1.0);
  const texCrystal = bakeProceduralMap(2.0);
  const texStoneView = texStone.createView();
  const texMetalView = texMetal.createView();
  const texCrystalView = texCrystal.createView();

  // Explicit shared Bind Group Layouts (group 0 carries uniforms + all 3 hardware-mipmapped PBR maps!)
  const bglGlobal = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const bglStorage = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
  });
  const bglTexSamp = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const bglVol = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } },
    ],
  });
  const bglVolBlur = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const bglBloom = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const bglComp = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });

  const mkGlobalBG = (uBuf) => device.createBindGroup({
    layout: bglGlobal,
    entries: [
      { binding: 0, resource: { buffer: uBuf } },
      { binding: 1, resource: texStoneView },
      { binding: 2, resource: texMetalView },
      { binding: 3, resource: texCrystalView },
      { binding: 4, resource: repSamp },
    ],
  });
  const bgMainU = mkGlobalBG(uMainBuf);
  const bgReflU = mkGlobalBG(uReflBuf);
  const mkStorageBG = (buf) => device.createBindGroup({ layout: bglStorage, entries: [{ binding: 0, resource: { buffer: buf } }] });

  const bgCathBay = mkStorageBG(instCathBay);
  const bgCathWin = mkStorageBG(instCathWin);
  const bgCathBridge = mkStorageBG(instCathBridge);
  const bgCathPillar = mkStorageBG(instCathPillar);
  const bgCathBlock = mkStorageBG(instCathBlock);
  const bgRingA = mkStorageBG(instRingA);
  const bgRingB = mkStorageBG(instRingB);
  const bgRingC = mkStorageBG(instRingC);
  const bgParts = mkStorageBG(partStorageBuf);

  // Vertex buffer layouts
  const stdMeshLayout = [{
    arrayStride: 40,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x2' },
      { shaderLocation: 3, offset: 32, format: 'float32x2' },
    ],
  }];
  const oceanLayout = [{
    arrayStride: 16,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x2' },
    ],
  }];

  const plU = device.createPipelineLayout({ bindGroupLayouts: [bglGlobal] });
  const plUStorage = device.createPipelineLayout({ bindGroupLayouts: [bglGlobal, bglStorage] });
  const plUTex = device.createPipelineLayout({ bindGroupLayouts: [bglGlobal, bglTexSamp] });

  const HDR_FMT = 'rgba16float';
  const DEPTH_FMT = 'depth32float';

  const mkSkyPipe = (samples) => device.createRenderPipeline({
    layout: plU,
    vertex: { module: modSky, entryPoint: 'vs_sky' },
    fragment: { module: modSky, entryPoint: 'fs_sky', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH_FMT, depthWriteEnabled: false, depthCompare: 'less-equal' },
    multisample: { count: samples },
  });

  const mkOpaquePipe = (vsEntry, layout, samples, cull = 'back') => device.createRenderPipeline({
    layout,
    vertex: { module: modOpaque, entryPoint: vsEntry, buffers: stdMeshLayout },
    fragment: { module: modOpaque, entryPoint: 'fs_opaque', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list', cullMode: cull },
    depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: samples },
  });

  const pipeSkyMain = mkSkyPipe(4);
  const pipeSkyRefl = mkSkyPipe(4);
  const pipeStaticMain = mkOpaquePipe('vs_static', plU, 4, 'back');
  const pipeStaticRefl = mkOpaquePipe('vs_static', plU, 4, 'back');
  const pipeCathMain = mkOpaquePipe('vs_cathedral_inst', plUStorage, 4, 'back');
  const pipeAstroMain = mkOpaquePipe('vs_astrolabe_inst', plUStorage, 4, 'back');

  const pipeWaterMain = device.createRenderPipeline({
    layout: plUTex,
    vertex: { module: modWater, entryPoint: 'vs_water', buffers: oceanLayout },
    fragment: { module: modWater, entryPoint: 'fs_water', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: 4 },
  });

  const pipeCrystalMain = device.createRenderPipeline({
    layout: plUTex,
    vertex: { module: modCrystal, entryPoint: 'vs_crystal', buffers: stdMeshLayout },
    fragment: { module: modCrystal, entryPoint: 'fs_crystal', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: 4 },
  });

  const pipeCrystalRefl = device.createRenderPipeline({
    layout: plU,
    vertex: { module: modCrystal, entryPoint: 'vs_crystal', buffers: stdMeshLayout },
    fragment: { module: modCrystal, entryPoint: 'fs_crystal_refl', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: 4 },
  });

  const mkPartPipe = (samples) => device.createRenderPipeline({
    layout: plUStorage,
    vertex: { module: modPart, entryPoint: 'vs_part' },
    fragment: {
      module: modPart,
      entryPoint: 'fs_part',
      targets: [{
        format: HDR_FMT,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH_FMT, depthWriteEnabled: false, depthCompare: 'less' },
    multisample: { count: samples },
  });
  const pipePartMain = mkPartPipe(4);
  const pipePartRefl = mkPartPipe(4);

  const pipeVol = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglVol] }),
    vertex: { module: modVol, entryPoint: 'vs_full' },
    fragment: { module: modVol, entryPoint: 'fs_volumetric', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list' },
  });

  const pipeVolBlur = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglVolBlur] }),
    vertex: { module: modVol, entryPoint: 'vs_full' },
    fragment: { module: modVol, entryPoint: 'fs_vol_blur', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list' },
  });

  const pipeBloomDown = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglBloom] }),
    vertex: { module: modBloom, entryPoint: 'vs_bloom' },
    fragment: { module: modBloom, entryPoint: 'fs_down', targets: [{ format: HDR_FMT }] },
    primitive: { topology: 'triangle-list' },
  });

  const pipeBloomUp = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglBloom] }),
    vertex: { module: modBloom, entryPoint: 'vs_bloom' },
    fragment: {
      module: modBloom,
      entryPoint: 'fs_up',
      targets: [{
        format: HDR_FMT,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const pipeComp = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglComp] }),
    vertex: { module: modComp, entryPoint: 'vs_comp' },
    fragment: { module: modComp, entryPoint: 'fs_comp', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });

  const pipeFxaa = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglBloom] }),
    vertex: { module: modFxaa, entryPoint: 'vs_fxaa' },
    fragment: { module: modFxaa, entryPoint: 'fs_fxaa', targets: [{ format: swapFormat }] },
    primitive: { topology: 'triangle-list' },
  });

  // =========================================================================
  // PREALLOCATED GPU TIMESTAMP QUERY RING BUFFER (ZERO PER-FRAME ALLOCS!)
  // =========================================================================
  let perfRecording = false;
  let perfFinished = false;
  let perfDurationTarget = TOUR_DURATION;
  let perfFrameCount = 0;
  let perfGpuCount = 0;
  let lastGpuMsSmooth = 0;
  let lastDtMsSmooth = 8.3;

  const tsSlots = [];
  if (hasTimestampQuery) {
    for (let s = 0; s < TS_SLOTS; s++) {
      const qs = device.createQuerySet({ type: 'timestamp', count: TS_MAX_PASSES * 2 });
      const resolveBuf = device.createBuffer({ size: TS_MAX_PASSES * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const readBuf = device.createBuffer({ size: TS_MAX_PASSES * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const writes = [];
      for (let p = 0; p < TS_MAX_PASSES; p++) {
        writes.push({ querySet: qs, beginningOfPassWriteIndex: p * 2, endOfPassWriteIndex: p * 2 + 1 });
      }
      const slot = {
        qs, resolveBuf, readBuf, writes,
        inFlight: false, passCount: 0, tourT: 0, actIdx: 0, wasRec: false,
        onMapped: null, onErr: null,
      };
      slot.onMapped = () => {
        const data = new BigInt64Array(slot.readBuf.getMappedRange(), 0, slot.passCount * 2);
        let minStart = data[0], maxEnd = data[1], sumNs = 0n;
        for (let i = 0; i < slot.passCount; i++) {
          const a = data[i * 2], b = data[i * 2 + 1];
          if (a < minStart) minStart = a;
          if (b > maxEnd) maxEnd = b;
          if (b >= a) sumNs += (b - a);
        }
        slot.readBuf.unmap();
        slot.inFlight = false;
        const spanMs = Number(maxEnd - minStart) * 1e-6;
        const sumMs = Number(sumNs) * 1e-6;
        if (spanMs > 0.01 && spanMs < 200) {
          lastGpuMsRaw = spanMs;
          lastGpuMsSmooth = lastGpuMsSmooth === 0 ? spanMs : (lastGpuMsSmooth * 0.85 + spanMs * 0.15);
          if (slot.wasRec && perfGpuCount < MAX_PERF_FRAMES) {
            perfGpuSpan[perfGpuCount] = spanMs;
            perfGpuSum[perfGpuCount] = sumMs;
            perfTourT[perfGpuCount] = slot.tourT;
            perfAct[perfGpuCount] = slot.actIdx;
            perfGpuCount++;
          }
        }
      };
      slot.onErr = () => { slot.inFlight = false; };
      tsSlots.push(slot);
    }
  }

  // =========================================================================
  // RESOLUTION-DEPENDENT RENDER TARGETS & PREALLOCATED PASS DESCRIPTORS
  // =========================================================================
  let W = 0, H = 0;
  let rt = null;

  function allocateRenderTargets(newW, newH) {
    if (rt) {
      rt.hdrMsaa.destroy(); rt.hdrColor.destroy(); rt.sceneCopy.destroy(); rt.depthMsaa.destroy();
      rt.reflMsaa.destroy(); rt.reflColor.destroy(); rt.reflDepth.destroy(); rt.volRaw.destroy(); rt.volBlur.destroy();
      rt.ldrTex.destroy();
      for (const m of rt.bloomMips) m.tex.destroy();
      for (const b of rt.bloomParamBufs) b.destroy();
    }
    W = newW; H = newH;
    canvas.width = W; canvas.height = H;
    ctx.configure({ device, format: swapFormat, alphaMode: 'opaque' });

    // Ultra Cinematic 1305x734 (0.68x) 4x MSAA planar mirror reflection -> razor-sharp rippling ocean reflections with locked 60+ FPS headroom!
    const rW = Math.max(2, Math.floor(W * 0.68));
    const rH = Math.max(2, Math.floor(H * 0.68));
    const vW = Math.max(2, Math.floor(W * 0.5));
    const vH = Math.max(2, Math.floor(H * 0.5));

    const hdrMsaa = device.createTexture({ size: [W, H], sampleCount: 4, format: HDR_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const hdrColor = device.createTexture({ size: [W, H], format: HDR_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    const sceneCopy = device.createTexture({ size: [W, H], format: HDR_FMT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const depthMsaa = device.createTexture({ size: [W, H], sampleCount: 4, format: DEPTH_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const ldrTex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });

    // 1280x720 4x MSAA planar mirror reflection -> razor-sharp AND silky zero-aliasing ocean reflections!
    const reflMsaa = device.createTexture({ size: [rW, rH], sampleCount: 4, format: HDR_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const reflColor = device.createTexture({ size: [rW, rH], format: HDR_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const reflDepth = device.createTexture({ size: [rW, rH], sampleCount: 4, format: DEPTH_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT });

    const volRaw = device.createTexture({ size: [vW, vH], format: HDR_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const volBlur = device.createTexture({ size: [vW, vH], format: HDR_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });

    const hdrMsaaView = hdrMsaa.createView();
    const hdrColorView = hdrColor.createView();
    const sceneCopyView = sceneCopy.createView();
    const depthMsaaView = depthMsaa.createView();
    const ldrView = ldrTex.createView();
    const reflMsaaView = reflMsaa.createView();
    const reflColorView = reflColor.createView();
    const reflDepthView = reflDepth.createView();
    const volRawView = volRaw.createView();
    const volBlurView = volBlur.createView();

    // 4-Mip Bloom Pyramid starting at quarter-res (480x270) -> ultra-fast silky cinema bloom!
    const bloomMips = [];
    let bw = Math.max(2, Math.floor(W * 0.25));
    let bh = Math.max(2, Math.floor(H * 0.25));
    for (let i = 0; i < 4; i++) {
      const tex = device.createTexture({ size: [bw, bh], format: HDR_FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      bloomMips.push({ w: bw, h: bh, tex, view: tex.createView() });
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
    }

    // Bloom bind groups & uniform params (preallocated once!)
    const bloomParamBufs = [];
    const bloomDownBGs = [];
    const bloomUpBGs = [];
    const bloomDownPasses = [];
    const bloomUpPasses = [];

    for (let i = 0; i < 4; i++) {
      const srcW = i === 0 ? W : bloomMips[i - 1].w;
      const srcH = i === 0 ? H : bloomMips[i - 1].h;
      const srcView = i === 0 ? hdrColorView : bloomMips[i - 1].view;
      const pBuf = makeBuf(new Float32Array([1 / srcW, 1 / srcH, 1.05, i === 0 ? 1.0 : 0.0]), GPUBufferUsage.UNIFORM);
      bloomParamBufs.push(pBuf);
      bloomDownBGs.push(device.createBindGroup({
        layout: bglBloom,
        entries: [
          { binding: 0, resource: { buffer: pBuf } },
          { binding: 1, resource: srcView },
          { binding: 2, resource: linSamp },
        ],
      }));
      bloomDownPasses.push({
        colorAttachments: [{ view: bloomMips[i].view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        timestampWrites: undefined,
      });
    }
    for (let i = 2; i >= 0; i--) {
      const srcMip = bloomMips[i + 1];
      const dstMip = bloomMips[i];
      const pBuf = makeBuf(new Float32Array([1 / srcMip.w, 1 / srcMip.h, 0, 0]), GPUBufferUsage.UNIFORM);
      bloomParamBufs.push(pBuf);
      bloomUpBGs.push(device.createBindGroup({
        layout: bglBloom,
        entries: [
          { binding: 0, resource: { buffer: pBuf } },
          { binding: 1, resource: srcMip.view },
          { binding: 2, resource: linSamp },
        ],
      }));
      bloomUpPasses.push({
        colorAttachments: [{ view: dstMip.view, loadOp: 'load', storeOp: 'store' }],
        timestampWrites: undefined,
      });
    }

    const bgWaterRefl = device.createBindGroup({
      layout: bglTexSamp,
      entries: [{ binding: 0, resource: reflColorView }, { binding: 1, resource: linSamp }],
    });
    const bgSceneCopy = device.createBindGroup({
      layout: bglTexSamp,
      entries: [{ binding: 0, resource: sceneCopyView }, { binding: 1, resource: linSamp }],
    });
    const bgVol = device.createBindGroup({
      layout: bglVol,
      entries: [{ binding: 0, resource: { buffer: uMainBuf } }, { binding: 1, resource: depthMsaaView }],
    });
    const bgVolBlur = device.createBindGroup({
      layout: bglVolBlur,
      entries: [
        { binding: 0, resource: { buffer: uMainBuf } },
        { binding: 1, resource: depthMsaaView },
        { binding: 2, resource: volRawView },
        { binding: 3, resource: linSamp },
      ],
    });
    const bgComp = device.createBindGroup({
      layout: bglComp,
      entries: [
        { binding: 0, resource: { buffer: uMainBuf } },
        { binding: 1, resource: hdrColorView },
        { binding: 2, resource: volBlurView },
        { binding: 3, resource: bloomMips[0].view },
        { binding: 4, resource: linSamp },
      ],
    });
    const bgFxaa = device.createBindGroup({
      layout: bglBloom,
      entries: [
        { binding: 0, resource: { buffer: uMainBuf } },
        { binding: 1, resource: ldrView },
        { binding: 2, resource: linSamp },
      ],
    });

    // Preallocated RenderPassDescriptors (ZERO per-frame object creation!)
    const passRefl = {
      colorAttachments: [{ view: reflMsaaView, resolveTarget: reflColorView, loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0.01, g: 0.03, b: 0.06, a: 1 } }],
      depthStencilAttachment: { view: reflDepthView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      timestampWrites: undefined,
    };
    const passMainStore = {
      colorAttachments: [{ view: hdrMsaaView, resolveTarget: hdrColorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      depthStencilAttachment: { view: depthMsaaView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      timestampWrites: undefined,
    };
    const passMainDiscard = {
      colorAttachments: [{ view: hdrMsaaView, resolveTarget: hdrColorView, loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      depthStencilAttachment: { view: depthMsaaView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      timestampWrites: undefined,
    };
    const passCrystFar = {
      colorAttachments: [{ view: hdrMsaaView, resolveTarget: hdrColorView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: depthMsaaView, depthLoadOp: 'load', depthStoreOp: 'store' },
      timestampWrites: undefined,
    };
    const passCrystNear = {
      colorAttachments: [{ view: hdrMsaaView, resolveTarget: hdrColorView, loadOp: 'load', storeOp: 'discard' }],
      depthStencilAttachment: { view: depthMsaaView, depthLoadOp: 'load', depthStoreOp: 'store' },
      timestampWrites: undefined,
    };
    const passVol = {
      colorAttachments: [{ view: volRawView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      timestampWrites: undefined,
    };
    const passVolBlur = {
      colorAttachments: [{ view: volBlurView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      timestampWrites: undefined,
    };
    const passComp = {
      colorAttachments: [{ view: ldrView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      timestampWrites: undefined,
    };
    const passFxaa = {
      colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      timestampWrites: undefined,
    };
    const copySrcObj = { texture: hdrColor };
    const copyDstObj = { texture: sceneCopy };
    const copySize = [W, H, 1];

    rt = {
      hdrMsaa, hdrColor, sceneCopy, depthMsaa, ldrTex, reflMsaa, reflColor, reflDepth, volRaw, volBlur,
      bloomMips, bloomParamBufs, bloomDownBGs, bloomUpBGs, bloomDownPasses, bloomUpPasses,
      bgWaterRefl, bgSceneCopy, bgVol, bgVolBlur, bgComp, bgFxaa,
      passRefl, passMainStore, passMainDiscard, passCrystFar, passCrystNear, passVol, passVolBlur, passComp, passFxaa,
      copySrcObj, copyDstObj, copySize,
    };
  }

  let forcedResW = 0, forcedResH = 0;
  function handleResize() {
    if (forcedResW > 0 && forcedResH > 0) {
      if (W !== forcedResW || H !== forcedResH) allocateRenderTargets(forcedResW, forcedResH);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const rawW = Math.round(window.innerWidth * dpr);
    const rawH = Math.round(window.innerHeight * dpr);
    // Cap cleanly at target 1920x1080 native resolution while matching aspect ratio
    const s = Math.min(1.0, 1920 / Math.max(1, rawW), 1080 / Math.max(1, rawH));
    const nw = Math.max(2, Math.round(rawW * s));
    const nh = Math.max(2, Math.round(rawH * s));
    if (nw !== W || nh !== H) allocateRenderTargets(nw, nh);
  }
  window.addEventListener('resize', handleResize);
  handleResize();

  // =========================================================================
  // CAMERA, TOUR, FREE-FLIGHT CONTROLS & BENCHMARK STATE
  // =========================================================================
  let mode = 'menu'; // 'menu' | 'tour' | 'free' | 'pose'
  let tourTime = 0.0;
  let sceneTime = 0.0;
  let fixedPoseIdx = -1;
  let frameIdx = 0;
  let hudVisible = true;
  let lastHudUpdate = 0;

  // Free-flight camera state (Euler yaw/pitch synced cleanly on tour->free handoff!)
  let yaw = 0.0;
  let pitch = 0.0;
  let fovDeg = 58.0;
  let bankRad = 0.0;
  const keys = Object.create(null);

  function syncAnglesFromLook(ex, ey, ez, tx, ty, tz) {
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const h = Math.hypot(dx, dz) || 1e-5;
    yaw = Math.atan2(-dx, -dz);
    pitch = clamp(Math.atan2(dy, h), -1.48, 1.48);
  }

  function retakeManualControl() {
    if (mode === 'tour') {
      mode = 'free';
      bankRad = 0;
      fovDeg = 58;
      syncAnglesFromLook(camPos[0], camPos[1], camPos[2], camTarget[0], camTarget[1], camTarget[2]);
      camVel[0] = camVel[1] = camVel[2] = 0;
      updateHudImmediate();
    }
  }

  function startTour(fromZero = false) {
    audio.init();
    if (flashEl) { flashEl.style.transition = 'none'; flashEl.style.opacity = '0'; }
    if (menuEl) { menuEl.style.display = 'none'; menuEl.style.opacity = '1'; }
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    mode = 'tour';
    fixedPoseIdx = -1;
    if (fromZero) tourTime = 0.0;
    updateHudImmediate();
  }

  function returnToMenuFromSupernova() {
    if (flashEl) {
      flashEl.style.transition = 'none';
      flashEl.style.opacity = '1';
    }
    mode = 'menu';
    tourTime = 0.0;
    if (menuEl) { menuEl.style.display = 'flex'; menuEl.style.opacity = '1'; }
    updateHudImmediate();
    // Hold incandescent white briefly, then dissolve cleanly to reveal the Start Menu!
    setTimeout(() => {
      if (flashEl) {
        flashEl.style.transition = 'opacity 1.5s cubic-bezier(.22,.61,.36,1)';
        flashEl.style.opacity = '0';
      }
    }, 340);
  }

  function startFreeFlight() {
    audio.init();
    if (menuEl) menuEl.style.display = 'none';
    if (mode === 'menu') {
      // Begin free flight right from the breathtaking Hero Prism Corridor overlooking the gas giant!
      const p0 = POSES[0];
      camPos[0] = p0.eye[0]; camPos[1] = p0.eye[1]; camPos[2] = p0.eye[2];
      syncAnglesFromLook(p0.eye[0], p0.eye[1], p0.eye[2], p0.target[0], p0.target[1], p0.target[2]);
      fovDeg = 58;
    } else if (mode === 'tour') {
      retakeManualControl();
    }
    mode = 'free';
    fixedPoseIdx = -1;
    canvas.requestPointerLock?.();
    updateHudImmediate();
  }

  function updateHudImmediate() {
    if (hudEl) hudEl.style.display = (hudVisible && mode !== 'menu') ? 'flex' : 'none';
    if (fpsBoxEl) fpsBoxEl.style.display = hudVisible ? 'block' : 'none';
    if (hudModeEl) {
      hudModeEl.textContent = mode === 'tour'
        ? 'GUIDED TOUR · WASD/T TO TAKE CONTROL'
        : 'FREE FLIGHT · CLICK TO LOOK · T FOR TOUR';
    }
  }

  // Input listeners
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (mode === 'menu') return;
    if (MOVE_KEYS.has(e.code) && mode === 'tour' && !perfRecording) {
      retakeManualControl();
    }
    if (e.code === 'KeyT' && !perfRecording) {
      if (mode === 'tour') retakeManualControl();
      else startTour(tourTime >= TOUR_DURATION - 0.1);
    } else if (e.code === 'KeyM') {
      audio.toggleMute();
    } else if (e.code === 'KeyH') {
      hudVisible = !hudVisible;
      updateHudImmediate();
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (mode === 'tour' && !perfRecording) retakeManualControl();
    if (mode === 'free') {
      yaw -= e.movementX * 0.0022;
      pitch = clamp(pitch - e.movementY * 0.0022, -1.48, 1.48);
    }
  });

  canvas.addEventListener('click', () => {
    audio.init();
    if (mode === 'free' && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
  });

  // Start menu buttons
  document.getElementById('btn-tour')?.addEventListener('click', () => startTour(true));
  document.getElementById('btn-free')?.addEventListener('click', () => startFreeFlight());

  // =========================================================================
  // VERIFICATION API (window.__COSMIC__) — for 6-pose captures & 60s benchmark
  // =========================================================================
  window.__COSMIC__ = {
    getInfo() {
      return {
        vendor: adapterInfo.vendor || '',
        architecture: adapterInfo.architecture || '',
        device: adapterInfo.device || '',
        description: adapterInfo.description || '',
        isFallbackAdapter: Boolean(adapter.isFallbackAdapter),
        hasTimestampQuery,
        canvasWidth: W,
        canvasHeight: H,
        swapFormat,
        mode,
        tourTime,
        frameIdx,
        poses: POSES.map((p, i) => ({ index: i, name: p.name, label: p.label })),
      };
    },
    setResolution(w, h) {
      forcedResW = w; forcedResH = h;
      handleResize();
    },
    setHud(visible) {
      hudVisible = Boolean(visible);
      updateHudImmediate();
    },
    setPose(idx) {
      const p = POSES[clamp(idx | 0, 0, POSES.length - 1)];
      if (menuEl) menuEl.style.display = 'none';
      hudVisible = false;
      updateHudImmediate();
      mode = 'pose';
      fixedPoseIdx = idx;
      perfRecording = false;
      camPos[0] = p.eye[0]; camPos[1] = p.eye[1]; camPos[2] = p.eye[2];
      camTarget[0] = p.target[0]; camTarget[1] = p.target[1]; camTarget[2] = p.target[2];
      fovDeg = p.fov;
      bankRad = 0;
      sceneTime = p.time;
      tourTime = p.time;
      return p;
    },
    setTourTime(tSec) {
      if (menuEl) menuEl.style.display = 'none';
      hudVisible = false;
      updateHudImmediate();
      mode = 'pose';
      fixedPoseIdx = -2;
      perfRecording = false;
      tourTime = clamp(tSec, 0, TOUR_DURATION);
      sceneTime = tourTime;
      evalTourCamera(tourEval, tourTime);
      camPos[0] = tourEval[0]; camPos[1] = tourEval[1]; camPos[2] = tourEval[2];
      camTarget[0] = tourEval[3]; camTarget[1] = tourEval[4]; camTarget[2] = tourEval[5];
      fovDeg = tourEval[6];
      bankRad = tourEval[7];
    },
    startPerfTour(durationSec = TOUR_DURATION) {
      if (menuEl) menuEl.style.display = 'none';
      hudVisible = false;
      updateHudImmediate();
      mode = 'tour';
      fixedPoseIdx = -1;
      tourTime = 0.0;
      sceneTime = 0.0;
      perfFrameCount = 0;
      perfGpuCount = 0;
      perfDurationTarget = durationSec;
      perfFinished = false;
      perfRecording = true;
    },
    getPerfStatus() {
      return {
        recording: perfRecording,
        finished: perfFinished,
        tourTime,
        frameCount: perfFrameCount,
        gpuCount: perfGpuCount,
        lastGpuMs: lastGpuMsSmooth,
        lastDtMs: lastDtMsSmooth,
      };
    },
    getPerfReport() {
      const gpuSpan = calcStats(perfGpuSpan, perfGpuCount);
      const gpuSum = calcStats(perfGpuSum, perfGpuCount);
      const frameDt = calcStats(perfFrameDt, perfFrameCount);
      let over167Gpu = 0, over167Wall = 0;
      for (let i = 0; i < perfGpuCount; i++) if (perfGpuSpan[i] > 16.7) over167Gpu++;
      for (let i = 0; i < perfFrameCount; i++) if (perfFrameDt[i] > 16.7) over167Wall++;
      // Per-act GPU breakdown
      const actBins = [[], [], []];
      for (let i = 0; i < perfGpuCount; i++) {
        actBins[Math.min(2, perfAct[i])].push(perfGpuSpan[i]);
      }
      const perAct = actBins.map((b) => calcStats(Float64Array.from(b), b.length));
      return {
        adapter: this.getInfo(),
        durationSec: perfDurationTarget,
        gpuSpanMs: gpuSpan,
        gpuSumMs: gpuSum,
        frameDtMs: frameDt,
        gpuFramesOver16_7ms: over167Gpu,
        wallFramesOver16_7ms: over167Wall,
        perActGpuSpanMs: { act1: perAct[0], act2: perAct[1], act3: perAct[2] },
      };
    },
  };

  // =========================================================================
  // UNIFORM PACKING HELPER (ZERO ALLOCATIONS)
  // =========================================================================
  function writeUniforms(buf, dst, vp, invVP, reflVP, px, py, pz, fx, fy, fz, rx, ry, rz, ux, uy, uz, aspect, tanH, time, isRefl, supernovaAmt) {
    dst.set(vp, 0);
    dst.set(invVP, 16);
    dst.set(reflVP, 32);
    dst[48] = px; dst[49] = py; dst[50] = pz; dst[51] = time;
    dst[52] = fx; dst[53] = fy; dst[54] = fz; dst[55] = aspect;
    dst[56] = rx; dst[57] = ry; dst[58] = rz; dst[59] = tanH;
    dst[60] = ux; dst[61] = uy; dst[62] = uz; dst[63] = frameIdx;
    dst[64] = actW[0]; dst[65] = actW[1]; dst[66] = actW[2]; dst[67] = actW[3];

    const pulsePhase = (time * 0.145) % 1.0;
    dst[68] = WORLD.STAR_X; dst[69] = WORLD.STAR_Y; dst[70] = WORLD.STAR_Z; dst[71] = pulsePhase;

    // Project blinding white dwarf to screen UV for pixel-accurate radial volumetric backlighting!
    const sx = WORLD.STAR_X, sy = WORLD.STAR_Y, sz = WORLD.STAR_Z;
    const cx = vp[0] * sx + vp[4] * sy + vp[8] * sz + vp[12];
    const cy = vp[1] * sx + vp[5] * sy + vp[9] * sz + vp[13];
    const cz = vp[2] * sx + vp[6] * sy + vp[10] * sz + vp[14];
    const cw = vp[3] * sx + vp[7] * sy + vp[11] * sz + vp[15];
    let suvX = 0.5, suvY = 0.5, onScreen = 0.0;
    if (cw > 0.1) {
      const ndcX = cx / cw, ndcY = cy / cw;
      suvX = ndcX * 0.5 + 0.5;
      suvY = 0.5 - ndcY * 0.5;
      const edge = Math.max(Math.abs(ndcX), Math.abs(ndcY));
      onScreen = smoothstep(1.65, 0.75, edge);
    }
    dst[72] = suvX; dst[73] = suvY; dst[74] = cw > 0.1 ? cz / cw : 1.0; dst[75] = onScreen;
    dst[76] = W; dst[77] = H; dst[78] = 1.0 / W; dst[79] = 1.0 / H;
    dst[80] = isRefl ? 1.0 : 0.0;
    dst[81] = isRefl ? -0.35 : -9999.0;
    dst[82] = 1.0; // exposure multiplier
    dst[83] = supernovaAmt;

    // Pack all 22 analytical orbital ring planes for real-time ring-on-ring eclipse shadow casting (zero allocations!)
    const shells = astroData.ringShells;
    for (let i = 0; i < 22; i++) {
      const sh = shells[i];
      const ax = sh.tiltX + Math.sin(time * 0.12 + sh.phase0) * sh.precAmp;
      const ca = Math.cos(ax), sa = Math.sin(ax);
      const cz = Math.cos(sh.tiltZ), sz = Math.sin(sh.tiltZ);
      const o = 84 + i * 4;
      dst[o]     = -ca * sz;
      dst[o + 1] =  ca * cz;
      dst[o + 2] =  sa;
      dst[o + 3] =  sh.radius;
      dst[172 + i] = sh.vertH * 0.48;
    }
    device.queue.writeBuffer(buf, 0, dst);
  }

  // Helper to record static/instanced draws cleanly
  function drawMesh(pass, mesh) {
    pass.setVertexBuffer(0, mesh.vb);
    pass.setIndexBuffer(mesh.ib, 'uint32');
    pass.drawIndexed(mesh.indexCount);
  }
  function drawInst(pass, mesh, bg, count) {
    if (count <= 0) return;
    pass.setBindGroup(1, bg);
    pass.setVertexBuffer(0, mesh.vb);
    pass.setIndexBuffer(mesh.ib, 'uint32');
    pass.drawIndexed(mesh.indexCount, count);
  }

  // Reveal ready start menu!
  setLoadProgress(100, 'Ready · WebGPU Hardware Accelerated');
  if (actionsEl) actionsEl.classList.add('ready');

  // Optional URL query verification triggers (?pose=0..5, ?tourTime=12.5, ?bench=60, ?res=1920x1080)
  const qs = new URLSearchParams(location.search);
  const resParam = qs.get('res');
  if (resParam && /^\d+x\d+$/.test(resParam)) {
    const [rw, rh] = resParam.split('x').map(Number);
    window.__COSMIC__.setResolution(rw, rh);
  }
  const writeDomReport = (showVisible = false) => {
    if (!reportEl) return;
    const info = window.__COSMIC__.getInfo();
    const rep = perfFinished ? window.__COSMIC__.getPerfReport() : null;
    reportEl.textContent = JSON.stringify({ info, gpuErrors, perfFinished, perfReport: rep }, null, 2);
    reportEl.dataset.ready = '1';
    if (perfFinished) reportEl.dataset.benchDone = '1';
    if (showVisible) {
      reportEl.style.cssText = 'display:block;position:fixed;left:16px;top:16px;max-width:92vw;max-height:90vh;overflow:auto;z-index:99;padding:14px;background:rgba(4,8,14,.92);color:#d7eef8;font:12px/1.4 monospace;border:1px solid #3ecde0';
    }
  };
  let recActive = false;
  let recObj = null;
  let recChunks = null;
  let recEndT = 60.0;
  const finishRecording = () => {
    if (!recActive || !recObj) return;
    recActive = false;
    recObj.stop();
  };
  if (qs.has('pose')) {
    window.__COSMIC__.setPose(Number(qs.get('pose')) || 0);
  } else if (qs.has('tourTime')) {
    window.__COSMIC__.setTourTime(Number(qs.get('tourTime')) || 0);
  } else if (qs.has('bench')) {
    window.__COSMIC__.startPerfTour(Number(qs.get('bench')) || TOUR_DURATION);
  } else if (qs.has('record')) {
    recEndT = Number(qs.get('record')) || TOUR_DURATION;
    window.__COSMIC__.startPerfTour(recEndT);
    perfRecording = false; // keep video capture separate from clean perf benchmark
    recChunks = [];
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    recObj = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14000000 });
    recObj.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) recChunks.push(ev.data); };
    recObj.onstop = () => {
      const blob = new Blob(recChunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cosmic_tour_60s.webm';
      document.body.appendChild(a);
      a.click();
      if (reportEl) {
        reportEl.textContent = JSON.stringify({ recordedBytes: blob.size, mime, durationSec: recEndT, info: window.__COSMIC__.getInfo(), gpuErrors });
        reportEl.dataset.recordDone = '1';
        reportEl.style.cssText = 'display:block;position:fixed;left:16px;top:16px;z-index:99;padding:12px;background:rgba(4,8,14,.92);color:#9ef;font:12px monospace';
      }
    };
    recObj.start(500);
    recActive = true;
  }
  const dlName = qs.get('dl') || '';
  let dlDone = false;
  if (qs.has('info')) setTimeout(() => writeDomReport(true), 600);
  else setTimeout(() => writeDomReport(false), 600);

  // =========================================================================
  // MAIN ZERO-ALLOCATION FRAME LOOP
  // =========================================================================
  let prevNow = performance.now();
  let freeSupernova = 0.0;

  function frame(now) {
    requestAnimationFrame(frame);

    const rawDtMs = now - prevNow;
    prevNow = now;
    const dt = clamp(rawDtMs * 0.001, 0.0005, 0.05);
    frameIdx++;

    let activeTourDur = perfRecording ? perfDurationTarget : (recActive ? recEndT : TOUR_DURATION);
    let supernovaAmt = 0.0;

    // 1. Update Camera & Time
    if (mode === 'menu') {
      freeSupernova = 0.0;
      sceneTime += dt;
      // Gentle cinematic idle drift over Hero Prism Corridor behind start menu
      const p0 = POSES[0];
      camPos[0] = p0.eye[0] + Math.sin(sceneTime * 0.16) * 5.5;
      camPos[1] = p0.eye[1] + Math.sin(sceneTime * 0.23) * 1.4;
      camPos[2] = p0.eye[2] + Math.cos(sceneTime * 0.11) * 8.0;
      camTarget[0] = p0.target[0]; camTarget[1] = p0.target[1]; camTarget[2] = p0.target[2];
      fovDeg = 56;
      bankRad = 0;
    } else if (mode === 'tour') {
      if (frameIdx > 6) tourTime += dt;
      sceneTime = tourTime;
      if (perfRecording && tourTime >= perfDurationTarget) {
        perfRecording = false;
        perfFinished = true;
        tourTime = perfDurationTarget;
        setTimeout(() => writeDomReport(true), 250);
      } else if (recActive && tourTime >= recEndT) {
        tourTime = recEndT;
        finishRecording();
      } else if (!perfRecording && !recActive && tourTime >= TOUR_DURATION) {
        // Supernova climax reached 100% full-screen illumination -> return cleanly to Start Menu!
        returnToMenuFromSupernova();
      }
      if (mode === 'tour') {
        evalTourCamera(tourEval, tourTime, activeTourDur);
        supernovaAmt = evalSupernova(tourTime, activeTourDur);
        camPos[0] = tourEval[0]; camPos[1] = tourEval[1]; camPos[2] = tourEval[2];
        camTarget[0] = tourEval[3]; camTarget[1] = tourEval[4]; camTarget[2] = tourEval[5];
        fovDeg = tourEval[6];
        bankRad = tourEval[7];
      }
    } else if (mode === 'pose' && fixedPoseIdx === -2) {
      supernovaAmt = evalSupernova(tourTime, TOUR_DURATION);
    } else if (mode === 'free') {
      sceneTime += dt;
      // Forward & right vectors from yaw/pitch
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const fx = -sy * cp, fy = sp, fz = -cy * cp;
      const rx = cy, rz = -sy;

      let mx = 0, my = 0, mz = 0;
      if (keys.KeyW || keys.ArrowUp)    { mx += fx; my += fy; mz += fz; }
      if (keys.KeyS || keys.ArrowDown)  { mx -= fx; my -= fy; mz -= fz; }
      if (keys.KeyD || keys.ArrowRight) { mx += rx; mz += rz; }
      if (keys.KeyA || keys.ArrowLeft)  { mx -= rx; mz -= rz; }
      if (keys.KeyE) my += 1;
      if (keys.KeyQ) my -= 1;

      const mLen = Math.hypot(mx, my, mz);
      const baseSpeed = actW[2] > 0.5 ? 115.0 : 54.0;
      const speed = (keys.ShiftLeft || keys.ShiftRight) ? baseSpeed * 2.8 : baseSpeed;
      const damp = 1.0 - Math.exp(-7.5 * dt);
      if (mLen > 1e-4) {
        const s = speed / mLen;
        camVel[0] += (mx * s - camVel[0]) * damp;
        camVel[1] += (my * s - camVel[1]) * damp;
        camVel[2] += (mz * s - camVel[2]) * damp;
      } else {
        const stop = Math.exp(-6.5 * dt);
        camVel[0] *= stop; camVel[1] *= stop; camVel[2] *= stop;
      }
      const prevY = camPos[1];
      camPos[0] += camVel[0] * dt;
      camPos[1] += camVel[1] * dt;
      camPos[2] += camVel[2] * dt;
      clampFreeCamera(camPos, prevY);

      camTarget[0] = camPos[0] + fx * 100;
      camTarget[1] = camPos[1] + fy * 100;
      camTarget[2] = camPos[2] + fz * 100;
      bankRad = 0;

      // Free Flight interactive White Dwarf proximity supernova ignition & acceleration!
      // Flying into the astrolabe destabilizes the star; getting close accelerates detonation all the way to pure white -> Start Menu!
      const dStar = Math.hypot(camPos[0] - WORLD.STAR_X, camPos[1] - WORLD.STAR_Y, camPos[2] - WORLD.STAR_Z);
      if (dStar < 1450 || freeSupernova > 0.30) {
        const prox = clamp((1450 - dStar) / 1200, 0, 1);
        const rate = 0.045 + prox * prox * 0.58 + (freeSupernova > 0.30 ? 0.14 : 0.0);
        freeSupernova = Math.min(1.0, freeSupernova + dt * rate);
      } else if (freeSupernova > 0) {
        freeSupernova = Math.max(0.0, freeSupernova - dt * 0.08);
      }
      supernovaAmt = freeSupernova * (0.45 + 0.55 * freeSupernova * freeSupernova);
      if (freeSupernova >= 1.0) {
        freeSupernova = 0.0;
        returnToMenuFromSupernova();
      }
    }

    // 2. Compute Continuous Act Weights & Camera Basis
    computeActWeights(actW, camPos[0], camPos[1], camPos[2]);
    const pulsePhase = (sceneTime * 0.145) % 1.0;
    audio.update(actW[0], actW[1], actW[2], pulsePhase, supernovaAmt);

    const aspect = W / H;
    const fovRad = fovDeg * (Math.PI / 180);
    const tanH = Math.tan(fovRad * 0.5);
    mat4Perspective(mProj, fovRad, aspect, 0.8, 18000.0);

    // Banked camera up vector
    const ux0 = Math.sin(bankRad), uy0 = Math.cos(bankRad), uz0 = 0;
    mat4LookAt(mView, camPos[0], camPos[1], camPos[2], camTarget[0], camTarget[1], camTarget[2], ux0, uy0, uz0);
    mat4Mul(mVP, mProj, mView);
    mat4Invert(mInvVP, mVP);

    // Extract orthonormal basis directly from view matrix rows
    camRight[0] = mView[0]; camRight[1] = mView[4]; camRight[2] = mView[8];
    camUp[0]    = mView[1]; camUp[1]    = mView[5]; camUp[2]    = mView[9];
    camFwd[0]   = -mView[2]; camFwd[1]  = -mView[6]; camFwd[2]  = -mView[10];

    // Mirrored reflection camera across y = 0 (for Act I mirrored ocean!)
    mat4LookAt(mReflView, camPos[0], -camPos[1], camPos[2], camTarget[0], -camTarget[1], camTarget[2], -ux0, uy0, uz0);
    mat4Mul(mReflVP, mProj, mReflView);
    mat4Invert(mReflInvVP, mReflVP);

    writeUniforms(
      uMainBuf, uMainData, mVP, mInvVP, mReflVP,
      camPos[0], camPos[1], camPos[2],
      camFwd[0], camFwd[1], camFwd[2],
      camRight[0], camRight[1], camRight[2],
      camUp[0], camUp[1], camUp[2],
      aspect, tanH, sceneTime, false, supernovaAmt
    );

    const isWarmup = frameIdx <= 3;
    const drawAct1 = isWarmup || ((actW[0] > 0.015 || actW[3] > 0.04) && camPos[1] > 0.4 && camPos[1] < 240);
    // Smart frustum check: always render cathedral in Acts I & II (ZERO portal pop-in!), and in Act III whenever looking toward the Oculus (ZERO reverse pop-in & ZERO wasted GPU behind camera!)
    const oDx = WORLD.SHAFT_X - camPos[0], oDy = WORLD.OCULUS_Y - camPos[1], oDz = WORLD.SHAFT_Z - camPos[2];
    const oDist = Math.hypot(oDx, oDy, oDz) || 1;
    const lookingAtOculus = (oDx * camFwd[0] + oDy * camFwd[1] + oDz * camFwd[2]) / oDist > 0.10;
    const drawCathedral = isWarmup || camPos[1] < 580 || (camPos[1] < 2600 && lookingAtOculus);
    const drawAstrolabe = isWarmup || actW[2] > 0.01 || camPos[1] > 180;

    if (drawAct1) {
      writeUniforms(
        uReflBuf, uReflData, mReflVP, mReflInvVP, mReflVP,
        camPos[0], -camPos[1], camPos[2],
        -mReflView[2], -mReflView[6], -mReflView[10],
        mReflView[0], mReflView[4], mReflView[8],
        mReflView[1], mReflView[5], mReflView[9],
        aspect, tanH, sceneTime, true, 0.0
      );
    }

    // 3. Acquire free timestamp query slot (zero stalling, zero allocation!)
    let tsSlot = null;
    if (hasTimestampQuery) {
      for (let s = 0; s < TS_SLOTS; s++) {
        if (!tsSlots[s].inFlight) { tsSlot = tsSlots[s]; break; }
      }
    }
    let tsPassIdx = 0;
    const bindTS = (desc) => {
      if (tsSlot && tsPassIdx < TS_MAX_PASSES) {
        desc.timestampWrites = tsSlot.writes[tsPassIdx++];
      } else {
        desc.timestampWrites = undefined;
      }
      return desc;
    };

    const enc = device.createCommandEncoder();

    // --- PASS 0: PLANAR MIRROR REFLECTION (ACT I ONLY, 960x540) ---
    if (drawAct1) {
      const p = enc.beginRenderPass(bindTS(rt.passRefl));
      p.setBindGroup(0, bgReflU);
      p.setPipeline(pipeStaticRefl);
      drawMesh(p, meshPortalNave);
      drawMesh(p, meshReflSeal);
      p.setPipeline(pipeCrystalRefl);
      drawMesh(p, meshCrystals);
      p.setPipeline(pipeSkyRefl);
      p.draw(3);
      p.setPipeline(pipePartRefl);
      p.setBindGroup(1, bgParts);
      p.draw(6, partData.act1Count, 0, partData.act1Start);
      p.end();
    }

    // --- PASS 1: MAIN 4x MSAA OPAQUE ARCHITECTURE + OCEAN + SKY ---
    {
      const mainDesc = drawAct1 ? rt.passMainStore : rt.passMainDiscard;
      const p = enc.beginRenderPass(bindTS(mainDesc));
      p.setBindGroup(0, bgMainU);

      // Static Portal Monolith, Nave, and (when inside cathedral or space!) Geometric Oculus & Citadel Roof
      p.setPipeline(pipeStaticMain);
      drawMesh(p, meshPortalNave);
      if (actW[1] > 0.05 || actW[2] > 0.01 || camPos[1] > 180) {
        drawMesh(p, meshOculusCitadel);
      }

      // Act II Fractal Cathedral Instanced Modules (strictly culled when far out at sea!)
      if (drawCathedral) {
        p.setPipeline(pipeCathMain);
        drawInst(p, meshCathBay, bgCathBay, cathData.bayCount);
        drawInst(p, meshCathWin, bgCathWin, cathData.winBayCount);
        drawInst(p, meshCathBridge, bgCathBridge, cathData.bridgeCount);
        drawInst(p, meshCathPillar, bgCathPillar, cathData.pillarCount);
        drawInst(p, meshCathBlock, bgCathBlock, cathData.blockCount);
      }

      // Act III Planetary-Scale Orbital Astrolabe (44 counter-rotating obsidian & bronze rings!)
      if (drawAstrolabe) {
        p.setPipeline(pipeAstroMain);
        drawInst(p, meshRingA, bgRingA, astroData.countA);
        drawInst(p, meshRingB, bgRingB, astroData.countB);
        drawInst(p, meshRingC, bgRingC, astroData.countC);
      }

      // Act I Mirrored Rippling Ocean Surface
      if (drawAct1) {
        p.setPipeline(pipeWaterMain);
        p.setBindGroup(1, rt.bgWaterRefl);
        drawMesh(p, meshOcean);
      }

      // Cosmic Sky (drawn after opaque so early-Z rejects every occluded pixel!)
      p.setPipeline(pipeSkyMain);
      p.draw(3);

      // In Acts II & III, render active realm particles right inside Pass 1 -> ZERO extra MSAA store!
      if (!drawAct1) {
        p.setPipeline(pipePartMain);
        p.setBindGroup(1, bgParts);
        if (drawCathedral) p.draw(6, partData.act2Count, 0, partData.act2Start);
        if (actW[2] > 0.01 || camPos[1] > 320) p.draw(6, partData.act3Count, 0, partData.act3Start);
      }
      p.end();
    }

    // --- PASS 2: ACT I REFRACTIVE TRANSLUCENT CRYSTAL BLADES (SINGLE UNIFIED 4x MSAA PASS!) ---
    if (drawAct1) {
      enc.copyTextureToTexture(rt.copySrcObj, rt.copyDstObj, rt.copySize);
      const p = enc.beginRenderPass(bindTS(rt.passCrystNear));
      p.setBindGroup(0, bgMainU);
      p.setPipeline(pipeCrystalMain);
      p.setBindGroup(1, rt.bgSceneCopy);
      drawMesh(p, meshCrystals);
      // Render Act I motes + ALL cathedral shaft/corridor sparks continuously as soon as approaching/inside portal (zero pop-in!)
      p.setPipeline(pipePartMain);
      p.setBindGroup(1, bgParts);
      p.draw(6, partData.act1Count, 0, partData.act1Start);
      if (drawCathedral) p.draw(6, partData.act2Count, 0, partData.act2Start);
      p.end();
    }

    // --- PASS 3: HALF-RES VOLUMETRIC GOD RAYS & MIST + BILATERAL DEPTH SMOOTH ---
    {
      const p = enc.beginRenderPass(bindTS(rt.passVol));
      p.setPipeline(pipeVol);
      p.setBindGroup(0, rt.bgVol);
      p.draw(3);
      p.end();
    }
    {
      const p = enc.beginRenderPass(bindTS(rt.passVolBlur));
      p.setPipeline(pipeVolBlur);
      p.setBindGroup(0, rt.bgVolBlur);
      p.draw(3);
      p.end();
    }

    // --- PASS 4: 4-MIP KARIS-AVERAGE BLOOM (QUARTER-RES START) ---
    for (let i = 0; i < 4; i++) {
      const p = enc.beginRenderPass(bindTS(rt.bloomDownPasses[i]));
      p.setPipeline(pipeBloomDown);
      p.setBindGroup(0, rt.bloomDownBGs[i]);
      p.draw(3);
      p.end();
    }
    for (let i = 0; i < 3; i++) {
      const p = enc.beginRenderPass(bindTS(rt.bloomUpPasses[i]));
      p.setPipeline(pipeBloomUp);
      p.setBindGroup(0, rt.bloomUpBGs[i]);
      p.draw(3);
      p.end();
    }

    // --- PASS 5: 1920x1080 AGX TONEMAP COMPOSITE -> PERCEPTUAL LUMA LDR TARGET ---
    {
      const p = enc.beginRenderPass(bindTS(rt.passComp));
      p.setPipeline(pipeComp);
      p.setBindGroup(0, rt.bgComp);
      p.draw(3);
      p.end();
    }

    // --- PASS 6: POST-TONEMAP FXAA 3.11 QUALITY + TRIANGULAR ANTI-BANDING DITHER -> SWAPCHAIN ---
    {
      rt.passFxaa.colorAttachments[0].view = ctx.getCurrentTexture().createView();
      const p = enc.beginRenderPass(bindTS(rt.passFxaa));
      p.setPipeline(pipeFxaa);
      p.setBindGroup(0, rt.bgFxaa);
      p.draw(3);
      p.end();
    }

    // Resolve GPU timestamps asynchronously into ring-buffer slot
    if (tsSlot && tsPassIdx > 0) {
      const qCount = tsPassIdx * 2;
      enc.resolveQuerySet(tsSlot.qs, 0, qCount, tsSlot.resolveBuf, 0);
      enc.copyBufferToBuffer(tsSlot.resolveBuf, 0, tsSlot.readBuf, 0, qCount * 8);
      tsSlot.inFlight = true;
      tsSlot.passCount = tsPassIdx;
      tsSlot.tourT = tourTime;
      tsSlot.actIdx = actW[2] > 0.5 ? 2 : (actW[1] > 0.5 ? 1 : 0);
      tsSlot.wasRec = perfRecording && frameIdx > 6;
    }

    device.queue.submit([enc.finish()]);

    // Optional native-resolution PNG capture for automated 1920x1080 verification (?pose=N&res=1920x1080&dl=poseN.png)
    if (dlName && !dlDone && frameIdx >= 12) {
      dlDone = true;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = dlName;
        document.body.appendChild(a);
        a.click();
        if (reportEl) reportEl.dataset.dlDone = '1';
      }, 'image/png');
    }

    // Kick off non-blocking GPU timestamp readback with preallocated callbacks
    if (tsSlot && tsSlot.inFlight) {
      tsSlot.readBuf.mapAsync(GPUMapMode.READ).then(tsSlot.onMapped, tsSlot.onErr);
    }

    // Record wall-clock frame delta during scripted 60s tour benchmark (skip initial 6 warmup frames)
    if (perfRecording && frameIdx > 6 && perfFrameCount < MAX_PERF_FRAMES && rawDtMs > 0.5 && rawDtMs < 200) {
      perfFrameDt[perfFrameCount++] = rawDtMs;
    }
    if (rawDtMs > 0.5 && rawDtMs < 200) {
      lastDtMsSmooth = lastDtMsSmooth * 0.9 + rawDtMs * 0.1;
      graphFtHist[graphHead] = rawDtMs;
      graphGpuHist[graphHead] = lastGpuMsRaw > 0 ? lastGpuMsRaw : lastGpuMsSmooth;
      graphHead = (graphHead + 1) % GRAPH_N;
    }

    // Throttled top-right FPS/ms counter + live ms graph & HUD update (10 Hz graph, 4 Hz text; skipped when HUD hidden!)
    if (hudVisible && now - lastHudUpdate > 100) {
      lastHudUpdate = now;
      if (fpsTxtEl) {
        const fps = Math.round(1000 / Math.max(1, lastDtMsSmooth));
        const gpuTxt = hasTimestampQuery ? `GPU ${lastGpuMsSmooth.toFixed(2)} ms` : `FT ${lastDtMsSmooth.toFixed(2)} ms`;
        fpsTxtEl.textContent = `${fps} FPS · ${lastDtMsSmooth.toFixed(1)} ms\n${gpuTxt} · ${W}×${H}`;
      }
      if (msGraphCtx) {
        const gw = 164, gh = 38, maxMs = 20.0;
        msGraphCtx.clearRect(0, 0, gw, gh);
        // Reference budget lines: 16.7ms (60Hz amber) and 8.33ms (120Hz cyan)
        const y16 = gh - (16.7 / maxMs) * gh;
        const y8  = gh - (8.33 / maxMs) * gh;
        msGraphCtx.fillStyle = 'rgba(246,184,96,0.22)';
        msGraphCtx.fillRect(0, y16, gw, 1);
        msGraphCtx.fillStyle = 'rgba(72,224,240,0.22)';
        msGraphCtx.fillRect(0, y8, gw, 1);

        // Plot Frame Time ms (warm amber line)
        msGraphCtx.strokeStyle = 'rgba(245,212,142,0.82)';
        msGraphCtx.lineWidth = 1.25;
        msGraphCtx.beginPath();
        for (let i = 0; i < GRAPH_N; i++) {
          const idx = (graphHead + i) % GRAPH_N;
          const x = (i / (GRAPH_N - 1)) * gw;
          const y = gh - Math.min(1, graphFtHist[idx] / maxMs) * (gh - 2) - 1;
          if (i === 0) msGraphCtx.moveTo(x, y); else msGraphCtx.lineTo(x, y);
        }
        msGraphCtx.stroke();

        // Plot GPU ms (bright cyan filled area + crisp line)
        if (hasTimestampQuery) {
          msGraphCtx.beginPath();
          for (let i = 0; i < GRAPH_N; i++) {
            const idx = (graphHead + i) % GRAPH_N;
            const x = (i / (GRAPH_N - 1)) * gw;
            const y = gh - Math.min(1, graphGpuHist[idx] / maxMs) * (gh - 2) - 1;
            if (i === 0) msGraphCtx.moveTo(x, y); else msGraphCtx.lineTo(x, y);
          }
          msGraphCtx.strokeStyle = 'rgba(66,226,245,0.95)';
          msGraphCtx.lineWidth = 1.4;
          msGraphCtx.stroke();
          msGraphCtx.lineTo(gw, gh);
          msGraphCtx.lineTo(0, gh);
          msGraphCtx.closePath();
          msGraphCtx.fillStyle = 'rgba(66,226,245,0.16)';
          msGraphCtx.fill();
        }
      }
      if (mode !== 'menu') {
        const actIdx = actW[2] > 0.5 ? 2 : (actW[1] > 0.5 ? 1 : 0);
        if (hudActEl) {
          if (mode === 'free' && freeSupernova > 0.04) {
            hudActEl.textContent = freeSupernova > 0.35 ? 'III · SUPERNOVA DETONATION' : 'III · CORE INSTABILITY DETECTED';
          } else {
            hudActEl.textContent = ACT_NAMES[actIdx];
          }
        }
        if (hudTimeEl) hudTimeEl.textContent = mode === 'tour' ? `${tourTime.toFixed(1)}s / ${activeTourDur.toFixed(1)}s` : '';
      }
    }
  }

  requestAnimationFrame(frame);
}

boot().catch((e) => showError(`Initialization failed: ${e?.message || e}`));

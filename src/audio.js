// 100% Procedural Three-Act Web Audio Ambient Soundscape (zero assets, zero per-frame allocations)

export class CosmicAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.master = null;
    this.gAct1 = null;
    this.gAct2 = null;
    this.gAct3 = null;
    this.pulseGain = null;
    this.snRumbleGain = null;
    this.snBlastGain = null;
    this.snBlastFilt = null;
    this.snChoirGain = null;
    this.snRiserOsc1 = null;
    this.snRiserOsc2 = null;
    this.snRiserGain = null;
  }

  init() {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.started = true;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.gain.exponentialRampToValueAtTime(0.42, ctx.currentTime + 1.8);
    comp.connect(master);
    master.connect(ctx.destination);
    this.master = master;

    // 1. Procedural Lush Stereo Reverb Impulse (3.4s diffuse tail)
    const sr = ctx.sampleRate;
    const revLen = Math.floor(sr * 3.4);
    const revBuf = ctx.createBuffer(2, revLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = revBuf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < revLen; i++) {
        const t = i / revLen;
        const env = Math.pow(1 - t, 2.7) * Math.min(1, i / (sr * 0.04));
        const white = Math.random() * 2 - 1;
        lp = lp * 0.72 + white * 0.28;
        d[i] = lp * env;
      }
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = revBuf;
    const revWet = ctx.createGain();
    revWet.gain.value = 0.52;
    reverb.connect(revWet);
    revWet.connect(comp);

    // 2. Seamless 4-second Pink/Brown Noise Buffer
    const nLen = sr * 4;
    const nBuf = ctx.createBuffer(2, nLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = nBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < nLen; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.950 * b2 + w * 0.048;
        d[i] = (b0 + b1 + b2) * 0.45;
      }
      // Crossfade ends so loop has zero clicks
      const xf = Math.floor(sr * 0.15);
      for (let i = 0; i < xf; i++) {
        const k = i / xf;
        d[i] = d[i] * k + d[nLen - xf + i] * (1 - k);
      }
    }

    const mkLoopNoise = () => {
      const src = ctx.createBufferSource();
      src.buffer = nBuf;
      src.loop = true;
      src.start();
      return src;
    };

    const mkLfo = (freq, depth, targetParam, phaseOffset = 0) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = depth;
      osc.connect(g);
      g.connect(targetParam);
      osc.start(ctx.currentTime + phaseOffset);
    };

    // =========================================================================
    // ACT I STEM: Resonant Glassy Harmonics + Deep Ocean Hum
    // =========================================================================
    const gAct1 = ctx.createGain();
    gAct1.gain.value = 1.0;
    gAct1.connect(comp);
    gAct1.connect(reverb);
    this.gAct1 = gAct1;

    // Deep ocean hum (55 Hz A1 + 82.4 Hz E2 + slow low-pass swell noise)
    for (const [freq, amp] of [[55.0, 0.22], [55.35, 0.14], [82.41, 0.09]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g); g.connect(gAct1);
      o.start();
    }
    const oceanNoise = mkLoopNoise();
    const oceanFilt = ctx.createBiquadFilter();
    oceanFilt.type = 'lowpass';
    oceanFilt.frequency.value = 185;
    oceanFilt.Q.value = 1.4;
    mkLfo(0.085, 75, oceanFilt.frequency);
    const oceanGain = ctx.createGain();
    oceanGain.gain.value = 0.22;
    oceanNoise.connect(oceanFilt); oceanFilt.connect(oceanGain); oceanGain.connect(gAct1);

    // Resonant glassy crystal harmonics (open Lydian chord shimmering gently through reverb)
    const glassNotes = [293.66, 440.0, 659.25, 739.99, 987.77, 1318.5];
    glassNotes.forEach((f, idx) => {
      const o = ctx.createOscillator();
      o.type = idx < 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.024 / (1 + idx * 0.25);
      mkLfo(0.065 + idx * 0.023, g.gain.value * 0.85, g.gain, idx * 0.7);
      const pan = ctx.createStereoPanner();
      pan.pan.value = ((idx % 2) ? 1 : -1) * (0.25 + idx * 0.1);
      o.connect(g); g.connect(pan); pan.connect(reverb);
      if (idx < 3) pan.connect(gAct1);
      o.start();
    });

    // =========================================================================
    // ACT II STEM: Cavernous Sub-Bass + Distant Stone Echoes
    // =========================================================================
    const gAct2 = ctx.createGain();
    gAct2.gain.value = 0.0001;
    gAct2.connect(comp);
    gAct2.connect(reverb);
    this.gAct2 = gAct2;

    // Cavernous sub-bass (36.7 Hz D1 sawtooth + 55 Hz A1 filtered deep & ominous)
    const subFilt = ctx.createBiquadFilter();
    subFilt.type = 'lowpass';
    subFilt.frequency.value = 96;
    subFilt.Q.value = 2.8;
    mkLfo(0.055, 36, subFilt.frequency);
    subFilt.connect(gAct2);

    for (const [freq, type, amp] of [[36.71, 'sawtooth', 0.16], [36.95, 'sine', 0.26], [73.42, 'triangle', 0.11]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g); g.connect(subFilt);
      o.start();
    }

    // Distant stone echoes & cavernous resonant drafts
    const stoneNoise = mkLoopNoise();
    const stoneBp = ctx.createBiquadFilter();
    stoneBp.type = 'bandpass';
    stoneBp.frequency.value = 220;
    stoneBp.Q.value = 5.5;
    mkLfo(0.042, 95, stoneBp.frequency);
    const stoneGain = ctx.createGain();
    stoneGain.gain.value = 0.18;
    mkLfo(0.11, 0.14, stoneGain.gain);
    stoneNoise.connect(stoneBp); stoneBp.connect(stoneGain); stoneGain.connect(reverb);

    // Dark monolithic modal stone resonances (D2, A2, F3, C4) echoing deeply
    const cathTones = [73.42, 110.0, 174.61, 261.63];
    cathTones.forEach((f, idx) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.032 / (1 + idx * 0.3);
      mkLfo(0.048 + idx * 0.019, g.gain.value * 0.9, g.gain, idx * 1.1);
      o.connect(g); g.connect(reverb);
      o.start();
    });

    // =========================================================================
    // ACT III STEM: Shimmering Celestial Drones + Coronal Pulse Overtones
    // =========================================================================
    const gAct3 = ctx.createGain();
    gAct3.gain.value = 0.0001;
    gAct3.connect(comp);
    gAct3.connect(reverb);
    this.gAct3 = gAct3;

    const celestialFilt = ctx.createBiquadFilter();
    celestialFilt.type = 'lowpass';
    celestialFilt.frequency.value = 950;
    celestialFilt.Q.value = 0.9;
    mkLfo(0.06, 480, celestialFilt.frequency);
    celestialFilt.connect(gAct3);

    // Wide luminous A-Lydian / celestial choir pad
    const spaceNotes = [110.0, 164.81, 246.94, 277.18, 415.30, 659.25];
    spaceNotes.forEach((f, idx) => {
      for (const detune of [-4.5, 4.5]) {
        const o = ctx.createOscillator();
        o.type = idx < 2 ? 'sawtooth' : 'sine';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = (idx < 2 ? 0.038 : 0.030) / (1 + idx * 0.22);
        const pan = ctx.createStereoPanner();
        pan.pan.value = detune > 0 ? 0.48 : -0.48;
        o.connect(g); g.connect(pan); pan.connect(celestialFilt);
        o.start();
      }
    });

    // High crystalline celestial shimmer synced softly to coronal light pulses!
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.025;
    pulseGain.connect(reverb);
    this.pulseGain = pulseGain;
    for (const hf of [1318.5, 1760.0, 2217.46]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hf;
      const g = ctx.createGain();
      g.gain.value = 0.014;
      o.connect(g); g.connect(pulseGain);
      o.start();
    }

    // =========================================================================
    // SUPERNOVA FINALE STEM: Gravitational Rumble + Rising Harmonic Tension +
    // Cataclysmic Plasma Shockwave Boom + Transcendent Pure-White Choir Swell!
    // =========================================================================
    // 1. Seismic Sub-Bass Gravitational Detonation Rumble (28 Hz + 41.2 Hz + 55 Hz)
    const snRumbleGain = ctx.createGain();
    snRumbleGain.gain.value = 0.0001;
    const snRumbleFilt = ctx.createBiquadFilter();
    snRumbleFilt.type = 'lowpass';
    snRumbleFilt.frequency.value = 115;
    snRumbleFilt.Q.value = 2.2;
    snRumbleGain.connect(snRumbleFilt);
    snRumbleFilt.connect(comp);
    snRumbleFilt.connect(reverb);
    this.snRumbleGain = snRumbleGain;
    for (const [f, typ, a] of [[27.5, 'sawtooth', 0.34], [36.71, 'sine', 0.42], [55.0, 'triangle', 0.28], [55.7, 'sawtooth', 0.18]]) {
      const o = ctx.createOscillator();
      o.type = typ;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g); g.connect(snRumbleGain);
      o.start();
    }

    // 2. Roaring Expanding Astrophysical Plasma Shockwave Blast (swept resonant pink/brown noise)
    const snBlastSrc = mkLoopNoise();
    const snBlastFilt = ctx.createBiquadFilter();
    snBlastFilt.type = 'lowpass';
    snBlastFilt.frequency.value = 140;
    snBlastFilt.Q.value = 1.6;
    const snBlastGain = ctx.createGain();
    snBlastGain.gain.value = 0.0001;
    snBlastSrc.connect(snBlastFilt);
    snBlastFilt.connect(snBlastGain);
    snBlastGain.connect(comp);
    snBlastGain.connect(reverb);
    this.snBlastFilt = snBlastFilt;
    this.snBlastGain = snBlastGain;

    // 3. Rising Pitch-Swept Pre-Detonation Harmonic Tension Swell
    const snRiserGain = ctx.createGain();
    snRiserGain.gain.value = 0.0001;
    snRiserGain.connect(reverb);
    snRiserGain.connect(comp);
    this.snRiserGain = snRiserGain;
    const riser1 = ctx.createOscillator();
    riser1.type = 'sawtooth';
    riser1.frequency.value = 110;
    const riser2 = ctx.createOscillator();
    riser2.type = 'triangle';
    riser2.frequency.value = 165;
    const riserFilt = ctx.createBiquadFilter();
    riserFilt.type = 'bandpass';
    riserFilt.frequency.value = 520;
    riserFilt.Q.value = 2.0;
    const rG = ctx.createGain();
    rG.gain.value = 0.18;
    riser1.connect(riserFilt); riser2.connect(riserFilt);
    riserFilt.connect(rG); rG.connect(snRiserGain);
    riser1.start(); riser2.start();
    this.snRiserOsc1 = riser1;
    this.snRiserOsc2 = riser2;

    // 4. Transcendent Incandescent White-Light Major-9th Celestial Choir Swell (A-major 9th)
    const snChoirGain = ctx.createGain();
    snChoirGain.gain.value = 0.0001;
    snChoirGain.connect(reverb);
    snChoirGain.connect(comp);
    this.snChoirGain = snChoirGain;
    const choirFreqs = [220.0, 277.18, 329.63, 440.0, 493.88, 659.25, 880.0];
    choirFreqs.forEach((f, idx) => {
      const o = ctx.createOscillator();
      o.type = idx < 3 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = ((idx % 2) ? 6.0 : -6.0);
      const g = ctx.createGain();
      g.gain.value = 0.065 / (1 + idx * 0.14);
      const pan = ctx.createStereoPanner();
      pan.pan.value = ((idx % 2) ? 1 : -1) * (0.2 + idx * 0.1);
      o.connect(g); g.connect(pan); pan.connect(snChoirGain);
      o.start();
    });
  }

  // Called once per frame with zero allocations
  update(wSea, wCath, wSpace, pulsePhase, supernova = 0.0) {
    if (!this.started || !this.ctx) return;
    const now = this.ctx.currentTime;
    const tc = 0.25;
    const sn = Math.max(0, Math.min(1, supernova));
    this.gAct1.gain.setTargetAtTime(Math.max(0.0001, wSea), now, 0.35);
    this.gAct2.gain.setTargetAtTime(Math.max(0.0001, wCath), now, 0.35);
    this.gAct3.gain.setTargetAtTime(Math.max(0.0001, wSpace * (1.0 - sn * 0.35)), now, 0.35);
    const pulseSw = Math.exp(-Math.pow((pulsePhase - 0.15) * 4.5, 2.0));
    this.pulseGain.gain.setTargetAtTime(Math.max(0.0001, wSpace * (0.28 + 0.72 * pulseSw)), now, 0.12);

    // Visceral 4-layer Supernova Audio Choreography!
    // 1. Tension riser builds rapidly from sn=0.02..0.55 then dissolves into the shockwave
    const riserEnv = sn > 0.005 ? Math.sin(Math.min(1, sn / 0.65) * Math.PI) * 0.85 : 0.0;
    this.snRiserGain.gain.setTargetAtTime(Math.max(0.0001, riserEnv * 0.55), now, 0.08);
    this.snRiserOsc1.frequency.setTargetAtTime(110 + sn * 330, now, 0.08);
    this.snRiserOsc2.frequency.setTargetAtTime(165 + sn * 495, now, 0.08);

    // 2. Seismic sub-bass rumble builds heavily from sn=0.10..0.95 (smooth 0.8s decay on return to menu!)
    const rumbleAmt = sn > 0.01 ? Math.pow(sn, 0.75) * 0.92 : 0.0;
    this.snRumbleGain.gain.setTargetAtTime(Math.max(0.0001, rumbleAmt), now, sn > 0.01 ? 0.10 : 0.85);

    // 3. Roaring plasma shockwave detonation erupts at sn=0.18 -> peaks at sn=0.82!
    const blastEnv = sn > 0.12 ? Math.pow(Math.min(1, (sn - 0.12) / 0.65), 1.35) * 1.15 : 0.0;
    this.snBlastGain.gain.setTargetAtTime(Math.max(0.0001, blastEnv), now, sn > 0.01 ? 0.12 : 0.95);
    this.snBlastFilt.frequency.setTargetAtTime(120 + sn * sn * 2400, now, 0.10);

    // 4. Transcendent pure-white radiant choir swells from sn=0.45..1.0 and rings softly into the Start Menu!
    const choirEnv = sn > 0.35 ? Math.pow((sn - 0.35) / 0.65, 1.4) * 0.95 : 0.0;
    this.snChoirGain.gain.setTargetAtTime(Math.max(0.0001, choirEnv), now, sn > 0.01 ? 0.14 : 1.15);
  }

  toggleMute() {
    if (!this.started) this.init();
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.42, this.ctx.currentTime, 0.1);
    }
    return this.muted;
  }
}

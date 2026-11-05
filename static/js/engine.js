// The synthesizer. Everything is built from oscillators and noise, in Web Audio, so the same
// code plays live and renders offline for WAV export.

export const TRACKS = ["lead", "arp", "chords", "bass", "kick", "snare", "hat"];

const freq = (m) => 440 * 2 ** ((m - 69) / 12);

// Each style is a small studio: its sounds, its mix and its room.
const PATCHES = {
  softclub: {
    room: 2.6, roomTone: 0.55, duck: 0.5, delayBeats: 0.75, delayFeedback: 0.36,
    mix: { lead: 0.82, arp: 0.62, chords: 0.25, bass: 0.5, kick: 0.8, snare: 0.92, hat: 0.72 },
    send: { lead: [0.28, 0.3], arp: [0.34, 0.42], chords: [0.32, 0.06], snare: [0.2, 0], hat: [0.05, 0], bass: [0, 0], kick: [0, 0] },
    kick: { from: 160, to: 52, sweep: 0.06, decay: 0.22, click: 0.6 },
    snare: "clap", hatDecay: 0.05, bass: "round", chords: "warmPad", stab: "softStab", lead: "fmBell", arp: "glass",
  },
  twostep: {
    room: 1.5, roomTone: 0.7, duck: 0.62, delayBeats: 0.75, delayFeedback: 0.28,
    mix: { lead: 0.56, arp: 0.3, chords: 0.5, bass: 0.62, kick: 0.82, snare: 0.8, hat: 0.55 },
    send: { lead: [0.2, 0.26], arp: [0.2, 0.2], chords: [0.16, 0.1], snare: [0.14, 0], hat: [0.03, 0], bass: [0, 0], kick: [0, 0] },
    kick: { from: 200, to: 58, sweep: 0.05, decay: 0.17, click: 0.8 },
    snare: "crack", hatDecay: 0.04, bass: "sub", chords: "organ", stab: "organ", lead: "whistle", arp: "glass",
  },
  liquid: {
    room: 3.2, roomTone: 0.6, duck: 0.55, delayBeats: 0.75, delayFeedback: 0.42,
    mix: { lead: 0.62, arp: 0.5, chords: 0.28, bass: 0.58, kick: 0.82, snare: 0.82, hat: 0.5 },
    send: { lead: [0.36, 0.36], arp: [0.4, 0.4], chords: [0.38, 0.05], snare: [0.2, 0], hat: [0.04, 0], bass: [0, 0], kick: [0, 0] },
    kick: { from: 210, to: 60, sweep: 0.04, decay: 0.14, click: 0.9 },
    snare: "crack", hatDecay: 0.035, bass: "reese", chords: "warmPad", stab: "softStab", lead: "softSaw", arp: "rhodes",
  },
  trance: {
    room: 3.0, roomTone: 0.75, duck: 0.68, delayBeats: 0.75, delayFeedback: 0.46,
    mix: { lead: 0.62, arp: 0.5, chords: 0.5, bass: 0.48, kick: 0.86, snare: 0.8, hat: 0.5 },
    send: { lead: [0.36, 0.4], arp: [0.3, 0.45], chords: [0.3, 0.12], snare: [0.24, 0], hat: [0.05, 0], bass: [0, 0], kick: [0, 0] },
    kick: { from: 220, to: 54, sweep: 0.05, decay: 0.2, click: 0.95 },
    snare: "clap", hatDecay: 0.1, bass: "offbeat", chords: "supersawGate", stab: "supersawGate", lead: "supersaw", arp: "pluck",
  },
  drift: {
    room: 6.5, roomTone: 0.42, duck: 1, delayBeats: 1.5, delayFeedback: 0.5,
    mix: { lead: 0.85, arp: 0.85, chords: 0.22, bass: 0.36, kick: 0.42, snare: 0.6, hat: 0.5 },
    send: { lead: [0.6, 0.45], arp: [0.65, 0.5], chords: [0.55, 0.1], snare: [0.5, 0.2], hat: [0.5, 0.2], bass: [0.1, 0], kick: [0.2, 0] },
    kick: { from: 90, to: 44, sweep: 0.09, decay: 0.42, click: 0.05 },
    snare: "rim", hatDecay: 0.03, bass: "round", chords: "choir", stab: "softStab", lead: "fmBell", arp: "musicBox",
  },
};

export function defaultMix(style) {
  return { ...PATCHES[style].mix };
}

function makeImpulse(ctx, seconds, tone) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor(rate * 0.018);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    let seed = 1197 + ch * 7919; // a fixed room, so a render always sounds the same
    for (let i = preDelay; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      const white = seed / 1073741823.5 - 1;
      const t = (i - preDelay) / (length - preDelay);
      // the room gets darker as it decays
      const a = Math.max(0.04, tone * (1 - t * 0.85));
      low += a * (white - low);
      data[i] = low * Math.exp(-6.9 * t);
    }
  }
  return buffer;
}

function softClipCurve(amount) {
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class Engine {
  constructor(ctx, piece, mix, destination) {
    this.ctx = ctx;
    this.piece = piece;
    this.patch = PATCHES[piece.params.style] ?? PATCHES.softclub;
    this.stepSeconds = 60 / piece.bpm / 4;
    this.beat = 60 / piece.bpm;
    this.buses = {};
    this.noise = this.makeNoise();
    this.build(mix, destination ?? ctx.destination);
  }

  makeNoise() {
    const { ctx } = this;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 42;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = seed / 1073741823.5 - 1;
    }
    return buffer;
  }

  build(mix, destination) {
    const { ctx, patch } = this;

    // Master: clean the sub, glue, then catch the peaks.
    const input = ctx.createGain();
    input.gain.value = 0.6;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 28;
    const weight = ctx.createBiquadFilter();
    weight.type = "lowshelf";
    weight.frequency.value = 110;
    weight.gain.value = -2;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3000;
    presence.Q.value = 0.7;
    presence.gain.value = 2;
    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 8000;
    air.gain.value = 3.5;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -15;
    glue.ratio.value = 2;
    glue.attack.value = 0.012;
    glue.release.value = 0.16;
    glue.knee.value = 10;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(1.05);
    clip.oversample = "4x";
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    limiter.knee.value = 0;
    const output = ctx.createGain();
    output.gain.value = 0.92;
    input.connect(highpass).connect(weight).connect(presence).connect(air).connect(glue).connect(clip).connect(limiter).connect(output).connect(destination);
    this.master = input;
    this.output = output;

    // Room
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, patch.room, patch.roomTone);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.9;
    reverb.connect(reverbReturn).connect(input);
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(reverb);

    // Ping-pong delay, darker on every repeat
    const left = ctx.createDelay(4);
    const right = ctx.createDelay(4);
    left.delayTime.value = this.beat * patch.delayBeats;
    right.delayTime.value = this.beat * patch.delayBeats;
    const feedback = ctx.createGain();
    feedback.gain.value = patch.delayFeedback;
    const dark = ctx.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 3200;
    const thin = ctx.createBiquadFilter();
    thin.type = "highpass";
    thin.frequency.value = 320;
    const merger = ctx.createChannelMerger(2);
    this.delayIn = ctx.createGain();
    this.delayIn.connect(thin).connect(left);
    left.connect(right);
    right.connect(dark).connect(feedback).connect(left);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    const delayReturn = ctx.createGain();
    delayReturn.gain.value = 0.7;
    merger.connect(delayReturn).connect(input);

    // Ducking: what the kick pushes down
    this.duck = ctx.createGain();
    this.duck.connect(input);

    for (const name of TRACKS) {
      const gain = ctx.createGain();
      gain.gain.value = mix[name] ?? 0;
      const ducked = name === "kick" || name === "snare" || name === "hat" ? input : this.duck;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      gain.connect(ducked);
      gain.connect(analyser);
      const [toRoom, toDelay] = patch.send[name];
      if (toRoom) {
        const s = ctx.createGain();
        s.gain.value = toRoom;
        gain.connect(s).connect(this.reverbIn);
      }
      if (toDelay) {
        const s = ctx.createGain();
        s.gain.value = toDelay;
        gain.connect(s).connect(this.delayIn);
      }
      // Only the kick and bass get the low end. Everything else is filtered out of their way.
      const low = { lead: 200, arp: 320, chords: 240, snare: 180 }[name];
      let trackIn = gain;
      if (low) {
        trackIn = ctx.createBiquadFilter();
        trackIn.type = "highpass";
        trackIn.frequency.value = low;
        trackIn.Q.value = 0.6;
        trackIn.connect(gain);
      }
      const wide = name === "chords" ? this.makeChorus(trackIn) : name === "lead" ? this.makeChorus(trackIn, 0.8, 0.34) : trackIn;
      this.buses[name] = { gain, analyser, input: wide };
    }

    // Grit on the drums and bass, so they read on small speakers
    for (const name of ["kick", "bass"]) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = softClipCurve(name === "kick" ? 1.8 : 1.5);
      shaper.oversample = "2x";
      shaper.connect(this.buses[name].gain);
      this.buses[name].input = shaper;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    output.connect(analyser);
    this.analyser = analyser;
  }

  /** Two slowly drifting copies, panned apart, for width. */
  makeChorus(target, dryLevel = 0.42, wetLevel = 0.82) {
    const { ctx } = this;
    const input = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = dryLevel;
    input.connect(dry).connect(target);
    [[-0.95, 0.31, 0.0121], [0.95, 0.43, 0.0173]].forEach(([pan, rate, base]) => {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0.0028;
      lfo.connect(depth).connect(delay.delayTime);
      lfo.start();
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      const wet = ctx.createGain();
      wet.gain.value = wetLevel;
      input.connect(delay).connect(panner).connect(wet).connect(target);
    });
    return input;
  }

  setTrackGain(name, value) {
    const g = this.buses[name].gain.gain;
    g.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  /** The time of a 16th-note step, with swing pushing the off-beats back. */
  stepTime(step) {
    const whole = Math.floor(step);
    const swing = whole % 2 ? (this.piece.swing - 0.5) * 2 * this.stepSeconds : 0;
    return step * this.stepSeconds + swing;
  }

  /** Schedules one note. `at` is the context time of step 0. */
  play(track, note, at, destination) {
    const t = at + this.stepTime(note.s);
    const dur = note.d * this.stepSeconds;
    const out = destination?.[track] ?? this.buses[track].input;
    switch (track) {
      case "kick":
        this.kick(t, note.v, out);
        if (this.patch.duck < 1) {
          const d = this.duck.gain;
          d.setTargetAtTime(this.patch.duck, t, 0.004);
          d.setTargetAtTime(1, t + 0.04, 0.09);
        }
        break;
      case "snare":
        this[this.patch.snare](t, note.v, out);
        break;
      case "hat":
        this.hat(t, note, out);
        break;
      case "bass":
        this[`bass_${this.patch.bass}`](t, dur, note.m, note.v, out);
        break;
      case "chords":
        // long notes are the pad; short ones are stabs
        this[`chord_${note.d >= 8 ? this.patch.chords : this.patch.stab}`](t, dur, note.m, note.v, out);
        break;
      case "lead":
        this[`lead_${this.patch.lead}`](t, dur, note.m, note.v, out);
        break;
      case "arp":
        this[`lead_${this.patch.arp}`](t, dur, note.m, note.v, out, (note.m % 5) / 2 - 1);
        break;
    }
  }

  // ---- small parts

  osc(type, f, t, stop, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.start(t);
    o.stop(stop);
    return o;
  }

  gain(value = 0) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  filter(type, f, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  noiseAt(t, stop) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, ((t * 137.13) % 1.9));
    s.stop(stop);
    return s;
  }

  /** Attack, then decay to a sustain, then release after `len`. Returns when the voice is silent. */
  shape(param, t, peak, attack, decay, sustain, len, release) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setTargetAtTime(peak * sustain, t + attack, Math.max(0.002, decay / 3));
    const off = t + Math.max(len, attack + 0.005);
    param.setTargetAtTime(0.0001, off, Math.max(0.003, release / 3));
    return off + release * 2;
  }

  // ---- drums

  kick(t, v, out) {
    const p = this.patch.kick;
    const end = t + p.decay * 2.2;
    const body = this.osc("sine", p.from, t, end);
    body.frequency.setValueAtTime(p.from, t);
    body.frequency.exponentialRampToValueAtTime(p.to, t + p.sweep);
    const g = this.gain();
    g.gain.setValueAtTime(v, t);
    g.gain.setTargetAtTime(0.0001, t + 0.012, p.decay / 3.2);
    body.connect(g).connect(out);
    if (p.click > 0.01) {
      const stop = t + 0.018;
      const c = this.noiseAt(t, stop);
      const hp = this.filter("highpass", 1800);
      const cg = this.gain();
      cg.gain.setValueAtTime(v * p.click * 0.5, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, stop);
      c.connect(hp).connect(cg).connect(out);
    }
  }

  clap(t, v, out) {
    const end = t + 0.32;
    const n = this.noiseAt(t, end);
    const bp = this.filter("bandpass", 1500, 0.9);
    const hp = this.filter("highpass", 700);
    const g = this.gain();
    const param = g.gain;
    param.setValueAtTime(0.0001, t);
    [0, 0.011, 0.023].forEach((o) => {
      param.setValueAtTime(v, t + o);
      param.exponentialRampToValueAtTime(v * 0.15, t + o + 0.009);
    });
    param.setValueAtTime(v * 0.75, t + 0.034);
    param.setTargetAtTime(0.0001, t + 0.036, 0.055);
    const lift = this.gain(2.6);
    n.connect(bp).connect(hp).connect(lift).connect(g).connect(out);
  }

  crack(t, v, out) {
    const end = t + 0.34;
    const n = this.noiseAt(t, end);
    const hp = this.filter("highpass", 1400);
    const bright = this.filter("peaking", 3800, 1);
    bright.gain.value = 5;
    const g = this.gain();
    g.gain.setValueAtTime(v * 0.9, t);
    g.gain.setTargetAtTime(0.0001, t + 0.008, 0.05);
    n.connect(hp).connect(bright).connect(g).connect(out);
    const tone = this.osc("triangle", 215, t, t + 0.16);
    tone.frequency.setValueAtTime(215, t);
    tone.frequency.exponentialRampToValueAtTime(165, t + 0.05);
    const tg = this.gain();
    tg.gain.setValueAtTime(v * 0.6, t);
    tg.gain.setTargetAtTime(0.0001, t + 0.01, 0.035);
    tone.connect(tg).connect(out);
  }

  rim(t, v, out) {
    const tone = this.osc("sine", 1700, t, t + 0.09);
    const g = this.gain();
    g.gain.setValueAtTime(v * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    tone.connect(g).connect(out);
    const n = this.noiseAt(t, t + 0.03);
    const hp = this.filter("highpass", 2500);
    const ng = this.gain();
    ng.gain.setValueAtTime(v * 0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
    n.connect(hp).connect(ng).connect(out);
  }

  hat(t, note, out) {
    const onBeat = note.s % 4 === 2; // the off-beat hat rings a little longer
    const decay = this.patch.hatDecay * (onBeat ? 2.6 : 1.2) * (0.7 + note.v);
    const end = t + decay * 5;
    const n = this.noiseAt(t, end);
    const hp = this.filter("highpass", 6800);
    const air = this.filter("peaking", 10500, 0.8);
    air.gain.value = 7;
    const g = this.gain();
    g.gain.setValueAtTime(note.v, t);
    g.gain.setTargetAtTime(0.0001, t + 0.002, decay);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = note.s % 2 ? 0.22 : -0.14;
    n.connect(hp).connect(air).connect(g).connect(pan).connect(out);
  }

  // ---- bass

  bass_round(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.max(dur * 0.9, 0.12);
    const end = t + len + 0.2;
    const lp = this.filter("lowpass", 520, 0.8);
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.setTargetAtTime(420, t, 0.1);
    const g = this.gain();
    this.shape(g.gain, t, v, 0.006, 0.2, 0.7, len, 0.07);
    this.osc("sine", f, t, end).connect(g);
    const tri = this.gain(0.7);
    this.osc("sawtooth", f, t, end, 3).connect(tri).connect(lp).connect(g);
    g.connect(out);
  }

  bass_sub(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.max(dur * 0.95, 0.14);
    const end = t + len + 0.2;
    const body = this.osc("sine", f, t, end);
    body.frequency.setValueAtTime(f * 1.5, t);
    body.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = this.gain();
    this.shape(g.gain, t, v, 0.004, 0.25, 0.8, len, 0.05);
    const grit = this.gain(0.2);
    this.osc("square", f, t, end).connect(this.filter("lowpass", 800)).connect(grit).connect(g);
    body.connect(g).connect(out);
  }

  bass_reese(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.max(dur * 1.2, 0.2);
    const end = t + len + 0.25;
    const lp = this.filter("lowpass", 420, 1.5);
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.setTargetAtTime(620, t, 0.18);
    const g = this.gain();
    this.shape(g.gain, t, v, 0.012, 0.3, 0.85, len, 0.08);
    const saws = this.gain(0.34);
    this.osc("sawtooth", f, t, end, -13).connect(saws);
    this.osc("sawtooth", f, t, end, 13).connect(saws);
    saws.connect(lp).connect(g);
    const sub = this.gain(0.72);
    this.osc("sine", f, t, end).connect(sub).connect(g);
    g.connect(out);
  }

  bass_offbeat(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.min(dur * 0.8, this.stepSeconds * 1.3);
    const end = t + len + 0.1;
    const lp = this.filter("lowpass", 700, 3);
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.setTargetAtTime(260, t, 0.045);
    const g = this.gain();
    this.shape(g.gain, t, v, 0.003, 0.09, 0.55, len, 0.025);
    const saws = this.gain(0.5);
    this.osc("sawtooth", f, t, end, -6).connect(saws);
    this.osc("sawtooth", f, t, end, 6).connect(saws);
    saws.connect(lp).connect(g);
    const sub = this.gain(0.6);
    this.osc("sine", f, t, end).connect(sub).connect(g);
    g.connect(out);
  }

  // ---- chords

  chord_warmPad(t, dur, m, v, out) {
    const f = freq(m);
    const release = this.beat * 1.1;
    const end = t + dur + release * 2.2;
    const lp = this.filter("lowpass", 1000, 0.5);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.linearRampToValueAtTime(3400, t + dur * 0.6);
    lp.frequency.linearRampToValueAtTime(1800, t + dur + release);
    const g = this.gain();
    this.shape(g.gain, t, v * 0.5, this.beat * 0.45, 0.4, 0.85, dur, release);
    this.osc("sawtooth", f, t, end, -7).connect(lp);
    this.osc("sawtooth", f, t, end, 8).connect(lp);
    const body = this.gain(1.4);
    this.osc("triangle", f, t, end).connect(body).connect(lp);
    lp.connect(g).connect(out);
  }

  chord_choir(t, dur, m, v, out) {
    const f = freq(m);
    const release = this.beat * 2.4;
    const end = t + dur + release * 2.2;
    const g = this.gain();
    this.shape(g.gain, t, v * 0.62, this.beat * 1.5, 0.8, 0.9, dur, release);
    const lfo = this.osc("sine", 4.3 + (m % 5) * 0.11, t, end);
    const depth = this.gain(3.5);
    lfo.connect(depth);
    const a = this.osc("sine", f, t, end);
    depth.connect(a.detune);
    a.connect(g);
    const h = this.gain(0.34);
    const b = this.osc("sawtooth", f * 2, t, end, 4);
    depth.connect(b.detune);
    b.connect(this.filter("lowpass", 3200)).connect(h).connect(g);
    g.connect(out);
  }

  chord_softStab(t, dur, m, v, out) {
    const f = freq(m);
    const end = t + 0.55;
    const lp = this.filter("lowpass", 900, 1);
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.setTargetAtTime(1300, t, 0.09);
    const g = this.gain();
    g.gain.setValueAtTime(v * 0.42, t);
    g.gain.setTargetAtTime(0.0001, t + 0.005, 0.1);
    this.osc("sawtooth", f, t, end, 5).connect(lp);
    this.osc("triangle", f, t, end, -4).connect(lp);
    lp.connect(g).connect(out);
  }

  chord_organ(t, dur, m, v, out) {
    const f = freq(m);
    const end = t + 0.5;
    const g = this.gain();
    g.gain.setValueAtTime(v * 0.34, t);
    g.gain.setTargetAtTime(v * 0.1, t + 0.01, 0.05);
    g.gain.setTargetAtTime(0.0001, t + Math.max(dur, 0.1), 0.03);
    [[1, 1], [2, 0.55], [3, 0.36], [4, 0.18], [6, 0.08]].forEach(([ratio, amp]) => {
      const h = this.gain(amp);
      this.osc("sine", f * ratio, t, end).connect(h).connect(g);
    });
    g.connect(out);
  }

  chord_supersawGate(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.max(dur * 0.62, 0.05);
    const end = t + len + 0.1;
    const lp = this.filter("lowpass", 6500, 0.7);
    const g = this.gain();
    this.shape(g.gain, t, v * 0.24, 0.002, 0.05, 0.75, len, 0.022);
    [-18, -7, 0, 7, 18].forEach((d) => this.osc("sawtooth", f, t, end, d).connect(lp));
    lp.connect(g).connect(out);
  }

  // ---- lead and arp voices

  fm(t, dur, f, v, out, { ratio, index, decay, sustain, release, pan = 0, detune = 0 }) {
    const len = Math.max(dur, 0.08);
    const end = t + len + release * 2.5;
    const car = this.osc("sine", f, t, end, detune);
    const mod = this.osc("sine", f * ratio, t, end);
    const depth = this.gain();
    depth.gain.setValueAtTime(f * index, t);
    depth.gain.setTargetAtTime(f * index * 0.08, t, decay / 2);
    mod.connect(depth).connect(car.frequency);
    const g = this.gain();
    this.shape(g.gain, t, v, 0.003, decay, sustain, len, release);
    let node = car.connect(g);
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out);
  }

  lead_fmBell(t, dur, m, v, out, pan) {
    this.fm(t, dur, freq(m), v * 0.72, out, { ratio: 2, index: 4.2, decay: 0.5, sustain: 0.34, release: 0.34, pan });
  }

  lead_glass(t, dur, m, v, out, pan) {
    this.fm(t, Math.min(dur, 0.12), freq(m), v * 0.7, out, { ratio: 4, index: 2.4, decay: 0.2, sustain: 0.12, release: 0.24, pan });
  }

  lead_musicBox(t, dur, m, v, out, pan) {
    this.fm(t, Math.min(dur, 0.1), freq(m + 12), v * 0.5, out, { ratio: 3.5, index: 2.2, decay: 0.34, sustain: 0.07, release: 0.9, pan });
  }

  lead_rhodes(t, dur, m, v, out, pan) {
    this.fm(t, dur, freq(m), v * 0.72, out, { ratio: 1, index: 2.6, decay: 0.32, sustain: 0.4, release: 0.2, pan });
  }

  lead_whistle(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.max(dur * 0.95, 0.1);
    const end = t + len + 0.3;
    const a = this.osc("triangle", f, t, end);
    a.frequency.setValueAtTime(f * 0.97, t);
    a.frequency.linearRampToValueAtTime(f, t + 0.035);
    const lfo = this.osc("sine", 5.6, t, end);
    const depth = this.gain(0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(11, t + 0.25);
    lfo.connect(depth).connect(a.detune);
    const g = this.gain();
    this.shape(g.gain, t, v * 0.72, 0.012, 0.1, 0.8, len, 0.07);
    const sine = this.gain(0.5);
    this.osc("sine", f * 2, t, end).connect(this.filter("lowpass", 3000)).connect(sine).connect(g);
    a.connect(g).connect(out);
  }

  lead_softSaw(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.max(dur * 0.95, 0.12);
    const end = t + len + 0.4;
    const lp = this.filter("lowpass", 1600, 1);
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.setTargetAtTime(2600, t, 0.2);
    const g = this.gain();
    this.shape(g.gain, t, v * 0.42, 0.012, 0.2, 0.75, len, 0.12);
    const lfo = this.osc("sine", 5.1, t, end);
    const depth = this.gain(8);
    lfo.connect(depth);
    [-6, 6].forEach((d) => {
      const o = this.osc("sawtooth", f, t, end, d);
      depth.connect(o.detune);
      o.connect(lp);
    });
    lp.connect(g).connect(out);
  }

  lead_supersaw(t, dur, m, v, out) {
    const f = freq(m);
    const len = Math.max(dur * 0.95, 0.1);
    const end = t + len + 0.3;
    const lp = this.filter("lowpass", 4200, 0.8);
    lp.frequency.setValueAtTime(9000, t);
    lp.frequency.setTargetAtTime(5200, t, 0.18);
    const g = this.gain();
    this.shape(g.gain, t, v * 0.26, 0.004, 0.14, 0.82, len, 0.09);
    [-22, -11, -4, 4, 11, 22].forEach((d) => this.osc("sawtooth", f, t, end, d).connect(lp));
    this.osc("sawtooth", f / 2, t, end).connect(this.gain(0.5)).connect(lp);
    lp.connect(g).connect(out);
  }

  lead_pluck(t, dur, m, v, out, pan) {
    const f = freq(m);
    const end = t + 0.4;
    const lp = this.filter("lowpass", 1000, 2);
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.setTargetAtTime(700, t, 0.06);
    const g = this.gain();
    g.gain.setValueAtTime(v * 0.45, t);
    g.gain.setTargetAtTime(0.0001, t + 0.004, 0.07);
    this.osc("sawtooth", f, t, end, 6).connect(lp);
    this.osc("square", f, t, end, -6).connect(this.gain(0.5)).connect(lp);
    let node = lp.connect(g);
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out);
  }
}

/** Every note in the piece, in time order. */
export function eventsOf(piece) {
  const all = [];
  for (const track of TRACKS) {
    for (const note of piece.tracks[track] ?? []) all.push({ track, note });
  }
  all.sort((a, b) => a.note.s - b.note.s);
  return all;
}

export function lengthSeconds(piece) {
  return ((piece.bars * piece.stepsPerBar) / (piece.bpm * 4)) * 60;
}

/** Live playback: schedules a little ahead of the clock, so timing stays tight. */
export class Player {
  constructor() {
    this.ctx = null;
    this.engine = null;
    this.piece = null;
    this.mix = null;
    this.playing = false;
    this.loop = true;
    this.position = 0;
    this.timer = null;
  }

  ensureContext() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return this.ctx;
  }

  load(piece, mix) {
    const wasPlaying = this.playing;
    this.stop();
    this.piece = piece;
    this.mix = mix;
    this.events = eventsOf(piece);
    this.totalSteps = piece.bars * piece.stepsPerBar;
    this.engine = null;
    this.position = 0;
    return wasPlaying;
  }

  build() {
    const ctx = this.ensureContext();
    if (this.engine) {
      try {
        this.engine.output.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.engine = new Engine(ctx, this.piece, this.mix);
  }

  async start(fromStep = this.position) {
    if (!this.piece) return;
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.build();
    this.position = fromStep;
    this.anchor = ctx.currentTime + 0.08 - this.engine.stepSeconds * fromStep;
    this.cursor = this.events.findIndex((e) => e.note.s >= fromStep);
    if (this.cursor < 0) this.cursor = this.events.length;
    this.playing = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30);
  }

  tick() {
    const { ctx, engine } = this;
    const horizon = ctx.currentTime + 0.22;
    for (;;) {
      if (this.cursor >= this.events.length) {
        const endTime = this.anchor + this.totalSteps * engine.stepSeconds;
        if (horizon < endTime) return;
        if (!this.loop) {
          if (ctx.currentTime >= endTime) {
            this.pause();
            this.position = 0;
            this.onEnd?.();
          }
          return;
        }
        this.anchor = endTime;
        this.cursor = 0;
        continue;
      }
      const e = this.events[this.cursor];
      if (this.anchor + engine.stepTime(e.note.s) > horizon) return;
      engine.play(e.track, e.note, this.anchor);
      this.cursor++;
    }
  }

  pause() {
    if (!this.playing) return;
    this.position = this.currentStep();
    this.playing = false;
    clearInterval(this.timer);
    if (this.engine) {
      const out = this.engine.output;
      out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.012);
      const old = this.engine;
      setTimeout(() => {
        try {
          old.output.disconnect();
        } catch {
          /* already gone */
        }
      }, 120);
      this.engine = null;
    }
  }

  stop() {
    this.pause();
    this.position = 0;
  }

  seek(step) {
    const was = this.playing;
    this.pause();
    this.position = Math.max(0, Math.min(this.totalSteps - 0.01, step));
    if (was) this.start(this.position);
  }

  currentStep() {
    if (!this.playing || !this.engine) return this.position;
    const raw = (this.ctx.currentTime - this.anchor) / this.engine.stepSeconds;
    return Math.max(0, raw % this.totalSteps);
  }

  setGain(track, value) {
    this.mix[track] = value;
    this.engine?.setTrackGain(track, value);
  }
}

/** Renders the whole piece to an AudioBuffer, faster than real time. */
export async function renderOffline(piece, mix, sampleRate = 44100) {
  const tail = 3;
  const length = Math.ceil((lengthSeconds(piece) + tail) * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const engine = new Engine(ctx, piece, mix);
  for (const { track, note } of eventsOf(piece)) engine.play(track, note, 0.02);
  return ctx.startRendering();
}

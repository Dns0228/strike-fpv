export type GameAudio = {
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  props: (throttle: number) => void;
  shot: () => void;
  explode: (size: number) => void;
  hit: () => void;
  lock: () => void;
  warning: () => void;
  crash: () => void;
  dispose: () => void;
};

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let propGain: GainNode | null = null;
  let propOsc: OscillatorNode | null = null;
  let propOsc2: OscillatorNode | null = null;
  let muted = false;
  let lastLock = 0;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    sfx = ctx.createGain();
    propGain = ctx.createGain();
    sfx.gain.value = 0.7;
    propGain.gain.value = 0;
    master.gain.value = muted ? 0 : 0.55;
    sfx.connect(master);
    propGain.connect(master);
    master.connect(ctx.destination);

    propOsc = ctx.createOscillator();
    propOsc2 = ctx.createOscillator();
    propOsc.type = "sawtooth";
    propOsc2.type = "triangle";
    propOsc.frequency.value = 70;
    propOsc2.frequency.value = 140;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 420;
    propOsc.connect(filt);
    propOsc2.connect(filt);
    filt.connect(propGain);
    propOsc.start();
    propOsc2.start();
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c.state === "suspended") void c.resume();
  }

  function env(gain: GainNode, t: number, a: number, d: number, peak = 1) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function noiseBuffer(duration: number) {
    const c = ensure();
    const n = Math.floor(c.sampleRate * duration);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  return {
    unlock,
    setMuted: (m) => {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ensure().currentTime, 0.03);
    },
    props: (throttle) => {
      if (!ctx || !propGain || !propOsc || !propOsc2) return;
      const t = ctx.currentTime;
      const level = Math.max(0, throttle) * 0.12;
      propGain.gain.setTargetAtTime(level, t, 0.08);
      propOsc.frequency.setTargetAtTime(55 + throttle * 90, t, 0.08);
      propOsc2.frequency.setTargetAtTime(110 + throttle * 160, t, 0.08);
    },
    shot: () => {
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.12);
      env(g, t, 0.005, 0.12, 0.22);
      osc.connect(g);
      g.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.14);
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.08);
      const ng = c.createGain();
      env(ng, t, 0.002, 0.07, 0.18);
      src.connect(ng);
      ng.connect(sfx!);
      src.start(t);
    },
    explode: (size) => {
      const c = ensure();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.55);
      const filt = c.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(900 + size * 200, t);
      filt.frequency.exponentialRampToValueAtTime(80, t + 0.45);
      const g = c.createGain();
      env(g, t, 0.008, 0.5, 0.28 + size * 0.12);
      src.connect(filt);
      filt.connect(g);
      g.connect(sfx!);
      src.start(t);
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.exponentialRampToValueAtTime(28, t + 0.4);
      const og = c.createGain();
      env(og, t, 0.01, 0.42, 0.35);
      osc.connect(og);
      og.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.45);
    },
    hit: () => {
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880 + Math.random() * 80, t);
      osc.frequency.exponentialRampToValueAtTime(240, t + 0.07);
      env(g, t, 0.002, 0.08, 0.2);
      osc.connect(g);
      g.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.1);
    },
    lock: () => {
      const now = performance.now();
      if (now - lastLock < 700) return;
      lastLock = now;
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1240, t);
      env(g, t, 0.002, 0.05, 0.08);
      osc.connect(g);
      g.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.06);
    },
    warning: () => {
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(640, t);
      env(g, t, 0.004, 0.18, 0.12);
      osc.connect(g);
      g.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.2);
    },
    crash: () => {
      const c = ensure();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.35);
      const g = c.createGain();
      env(g, t, 0.004, 0.3, 0.3);
      src.connect(g);
      g.connect(sfx!);
      src.start(t);
    },
    dispose: () => {
      try {
        propOsc?.stop();
        propOsc2?.stop();
        void ctx?.close();
      } catch {
        /* ignore */
      }
      ctx = null;
    },
  };
}

export type GameAudio = {
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  props: (throttle: number) => void;
  engine: (amount: number) => void;
  buzz: (amount: number) => void;
  step: () => void;
  shot: () => void;
  explode: (size: number) => void;
  hit: () => void;
  lock: () => void;
  warning: () => void;
  crash: () => void;
  scan: () => void;
  extract: () => void;
  rumble: (ms: number, strong?: number) => void;
  flak: () => void;
  radio: () => void;
  farBoom: () => void;
  dispose: () => void;
};

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let propGain: GainNode | null = null;
  let engineGain: GainNode | null = null;
  let buzzGain: GainNode | null = null;
  let propOsc: OscillatorNode | null = null;
  let propOsc2: OscillatorNode | null = null;
  let engineOsc: OscillatorNode | null = null;
  let buzzOsc: OscillatorNode | null = null;
  let muted = false;
  let lastLock = 0;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    sfx = ctx.createGain();
    propGain = ctx.createGain();
    engineGain = ctx.createGain();
    buzzGain = ctx.createGain();
    sfx.gain.value = 0.7;
    propGain.gain.value = 0;
    engineGain.gain.value = 0;
    buzzGain.gain.value = 0;
    master.gain.value = muted ? 0 : 0.55;
    sfx.connect(master);
    propGain.connect(master);
    engineGain.connect(master);
    buzzGain.connect(master);
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

    engineOsc = ctx.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 42;
    const eFilt = ctx.createBiquadFilter();
    eFilt.type = "lowpass";
    eFilt.frequency.value = 180;
    engineOsc.connect(eFilt);
    eFilt.connect(engineGain);
    engineOsc.start();

    buzzOsc = ctx.createOscillator();
    buzzOsc.type = "square";
    buzzOsc.frequency.value = 90;
    const bFilt = ctx.createBiquadFilter();
    bFilt.type = "bandpass";
    bFilt.frequency.value = 320;
    bFilt.Q.value = 2.4;
    buzzOsc.connect(bFilt);
    bFilt.connect(buzzGain);
    buzzOsc.start();
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

  function rumblePad(ms: number, strong: number) {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    let list: (Gamepad | null)[] = [];
    try {
      list = navigator.getGamepads();
    } catch {
      return;
    }
    const mag = Math.max(0, Math.min(1, strong));
    for (const p of list) {
      const act = p?.vibrationActuator as GamepadHapticActuator | undefined;
      if (!act || typeof act.playEffect !== "function") continue;
      void act.playEffect("dual-rumble", {
        startDelay: 0,
        duration: ms,
        weakMagnitude: mag * 0.55,
        strongMagnitude: mag,
      });
    }
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
    engine: (amount) => {
      if (!ctx || !engineGain || !engineOsc) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(Math.max(0, amount) * 0.16, t, 0.1);
      engineOsc.frequency.setTargetAtTime(36 + amount * 70, t, 0.1);
    },
    buzz: (amount) => {
      if (!ctx || !buzzGain || !buzzOsc) return;
      const t = ctx.currentTime;
      buzzGain.gain.setTargetAtTime(Math.max(0, amount) * 0.09, t, 0.12);
      buzzOsc.frequency.setTargetAtTime(70 + amount * 140, t, 0.12);
    },
    step: () => {
      const c = ensure();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.08);
      const filt = c.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 420 + Math.random() * 180;
      const g = c.createGain();
      env(g, t, 0.002, 0.07, 0.12 + Math.random() * 0.05);
      src.connect(filt);
      filt.connect(g);
      g.connect(sfx!);
      src.start(t);
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
      rumblePad(220 + size * 80, 0.4 + size * 0.2);
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
      rumblePad(40, 0.18);
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
      rumblePad(280, 0.85);
    },
    scan: () => {
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(1480, t + 0.22);
      env(g, t, 0.01, 0.28, 0.12);
      osc.connect(g);
      g.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.32);
      const osc2 = c.createOscillator();
      const g2 = c.createGain();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(240, t);
      osc2.frequency.exponentialRampToValueAtTime(80, t + 0.18);
      env(g2, t, 0.004, 0.2, 0.08);
      osc2.connect(g2);
      g2.connect(sfx!);
      osc2.start(t);
      osc2.stop(t + 0.22);
      rumblePad(90, 0.2);
    },
    extract: () => {
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.18);
      env(g, t, 0.01, 0.35, 0.16);
      osc.connect(g);
      g.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.4);
      const osc2 = c.createOscillator();
      const g2 = c.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(220, t);
      osc2.frequency.exponentialRampToValueAtTime(110, t + 0.4);
      env(g2, t, 0.02, 0.42, 0.14);
      osc2.connect(g2);
      g2.connect(sfx!);
      osc2.start(t);
      osc2.stop(t + 0.45);
      rumblePad(220, 0.35);
    },
    flak: () => {
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(980, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.09);
      env(g, t, 0.002, 0.1, 0.2);
      osc.connect(g);
      g.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.12);
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.12);
      const filt = c.createBiquadFilter();
      filt.type = "highpass";
      filt.frequency.value = 900;
      const ng = c.createGain();
      env(ng, t, 0.001, 0.1, 0.22);
      src.connect(filt);
      filt.connect(ng);
      ng.connect(sfx!);
      src.start(t);
      rumblePad(70, 0.35);
    },
    radio: () => {
      const c = ensure();
      const t = c.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "square";
        osc.frequency.value = 380 + i * 70 + (i === 1 ? 120 : 0);
        env(g, t + i * 0.09, 0.004, 0.07, 0.045);
        osc.connect(g);
        g.connect(sfx!);
        osc.start(t + i * 0.09);
        osc.stop(t + i * 0.09 + 0.09);
      }
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.32);
      const filt = c.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.value = 1400;
      filt.Q.value = 1.6;
      const ng = c.createGain();
      env(ng, t, 0.02, 0.28, 0.04);
      src.connect(filt);
      filt.connect(ng);
      ng.connect(sfx!);
      src.start(t);
    },
    farBoom: () => {
      const c = ensure();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.7);
      const filt = c.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(220, t);
      filt.frequency.exponentialRampToValueAtTime(50, t + 0.55);
      const g = c.createGain();
      env(g, t, 0.02, 0.62, 0.14);
      src.connect(filt);
      filt.connect(g);
      g.connect(sfx!);
      src.start(t);
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(48, t);
      osc.frequency.exponentialRampToValueAtTime(22, t + 0.5);
      const og = c.createGain();
      env(og, t, 0.03, 0.5, 0.12);
      osc.connect(og);
      og.connect(sfx!);
      osc.start(t);
      osc.stop(t + 0.55);
    },
    rumble: (ms, strong = 0.45) => rumblePad(ms, strong),
    dispose: () => {
      try {
        propOsc?.stop();
        propOsc2?.stop();
        engineOsc?.stop();
        buzzOsc?.stop();
        void ctx?.close();
      } catch {
        /* ignore */
      }
      ctx = null;
    },
  };
}

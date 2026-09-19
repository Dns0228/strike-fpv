export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function expDamp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

export function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function hash2(ix: number, iz: number): number {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

export function fbm(x: number, z: number): number {
  let v = 0;
  let a = 0.55;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    v += valueNoise(x * f, z * f) * a;
    a *= 0.5;
    f *= 2.03;
  }
  return v;
}

export function radialDeadzone(x: number, y: number, dz = 0.16): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

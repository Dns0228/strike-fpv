export type VisionMode = "off" | "thermal" | "nv";

export const VISION_LABEL: Record<VisionMode, string> = {
  off: "глаз",
  thermal: "тепло",
  nv: "ПНВ",
};

export function nextVision(v: VisionMode): VisionMode {
  if (v === "off") return "thermal";
  if (v === "thermal") return "nv";
  return "off";
}

export function parseVision(raw: unknown): VisionMode {
  if (raw === "thermal" || raw === "nv" || raw === "off") return raw;
  return "off";
}

export type Armor = "soft" | "light" | "heavy";
export type WeaponId = "frag" | "he" | "ap";
export type GameMode = "free" | "arcade" | "assault";
export type GroundUnit = "soldier" | "jeep";
export type TargetKind =
  | "infantry"
  | "jeep"
  | "truck"
  | "ifv"
  | "radar"
  | "bunker"
  | "fuel"
  | "sam";

export type WeaponDef = {
  id: WeaponId;
  name: string;
  short: string;
  blurb: string;
  baseDamage: number;
  fireRate: number;
  ammo: number;
  speed: number;
  splash: number;
  color: number;
  vs: Record<Armor, number>;
};

export type TargetDef = {
  kind: TargetKind;
  label: string;
  armor: Armor;
  hp: number;
  score: number;
  radius: number;
  height: number;
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  frag: {
    id: "frag",
    name: "Осколочная",
    short: "ОСК",
    blurb: "Рой готовых осколков. Режет расчёты и РЛС, почти бесполезна по бетону.",
    baseDamage: 28,
    fireRate: 3.4,
    ammo: 30,
    speed: 96,
    splash: 4.2,
    color: 0xc5cbb8,
    vs: { soft: 1.6, light: 0.82, heavy: 0.3 },
  },
  he: {
    id: "he",
    name: "ОФ ударная",
    short: "ОФ",
    blurb: "Фугас с осколочной рубашкой. Универсальный удар по технике и укрытиям.",
    baseDamage: 82,
    fireRate: 1.35,
    ammo: 10,
    speed: 72,
    splash: 9.5,
    color: 0xb9b6a8,
    vs: { soft: 1.08, light: 1.0, heavy: 0.88 },
  },
  ap: {
    id: "ap",
    name: "Бронебойная",
    short: "ББ",
    blurb: "Кумулятивное ядро. Ломает БМП и бункеры, слабо работает по живой силе.",
    baseDamage: 118,
    fireRate: 1.05,
    ammo: 8,
    speed: 118,
    splash: 2.2,
    color: 0x8d9388,
    vs: { soft: 0.4, light: 1.08, heavy: 1.78 },
  },
};

export const WEAPON_ORDER: WeaponId[] = ["frag", "he", "ap"];

export const KAMIKAZE = {
  name: "Камикадзе",
  short: "КДЗ",
  baseDamage: 480,
  splash: 18,
  vs: { soft: 1.18, light: 1.22, heavy: 1.28 } as Record<Armor, number>,
};

export const TARGETS: Record<TargetKind, TargetDef> = {
  infantry: {
    kind: "infantry",
    label: "Расчёт ПЗРК",
    armor: "soft",
    hp: 26,
    score: 90,
    radius: 1.1,
    height: 1.8,
  },
  jeep: {
    kind: "jeep",
    label: "Пикап",
    armor: "light",
    hp: 72,
    score: 160,
    radius: 2.2,
    height: 1.6,
  },
  truck: {
    kind: "truck",
    label: "Грузовик БК",
    armor: "light",
    hp: 110,
    score: 220,
    radius: 3.1,
    height: 2.4,
  },
  ifv: {
    kind: "ifv",
    label: "БМП",
    armor: "heavy",
    hp: 210,
    score: 420,
    radius: 3.4,
    height: 2.2,
  },
  radar: {
    kind: "radar",
    label: "РЛС",
    armor: "soft",
    hp: 88,
    score: 280,
    radius: 2.4,
    height: 6.5,
  },
  bunker: {
    kind: "bunker",
    label: "Командный бункер",
    armor: "heavy",
    hp: 340,
    score: 560,
    radius: 4.6,
    height: 3.2,
  },
  fuel: {
    kind: "fuel",
    label: "Топливный склад",
    armor: "light",
    hp: 96,
    score: 300,
    radius: 2.8,
    height: 3.4,
  },
  sam: {
    kind: "sam",
    label: "ЗРК",
    armor: "heavy",
    hp: 250,
    score: 480,
    radius: 3.6,
    height: 2.8,
  },
};

export const ARMOR_LABEL: Record<Armor, string> = {
  soft: "мягкая",
  light: "лёгкая",
  heavy: "тяжёлая",
};

export function expectedDamage(base: number, vs: Record<Armor, number>, armor: Armor): number {
  return Math.round(base * vs[armor]);
}

export const BEST_SCORE_KEY = "strikefpv-2-best";
export const BEST_GROUND_KEY = "strikefpv-2-best-ground";
export const SETTINGS_KEY = "strikefpv-2-settings";

export const WORLD_SIZE = 420;
export const DRONE_LIVES = 3;
export const BATTERY_MAX = 100;

/** Existing trench in the heightmap. Friendly z > FRONT_Z, enemy z < FRONT_Z. */
export const FRONT_Z = -40;
export const FRIENDLY = { x: -18, z: 16 };
export const GROUND_START = { x: -14, z: 38 };
/** Assault: reach the front line, not the far rear. */
export const ASSAULT_GOAL = { x: 18, z: -40, r: 12 };
export const EXTRACTION = ASSAULT_GOAL;

export const ROAD_PATHS: Array<Array<[number, number]>> = [
  [
    [-48, 58],
    [-28, 46],
    [-16, 40],
    [-10, 28],
    [-2, 16],
    [4, 4],
    [10, -10],
    [14, -24],
    [18, -40],
    [24, -56],
  ],
  [
    [-10, 28],
    [6, 18],
    [20, 10],
    [36, 4],
  ],
  [
    [4, 4],
    [-8, -2],
    [-22, 8],
  ],
];

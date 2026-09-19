import { create } from "zustand";
import type { Armor, TargetKind, WeaponId } from "./catalog";
import { SETTINGS_KEY, WEAPONS } from "./catalog";

export type Phase = "hangar" | "flight" | "pause" | "dead" | "victory";

export type LockInfo = {
  label: string;
  kind: TargetKind;
  armor: Armor;
  hp: number;
  maxHp: number;
  dist: number;
  screenX: number;
  screenY: number;
  expected: number;
  weapon: WeaponId;
};

export type FloatText = {
  id: number;
  text: string;
  x: number;
  y: number;
  born: number;
  kind: "hit" | "kill" | "info";
};

export type RadarBlip = {
  id: number;
  x: number;
  z: number;
  armor: Armor;
  alive: boolean;
};

export type GameHud = {
  phase: Phase;
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  lives: number;
  battery: number;
  altitude: number;
  speed: number;
  heading: number;
  score: number;
  best: number;
  destroyed: number;
  totalTargets: number;
  lock: LockInfo | null;
  floats: FloatText[];
  hitFlash: number;
  message: string;
  invertY: boolean;
  shake: boolean;
  muted: boolean;
  blips: RadarBlip[];
  droneX: number;
  droneZ: number;
  patch: (partial: Partial<Omit<GameHud, "patch">>) => void;
};

function emptyAmmo(): Record<WeaponId, number> {
  return {
    frag: WEAPONS.frag.ammo,
    he: WEAPONS.he.ammo,
    ap: WEAPONS.ap.ammo,
  };
}

function persistSettings() {
  if (typeof localStorage === "undefined") return;
  const st = useGameStore.getState();
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ invertY: st.invertY, muted: st.muted, shake: st.shake }),
  );
}

export function loadSettings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as { invertY?: boolean; muted?: boolean; shake?: boolean };
    useGameStore.getState().patch({
      invertY: !!s.invertY,
      muted: !!s.muted,
      shake: s.shake !== false,
    });
  } catch {
    /* ignore */
  }
}

export const useGameStore = create<GameHud>((set) => ({
  phase: "hangar",
  weapon: "he",
  ammo: emptyAmmo(),
  lives: 3,
  battery: 100,
  altitude: 0,
  speed: 0,
  heading: 0,
  score: 0,
  best: 0,
  destroyed: 0,
  totalTargets: 0,
  lock: null,
  floats: [],
  hitFlash: 0,
  message: "",
  invertY: false,
  shake: true,
  muted: false,
  blips: [],
  droneX: 0,
  droneZ: 0,
  patch: (partial) => {
    set(partial);
    if ("invertY" in partial || "muted" in partial || "shake" in partial) persistSettings();
  },
}));

export function refillAmmo(): Record<WeaponId, number> {
  return emptyAmmo();
}

import { create } from "zustand";
import type { Armor, TargetKind, WeaponId } from "./catalog";
import { WEAPONS } from "./catalog";

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
  patch: (partial: Partial<Omit<GameHud, "patch">>) => void;
};

function emptyAmmo(): Record<WeaponId, number> {
  return {
    frag: WEAPONS.frag.ammo,
    he: WEAPONS.he.ammo,
    ap: WEAPONS.ap.ammo,
  };
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
  patch: (partial) => set(partial),
}));

export function refillAmmo(): Record<WeaponId, number> {
  return emptyAmmo();
}

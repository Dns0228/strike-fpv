import type { GameMode, GroundUnit } from "./catalog";

/** Seat the player occupies. FPV modes share flight physics; assault is chase-cam. */
export type Seat = "fpv" | "ground";

export type ModeDef = {
  id: GameMode;
  title: string;
  short: string;
  blurb: string;
  start: string;
  seat: Seat;
  /** What ends the sortie. */
  win: "none" | "hold-line" | "reach-line";
};

export const MODES: Record<GameMode, ModeDef> = {
  free: {
    id: "free",
    title: "Свободный полёт",
    short: "Полёт",
    blurb: "Полигон без задачи. Ветер, скан, тепловизор, автоприцел, три БЧ.",
    start: "В воздух",
    seat: "fpv",
    win: "none",
  },
  arcade: {
    id: "arcade",
    title: "Аркада",
    short: "Оборона",
    blurb: "FPV на линии. Скан, автоприцел, тепловизор. Режьте пехоту и грузовики, пока не прорвали фронт.",
    start: "На оборону",
    seat: "fpv",
    win: "hold-line",
  },
  assault: {
    id: "assault",
    title: "Штурм",
    short: "Прорыв",
    blurb: "Солдат или пикап от третьего лица. Дойти до ленты, прячась от охотничьих FPV — у них лучи, пеленг на компасе. T слух, N тепло.",
    start: "На штурм",
    seat: "ground",
    win: "reach-line",
  },
};

export const MODE_ORDER: GameMode[] = ["free", "arcade", "assault"];

export function isFpvSeat(mode: GameMode): boolean {
  return MODES[mode].seat === "fpv";
}

export function isGroundSeat(mode: GameMode): boolean {
  return MODES[mode].seat === "ground";
}

export function parseMode(raw: unknown): GameMode {
  if (raw === "free" || raw === "arcade" || raw === "assault") return raw;
  if (raw === "ground") return "assault";
  if (raw === "fpv") return "arcade";
  return "arcade";
}

export const ARCADE_WAVES = 3;
export const ARCADE_BREACH_MAX = 3;

export const UNIT_LABEL: Record<GroundUnit, string> = {
  soldier: "солдат",
  jeep: "пикап",
};

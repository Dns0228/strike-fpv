import type { ReactNode } from "react";
import { VISION_LABEL, nextVision } from "@/game/catalog";
import { isGroundSeat } from "@/game/modes";
import { useGameStore } from "@/game/store";

type Props = {
  onResume: () => void;
  onRestart: () => void;
  onNext: () => void;
  onHangar: () => void;
};

export function Overlays({ onResume, onRestart, onNext, onHangar }: Props) {
  const phase = useGameStore((s) => s.phase);
  const mode = useGameStore((s) => s.mode);
  const score = useGameStore((s) => s.score);
  const best = useGameStore((s) => s.best);
  const bestGround = useGameStore((s) => s.bestGround);
  const lives = useGameStore((s) => s.lives);
  const invertY = useGameStore((s) => s.invertY);
  const muted = useGameStore((s) => s.muted);
  const tod = useGameStore((s) => s.tod);
  const autoaim = useGameStore((s) => s.autoaim);
  const vision = useGameStore((s) => s.vision);
  const wave = useGameStore((s) => s.wave);
  const breaches = useGameStore((s) => s.breaches);
  const patch = useGameStore((s) => s.patch);
  const ground = isGroundSeat(mode);
  const arcade = mode === "arcade";

  if (phase === "hangar" || phase === "flight" || phase === "replay") return null;

  const lostDrone = phase === "dead" && lives > 0 && !ground;
  const win = phase === "victory";
  const paused = phase === "pause";

  const title = paused
    ? "Пауза"
    : win
      ? ground
        ? "Линия взята"
        : arcade
          ? "Линия удержана"
          : "Полёт окончен"
      : lostDrone
        ? "Дрон потерян"
        : ground
          ? "Группа накрыта"
          : arcade
            ? "Прорыв линии"
            : "Вылет сорван";

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/55 p-4 backdrop-blur-[2px] short:p-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 short:p-4 short:max-h-[min(100dvh,22rem)] short:overflow-y-auto">
        <p className="font-mono text-[10px] tracking-[0.22em] text-hud-dim uppercase">STRIKE FPV 2.0</p>
        <h2 className="font-display mt-2 text-3xl font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm text-muted">
          {win
            ? ground
              ? "Вы вышли на линию фронта. FPV не успел."
              : arcade
                ? "Три волны отбиты. Ленту не пересекли."
                : "Свободный полёт можно повторить с другой БЧ."
            : lostDrone
              ? "Есть запасной борт. Смените боевую часть, если броня не берётся."
              : paused
                ? "Мир заморожен. WASD не сбрасывается — проверьте стики."
                : ground
                  ? "Охотничий FPV нашёл вас в открытом поле. Прячьтесь под кронами."
                  : arcade
                    ? "Слишком много групп пересекли красную ленту."
                    : "Батарея или столкновение. Можно сразу в воздух."}
        </p>

        <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Mini k="Счёт" v={String(score)} />
          <Mini
            k={ground ? "Режим" : arcade ? "Волна" : "Режим"}
            v={ground ? "штурм" : arcade ? `${wave} · прорыв ${breaches}` : "полёт"}
          />
          <Mini k="Рекорд" v={String(ground ? bestGround : best)} />
        </dl>

        {paused ? (
          <label className="mt-4 flex items-center gap-2 text-xs text-subtle">
            <input
              type="checkbox"
              checked={invertY}
              onChange={(e) => patch({ invertY: e.target.checked })}
              className="size-3.5 accent-hud"
            />
            Инверсия оси Y
          </label>
        ) : null}
        {paused ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-subtle">
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => patch({ muted: e.target.checked })}
              className="size-3.5 accent-hud"
            />
            Без звука
          </label>
        ) : null}
        {paused ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-subtle">
            <input
              type="checkbox"
              checked={tod === "night"}
              onChange={(e) => patch({ tod: e.target.checked ? "night" : "day" })}
              className="size-3.5 accent-hud"
            />
            Ночь
          </label>
        ) : null}
        {paused && !ground ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-subtle">
            <input
              type="checkbox"
              checked={autoaim}
              onChange={(e) => patch({ autoaim: e.target.checked })}
              className="size-3.5 accent-hud"
            />
            Автоприцел
          </label>
        ) : null}
        {paused ? (
          <button
            type="button"
            className="mt-3 rounded-sm border border-border bg-bg px-2 py-1 font-mono text-[10px] tracking-widest uppercase text-muted"
            onClick={() => patch({ vision: nextVision(vision) })}
          >
            Оптика · {VISION_LABEL[vision]}
          </button>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          {paused ? (
            <Primary onClick={onResume}>Продолжить</Primary>
          ) : lostDrone ? (
            <Primary onClick={onNext}>Следующий борт</Primary>
          ) : (
            <Primary onClick={onRestart}>{ground ? "Ещё штурм" : arcade ? "Ещё оборона" : "Ещё полёт"}</Primary>
          )}
          <button
            type="button"
            onClick={onHangar}
            className="h-11 rounded-md border border-border bg-bg text-sm text-muted transition-opacity duration-150 hover:text-fg"
          >
            В ангар
          </button>
        </div>
      </div>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-2 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="font-mono text-sm tabular text-fg">{v}</dd>
    </div>
  );
}

function Primary({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-12 rounded-md bg-accent text-sm font-semibold text-accent-fg transition-transform duration-150 active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

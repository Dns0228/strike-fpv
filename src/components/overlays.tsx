import type { ReactNode } from "react";
import { useGameStore } from "@/game/store";

type Props = {
  onResume: () => void;
  onRestart: () => void;
  onNext: () => void;
  onHangar: () => void;
};

export function Overlays({ onResume, onRestart, onNext, onHangar }: Props) {
  const phase = useGameStore((s) => s.phase);
  const score = useGameStore((s) => s.score);
  const best = useGameStore((s) => s.best);
  const lives = useGameStore((s) => s.lives);
  const destroyed = useGameStore((s) => s.destroyed);
  const total = useGameStore((s) => s.totalTargets);
  const invertY = useGameStore((s) => s.invertY);
  const muted = useGameStore((s) => s.muted);
  const patch = useGameStore((s) => s.patch);

  if (phase === "hangar" || phase === "flight") return null;

  const lostDrone = phase === "dead" && lives > 0;
  const win = phase === "victory";
  const paused = phase === "pause";

  const title = paused
    ? "Пауза"
    : win
      ? "Полигон зачищен"
      : lostDrone
        ? "Дрон потерян"
        : "Вылет сорван";

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/55 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <p className="font-mono text-[10px] tracking-[0.22em] text-hud-dim uppercase">STRIKE FPV 2.0</p>
        <h2 className="font-display mt-2 text-3xl font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm text-muted">
          {win
            ? "Все цели поражены. Можно идти на второй круг с другой БЧ."
            : lostDrone
              ? "Есть запасной борт. Смените боевую часть, если броня не берётся."
              : paused
                ? "Мир заморожен. WASD не сбрасывается — проверьте стики."
                : "Батарея, столкновение или подрыв. Рекорд сохранён на этом устройстве."}
        </p>

        <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Mini k="Счёт" v={String(score)} />
          <Mini k="Цели" v={`${destroyed}/${total}`} />
          <Mini k="Рекорд" v={String(best)} />
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

        <div className="mt-5 flex flex-col gap-2">
          {paused ? (
            <Primary onClick={onResume}>Продолжить</Primary>
          ) : lostDrone ? (
            <Primary onClick={onNext}>Следующий борт</Primary>
          ) : (
            <Primary onClick={onRestart}>Повторный вылет</Primary>
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

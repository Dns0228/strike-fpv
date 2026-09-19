import { useCallback, useRef } from "react";
import type { GameHandle } from "@/game/engine";
import { useGameStore } from "@/game/store";

type Props = {
  game: GameHandle | null;
};

export function TouchControls({ game }: Props) {
  const phase = useGameStore((s) => s.phase);
  if (phase !== "flight") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 md:hidden">
      <Stick
        side="left"
        onChange={(x, y, a) => game?.input.setLeftStick(x, y, a)}
      />
      <Stick
        side="right"
        onChange={(x, y, a) => game?.input.setRightStick(x, y, a)}
      />
      <div className="pointer-events-auto absolute right-4 bottom-36 flex flex-col gap-3">
        <HoldButton label="Огонь" onHold={(v) => game?.input.setTouchFire(v)} primary />
        <HoldButton label="Подрыв" onHold={(v) => game?.input.setTouchDetonate(v)} />
      </div>
    </div>
  );
}

function Stick({
  side,
  onChange,
}: {
  side: "left" | "right";
  onChange: (x: number, y: number, active: boolean) => void;
}) {
  const origin = useRef({ x: 0, y: 0 });
  const pid = useRef<number | null>(null);

  const onDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      pid.current = e.pointerId;
      const r = e.currentTarget.getBoundingClientRect();
      origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      onChange(0, 0, true);
    },
    [onChange],
  );

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pid.current !== e.pointerId) return;
      const dx = (e.clientX - origin.current.x) / 48;
      const dy = (origin.current.y - e.clientY) / 48;
      const m = Math.hypot(dx, dy) || 1;
      const s = Math.min(1, m);
      onChange((dx / m) * s, (dy / m) * s, true);
    },
    [onChange],
  );

  const onUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pid.current !== e.pointerId) return;
      pid.current = null;
      onChange(0, 0, false);
    },
    [onChange],
  );

  return (
    <div
      className={`pointer-events-auto absolute bottom-8 size-28 rounded-full border border-border bg-surface/40 ${
        side === "left" ? "left-4" : "right-28"
      }`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ touchAction: "none" }}
    >
      <div className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-hud/40 bg-surface/60" />
    </div>
  );
}

function HoldButton({
  label,
  onHold,
  primary,
}: {
  label: string;
  onHold: (v: boolean) => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`h-14 min-w-14 rounded-md border px-3 font-mono text-[11px] tracking-widest uppercase ${
        primary ? "border-hud bg-hud/20 text-fg" : "border-danger/60 bg-surface/70 text-danger"
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
    >
      {label}
    </button>
  );
}

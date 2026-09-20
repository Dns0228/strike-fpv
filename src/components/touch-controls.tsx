import { useCallback, useRef, useState } from "react";
import type { GameHandle } from "@/game/engine";
import { isGroundSeat } from "@/game/modes";
import { useGameStore } from "@/game/store";

type Props = {
  game: GameHandle | null;
};

export function TouchControls({ game }: Props) {
  const phase = useGameStore((s) => s.phase);
  const mode = useGameStore((s) => s.mode);
  const unit = useGameStore((s) => s.unit);
  if (phase !== "flight") return null;
  const ground = isGroundSeat(mode);
  const jeep = ground && unit === "jeep";

  return (
    <div className="pointer-events-none absolute inset-0 z-20 hidden coarse:block [@media(hover:none)]:block max-[1100px]:block">
      <Stick
        side="left"
        label={ground ? "Ход" : "Полёт"}
        onChange={(x, y, a) => game?.input.setLeftStick(x, y, a)}
      />
      <Stick
        side="right"
        label={ground ? "Камера" : "Крен"}
        onChange={(x, y, a) => game?.input.setRightStick(x, y, a)}
      />
      <div className="pointer-events-auto absolute right-[max(0.6rem,env(safe-area-inset-right))] bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+5.5rem)] z-30 flex flex-col gap-2.5">
        {ground ? (
          <>
            <HoldButton
              label={jeep ? "Газ" : "Бег"}
              onHold={(v) => game?.input.setTouchBoost(v)}
              primary
            />
            {!jeep ? <HoldButton label="Сесть" onHold={(v) => game?.input.setTouchCrouch(v)} /> : null}
          </>
        ) : (
          <>
            <HoldButton label="Огонь" onHold={(v) => game?.input.setTouchFire(v)} primary />
            <TapButton label="Скан" onTap={() => game?.input.setTouchScan()} />
            <HoldButton label="Подрыв" onHold={(v) => game?.input.setTouchDetonate(v)} />
          </>
        )}
      </div>
    </div>
  );
}

function Stick({
  side,
  label,
  onChange,
}: {
  side: "left" | "right";
  label: string;
  onChange: (x: number, y: number, active: boolean) => void;
}) {
  const origin = useRef({ x: 0, y: 0 });
  const pid = useRef<number | null>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  const applyKnob = (nx: number, ny: number) => {
    const el = knobRef.current;
    if (!el) return;
    el.style.transform = `translate(calc(-50% + ${nx * 42}px), calc(-50% + ${-ny * 42}px))`;
  };

  const onDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      pid.current = e.pointerId;
      origin.current = { x: e.clientX, y: e.clientY };
      const pad = padRef.current;
      if (pad) {
        pad.style.position = "fixed";
        pad.style.left = `${e.clientX}px`;
        pad.style.top = `${e.clientY}px`;
        pad.style.right = "auto";
        pad.style.bottom = "auto";
        pad.style.transform = "translate(-50%, -50%)";
        pad.style.opacity = "1";
      }
      applyKnob(0, 0);
      setLive(true);
      onChange(0, 0, true);
    },
    [onChange],
  );

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pid.current !== e.pointerId) return;
      const dx = (e.clientX - origin.current.x) / 56;
      const dy = (origin.current.y - e.clientY) / 56;
      const m = Math.hypot(dx, dy) || 1;
      const s = Math.min(1, m);
      const nx = (dx / m) * s;
      const ny = (dy / m) * s;
      applyKnob(nx, ny);
      onChange(nx, ny, true);
    },
    [onChange],
  );

  const onUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pid.current !== e.pointerId) return;
      pid.current = null;
      applyKnob(0, 0);
      setLive(false);
      const pad = padRef.current;
      if (pad) {
        pad.style.position = "";
        pad.style.left = "";
        pad.style.top = "";
        pad.style.right = "";
        pad.style.bottom = "";
        pad.style.transform = "";
        pad.style.opacity = "";
      }
      onChange(0, 0, false);
    },
    [onChange],
  );

  return (
    <div
      className={`pointer-events-auto absolute top-14 bottom-0 ${
        side === "left" ? "left-0 w-[46%]" : "right-0 w-[46%]"
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
    >
      <div
        ref={padRef}
        className={`pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] size-[7.25rem] rounded-full border bg-surface/50 ${
          live ? "border-hud/80" : "border-border/90"
        } ${
          side === "left"
            ? "left-[max(1rem,env(safe-area-inset-left))]"
            : "right-[max(1rem,env(safe-area-inset-right))] left-auto"
        }`}
      >
        <div
          ref={knobRef}
          className="absolute left-1/2 top-1/2 size-12 rounded-full border border-hud/55 bg-hud/40"
          style={{ transform: "translate(-50%, -50%)" }}
        />
        <div className="absolute inset-x-0 -top-5 text-center font-mono text-[9px] tracking-[0.2em] text-hud-dim uppercase">
          {label}
        </div>
      </div>
    </div>
  );
}

function TapButton({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <button
      type="button"
      className="h-14 min-w-[3.5rem] rounded-md border border-border bg-surface/80 px-3 font-mono text-[11px] tracking-widest uppercase text-muted active:scale-95"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onTap();
      }}
    >
      {label}
    </button>
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
      className={`h-14 min-w-[3.5rem] rounded-md border px-3 font-mono text-[11px] tracking-widest uppercase active:scale-95 ${
        primary ? "border-hud bg-hud/25 text-fg" : "border-border bg-surface/80 text-muted"
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
    >
      {label}
    </button>
  );
}

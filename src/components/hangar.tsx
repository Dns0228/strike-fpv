import type { ReactNode } from "react";
import { Gauge, Shield, Truck, User, Zap } from "lucide-react";
import {
  ARMOR_LABEL,
  WEAPONS,
  WEAPON_ORDER,
  expectedDamage,
  type GameMode,
  type GroundUnit,
  type WeaponId,
} from "@/game/catalog";
import { MODE_ORDER, MODES, isGroundSeat } from "@/game/modes";
import { useGameStore } from "@/game/store";

const ARMORS = ["soft", "light", "heavy"] as const;

type Props = {
  onStart: () => void;
  ready: boolean;
};

export function Hangar({ onStart, ready }: Props) {
  const mode = useGameStore((s) => s.mode);
  const unit = useGameStore((s) => s.unit);
  const weapon = useGameStore((s) => s.weapon);
  const best = useGameStore((s) => s.best);
  const bestGround = useGameStore((s) => s.bestGround);
  const invertY = useGameStore((s) => s.invertY);
  const muted = useGameStore((s) => s.muted);
  const shake = useGameStore((s) => s.shake);
  const patch = useGameStore((s) => s.patch);
  const wpn = WEAPONS[weapon];
  const def = MODES[mode];
  const ground = isGroundSeat(mode);
  const arcade = mode === "arcade";

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:justify-center md:p-8 short:justify-center">
      <div className="pointer-events-auto w-full max-w-lg short:max-w-4xl rounded-xl border border-border bg-surface/92 p-4 shadow-2xl md:p-6 short:grid short:grid-cols-2 short:gap-x-6 short:gap-y-3 short:p-4 short:max-h-[min(100dvh,22rem)] short:overflow-y-auto">
        <div className="short:col-span-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-[0.22em] text-hud-dim uppercase">Полигон Дельта · линия фронта</p>
            <h1 className="font-display mt-1.5 text-4xl font-semibold leading-none text-fg short:text-3xl md:text-5xl">
              STRIKE FPV
            </h1>
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={!ready}
            className="hidden short:flex h-11 min-w-40 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg transition-transform duration-150 ease-out hover:opacity-95 active:scale-[0.98] disabled:opacity-50"
          >
            <Zap className="size-4" />
            {def.start}
          </button>
        </div>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted short:col-span-2 short:mt-0 short:line-clamp-2">{def.blurb}</p>

        <div>
        <div className="mt-4 grid grid-cols-3 gap-2 short:mt-0">
          {MODE_ORDER.map((id) => (
            <ModeCard
              key={id}
              id={id}
              active={mode === id}
              onPick={() => patch({ mode: id })}
            />
          ))}
        </div>
        </div>

        <div>
        {ground ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <UnitCard
              id="soldier"
              active={unit === "soldier"}
              icon={<User className="size-4" />}
              title="Солдат"
              blurb="Тише, можно присесть"
              onPick={() => patch({ unit: "soldier" })}
            />
            <UnitCard
              id="jeep"
              active={unit === "jeep"}
              icon={<Truck className="size-4" />}
              title="Пикап"
              blurb="Быстрее, заметнее"
              onPick={() => patch({ unit: "jeep" })}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {WEAPON_ORDER.map((id) => (
                <WeaponCard key={id} id={id} active={weapon === id} onPick={() => patch({ weapon: id })} />
              ))}
            </div>
            <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2.5 short:py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-hud">{wpn.short}</span>
                <span className="text-xs text-subtle">базовый урон {wpn.baseDamage}</span>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted short:hidden">{wpn.blurb}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                {ARMORS.map((a) => (
                  <div key={a} className="rounded-xs bg-bg px-2 py-1.5">
                    <div className="text-subtle">{ARMOR_LABEL[a]}</div>
                    <div className="text-hud tabular">{expectedDamage(wpn.baseDamage, wpn.vs, a)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center short:mt-3">
          {ground ? (
            <>
              <Stat icon={<User className="size-3.5" />} k="Цель" v="линия" />
              <Stat icon={<Shield className="size-3.5" />} k="Жизнь" v="1" />
              <Stat icon={<Gauge className="size-3.5" />} k="Рекорд" v={String(bestGround)} />
            </>
          ) : arcade ? (
            <>
              <Stat icon={<Shield className="size-3.5" />} k="Волны" v="3" />
              <Stat icon={<Shield className="size-3.5" />} k="Прорыв" v="3" />
              <Stat icon={<Gauge className="size-3.5" />} k="Рекорд" v={String(best)} />
            </>
          ) : (
            <>
              <Stat icon={<Shield className="size-3.5" />} k="Задача" v="нет" />
              <Stat icon={<User className="size-3.5" />} k="Борт" v="∞" />
              <Stat icon={<Gauge className="size-3.5" />} k="Рекорд" v={String(best)} />
            </>
          )}
        </dl>

        <button
          type="button"
          onClick={onStart}
          disabled={!ready}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold text-accent-fg transition-transform duration-150 ease-out hover:opacity-95 active:scale-[0.98] disabled:opacity-50 short:hidden"
        >
          <Zap className="size-4" />
          {def.start}
        </button>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-subtle">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={invertY}
              onChange={(e) => patch({ invertY: e.target.checked })}
              className="size-3.5 accent-hud"
              suppressHydrationWarning
            />
            Инверсия оси Y
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => patch({ muted: e.target.checked })}
              className="size-3.5 accent-hud"
              suppressHydrationWarning
            />
            Без звука
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={shake}
              onChange={(e) => patch({ shake: e.target.checked })}
              className="size-3.5 accent-hud"
              suppressHydrationWarning
            />
            Тряска камеры
          </label>
        </div>

        <p className="mt-3 hidden text-[11px] leading-relaxed text-subtle coarse:hidden md:block">
          {ground
            ? "W — вперёд · A/D — поворот · пробел — бег · Ctrl — присесть · красная лента — фронт"
            : arcade
              ? "W — вперёд · A/D — рысканье · ЛКМ — огонь · X — камикадзе · не дайте пересечь ленту"
              : "W — вперёд · A/D — рысканье · мышь — взгляд · X — подрыв · пауза — ангар"}
        </p>
        <p className="mt-3 hidden text-[11px] leading-relaxed text-subtle coarse:block">
          {ground
            ? "Левый стик — ход и поворот. Бег / присесть справа."
            : "Левый стик — полёт, правый — крен. Огонь и подрыв справа."}
        </p>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  id,
  active,
  onPick,
}: {
  id: GameMode;
  active: boolean;
  onPick: () => void;
}) {
  const m = MODES[id];
  return (
    <button
      type="button"
      onClick={onPick}
      className={`rounded-md border px-2 py-2.5 text-left transition-colors duration-150 ${
        active ? "border-hud bg-surface-2 text-fg" : "border-border bg-bg text-muted"
      }`}
    >
      <div className="font-mono text-[10px] tracking-widest uppercase text-hud-dim">{m.short}</div>
      <div className="mt-0.5 text-xs font-medium leading-tight md:text-sm">{m.title}</div>
    </button>
  );
}

function UnitCard({
  active,
  icon,
  title,
  blurb,
  onPick,
}: {
  id: GroundUnit;
  active: boolean;
  icon: ReactNode;
  title: string;
  blurb: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`rounded-md border px-3 py-2.5 text-left transition-colors duration-150 ${
        active ? "border-hud bg-surface-2 text-fg" : "border-border bg-bg text-muted"
      }`}
    >
      <div className="text-hud-dim">{icon}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      <div className="text-[11px] text-subtle">{blurb}</div>
    </button>
  );
}

function WeaponCard({ id, active, onPick }: { id: WeaponId; active: boolean; onPick: () => void }) {
  const w = WEAPONS[id];
  return (
    <button
      type="button"
      onClick={onPick}
      className={`rounded-md border px-2 py-2 text-left transition-colors duration-150 ${
        active ? "border-hud bg-surface-2 text-fg" : "border-border bg-bg text-muted"
      }`}
    >
      <div className="font-mono text-[10px] tracking-widest uppercase text-hud-dim">{w.short}</div>
      <div className="mt-0.5 text-xs font-medium leading-tight">{w.name}</div>
    </button>
  );
}

function Stat({ icon, k, v }: { icon: ReactNode; k: string; v: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-2 py-2">
      <div className="flex items-center justify-center gap-1 text-hud-dim">{icon}</div>
      <dt className="mt-1 text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="font-mono text-sm tabular text-fg">{v}</dd>
    </div>
  );
}

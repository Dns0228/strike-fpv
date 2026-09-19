import type { ReactNode } from "react";
import { Crosshair, Gauge, Shield, Zap } from "lucide-react";
import { ARMOR_LABEL, WEAPONS, WEAPON_ORDER, expectedDamage, type WeaponId } from "@/game/catalog";
import { useGameStore } from "@/game/store";

const ARMORS = ["soft", "light", "heavy"] as const;

type Props = {
  onStart: () => void;
  ready: boolean;
};

export function Hangar({ onStart, ready }: Props) {
  const weapon = useGameStore((s) => s.weapon);
  const best = useGameStore((s) => s.best);
  const invertY = useGameStore((s) => s.invertY);
  const muted = useGameStore((s) => s.muted);
  const shake = useGameStore((s) => s.shake);
  const patch = useGameStore((s) => s.patch);
  const wpn = WEAPONS[weapon];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end md:justify-center p-4 md:p-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-border bg-surface/92 p-5 shadow-2xl md:p-6">
        <p className="font-mono text-xs tracking-[0.22em] text-hud-dim uppercase">Полигон Дельта · версия 2.0</p>
        <h1 className="font-display mt-2 text-4xl font-semibold leading-none text-fg md:text-5xl">STRIKE FPV</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          Ударный дрон от первого лица. Разные цели — разный урон: осколки режут расчёты, ББ ломает броню.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {WEAPON_ORDER.map((id) => (
            <WeaponCard key={id} id={id} active={weapon === id} onPick={() => patch({ weapon: id })} />
          ))}
        </div>

        <div className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-hud">{wpn.short}</span>
            <span className="text-xs text-subtle">базовый урон {wpn.baseDamage}</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-muted">{wpn.blurb}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
            {ARMORS.map((a) => (
              <div key={a} className="rounded-xs bg-bg px-2 py-1.5">
                <div className="text-subtle">{ARMOR_LABEL[a]}</div>
                <div className="text-hud tabular">{expectedDamage(wpn.baseDamage, wpn.vs, a)}</div>
              </div>
            ))}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat icon={<Crosshair className="size-3.5" />} k="Цели" v="14" />
          <Stat icon={<Shield className="size-3.5" />} k="Дроны" v="3" />
          <Stat icon={<Gauge className="size-3.5" />} k="Рекорд" v={String(best)} />
        </dl>

        <button
          type="button"
          onClick={onStart}
          disabled={!ready}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold text-accent-fg transition-transform duration-150 ease-out hover:opacity-95 active:scale-[0.98] disabled:opacity-50"
        >
          <Zap className="size-4" />
          Начать вылет
        </button>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-subtle">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={invertY}
              onChange={(e) => patch({ invertY: e.target.checked })}
              className="size-3.5 accent-hud"
            />
            Инверсия оси Y
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => patch({ muted: e.target.checked })}
              className="size-3.5 accent-hud"
            />
            Без звука
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={shake}
              onChange={(e) => patch({ shake: e.target.checked })}
              className="size-3.5 accent-hud"
            />
            Тряска камеры
          </label>
        </div>

        <p className="mt-4 hidden text-[11px] leading-relaxed text-subtle md:block">
          W — вперёд · S — назад · A/D — рысканье · пробел — набор · стрелки — тангаж и крен · мышь — прицел · ЛКМ — огонь · X — камикадзе · 1/2/3 — БЧ
        </p>
        <p className="mt-4 text-[11px] leading-relaxed text-subtle md:hidden">
          Левый стик — вперёд и рысканье, правый — тангаж и крен. Удерживайте огонь, X — подрыв.
        </p>
      </div>
    </div>
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

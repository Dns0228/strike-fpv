import { ARMOR_LABEL, WEAPONS, type WeaponId } from "@/game/catalog";
import { useGameStore } from "@/game/store";

const WEAPON_NAME: Record<WeaponId | "kami", string> = {
  frag: WEAPONS.frag.name,
  he: WEAPONS.he.name,
  ap: WEAPONS.ap.name,
  kami: "Камикадзе",
};

type Props = {
  onSkip: () => void;
};

export function ReplayHud({ onSkip }: Props) {
  const replay = useGameStore((s) => s.replay);
  if (!replay) return null;

  const wpn = WEAPON_NAME[replay.weapon];
  const hpPct = Math.max(0, (replay.hp / Math.max(1, replay.maxHp)) * 100);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 font-mono text-hud">
      <div className="replay-scan absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 42%, color-mix(in oklab, var(--color-bg) 62%, transparent) 100%)",
        }}
      />

      <header className="absolute left-0 right-0 top-0 flex items-start justify-between gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:p-5">
        <div>
          <div className="flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase">
            <span className="replay-rec size-2 rounded-full bg-danger" />
            <span className="text-hud">БПЛА-Р2 · РАЗВЕДКА</span>
          </div>
          <div className="mt-1 text-[11px] text-hud-dim">ПОВТОР ПОПАДАНИЯ · ×0.3</div>
        </div>
        <div className="text-right text-[10px] tracking-widest text-hud-dim uppercase">
          ISR CAM
          <div className="mt-1 text-hud tabular">CH-07</div>
        </div>
      </header>

      <div className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute left-0 top-0 h-3 w-3 border-l border-t border-hud/80" />
        <span className="absolute right-0 top-0 h-3 w-3 border-r border-t border-hud/80" />
        <span className="absolute bottom-0 left-0 h-3 w-3 border-b border-l border-hud/80" />
        <span className="absolute bottom-0 right-0 h-3 w-3 border-b border-r border-hud/80" />
      </div>

      {replay.impacted ? (
        <div className="absolute left-1/2 top-[58%] w-64 -translate-x-1/2 text-center">
          <div className="font-display text-4xl font-semibold tabular text-fg md:text-5xl">
            −{replay.damage}
          </div>
          <div className="mt-1 text-xs tracking-[0.18em] uppercase text-hud">
            {replay.kill ? "Цель уничтожена" : "Поражение"}
          </div>
        </div>
      ) : (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 text-[11px] tracking-[0.2em] text-hud-dim uppercase">
          Входящий боеприпас
        </div>
      )}

      <aside className="absolute bottom-24 left-3 right-3 mx-auto max-w-sm rounded-md border border-hud/35 bg-bg/80 p-3 md:bottom-8 md:left-5 md:right-auto md:w-80">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] tracking-[0.22em] text-hud-dim uppercase">Цель</div>
            <div className="mt-0.5 text-sm text-fg">{replay.label}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] tracking-[0.22em] text-hud-dim uppercase">БЧ</div>
            <div className="mt-0.5 text-sm text-hud">{wpn}</div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-muted">
          Броня {ARMOR_LABEL[replay.armor]}
          {replay.secondary > 0 ? ` · ещё ${replay.secondary}` : ""}
        </div>
        <div className="mt-2 h-1.5 w-full bg-border">
          <div
            className={`h-full ${replay.kill ? "bg-danger" : "bg-hud"}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] tabular text-hud-dim">
          <span>HP {Math.max(0, replay.hp)}/{replay.maxHp}</span>
          <span>урон {replay.damage}</span>
        </div>
      </aside>

      <button
        type="button"
        onClick={onSkip}
        className="pointer-events-auto absolute bottom-6 right-3 h-11 min-w-28 rounded-md border border-border bg-surface/90 px-4 text-xs tracking-widest uppercase text-muted md:bottom-8 md:right-5"
      >
        Пропустить
      </button>
    </div>
  );
}

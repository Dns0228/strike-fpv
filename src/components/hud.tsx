import { ARMOR_LABEL, WEAPONS, WEAPON_ORDER, type WeaponId } from "@/game/catalog";
import { useGameStore } from "@/game/store";

export function Hud() {
  const speed = useGameStore((s) => s.speed);
  const altitude = useGameStore((s) => s.altitude);
  const battery = useGameStore((s) => s.battery);
  const heading = useGameStore((s) => s.heading);
  const score = useGameStore((s) => s.score);
  const destroyed = useGameStore((s) => s.destroyed);
  const total = useGameStore((s) => s.totalTargets);
  const weapon = useGameStore((s) => s.weapon);
  const ammo = useGameStore((s) => s.ammo);
  const lives = useGameStore((s) => s.lives);
  const lock = useGameStore((s) => s.lock);
  const floats = useGameStore((s) => s.floats);
  const hitFlash = useGameStore((s) => s.hitFlash);
  const message = useGameStore((s) => s.message);

  const batTone = battery < 18 ? "text-danger" : battery < 40 ? "text-warn" : "text-hud";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-mono text-hud">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 48%, color-mix(in oklab, var(--color-bg) 55%, transparent) 100%)",
        }}
      />
      {hitFlash > 0.05 ? (
        <div className="absolute inset-0 bg-accent/10" style={{ opacity: hitFlash * 0.45 }} />
      ) : null}

      <div className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-hud" />
        <span className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-hud" />
        <span className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-hud" />
        <span className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-hud" />
        <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hud" />
      </div>

      <header className="absolute left-0 right-0 top-0 flex items-start justify-between gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:p-5">
        <div>
          <div className="text-[10px] tracking-[0.28em] text-hud-dim uppercase">Strike FPV 2.0</div>
          <div className="mt-1 text-xs tabular text-fg">
            ЦЕЛИ {destroyed}/{total}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="pointer-events-auto h-10 min-w-10 rounded-md border border-border bg-surface/80 px-3 font-mono text-[10px] tracking-widest uppercase text-muted"
            onClick={() => useGameStore.getState().patch({ phase: "pause" })}
          >
            Пауза
          </button>
          <div className="text-right">
            <div className="text-[10px] tracking-[0.2em] text-hud-dim uppercase">Счёт</div>
            <div className="text-lg tabular leading-none text-fg">{score}</div>
          </div>
        </div>
      </header>

      <div className="absolute left-3 top-1/3 space-y-3 text-[11px] tabular md:left-5">
        <Readout k="SPD" v={`${speed.toFixed(0)}`} u="м/с" />
        <Readout k="ALT" v={`${altitude.toFixed(0)}`} u="м" />
        <Readout k="HDG" v={`${heading.toFixed(0).padStart(3, "0")}`} u="°" />
      </div>

      <div className="absolute right-3 top-1/3 space-y-3 text-right text-[11px] tabular md:right-5">
        <Readout k="АКБ" v={`${battery.toFixed(0)}`} u="%" tone={batTone} />
        <Readout k="БОРТ" v={`${lives}`} u="/ 3" />
      </div>

      {lock ? (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 border border-hud/80 px-2 py-1"
          style={{ left: lock.screenX, top: lock.screenY, width: 88, height: 64 }}
        >
          <div className="absolute -left-1 -top-1 size-2 border-l border-t border-hud" />
          <div className="absolute -right-1 -top-1 size-2 border-r border-t border-hud" />
          <div className="absolute -bottom-1 -left-1 size-2 border-b border-l border-hud" />
          <div className="absolute -bottom-1 -right-1 size-2 border-b border-r border-hud" />
          <div className="absolute left-full top-0 ml-2 w-40 text-left text-[10px] leading-tight">
            <div className="text-fg">{lock.label}</div>
            <div className="text-hud-dim">
              {ARMOR_LABEL[lock.armor]} · {lock.dist.toFixed(0)} м
            </div>
            <div className="mt-0.5 h-1 w-24 bg-border">
              <div
                className="h-full bg-hud"
                style={{ width: `${Math.max(0, (lock.hp / lock.maxHp) * 100)}%` }}
              />
            </div>
            <div className="mt-0.5 text-fg">
              {WEAPONS[lock.weapon].short} → {lock.expected}
            </div>
          </div>
        </div>
      ) : null}

      {floats.map((f) => (
        <div
          key={f.id}
          className={`absolute -translate-x-1/2 text-xs tabular ${f.kind === "kill" ? "text-fg" : "text-hud"}`}
          style={{ left: f.x, top: f.y - 18 }}
        >
          {f.text}
        </div>
      ))}

      <footer className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-5">
        {message ? <p className="text-[11px] tracking-wide text-muted">{message}</p> : null}
        <div className="flex gap-1">
          {WEAPON_ORDER.map((id, i) => {
            const active = id === weapon;
            return (
              <button
                key={id}
                type="button"
                className={`pointer-events-auto min-w-16 rounded-sm border px-2 py-1.5 text-center ${
                  active ? "border-hud bg-surface/70 text-fg" : "border-border/80 bg-bg/50 text-subtle"
                }`}
                onClick={() => useGameStore.getState().patch({ weapon: id as WeaponId })}
              >
                <div className="text-[9px] tracking-widest">{i + 1} {WEAPONS[id].short}</div>
                <div className="tabular text-xs">{ammo[id]}</div>
              </button>
            );
          })}
        </div>
      </footer>
    </div>
  );
}

function Readout({
  k,
  v,
  u,
  tone = "text-hud",
}: {
  k: string;
  v: string;
  u: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.2em] text-hud-dim">{k}</div>
      <div className={`text-sm leading-none ${tone}`}>
        {v}
        <span className="ml-1 text-[9px] text-subtle">{u}</span>
      </div>
    </div>
  );
}

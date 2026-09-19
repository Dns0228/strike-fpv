import { ARMOR_LABEL, WEAPONS, WEAPON_ORDER, type WeaponId } from "@/game/catalog";
import { useGameStore, type RadarBlip } from "@/game/store";

const CARDINALS: { deg: number; label: string }[] = [
  { deg: 0, label: "С" },
  { deg: 45, label: "45" },
  { deg: 90, label: "В" },
  { deg: 135, label: "135" },
  { deg: 180, label: "Ю" },
  { deg: 225, label: "225" },
  { deg: 270, label: "З" },
  { deg: 315, label: "315" },
];

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
  const blips = useGameStore((s) => s.blips);
  const droneX = useGameStore((s) => s.droneX);
  const droneZ = useGameStore((s) => s.droneZ);

  const batTone = battery < 18 ? "text-danger" : battery < 40 ? "text-warn" : "text-hud";
  const yaw = (-heading * Math.PI) / 180;

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

      <Compass heading={heading} />

      <div className="absolute left-3 top-1/3 space-y-3 text-[11px] tabular md:left-5">
        <Readout k="SPD" v={`${speed.toFixed(0)}`} u="м/с" />
        <Readout k="ALT" v={`${altitude.toFixed(0)}`} u="м" />
        <Readout k="HDG" v={`${heading.toFixed(0).padStart(3, "0")}`} u="°" />
      </div>

      <div className="absolute right-3 top-1/3 space-y-3 text-right text-[11px] tabular md:right-5">
        <Readout k="АКБ" v={`${battery.toFixed(0)}`} u="%" tone={batTone} />
        <Readout k="БОРТ" v={`${lives}`} u="/ 3" />
      </div>

      <Minimap blips={blips} x={droneX} z={droneZ} yaw={yaw} />

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

function Compass({ heading }: { heading: number }) {
  return (
    <div className="absolute left-1/2 top-14 w-52 -translate-x-1/2 overflow-hidden md:top-16 md:w-72">
      <div className="relative h-7 border-b border-hud/35">
        {CARDINALS.map((m) => {
          const d = ((m.deg - heading + 540) % 360) - 180;
          const x = 50 + d * 0.72;
          if (x < 6 || x > 94) return null;
          const major = m.label.length === 1;
          return (
            <div
              key={m.deg}
              className="absolute top-0 -translate-x-1/2 text-center"
              style={{ left: `${x}%` }}
            >
              <div className={`mx-auto w-px ${major ? "h-2 bg-hud" : "h-1.5 bg-hud/50"}`} />
              <div className={`font-mono ${major ? "text-[10px] text-fg" : "text-[8px] text-hud-dim"}`}>
                {m.label}
              </div>
            </div>
          );
        })}
        <div className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-fg" />
      </div>
    </div>
  );
}

function Minimap({
  blips,
  x,
  z,
  yaw,
}: {
  blips: RadarBlip[];
  x: number;
  z: number;
  yaw: number;
}) {
  const size = 104;
  const scale = size / 260;
  const half = size / 2;
  const maxR = half - 6;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  return (
    <div
      className="absolute bottom-40 left-3 overflow-hidden rounded-sm border border-hud/40 bg-bg/75 md:bottom-8 md:left-5"
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 opacity-40">
        <div className="absolute left-1/2 top-0 h-full w-px bg-hud/30" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-hud/30" />
      </div>
      <div className="absolute left-1/2 top-1 h-2 w-px -translate-x-1/2 bg-hud" />
      {blips.map((b) => {
        const dx = b.x - x;
        const dz = b.z - z;
        let lx = dx * cy + dz * -sy;
        let lz = dx * -sy + dz * -cy;
        const r = Math.hypot(lx, lz) * scale;
        if (r > maxR && r > 0.001) {
          const k = maxR / r;
          lx *= k;
          lz *= k;
        }
        const px = half + lx * scale;
        const py = half - lz * scale;
        const tone = !b.alive ? "bg-subtle" : b.armor === "heavy" ? "bg-danger" : b.armor === "light" ? "bg-warn" : "bg-ok";
        return (
          <span
            key={b.id}
            className={`absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${tone}`}
            style={{ left: px, top: py, opacity: b.alive ? 1 : 0.45 }}
          />
        );
      })}
      <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-fg bg-fg" />
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

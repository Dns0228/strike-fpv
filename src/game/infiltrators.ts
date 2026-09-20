import * as THREE from "three";
import { FRONT_Z, FRIENDLY, type TargetKind } from "./catalog";
import { ARCADE_BREACH_MAX, ARCADE_WAVES } from "./modes";
import type { Sim } from "./sim";
import type { WorldApi } from "./world";

export type InfilEvent = { type: "breach" } | { type: "wave"; n: number } | { type: "cleared" };

type Unit = {
  targetId: number;
  kind: TargetKind;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  breached: boolean;
};

const WAVES: TargetKind[][] = [
  ["infantry", "infantry", "infantry"],
  ["infantry", "jeep", "infantry"],
  ["jeep", "truck", "infantry", "infantry"],
];

export function createInfiltrators(world: WorldApi, sim: Sim) {
  const roster: Unit[] = [];
  let wave = 0;
  let breaches = 0;
  let won = false;
  let lost = false;
  let active = false;
  let spawnQ: Array<{ kind: TargetKind; at: number }> = [];
  let t = 0;
  const events: InfilEvent[] = [];

  function drain() {
    return events.splice(0, events.length);
  }

  function beginWave(index: number) {
    wave = index + 1;
    t = 0;
    spawnQ = WAVES[index].map((kind, i) => ({ kind, at: 0.35 + i * 1.35 }));
    events.push({ type: "wave", n: wave });
  }

  function spawn(kind: TargetKind) {
    const x = 6 + Math.random() * 72;
    const z = -86 - Math.random() * 8;
    const yaw = Math.atan2(-(FRIENDLY.x - x), -(FRIENDLY.z - z));
    const id = sim.spawnLive(kind, x, z, yaw);
    roster.push({
      targetId: id,
      kind,
      pos: new THREE.Vector3(x, world.heightAt(x, z), z),
      yaw,
      speed: kind === "jeep" ? 7.4 : kind === "truck" ? 6.15 : 3.35,
      breached: false,
    });
  }

  function reset() {
    sim.clearLive();
    roster.length = 0;
    breaches = 0;
    won = false;
    lost = false;
    spawnQ = [];
    t = 0;
    beginWave(0);
  }

  function setActive(on: boolean) {
    if (active === on) return;
    active = on;
    if (!on) {
      sim.clearLive();
      roster.length = 0;
    }
  }

  function tick(dt: number) {
    if (!active || won || lost) return;
    t += dt;
    spawnQ = spawnQ.filter((s) => {
      if (t >= s.at) {
        spawn(s.kind);
        return false;
      }
      return true;
    });

    for (const u of roster) {
      const tgt = sim.getTarget(u.targetId);
      if (!tgt || !tgt.alive) continue;
      const dx = FRIENDLY.x - u.pos.x;
      const dz = FRIENDLY.z - u.pos.z;
      u.yaw = Math.atan2(-dx, -dz);
      const fx = -Math.sin(u.yaw);
      const fz = -Math.cos(u.yaw);
      u.pos.x += fx * u.speed * dt;
      u.pos.z += fz * u.speed * dt;
      for (const b of world.buildings) {
        const d = Math.hypot(u.pos.x - b.x, u.pos.z - b.z);
        const rad = b.r + (u.kind === "jeep" ? 1.1 : 0.5);
        if (d < rad) {
          const nx = (u.pos.x - b.x) / (d || 1);
          const nz = (u.pos.z - b.z) / (d || 1);
          u.pos.x = b.x + nx * rad;
          u.pos.z = b.z + nz * rad;
        }
      }
      u.pos.y = world.heightAt(u.pos.x, u.pos.z);
      sim.syncLive(u.targetId, u.pos.x, u.pos.y, u.pos.z, u.yaw);

      if (!u.breached && u.pos.z > FRONT_Z + 2.5) {
        u.breached = true;
        breaches += 1;
        events.push({ type: "breach" });
        if (breaches >= ARCADE_BREACH_MAX) lost = true;
      }
    }

    const anyone = roster.some((u) => sim.getTarget(u.targetId)?.alive);
    if (!anyone && spawnQ.length === 0) {
      if (wave < ARCADE_WAVES) beginWave(wave);
      else {
        won = true;
        events.push({ type: "cleared" });
      }
    }
  }

  return {
    tick,
    reset,
    setActive,
    drain,
    get wave() {
      return wave;
    },
    get waves() {
      return ARCADE_WAVES;
    },
    get breaches() {
      return breaches;
    },
    get breachMax() {
      return ARCADE_BREACH_MAX;
    },
    get won() {
      return won;
    },
    get lost() {
      return lost;
    },
    get alive() {
      return roster.filter((u) => sim.getTarget(u.targetId)?.alive).length;
    },
  };
}

export type Infiltrators = ReturnType<typeof createInfiltrators>;

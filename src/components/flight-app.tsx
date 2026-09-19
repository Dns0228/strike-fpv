import { useEffect, useRef, useState } from "react";
import type { GameHandle } from "@/game/engine";
import { loadSettings, useGameStore } from "@/game/store";
import { Hangar } from "@/components/hangar";
import { Hud } from "@/components/hud";
import { Overlays } from "@/components/overlays";
import { TouchControls } from "@/components/touch-controls";

export function FlightApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<GameHandle | null>(null);
  const phase = useGameStore((s) => s.phase);

  useEffect(() => {
    loadSettings();
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let handle: GameHandle | null = null;
    void import("@/game/engine").then(({ createGame }) => {
      if (!alive || !canvasRef.current) return;
      handle = createGame(canvasRef.current);
      setGame(handle);
    });
    return () => {
      alive = false;
      handle?.dispose();
      setGame(null);
    };
  }, []);

  const start = () => game?.startSortie();

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-bg text-fg">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-none"
        onClick={() => {
          if (phase === "flight") game?.input.requestLock();
        }}
      />
      {phase === "hangar" ? <Hangar onStart={start} ready={!!game} /> : null}
      {phase === "flight" || phase === "pause" ? <Hud /> : null}
      {phase === "flight" ? <TouchControls game={game} /> : null}
      <Overlays
        onResume={() => game?.resume()}
        onRestart={() => game?.restart()}
        onNext={() => game?.nextLife()}
        onHangar={() => {
          useGameStore.getState().patch({ phase: "hangar" });
        }}
      />
    </main>
  );
}

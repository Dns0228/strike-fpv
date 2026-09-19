import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";

export function RotateHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait) and (hover: none) and (pointer: coarse)");
    const sync = () => setShow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-bg px-8 text-center">
      <div className="flex size-20 items-center justify-center rounded-xl border border-border bg-surface">
        <Smartphone className="size-10 rotate-90 text-hud" />
      </div>
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-hud-dim uppercase">STRIKE FPV</p>
        <p className="font-display mt-2 text-2xl font-semibold text-fg">Поверните устройство</p>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
          Вылет горизонтальный. Положите телефон на бок — так виден фронт и стики.
        </p>
      </div>
    </div>
  );
}

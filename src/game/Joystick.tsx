import { useEffect, useRef } from "react";

export function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const center = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const base = baseRef.current!;
    const stick = stickRef.current!;
    const radius = 50;

    const start = (e: TouchEvent) => {
      const r = base.getBoundingClientRect();
      center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      active.current = true;
      move(e);
    };
    const move = (e: TouchEvent) => {
      if (!active.current) return;
      const t = e.touches[0];
      let dx = t.clientX - center.current.x;
      let dy = t.clientY - center.current.y;
      const d = Math.hypot(dx, dy);
      if (d > radius) { dx = (dx / d) * radius; dy = (dy / d) * radius; }
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
      onMove(dx / radius, dy / radius);
    };
    const end = () => {
      active.current = false;
      stick.style.transform = "translate(0,0)";
      onMove(0, 0);
    };
    base.addEventListener("touchstart", start);
    base.addEventListener("touchmove", move);
    base.addEventListener("touchend", end);
    base.addEventListener("touchcancel", end);
    return () => {
      base.removeEventListener("touchstart", start);
      base.removeEventListener("touchmove", move);
      base.removeEventListener("touchend", end);
      base.removeEventListener("touchcancel", end);
    };
  }, [onMove]);

  return (
    <div
      ref={baseRef}
      className="absolute bottom-6 left-6 w-32 h-32 rounded-full bg-white/10 border border-white/30 backdrop-blur-sm touch-none select-none z-20"
    >
      <div
        ref={stickRef}
        className="absolute top-1/2 left-1/2 w-14 h-14 -mt-7 -ml-7 rounded-full bg-white/40 border border-white/60 transition-transform"
      />
    </div>
  );
}

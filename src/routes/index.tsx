import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { ForestHorrorGame } from "@/game/ForestHorrorGame";
import { Joystick } from "@/game/Joystick";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dark Forest — 3D Horror Survival" },
      { name: "description", content: "Survive a haunted forest filled with zombies and ghosts. 3D horror shooter playable in your browser." },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      { property: "og:title", content: "Dark Forest — 3D Horror Survival" },
      { property: "og:description", content: "3D horror survival in the browser." },
    ],
  }),
  component: Game,
});

function Game() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<ForestHorrorGame | null>(null);
  const [started, setStarted] = useState(false);
  const [hp, setHp] = useState(100);
  const [ammo, setAmmo] = useState(24);
  const [weapon, setWeapon] = useState("gun");
  const [kills, setKills] = useState(0);
  const [msg, setMsg] = useState("");
  const [dead, setDead] = useState(false);

  useEffect(() => {
    if (!started || !containerRef.current) return;
    let msgTimer: ReturnType<typeof setTimeout>;
    const game = new ForestHorrorGame(containerRef.current, {
      onHealth: setHp,
      onAmmo: (a, w) => { setAmmo(a); setWeapon(w); },
      onKills: setKills,
      onMessage: (m) => {
        setMsg(m);
        clearTimeout(msgTimer);
        msgTimer = setTimeout(() => setMsg(""), 1500);
      },
      onDeath: () => setDead(true),
    });
    gameRef.current = game;
    return () => { clearTimeout(msgTimer); game.dispose(); gameRef.current = null; };
  }, [started]);

  const handleMove = useCallback((x: number, y: number) => {
    gameRef.current?.setMoveInput(x, y);
  }, []);

  const restart = () => {
    setDead(false);
    setHp(100); setAmmo(24); setKills(0);
    setStarted(false);
    setTimeout(() => setStarted(true), 50);
  };

  if (!started) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(80,20,20,0.5),transparent_60%)]" />
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "repeating-linear-gradient(0deg,#000,#000 2px,transparent 2px,transparent 4px)" }} />
        <div className="relative max-w-lg text-center space-y-6">
          <h1 className="text-5xl md:text-7xl font-black tracking-widest text-red-600" style={{ fontFamily: "serif", textShadow: "0 0 20px #800,0 0 40px #400" }}>
            DARK FOREST
          </h1>
          <p className="text-zinc-400 text-sm md:text-base">
            Aap ek dense haunted forest mein phase hue ho. Zombies aur ghosts har taraf hain.
            Apni gun, knife aur flashlight use karke zinda raho.
          </p>
          <div className="text-left text-xs text-zinc-500 space-y-1 bg-white/5 p-4 rounded-lg border border-white/10">
            <p><span className="text-red-400">PC:</span> WASD = move · Mouse = look · Click = shoot · R = reload · F = flashlight · 1/2 = weapon</p>
            <p><span className="text-red-400">Mobile:</span> Left joystick = move · Right side = look · Buttons = shoot/flashlight/reload</p>
          </div>
          <button
            onClick={() => setStarted(true)}
            className="px-10 py-4 bg-red-700 hover:bg-red-600 text-white font-bold tracking-widest rounded-md border border-red-500 shadow-[0_0_30px_rgba(200,0,0,0.5)] transition"
          >
            ENTER THE FOREST
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.85)_100%)] z-10" />

      {/* Crosshair */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -mt-2 -ml-2 w-4 h-4 z-10">
        <div className="absolute inset-0 border border-white/70 rounded-full" />
        <div className="absolute top-1/2 left-1/2 w-0.5 h-0.5 -mt-0.5 -ml-0.5 bg-red-500 rounded-full" />
      </div>

      {/* HUD top */}
      <div className="absolute top-4 left-4 right-4 flex justify-between text-white font-mono z-20 pointer-events-none">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-widest text-red-400">Health</div>
          <div className="w-40 h-3 bg-black/60 border border-white/20 rounded">
            <div className="h-full bg-gradient-to-r from-red-700 to-red-400 transition-all" style={{ width: `${hp}%` }} />
          </div>
          <div className="text-sm">{hp} HP</div>
        </div>
        <div className="text-right space-y-1">
          <div className="text-xs uppercase tracking-widest text-red-400">Kills</div>
          <div className="text-3xl font-black">{kills}</div>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 text-white/90 font-mono text-sm bg-black/60 px-4 py-2 rounded border border-white/10 z-20">
          {msg}
        </div>
      )}

      {/* Ammo */}
      <div className="absolute bottom-6 right-6 text-white font-mono text-right z-20 pointer-events-none">
        <div className="text-xs uppercase tracking-widest text-red-400">{weapon}</div>
        <div className="text-3xl font-black">{weapon === "gun" ? `${ammo} / 24` : "∞"}</div>
      </div>

      {/* Mobile controls */}
      <Joystick onMove={handleMove} />

      <div className="absolute bottom-6 right-6 md:right-44 flex flex-col gap-3 z-20" style={{ marginBottom: "60px" }}>
        <button
          onTouchStart={(e) => { e.preventDefault(); gameRef.current?.attack(); }}
          onClick={() => gameRef.current?.attack()}
          className="w-20 h-20 rounded-full bg-red-700/80 border-2 border-red-400 text-white font-bold active:scale-95 transition"
        >
          FIRE
        </button>
      </div>

      <div className="absolute bottom-44 left-6 flex flex-col gap-2 z-20">
        <button
          onClick={() => gameRef.current?.toggleFlashlight()}
          className="w-14 h-14 rounded-full bg-yellow-500/30 border border-yellow-300/70 text-white text-xs font-bold backdrop-blur-sm"
        >
          TORCH
        </button>
        <button
          onClick={() => gameRef.current?.reload()}
          className="w-14 h-14 rounded-full bg-white/10 border border-white/40 text-white text-xs font-bold backdrop-blur-sm"
        >
          RELOAD
        </button>
        <div className="flex gap-2">
          <button onClick={() => gameRef.current?.setWeapon("gun")} className="w-10 h-10 rounded bg-white/10 border border-white/30 text-white text-xs">GUN</button>
          <button onClick={() => gameRef.current?.setWeapon("knife")} className="w-10 h-10 rounded bg-white/10 border border-white/30 text-white text-xs">KNF</button>
        </div>
      </div>

      {/* Death */}
      {dead && (
        <div className="absolute inset-0 bg-black/80 z-30 flex items-center justify-center">
          <div className="text-center space-y-6">
            <h2 className="text-6xl font-black text-red-600 tracking-widest" style={{ fontFamily: "serif", textShadow: "0 0 30px #800" }}>
              YOU DIED
            </h2>
            <p className="text-zinc-400">Kills: <span className="text-white font-bold">{kills}</span></p>
            <button onClick={restart} className="px-8 py-3 bg-red-700 hover:bg-red-600 text-white font-bold tracking-widest rounded border border-red-400">
              TRY AGAIN
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

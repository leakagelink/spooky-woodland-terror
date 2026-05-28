import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import type { ForestHorrorGame as ForestHorrorGameType, WeaponKind, GrenadeKind, Difficulty } from "@/game/ForestHorrorGame";
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

type MinimapData = {
  px: number; pz: number; yaw: number;
  enemies: { x: number; z: number; kind: string }[];
  pickups: { x: number; z: number; kind: string }[];
};

const MAX_AMMO: Record<string, number> = { gun: 24, shotgun: 6, sniper: 5, knife: 0 };

function Game() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<ForestHorrorGameType | null>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapData = useRef<MinimapData | null>(null);
  const minimapRaf = useRef<number>(0);

  const [started, setStarted] = useState(false);
  const [hp, setHp] = useState(100);
  const [ammo, setAmmo] = useState(24);
  const [weapon, setWeapon] = useState<string>("gun");
  const [kills, setKills] = useState(0);
  const [msg, setMsg] = useState("");
  const [dead, setDead] = useState(false);
  const [bloodFlash, setBloodFlash] = useState(false);
  const [lightning, setLightning] = useState(false);
  const [wave, setWave] = useState(1);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [stamina, setStamina] = useState(100);
  const [paused, setPaused] = useState(false);
  const [grenades, setGrenades] = useState(3);
  const [ads, setAds] = useState(false);
  const [grenadeKind, setGrenadeKind] = useState<GrenadeKind>("frag");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");

  useEffect(() => {
    if (!started || !containerRef.current) return;
    let msgTimer: ReturnType<typeof setTimeout>;
    let bloodTimer: ReturnType<typeof setTimeout>;
    let lightTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let gameInstance: ForestHorrorGameType | null = null;

    import("@/game/ForestHorrorGame").then(({ ForestHorrorGame }) => {
      if (cancelled || !containerRef.current) return;
      const game = new ForestHorrorGame(containerRef.current, {
        onHealth: setHp,
        onAmmo: (a: number, w: string) => { setAmmo(a); setWeapon(w); },
        onKills: setKills,
        onMessage: (m: string) => {
          setMsg(m);
          clearTimeout(msgTimer);
          msgTimer = setTimeout(() => setMsg(""), 1500);
        },
        onDeath: () => setDead(true),
        onDamage: () => {
          setBloodFlash(true);
          clearTimeout(bloodTimer);
          bloodTimer = setTimeout(() => setBloodFlash(false), 350);
        },
        onLightning: () => {
          setLightning(true);
          clearTimeout(lightTimer);
          lightTimer = setTimeout(() => setLightning(false), 200);
        },
        onWave: setWave,
        onScore: (s: number, hi: number) => { setScore(s); setHighScore(hi); },
        onStamina: setStamina,
        onPause: setPaused,
        onMinimap: (d: MinimapData) => { minimapData.current = d; },
      }, difficulty);
      gameInstance = game;
      gameRef.current = game;
    });

    const renderMinimap = () => {
      // Poll ADS + grenade count + kind
      const g = gameRef.current;
      if (g) {
        const gc = g.getGrenades?.();
        if (typeof gc === "number") setGrenades((prev) => prev !== gc ? gc : prev);
        const a = g.isAds?.();
        if (typeof a === "boolean") setAds((prev) => prev !== a ? a : prev);
        const gk = g.getGrenadeKind?.();
        if (gk) setGrenadeKind((prev) => prev !== gk ? gk : prev);
      }

      const cv = minimapRef.current;
      const d = minimapData.current;
      if (cv && d) {
        const ctx = cv.getContext("2d");
        if (ctx) {
          const size = cv.width;
          const radius = size / 2;
          const range = 50;
          ctx.clearRect(0, 0, size, size);
          ctx.fillStyle = "rgba(10,15,10,0.75)";
          ctx.beginPath(); ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(180,40,40,0.6)";
          ctx.lineWidth = 2; ctx.stroke();
          ctx.strokeStyle = "rgba(120,180,120,0.2)";
          ctx.lineWidth = 1;
          for (let r = radius / 3; r < radius; r += radius / 3) {
            ctx.beginPath(); ctx.arc(radius, radius, r, 0, Math.PI * 2); ctx.stroke();
          }
          const yaw = d.yaw;
          const cos = Math.cos(yaw), sin = Math.sin(yaw);
          const project = (x: number, z: number) => {
            const dx = x - d.px, dz = z - d.pz;
            const lx = dx * cos - dz * sin;
            const lz = dx * sin + dz * cos;
            return { px: radius + (lx / range) * radius, py: radius + (lz / range) * radius };
          };
          d.pickups.forEach((p) => {
            const { px, py } = project(p.x, p.z);
            if (Math.hypot(px - radius, py - radius) > radius) return;
            ctx.fillStyle = p.kind === "medkit" ? "#ff4466" : "#ffcc33";
            ctx.fillRect(px - 2, py - 2, 4, 4);
          });
          d.enemies.forEach((e) => {
            const { px, py } = project(e.x, e.z);
            if (Math.hypot(px - radius, py - radius) > radius) return;
            let color = "#dd3333", r = 3;
            if (e.kind === "boss") { color = "#ff00ff"; r = 5; }
            else if (e.kind === "runner") { color = "#ff7733"; r = 2.5; }
            else if (e.kind === "tank") { color = "#883333"; r = 4; }
            else if (e.kind === "charger") { color = "#ffaa22"; r = 3.5; }
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
          });
          ctx.fillStyle = "#33ff66";
          ctx.beginPath();
          ctx.moveTo(radius, radius - 8);
          ctx.lineTo(radius - 5, radius + 5);
          ctx.lineTo(radius + 5, radius + 5);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 10px monospace";
          ctx.textAlign = "center";
          const nx = radius + Math.sin(-yaw) * (radius - 10);
          const ny = radius - Math.cos(-yaw) * (radius - 10);
          ctx.fillText("N", nx, ny + 3);
        }
      }
      minimapRaf.current = requestAnimationFrame(renderMinimap);
    };
    minimapRaf.current = requestAnimationFrame(renderMinimap);

    return () => {
      cancelled = true;
      cancelAnimationFrame(minimapRaf.current);
      clearTimeout(msgTimer); clearTimeout(bloodTimer); clearTimeout(lightTimer);
      gameInstance?.dispose(); gameRef.current = null;
    };
  }, [started, difficulty]);

  const handleMove = useCallback((x: number, y: number) => {
    gameRef.current?.setMoveInput(x, y);
  }, []);

  const restart = () => {
    setDead(false);
    setHp(100); setAmmo(24); setKills(0); setWave(1); setScore(0); setStamina(100); setPaused(false); setGrenades(3); setAds(false);
    setStarted(false);
    setTimeout(() => setStarted(true), 50);
  };

  const togglePause = () => gameRef.current?.togglePause();
  const pickWeapon = (w: WeaponKind) => gameRef.current?.setWeapon(w);

  const maxAmmo = MAX_AMMO[weapon] ?? 24;
  const showScope = ads && weapon === "sniper";

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
            Rifle, Shotgun, Sniper + Frag/Smoke/Incendiary grenades. Survive zombies, runners, tanks, chargers & bosses.
          </p>
          {highScore > 0 && (
            <p className="text-yellow-400 font-mono text-sm">🏆 HIGH SCORE: {highScore.toLocaleString()}</p>
          )}

          {/* Difficulty selector */}
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-red-400">Difficulty</div>
            <div className="flex gap-2 justify-center">
              {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
                <button key={d} onClick={() => setDifficulty(d)}
                  className={`px-4 py-2 text-xs font-bold rounded border tracking-widest transition ${difficulty === d
                    ? "bg-red-700 border-red-300 text-white shadow-[0_0_15px_rgba(200,0,0,0.6)]"
                    : "bg-black/40 border-white/30 text-white/70 hover:border-red-500"}`}>
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500">
              {difficulty === "easy" && "Less damage, slower spawns, 5 grenades."}
              {difficulty === "normal" && "Balanced experience, 3 grenades."}
              {difficulty === "hard" && "More damage, faster spawns, 2 grenades."}
            </p>
          </div>

          <div className="text-left text-xs text-zinc-500 space-y-1 bg-white/5 p-4 rounded-lg border border-white/10">
            <p><span className="text-red-400">PC:</span> WASD · Shift sprint · C crouch · Mouse look · LMB shoot · RMB ADS · R reload · G grenade · B cycle nade · 1/2/3/4 weapon · F torch · ESC pause</p>
            <p><span className="text-red-400">Mobile:</span> Joystick · Right side look · Buttons: fire/ADS/grenade/cycle/reload/crouch/torch/pause</p>
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

      {/* Vignette (hidden during scope) */}
      {!showScope && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.85)_100%)] z-10" />
      )}

      {/* Sniper scope overlay */}
      {showScope && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute inset-0 bg-black" style={{
            WebkitMaskImage: "radial-gradient(circle at center, transparent 32%, black 33%)",
            maskImage: "radial-gradient(circle at center, transparent 32%, black 33%)",
          }} />
          {/* Crosshair lines */}
          <div className="absolute top-1/2 left-0 right-0 h-px bg-black/70" />
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-black/70" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-red-600" />
          {/* Scope ring */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-black"
            style={{ width: "60vmin", height: "60vmin" }} />
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-150"
        style={{ background: "rgba(200,220,255,0.85)", opacity: lightning ? 1 : 0 }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(180,0,0,0.7) 100%)",
          opacity: bloodFlash ? 1 : 0,
        }}
      />
      {hp < 35 && hp > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 animate-pulse"
          style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(120,0,0,0.5) 100%)" }} />
      )}

      {/* Crosshair (hidden during scope) */}
      {!showScope && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 -mt-2 -ml-2 w-4 h-4 z-10">
          <div className="absolute inset-0 border border-white/70 rounded-full" />
          <div className="absolute top-1/2 left-1/2 w-0.5 h-0.5 -mt-0.5 -ml-0.5 bg-red-500 rounded-full" />
        </div>
      )}

      {/* HUD top-left: Health + Stamina */}
      <div className="absolute top-4 left-4 text-white font-mono z-20 pointer-events-none space-y-2">
        <div>
          <div className="text-xs uppercase tracking-widest text-red-400">Health</div>
          <div className="w-40 h-3 bg-black/60 border border-white/20 rounded">
            <div className="h-full bg-gradient-to-r from-red-700 to-red-400 transition-all" style={{ width: `${hp}%` }} />
          </div>
          <div className="text-xs">{Math.round(hp)} HP</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-green-400">Stamina</div>
          <div className="w-40 h-2 bg-black/60 border border-white/20 rounded">
            <div className="h-full bg-gradient-to-r from-green-700 to-green-300 transition-all" style={{ width: `${stamina}%` }} />
          </div>
        </div>
      </div>

      {/* HUD top-center: Wave + Score */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white font-mono text-center z-20 pointer-events-none">
        <div className="text-xs uppercase tracking-widest text-red-400">Wave</div>
        <div className="text-2xl font-black">{wave}</div>
        <div className="text-[10px] text-yellow-300 mt-1">SCORE: {score.toLocaleString()}</div>
        {highScore > 0 && <div className="text-[10px] text-zinc-400">HI: {highScore.toLocaleString()}</div>}
      </div>

      {/* HUD top-right: Kills + Minimap */}
      <div className="absolute top-4 right-4 text-white font-mono text-right z-20 flex flex-col items-end gap-2">
        <div className="pointer-events-none">
          <div className="text-xs uppercase tracking-widest text-red-400">Kills</div>
          <div className="text-3xl font-black">{kills}</div>
        </div>
        <canvas ref={minimapRef} width={140} height={140}
          className="rounded-full border-2 border-red-700/60 shadow-[0_0_20px_rgba(180,0,0,0.4)]" />
      </div>

      {msg && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 text-white/90 font-mono text-sm bg-black/60 px-4 py-2 rounded border border-white/10 z-20">
          {msg}
        </div>
      )}

      {/* Ammo + Grenades */}
      <div className="absolute bottom-6 right-6 text-white font-mono text-right z-20 pointer-events-none">
        <div className="text-xs uppercase tracking-widest text-red-400">{weapon}{ads ? " · ADS" : ""}</div>
        <div className="text-3xl font-black">{weapon === "knife" ? "∞" : `${ammo} / ${maxAmmo}`}</div>
        <div className="text-xs text-orange-300 mt-1">🧨 {grenades}</div>
      </div>

      <Joystick onMove={handleMove} />

      {/* Right-side action buttons (mobile) */}
      <div className="absolute bottom-6 right-6 md:right-44 flex flex-col gap-3 z-20" style={{ marginBottom: "60px" }}>
        <button
          onTouchStart={(e) => { e.preventDefault(); gameRef.current?.attack(); }}
          onClick={() => gameRef.current?.attack()}
          className="w-20 h-20 rounded-full bg-red-700/80 border-2 border-red-400 text-white font-bold active:scale-95 transition"
        >FIRE</button>
        <div className="flex gap-2">
          <button
            onTouchStart={(e) => { e.preventDefault(); gameRef.current?.toggleAds(); }}
            onClick={() => gameRef.current?.toggleAds()}
            className={`w-14 h-14 rounded-full border-2 text-white text-xs font-bold transition ${ads ? "bg-yellow-600/80 border-yellow-300" : "bg-black/40 border-white/40"}`}
          >ADS</button>
          <button
            onTouchStart={(e) => { e.preventDefault(); gameRef.current?.throwGrenade(); }}
            onClick={() => gameRef.current?.throwGrenade()}
            className="w-14 h-14 rounded-full bg-orange-700/70 border-2 border-orange-300 text-white text-xs font-bold"
          >🧨</button>
        </div>
      </div>

      {/* Left-side utility buttons */}
      <div className="absolute bottom-44 left-6 flex flex-col gap-2 z-20">
        <button onClick={() => gameRef.current?.toggleFlashlight()}
          className="w-14 h-14 rounded-full bg-yellow-500/30 border border-yellow-300/70 text-white text-xs font-bold backdrop-blur-sm">TORCH</button>
        <button onClick={() => gameRef.current?.reload()}
          className="w-14 h-14 rounded-full bg-white/10 border border-white/40 text-white text-xs font-bold backdrop-blur-sm">RELOAD</button>
        <button onClick={() => gameRef.current?.toggleCrouch()}
          className="w-14 h-14 rounded-full bg-purple-500/30 border border-purple-300/70 text-white text-xs font-bold backdrop-blur-sm">CRCH</button>
        <button onClick={togglePause}
          className="w-14 h-14 rounded-full bg-blue-500/30 border border-blue-300/70 text-white text-xs font-bold backdrop-blur-sm">PAUSE</button>
      </div>

      {/* Weapon switcher */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-20">
        {(["gun", "shotgun", "sniper", "knife"] as WeaponKind[]).map((w, i) => (
          <button key={w} onClick={() => pickWeapon(w)}
            className={`px-3 py-2 rounded text-xs font-bold border transition ${weapon === w ? "bg-red-700 border-red-300 text-white" : "bg-black/40 border-white/30 text-white/70"}`}>
            {i + 1}·{w.toUpperCase().slice(0, 4)}
          </button>
        ))}
      </div>

      {/* Pause menu */}
      {paused && !dead && (
        <div className="absolute inset-0 bg-black/75 z-30 flex items-center justify-center">
          <div className="text-center space-y-6 bg-black/80 border border-red-700/50 rounded-lg p-8 shadow-[0_0_40px_rgba(180,0,0,0.4)]">
            <h2 className="text-5xl font-black text-red-500 tracking-widest" style={{ fontFamily: "serif" }}>PAUSED</h2>
            <div className="text-zinc-300 font-mono text-sm space-y-1">
              <div>Wave: <span className="text-white">{wave}</span></div>
              <div>Kills: <span className="text-white">{kills}</span></div>
              <div>Score: <span className="text-yellow-300">{score.toLocaleString()}</span></div>
              <div>High: <span className="text-yellow-500">{highScore.toLocaleString()}</span></div>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={togglePause} className="px-8 py-3 bg-red-700 hover:bg-red-600 text-white font-bold tracking-widest rounded border border-red-400">RESUME</button>
              <button onClick={restart} className="px-8 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded border border-zinc-600">RESTART</button>
            </div>
          </div>
        </div>
      )}

      {dead && (
        <div className="absolute inset-0 bg-black/80 z-30 flex items-center justify-center">
          <div className="text-center space-y-6">
            <h2 className="text-6xl font-black text-red-600 tracking-widest" style={{ fontFamily: "serif", textShadow: "0 0 30px #800" }}>YOU DIED</h2>
            <div className="text-zinc-300 font-mono space-y-1">
              <div>Wave Reached: <span className="text-white font-bold">{wave}</span></div>
              <div>Kills: <span className="text-white font-bold">{kills}</span></div>
              <div>Score: <span className="text-yellow-400 font-bold">{score.toLocaleString()}</span></div>
              {score >= highScore && score > 0 && (
                <div className="text-yellow-300 font-bold animate-pulse">🏆 NEW HIGH SCORE!</div>
              )}
            </div>
            <button onClick={restart} className="px-8 py-3 bg-red-700 hover:bg-red-600 text-white font-bold tracking-widest rounded border border-red-400">TRY AGAIN</button>
          </div>
        </div>
      )}
    </div>
  );
}

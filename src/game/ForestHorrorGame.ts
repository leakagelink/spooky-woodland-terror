import * as THREE from "three";
import { SoundEngine } from "./SoundEngine";

export type GameCallbacks = {
  onHealth: (hp: number) => void;
  onAmmo: (ammo: number, weapon: string) => void;
  onKills: (kills: number) => void;
  onMessage: (msg: string) => void;
  onDeath: () => void;
  onDamage: () => void;
  onLightning: () => void;
};

type Enemy = {
  mesh: THREE.Group;
  type: "zombie" | "ghost";
  hp: number;
  speed: number;
  attackCd: number;
  alive: boolean;
  hitFlash: number;
  origMats: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  lastGrowl: number;
  limbs?: {
    armL: THREE.Object3D; armR: THREE.Object3D;
    legL: THREE.Object3D; legR: THREE.Object3D;
    head: THREE.Object3D; torso: THREE.Object3D;
    jaw?: THREE.Object3D;
  };
  phase: number;
};

export class ForestHorrorGame {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private container: HTMLElement;
  private cb: GameCallbacks;

  // Player
  private yaw = 0;
  private pitch = 0;
  private pos = new THREE.Vector3(0, 1.7, 0);
  private vel = new THREE.Vector3();
  private hp = 100;
  private kills = 0;
  private weapon: "gun" | "knife" = "gun";
  private ammo = 24;
  private fireCd = 0;
  private flashlightOn = true;
  private muzzleFlash = 0;

  // Input
  private keys: Record<string, boolean> = {};
  private moveInput = new THREE.Vector2(); // mobile joystick
  private looking = false;
  private lastTouchX = 0;
  private lastTouchY = 0;

  // World
  private enemies: Enemy[] = [];
  private trees: THREE.Object3D[] = [];
  private flashlight!: THREE.SpotLight;
  private ambient!: THREE.AmbientLight;
  private fog!: THREE.FogExp2;
  private muzzleLight!: THREE.PointLight;
  private gunMesh!: THREE.Group;
  private knifeMesh!: THREE.Group;

  private running = true;
  private raf = 0;
  private spawnTimer = 0;

  // Realism systems
  private sound = new SoundEngine();
  private rain!: THREE.Points;
  private rainPositions!: Float32Array;
  private lightningFlash = 0;
  private lightningTimer = 5 + Math.random() * 10;
  private shake = 0;
  private footstepCd = 0;

  constructor(container: HTMLElement, cb: GameCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);
    this.fog = new THREE.FogExp2(0x0a1015, 0.025);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 200);
    this.camera.position.copy(this.pos);

    this.buildWorld();
    this.buildPlayerWeapons();
    this.bindInput();

    window.addEventListener("resize", this.onResize);
    this.loop();

    this.cb.onHealth(this.hp);
    this.cb.onAmmo(this.ammo, this.weapon);
    this.cb.onKills(this.kills);
    this.cb.onMessage("Survive the forest...");
  }

  private buildWorld() {
    // Ambient — brighter so player can see scene
    this.ambient = new THREE.AmbientLight(0x4a5a70, 1.1);
    this.scene.add(this.ambient);

    // Moonlight
    const moon = new THREE.DirectionalLight(0x8aa6cc, 0.9);
    moon.position.set(20, 40, 10);
    this.scene.add(moon);

    // Hemisphere for sky/ground tint
    const hemi = new THREE.HemisphereLight(0x223344, 0x0a0f08, 0.6);
    this.scene.add(hemi);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.3) * 0.3 + Math.cos(y * 0.2) * 0.4 + Math.random() * 0.2);
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x35402a, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Trees
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 6, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 1 });
    const leafGeo = new THREE.ConeGeometry(2.2, 5, 8);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1a3018, roughness: 1 });
    for (let i = 0; i < 140; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 3;
      tree.add(trunk);
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.y = 7.5;
      tree.add(leaves);
      const angle = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 110;
      tree.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      tree.rotation.y = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.8;
      tree.scale.setScalar(s);
      this.scene.add(tree);
      this.trees.push(tree);
    }

    // Some rocks
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 1, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 100;
      rock.position.set(Math.cos(angle) * r, 0.3 + Math.random() * 0.4, Math.sin(angle) * r);
      rock.scale.setScalar(0.5 + Math.random() * 1.2);
      this.scene.add(rock);
    }

    // Flashlight attached to camera (no shadows for mobile perf)
    this.flashlight = new THREE.SpotLight(0xfff0c0, 60, 45, Math.PI / 6, 0.5, 1.2);
    this.camera.add(this.flashlight);
    this.flashlight.position.set(0.3, -0.2, 0);
    const target = new THREE.Object3D();
    target.position.set(0, 0, -1);
    this.camera.add(target);
    this.flashlight.target = target;

    // Muzzle flash light
    this.muzzleLight = new THREE.PointLight(0xffaa55, 0, 12, 2);
    this.camera.add(this.muzzleLight);
    this.muzzleLight.position.set(0.3, -0.2, -0.5);

    this.scene.add(this.camera);

    // Rain particles
    const rainCount = 1500;
    this.rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * 60;
      this.rainPositions[i * 3 + 1] = Math.random() * 25;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    const rainMat = new THREE.PointsMaterial({
      color: 0xaaccee, size: 0.08, transparent: true, opacity: 0.55,
      depthWrite: false,
    });
    this.rain = new THREE.Points(rainGeo, rainMat);
    this.scene.add(this.rain);
  }

  private buildPlayerWeapons() {
    // Gun
    this.gunMesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.18, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.3 })
    );
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.9, roughness: 0.2 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, -0.35);
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.22, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.8 })
    );
    grip.position.set(0, -0.18, 0.1);
    this.gunMesh.add(body, barrel, grip);
    this.gunMesh.position.set(0.13, -0.18, -0.4);
    this.camera.add(this.gunMesh);

    // Knife
    this.knifeMesh = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.02, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.15, emissive: 0x222222 })
    );
    blade.position.z = -0.2;
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.9 })
    );
    this.knifeMesh.add(blade, handle);
    this.knifeMesh.position.set(0.15, -0.18, -0.4);
    this.knifeMesh.visible = false;
    this.camera.add(this.knifeMesh);
  }

  private spawnEnemy() {
    const isGhost = Math.random() < 0.35;
    const enemy = new THREE.Group();
    if (isGhost) {
      // Flowing robe (cone tapered down, wide top)
      const robeGeo = new THREE.ConeGeometry(0.9, 2.4, 16, 6, true);
      const robeMat = new THREE.MeshStandardMaterial({
        color: 0xc8d8ee, transparent: true, opacity: 0.55,
        emissive: 0x6688bb, emissiveIntensity: 1.2,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const robe = new THREE.Mesh(robeGeo, robeMat);
      robe.position.y = 1.4;
      robe.rotation.x = Math.PI; // wide end up
      enemy.add(robe);

      // Outer aura (larger, more transparent)
      const auraGeo = new THREE.ConeGeometry(1.2, 2.8, 16, 4, true);
      const auraMat = new THREE.MeshBasicMaterial({
        color: 0x88aaff, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const aura = new THREE.Mesh(auraGeo, auraMat);
      aura.position.y = 1.4;
      aura.rotation.x = Math.PI;
      enemy.add(aura);

      // Skull head
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xaaccff, emissiveIntensity: 1.5,
        transparent: true, opacity: 0.9,
      });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), headMat);
      head.position.y = 2.4;
      head.scale.set(1, 1.15, 0.9);
      enemy.add(head);

      // Hollow black eye sockets
      const socketMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const socketL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), socketMat);
      socketL.position.set(-0.11, 2.45, 0.24);
      socketL.scale.set(1, 1.3, 0.5);
      const socketR = socketL.clone();
      socketR.position.x = 0.11;
      enemy.add(socketL, socketR);

      // Glowing eyes inside sockets
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ddff });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
      eyeL.position.set(-0.11, 2.45, 0.28);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.11;
      enemy.add(eyeL, eyeR);

      // Mouth (jagged dark slit)
      const mouth = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.06, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      );
      mouth.position.set(0, 2.25, 0.3);
      enemy.add(mouth);

      // Trailing wisps (small spheres at bottom for ghostly tail)
      for (let w = 0; w < 4; w++) {
        const wisp = new THREE.Mesh(
          new THREE.SphereGeometry(0.25 - w * 0.04, 8, 8),
          new THREE.MeshBasicMaterial({
            color: 0x88aaff, transparent: true, opacity: 0.25 - w * 0.04,
            depthWrite: false, blending: THREE.AdditiveBlending,
          })
        );
        wisp.position.y = 0.4 - w * 0.15;
        enemy.add(wisp);
      }

      const glow = new THREE.PointLight(0x66aaff, 3, 7);
      glow.position.y = 1.8;
      enemy.add(glow);
    } else {
      const skinMat = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.9 });
      const clothMat = new THREE.MeshStandardMaterial({ color: 0x2a1a18, roughness: 1 });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.35), clothMat);
      torso.position.y = 1.1;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), skinMat);
      head.position.y = 1.85;
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 2 });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
      eyeL.position.set(-0.1, 1.88, 0.22);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.1;
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.15), skinMat);
      armL.position.set(-0.4, 1.1, 0.2);
      armL.rotation.x = -0.6;
      const armR = armL.clone();
      armR.position.x = 0.4;
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.2), clothMat);
      legL.position.set(-0.15, 0.4, 0);
      const legR = legL.clone();
      legR.position.x = 0.15;
      enemy.add(torso, head, eyeL, eyeR, armL, armR, legL, legR);
      enemy.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    }

    // Spawn around player at distance
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 25;
    enemy.position.set(this.pos.x + Math.cos(angle) * dist, 0, this.pos.z + Math.sin(angle) * dist);
    this.scene.add(enemy);

    const origMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    enemy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) origMats.set(m, m.material);
    });

    this.enemies.push({
      mesh: enemy,
      type: isGhost ? "ghost" : "zombie",
      hp: isGhost ? 40 : 60,
      speed: isGhost ? 2.2 : 1.6,
      attackCd: 0,
      alive: true,
      hitFlash: 0,
      origMats,
      lastGrowl: 0,
    });
  }

  private bindInput() {
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = "none";

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    canvas.addEventListener("click", () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      this.attack();
    });
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === canvas) {
        this.yaw -= e.movementX * 0.0025;
        this.pitch -= e.movementY * 0.0025;
        this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
      }
    });

    // Touch look (right half of screen)
    canvas.addEventListener("touchstart", (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX > window.innerWidth / 2) {
          this.looking = true;
          this.lastTouchX = t.clientX;
          this.lastTouchY = t.clientY;
        }
      }
    });
    canvas.addEventListener("touchmove", (e) => {
      if (!this.looking) return;
      const t = e.touches[e.touches.length - 1];
      this.yaw -= (t.clientX - this.lastTouchX) * 0.005;
      this.pitch -= (t.clientY - this.lastTouchY) * 0.005;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
    });
    canvas.addEventListener("touchend", () => { this.looking = false; });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;
    if (e.code === "KeyF") this.toggleFlashlight();
    if (e.code === "Digit1") this.setWeapon("gun");
    if (e.code === "Digit2") this.setWeapon("knife");
    if (e.code === "KeyR") this.reload();
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };

  public setMoveInput(x: number, y: number) { this.moveInput.set(x, y); }
  public toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.flashlight.intensity = this.flashlightOn ? 60 : 0;
    this.cb.onMessage(this.flashlightOn ? "Flashlight ON" : "Flashlight OFF");
  }
  public setWeapon(w: "gun" | "knife") {
    this.weapon = w;
    this.gunMesh.visible = w === "gun";
    this.knifeMesh.visible = w === "knife";
    this.cb.onAmmo(this.ammo, this.weapon);
  }
  public reload() {
    if (this.weapon !== "gun") return;
    this.sound.init(); this.sound.reload();
    this.ammo = 24;
    this.cb.onAmmo(this.ammo, this.weapon);
    this.cb.onMessage("Reloaded");
  }
  public attack() { this.sound.init(); this.tryAttack(); }

  private tryAttack() {
    if (this.fireCd > 0) return;
    if (this.weapon === "gun") {
      if (this.ammo <= 0) { this.cb.onMessage("Out of ammo! Press R"); return; }
      this.ammo--;
      this.fireCd = 0.25;
      this.muzzleFlash = 0.08;
      this.shake = Math.max(this.shake, 0.25);
      this.sound.shoot();
      this.cb.onAmmo(this.ammo, this.weapon);
      this.raycastHit(60, 35);
    } else {
      this.fireCd = 0.4;
      this.sound.knife();
      this.raycastHit(2.5, 45);
    }
  }

  private raycastHit(maxDist: number, damage: number) {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    let closest: { e: Enemy; d: number } | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const hits = ray.intersectObject(e.mesh, true);
      if (hits.length && (!closest || hits[0].distance < closest.d)) {
        closest = { e, d: hits[0].distance };
      }
    }
    if (closest) {
      closest.e.hp -= damage;
      closest.e.hitFlash = 0.15;
      // Tint red
      const redMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
      closest.e.origMats.forEach((_, m) => { m.material = redMat; });
      if (closest.e.hp <= 0) this.killEnemy(closest.e);
      else this.cb.onMessage("Hit!");
    }
  }

  private killEnemy(e: Enemy) {
    e.alive = false;
    this.scene.remove(e.mesh);
    this.kills++;
    this.cb.onKills(this.kills);
    this.cb.onMessage(e.type === "ghost" ? "Ghost banished!" : "Zombie down!");
  }

  private updatePlayer(dt: number) {
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (this.keys["KeyW"]) move.add(forward);
    if (this.keys["KeyS"]) move.sub(forward);
    if (this.keys["KeyD"]) move.add(right);
    if (this.keys["KeyA"]) move.sub(right);
    if (this.moveInput.lengthSq() > 0.01) {
      move.add(forward.clone().multiplyScalar(-this.moveInput.y));
      move.add(right.clone().multiplyScalar(this.moveInput.x));
    }
    if (move.lengthSq() > 0) {
      move.normalize();
      const sprint = this.keys["ShiftLeft"] ? 1.6 : 1.0;
      this.pos.addScaledVector(move, 4 * sprint * dt);
      this.footstepCd -= dt;
      if (this.footstepCd <= 0) {
        this.sound.footstep();
        this.footstepCd = sprint > 1 ? 0.32 : 0.45;
      }
    }
    // Clamp inside world
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 120) { this.pos.x *= 120 / r; this.pos.z *= 120 / r; }
    this.pos.y = 1.7;
    this.camera.position.copy(this.pos);

    // Camera shake
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake -= dt * 1.5;
      if (this.shake < 0) this.shake = 0;
    }

    if (this.fireCd > 0) this.fireCd -= dt;

    const t = this.clock.getElapsedTime();
    const sway = move.lengthSq() > 0 ? 0.012 : 0.004;
    const baseX = 0.13, baseY = -0.18, baseZ = -0.4;

    if (this.muzzleFlash > 0) {
      this.muzzleLight.intensity = 12;
      this.muzzleFlash -= dt;
      const kick = this.muzzleFlash / 0.08; // 1 -> 0
      this.gunMesh.position.set(baseX, baseY + kick * 0.04, baseZ + kick * 0.08);
      this.gunMesh.rotation.x = kick * 0.3;
    } else {
      this.muzzleLight.intensity = 0;
      this.gunMesh.rotation.x = 0;
      this.gunMesh.position.x = baseX + Math.sin(t * 6) * sway;
      this.gunMesh.position.y = baseY + Math.abs(Math.cos(t * 6)) * sway;
      this.gunMesh.position.z = baseZ;
    }

    // Knife slash animation when attacking
    if (this.weapon === "knife" && this.fireCd > 0) {
      const p = 1 - this.fireCd / 0.4; // 0 -> 1
      const slash = Math.sin(p * Math.PI); // 0 -> 1 -> 0
      this.knifeMesh.position.set(baseX - slash * 0.25, baseY + slash * 0.1, baseZ - slash * 0.15);
      this.knifeMesh.rotation.z = slash * 1.2;
      this.knifeMesh.rotation.y = -slash * 0.8;
    } else {
      this.knifeMesh.rotation.set(0, 0, 0);
      this.knifeMesh.position.x = baseX + Math.sin(t * 6) * sway;
      this.knifeMesh.position.y = baseY + Math.abs(Math.cos(t * 6)) * sway;
      this.knifeMesh.position.z = baseZ;
    }
  }

  private updateEnemies(dt: number) {
    const t = this.clock.getElapsedTime();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const toPlayer = new THREE.Vector3(this.pos.x - e.mesh.position.x, 0, this.pos.z - e.mesh.position.z);
      const dist = toPlayer.length();
      if (dist > 0.01) toPlayer.normalize();

      // Stagger when hit
      const moveSpeed = e.hitFlash > 0 ? e.speed * 0.2 : e.speed;
      e.mesh.position.addScaledVector(toPlayer, moveSpeed * dt);
      e.mesh.lookAt(this.pos.x, e.mesh.position.y, this.pos.z);

      if (e.type === "ghost") {
        e.mesh.position.y = Math.sin(t * 2 + e.mesh.id) * 0.3;
      } else {
        e.mesh.position.y = Math.abs(Math.sin(t * 4 + e.mesh.id)) * 0.08;
      }

      // Restore materials after hit flash
      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        if (e.hitFlash <= 0) {
          e.origMats.forEach((mat, mesh) => { mesh.material = mat; });
        }
      }

      // Periodic growl/whisper if close enough
      if (dist < 18 && t - e.lastGrowl > 3 + Math.random() * 4) {
        e.lastGrowl = t;
        if (e.type === "zombie") this.sound.zombieGrowl();
        else this.sound.ghostWhisper();
      }

      e.attackCd -= dt;
      if (dist < 1.6 && e.attackCd <= 0) {
        e.attackCd = 1.2;
        const dmg = e.type === "ghost" ? 8 : 12;
        this.hp -= dmg;
        this.shake = Math.max(this.shake, 0.4);
        this.sound.hurt();
        this.cb.onHealth(Math.max(0, this.hp));
        this.cb.onDamage();
        this.cb.onMessage(e.type === "ghost" ? "Ghost touched you!" : "Zombie bite!");
        if (this.hp <= 0) {
          this.hp = 0;
          this.cb.onDeath();
          this.running = false;
        }
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private updateWeather(dt: number) {
    // Rain falls
    for (let i = 0; i < this.rainPositions.length; i += 3) {
      this.rainPositions[i + 1] -= 30 * dt;
      if (this.rainPositions[i + 1] < 0) {
        this.rainPositions[i] = this.pos.x + (Math.random() - 0.5) * 60;
        this.rainPositions[i + 1] = 22 + Math.random() * 5;
        this.rainPositions[i + 2] = this.pos.z + (Math.random() - 0.5) * 60;
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;

    // Lightning
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningTimer = 8 + Math.random() * 15;
      this.lightningFlash = 0.4;
      this.cb.onLightning();
      setTimeout(() => this.sound.thunder(), 600 + Math.random() * 800);
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash -= dt;
      const intensity = Math.max(0, this.lightningFlash) * 4;
      this.ambient.intensity = 1.1 + intensity;
    } else {
      this.ambient.intensity = 1.1;
    }
  }

  private loop = () => {
    if (!this.running) { this.renderer.render(this.scene, this.camera); return; }
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());

    this.spawnTimer -= dt;
    const targetCount = Math.min(12, 3 + Math.floor(this.kills / 3));
    if (this.spawnTimer <= 0 && this.enemies.length < targetCount) {
      this.spawnEnemy();
      this.spawnTimer = 2.5;
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateWeather(dt);
    this.renderer.render(this.scene, this.camera);
  };

  public dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    this.sound.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

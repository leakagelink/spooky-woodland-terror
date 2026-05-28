import * as THREE from "three";

export type GameCallbacks = {
  onHealth: (hp: number) => void;
  onAmmo: (ammo: number, weapon: string) => void;
  onKills: (kills: number) => void;
  onMessage: (msg: string) => void;
  onDeath: () => void;
};

type Enemy = {
  mesh: THREE.Group;
  type: "zombie" | "ghost";
  hp: number;
  speed: number;
  attackCd: number;
  alive: boolean;
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

  constructor(container: HTMLElement, cb: GameCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.7;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);
    this.fog = new THREE.FogExp2(0x05080a, 0.07);
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
    // Ambient very low
    this.ambient = new THREE.AmbientLight(0x0a1015, 0.4);
    this.scene.add(this.ambient);

    // Moonlight
    const moon = new THREE.DirectionalLight(0x4a6a90, 0.25);
    moon.position.set(20, 40, 10);
    this.scene.add(moon);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.3) * 0.3 + Math.cos(y * 0.2) * 0.4 + Math.random() * 0.2);
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2418, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Trees
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 6, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x231811, roughness: 1 });
    const leafGeo = new THREE.ConeGeometry(2.2, 5, 8);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x0a1a0c, roughness: 1 });
    for (let i = 0; i < 140; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 3;
      trunk.castShadow = true;
      tree.add(trunk);
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.y = 7.5;
      leaves.castShadow = true;
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
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 1, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 100;
      rock.position.set(Math.cos(angle) * r, 0.3 + Math.random() * 0.4, Math.sin(angle) * r);
      rock.scale.setScalar(0.5 + Math.random() * 1.2);
      rock.castShadow = true;
      this.scene.add(rock);
    }

    // Flashlight attached to camera
    this.flashlight = new THREE.SpotLight(0xfff0c0, 6, 35, Math.PI / 7, 0.4, 1.2);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
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
    this.gunMesh.position.set(0.3, -0.3, -0.6);
    this.camera.add(this.gunMesh);

    // Knife
    this.knifeMesh = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.02, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.15 })
    );
    blade.position.z = -0.2;
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.9 })
    );
    this.knifeMesh.add(blade, handle);
    this.knifeMesh.position.set(0.35, -0.3, -0.5);
    this.knifeMesh.visible = false;
    this.camera.add(this.knifeMesh);
  }

  private spawnEnemy() {
    const isGhost = Math.random() < 0.35;
    const enemy = new THREE.Group();
    if (isGhost) {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 12, 12),
        new THREE.MeshStandardMaterial({
          color: 0xaaccff, transparent: true, opacity: 0.5, emissive: 0x335577, emissiveIntensity: 0.6,
        })
      );
      body.position.y = 1.2;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 10, 10),
        new THREE.MeshStandardMaterial({
          color: 0xddeeff, transparent: true, opacity: 0.7, emissive: 0x6688aa, emissiveIntensity: 0.8,
        })
      );
      head.position.y = 2;
      enemy.add(body, head);
      const glow = new THREE.PointLight(0x6699cc, 1.5, 5);
      glow.position.y = 1.5;
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

    this.enemies.push({
      mesh: enemy,
      type: isGhost ? "ghost" : "zombie",
      hp: isGhost ? 40 : 60,
      speed: isGhost ? 2.2 : 1.6,
      attackCd: 0,
      alive: true,
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
    this.flashlight.intensity = this.flashlightOn ? 6 : 0;
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
    this.ammo = 24;
    this.cb.onAmmo(this.ammo, this.weapon);
    this.cb.onMessage("Reloaded");
  }
  public attack() { this.tryAttack(); }

  private tryAttack() {
    if (this.fireCd > 0) return;
    if (this.weapon === "gun") {
      if (this.ammo <= 0) { this.cb.onMessage("Out of ammo! Press R"); return; }
      this.ammo--;
      this.fireCd = 0.25;
      this.muzzleFlash = 0.08;
      this.cb.onAmmo(this.ammo, this.weapon);
      this.raycastHit(60, 35);
    } else {
      this.fireCd = 0.4;
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
    }
    // Clamp inside world
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 120) { this.pos.x *= 120 / r; this.pos.z *= 120 / r; }
    this.pos.y = 1.7;
    this.camera.position.copy(this.pos);

    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.muzzleFlash > 0) {
      this.muzzleLight.intensity = 8;
      this.muzzleFlash -= dt;
      // recoil
      this.gunMesh.position.z = -0.55 + Math.sin(this.muzzleFlash * 40) * 0.02;
    } else {
      this.muzzleLight.intensity = 0;
      this.gunMesh.position.z = -0.6;
    }

    // weapon sway
    const t = this.clock.getElapsedTime();
    const sway = move.lengthSq() > 0 ? 0.015 : 0.005;
    this.gunMesh.position.x = 0.3 + Math.sin(t * 6) * sway;
    this.gunMesh.position.y = -0.3 + Math.abs(Math.cos(t * 6)) * sway;
    this.knifeMesh.position.x = 0.35 + Math.sin(t * 6) * sway;
    this.knifeMesh.position.y = -0.3 + Math.abs(Math.cos(t * 6)) * sway;
  }

  private updateEnemies(dt: number) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const toPlayer = new THREE.Vector3(this.pos.x - e.mesh.position.x, 0, this.pos.z - e.mesh.position.z);
      const dist = toPlayer.length();
      if (dist > 0.01) toPlayer.normalize();
      e.mesh.position.addScaledVector(toPlayer, e.speed * dt);
      e.mesh.lookAt(this.pos.x, e.mesh.position.y, this.pos.z);

      if (e.type === "ghost") {
        e.mesh.position.y = Math.sin(this.clock.getElapsedTime() * 2 + e.mesh.id) * 0.3;
      } else {
        // zombie walk bob
        e.mesh.position.y = Math.abs(Math.sin(this.clock.getElapsedTime() * 4 + e.mesh.id)) * 0.08;
      }

      e.attackCd -= dt;
      if (dist < 1.6 && e.attackCd <= 0) {
        e.attackCd = 1.2;
        this.hp -= e.type === "ghost" ? 8 : 12;
        this.cb.onHealth(Math.max(0, this.hp));
        this.cb.onMessage(e.type === "ghost" ? "Ghost touched you!" : "Zombie bite!");
        if (this.hp <= 0) {
          this.hp = 0;
          this.cb.onDeath();
          this.running = false;
        }
      }
    }
    // cull dead
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

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
    this.renderer.render(this.scene, this.camera);
  };

  public dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

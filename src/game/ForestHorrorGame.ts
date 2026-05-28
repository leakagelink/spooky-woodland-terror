import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SoundEngine } from "./SoundEngine";

export type GameCallbacks = {
  onHealth: (hp: number) => void;
  onAmmo: (ammo: number, weapon: string) => void;
  onKills: (kills: number) => void;
  onMessage: (msg: string) => void;
  onDeath: () => void;
  onDamage: () => void;
  onLightning: () => void;
  onWave?: (wave: number) => void;
  onScore?: (score: number, high: number) => void;
  onStamina?: (s: number) => void;
  onPause?: (paused: boolean) => void;
  onMinimap?: (data: { px: number; pz: number; yaw: number; enemies: { x: number; z: number; kind: string }[]; pickups: { x: number; z: number; kind: string }[] }) => void;
};

type ZombieVariant = "normal" | "runner" | "tank" | "charger";
export type GrenadeKind = "frag" | "smoke" | "incendiary";
export type Difficulty = "easy" | "normal" | "hard";
type BurnZone = { mesh: THREE.Mesh; pos: THREE.Vector3; t: number; radius: number; ringMat: THREE.Material };

export type WeaponKind = "gun" | "shotgun" | "sniper" | "knife";

type WeaponSpec = {
  maxAmmo: number;
  fireCd: number;
  damage: number;
  range: number;
  pellets: number;
  spread: number; // radians
  reloadDur: number;
  adsFov: number; // FOV when ADS-ing
  hipSpread: number;
};

const WEAPON_SPECS: Record<WeaponKind, WeaponSpec> = {
  gun:     { maxAmmo: 24, fireCd: 0.18, damage: 35, range: 70,  pellets: 1, spread: 0.012, reloadDur: 1.6, adsFov: 55, hipSpread: 0.025 },
  shotgun: { maxAmmo: 6,  fireCd: 0.75, damage: 22, range: 30,  pellets: 8, spread: 0.14,  reloadDur: 2.2, adsFov: 62, hipSpread: 0.18 },
  sniper:  { maxAmmo: 5,  fireCd: 1.2,  damage: 220, range: 180, pellets: 1, spread: 0.003, reloadDur: 2.4, adsFov: 18, hipSpread: 0.08 },
  knife:   { maxAmmo: 0,  fireCd: 0.4,  damage: 45, range: 2.5, pellets: 1, spread: 0,      reloadDur: 0,   adsFov: 75, hipSpread: 0 },
};


type Enemy = {
  mesh: THREE.Object3D;
  type: "zombie" | "ghost" | "giant_ent" | "fallen_angel";
  variant?: ZombieVariant;
  hp: number;
  speed: number;
  attackCd: number;
  alive: boolean;
  hitFlash: number;
  origMats: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  lastGrowl: number;
  limbs?: {
    armL: THREE.Object3D;
    armR: THREE.Object3D;
    legL: THREE.Object3D;
    legR: THREE.Object3D;
    head: THREE.Object3D;
    torso: THREE.Object3D;
    jaw?: THREE.Object3D;
  };
  phase: number;
  mixer?: THREE.AnimationMixer;
  isFbxModel?: boolean;
  isGiant?: boolean;
  attackRange?: number;
  damage?: number;
  scoreValue?: number;
  slowT?: number;
  burnT?: number;
  knockback?: number;
};

type Pickup = {
  mesh: THREE.Object3D;
  kind: "medkit" | "ammo";
  pos: THREE.Vector3;
  bob: number;
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
  private weapon: WeaponKind = "gun";
  private ammo = 24;
  private fireCd = 0;
  private flashlightOn = true;
  private muzzleFlash = 0;

  // ADS + crouch
  private adsing = false;
  private adsT = 0; // 0 = hip, 1 = ADS
  private baseFov = 75;
  private crouching = false;
  private crouchT = 0; // 0 = stand, 1 = crouch

  // Grenades
  private grenadeCount = 3;
  private grenades: { mesh: THREE.Mesh; vel: THREE.Vector3; t: number }[] = [];

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
  private shotgunMesh!: THREE.Group;
  private sniperMesh!: THREE.Group;
  private knifeMesh!: THREE.Group;


  private running = true;
  private paused = false;
  private raf = 0;
  private spawnTimer = 0;
  private maxActiveZombies = 3;

  // Wave + score
  private wave = 1;
  private waveKills = 0;
  private readonly killsPerWave = 8;
  private score = 0;
  private highScore = 0;

  // Stamina
  private stamina = 100;
  private sprinting = false;

  // Pickups
  private pickups: Pickup[] = [];

  // Minimap throttle
  private minimapCd = 0;


  // Realism systems
  private sound = new SoundEngine();
  private rain!: THREE.Points;
  private rainPositions!: Float32Array;
  private lightningFlash = 0;
  private lightningTimer = 5 + Math.random() * 10;
  private shake = 0;
  private footstepCd = 0;

  // FBX zombie model
  private zombieTemplate: THREE.Group | null = null;
  private zombieAnimations: THREE.AnimationClip[] = [];
  // Giant ent (boss) model
  private giantEntTemplate: THREE.Group | null = null;
  private giantEntAnimations: THREE.AnimationClip[] = [];
  private giantSpawned = false;
  // Fallen angel boss (12x normal zombie)
  private fallenAngelTemplate: THREE.Group | null = null;
  private fallenAngelAnimations: THREE.AnimationClip[] = [];
  private angelSpawned = false;

  // Post-processing
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private grainPass!: ShaderPass;

  // Reload state
  private reloading = 0; // seconds remaining; 0 = not reloading
  private readonly reloadDuration = 1.6;
  private magMesh!: THREE.Mesh;

  constructor(container: HTMLElement, cb: GameCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.fog = new THREE.FogExp2(0xc8e0c8, 0.012);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      200,
    );
    this.camera.position.copy(this.pos);

    this.buildWorld();
    this.buildPlayerWeapons();
    this.bindInput();
    this.setupPostProcessing();
    this.loadZombieModel();
    this.loadGiantEntModel();
    this.loadFallenAngelModel();
    // Load user-provided forest GLB (materials normalized to standard PBR)
    this.loadForestAssets();

    window.addEventListener("resize", this.onResize);
    this.loop();

    // Load high score
    try {
      const hs = localStorage.getItem("darkforest_highscore");
      if (hs) this.highScore = parseInt(hs, 10) || 0;
    } catch {}

    this.cb.onHealth(this.hp);
    this.cb.onAmmo(this.ammo, this.weapon);
    this.cb.onKills(this.kills);
    this.cb.onMessage("Wave 1 — Survive...");
    this.cb.onWave?.(this.wave);
    this.cb.onScore?.(this.score, this.highScore);
    this.cb.onStamina?.(this.stamina);
  }


  private loadZombieModel() {
    const loader = new FBXLoader();
    loader.load(
      "/models/zombie/zombie.fbx",
      (fbx) => {
        const texLoader = new THREE.TextureLoader();
        const tex = texLoader.load("/models/zombie/world_people_colors.png");
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;

        // Normalize scale: FBX often comes in cm, we want ~1.8 units tall
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.8 / (size.y || 1);
        fbx.scale.setScalar(scale);

        // Apply texture + zombie tint to all meshes
        fbx.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            const mat = new THREE.MeshStandardMaterial({
              map: tex,
              color: 0x88aa6a, // sickly green tint over texture
              roughness: 0.9,
              metalness: 0,
              emissive: 0x1a0a08,
              emissiveIntensity: 0.15,
            });
            m.material = mat;
          }
        });

        this.zombieTemplate = fbx;
        this.zombieAnimations = fbx.animations || [];
        this.cb.onMessage("Survive the forest...");
      },
      undefined,
      (err) => {
        console.warn("Failed to load zombie FBX, using fallback geometry", err);
        this.cb.onMessage("Survive the forest...");
      },
    );
  }

  private loadGiantEntModel() {
    const loader = new FBXLoader();
    loader.load(
      "/models/enemies/giant_ent.fbx",
      (fbx) => {
        const texLoader = new THREE.TextureLoader();
        const tex = texLoader.load(
          "/models/enemies/giant_ent.fbm/dunklerwaldent3d-modell_basecolor.JPEG",
        );
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;

        // Normalize to ~6m tall base (will scale further at spawn)
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const baseScale = 6.0 / (size.y || 1);
        fbx.scale.setScalar(baseScale);

        fbx.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.material = new THREE.MeshStandardMaterial({
              map: tex,
              color: 0x6b5a3a,
              roughness: 0.95,
              metalness: 0.0,
              emissive: 0x1a0a02,
              emissiveIntensity: 0.2,
            });
          }
        });

        this.giantEntTemplate = fbx;
        this.giantEntAnimations = fbx.animations || [];
      },
      undefined,
      (err) => {
        console.warn("Failed to load giant ent FBX", err);
      },
    );
  }

  private loadFallenAngelModel() {
    const loader = new FBXLoader();
    loader.load(
      "/models/enemies/fallen_angel.fbx",
      (fbx) => {
        const texLoader = new THREE.TextureLoader();
        const tex = texLoader.load(
          "/models/enemies/fallen_angel.fbm/fallenangelwarrior3dmodel_basecolor.JPEG",
        );
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;

        // Normalize to ~3.5m tall - imposing but not as huge as the ent
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const baseScale = 3.5 / (size.y || 1);
        fbx.scale.setScalar(baseScale);

        fbx.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.material = new THREE.MeshStandardMaterial({
              map: tex,
              color: 0xb0a890,
              roughness: 0.55,
              metalness: 0.45,
              emissive: 0x330000,
              emissiveIntensity: 0.4,
            });
          }
        });

        this.fallenAngelTemplate = fbx;
        this.fallenAngelAnimations = fbx.animations || [];
      },
      undefined,
      (err) => {
        console.warn("Failed to load fallen angel FBX", err);
      },
    );
  }




  private loadForestAssets() {
    const loader = new GLTFLoader();
    loader.load(
      "/models/forest/coniferous_forest_assets_pack.glb",
      (gltf) => {
        // Collect top-level children as prototypes (trees, rocks, plants, etc.)
        const prototypes: THREE.Object3D[] = [];
        gltf.scene.children.forEach((c) => prototypes.push(c));
        if (prototypes.length === 0) return;

        // Convert any spec-gloss / unsupported materials to MeshStandardMaterial
        // so they render with proper color instead of plain white.
        prototypes.forEach((p) => {
          p.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.castShadow = false;
            m.receiveShadow = true;
            const oldMats = Array.isArray(m.material) ? m.material : [m.material];
            const newMats = oldMats.map((om: any) => {
              const map = om?.map ?? om?.diffuseMap ?? null;
              const normalMap = om?.normalMap ?? null;
              const color = om?.color ? om.color.clone() : new THREE.Color(0x6b8050);
              // If material had no diffuse map AND was white, give it a foliage tint
              if (!map && color.r > 0.9 && color.g > 0.9 && color.b > 0.9) {
                color.setHex(0x5a7a3a);
              }
              if (map) map.colorSpace = THREE.SRGBColorSpace;
              const mat = new THREE.MeshStandardMaterial({
                map,
                normalMap,
                color: map ? 0xffffff : color,
                roughness: 0.92,
                metalness: 0.0,
                transparent: !!(om?.transparent || om?.alphaTest),
                alphaTest: om?.alphaTest || (om?.transparent ? 0.3 : 0),
                side: THREE.DoubleSide,
              });
              return mat;
            });
            m.material = Array.isArray(m.material) ? newMats : newMats[0];
          });
        });

        // Remove old procedural trees
        this.trees.forEach((t) => this.scene.remove(t));
        this.trees.length = 0;

        // Scatter realistic instances
        const count = 180;
        for (let i = 0; i < count; i++) {
          const proto = prototypes[Math.floor(Math.random() * prototypes.length)];
          const inst = proto.clone(true);
          // Normalize scale to ~5-10m tall depending on asset
          const box = new THREE.Box3().setFromObject(inst);
          const size = box.getSize(new THREE.Vector3());
          const targetH = 5 + Math.random() * 6;
          const s = size.y > 0.01 ? targetH / size.y : 1;
          inst.scale.setScalar(s * (0.8 + Math.random() * 0.5));

          const angle = Math.random() * Math.PI * 2;
          const r = 8 + Math.random() * 110;
          inst.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
          inst.rotation.y = Math.random() * Math.PI * 2;

          this.scene.add(inst);
          this.trees.push(inst);
        }
      },
      undefined,
      (err) => {
        console.warn("Failed to load forest GLB, keeping procedural trees", err);
      },
    );
  }

  private buildWorld() {
    // Ambient — bright daylight
    this.ambient = new THREE.AmbientLight(0x9ab8d0, 1.6);
    this.scene.add(this.ambient);

    // Sunlight — primary shadow caster
    const sun = new THREE.DirectionalLight(0xfff5d1, 1.8);
    sun.position.set(20, 45, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);

    // Hemisphere for sky/ground tint (daytime)
    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x4a7a3a, 0.9);
    this.scene.add(hemi);

    // Texture loader for PBR forest assets
    const texLoader = new THREE.TextureLoader();
    const loadTex = (path: string, repeat = 1, srgb = false) => {
      const t = texLoader.load(path);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };

    // Ground — tiled dirt PBR
    const groundGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
    const gpos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gpos.count; i++) {
      const x = gpos.getX(i),
        y = gpos.getY(i);
      gpos.setZ(i, Math.sin(x * 0.3) * 0.3 + Math.cos(y * 0.2) * 0.4 + Math.random() * 0.2);
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
      map: loadTex("/textures/forest/Ground_Dirt_Diffuse.jpeg", 40, true),
      normalMap: loadTex("/textures/forest/Ground_Dirt_Normal.jpeg", 40),
      roughnessMap: loadTex("/textures/forest/Ground_Dirt_Roughness.jpeg", 40),
      color: 0x6b5a3a,
      roughness: 1,
      metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grass blade patches scattered around
    const grassDiffuse = loadTex("/textures/forest/Grass_Vegetation_Green_Diffuse.png", 1, true);
    const grassOpacity = loadTex("/textures/forest/Grass_Vegetation_Opacity.png", 1);
    const grassMat = new THREE.MeshStandardMaterial({
      map: grassDiffuse,
      alphaMap: grassOpacity,
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 1,
    });
    const grassGeo = new THREE.PlaneGeometry(1.2, 0.8);
    for (let i = 0; i < 220; i++) {
      const g = new THREE.Mesh(grassGeo, grassMat);
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 110;
      g.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r);
      g.rotation.y = Math.random() * Math.PI;
      g.scale.setScalar(0.7 + Math.random() * 0.9);
      this.scene.add(g);
    }

    // Trees — realistic oak trunk + bush canopy
    const trunkMap = loadTex("/textures/forest/Trunk_Oak_Diffuse.png", 1, true);
    const trunkNormal = loadTex("/textures/forest/Trunk_Oak_Normal.png", 1);
    const trunkRough = loadTex("/textures/forest/Trunk_Oak_Roughness.png", 1);
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 7, 10);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: trunkMap,
      normalMap: trunkNormal,
      roughnessMap: trunkRough,
      color: 0x8a6a45,
      roughness: 1,
    });
    const leafDiff = loadTex("/textures/forest/Bush_Leaves_Diffuse.png", 1, true);
    const leafNormal = loadTex("/textures/forest/Bush_Leaves_Normal.png", 1);
    const leafOpacity = loadTex("/textures/forest/Bush_Leaves_Opacity.png", 1);
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafDiff,
      normalMap: leafNormal,
      alphaMap: leafOpacity,
      transparent: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      color: 0x6b8a3c,
      roughness: 1,
    });
    const leafGeo = new THREE.SphereGeometry(2.4, 8, 6);
    for (let i = 0; i < 140; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 3.5;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);
      // Multi-cluster canopy for fuller look
      for (let j = 0; j < 3; j++) {
        const leaves = new THREE.Mesh(leafGeo, leafMat);
        leaves.position.set(
          (Math.random() - 0.5) * 1.5,
          7 + Math.random() * 1.2,
          (Math.random() - 0.5) * 1.5,
        );
        leaves.scale.setScalar(0.8 + Math.random() * 0.5);
        tree.add(leaves);
      }
      const angle = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 110;
      tree.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      tree.rotation.y = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.8;
      tree.scale.setScalar(s);
      this.scene.add(tree);
      this.trees.push(tree);
    }

    // Realistic rocks
    const rockMat = new THREE.MeshStandardMaterial({
      map: loadTex("/textures/forest/Broken_Rocks_Diffuse.jpeg", 1, true),
      normalMap: loadTex("/textures/forest/Broken_Rocks_Normal.jpeg", 1),
      roughnessMap: loadTex("/textures/forest/Broken_Rocks_Roughness.jpeg", 1),
      color: 0x6a6a70,
      roughness: 1,
      flatShading: true,
    });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 40; i++) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 100;
      rock.position.set(Math.cos(angle) * r, 0.3 + Math.random() * 0.4, Math.sin(angle) * r);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.scale.setScalar(0.5 + Math.random() * 1.5);
      this.scene.add(rock);
    }

    // Flashlight attached to camera — dimmer in daytime (more of a tactical light)
    this.flashlight = new THREE.SpotLight(0xfff0c0, 20, 45, Math.PI / 6, 0.5, 1.2);
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
      color: 0xccddff,
      size: 0.06,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.rain = new THREE.Points(rainGeo, rainMat);
    this.scene.add(this.rain);
  }

  private buildPlayerWeapons() {
    // Gun — detailed dark first-person rifle built from reliable geometry.
    // The imported SCAR FBX had broken/white materials, so keep this non-white model always visible.
    this.gunMesh = new THREE.Group();
    const gunMetal = new THREE.MeshStandardMaterial({
      color: 0x15181d,
      metalness: 0.85,
      roughness: 0.32,
      emissive: 0x030405,
    });
    const blackPolymer = new THREE.MeshStandardMaterial({
      color: 0x08090b,
      metalness: 0.2,
      roughness: 0.78,
      emissive: 0x020202,
    });
    const wornEdge = new THREE.MeshStandardMaterial({
      color: 0x33383f,
      metalness: 0.9,
      roughness: 0.28,
    });
    const brass = new THREE.MeshStandardMaterial({
      color: 0x8a6426,
      metalness: 0.7,
      roughness: 0.38,
    });

    const boxPart = (
      size: [number, number, number],
      pos: [number, number, number],
      mat: THREE.Material,
      rot: [number, number, number] = [0, 0, 0],
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      this.gunMesh.add(mesh);
      return mesh;
    };
    const cylPart = (
      radiusTop: number,
      radiusBottom: number,
      depth: number,
      pos: [number, number, number],
      mat: THREE.Material,
      rot: [number, number, number] = [Math.PI / 2, 0, 0],
      segments = 18,
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radiusTop, radiusBottom, depth, segments),
        mat,
      );
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      this.gunMesh.add(mesh);
      return mesh;
    };

    boxPart([0.18, 0.12, 0.42], [0, -0.02, -0.13], gunMetal);
    boxPart([0.2, 0.07, 0.38], [0, 0.04, -0.38], blackPolymer);
    boxPart([0.2, 0.025, 0.62], [0, 0.12, -0.25], wornEdge);
    cylPart(0.025, 0.03, 0.55, [0, 0.06, -0.66], gunMetal);
    cylPart(0.045, 0.045, 0.13, [0, 0.06, -0.98], blackPolymer);
    boxPart([0.12, 0.27, 0.11], [0, -0.23, -0.04], blackPolymer, [-0.18, 0, 0]);
    boxPart([0.09, 0.26, 0.12], [0, -0.23, 0.17], blackPolymer, [0.24, 0, 0]);
    boxPart([0.15, 0.09, 0.27], [0, -0.02, 0.31], blackPolymer);
    boxPart([0.18, 0.04, 0.09], [0, -0.05, 0.48], blackPolymer);
    cylPart(0.045, 0.045, 0.28, [0, 0.19, -0.23], blackPolymer);
    cylPart(0.032, 0.032, 0.32, [0, 0.19, -0.23], gunMetal);
    boxPart([0.04, 0.06, 0.03], [-0.06, 0.14, -0.23], wornEdge);
    boxPart([0.04, 0.06, 0.03], [0.06, 0.14, -0.23], wornEdge);
    boxPart([0.05, 0.055, 0.03], [0, 0.16, -0.55], wornEdge);
    boxPart([0.05, 0.06, 0.035], [0, 0.15, -0.82], wornEdge);
    boxPart([0.025, 0.035, 0.08], [0.105, 0.03, -0.05], brass);

    // Detachable magazine — animated during reload
    this.magMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.22, 0.09),
      blackPolymer,
    );
    this.magMesh.position.set(0, -0.18, -0.08);
    this.gunMesh.add(this.magMesh);

    this.gunMesh.position.set(0.13, -0.18, -0.4);
    this.gunMesh.rotation.set(-0.02, -0.08, 0.02);
    this.camera.add(this.gunMesh);

    // Try to load the user-provided SCAR rifle. On success, replace the
    // procedural geometry with the real model (keeps mag for reload anim).
    const gunLoader = new FBXLoader();
    gunLoader.load(
      "/models/weapons/scar.fbx",
      (fbx) => {
        const texLoader = new THREE.TextureLoader();
        const gunTex = texLoader.load("/models/weapons/gun_texture.png");
        gunTex.colorSpace = THREE.SRGBColorSpace;
        gunTex.flipY = false;

        fbx.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = new THREE.MeshStandardMaterial({
              map: gunTex,
              color: 0xffffff,
              metalness: 0.75,
              roughness: 0.4,
            });
            m.castShadow = false;
          }
        });

        // Normalize size to ~0.55 units long along Z
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const s = 0.55 / maxDim;
        fbx.scale.setScalar(s);
        fbx.rotation.set(0, Math.PI, 0);
        fbx.position.set(0, 0, 0);

        // Remove procedural parts but keep the magazine for reload animation
        const toRemove = this.gunMesh.children.filter((c) => c !== this.magMesh);
        toRemove.forEach((c) => this.gunMesh.remove(c));
        this.gunMesh.add(fbx);
      },
      undefined,
      (err) => {
        console.warn("SCAR FBX failed to load, keeping procedural gun", err);
      },
    );

    // Knife
    this.knifeMesh = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.02, 0.35),
      new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 1,
        roughness: 0.15,
        emissive: 0x222222,
      }),
    );
    blade.position.z = -0.2;
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.9 }),
    );
    this.knifeMesh.add(blade, handle);
    this.knifeMesh.position.set(0.15, -0.18, -0.4);
    this.knifeMesh.visible = false;
    this.camera.add(this.knifeMesh);

    // ===== Shotgun — short pump-action, double barrel =====
    this.shotgunMesh = new THREE.Group();
    const sgMetal = new THREE.MeshStandardMaterial({ color: 0x1a1a20, metalness: 0.8, roughness: 0.4 });
    const sgWood = new THREE.MeshStandardMaterial({ color: 0x4a2810, metalness: 0.1, roughness: 0.85 });
    const sgDark = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.3, roughness: 0.7 });
    const sgAdd = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...p); m.rotation.set(...r);
      this.shotgunMesh.add(m); return m;
    };
    sgAdd(new THREE.BoxGeometry(0.16, 0.1, 0.3), sgMetal, [0, 0, -0.12]); // receiver
    sgAdd(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 14), sgMetal, [-0.04, 0.08, -0.5], [Math.PI / 2, 0, 0]); // barrel L
    sgAdd(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 14), sgMetal, [0.04, 0.08, -0.5], [Math.PI / 2, 0, 0]); // barrel R
    sgAdd(new THREE.BoxGeometry(0.16, 0.05, 0.35), sgWood, [0, -0.04, -0.5]); // forend
    sgAdd(new THREE.BoxGeometry(0.08, 0.22, 0.1), sgWood, [0, -0.18, 0.05], [-0.25, 0, 0]); // grip
    sgAdd(new THREE.BoxGeometry(0.1, 0.13, 0.32), sgWood, [0, -0.05, 0.22], [0.12, 0, 0]); // stock
    sgAdd(new THREE.BoxGeometry(0.04, 0.05, 0.04), sgDark, [0, 0.13, -0.78]); // bead sight
    this.shotgunMesh.position.set(0.13, -0.18, -0.4);
    this.shotgunMesh.rotation.set(-0.02, -0.08, 0.02);
    this.shotgunMesh.visible = false;
    this.camera.add(this.shotgunMesh);

    // ===== Sniper — long bolt-action with scope =====
    this.sniperMesh = new THREE.Group();
    const snMetal = new THREE.MeshStandardMaterial({ color: 0x12141a, metalness: 0.9, roughness: 0.3 });
    const snStock = new THREE.MeshStandardMaterial({ color: 0x2a3025, metalness: 0.1, roughness: 0.9 });
    const snScope = new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.6, roughness: 0.4 });
    const snLens = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.9, roughness: 0.1, emissive: 0x112233, emissiveIntensity: 0.3 });
    const snAdd = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...p); m.rotation.set(...r);
      this.sniperMesh.add(m); return m;
    };
    snAdd(new THREE.BoxGeometry(0.14, 0.1, 0.5), snMetal, [0, -0.02, -0.15]); // receiver
    snAdd(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 14), snMetal, [0, 0.05, -0.8], [Math.PI / 2, 0, 0]); // long barrel
    snAdd(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 14), snMetal, [0, 0.05, -1.28], [Math.PI / 2, 0, 0]); // muzzle brake
    snAdd(new THREE.BoxGeometry(0.13, 0.09, 0.45), snStock, [0, -0.08, 0.25]); // stock
    snAdd(new THREE.BoxGeometry(0.08, 0.2, 0.1), snStock, [0, -0.2, 0.0], [-0.2, 0, 0]); // grip
    // Scope
    snAdd(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 16), snScope, [0, 0.18, -0.15], [Math.PI / 2, 0, 0]);
    snAdd(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 16), snScope, [0, 0.18, -0.32], [Math.PI / 2, 0, 0]);
    snAdd(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16), snScope, [0, 0.18, 0.02], [Math.PI / 2, 0, 0]);
    snAdd(new THREE.CircleGeometry(0.05, 16), snLens, [0, 0.18, 0.06]);
    snAdd(new THREE.BoxGeometry(0.03, 0.1, 0.03), snScope, [0, 0.13, -0.15]); // scope mount
    snAdd(new THREE.BoxGeometry(0.06, 0.04, 0.18), snMetal, [0, -0.08, -0.05]); // mag
    this.sniperMesh.position.set(0.13, -0.18, -0.35);
    this.sniperMesh.rotation.set(-0.02, -0.08, 0.02);
    this.sniperMesh.visible = false;
    this.camera.add(this.sniperMesh);
  }


  private spawnEnemy() {
    if (!this.zombieTemplate) return;
    if (this.enemies.length >= this.maxActiveZombies) return;

    // Pick variant — chance increases with wave
    let variant: ZombieVariant = "normal";
    const roll = Math.random();
    const runnerChance = Math.min(0.4, 0.1 + this.wave * 0.05);
    const tankChance = Math.min(0.25, 0.05 + this.wave * 0.03);
    if (roll < runnerChance) variant = "runner";
    else if (roll < runnerChance + tankChance) variant = "tank";

    const enemy = new THREE.Group();
    const model = SkeletonUtils.clone(this.zombieTemplate) as THREE.Group;

    // Variant tint + scale
    let tint: THREE.Color;
    let scaleMul = 1;
    let hp = 60;
    let speed = 1.6;
    let damage = 12;
    let scoreValue = 100;
    if (variant === "runner") {
      tint = new THREE.Color(0x8a2a2a);
      scaleMul = 0.9;
      hp = 35;
      speed = 3.2;
      damage = 8;
      scoreValue = 150;
    } else if (variant === "tank") {
      tint = new THREE.Color(0x2a3a1a);
      scaleMul = 1.35;
      hp = 180;
      speed = 1.0;
      damage = 22;
      scoreValue = 300;
    } else {
      tint = new THREE.Color().setHSL(
        0.25 + Math.random() * 0.08,
        0.3 + Math.random() * 0.2,
        0.32 + Math.random() * 0.1,
      );
    }
    model.scale.multiplyScalar(scaleMul);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.copy(tint);
        if (variant === "tank") {
          mat.emissive = new THREE.Color(0x220011);
          mat.emissiveIntensity = 0.25;
        } else if (variant === "runner") {
          mat.emissive = new THREE.Color(0x441100);
          mat.emissiveIntensity = 0.35;
        }
        m.material = mat;
        m.castShadow = true;
      }
    });
    enemy.add(model);

    let mixer: THREE.AnimationMixer | undefined;
    if (this.zombieAnimations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      const clip = this.zombieAnimations[0];
      const action = mixer.clipAction(clip);
      // Runners animate faster, tanks slower
      const baseTs = variant === "runner" ? 1.8 : variant === "tank" ? 0.7 : 1;
      action.timeScale = baseTs + Math.random() * 0.25;
      action.play();
    }

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
      type: "zombie",
      variant,
      hp,
      speed,
      attackCd: 0,
      alive: true,
      hitFlash: 0,
      origMats,
      lastGrowl: 0,
      phase: Math.random() * Math.PI * 2,
      mixer,
      isFbxModel: true,
      damage,
      scoreValue,
    });
  }


  private spawnGiantEnt() {
    if (!this.giantEntTemplate) return;
    if (this.giantSpawned) return;

    const enemy = new THREE.Group();
    const model = SkeletonUtils.clone(this.giantEntTemplate) as THREE.Group;

    // Make it tower over normal zombies
    model.scale.multiplyScalar(1.4);

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        // Dark corrupted bark tint
        mat.color.setHex(0x4a3a22);
        mat.emissive = new THREE.Color(0x331100);
        mat.emissiveIntensity = 0.35;
        m.material = mat;
        m.castShadow = true;
      }
    });
    enemy.add(model);

    let mixer: THREE.AnimationMixer | undefined;
    if (this.giantEntAnimations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(this.giantEntAnimations[0]);
      action.timeScale = 0.6;
      action.play();
    }

    // Spawn far from player
    const angle = Math.random() * Math.PI * 2;
    const dist = 35 + Math.random() * 15;
    enemy.position.set(
      this.pos.x + Math.cos(angle) * dist,
      0,
      this.pos.z + Math.sin(angle) * dist,
    );

    // Ominous green glow around the giant
    const glow = new THREE.PointLight(0x66ff66, 3, 18, 2);
    glow.position.y = 4;
    enemy.add(glow);

    this.scene.add(enemy);

    const origMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    enemy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) origMats.set(m, m.material);
    });

    this.enemies.push({
      mesh: enemy,
      type: "giant_ent",
      hp: 600, // 10x normal zombie (60)
      speed: 1.3, // slower but relentless
      attackCd: 0,
      alive: true,
      hitFlash: 0,
      origMats,
      lastGrowl: 0,
      phase: Math.random() * Math.PI * 2,
      mixer,
      isFbxModel: true,
      isGiant: true,
      attackRange: 4.5,
      damage: 120, // 10x normal zombie (12)
    });

    this.giantSpawned = true;
    this.cb.onMessage("⚠ A GIANT FOREST ENT AWAKENS ⚠");
    this.sound.thunder();
    this.shake = Math.max(this.shake, 0.6);
  }

  private spawnFallenAngel() {
    if (!this.fallenAngelTemplate) return;
    if (this.angelSpawned) return;

    const enemy = new THREE.Group();
    const model = SkeletonUtils.clone(this.fallenAngelTemplate) as THREE.Group;

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        // Corrupted celestial tone - pale armor with crimson glow
        mat.color.setHex(0x9a8870);
        mat.emissive = new THREE.Color(0x550011);
        mat.emissiveIntensity = 0.55;
        m.material = mat;
        m.castShadow = true;
      }
    });
    enemy.add(model);

    let mixer: THREE.AnimationMixer | undefined;
    if (this.fallenAngelAnimations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(this.fallenAngelAnimations[0]);
      action.timeScale = 1.0;
      action.play();
    }

    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 15;
    enemy.position.set(
      this.pos.x + Math.cos(angle) * dist,
      0,
      this.pos.z + Math.sin(angle) * dist,
    );

    // Crimson holy/unholy glow
    const glow = new THREE.PointLight(0xff2244, 4, 20, 2);
    glow.position.y = 2.5;
    enemy.add(glow);

    this.scene.add(enemy);

    const origMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    enemy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) origMats.set(m, m.material);
    });

    this.enemies.push({
      mesh: enemy,
      type: "fallen_angel",
      hp: 720, // 12x normal zombie (60)
      speed: 2.6, // fast & relentless
      attackCd: 0,
      alive: true,
      hitFlash: 0,
      origMats,
      lastGrowl: 0,
      phase: Math.random() * Math.PI * 2,
      mixer,
      isFbxModel: true,
      isGiant: true,
      attackRange: 3.0,
      damage: 144, // 12x normal zombie (12)
    });

    this.angelSpawned = true;
    this.cb.onMessage("⚔ A FALLEN ANGEL DESCENDS ⚔");
    this.sound.thunder();
    this.shake = Math.max(this.shake, 0.7);
  }





  private bindInput() {
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = "none";

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    canvas.addEventListener("mousedown", (e) => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      if (e.button === 0) this.attack();
      if (e.button === 2) this.setAds(true);
    });
    canvas.addEventListener("mouseup", (e) => {
      if (e.button === 2) this.setAds(false);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === canvas) {
        // ADS reduces mouse sensitivity (steadier aim)
        const sens = this.adsing ? 0.0011 : 0.0025;
        this.yaw -= e.movementX * sens;
        this.pitch -= e.movementY * sens;
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
      const sens = this.adsing ? 0.0022 : 0.005;
      this.yaw -= (t.clientX - this.lastTouchX) * sens;
      this.pitch -= (t.clientY - this.lastTouchY) * sens;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
    });
    canvas.addEventListener("touchend", () => {
      this.looking = false;
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;
    if (e.code === "KeyF") this.toggleFlashlight();
    if (e.code === "Digit1") this.setWeapon("gun");
    if (e.code === "Digit2") this.setWeapon("shotgun");
    if (e.code === "Digit3") this.setWeapon("sniper");
    if (e.code === "Digit4") this.setWeapon("knife");
    if (e.code === "KeyR") this.reload();
    if (e.code === "KeyG") this.throwGrenade();
    if (e.code === "KeyC") this.toggleCrouch();
    if (e.code === "Escape" || e.code === "KeyP") this.togglePause();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  public togglePause() {
    this.paused = !this.paused;
    this.cb.onPause?.(this.paused);
    if (this.paused) {
      this.cb.onMessage("PAUSED");
      if (document.pointerLockElement) document.exitPointerLock?.();
    } else {
      this.cb.onMessage("Resumed");
      this.clock.getDelta();
    }
  }
  public isPaused() { return this.paused; }


  public setMoveInput(x: number, y: number) {
    this.moveInput.set(x, y);
  }
  public toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.flashlight.intensity = this.flashlightOn ? 20 : 0;
    this.cb.onMessage(this.flashlightOn ? "Flashlight ON" : "Flashlight OFF");
  }
  public setAds(on: boolean) {
    if (this.weapon === "knife") { this.adsing = false; return; }
    this.adsing = on;
  }
  public toggleAds() { this.setAds(!this.adsing); }
  public isAds() { return this.adsing; }
  public currentWeapon(): WeaponKind { return this.weapon; }
  public toggleCrouch() {
    this.crouching = !this.crouching;
    this.cb.onMessage(this.crouching ? "Crouched" : "Standing");
  }
  public setWeapon(w: WeaponKind) {
    this.weapon = w;
    this.gunMesh.visible = w === "gun";
    this.shotgunMesh.visible = w === "shotgun";
    this.sniperMesh.visible = w === "sniper";
    this.knifeMesh.visible = w === "knife";
    // Clamp ammo into new spec's mag
    const spec = WEAPON_SPECS[w];
    if (this.ammo > spec.maxAmmo) this.ammo = spec.maxAmmo;
    if (w === "knife") this.adsing = false;
    this.cb.onAmmo(this.ammo, this.weapon);
    this.cb.onMessage(`Equipped: ${w.toUpperCase()}`);
  }
  public reload() {
    const spec = WEAPON_SPECS[this.weapon];
    if (this.weapon === "knife") return;
    if (this.reloading > 0) return;
    if (this.ammo >= spec.maxAmmo) return;
    this.sound.init();
    this.sound.reload();
    this.reloading = spec.reloadDur;
    this.cb.onMessage("Reloading...");
  }
  public attack() {
    this.sound.init();
    this.tryAttack();
  }

  private tryAttack() {
    if (this.fireCd > 0) return;
    if (this.reloading > 0) return;
    const spec = WEAPON_SPECS[this.weapon];
    if (this.weapon === "knife") {
      this.fireCd = spec.fireCd;
      this.sound.knife();
      this.raycastShot(spec.range, spec.damage, 0);
      return;
    }
    if (this.ammo <= 0) {
      this.cb.onMessage("Out of ammo! Press R");
      return;
    }
    this.ammo--;
    this.fireCd = spec.fireCd;
    this.muzzleFlash = this.weapon === "sniper" ? 0.14 : this.weapon === "shotgun" ? 0.12 : 0.08;
    const baseShake = this.weapon === "sniper" ? 0.7 : this.weapon === "shotgun" ? 0.55 : 0.25;
    this.shake = Math.max(this.shake, this.adsing ? baseShake * 0.5 : baseShake);
    this.sound.shoot();
    this.cb.onAmmo(this.ammo, this.weapon);

    // Spread: ADS uses tight spread, hip uses wider; crouch tightens 50%
    let spread = this.adsing ? spec.spread : spec.hipSpread;
    if (this.crouching) spread *= 0.5;

    // Fire pellets (shotgun = 8, others = 1)
    for (let i = 0; i < spec.pellets; i++) {
      this.raycastShot(spec.range, spec.damage, spread);
    }
  }

  private raycastShot(maxDist: number, damage: number, spread: number) {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (spread > 0) {
      // Random cone offset
      const yawOff = (Math.random() - 0.5) * spread * 2;
      const pitchOff = (Math.random() - 0.5) * spread * 2;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      dir.addScaledVector(right, yawOff).addScaledVector(up, pitchOff).normalize();
    }
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    let closest: { e: Enemy; d: number; hitPoint: THREE.Vector3; bone: string } | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const hits = ray.intersectObject(e.mesh, true);
      if (hits.length && (!closest || hits[0].distance < closest.d)) {
        const h = hits[0];
        const boneName = (h.object.name || "").toLowerCase();
        closest = { e, d: h.distance, hitPoint: h.point.clone(), bone: boneName };
      }
    }
    if (closest) {
      const bbox = new THREE.Box3().setFromObject(closest.e.mesh);
      const headThreshold = bbox.min.y + (bbox.max.y - bbox.min.y) * 0.78;
      const isHeadByName = /head|skull|neck|cranium/.test(closest.bone);
      const isHeadByPos = closest.hitPoint.y >= headThreshold;
      const isHeadshot = isHeadByName || isHeadByPos;
      const finalDamage = isHeadshot ? damage * 3 : damage;

      closest.e.hp -= finalDamage;
      closest.e.hitFlash = 0.15;
      const redMat = new THREE.MeshBasicMaterial({
        color: isHeadshot ? 0xff0000 : 0xff3030,
      });
      closest.e.origMats.forEach((_, m) => {
        m.material = redMat;
      });
      if (closest.e.hp <= 0) {
        this.killEnemy(closest.e);
        if (isHeadshot) this.cb.onMessage("💥 HEADSHOT KILL!");
      } else {
        this.cb.onMessage(isHeadshot ? "💥 HEADSHOT! (3x)" : "Hit!");
      }
    }
  }

  public throwGrenade() {
    if (this.grenadeCount <= 0) {
      this.cb.onMessage("No grenades!");
      return;
    }
    this.grenadeCount--;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a3a1c, roughness: 0.6, metalness: 0.4, emissive: 0x110000, emissiveIntensity: 0.4 }),
    );
    mesh.castShadow = true;
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    mesh.position.copy(origin).addScaledVector(dir, 0.5);
    const vel = dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(mesh);
    this.grenades.push({ mesh, vel, t: 2.2 });
    this.sound.init();
    this.cb.onMessage(`Grenade thrown! (${this.grenadeCount} left)`);
  }

  private updateGrenades(dt: number) {
    for (const g of this.grenades) {
      if (g.t <= 0) continue;
      g.t -= dt;
      // Physics
      g.vel.y -= 16 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      g.mesh.rotation.x += dt * 6;
      g.mesh.rotation.z += dt * 4;
      // Floor bounce
      if (g.mesh.position.y < 0.15) {
        g.mesh.position.y = 0.15;
        g.vel.y *= -0.4;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.t <= 0) this.explodeGrenade(g);
    }
    this.grenades = this.grenades.filter((g) => g.t > 0);
  }

  private explodeGrenade(g: { mesh: THREE.Mesh; vel: THREE.Vector3; t: number }) {
    const pos = g.mesh.position.clone();
    this.scene.remove(g.mesh);
    g.t = -1;
    this.sound.thunder();

    // Bright flash light
    const flash = new THREE.PointLight(0xffaa44, 30, 25, 2);
    flash.position.copy(pos);
    this.scene.add(flash);
    let life = 0.3;
    const fade = () => {
      life -= 0.05;
      flash.intensity = Math.max(0, life * 100);
      if (life > 0) setTimeout(fade, 30);
      else this.scene.remove(flash);
    };
    fade();

    // Smoke/debris ring
    const ringGeo = new THREE.RingGeometry(0.3, 0.5, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    let rs = 1;
    const grow = () => {
      rs += 0.6;
      ring.scale.setScalar(rs);
      ringMat.opacity *= 0.85;
      if (ringMat.opacity > 0.05) setTimeout(grow, 30);
      else this.scene.remove(ring);
    };
    grow();

    // Damage all enemies in radius
    const radius = 6;
    const baseDmg = 200;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.mesh.position.distanceTo(pos);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      const dmg = baseDmg * falloff;
      e.hp -= dmg;
      e.hitFlash = 0.2;
      if (e.hp <= 0) this.killEnemy(e);
    }
    // Player damage if too close
    const pd = pos.distanceTo(this.pos);
    if (pd < radius) {
      const selfDmg = (1 - pd / radius) * 80;
      this.hp = Math.max(0, this.hp - selfDmg);
      this.cb.onHealth(this.hp);
      this.cb.onDamage();
      if (this.hp <= 0) { this.cb.onDeath(); this.running = false; }
    }
    this.shake = Math.max(this.shake, Math.min(1.2, 1.2 * (1 - pd / 30)));
  }

  public getGrenades() { return this.grenadeCount; }




  private killEnemy(e: Enemy) {
    e.alive = false;
    this.scene.remove(e.mesh);
    this.kills++;
    this.cb.onKills(this.kills);

    // Score
    let pts = e.scoreValue ?? 100;
    if (e.type === "giant_ent") pts = 2500;
    else if (e.type === "fallen_angel") pts = 3500;
    this.score += pts;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { localStorage.setItem("darkforest_highscore", String(this.highScore)); } catch {}
    }
    this.cb.onScore?.(this.score, this.highScore);

    // Pickup drop chance (only on regular zombies)
    if (e.type === "zombie") {
      const r = Math.random();
      const dropChance = this.hp < 50 ? 0.55 : 0.35;
      if (r < dropChance) {
        const kind: "medkit" | "ammo" =
          this.hp < 60 && Math.random() < 0.55 ? "medkit" : "ammo";
        this.spawnPickup(e.mesh.position.x, e.mesh.position.z, kind);
      }
    } else if (e.type === "giant_ent" || e.type === "fallen_angel") {
      // Boss always drops both
      this.spawnPickup(e.mesh.position.x + 1, e.mesh.position.z, "medkit");
      this.spawnPickup(e.mesh.position.x - 1, e.mesh.position.z, "ammo");
    }

    // Wave tracking
    this.waveKills++;
    if (this.waveKills >= this.killsPerWave) {
      this.waveKills = 0;
      this.wave++;
      this.maxActiveZombies = Math.min(8, 3 + Math.floor(this.wave / 2));
      this.cb.onWave?.(this.wave);
      this.cb.onMessage(`⚔ WAVE ${this.wave} ⚔`);
      this.sound.thunder();
    }

    if (e.type === "giant_ent") {
      this.giantSpawned = false;
      this.cb.onMessage("🏆 GIANT ENT SLAIN! +2500");
      this.shake = Math.max(this.shake, 0.8);
    } else if (e.type === "fallen_angel") {
      this.angelSpawned = false;
      this.cb.onMessage("🏆 FALLEN ANGEL VANQUISHED! +3500");
      this.shake = Math.max(this.shake, 0.9);
    } else {
      const tag = e.variant === "runner" ? "Runner down!" : e.variant === "tank" ? "Tank down!" : "Zombie down!";
      this.cb.onMessage(e.type === "ghost" ? "Ghost banished!" : tag);
    }
  }

  private spawnPickup(x: number, z: number, kind: "medkit" | "ammo") {
    const grp = new THREE.Group();
    if (kind === "medkit") {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.35, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6, emissive: 0x331111, emissiveIntensity: 0.3 }),
      );
      box.castShadow = true;
      grp.add(box);
      const cross1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.08, 0.08),
        new THREE.MeshStandardMaterial({ color: 0xff2233, emissive: 0xff0000, emissiveIntensity: 0.7 }),
      );
      cross1.position.set(0, 0.2, 0);
      grp.add(cross1);
      const cross2 = cross1.clone();
      cross2.rotation.y = Math.PI / 2;
      grp.add(cross2);
      const lt = new THREE.PointLight(0xff3344, 0.8, 4, 2);
      lt.position.y = 0.6;
      grp.add(lt);
    } else {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.3, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x3a4a25, roughness: 0.8, emissive: 0x111100, emissiveIntensity: 0.2 }),
      );
      box.castShadow = true;
      grp.add(box);
      const label = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.18, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0xffaa00, emissiveIntensity: 0.6 }),
      );
      label.position.set(0, 0, 0.21);
      grp.add(label);
      const lt = new THREE.PointLight(0xffaa33, 0.7, 4, 2);
      lt.position.y = 0.6;
      grp.add(lt);
    }
    grp.position.set(x, 0.4, z);
    this.scene.add(grp);
    this.pickups.push({
      mesh: grp,
      kind,
      pos: grp.position,
      bob: Math.random() * Math.PI * 2,
      alive: true,
    });
  }

  private updatePickups(dt: number) {
    const t = this.clock.getElapsedTime();
    for (const p of this.pickups) {
      if (!p.alive) continue;
      p.mesh.position.y = 0.4 + Math.sin(t * 2.5 + p.bob) * 0.12;
      p.mesh.rotation.y += dt * 1.2;
      const dx = p.pos.x - this.pos.x;
      const dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.6) {
        if (p.kind === "medkit") {
          this.hp = Math.min(100, this.hp + 30);
          this.cb.onHealth(this.hp);
          this.cb.onMessage("+30 HP");
        } else {
          this.ammo = Math.min(24, this.ammo + 12);
          this.cb.onAmmo(this.ammo, this.weapon);
          this.cb.onMessage("+12 Ammo");
        }
        this.sound.init();
        this.sound.reload();
        p.alive = false;
        this.scene.remove(p.mesh);
      }
    }
    this.pickups = this.pickups.filter((p) => p.alive);
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
    let sprintActive = false;
    if (move.lengthSq() > 0) {
      move.normalize();
      const wantsSprint = !!(this.keys["ShiftLeft"] || this.keys["ShiftRight"]);
      // Can't sprint while ADS or crouched
      sprintActive = wantsSprint && this.stamina > 5 && !this.adsing && !this.crouching;
      let speedMul = sprintActive ? 1.7 : 1.0;
      if (this.adsing) speedMul *= 0.45;
      if (this.crouching) speedMul *= 0.55;
      this.pos.addScaledVector(move, 4 * speedMul * dt);
      this.footstepCd -= dt;
      if (this.footstepCd <= 0) {
        this.sound.footstep();
        this.footstepCd = sprintActive ? 0.3 : this.crouching ? 0.7 : 0.45;
      }
    }

    this.sprinting = sprintActive;
    // Stamina drain / regen
    if (sprintActive) {
      this.stamina = Math.max(0, this.stamina - 28 * dt);
    } else {
      this.stamina = Math.min(100, this.stamina + 18 * dt);
    }
    this.cb.onStamina?.(this.stamina);

    // Clamp inside world
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 120) {
      this.pos.x *= 120 / r;
      this.pos.z *= 120 / r;
    }
    // Crouch lerp
    const crouchTarget = this.crouching ? 1 : 0;
    this.crouchT += (crouchTarget - this.crouchT) * Math.min(1, dt * 8);
    this.pos.y = 1.7 - this.crouchT * 0.6;
    this.camera.position.copy(this.pos);

    // Camera shake (reduced while ADS)
    if (this.shake > 0) {
      const shakeMul = this.adsing ? 0.35 : 1.0;
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3 * shakeMul;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3 * shakeMul;
      this.shake -= dt * 1.5;
      if (this.shake < 0) this.shake = 0;
    }

    // ADS — lerp FOV
    const spec = WEAPON_SPECS[this.weapon];
    const targetAdsT = this.adsing ? 1 : 0;
    this.adsT += (targetAdsT - this.adsT) * Math.min(1, dt * (this.weapon === "sniper" ? 9 : 12));
    const targetFov = this.adsing ? spec.adsFov : this.baseFov;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 12));
    this.camera.updateProjectionMatrix();

    if (this.fireCd > 0) this.fireCd -= dt;

    const t = this.clock.getElapsedTime();
    const sway = move.lengthSq() > 0 ? 0.012 : 0.004;
    const baseX = 0.13,
      baseY = -0.18,
      baseZ = -0.4;
    const gunBaseRotX = -0.02,
      gunBaseRotY = -0.08,
      gunBaseRotZ = 0.02;

    // Reload animation drives gun pose when active
    if (this.reloading > 0) {
      this.reloading -= dt;
      const dur = WEAPON_SPECS[this.weapon].reloadDur || this.reloadDuration;
      const p = 1 - this.reloading / dur; // 0 -> 1
      const dip = Math.sin(p * Math.PI);
      this.gunMesh.position.set(baseX, baseY - dip * 0.18, baseZ + dip * 0.05);
      this.gunMesh.rotation.set(
        gunBaseRotX + dip * 0.6,
        gunBaseRotY - dip * 0.3,
        gunBaseRotZ - dip * 0.15,
      );
      // Same dip for shotgun/sniper meshes
      this.shotgunMesh.position.copy(this.gunMesh.position);
      this.shotgunMesh.rotation.copy(this.gunMesh.rotation);
      this.sniperMesh.position.copy(this.gunMesh.position);
      this.sniperMesh.rotation.copy(this.gunMesh.rotation);
      // Magazine drops only for rifle
      if (this.weapon === "gun") {
        if (p < 0.4) {
          const mp = p / 0.4;
          this.magMesh.position.y = -0.18 - mp * 0.5;
          this.magMesh.rotation.x = mp * 0.5;
        } else if (p > 0.7) {
          const mp = (p - 0.7) / 0.3;
          this.magMesh.position.y = -0.18 - (1 - mp) * 0.3;
          this.magMesh.rotation.x = (1 - mp) * 0.3;
        } else {
          this.magMesh.position.y = -0.68;
          this.magMesh.rotation.x = 0.5;
        }
      }
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = WEAPON_SPECS[this.weapon].maxAmmo;
        this.cb.onAmmo(this.ammo, this.weapon);
        this.cb.onMessage("Reloaded");
        this.magMesh.position.set(0, -0.18, -0.08);
        this.magMesh.rotation.set(0, 0, 0);
      }
      this.muzzleLight.intensity = 0;
    } else if (this.muzzleFlash > 0) {

      this.muzzleLight.intensity = 12;
      this.muzzleFlash -= dt;
      const kick = this.muzzleFlash / 0.08; // 1 -> 0
      this.gunMesh.position.set(baseX, baseY + kick * 0.04, baseZ + kick * 0.08);
      this.gunMesh.rotation.set(gunBaseRotX + kick * 0.3, gunBaseRotY, gunBaseRotZ);
    } else {
      this.muzzleLight.intensity = 0;
      this.gunMesh.rotation.set(gunBaseRotX, gunBaseRotY, gunBaseRotZ);
      this.gunMesh.position.x = baseX + Math.sin(t * 6) * sway;
      this.gunMesh.position.y = baseY + Math.abs(Math.cos(t * 6)) * sway;
      this.gunMesh.position.z = baseZ;
    }

    // Apply ADS offset (pull weapon to center) — applies to whichever gun is visible.
    // Sniper goes further in to bring scope to eye.
    const adsOffset = this.weapon === "sniper" ? 0.18 : 0.1;
    const adsCenter = -baseX; // pull toward 0 on X
    const activeMesh =
      this.weapon === "shotgun" ? this.shotgunMesh :
      this.weapon === "sniper" ? this.sniperMesh :
      this.weapon === "knife" ? null :
      this.gunMesh;
    if (activeMesh && this.weapon !== "knife" && this.reloading <= 0) {
      // Lerp toward ADS pose
      const ax = baseX + adsCenter * this.adsT;
      const ay = baseY + 0.18 * this.adsT - (this.weapon === "sniper" ? 0.04 : 0);
      const az = baseZ + adsOffset * this.adsT;
      if (activeMesh !== this.gunMesh) {
        // For shotgun/sniper, follow same sway + ADS
        activeMesh.rotation.set(gunBaseRotX, gunBaseRotY * (1 - this.adsT), gunBaseRotZ * (1 - this.adsT));
        activeMesh.position.x = ax + Math.sin(t * 6) * sway * (1 - this.adsT);
        activeMesh.position.y = ay + Math.abs(Math.cos(t * 6)) * sway * (1 - this.adsT);
        activeMesh.position.z = az;
      } else {
        // Blend rifle existing pos toward ADS center
        activeMesh.position.x = THREE.MathUtils.lerp(activeMesh.position.x, ax, this.adsT);
        activeMesh.position.y = THREE.MathUtils.lerp(activeMesh.position.y, ay, this.adsT);
        activeMesh.position.z = THREE.MathUtils.lerp(activeMesh.position.z, az, this.adsT);
      }
      // Hide sniper rifle when fully ADS'd — UI scope overlay takes over
      if (this.weapon === "sniper") {
        this.sniperMesh.visible = this.adsT < 0.85;
      }
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
      const toPlayer = new THREE.Vector3(
        this.pos.x - e.mesh.position.x,
        0,
        this.pos.z - e.mesh.position.z,
      );
      const dist = toPlayer.length();
      if (dist > 0.01) toPlayer.normalize();

      // Stagger when hit
      const moveSpeed = e.hitFlash > 0 ? e.speed * 0.2 : e.speed;
      e.mesh.position.addScaledVector(toPlayer, moveSpeed * dt);
      e.mesh.lookAt(this.pos.x, e.mesh.position.y, this.pos.z);

      if (e.type === "ghost") {
        e.mesh.position.y = Math.sin(t * 2 + e.phase) * 0.3;
        // Floating arms sway
        if (e.limbs) {
          e.limbs.armL.rotation.x = -1.2 + Math.sin(t * 1.5 + e.phase) * 0.2;
          e.limbs.armR.rotation.x = -1.2 + Math.cos(t * 1.5 + e.phase) * 0.2;
          e.limbs.head.rotation.z = Math.sin(t * 0.8 + e.phase) * 0.15;
          if (e.limbs.jaw) e.limbs.jaw.rotation.x = Math.sin(t * 3) * 0.15;
        }
      } else if (e.isFbxModel) {
        // FBX model uses baked skeletal animation
        if (e.mixer) e.mixer.update(dt);
        e.mesh.position.y = 0;
      } else {
        // Zombie shamble: bobbing + limp walk cycle (fallback procedural)
        const walk = t * 4 + e.phase;
        e.mesh.position.y = Math.abs(Math.sin(walk)) * 0.05;
        if (e.limbs) {
          const swing = Math.sin(walk) * 0.6;
          e.limbs.legL.rotation.x = swing;
          e.limbs.legR.rotation.x = -swing;
          e.limbs.armL.rotation.x = -1.0 + Math.sin(walk + 0.5) * 0.15;
          e.limbs.armR.rotation.x = -1.0 - Math.sin(walk + 0.5) * 0.15;
          e.limbs.head.rotation.z = Math.sin(walk * 0.5) * 0.12;
          e.limbs.torso.rotation.z = Math.sin(walk) * 0.06;
        }
      }

      // Restore materials after hit flash
      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        if (e.hitFlash <= 0) {
          e.origMats.forEach((mat, mesh) => {
            mesh.material = mat;
          });
        }
      }

      // Periodic growl/whisper — positional 3D audio relative to player facing
      if (dist < 22 && t - e.lastGrowl > 3 + Math.random() * 4) {
        e.lastGrowl = t;
        // Convert world offset → player-local (yaw-rotated) so left/right pan matches view
        const wx = e.mesh.position.x - this.pos.x;
        const wz = e.mesh.position.z - this.pos.z;
        const cosY = Math.cos(-this.yaw);
        const sinY = Math.sin(-this.yaw);
        const lx = wx * cosY - wz * sinY;
        const lz = wx * sinY + wz * cosY;
        if (e.type === "zombie" || e.type === "giant_ent" || e.type === "fallen_angel") {
          this.sound.zombieGrowl(lx, lz);
        } else {
          this.sound.ghostWhisper(lx, lz);
        }
      }

      e.attackCd -= dt;
      const range = e.attackRange ?? 1.6;
      if (dist < range && e.attackCd <= 0) {
        e.attackCd = e.isGiant ? 2.0 : 1.2;
        const dmg = e.damage ?? (e.type === "ghost" ? 8 : 12);
        this.hp -= dmg;
        this.shake = Math.max(this.shake, e.isGiant ? 1.0 : 0.4);
        this.sound.hurt();
        this.cb.onHealth(Math.max(0, this.hp));
        this.cb.onDamage();
        this.cb.onMessage(
          e.type === "fallen_angel"
            ? "ANGEL'S WRATH!"
            : e.type === "giant_ent"
              ? "GIANT ENT SMASH!"
              : e.type === "ghost"
                ? "Ghost touched you!"
                : "Zombie bite!",
        );
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
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloomPass) this.bloomPass.setSize(w, h);
  };

  private setupPostProcessing() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom — for muzzle flash, lightning, boss glows
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.7, 0.85);
    this.composer.addPass(this.bloomPass);

    // Vignette + film grain + chromatic aberration in a single fragment shader
    const grainShader = {
      uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
        uVignette: { value: 0.65 },
        uGrain: { value: 0.035 },
        uDamage: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uVignette;
        uniform float uGrain;
        uniform float uDamage;
        varying vec2 vUv;
        float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          vec2 uv = vUv;
          // Chromatic aberration — slight RGB split at edges
          float ca = 0.002 + uDamage * 0.006;
          vec2 dir = uv - 0.5;
          vec4 col;
          col.r = texture2D(tDiffuse, uv + dir * ca).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv - dir * ca).b;
          col.a = 1.0;
          // Vignette
          float d = distance(uv, vec2(0.5));
          float v = smoothstep(0.85, 0.25, d * uVignette);
          col.rgb *= mix(0.25, 1.0, v);
          // Damage red overlay
          col.rgb = mix(col.rgb, vec3(0.6, 0.0, 0.0), uDamage * (1.0 - v) * 0.7);
          // Film grain
          float g = (rand(uv * (1.0 + uTime)) - 0.5) * uGrain;
          col.rgb += g;
          gl_FragColor = col;
        }
      `,
    };
    this.grainPass = new ShaderPass(grainShader);
    this.composer.addPass(this.grainPass);
  }


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
      const intensity = Math.max(0, this.lightningFlash) * 3;
      this.ambient.intensity = 1.6 + intensity;
    } else {
      this.ambient.intensity = 1.6;
    }
  }

  private loop = () => {
    if (!this.running) {
      this.composer.render();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());

    if (this.paused) {
      this.composer.render();
      return;
    }

    this.spawnTimer -= dt;
    const targetCount = Math.min(this.maxActiveZombies, 1 + Math.floor(this.kills / 4) + this.wave);
    const spawnInterval = Math.max(1.6, 4.5 - this.wave * 0.3);
    if (this.spawnTimer <= 0 && this.enemies.length < targetCount) {
      this.spawnEnemy();
      this.spawnTimer = spawnInterval;
    }

    if (!this.giantSpawned && this.kills >= 5 && this.giantEntTemplate) {
      this.spawnGiantEnt();
    }
    if (!this.angelSpawned && this.kills >= 12 && this.fallenAngelTemplate) {
      this.spawnFallenAngel();
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updatePickups(dt);
    this.updateGrenades(dt);
    this.updateWeather(dt);


    // Minimap broadcast (throttled ~10Hz)
    this.minimapCd -= dt;
    if (this.minimapCd <= 0 && this.cb.onMinimap) {
      this.minimapCd = 0.1;
      this.cb.onMinimap({
        px: this.pos.x,
        pz: this.pos.z,
        yaw: this.yaw,
        enemies: this.enemies
          .filter((e) => e.alive)
          .map((e) => ({
            x: e.mesh.position.x,
            z: e.mesh.position.z,
            kind: e.type === "giant_ent" || e.type === "fallen_angel"
              ? "boss"
              : e.variant === "runner" ? "runner"
              : e.variant === "tank" ? "tank"
              : "zombie",
          })),
        pickups: this.pickups
          .filter((p) => p.alive)
          .map((p) => ({ x: p.pos.x, z: p.pos.z, kind: p.kind })),
      });
    }

    // Post-processing uniforms
    if (this.grainPass) {
      const u = this.grainPass.uniforms;
      u.uTime.value = this.clock.getElapsedTime();
      const dmgT = Math.max(0, 1 - this.hp / 100);
      u.uDamage.value = THREE.MathUtils.lerp(u.uDamage.value as number, dmgT * 0.6, 0.1);
    }
    if (this.bloomPass) {
      const boost = this.muzzleFlash > 0 ? 0.4 : 0;
      const ltn = this.lightningFlash > 0 ? this.lightningFlash * 0.6 : 0;
      this.bloomPass.strength = 0.35 + boost + ltn;
    }

    this.composer.render();
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

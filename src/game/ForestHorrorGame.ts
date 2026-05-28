import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
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
  mesh: THREE.Object3D;
  type: "zombie" | "ghost" | "giant_ent" | "fallen_angel";
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
  private readonly maxActiveZombies = 3;

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

  constructor(container: HTMLElement, cb: GameCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
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
    this.loadZombieModel();
    this.loadGiantEntModel();
    this.loadFallenAngelModel();
    // Forest GLB uses spec-gloss extension (not supported) → renders white.
    // Skip it and rely on PBR-textured procedural trees in buildWorld().
    // this.loadForestAssets();

    window.addEventListener("resize", this.onResize);
    this.loop();

    this.cb.onHealth(this.hp);
    this.cb.onAmmo(this.ammo, this.weapon);
    this.cb.onKills(this.kills);
    this.cb.onMessage("Loading zombies...");
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


  private loadForestAssets() {
    const loader = new GLTFLoader();
    loader.load(
      "/models/forest/coniferous_forest_assets_pack.glb",
      (gltf) => {
        // Collect top-level children as prototypes (trees, rocks, plants, etc.)
        const prototypes: THREE.Object3D[] = [];
        gltf.scene.children.forEach((c) => prototypes.push(c));
        if (prototypes.length === 0) return;

        // Ensure materials render correctly
        prototypes.forEach((p) => {
          p.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = false;
              m.receiveShadow = false;
              const mat = m.material as THREE.MeshStandardMaterial;
              if (mat && "roughness" in mat) {
                mat.roughness = Math.min(1, (mat.roughness ?? 1) + 0.1);
              }
            }
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
      color: 0xaaccee,
      size: 0.08,
      transparent: true,
      opacity: 0.55,
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

    this.gunMesh.position.set(0.13, -0.18, -0.4);
    this.gunMesh.rotation.set(-0.02, -0.08, 0.02);
    this.camera.add(this.gunMesh);

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
  }

  private spawnEnemy() {
    // Only spawn realistic FBX zombies. Skip until the model is loaded.
    if (!this.zombieTemplate) return;
    if (this.enemies.length >= this.maxActiveZombies) return;

    const enemy = new THREE.Group();
    const model = SkeletonUtils.clone(this.zombieTemplate) as THREE.Group;

    // Tint each clone slightly differently for variety
    const tint = new THREE.Color().setHSL(
      0.25 + Math.random() * 0.08,
      0.3 + Math.random() * 0.2,
      0.32 + Math.random() * 0.1,
    );
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.copy(tint);
        m.material = mat;
        m.castShadow = true;
      }
    });
    enemy.add(model);

    // Setup animation mixer with first available clip (usually walk/idle)
    let mixer: THREE.AnimationMixer | undefined;
    if (this.zombieAnimations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      const clip = this.zombieAnimations[0];
      const action = mixer.clipAction(clip);
      action.timeScale = 1 + Math.random() * 0.3;
      action.play();
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
      type: "zombie",
      hp: 60,
      speed: 1.6,
      attackCd: 0,
      alive: true,
      hitFlash: 0,
      origMats,
      lastGrowl: 0,
      phase: Math.random() * Math.PI * 2,
      mixer,
      isFbxModel: true,
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
    canvas.addEventListener("touchend", () => {
      this.looking = false;
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;
    if (e.code === "KeyF") this.toggleFlashlight();
    if (e.code === "Digit1") this.setWeapon("gun");
    if (e.code === "Digit2") this.setWeapon("knife");
    if (e.code === "KeyR") this.reload();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  public setMoveInput(x: number, y: number) {
    this.moveInput.set(x, y);
  }
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
    this.sound.init();
    this.sound.reload();
    this.ammo = 24;
    this.cb.onAmmo(this.ammo, this.weapon);
    this.cb.onMessage("Reloaded");
  }
  public attack() {
    this.sound.init();
    this.tryAttack();
  }

  private tryAttack() {
    if (this.fireCd > 0) return;
    if (this.weapon === "gun") {
      if (this.ammo <= 0) {
        this.cb.onMessage("Out of ammo! Press R");
        return;
      }
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
      closest.e.origMats.forEach((_, m) => {
        m.material = redMat;
      });
      if (closest.e.hp <= 0) this.killEnemy(closest.e);
      else this.cb.onMessage("Hit!");
    }
  }

  private killEnemy(e: Enemy) {
    e.alive = false;
    this.scene.remove(e.mesh);
    this.kills++;
    this.cb.onKills(this.kills);
    if (e.type === "giant_ent") {
      this.giantSpawned = false;
      this.cb.onMessage("🏆 GIANT ENT SLAIN!");
      this.shake = Math.max(this.shake, 0.8);
    } else {
      this.cb.onMessage(e.type === "ghost" ? "Ghost banished!" : "Zombie down!");
    }
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
    if (r > 120) {
      this.pos.x *= 120 / r;
      this.pos.z *= 120 / r;
    }
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
    const baseX = 0.13,
      baseY = -0.18,
      baseZ = -0.4;
    const gunBaseRotX = -0.02,
      gunBaseRotY = -0.08,
      gunBaseRotZ = 0.02;

    if (this.muzzleFlash > 0) {
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

      // Periodic growl/whisper if close enough
      if (dist < 18 && t - e.lastGrowl > 3 + Math.random() * 4) {
        e.lastGrowl = t;
        if (e.type === "zombie") this.sound.zombieGrowl();
        else this.sound.ghostWhisper();
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
          e.isGiant
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
    if (!this.running) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());

    this.spawnTimer -= dt;
    const targetCount = Math.min(this.maxActiveZombies, 1 + Math.floor(this.kills / 6));
    if (this.spawnTimer <= 0 && this.enemies.length < targetCount) {
      this.spawnEnemy();
      this.spawnTimer = 4.5;
    }

    // Boss: spawn giant ent after 5 kills, only one at a time
    if (!this.giantSpawned && this.kills >= 5 && this.giantEntTemplate) {
      this.spawnGiantEnt();
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

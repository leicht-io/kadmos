import {
  BoxGeometry,
  Box3,
  BufferGeometry,
  Color,
  DataTexture,
  DataUtils,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Fog,
  FrontSide,
  GridHelper,
  Group,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Line,
  LineBasicMaterial,
  LineSegments,
  Loader,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  RGBAFormat,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  Sphere,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import { BuildVolume, checkFit, FitResult } from "./buildPlates.js";
import { DEFAULT_COLOR } from "./color.js";
import { inverseNeutralToneMap } from "./toneMapping.js";
import { loadModel, LoadOptions } from "./loadModel.js";
import { formatLength } from "./format.js";
import { computeModelStats, ModelStats } from "./modelStats.js";

export type ViewPreset = "home" | "top" | "front" | "side" | "iso";
/** `auto` follows the visitor's system light/dark setting. */
export type ThemeSetting = "auto" | "light" | "dark";
export type SectionAxis = "x" | "y" | "z";

export interface ViewerLoadOptions extends LoadOptions {
  /** Overrides the model's own colors; omit to keep them (or the default). */
  color?: number;
}

// Z is up for objects intended to be 3D printed.
const UP = new Vector3(0, 0, 1);

const VIEW_DIRECTIONS: Record<ViewPreset, Vector3> = {
  home: new Vector3(0, -3, 2).normalize(),
  // Not exactly along +Z: OrbitControls can't orbit away from a camera
  // that looks straight down its up axis.
  top: new Vector3(0, -0.001, 1).normalize(),
  front: new Vector3(0, -1, 0),
  side: new Vector3(1, 0, 0),
  iso: new Vector3(1, -1, 1).normalize(),
};

const KEY_LIGHT_DIRECTION = new Vector3(-0.6, -0.9, 1.5).normalize();
const FOV = 35;
export const DEFAULT_ACCENT = 0x6366f1;

/** Scene colors for one theme. */
interface Palette {
  backgroundTop: string;
  backgroundBottom: string;
  gridMajor: number;
  gridMinor: number;
  plate: number;
  shadowOpacity: number;
}

const LIGHT_PALETTE: Palette = {
  backgroundTop: "#ffffff",
  backgroundBottom: "#e4e7ec",
  gridMajor: 0xb4b9c2,
  gridMinor: 0xd3d7dd,
  plate: 0xc9cdd4,
  shadowOpacity: 0.28,
};

const DARK_PALETTE: Palette = {
  backgroundTop: "#2b2f38",
  backgroundBottom: "#16181d",
  gridMajor: 0x4b515d,
  gridMinor: 0x30343c,
  plate: 0x3a3f49,
  shadowOpacity: 0.45,
};

/**
 * The three.js side of Kadmos: one renderer, scene and set of cameras,
 * reused for every model so repeated popups don't pile up WebGL contexts.
 * World units are millimeters.
 */
export class Viewer {
  private readonly renderer: WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly aoPass: GTAOPass;
  private readonly scene = new Scene();
  private readonly perspectiveCamera = new PerspectiveCamera(FOV, 1, 1, 1000);
  private readonly orthographicCamera = new OrthographicCamera();
  private camera: PerspectiveCamera | OrthographicCamera =
    this.perspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly keyLight = new DirectionalLight(0xffffff, 1.8);
  private readonly ground = new Group();
  private readonly plateGroup = new Group();
  private readonly dimensionsGroup = new Group();
  private readonly measureGroup = new Group();
  private readonly raycaster = new Raycaster();
  // Shared by every model material, so one write retunes them all.
  private readonly surfaceUniforms = {
    kadmosTexture: { value: 1 },
    // Grain feature size and bump depth, in millimeters.
    kadmosGrainSize: { value: 0.22 },
    kadmosGrainDepth: { value: 0.02 },
  };
  private readonly darkMode = window.matchMedia("(prefers-color-scheme: dark)");
  private readonly onColorSchemeChange = () => {
    if (this.themeSetting === "auto") {
      this.applyTheme();
    }
  };
  private themeSetting: ThemeSetting;
  private accent: number;
  /** 3MF image textures load asynchronously; redraw once they arrive. */
  private pendingTextures: Texture[] = [];

  private model: Group | undefined;
  private stats: ModelStats | undefined;
  private readonly modelBox = new Box3();
  private readonly modelCenter = new Vector3();
  private modelRadius = 1;
  private frameDistance = 10;
  /** Visible height of the orthographic camera at zoom 1. */
  private orthographicHeight = 10;
  private width = 1;
  private height = 1;
  private lastFrameTime: number | undefined;
  private needsRender = true;
  /** What the camera is fitted to: the model, or model plus build plate. */
  private readonly frameBox = new Box3();
  /** Set once the visitor zooms or pans; resizes then leave the view be. */
  private userAdjusted = false;

  private wireframe = false;
  private readonly sectionPlane = new Plane();
  private section: { axis: SectionAxis; fraction: number } | undefined;
  private plate: BuildVolume | undefined;
  private measuring = false;
  private pendingMeasurePoint: Vector3 | undefined;
  private pointerDownAt: Vector2 | undefined;

  constructor(
    container: HTMLElement,
    options: { theme?: ThemeSetting; accent?: number } = {},
  ) {
    this.themeSetting = options.theme ?? "auto";
    this.accent = options.accent ?? DEFAULT_ACCENT;

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Neutral keeps the user's chosen color close to what they picked;
    // ACES shifts hue and desaturates.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    // The light and model are static between changes, so the shadow map
    // is only redrawn when changed() asks for it, not every frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer.domElement.className = "kadmos-labels";
    container.appendChild(this.labelRenderer.domElement);

    const pmremGenerator = new PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    this.scene.environmentIntensity = 0.85;
    pmremGenerator.dispose();

    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.radius = 4;
    this.keyLight.shadow.bias = -0.0005;
    this.scene.add(this.keyLight, this.keyLight.target);
    this.scene.add(
      this.ground,
      this.plateGroup,
      this.dimensionsGroup,
      this.measureGroup,
    );

    for (const camera of [this.perspectiveCamera, this.orthographicCamera]) {
      camera.up.copy(UP);
    }

    this.composer = new EffectComposer(
      this.renderer,
      new WebGLRenderTarget(1, 1, { samples: 4, type: HalfFloatType }),
    );
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.aoPass = new GTAOPass(this.scene, this.camera, 1, 1);
    this.aoPass.blendIntensity = 0.75;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.aoPass);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.addEventListener("change", () => this.changed());
    this.controls.addEventListener("start", () => {
      this.userAdjusted = true;
    });

    this.applyTheme();
    this.darkMode.addEventListener("change", this.onColorSchemeChange);

    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      this.pointerDownAt = new Vector2(event.clientX, event.clientY);
    });
    this.renderer.domElement.addEventListener("pointerup", (event) =>
      this.handlePointerUp(event),
    );
  }

  public setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.updateProjection();
    this.refit();
    this.changed();
  }

  /**
   * Re-fits the camera distance to the current aspect ratio, keeping the
   * viewing direction, so a narrower viewer doesn't crop the model. Left
   * alone once the visitor has zoomed or panned.
   */
  private refit(): void {
    if (!this.model || this.userAdjusted) {
      return;
    }

    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this.frame(this.frameBox);
    const position = this.controls.target
      .clone()
      .addScaledVector(direction, this.frameDistance);
    for (const camera of [this.perspectiveCamera, this.orthographicCamera]) {
      camera.position.copy(position);
    }
    this.orthographicCamera.zoom = 1;
    this.orthographicHeight = this.visibleHeightAt(this.frameDistance);
    this.updateProjection();
  }

  public start(): void {
    this.lastFrameTime = undefined;
    this.renderer.setAnimationLoop((time) => {
      const delta =
        this.lastFrameTime === undefined
          ? 0
          : (time - this.lastFrameTime) / 1000;
      this.lastFrameTime = time;

      if (this.pendingTextures.length > 0) {
        const loaded = this.pendingTextures.filter((texture) => texture.image);
        if (loaded.length > 0) {
          this.pendingTextures = this.pendingTextures.filter(
            (texture) => !texture.image,
          );
          this.changed();
        }
      }

      // Only draw when something moved or changed: an idle viewer
      // shouldn't keep the GPU (and a laptop's fan) busy.
      const moved = this.controls.update(delta);
      if (!moved && !this.needsRender) {
        return;
      }

      this.needsRender = false;
      this.composer.render(delta);
      this.labelRenderer.render(this.scene, this.camera);
    });
  }

  public stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  /** Releases the WebGL context and removes the viewer's elements. */
  public dispose(): void {
    this.stop();
    this.clearModel();
    this.disposeChildren(this.ground);
    this.darkMode.removeEventListener("change", this.onColorSchemeChange);
    this.controls.dispose();
    this.aoPass.dispose();
    this.composer.dispose();
    this.scene.environment?.dispose();
    if (this.scene.background instanceof Texture) {
      this.scene.background.dispose();
    }
    this.renderer.dispose();
    // Browsers cap live WebGL contexts; free this one now rather than at
    // garbage collection.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  public setTheme(theme: ThemeSetting): void {
    this.themeSetting = theme;
    this.applyTheme();
  }

  /** Sets the color of overlays drawn in the scene (dimensions, measuring). */
  public setAccent(color: number): void {
    this.accent = color;
    for (const group of [this.dimensionsGroup, this.measureGroup]) {
      group.traverse((child) => {
        if (child instanceof Mesh || child instanceof Line) {
          (child.material as LineBasicMaterial).color.setHex(color);
        }
      });
    }
    this.changed();
  }

  /**
   * Loads a model, replacing the current one only once it has fully
   * loaded. Rejects if loading fails or `options.signal` is aborted.
   */
  public async load(
    url: string,
    options: ViewerLoadOptions = {},
  ): Promise<ModelStats> {
    const loaded = await loadModel(url, options);
    if (options.signal?.aborted) {
      disposeObject(loaded);
      throw new DOMException("Kadmos: load aborted", "AbortError");
    }

    this.clearModel();
    this.applyMaterials(loaded, options.color);

    // Rest the model on the plate (z = 0), centered on the origin.
    const model = new Group();
    model.add(loaded);
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    const center = box.getCenter(new Vector3());
    model.position.set(-center.x, -center.y, -box.min.z);
    model.updateMatrixWorld(true);

    model.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });

    this.model = model;
    this.scene.add(model);
    this.modelBox.setFromObject(model);
    this.modelBox.getCenter(this.modelCenter);
    this.modelRadius =
      this.modelBox.getBoundingSphere(new Sphere()).radius || 1;
    this.stats = computeModelStats(model);

    // Fresh materials start solid and unclipped, so reset the matching
    // state (and re-enable AO a previous model's tools may have disabled).
    this.wireframe = false;
    this.section = undefined;
    this.plate = undefined;
    this.updateAmbientOcclusion();
    this.setMeasuring(false);
    this.setDimensionsVisible(false);
    this.disposeChildren(this.plateGroup);

    this.layoutLighting();
    this.rebuildGround();
    this.frame(this.modelBox);
    this.setOrthographic(false);
    this.setView("home");
    this.controls.autoRotate = true;
    this.changed(true);

    return this.stats;
  }

  public clearModel(): void {
    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
      this.model = undefined;
      this.stats = undefined;
    }

    this.disposeChildren(this.dimensionsGroup);
    this.disposeChildren(this.measureGroup);
    this.disposeChildren(this.plateGroup);
    this.pendingMeasurePoint = undefined;
    this.pendingTextures = [];
    this.changed(true);
  }

  public setView(preset: ViewPreset): void {
    this.stopMomentum();
    this.userAdjusted = false;
    const distance = this.frameDistance;
    const position = this.modelCenter
      .clone()
      .addScaledVector(VIEW_DIRECTIONS[preset], distance);

    for (const camera of [this.perspectiveCamera, this.orthographicCamera]) {
      camera.position.copy(position);
    }
    this.orthographicCamera.zoom = 1;
    this.orthographicHeight = this.visibleHeightAt(distance);
    this.updateProjection();

    this.controls.target.copy(this.modelCenter);
    this.controls.update();
    this.changed();
  }

  public get autoRotate(): boolean {
    return this.controls.autoRotate;
  }

  public set autoRotate(enabled: boolean) {
    this.controls.autoRotate = enabled;
  }

  public get orthographic(): boolean {
    return this.camera === this.orthographicCamera;
  }

  public setOrthographic(enabled: boolean): void {
    if (enabled === this.orthographic) {
      return;
    }

    this.stopMomentum();
    const target = this.controls.target;
    if (enabled) {
      const distance = this.perspectiveCamera.position.distanceTo(target);
      this.orthographicHeight = this.visibleHeightAt(distance);
      this.orthographicCamera.zoom = 1;
      this.orthographicCamera.position.copy(this.perspectiveCamera.position);
      this.camera = this.orthographicCamera;
    } else {
      // OrbitControls zooms an orthographic camera via `zoom`, so carry
      // that over as a dolly distance.
      const visibleHeight =
        this.orthographicHeight / this.orthographicCamera.zoom;
      const distance = visibleHeight / (2 * Math.tan((FOV * Math.PI) / 360));
      const direction = this.orthographicCamera.position
        .clone()
        .sub(target)
        .normalize();
      this.perspectiveCamera.position
        .copy(target)
        .addScaledVector(direction, distance);
      this.camera = this.perspectiveCamera;
    }

    this.updateProjection();
    this.controls.object = this.camera;
    this.controls.update();
    this.renderPass.camera = this.camera;
    this.aoPass.camera = this.camera;
    this.aoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA = enabled ? 0 : 1;
    this.aoPass.gtaoMaterial.needsUpdate = true;
    this.changed();
  }

  public get texture(): boolean {
    return this.surfaceUniforms.kadmosTexture.value === 1;
  }

  /** Shows or hides the plastic surface texture. */
  public setTexture(enabled: boolean): void {
    this.surfaceUniforms.kadmosTexture.value = enabled ? 1 : 0;
    this.changed();
  }

  public setWireframe(enabled: boolean): void {
    this.wireframe = enabled;
    this.forEachModelMaterial((material) => {
      (material as MeshPhysicalMaterial).wireframe = enabled;
    });
    this.updateAmbientOcclusion();
    this.changed(true);
  }

  /**
   * Cuts the model with a plane across `axis`, keeping the part below
   * `fraction` (0–1 of the model's extent). Pass `undefined` to remove it.
   */
  public setSection(axis: SectionAxis | undefined, fraction = 0.5): void {
    const wasActive = this.section !== undefined;
    this.section = axis ? { axis, fraction } : undefined;

    if (axis) {
      const index = { x: 0, y: 1, z: 2 }[axis];
      const min = this.modelBox.min.getComponent(index);
      const max = this.modelBox.max.getComponent(index);
      const normal = new Vector3().setComponent(index, -1);
      this.sectionPlane.set(normal, min + (max - min) * fraction);
    }

    if (wasActive !== (axis !== undefined)) {
      this.forEachModelMaterial((material) => {
        material.clippingPlanes = axis ? [this.sectionPlane] : [];
        material.clipShadows = true;
        // Show the inside of the cut; back faces are darkened in the
        // shader so the hollow reads as an interior.
        material.side = axis ? DoubleSide : FrontSide;
        material.needsUpdate = true;
      });
    }

    this.pendingMeasurePoint = undefined;
    this.updateAmbientOcclusion();
    this.changed(true);
  }

  public setDimensionsVisible(visible: boolean): void {
    this.disposeChildren(this.dimensionsGroup);
    this.changed();
    if (!visible || !this.model) {
      return;
    }

    const box = this.modelBox;
    const size = box.getSize(new Vector3());
    const edges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(size.x, size.y, size.z)),
      new LineBasicMaterial({
        color: this.accent,
        transparent: true,
        opacity: 0.7,
      }),
    );
    edges.position.copy(this.modelCenter);
    this.dimensionsGroup.add(edges);

    const center = this.modelCenter;
    this.dimensionsGroup.add(
      createLabel(
        `X ${formatLength(size.x)} mm`,
        new Vector3(center.x, box.min.y, box.min.z),
        "x",
      ),
      createLabel(
        `Y ${formatLength(size.y)} mm`,
        new Vector3(box.max.x, center.y, box.min.z),
        "y",
      ),
      createLabel(
        `Z ${formatLength(size.z)} mm`,
        // On the opposite side from the Y label so the two don't overlap
        // in the default three-quarter view.
        new Vector3(box.min.x, box.min.y, center.z),
        "z",
      ),
    );
  }

  /** Shows a build plate and volume under the model and reports the fit. */
  public setBuildPlate(plate: BuildVolume | undefined): FitResult | undefined {
    this.plate = plate;
    this.disposeChildren(this.plateGroup);
    this.rebuildGround();
    this.changed(true);

    if (!plate || !this.stats) {
      this.frame(this.modelBox);
      this.setView("home");
      return undefined;
    }

    const fit = checkFit(this.stats.size, plate);
    const theme = this.palette;

    const bed = new Mesh(
      new PlaneGeometry(plate.width, plate.depth),
      new MeshStandardMaterial({ color: theme.plate, roughness: 0.85 }),
    );
    bed.receiveShadow = true;
    bed.position.z = -this.groundOffset(1);

    const bedGrid = new LineSegments(
      createGridGeometry(plate.width, plate.depth, 10),
      new LineBasicMaterial({
        color: theme.gridMajor,
        transparent: true,
        opacity: 0.55,
      }),
    );
    bedGrid.position.z = -this.groundOffset(0.5);

    const volume = new LineSegments(
      new EdgesGeometry(
        new BoxGeometry(plate.width, plate.depth, plate.height),
      ),
      new LineBasicMaterial({
        color: fit.fits ? 0x16a34a : 0xdc2626,
        transparent: true,
        opacity: 0.65,
      }),
    );
    volume.position.z = plate.height / 2;

    this.plateGroup.add(bed, bedGrid, volume);

    const bounds = this.modelBox
      .clone()
      .union(
        new Box3(
          new Vector3(-plate.width / 2, -plate.depth / 2, 0),
          new Vector3(plate.width / 2, plate.depth / 2, plate.height),
        ),
      );
    this.frame(bounds);
    this.setView("home");

    return fit;
  }

  public setMeasuring(enabled: boolean): void {
    this.measuring = enabled;
    this.renderer.domElement.style.cursor = enabled ? "crosshair" : "";
    if (!enabled) {
      this.clearMeasurements();
    }
  }

  public clearMeasurements(): void {
    this.disposeChildren(this.measureGroup);
    this.pendingMeasurePoint = undefined;
    this.changed();
  }

  private handlePointerUp(event: PointerEvent): void {
    const downAt = this.pointerDownAt;
    this.pointerDownAt = undefined;
    // Ignore drags: those are orbiting, not picking.
    if (
      !this.measuring ||
      !this.model ||
      !downAt ||
      downAt.distanceTo(new Vector2(event.clientX, event.clientY)) > 4
    ) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);

    const hit = this.raycaster
      .intersectObject(this.model, true)
      .find(
        (intersection) =>
          !this.section ||
          this.sectionPlane.distanceToPoint(intersection.point) >= 0,
      );
    if (!hit) {
      return;
    }

    const point = hit.point.clone();
    this.measureGroup.add(this.createMarker(point));
    this.changed();

    const start = this.pendingMeasurePoint;
    if (!start) {
      this.pendingMeasurePoint = point;
      return;
    }

    this.pendingMeasurePoint = undefined;
    const line = new Line(
      new BufferGeometry().setFromPoints([start, point]),
      new LineBasicMaterial({ color: this.accent, depthTest: false }),
    );
    line.renderOrder = 10;
    this.measureGroup.add(
      line,
      createLabel(
        `${formatLength(start.distanceTo(point))} mm`,
        start.clone().lerp(point, 0.5),
        "measure",
      ),
    );
  }

  private createMarker(position: Vector3): Mesh {
    const marker = new Mesh(
      new SphereGeometry(this.modelRadius * 0.012, 16, 8),
      new MeshBasicMaterial({ color: this.accent, depthTest: false }),
    );
    marker.position.copy(position);
    marker.renderOrder = 10;

    return marker;
  }

  /**
   * Drops any orbit momentum left by damping (e.g. from auto-rotate), so
   * a preset view lands exactly instead of drifting a few degrees.
   */
  private stopMomentum(): void {
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
  }

  /** Schedules a redraw, optionally including the shadow map. */
  private changed(shadows = false): void {
    this.needsRender = true;
    if (shadows) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private get palette(): Palette {
    const dark =
      this.themeSetting === "dark" ||
      (this.themeSetting === "auto" && this.darkMode.matches);

    return dark ? DARK_PALETTE : LIGHT_PALETTE;
  }

  private applyTheme(): void {
    const theme = this.palette;

    if (this.scene.background instanceof Texture) {
      this.scene.background.dispose();
    }
    this.scene.background = createGradientTexture(
      theme.backgroundTop,
      theme.backgroundBottom,
    );
    // Fade the grid into the bottom of the backdrop rather than into a
    // mismatched gray.
    this.scene.fog = new Fog(
      displayedAs(new Color(theme.backgroundBottom)),
      1,
      2,
    );
    this.updateFog();
    this.changed(true);

    if (this.model) {
      this.rebuildGround();
      this.setBuildPlate(this.plate);
    }
  }

  private applyMaterials(model: Object3D, color: number | undefined): void {
    model.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }

      const sources: Material[] = Array.isArray(child.material)
        ? child.material
        : [child.material];

      const materials = sources.map((source) => {
        const {
          color: ownColor,
          map,
          vertexColors,
        } = source as MeshStandardMaterial;
        const useOwnColors =
          color === undefined && source.name !== Loader.DEFAULT_MATERIAL_NAME;

        const material = new MeshPhysicalMaterial({
          color: useOwnColors && ownColor ? ownColor : (color ?? DEFAULT_COLOR),
          map: useOwnColors ? map : null,
          vertexColors: useOwnColors && vertexColors,
          opacity: source.opacity,
          transparent: source.transparent,
          // PLA has a satin finish: no clear coat, fairly rough.
          roughness: 0.6,
          metalness: 0,
          ior: 1.46,
        });
        if (material.map && !material.map.image) {
          this.pendingTextures.push(material.map);
        }
        material.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, this.surfaceUniforms);
          applyPlasticShader(shader);
        };
        source.dispose();

        return material;
      });

      child.material = Array.isArray(child.material) ? materials : materials[0];
    });
  }

  private forEachModelMaterial(callback: (material: Material) => void): void {
    this.model?.traverse((child) => {
      if (child instanceof Mesh) {
        const materials: Material[] = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach(callback);
      }
    });
  }

  private updateAmbientOcclusion(): void {
    // The AO pass draws its own depth/normal buffer of the unclipped,
    // solid model, so it would shade geometry that isn't on screen.
    this.aoPass.enabled = !this.wireframe && !this.section;
  }

  private layoutLighting(): void {
    const radius = this.modelRadius;

    this.keyLight.position
      .copy(this.modelCenter)
      .addScaledVector(KEY_LIGHT_DIRECTION, radius * 4);
    this.keyLight.target.position.copy(this.modelCenter);

    const shadowCamera = this.keyLight.shadow.camera;
    shadowCamera.left = -radius * 1.6;
    shadowCamera.right = radius * 1.6;
    shadowCamera.top = radius * 1.6;
    shadowCamera.bottom = -radius * 1.6;
    shadowCamera.near = radius;
    shadowCamera.far = radius * 8;
    shadowCamera.updateProjectionMatrix();
    this.keyLight.shadow.normalBias = radius * 0.003;

    this.aoPass.updateGtaoMaterial({
      radius: radius * 0.2,
      thickness: radius * 0.1,
      distanceFallOff: 1,
      scale: 1,
    });
  }

  private rebuildGround(): void {
    this.disposeChildren(this.ground);
    if (!this.model) {
      return;
    }

    const theme = this.palette;
    const plateExtent = this.plate
      ? Math.max(this.plate.width, this.plate.depth) * 1.6
      : 0;
    const extent = Math.max(this.modelRadius * 8, plateExtent);
    const step = niceStep(extent / 40);
    const divisions = Math.ceil(extent / step / 2) * 2;
    const size = divisions * step;

    const grid = new GridHelper(
      size,
      divisions,
      theme.gridMajor,
      theme.gridMinor,
    );
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -this.groundOffset(2);

    // Invisible except where shadows fall, so the model is grounded
    // without hiding the grid.
    const shadowCatcher = new Mesh(
      new PlaneGeometry(size, size),
      new ShadowMaterial({ opacity: theme.shadowOpacity }),
    );
    shadowCatcher.receiveShadow = true;
    shadowCatcher.position.z = -this.groundOffset(3);

    this.ground.add(grid, shadowCatcher);
  }

  /** Small offsets below z = 0 that keep coplanar ground layers apart. */
  private groundOffset(layer: number): number {
    return this.modelRadius * 0.0005 * layer;
  }

  /** Fits `box` in view along the current view direction. */
  private frame(box: Box3): void {
    this.frameBox.copy(box);
    const sphere = box.getBoundingSphere(new Sphere());
    const halfFov = (FOV * Math.PI) / 360;
    const aspect = this.width / this.height;
    const halfFovHorizontal = Math.atan(Math.tan(halfFov) * aspect);

    this.frameDistance =
      // Some margin, as the toolbar and info overlays cover the edges.
      (sphere.radius / Math.sin(Math.min(halfFov, halfFovHorizontal))) * 1.12;

    for (const camera of [this.perspectiveCamera, this.orthographicCamera]) {
      camera.near = this.frameDistance / 100;
      camera.far = this.frameDistance * 100;
    }
    this.controls.minDistance = this.modelRadius * 0.5;
    this.controls.maxDistance = this.frameDistance * 10;
    this.updateFog();
    this.updateProjection();
  }

  private updateFog(): void {
    if (this.scene.fog instanceof Fog) {
      this.scene.fog.near = this.frameDistance * 1.5;
      this.scene.fog.far = this.frameDistance * 5;
    }
  }

  private visibleHeightAt(distance: number): number {
    return 2 * distance * Math.tan((FOV * Math.PI) / 360);
  }

  private updateProjection(): void {
    const aspect = this.width / this.height;

    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const halfHeight = this.orthographicHeight / 2;
    this.orthographicCamera.left = -halfHeight * aspect;
    this.orthographicCamera.right = halfHeight * aspect;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.updateProjectionMatrix();
  }

  private disposeChildren(group: Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
  }
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh || child instanceof Line) {
      child.geometry.dispose();
      const materials: Material[] = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of materials) {
        (material as MeshStandardMaterial).map?.dispose();
        material.dispose();
      }
    }

    // CSS2DObject only removes its own element when it is the object
    // being removed, not when an ancestor is.
    if (child instanceof CSS2DObject) {
      child.element.remove();
    }
  });
}

function createLabel(
  text: string,
  position: Vector3,
  variant: string,
): CSS2DObject {
  const element = document.createElement("div");
  element.className = `kadmos-label kadmos-label--${variant}`;
  element.textContent = text;

  const label = new CSS2DObject(element);
  label.position.copy(position);

  return label;
}

/**
 * A vertical gradient for the backdrop, stored in linear half floats and
 * pre-compensated for the tone mapping (see displayedAs), so it shows the
 * palette's colors exactly.
 */
function createGradientTexture(top: string, bottom: string): Texture {
  const height = 128;
  const topColor = new Color(top);
  const bottomColor = new Color(bottom);
  const data = new Uint16Array(height * 4);

  // DataTexture rows run bottom to top.
  for (let row = 0; row < height; row++) {
    const color = displayedAs(
      bottomColor.clone().lerp(topColor, row / (height - 1)),
    );
    data.set(
      [
        DataUtils.toHalfFloat(color.r),
        DataUtils.toHalfFloat(color.g),
        DataUtils.toHalfFloat(color.b),
        DataUtils.toHalfFloat(1),
      ],
      row * 4,
    );
  }

  const texture = new DataTexture(data, 1, height, RGBAFormat, HalfFloatType);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;

  return texture;
}

/**
 * The color to put in the scene so it comes out as `color` on screen.
 * Neutral tone mapping saturates darks and compresses highlights, which
 * turned the dark backdrop navy.
 */
function displayedAs(color: Color): Color {
  const [r, g, b] = inverseNeutralToneMap([color.r, color.g, color.b]);

  return new Color().setRGB(r, g, b, LinearSRGBColorSpace);
}

/** A plain rectangular grid of lines in the XY plane, `step` apart. */
function createGridGeometry(
  width: number,
  depth: number,
  step: number,
): BufferGeometry {
  const points: Vector3[] = [];
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  for (let x = -halfWidth; x <= halfWidth + 1e-6; x += step) {
    points.push(new Vector3(x, -halfDepth, 0), new Vector3(x, halfDepth, 0));
  }
  for (let y = -halfDepth; y <= halfDepth + 1e-6; y += step) {
    points.push(new Vector3(-halfWidth, y, 0), new Vector3(halfWidth, y, 0));
  }

  return new BufferGeometry().setFromPoints(points);
}

/** Rounds up to 1, 2 or 5 times a power of ten. */
function niceStep(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const nice =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

  return nice * magnitude;
}

// GLSL injected into MeshPhysicalMaterial for a plastic surface: a fine,
// matte grain with slightly varying roughness. It's procedural and in
// world millimeters, so it needs no UVs and keeps its scale on any model.
const PLASTIC_VERTEX_PARS = /* glsl */ `
varying vec3 vKadmosWorld;
`;

const PLASTIC_VERTEX = /* glsl */ `
vKadmosWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const PLASTIC_FRAGMENT_PARS = /* glsl */ `
varying vec3 vKadmosWorld;
uniform float kadmosTexture;
uniform float kadmosGrainSize;
uniform float kadmosGrainDepth;

float kadmosHash( vec3 p ) {
\tp = fract( p * 0.3183099 + 0.1 );
\tp *= 17.0;
\treturn fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

// Smooth 3D value noise in [0, 1].
float kadmosNoise( vec3 x ) {
\tvec3 i = floor( x );
\tvec3 f = fract( x );
\tf = f * f * ( 3.0 - 2.0 * f );

\treturn mix(
\t\tmix(
\t\t\tmix( kadmosHash( i ), kadmosHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
\t\t\tmix( kadmosHash( i + vec3( 0.0, 1.0, 0.0 ) ), kadmosHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ),
\t\t\tf.y
\t\t),
\t\tmix(
\t\t\tmix( kadmosHash( i + vec3( 0.0, 0.0, 1.0 ) ), kadmosHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
\t\t\tmix( kadmosHash( i + vec3( 0.0, 1.0, 1.0 ) ), kadmosHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ),
\t\t\tf.y
\t\t),
\t\tf.z
\t);
}

// Bump mapping from screen-space derivatives (Mikkelsen's method, as
// three.js uses for bump maps), so the grain needs no tangents or UVs. The
// position derivatives are left unnormalized so the slope is height per
// millimeter, independent of zoom and screen resolution.
vec3 kadmosPerturbNormal( vec3 surfacePosition, vec3 surfaceNormal, vec2 dHdxy, float faceDirection ) {
\tvec3 sigmaX = dFdx( surfacePosition );
\tvec3 sigmaY = dFdy( surfacePosition );
\tvec3 r1 = cross( sigmaY, surfaceNormal );
\tvec3 r2 = cross( surfaceNormal, sigmaX );
\tfloat determinant = dot( sigmaX, r1 ) * faceDirection;
\tvec3 gradient = sign( determinant ) * ( dHdxy.x * r1 + dHdxy.y * r2 );

\treturn normalize( abs( determinant ) * surfaceNormal - gradient );
}
`;

// After roughnessmap_fragment: compute the grain and vary roughness.
const PLASTIC_ROUGHNESS = /* glsl */ `
vec3 kadmosGrainPosition = vKadmosWorld / kadmosGrainSize;
float kadmosGrain = kadmosNoise( kadmosGrainPosition ) * 0.5 + kadmosNoise( kadmosGrainPosition * 2.3 + 17.0 ) * 0.5;
// Fade the grain out where it gets smaller than a few pixels, which would
// otherwise shimmer; unresolved grain still scatters light, so the surface
// turns slightly more matte instead.
float kadmosGrainVisibility = ( 1.0 - smoothstep( 0.35, 1.2, length( fwidth( kadmosGrainPosition ) ) ) ) * kadmosTexture;
roughnessFactor = clamp(
\troughnessFactor
\t\t+ 0.08 * kadmosTexture * ( 1.0 - kadmosGrainVisibility )
\t\t+ ( kadmosGrain - 0.5 ) * 0.15 * kadmosGrainVisibility,
\t0.0,
\t1.0
);
`;

// After normal_fragment_maps: bump the normal by the grain's height.
const PLASTIC_NORMAL = /* glsl */ `
float kadmosHeight = kadmosGrain * kadmosGrainDepth * kadmosGrainVisibility;
normal = kadmosPerturbNormal( - vViewPosition, normal, vec2( dFdx( kadmosHeight ), dFdy( kadmosHeight ) ), faceDirection );
`;

function applyPlasticShader(shader: {
  vertexShader: string;
  fragmentShader: string;
}): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${PLASTIC_VERTEX_PARS}`)
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${PLASTIC_VERTEX}`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${PLASTIC_FRAGMENT_PARS}`)
    // Show the inside of a section cut darker, so the hollow reads as an
    // interior rather than more outside surface.
    .replace(
      "#include <color_fragment>",
      "#include <color_fragment>\n\tif ( ! gl_FrontFacing ) diffuseColor.rgb *= 0.35;",
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>\n${PLASTIC_ROUGHNESS}`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>\n${PLASTIC_NORMAL}`,
    );
}

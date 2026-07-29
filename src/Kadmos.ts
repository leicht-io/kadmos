import "./assets/styles.css";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshPhongMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export class Kadmos {
  // The largest dimension of any loaded model is normalized to this many
  // world units, so a model auto-fits the scene regardless of the units
  // it was originally authored in.
  private static readonly TARGET_SIZE = 5;
  private static readonly HOME_CAMERA_POSITION = new Vector3(0, -9, 6);
  private static readonly HOME_CAMERA_TARGET = new Vector3(0, 0, 0);

  private static camera: PerspectiveCamera;
  private static scene: Scene;
  private static renderer: WebGLRenderer;
  private static controls: OrbitControls;
  private static currentMaterial: MeshPhongMaterial | undefined;
  private static selector: string;

  private static getSpinner(): HTMLElement {
    const element = document.querySelector<HTMLElement>("#kadmos-spinner");
    if (element) {
      return element;
    } else {
      throw new Error("Kadmos Spinner not defined");
    }
  }

  private static getSpinnerProgress(): HTMLElement {
    const spinner = this.getSpinner();
    let progress = spinner.querySelector<HTMLElement>(
      ".kadmos-spinner-progress",
    );
    if (!progress) {
      progress = document.createElement("div");
      progress.className = "kadmos-spinner-progress";
      spinner.appendChild(progress);
    }

    return progress;
  }

  private static getErrorWrapper(): HTMLElement {
    const element = document.querySelector<HTMLElement>(
      "#kadmos-error-wrapper",
    );
    if (element) {
      return element;
    } else {
      throw new Error("Kadmos Error Wrapper not defined");
    }
  }

  private static getError(): HTMLElement {
    const element = document.querySelector<HTMLElement>("#kadmos-error");
    if (element) {
      return element;
    } else {
      throw new Error("Kadmos Error Container not defined");
    }
  }

  private static getContentWrapper(): HTMLElement {
    const element = document.querySelector<HTMLElement>("#kadmos-content");
    if (element) {
      return element;
    } else {
      throw new Error("Kadmos Content Wrapper not defined");
    }
  }

  private static getStlWrapper(): HTMLElement {
    const element = document.querySelector<HTMLElement>("#stlBackdrop");
    if (element) {
      return element;
    } else {
      throw new Error("Kadmos STL Wrapper not defined");
    }
  }

  private static getModelContainer(): HTMLElement {
    const element = document.querySelector<HTMLElement>("#stlModel");
    if (element) {
      return element;
    } else {
      throw new Error("Kadmos Model Container not defined");
    }
  }

  public static initFromUrl(): void {
    this.addPopupTemplateHtmlToDom();

    document.addEventListener("DOMContentLoaded", () => {
      const urlParams = new URLSearchParams(window.location.search);

      const fileUrl: string | null = urlParams.get("fileUrl");
      const color: string = this.normalizeColor(urlParams.get("color"));

      if (!fileUrl) {
        this.getErrorWrapper().classList.add("kadmos-error-wrapper--visible");
        this.getError().innerHTML = "<p>The fileUrl parameter is missing</p>";

        return;
      }

      this.handleModel(fileUrl, color, window.innerWidth, window.innerHeight);
      window.addEventListener("resize", () => {
        if (this.renderer) {
          this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
      });
      this.getStlWrapper().classList.add("backdrop--fade-in");
    });
  }

  public static initAll(selector: string): void {
    this.selector = selector;
    this.addPopupTemplateHtmlToDom();
    this.handleEvents();
  }

  private static normalizeColor(rawColor: string | null): string {
    const color = rawColor || "0x626262";

    // MeshPhongMaterial's `specular: 0x0` renders true black as a
    // featureless silhouette against the shadowed grid, so nudge any
    // spelling of black to a dark gray that still reads as "black".
    if (Number(color) === 0) {
      return "0x444444";
    }

    return color;
  }

  private static addPopupTemplateHtmlToDom(): void {
    // initFromUrl() and initAll() can both run in the same page (as the
    // demo does); guard against injecting a second, duplicate-ID popup.
    if (document.getElementById("stlBackdrop")) {
      return;
    }

    const backdrop: string =
      '<div id="stlBackdrop">' +
      '  <div id="stlContent">' +
      '    <div id="stlToolbar">' +
      '      <button type="button" class="kadmos-toolbar-button" data-action="reset" title="Reset view" aria-label="Reset view">⟲</button>' +
      '      <button type="button" class="kadmos-toolbar-button" data-action="rotate" title="Toggle auto-rotate" aria-label="Toggle auto-rotate">↻</button>' +
      '      <button type="button" class="kadmos-toolbar-button" data-action="wireframe" title="Toggle wireframe" aria-label="Toggle wireframe">▦</button>' +
      "    </div>" +
      '    <div id="stlModel">' +
      "    </div>" +
      "  </div>" +
      "</div>";

    const backdropNode: Node = document
      .createRange()
      .createContextualFragment(backdrop);
    this.getContentWrapper().appendChild(backdropNode);

    this.initToolbar();
  }

  private static initToolbar(): void {
    const toolbar = document.getElementById("stlToolbar");
    if (!toolbar) {
      return;
    }

    toolbar.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-action]",
      );
      if (!button) {
        return;
      }

      switch (button.dataset.action) {
        case "reset":
          this.resetView();
          break;
        case "rotate":
          this.toggleAutoRotate(button);
          break;
        case "wireframe":
          this.toggleWireframe(button);
          break;
      }
    });
  }

  private static resetView(): void {
    if (!this.camera || !this.controls) {
      return;
    }

    this.camera.position.copy(this.HOME_CAMERA_POSITION);
    this.controls.target.copy(this.HOME_CAMERA_TARGET);
    this.controls.update();
  }

  private static toggleAutoRotate(button: HTMLElement): void {
    if (!this.controls) {
      return;
    }

    this.controls.autoRotate = !this.controls.autoRotate;
    button.classList.toggle(
      "kadmos-toolbar-button--active",
      this.controls.autoRotate,
    );
  }

  private static toggleWireframe(button: HTMLElement): void {
    if (!this.currentMaterial) {
      return;
    }

    this.currentMaterial.wireframe = !this.currentMaterial.wireframe;
    button.classList.toggle(
      "kadmos-toolbar-button--active",
      this.currentMaterial.wireframe,
    );
  }

  private static handleCenter(geometry: BufferGeometry): Box3 {
    geometry.computeBoundingBox();
    geometry.center();

    const boundingBox: Box3 | null = geometry.boundingBox;
    if (!boundingBox) {
      throw new Error("Kadmos: unable to compute model bounding box");
    }

    const height = boundingBox.max.z - boundingBox.min.z;
    geometry.translate(0, 0, height / 2);

    return boundingBox;
  }

  public static handleModel(
    filePath: string,
    color: string,
    width: number,
    height: number,
  ): void {
    this.resetUiState();

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
    }
    this.getModelContainer().innerHTML = "";

    this.initScene();
    this.initCamera(width, height);
    this.scene.add(this.camera);

    const grid = new GridHelper(20, 50, 0x8d8d8d, 0xbdbdbd);
    grid.rotateOnAxis(new Vector3(1, 0, 0), 90 * (Math.PI / 180));
    this.scene.add(grid);

    this.renderer = new WebGLRenderer({
      antialias: true,
    });
    this.renderer.setClearColor(0xfafafa);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.applyEnvironmentLighting();

    this.getModelContainer().appendChild(this.renderer.domElement);

    const loader = new STLLoader();
    const material = new MeshPhongMaterial({
      color: Number(color),
      specular: 0x0,
      shininess: 10,
    });
    this.currentMaterial = material;

    loader.load(
      filePath,
      (geometry) => {
        const boundingBox = this.handleCenter(geometry);
        this.scene.add(this.getMesh(geometry, material, boundingBox));
        this.revealViewer();
      },
      (event) => this.updateLoadProgress(event),
      () => this.handleLoadError(),
    );

    this.initControls();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private static getMesh(
    geometry: BufferGeometry,
    material: MeshPhongMaterial,
    boundingBox: Box3,
  ): Mesh {
    const size = new Vector3();
    boundingBox.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z) || 1;
    const scale = this.TARGET_SIZE / largestDimension;

    const mesh = new Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(scale);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  private static initCamera(width: number, height: number): void {
    this.camera = new PerspectiveCamera(35, width / height, 1, 500);

    // Z is up for objects intended to be 3D printed.
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(this.HOME_CAMERA_POSITION);

    this.camera.add(new PointLight(0xffffff, 0.8));
  }

  private static initScene(): void {
    this.scene = new Scene();
    this.scene.background = new Color(0xffffff);
    this.scene.fog = new Fog(0xa0a0a0, 10, 50);

    this.scene.add(new HemisphereLight(0xffffff, 0x000000, 1));
    this.scene.add(new AmbientLight(0xffffff));

    const directionalLight = new DirectionalLight(0xffffff, 1);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.top = 44;
    directionalLight.shadow.camera.bottom = -14;
    directionalLight.shadow.camera.left = -14;
    directionalLight.shadow.camera.right = 14;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 40;
    directionalLight.shadow.bias = -0.002;
    directionalLight.position.set(0, 20, 20);
    this.scene.add(directionalLight);
  }

  private static applyEnvironmentLighting(): void {
    const pmremGenerator = new PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();
  }

  private static initControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.HOME_CAMERA_TARGET);
    this.controls.autoRotate = true;
    this.controls.update();

    document
      .querySelector<HTMLElement>('[data-action="rotate"]')
      ?.classList.add("kadmos-toolbar-button--active");
  }

  private static updateLoadProgress(event: ProgressEvent): void {
    if (!event.lengthComputable) {
      return;
    }

    const percent = Math.round((event.loaded / event.total) * 100);
    this.getSpinnerProgress().textContent = `${percent}%`;
  }

  private static handleLoadError(): void {
    this.getSpinner().classList.remove("kadmos-spinner--visible");
    this.getErrorWrapper().classList.add("kadmos-error-wrapper--visible");
    this.getError().innerHTML = "<p>The model could not be loaded</p>";
  }

  private static revealViewer(): void {
    setTimeout(() => {
      this.getSpinner().classList.remove("kadmos-spinner--visible");
      setTimeout(() => {
        this.getStlWrapper().classList.add("stlBackdrop--visible");
      }, 250);
    }, 100);
  }

  private static resetUiState(): void {
    this.getSpinner().classList.add("kadmos-spinner--visible");
    this.getSpinnerProgress().textContent = "";
    this.getErrorWrapper().classList.remove("kadmos-error-wrapper--visible");
  }

  private static hideBackdrop(): void {
    this.getStlWrapper().classList.remove("backdrop--fade-out");
    setTimeout(() => {
      this.getModelContainer().innerHTML = "";
    }, 250);

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
    }
  }

  private static handleEvents(): void {
    const triggers = Array.from(document.getElementsByClassName(this.selector));

    if (triggers.length === 0) {
      return;
    }

    triggers.forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        // Read from currentTarget (the element the listener is on),
        // not target, since a click can bubble up from a nested
        // child that doesn't carry the data attributes.
        const target = event.currentTarget as HTMLElement;
        const filePath = target.dataset.file;
        const color = target.dataset.color;

        if (!filePath) {
          return;
        }

        this.handleModel(
          filePath,
          this.normalizeColor(color ?? null),
          800,
          600,
        );
        this.getStlWrapper().classList.add("backdrop--fade-in");
      });
    });

    document.addEventListener("keyup", (event) => {
      if (event.key === "Escape") {
        this.hideBackdrop();
      }
    });

    this.getStlWrapper().addEventListener("click", (event) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      this.hideBackdrop();
    });
  }
}

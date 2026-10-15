// Only types come from the three.js side here: the Viewer module (and
// three.js with it) is loaded on first use, so pages that merely set up
// viewers don't download the 3D engine until a model is opened.
import type { ModelStats } from "./modelStats.js";
import type {
  SectionAxis,
  ThemeSetting,
  Viewer,
  ViewPreset,
} from "./Viewer.js";
import {
  BUILD_PLATES,
  BuildVolume,
  FitResult,
  parseBuildVolume,
} from "./buildPlates.js";
import { parseColor } from "./color.js";
import { formatLength, formatVolume } from "./format.js";
import { ICONS } from "./icons.js";
import { parseFlag } from "./options.js";

/** Per-model options, from data attributes, query params or code. */
export interface ModelOptions {
  /** Model color as `0x333333` or `#333333`; omit to keep the model's own. */
  color?: string | null;
  /** Build plate preset id (e.g. `prusa-mk4`) or `WxDxH` in millimeters. */
  plate?: string;
  /** Show the plastic surface texture (default true). */
  texture?: boolean | string;
  /** Show the dimensions overlay on load (default true). */
  dimensions?: boolean | string;
}

/** Page-level settings shared by every model a viewer shows. */
export interface ViewerSettings {
  /** `auto` (default) follows the visitor's system light/dark setting. */
  theme?: ThemeSetting;
  /** Highlight color, e.g. `#6366f1`, for buttons and in-scene overlays. */
  accent?: string;
  /** Largest model file to load, in bytes (default 200 MB). */
  maxFileSize?: number;
}

export type LoadResult = "loaded" | "superseded";
export type { ThemeSetting };

const CUSTOM_PLATE = "custom";
/** Below this width the toolbar switches to its compact layout. */
const COMPACT_WIDTH = 560;
let instanceCount = 0;

/**
 * One viewer's toolbar, panels and info overlay, wired to a lazily
 * created Viewer. Hosts (popup, full page, inline) own the surrounding
 * chrome: loading spinner, error message and visibility.
 */
export class ViewerUi {
  readonly element: HTMLElement;
  private readonly modelContainer: HTMLElement;
  private viewer: Viewer | undefined;
  private viewerPromise: Promise<Viewer> | undefined;
  private loadToken = 0;
  private loadController: AbortController | undefined;
  private customPlate: BuildVolume | undefined;
  private size: [number, number] = [1, 1];
  private settings: ViewerSettings;

  constructor(parent: HTMLElement, settings: ViewerSettings = {}) {
    this.settings = settings;
    const plateSelectId = `kadmos-plate-select-${++instanceCount}`;

    const toggle = (action: string, label: string, content: string) =>
      `<button type="button" class="kadmos-toolbar-button" data-action="${action}" title="${label}" aria-label="${label}" aria-pressed="false">${content}</button>`;
    const textToggle = (action: string, label: string, text: string) =>
      `<button type="button" class="kadmos-toolbar-button kadmos-toolbar-button--text" data-action="${action}" title="${label}" aria-label="${label}" aria-pressed="false">${text}</button>`;
    const view = (preset: ViewPreset, label: string) =>
      `<button type="button" class="kadmos-toolbar-button kadmos-toolbar-button--text" data-action="view" data-view="${preset}" title="${label} view">${label}</button>`;

    const template =
      '<div class="kadmos-viewer">' +
      '  <div class="kadmos-model"></div>' +
      '  <div class="kadmos-top">' +
      '  <div class="kadmos-info" aria-live="polite">' +
      '    <div class="kadmos-info-size"></div>' +
      '    <div class="kadmos-info-meta"></div>' +
      '    <div class="kadmos-info-fit" hidden></div>' +
      "  </div>" +
      '  <div class="kadmos-panels">' +
      '    <div class="kadmos-panel" data-panel="section" hidden>' +
      '      <span class="kadmos-panel-title">Section</span>' +
      '      <div class="kadmos-segmented" role="group" aria-label="Section axis">' +
      '        <button type="button" data-axis="x" aria-pressed="false">X</button>' +
      '        <button type="button" data-axis="y" aria-pressed="false">Y</button>' +
      '        <button type="button" data-axis="z" aria-pressed="true">Z</button>' +
      "      </div>" +
      '      <input type="range" class="kadmos-section-range" min="0" max="1000" value="500" aria-label="Section position">' +
      "    </div>" +
      '    <div class="kadmos-panel" data-panel="measure" hidden>' +
      '      <span class="kadmos-panel-title">Measure</span>' +
      '      <span class="kadmos-panel-hint">Click two points on the model</span>' +
      '      <button type="button" class="kadmos-panel-button" data-measure="clear">Clear</button>' +
      "    </div>" +
      '    <div class="kadmos-panel" data-panel="plate" hidden>' +
      `      <label class="kadmos-panel-title" for="${plateSelectId}">Build plate</label>` +
      `      <select id="${plateSelectId}" class="kadmos-plate-select"></select>` +
      "    </div>" +
      "  </div>" +
      "  </div>" +
      '  <div class="kadmos-toolbar" role="toolbar" aria-label="Viewer controls">' +
      '    <div class="kadmos-toolbar-group">' +
      `      <button type="button" class="kadmos-toolbar-button" data-action="reset" title="Reset view" aria-label="Reset view">${ICONS.reset}</button>` +
      `      ${toggle("rotate", "Toggle auto-rotate", ICONS.rotate)}` +
      `      ${toggle("wireframe", "Toggle wireframe", ICONS.wireframe)}` +
      `      ${toggle("texture", "Toggle surface texture", ICONS.texture)}` +
      "    </div>" +
      '    <div class="kadmos-toolbar-group">' +
      `      ${view("top", "Top")}${view("front", "Front")}${view("side", "Side")}${view("iso", "Iso")}` +
      // Replaces the four view buttons on narrow viewers (see setSize).
      '      <select class="kadmos-view-select" aria-label="Camera view">' +
      '        <option value="">View</option>' +
      '        <option value="top">Top</option>' +
      '        <option value="front">Front</option>' +
      '        <option value="side">Side</option>' +
      '        <option value="iso">Iso</option>' +
      "      </select>" +
      `      ${textToggle("ortho", "Toggle orthographic camera", "Ortho")}` +
      "    </div>" +
      '    <div class="kadmos-toolbar-group">' +
      `      ${toggle("dimensions", "Show dimensions", ICONS.dimensions)}` +
      `      ${toggle("section", "Section view", ICONS.section)}` +
      `      ${toggle("measure", "Measure distance", ICONS.measure)}` +
      `      ${toggle("plate", "Show build plate", ICONS.plate)}` +
      "    </div>" +
      "  </div>" +
      "</div>";

    parent.appendChild(
      document.createRange().createContextualFragment(template),
    );
    this.element = parent.lastElementChild as HTMLElement;
    this.modelContainer = this.query(".kadmos-model") as HTMLElement;

    const plateSelect = this.query<HTMLSelectElement>(".kadmos-plate-select");
    for (const [id, plate] of Object.entries(BUILD_PLATES)) {
      plateSelect?.add(new Option(plate.name, id));
    }

    this.bindControls();
  }

  /**
   * Loads a model, replacing the current one once it's ready. Resolves
   * "superseded" if another load() or abort() came first; rejects if the
   * model can't be loaded.
   */
  public async load(
    url: string,
    options: ModelOptions = {},
    onProgress?: (fraction: number) => void,
  ): Promise<LoadResult> {
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    const token = ++this.loadToken;

    try {
      const viewer = await this.getViewer();
      viewer.setSize(...this.size);
      const stats = await viewer.load(url, {
        color: parseColor(options.color),
        maxFileSize: this.settings.maxFileSize,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (token === this.loadToken) {
            onProgress?.(fraction);
          }
        },
      });

      if (token !== this.loadToken) {
        return "superseded";
      }

      this.resetTools(viewer, stats, options);
      viewer.start();

      return "loaded";
    } catch (error) {
      if (controller.signal.aborted || token !== this.loadToken) {
        return "superseded";
      }
      throw error;
    }
  }

  /** Cancels an in-flight load; its load() resolves "superseded". */
  public abort(): void {
    this.loadController?.abort();
    this.loadToken++;
  }

  public setSize(width: number, height: number): void {
    this.size = [width, height];
    this.element.classList.toggle(
      "kadmos-viewer--compact",
      width < COMPACT_WIDTH,
    );
    this.viewer?.setSize(width, height);
  }

  public start(): void {
    this.viewer?.start();
  }

  public stop(): void {
    this.viewer?.stop();
  }

  public clear(): void {
    this.viewer?.clearModel();
  }

  public setTheme(theme: ThemeSetting): void {
    this.settings = { ...this.settings, theme };
    this.viewer?.setTheme(theme);
  }

  public setAccent(accent: string): void {
    this.settings = { ...this.settings, accent };
    const color = parseColor(accent);
    if (color !== undefined) {
      this.viewer?.setAccent(color);
    }
  }

  public setMaxFileSize(maxFileSize: number | undefined): void {
    this.settings = { ...this.settings, maxFileSize };
  }

  public dispose(): void {
    this.abort();
    this.viewer?.dispose();
    this.viewer = undefined;
    this.element.remove();
  }

  private getViewer(): Promise<Viewer> {
    this.viewerPromise ??= import("./Viewer.js").then(
      ({ Viewer }) => {
        this.viewer = new Viewer(this.modelContainer, {
          theme: this.settings.theme,
          accent: parseColor(this.settings.accent),
        });

        return this.viewer;
      },
      (error: unknown) => {
        // Let a later load retry, e.g. after a dropped connection.
        this.viewerPromise = undefined;
        throw error;
      },
    );

    return this.viewerPromise;
  }

  private query<T extends HTMLElement>(selector: string): T | null {
    return this.element.querySelector<T>(selector);
  }

  private bindControls(): void {
    this.query(".kadmos-toolbar")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-action]",
      );
      if (button && this.viewer) {
        this.handleToolbarAction(this.viewer, button);
      }
    });

    this.query(".kadmos-segmented")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-axis]",
      );
      if (!button) {
        return;
      }

      this.query(".kadmos-segmented")
        ?.querySelectorAll("[data-axis]")
        .forEach((axisButton) =>
          axisButton.setAttribute(
            "aria-pressed",
            String(axisButton === button),
          ),
        );
      this.applySection();
    });

    const viewSelect = this.query<HTMLSelectElement>(".kadmos-view-select");
    viewSelect?.addEventListener("change", () => {
      if (this.viewer && viewSelect.value) {
        this.showView(this.viewer, viewSelect.value as ViewPreset);
      }
      // Back to the "View" placeholder: it's a menu, not a state.
      viewSelect.value = "";
    });

    this.query(".kadmos-section-range")?.addEventListener("input", () =>
      this.applySection(),
    );

    this.query('[data-measure="clear"]')?.addEventListener("click", () =>
      this.viewer?.clearMeasurements(),
    );

    this.query(".kadmos-plate-select")?.addEventListener("change", () =>
      this.applyPlate(),
    );
  }

  private handleToolbarAction(viewer: Viewer, button: HTMLElement): void {
    const action = button.dataset.action ?? "";
    const toggled = !this.isPressed(action);

    switch (action) {
      case "reset":
        viewer.setView("home");
        break;
      case "rotate":
        viewer.autoRotate = toggled;
        this.setPressed(action, toggled);
        break;
      case "wireframe":
        viewer.setWireframe(toggled);
        this.setPressed(action, toggled);
        break;
      case "texture":
        viewer.setTexture(toggled);
        this.setPressed(action, toggled);
        break;
      case "view":
        this.showView(viewer, button.dataset.view as ViewPreset);
        break;
      case "ortho":
        viewer.setOrthographic(toggled);
        this.setPressed(action, toggled);
        break;
      case "dimensions":
        viewer.setDimensionsVisible(toggled);
        this.setPressed(action, toggled);
        break;
      case "section":
        this.setPressed(action, toggled);
        this.showPanel(action, toggled);
        this.applySection();
        break;
      case "measure":
        viewer.setMeasuring(toggled);
        this.setPressed(action, toggled);
        this.showPanel(action, toggled);
        break;
      case "plate":
        this.setPressed(action, toggled);
        this.showPanel(action, toggled);
        this.applyPlate();
        break;
    }
  }

  private showView(viewer: Viewer, preset: ViewPreset): void {
    // A fixed view is for inspecting; spinning away from it isn't.
    viewer.autoRotate = false;
    this.setPressed("rotate", false);
    viewer.setView(preset);
  }

  private applySection(): void {
    if (!this.viewer) {
      return;
    }

    if (!this.isPressed("section")) {
      this.viewer.setSection(undefined);
      return;
    }

    const axis = (this.query('.kadmos-segmented [aria-pressed="true"]')?.dataset
      .axis ?? "z") as SectionAxis;
    const range = this.query<HTMLInputElement>(".kadmos-section-range");
    this.viewer.setSection(axis, Number(range?.value ?? 500) / 1000);
  }

  private applyPlate(): void {
    if (!this.viewer) {
      return;
    }

    const select = this.query<HTMLSelectElement>(".kadmos-plate-select");
    const plate = !this.isPressed("plate")
      ? undefined
      : select?.value === CUSTOM_PLATE
        ? this.customPlate
        : BUILD_PLATES[select?.value ?? ""];

    this.showFit(this.viewer.setBuildPlate(plate), plate);
  }

  /** Puts every tool back to its default for a freshly loaded model. */
  private resetTools(
    viewer: Viewer,
    stats: ModelStats,
    options: ModelOptions,
  ): void {
    for (const action of ["wireframe", "ortho", "section", "measure"]) {
      this.setPressed(action, false);
    }
    this.setPressed("rotate", viewer.autoRotate);

    const texture = parseFlag(options.texture) ?? true;
    viewer.setTexture(texture);
    this.setPressed("texture", texture);

    const dimensions = parseFlag(options.dimensions) ?? true;
    viewer.setDimensionsVisible(dimensions);
    this.setPressed("dimensions", dimensions);
    this.showPanel("section", false);
    this.showPanel("measure", false);

    const range = this.query<HTMLInputElement>(".kadmos-section-range");
    if (range) {
      range.value = "500";
    }

    this.showStats(stats);

    const plate = parseBuildVolume(options.plate);
    if (plate) {
      this.selectPlate(plate);
    }
    this.setPressed("plate", plate !== undefined);
    this.showPanel("plate", plate !== undefined);
    this.applyPlate();
  }

  private selectPlate(plate: BuildVolume): void {
    const select = this.query<HTMLSelectElement>(".kadmos-plate-select");
    if (!select) {
      return;
    }

    const presetId = Object.keys(BUILD_PLATES).find(
      (id) => BUILD_PLATES[id] === plate,
    );
    if (presetId) {
      select.value = presetId;
      return;
    }

    this.customPlate = plate;
    let option = Array.from(select.options).find(
      (candidate) => candidate.value === CUSTOM_PLATE,
    );
    if (!option) {
      option = new Option("", CUSTOM_PLATE);
      select.add(option);
    }
    option.text = plate.name;
    select.value = CUSTOM_PLATE;
  }

  private showStats(stats: ModelStats): void {
    const { size, volume, triangles } = stats;
    const sizeElement = this.query(".kadmos-info-size");
    const metaElement = this.query(".kadmos-info-meta");

    if (sizeElement) {
      sizeElement.textContent = `${formatLength(size.x)} × ${formatLength(size.y)} × ${formatLength(size.z)} mm`;
    }
    if (metaElement) {
      metaElement.textContent = `${formatVolume(volume)} · ${triangles.toLocaleString()} triangles`;
    }
  }

  private showFit(
    fit: FitResult | undefined,
    plate: BuildVolume | undefined,
  ): void {
    const element = this.query(".kadmos-info-fit");
    if (!element) {
      return;
    }

    element.hidden = !fit || !plate;
    if (!fit || !plate) {
      return;
    }

    element.classList.toggle("kadmos-info-fit--ok", fit.fits);
    element.classList.toggle("kadmos-info-fit--bad", !fit.fits);

    if (fit.fits) {
      element.textContent = fit.rotated
        ? `Fits ${plate.name} when rotated 90°`
        : `Fits ${plate.name}`;
      return;
    }

    const overflow = (["x", "y", "z"] as const)
      .filter((axis) => fit.overflow[axis] > 0)
      .map(
        (axis) =>
          `${axis.toUpperCase()} +${formatLength(fit.overflow[axis])} mm`,
      )
      .join(", ");
    element.textContent = `Too large for ${plate.name}: ${overflow}`;
  }

  private isPressed(action: string): boolean {
    return (
      this.query(`[data-action="${action}"]`)?.getAttribute("aria-pressed") ===
      "true"
    );
  }

  private setPressed(action: string, pressed: boolean): void {
    const button = this.query(`[data-action="${action}"]`);
    button?.setAttribute("aria-pressed", String(pressed));
    button?.classList.toggle("kadmos-toolbar-button--active", pressed);
  }

  private showPanel(name: string, visible: boolean): void {
    const panel = this.query(`[data-panel="${name}"]`);
    if (panel) {
      panel.hidden = !visible;
    }
  }
}

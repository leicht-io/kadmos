// Only types come from the three.js side here: the Viewer module (and
// three.js with it) is loaded on first use, so pages that merely wire up
// popup triggers don't download the 3D engine until a model is opened.
import type { ModelStats } from "./modelStats.js";
import type { SectionAxis, Viewer, ViewPreset } from "./Viewer.js";
import {
  BUILD_PLATES,
  BuildVolume,
  FitResult,
  parseBuildVolume,
} from "./buildPlates.js";
import { parseColor } from "./color.js";
import { formatLength, formatVolume } from "./format.js";
import { parseFlag } from "./options.js";
import { ICONS } from "./icons.js";

export interface ModelOptions {
  /** Build plate preset id (e.g. `prusa-mk4`) or `WxDxH` in millimeters. */
  plate?: string;
  /** Show the plastic surface texture (default true). */
  texture?: boolean | string;
  /** Show the dimensions overlay on load (default true). */
  dimensions?: boolean | string;
}

const FADE_MS = 250;
const POPUP_MARGIN = 32;
const CUSTOM_PLATE = "custom";

export class Kadmos {
  private static viewer: Viewer | undefined;
  private static viewerPromise: Promise<Viewer> | undefined;
  private static fullPage = false;
  private static requestedSize = { width: 800, height: 600 };
  private static loadToken = 0;
  private static loadController: AbortController | undefined;
  private static closeTimer: number | undefined;
  private static popupListenersBound = false;
  private static readonly triggerClasses = new Set<string>();
  private static customPlate: BuildVolume | undefined;

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

  private static query<T extends HTMLElement>(selector: string): T | null {
    return this.getStlWrapper().querySelector<T>(selector);
  }

  public static initFromUrl(): void {
    this.fullPage = true;

    this.whenReady(() => {
      this.addPopupTemplateHtmlToDom();

      const urlParams = new URLSearchParams(window.location.search);
      const fileUrl = urlParams.get("fileUrl");

      if (!fileUrl) {
        this.showError("The fileUrl parameter is missing");

        return;
      }

      this.handleModel(
        fileUrl,
        urlParams.get("color"),
        window.innerWidth,
        window.innerHeight,
        {
          plate: urlParams.get("plate") ?? undefined,
          texture: urlParams.get("texture") ?? undefined,
          dimensions: urlParams.get("dimensions") ?? undefined,
        },
      );
    });
  }

  public static initAll(className: string): void {
    this.whenReady(() => {
      this.addPopupTemplateHtmlToDom();
      this.bindPopupListeners();

      if (this.triggerClasses.has(className)) {
        return;
      }
      this.triggerClasses.add(className);

      // Delegated, so triggers added to the page later work too.
      document.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) {
          return;
        }

        // closest() rather than the target itself, since a click can
        // come from a nested child that doesn't carry the attributes.
        const trigger = event.target.closest<HTMLElement>(
          `.${CSS.escape(className)}`,
        );
        const filePath = trigger?.dataset.file;
        if (!trigger || !filePath) {
          return;
        }

        // Triggers can be real links (crawlable, and a download without
        // JavaScript); open the viewer instead of following them.
        event.preventDefault();
        this.handleModel(filePath, trigger.dataset.color, 800, 600, {
          plate: trigger.dataset.plate,
          texture: trigger.dataset.texture,
          dimensions: trigger.dataset.dimensions,
        });
      });
    });
  }

  /**
   * Opens a model in the viewer. In popup mode `width` and `height` are
   * the largest size the popup grows to; it shrinks to fit the window.
   */
  public static handleModel(
    filePath: string,
    color?: string | null,
    width = 800,
    height = 600,
    options: ModelOptions = {},
  ): void {
    this.addPopupTemplateHtmlToDom();
    if (!this.fullPage) {
      this.bindPopupListeners();
    }

    window.clearTimeout(this.closeTimer);
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    const token = ++this.loadToken;

    this.requestedSize = { width, height };
    this.resetUiState();

    this.getViewer()
      .then(async (viewer) => {
        viewer.setSize(...this.fitSize());
        const stats = await viewer.load(filePath, {
          color: parseColor(color),
          signal: controller.signal,
          onProgress: (fraction) => {
            if (token === this.loadToken) {
              this.getSpinnerProgress().textContent = `${Math.round(fraction * 100)}%`;
            }
          },
        });

        if (token !== this.loadToken) {
          return;
        }

        this.resetTools(viewer, stats, options);
        viewer.start();
        this.revealViewer(token);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || token !== this.loadToken) {
          return;
        }

        console.error(error);
        this.showError("The model could not be loaded");
      });
  }

  private static getViewer(): Promise<Viewer> {
    this.viewerPromise ??= import("./Viewer.js").then(
      ({ Viewer }) => {
        this.viewer = new Viewer(this.getModelContainer());

        return this.viewer;
      },
      (error: unknown) => {
        // Let a later open retry, e.g. after a dropped connection.
        this.viewerPromise = undefined;
        throw error;
      },
    );

    return this.viewerPromise;
  }

  private static whenReady(callback: () => void): void {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  private static fitSize(): [number, number] {
    if (this.fullPage) {
      return [window.innerWidth, window.innerHeight];
    }

    const { width, height } = this.requestedSize;

    return [
      Math.max(240, Math.min(width, window.innerWidth - POPUP_MARGIN)),
      Math.max(240, Math.min(height, window.innerHeight - POPUP_MARGIN)),
    ];
  }

  private static addPopupTemplateHtmlToDom(): void {
    // initFromUrl(), initAll() and handleModel() can all run in the same
    // page; guard against injecting a second, duplicate-ID popup.
    if (document.getElementById("stlBackdrop")) {
      return;
    }

    const toggle = (action: string, label: string, content: string) =>
      `<button type="button" class="kadmos-toolbar-button" data-action="${action}" title="${label}" aria-label="${label}" aria-pressed="false">${content}</button>`;
    const view = (preset: ViewPreset, label: string) =>
      `<button type="button" class="kadmos-toolbar-button kadmos-toolbar-button--text" data-action="view" data-view="${preset}" title="${label} view">${label}</button>`;

    const backdrop: string =
      '<div id="stlBackdrop">' +
      '  <div id="stlContent" role="dialog" aria-label="3D model viewer">' +
      '    <div id="stlModel"></div>' +
      '    <div class="kadmos-info" aria-live="polite">' +
      '      <div class="kadmos-info-size"></div>' +
      '      <div class="kadmos-info-meta"></div>' +
      '      <div class="kadmos-info-fit" hidden></div>' +
      "    </div>" +
      '    <div class="kadmos-panels">' +
      '      <div class="kadmos-panel" data-panel="section" hidden>' +
      '        <span class="kadmos-panel-title">Section</span>' +
      '        <div class="kadmos-segmented" role="group" aria-label="Section axis">' +
      '          <button type="button" data-axis="x" aria-pressed="false">X</button>' +
      '          <button type="button" data-axis="y" aria-pressed="false">Y</button>' +
      '          <button type="button" data-axis="z" aria-pressed="true">Z</button>' +
      "        </div>" +
      '        <input type="range" class="kadmos-section-range" min="0" max="1000" value="500" aria-label="Section position">' +
      "      </div>" +
      '      <div class="kadmos-panel" data-panel="measure" hidden>' +
      '        <span class="kadmos-panel-title">Measure</span>' +
      '        <span class="kadmos-panel-hint">Click two points on the model</span>' +
      '        <button type="button" class="kadmos-panel-button" data-measure="clear">Clear</button>' +
      "      </div>" +
      '      <div class="kadmos-panel" data-panel="plate" hidden>' +
      '        <label class="kadmos-panel-title" for="kadmos-plate-select">Build plate</label>' +
      '        <select id="kadmos-plate-select" class="kadmos-plate-select"></select>' +
      "      </div>" +
      "    </div>" +
      '    <div id="stlToolbar" role="toolbar" aria-label="Viewer controls">' +
      '      <div class="kadmos-toolbar-group">' +
      `        <button type="button" class="kadmos-toolbar-button" data-action="reset" title="Reset view" aria-label="Reset view">${ICONS.reset}</button>` +
      `        ${toggle("rotate", "Toggle auto-rotate", ICONS.rotate)}` +
      `        ${toggle("wireframe", "Toggle wireframe", ICONS.wireframe)}` +
      `        ${toggle("texture", "Toggle surface texture", ICONS.texture)}` +
      "      </div>" +
      '      <div class="kadmos-toolbar-group">' +
      `        ${view("top", "Top")}${view("front", "Front")}${view("side", "Side")}${view("iso", "Iso")}` +
      `        ${toggle("ortho", "Toggle orthographic camera", "Ortho").replace('class="kadmos-toolbar-button"', 'class="kadmos-toolbar-button kadmos-toolbar-button--text"')}` +
      "      </div>" +
      '      <div class="kadmos-toolbar-group">' +
      `        ${toggle("dimensions", "Show dimensions", ICONS.dimensions)}` +
      `        ${toggle("section", "Section view", ICONS.section)}` +
      `        ${toggle("measure", "Measure distance", ICONS.measure)}` +
      `        ${toggle("plate", "Show build plate", ICONS.plate)}` +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</div>";

    const backdropNode: Node = document
      .createRange()
      .createContextualFragment(backdrop);
    this.getContentWrapper().appendChild(backdropNode);

    const plateSelect = this.query<HTMLSelectElement>(".kadmos-plate-select");
    for (const [id, plate] of Object.entries(BUILD_PLATES)) {
      plateSelect?.add(new Option(plate.name, id));
    }

    this.initToolbar();
    this.enableTransitions([
      this.getSpinner(),
      this.getErrorWrapper(),
      this.getStlWrapper(),
    ]);

    window.addEventListener("resize", () => {
      this.viewer?.setSize(...this.fitSize());
    });
  }

  /**
   * Turns on the fade transitions once Kadmos' stylesheet has applied.
   * Bundlers often inject it after first paint; with transitions already
   * active, the overlays would visibly fade from unstyled to hidden on
   * page load (a flash of the red error box).
   */
  private static enableTransitions(elements: HTMLElement[], frames = 0): void {
    // The stylesheet makes the spinner fixed; until then it's static.
    const styled = getComputedStyle(elements[0]).position === "fixed";
    if (!styled && frames < 600) {
      requestAnimationFrame(() => this.enableTransitions(elements, frames + 1));
      return;
    }

    // One more frame, so the hidden state is in place before transitions
    // apply to changes.
    requestAnimationFrame(() => {
      for (const element of elements) {
        element.classList.add("kadmos-animated");
      }
    });
  }

  private static bindPopupListeners(): void {
    if (this.popupListenersBound) {
      return;
    }
    this.popupListenersBound = true;

    document.addEventListener("keyup", (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    });

    this.getStlWrapper().addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        this.close();
      }
    });

    // In popup mode the error covers the page, so it must be dismissable.
    this.getErrorWrapper().addEventListener("click", () => {
      if (!this.fullPage) {
        this.close();
      }
    });
  }

  private static initToolbar(): void {
    this.query("#stlToolbar")?.addEventListener("click", (event) => {
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

  private static handleToolbarAction(
    viewer: Viewer,
    button: HTMLElement,
  ): void {
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
        // A fixed view is for inspecting; spinning away from it isn't.
        viewer.autoRotate = false;
        this.setPressed("rotate", false);
        viewer.setView(button.dataset.view as ViewPreset);
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

  private static applySection(): void {
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

  private static applyPlate(): void {
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
  private static resetTools(
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

  private static selectPlate(plate: BuildVolume): void {
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

  private static showStats(stats: ModelStats): void {
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

  private static showFit(
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

  private static isPressed(action: string): boolean {
    return (
      this.query(`[data-action="${action}"]`)?.getAttribute("aria-pressed") ===
      "true"
    );
  }

  private static setPressed(action: string, pressed: boolean): void {
    const button = this.query(`[data-action="${action}"]`);
    button?.setAttribute("aria-pressed", String(pressed));
    button?.classList.toggle("kadmos-toolbar-button--active", pressed);
  }

  private static showPanel(name: string, visible: boolean): void {
    const panel = this.query(`[data-panel="${name}"]`);
    if (panel) {
      panel.hidden = !visible;
    }
  }

  private static showError(message: string): void {
    this.getSpinner().classList.remove("kadmos-spinner--visible");
    this.getErrorWrapper().classList.add("kadmos-error-wrapper--visible");

    const text = document.createElement("p");
    text.textContent = message;
    const content: Node[] = [text];

    if (!this.fullPage) {
      const hint = document.createElement("p");
      hint.className = "kadmos-error-hint";
      hint.textContent = "Press Esc or click to close";
      content.push(hint);
    }

    this.getError().replaceChildren(...content);
  }

  private static revealViewer(token: number): void {
    setTimeout(() => {
      if (token !== this.loadToken) {
        return;
      }

      this.getSpinner().classList.remove("kadmos-spinner--visible");
      setTimeout(() => {
        if (token === this.loadToken) {
          this.getStlWrapper().classList.add("stlBackdrop--visible");
        }
      }, FADE_MS);
    }, 100);
  }

  private static resetUiState(): void {
    this.getSpinner().classList.add("kadmos-spinner--visible");
    this.getSpinnerProgress().textContent = "";
    this.getErrorWrapper().classList.remove("kadmos-error-wrapper--visible");
  }

  private static close(): void {
    // Invalidates any in-flight load and pending reveal.
    this.loadController?.abort();
    this.loadToken++;

    this.getSpinner().classList.remove("kadmos-spinner--visible");
    this.getErrorWrapper().classList.remove("kadmos-error-wrapper--visible");
    this.getStlWrapper().classList.remove("stlBackdrop--visible");

    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.viewer?.stop();
      this.viewer?.clearModel();
    }, FADE_MS);
  }
}

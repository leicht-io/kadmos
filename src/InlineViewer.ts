import {
  applyHostSettings,
  describeLoadError,
  enableTransitionsWhenStyled,
  SPINNER_DOTS,
} from "./dom.js";
import type { ThemeSetting } from "./Viewer.js";
import { ModelOptions, ViewerSettings, ViewerUi } from "./ViewerUi.js";

export interface MountOptions extends ModelOptions, ViewerSettings {
  /** URL of an STL or 3MF file to load right away. */
  src?: string;
}

/** A viewer embedded in the page, returned by `Kadmos.mount()`. */
export interface KadmosViewer {
  /** Loads a model, replacing the current one. Rejects if it can't load. */
  load(src: string, options?: ModelOptions): Promise<void>;
  setTheme(theme: ThemeSetting): void;
  setAccent(accent: string): void;
  /** Removes the viewer and frees its WebGL context. */
  destroy(): void;
}

/**
 * Renders a viewer inside a page element, sized to that element, with
 * its own loading and error states.
 */
export class InlineViewer implements KadmosViewer {
  private readonly root: HTMLElement;
  private readonly ui: ViewerUi;
  private readonly spinner: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly error: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private settings: ViewerSettings;
  private loaded = false;
  private onScreen = true;

  constructor(container: HTMLElement, options: MountOptions = {}) {
    const { src, color, plate, texture, dimensions, ...settings } = options;
    this.settings = settings;

    this.root = document.createElement("div");
    this.root.className = "kadmos-inline";
    applyHostSettings(this.root, settings);
    container.appendChild(this.root);

    this.ui = new ViewerUi(this.root, settings);

    this.spinner = document.createElement("div");
    this.spinner.className = "kadmos-inline-spinner";
    this.spinner.innerHTML = SPINNER_DOTS;
    this.progress = document.createElement("div");
    this.progress.className = "kadmos-spinner-progress";
    this.spinner.appendChild(this.progress);

    this.error = document.createElement("div");
    this.error.className = "kadmos-inline-error";
    this.error.setAttribute("role", "alert");

    this.root.append(this.spinner, this.error);
    enableTransitionsWhenStyled(this.root, "relative", [
      this.spinner,
      this.error,
    ]);

    this.resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        this.ui.setSize(Math.round(width), Math.round(height));
      }
    });
    this.resizeObserver.observe(this.root);

    // Several viewers on a page shouldn't all render while scrolled away.
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting;
      this.updateRendering();
    });
    this.intersectionObserver.observe(this.root);

    if (src) {
      this.load(src, { color, plate, texture, dimensions }).catch(() => {
        // Already shown in the viewer's error state.
      });
    }
  }

  public async load(src: string, options: ModelOptions = {}): Promise<void> {
    this.loaded = false;
    this.progress.textContent = "";
    this.spinner.classList.add("kadmos-inline-spinner--visible");
    this.error.classList.remove("kadmos-inline-error--visible");

    try {
      const result = await this.ui.load(src, options, (fraction) => {
        this.progress.textContent = `${Math.round(fraction * 100)}%`;
      });
      if (result === "superseded") {
        return;
      }

      this.loaded = true;
      this.updateRendering();
      this.spinner.classList.remove("kadmos-inline-spinner--visible");
    } catch (error) {
      console.error(error);
      this.spinner.classList.remove("kadmos-inline-spinner--visible");
      this.error.textContent = describeLoadError(error);
      this.error.classList.add("kadmos-inline-error--visible");
      throw error;
    }
  }

  public setTheme(theme: ThemeSetting): void {
    this.settings = { ...this.settings, theme };
    applyHostSettings(this.root, this.settings);
    this.ui.setTheme(theme);
  }

  public setAccent(accent: string): void {
    this.settings = { ...this.settings, accent };
    applyHostSettings(this.root, this.settings);
    this.ui.setAccent(accent);
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.ui.dispose();
    this.root.remove();
  }

  private updateRendering(): void {
    if (this.loaded && this.onScreen) {
      this.ui.start();
    } else {
      this.ui.stop();
    }
  }
}

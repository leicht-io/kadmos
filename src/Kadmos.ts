import {
  applyHostSettings,
  describeLoadError,
  enableTransitionsWhenStyled,
  whenReady,
} from "./dom.js";
import { InlineViewer, KadmosViewer, MountOptions } from "./InlineViewer.js";
import { ModelOptions, ViewerSettings, ViewerUi } from "./ViewerUi.js";

export type { KadmosViewer, MountOptions } from "./InlineViewer.js";
export type { ModelOptions, ThemeSetting, ViewerSettings } from "./ViewerUi.js";

const FADE_MS = 250;
const POPUP_MARGIN = 32;

export class Kadmos {
  private static ui: ViewerUi | undefined;
  private static settings: ViewerSettings = {};
  private static fullPage = false;
  private static requestedSize = { width: 800, height: 600 };
  private static openToken = 0;
  private static closeTimer: number | undefined;
  private static popupListenersBound = false;
  private static readonly triggerClasses = new Set<string>();

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

  /**
   * Embeds a viewer inside `element`, sized to fill it, so give the
   * element a height (or an aspect-ratio). Any number of viewers can be
   * mounted on a page; each is independent of popup and full-page mode.
   */
  public static mount(
    element: HTMLElement,
    options: MountOptions = {},
  ): KadmosViewer {
    return new InlineViewer(element, options);
  }

  /**
   * Sets theme, accent color and file size limit for popup and full-page
   * mode. Can be called before or after initAll()/initFromUrl(), and
   * again later, e.g. when the site's own theme switch changes.
   */
  public static configure(settings: ViewerSettings): void {
    this.settings = { ...this.settings, ...settings };
    this.ui?.setTheme(this.settings.theme ?? "auto");
    if (this.settings.accent) {
      this.ui?.setAccent(this.settings.accent);
    }
    this.ui?.setMaxFileSize(this.settings.maxFileSize);

    whenReady(() => {
      const app = document.getElementById("kadmos-app");
      if (app) {
        applyHostSettings(app, this.settings);
      }
    });
  }

  public static initFromUrl(): void {
    this.fullPage = true;

    whenReady(() => {
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
    whenReady(() => {
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
   * Opens a model in the popup (or the full page, after initFromUrl()).
   * In popup mode `width` and `height` are the largest size the popup
   * grows to; it shrinks to fit the window.
   */
  public static handleModel(
    filePath: string,
    color?: string | null,
    width = 800,
    height = 600,
    options: Omit<ModelOptions, "color"> = {},
  ): void {
    const ui = this.addPopupTemplateHtmlToDom();
    if (!this.fullPage) {
      this.bindPopupListeners();
    }

    window.clearTimeout(this.closeTimer);
    const token = ++this.openToken;
    this.requestedSize = { width, height };
    this.resetUiState();
    ui.setSize(...this.fitSize());

    ui.load(filePath, { ...options, color }, (fraction) => {
      this.getSpinnerProgress().textContent = `${Math.round(fraction * 100)}%`;
    })
      .then((result) => {
        if (result === "loaded" && token === this.openToken) {
          this.revealViewer(token);
        }
      })
      .catch((error: unknown) => {
        if (token !== this.openToken) {
          return;
        }

        console.error(error);
        this.showError(describeLoadError(error));
      });
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

  private static addPopupTemplateHtmlToDom(): ViewerUi {
    // initFromUrl(), initAll() and handleModel() can all run in the same
    // page; guard against injecting a second, duplicate-ID popup.
    if (this.ui) {
      return this.ui;
    }

    const backdrop =
      '<div id="stlBackdrop">' +
      '  <div id="stlContent" role="dialog" aria-label="3D model viewer"></div>' +
      "</div>";
    this.getContentWrapper().appendChild(
      document.createRange().createContextualFragment(backdrop),
    );

    const ui = new ViewerUi(
      this.getStlWrapper().querySelector<HTMLElement>("#stlContent")!,
      this.settings,
    );
    this.ui = ui;

    const app = document.getElementById("kadmos-app");
    if (app) {
      applyHostSettings(app, this.settings);
    }

    // The stylesheet makes the spinner position: fixed.
    enableTransitionsWhenStyled(this.getSpinner(), "fixed", [
      this.getSpinner(),
      this.getErrorWrapper(),
      this.getStlWrapper(),
    ]);

    window.addEventListener("resize", () => {
      ui.setSize(...this.fitSize());
    });

    return ui;
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
      if (token !== this.openToken) {
        return;
      }

      this.getSpinner().classList.remove("kadmos-spinner--visible");
      setTimeout(() => {
        if (token === this.openToken) {
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
    this.ui?.abort();
    this.openToken++;

    this.getSpinner().classList.remove("kadmos-spinner--visible");
    this.getErrorWrapper().classList.remove("kadmos-error-wrapper--visible");
    this.getStlWrapper().classList.remove("stlBackdrop--visible");

    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.ui?.stop();
      this.ui?.clear();
    }, FADE_MS);
  }
}

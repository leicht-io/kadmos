import { parseColor } from "./color.js";
import type { ViewerSettings } from "./ViewerUi.js";

export function whenReady(callback: () => void): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
}

/**
 * Turns on fade transitions once Kadmos' stylesheet has applied, detected
 * by `probe` reaching its styled `position`. Bundlers often inject the
 * stylesheet after first paint; with transitions already active, overlays
 * would visibly fade from unstyled to hidden on page load (e.g. a flash of
 * the red error box).
 */
export function enableTransitionsWhenStyled(
  probe: HTMLElement,
  styledPosition: string,
  elements: HTMLElement[],
  frames = 0,
): void {
  if (getComputedStyle(probe).position !== styledPosition && frames < 600) {
    requestAnimationFrame(() =>
      enableTransitionsWhenStyled(probe, styledPosition, elements, frames + 1),
    );
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

/** Applies theme and accent to the CSS of a host element's subtree. */
export function applyHostSettings(
  root: HTMLElement,
  settings: ViewerSettings,
): void {
  root.dataset.kadmosTheme = settings.theme ?? "auto";

  const accent = parseColor(settings.accent);
  if (accent === undefined) {
    root.style.removeProperty("--kadmos-accent");
  } else {
    root.style.setProperty(
      "--kadmos-accent",
      `#${accent.toString(16).padStart(6, "0")}`,
    );
  }
}

export function describeLoadError(error: unknown): string {
  // Matched by name: importing the error class would pull three.js into
  // the initial bundle.
  return error instanceof Error && error.name === "ModelTooLargeError"
    ? "The model is too large to display"
    : "The model could not be loaded";
}

export const SPINNER_DOTS =
  '<div class="spinner"><div class="dot1"></div><div class="dot2"></div></div>';

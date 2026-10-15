# Changelog

## 2.0.0 — 2026-10-15

### Breaking changes

- `three` is now a peer dependency: install it alongside Kadmos (`npm install kadmos three`).
- The viewer's markup and CSS classes changed. The popup still lives in `#stlBackdrop` / `#stlContent`,
  but its contents use classes (`.kadmos-viewer`, `.kadmos-model`, `.kadmos-toolbar`, …) instead of the
  `#stlModel` and `#stlToolbar` IDs. Custom CSS targeting the old IDs needs updating.
- Colors that can't be parsed are ignored instead of rendering black.

### Added

- Inline mode: `Kadmos.mount(element, options)` embeds any number of viewers in a page, each sized to its
  element with its own loading and error states, and returns a handle with `load()`, `setTheme()`,
  `setAccent()` and `destroy()`.
- `Kadmos.configure()` for popup and full-page mode: `theme` (`auto`, `light`, `dark`), `accent` color
  and `maxFileSize`.
- 3MF support, including materials and unit conversion; colored binary STL support.
- Dimensions overlay with size, volume and triangle count (on by default).
- Build plate overlay with presets for common printers and a fit check.
- Inspection tools: top/front/side/iso views, orthographic camera, section plane, distance measuring.
- Realistic rendering: satin plastic with a fine procedural grain, smooth shading with crisp hard edges,
  soft shadows, ambient occlusion and neutral tone mapping.
- `#333333`-style colors; `plate`, `dimensions` and `texture` options as query params and `data-*`
  attributes.
- A file size limit (200 MB by default), applied to downloads and to a 3MF's unpacked contents.
- Popup triggers can be links (`<a href>`), keeping them crawlable and usable without JavaScript.
- Demo pages for all three modes, with sample models.

### Fixed

- Load errors in popup mode can be dismissed; Escape or closing cancels an in-flight load.
- A slow earlier load can no longer appear in a later model's view; reopening quickly no longer shows a
  blank viewer.
- One WebGL context is reused instead of one per popup, and model resources are freed.
- The camera keeps its proportions on resize, and re-fits the model while the visitor hasn't zoomed or
  panned.
- No flash of the error box or spinner while the stylesheet loads.
- The published type declarations no longer break type-checking in consumers.
- Tool buttons reset for each model; calling `initAll()` twice no longer double-binds clicks.

### Performance

- three.js is loaded on demand, keeping it out of the page's initial bundle.
- The viewer renders only when something changes, and pauses inline viewers scrolled out of view.

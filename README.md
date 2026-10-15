# Kadmos

[![npm version](https://img.shields.io/npm/v/kadmos.svg)](https://www.npmjs.com/package/kadmos)
[![npm license](https://img.shields.io/npm/l/kadmos.svg)](https://github.com/leicht-io/kadmos/blob/master/LICENSE)
[![CI](https://github.com/leicht-io/kadmos/actions/workflows/ci.yml/badge.svg)](https://github.com/leicht-io/kadmos/actions/workflows/ci.yml)

A zero-configuration TypeScript library built on [Three.js](https://threejs.org/) that renders 3D models in
STL and 3MF format, served by URL, in an interactive viewer. Drop it into any page and it wires itself up from
either a query string or a few `data-*` attributes — no scene, camera, or renderer setup required.

The viewer includes:

- **Realistic rendering** — a satin PLA-like plastic with a fine surface grain, soft environment lighting, a
  key light with soft shadows on the ground, ambient occlusion, and smooth shading of curved surfaces (hard
  edges stay crisp).
- **Model colors** — 3MF materials and colored binary STL files render in their own colors.
- **Dimensions** — size, volume and triangle count, plus a bounding box with labeled extents (shown by
  default).
- **Inspection tools** — top/front/side/iso views, an orthographic camera, a section (clipping) plane along
  X, Y or Z, and point-to-point measuring.
- **Build plate overlay** — shows a printer's bed and build volume and whether the model fits.
- Orbit controls, auto-rotate, wireframe, auto-fit framing, a loading progress indicator, and light/dark
  themes that follow the visitor's system setting.

### Demo

The included demo application (see [Local development](#local-development)) is a minimal page that only
exercises query-param mode — visit it with a `fileUrl` param to see the viewer in action.

![Kadmos in use](https://github.com/leicht-io/kadmos/blob/master/examples/graphics/demo-image.PNG?raw=true)

## Installing

`three` is a peer dependency, so your app and Kadmos share a single copy:

```
npm install kadmos three
```

or

```
yarn add kadmos three
```

Kadmos ships as an ES module and requires a bundler (Vite, webpack, etc.). It imports its own stylesheet
(`import "./assets/styles.css"`) and the `three/addons/*` submodules, both of which the bundler must
resolve — loading `dist/index.js` directly in a browser will not work. The 3D engine is loaded with a dynamic
`import()`, so bundlers split it into its own chunk that is only downloaded when a viewer first opens.

## Usage

```typescript
import { Kadmos } from "kadmos";
```

Kadmos looks for a fixed set of host elements in your page and throws a descriptive error when it needs one
that is missing:

| Element                                              | Purpose                                               |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `#kadmos-app`                                        | Wrapper that carries Kadmos' theme (CSS variables)    |
| `#kadmos-spinner`                                    | Shown while a model is loading                        |
| `#kadmos-error-wrapper` (containing `#kadmos-error`) | Shown if loading fails or required params are missing |
| `#kadmos-content`                                    | Container Kadmos injects its viewer popup into        |

The elements must be in the page by the time the DOM has loaded. Minimal markup (see also
[`examples/index.html`](examples/index.html)):

```html
<div id="kadmos-app">
  <div id="kadmos-spinner">
    <div class="spinner">
      <div class="dot1"></div>
      <div class="dot2"></div>
    </div>
  </div>

  <div id="kadmos-content"></div>

  <div id="kadmos-error-wrapper">
    <div id="kadmos-error"></div>
  </div>
</div>
```

### 1. Query-param mode — `Kadmos.initFromUrl()`

Loads a model full-page, driven entirely by the URL:

```typescript
Kadmos.initFromUrl();
```

```
http://localhost:1234/?fileUrl=https://example.com/model.stl&color=0x333333&plate=prusa-mk4
```

| Query param  | Required | Description                                                  |
| ------------ | -------- | ------------------------------------------------------------ |
| `fileUrl`    | yes      | URL of the STL or 3MF file to load                           |
| `color`      | no       | Model color, e.g. `0x333333` or `#333333` (see Color format) |
| `plate`      | no       | Build plate to show on load (see Build plates)               |
| `dimensions` | no       | `false` hides the dimensions overlay on load                 |
| `texture`    | no       | `false` turns the plastic surface texture off on load        |

If `fileUrl` is missing, Kadmos shows the error UI instead of loading anything.

### 2. Popup mode — `Kadmos.initAll(className)`

Makes every element with the given class name open the viewer in a popup over the page when clicked:

```typescript
Kadmos.initAll("kadmos-trigger");
```

```html
<a
  class="kadmos-trigger"
  href="https://example.com/model.3mf"
  data-file="https://example.com/model.3mf"
  data-plate="bambu-x1"
>
  View model
</a>
```

Any element works as a trigger. A link, as above, is the most robust choice: search engines can follow it,
and without JavaScript it still downloads the model. Kadmos prevents the navigation when it opens the viewer.

| Data attribute    | Required | Description                                                  |
| ----------------- | -------- | ------------------------------------------------------------ |
| `data-file`       | yes      | URL of the STL or 3MF file to load                           |
| `data-color`      | no       | Model color, e.g. `0x3b6ea5` or `#3b6ea5` (see Color format) |
| `data-plate`      | no       | Build plate to show on load (see Build plates)               |
| `data-dimensions` | no       | `false` hides the dimensions overlay on load                 |
| `data-texture`    | no       | `false` turns the plastic surface texture off on load        |

Clicks are handled by a single delegated listener, so triggers added to the page later work too. The popup
is up to 800×600 and shrinks to fit smaller windows. It closes on the Escape key or a click outside its
content; a load error closes the same way.

### 3. Programmatic — `Kadmos.handleModel(fileUrl, color?, width?, height?, options?)`

Opens a model directly, e.g. from your own UI. `width` and `height` set the largest popup size (default
800×600). `options` takes `plate`, `dimensions` and `texture`, as above.

### Formats and units

STL (binary and ASCII) and 3MF are supported; the format is detected from the file contents. STL files are
unitless and assumed to be in millimeters, the convention for 3D printing. 3MF files declare a unit, which
Kadmos converts, so all dimensions are shown in millimeters.

### Color format

Colors are hex strings, either `0x333333` or CSS-style `#333333` / `#333`. When no color is given, models that
carry their own colors (3MF materials, colored binary STL) keep them and anything else renders in
`0x626262`; a given color overrides the model's own. A malformed color is ignored. Pure black (`0x000000` or
any equivalent spelling) is nudged to a dark gray (`0x444444`), since true black renders as a featureless
silhouette.

### Build plates

`plate` / `data-plate` takes a preset id or explicit dimensions in millimeters as `WIDTHxDEPTHxHEIGHT`, e.g.
`250x210x220`. The overlay outlines the build volume in green when the model fits (also checking a 90° turn
on the plate) and red when it doesn't, with the overhang per axis. Visitors can switch plates from the
viewer's build plate panel.

| Preset id       | Printer                | Build volume (mm) |
| --------------- | ---------------------- | ----------------- |
| `bambu-x1`      | Bambu Lab X1 / P1 / A1 | 256 × 256 × 256   |
| `bambu-a1-mini` | Bambu Lab A1 mini      | 180 × 180 × 180   |
| `prusa-mk4`     | Prusa MK4              | 250 × 210 × 220   |
| `prusa-mini`    | Prusa MINI+            | 180 × 180 × 180   |
| `prusa-xl`      | Prusa XL               | 360 × 360 × 360   |
| `ender-3`       | Creality Ender-3       | 220 × 220 × 250   |
| `voron-350`     | Voron 2.4 (350)        | 350 × 350 × 340   |

### Viewer controls

The toolbar (bottom-left) has three groups:

- **View** — reset view, toggle auto-rotate (on by default), toggle wireframe, toggle the surface texture
  (on by default).
- **Camera** — top, front, side and iso views (these stop auto-rotate), and an orthographic camera toggle.
- **Tools** — dimensions (on by default), section view (pick an axis and drag the slider), measure (click two points on the
  model; the distance is shown in millimeters), and build plate.

## Local development

```
git clone https://github.com/leicht-io/kadmos.git
cd kadmos
corepack enable  # uses the Yarn 4 version pinned in package.json
yarn install
yarn start         # Vite dev server against examples/
yarn build         # library build (tsc -> dist/)
yarn build:app     # production build of the demo app (examples/dist/)
yarn test          # unit tests (Vitest)
yarn lint          # ESLint
yarn format        # Prettier (write)
yarn format:check  # Prettier (check only, as CI runs it)
```

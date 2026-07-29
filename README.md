# Kadmos

[![npm version](https://img.shields.io/npm/v/kadmos.svg)](https://www.npmjs.com/package/kadmos)
[![npm license](https://img.shields.io/npm/l/kadmos.svg)](https://github.com/leicht-io/kadmos/blob/master/LICENSE)
[![CI](https://github.com/leicht-io/kadmos/actions/workflows/ci.yml/badge.svg)](https://github.com/leicht-io/kadmos/actions/workflows/ci.yml)

A zero-configuration TypeScript library built on [Three.js](https://threejs.org/) that renders 3D models in
STL format, served by URL, in an interactive viewer. Drop it into any page and it wires itself up from either
a query string or a few `data-*` attributes — no scene, camera, or renderer setup required.

The viewer includes orbit controls, auto-fit framing (any model, any unit scale), a loading progress
indicator, soft environment lighting, and a small toolbar (bottom-left) for resetting the view, toggling
auto-rotate (on by default), and toggling wireframe.

### Demo

The included demo application (see [Local development](#local-development)) is a minimal page that only
exercises query-param mode — visit it with a `fileUrl` param to see the viewer in action.

![Kadmos in use](https://github.com/leicht-io/kadmos/blob/master/examples/graphics/demo-image.PNG?raw=true)

## Installing

```
npm install kadmos
```

or

```
yarn add kadmos
```

Kadmos ships as an ES module and expects a bundler (Vite, webpack, etc.) or a modern browser environment
that resolves `three` and its `three/addons/*` submodules.

## Usage

Kadmos looks for a fixed set of host elements in your page and throws a descriptive error if any are
missing:

| Element                                              | Purpose                                               |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `#kadmos-spinner`                                    | Shown while a model is loading                        |
| `#kadmos-error-wrapper` (containing `#kadmos-error`) | Shown if loading fails or required params are missing |
| `#kadmos-content`                                    | Container Kadmos injects its viewer popup into        |

See [`examples/index.html`](examples/index.html) for the minimal markup.

### 1. Query-param mode — `Kadmos.initFromUrl()`

Loads a model full-page, driven entirely by the URL:

```typescript
Kadmos.initFromUrl();
```

```
http://localhost:1234/?fileUrl=https://example.com/model.stl&color=0x333333
```

| Query param | Required | Description                                            |
| ----------- | -------- | ------------------------------------------------------ |
| `fileUrl`   | yes      | URL of the STL file to load                            |
| `color`     | no       | Hex color string, e.g. `0x333333` (default `0x626262`) |

If `fileUrl` is missing, Kadmos shows the error UI instead of loading anything.

### 2. Popup mode — `Kadmos.initAll(selector)`

Wires a click listener onto every element with the given class name; clicking one opens the viewer in a
popup over the page:

```typescript
Kadmos.initAll("kadmos-trigger");
```

```html
<button
  class="kadmos-trigger"
  data-file="https://example.com/model.stl"
  data-color="0x3b6ea5"
>
  View model
</button>
```

| Data attribute | Required | Description                                            |
| -------------- | -------- | ------------------------------------------------------ |
| `data-file`    | yes      | URL of the STL file to load                            |
| `data-color`   | no       | Hex color string, e.g. `0x3b6ea5` (default `0x626262`) |

The popup closes on the Escape key or a click outside its content.

### Color format

Colors are hex strings, e.g. `"0x333333"`. Passing pure black (`0x000000` or any equivalent spelling) is
automatically nudged to a dark gray (`0x444444`), since true black renders as a featureless silhouette
against the viewer's shadows.

## Local development

```
git clone https://github.com/leicht-io/kadmos.git
cd kadmos
yarn install
yarn start       # Vite dev server against examples/
yarn build       # library build (tsc -> dist/)
yarn build:app   # production build of the demo app
yarn lint        # ESLint
```

import { BufferGeometry, Group, Loader, Mesh, MeshPhongMaterial } from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { unzipSync } from "three/addons/libs/fflate.module.js";

export interface LoadOptions {
  signal?: AbortSignal;
  /** Called with the downloaded fraction (0–1) when the size is known. */
  onProgress?: (fraction: number) => void;
}

// Faces meeting at a sharper angle than this keep a hard edge; anything
// shallower is shaded smooth, so curved surfaces lose their facets while
// chamfers and right angles stay crisp.
const CREASE_ANGLE = (30 * Math.PI) / 180;

const UNIT_SCALE: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/**
 * Downloads and parses an STL or 3MF model. The result is in millimeters
 * (STL files are unitless and conventionally authored in millimeters).
 * Meshes without colors of their own carry a material named
 * `Loader.DEFAULT_MATERIAL_NAME`.
 */
export async function loadModel(
  url: string,
  options: LoadOptions = {},
): Promise<Group> {
  const buffer = await fetchBuffer(url, options);
  const model = is3mf(url, buffer) ? parse3mf(buffer) : parseStl(buffer);

  model.traverse((child) => {
    if (child instanceof Mesh) {
      const smoothed = toCreasedNormals(child.geometry, CREASE_ANGLE);
      if (smoothed !== child.geometry) {
        child.geometry.dispose();
      }
      child.geometry = smoothed;
    }
  });

  return model;
}

async function fetchBuffer(
  url: string,
  { signal, onProgress }: LoadOptions,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Kadmos: request failed with status ${response.status}`);
  }

  const total = Number(response.headers.get("content-length"));
  if (!response.body || !onProgress || !total) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    loaded += value.byteLength;
    // Content-Length is the compressed size for gzipped responses, so the
    // decoded byte count can overshoot it.
    onProgress(Math.min(1, loaded / total));
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}

function is3mf(url: string, buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  // 3MF is a zip container ("PK\x03\x04"); binary STL headers are
  // free-form, so also trust an explicit .3mf extension.
  const isZip =
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;

  return isZip || /\.3mf(?:$|[?#])/i.test(url);
}

function parseStl(buffer: ArrayBuffer): Group {
  const geometry: BufferGeometry & { hasColors?: boolean; alpha?: number } =
    new STLLoader().parse(buffer);

  let material: MeshPhongMaterial;
  if (geometry.hasColors) {
    // STLLoader writes the file's sRGB bytes straight into the color
    // attribute, but three.js treats vertex colors as linear.
    const colors = geometry.getAttribute("color");
    for (let i = 0; i < colors.array.length; i++) {
      colors.array[i] = srgbToLinear(colors.array[i]);
    }

    const alpha = geometry.alpha ?? 1;
    material = new MeshPhongMaterial({
      vertexColors: true,
      opacity: alpha,
      transparent: alpha < 1,
    });
  } else {
    material = new MeshPhongMaterial({ name: Loader.DEFAULT_MATERIAL_NAME });
  }

  const group = new Group();
  group.add(new Mesh(geometry, material));

  return group;
}

function parse3mf(buffer: ArrayBuffer): Group {
  const group = new ThreeMFLoader().parse(buffer);
  // ThreeMFLoader reads the model's unit but never applies it.
  group.scale.multiplyScalar(read3mfUnitScale(buffer));

  return group;
}

/**
 * Returns the factor that converts a 3MF file's declared unit to
 * millimeters. This unzips the model part a second time (ThreeMFLoader
 * doesn't expose the unit), which is cheap next to building the meshes.
 */
export function read3mfUnitScale(buffer: ArrayBuffer): number {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (file) => file.name.toLowerCase().endsWith("3dmodel.model"),
  });
  const model = Object.values(files)[0];
  if (!model) {
    return 1;
  }

  // The unit is an attribute of the root <model> element, near the top.
  const head = new TextDecoder().decode(model.subarray(0, 4096));
  const unit = /<model\b[^>]*\bunit\s*=\s*["']([a-z]+)["']/i.exec(head)?.[1];

  return (unit && UNIT_SCALE[unit.toLowerCase()]) || 1;
}

function srgbToLinear(c: number): number {
  return c < 0.04045
    ? c * 0.0773993808
    : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

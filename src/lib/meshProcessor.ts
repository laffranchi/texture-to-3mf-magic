import * as THREE from 'three';
import { RGB, medianCut, findNearestColor } from './colorQuantization';
import { simplifyGeometryAsync, getTriangleCount } from './meshSimplifier';

export type SubdivisionLevel = 'none' | 'low' | 'medium' | 'high';

const SUBDIVISION_ITERATIONS: Record<SubdivisionLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export interface ProcessedMesh {
  colorIndex: number;
  color: RGB;
  geometry: THREE.BufferGeometry;
  faceCount: number;
}

export interface ProcessingResult {
  originalTriangles: number;
  processedTriangles: number;
  meshes: ProcessedMesh[];
  palette: RGB[];
  colorStats: { color: RGB; count: number; percentage: number }[];
}

export interface ProcessingProgress {
  stage: 'simplifying' | 'subdividing' | 'sampling' | 'quantizing' | 'grouping' | 'building';
  progress: number;
  message: string;
}

// Safety limits
export const TRIANGLE_LIMITS = {
  WARNING: 100000,
  MAX: 500000,
};

const MAX_QUANTIZATION_SAMPLES = 50000;

// Texture sampler cache - created once per processing session
class TextureSampler {
  private imageData: ImageData | null = null;
  private width: number = 0;
  private height: number = 0;
  private hasTexture: boolean = false;

  async initialize(texture: THREE.Texture | null): Promise<boolean> {
    if (!texture?.image) {
      console.warn('[TextureSampler] No texture or texture.image provided');
      return false;
    }

    const image = texture.image;
    
    // Support HTMLImageElement, HTMLCanvasElement, and ImageBitmap
    let sourceWidth = 0;
    let sourceHeight = 0;
    let drawSource: CanvasImageSource | null = null;

    if (image instanceof HTMLImageElement) {
      // Wait for image to load if not ready
      if (!image.complete || image.naturalWidth === 0) {
        console.log('[TextureSampler] Waiting for HTMLImageElement to load...');
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Image failed to load'));
          // If already loaded, resolve immediately
          if (image.complete && image.naturalWidth > 0) resolve();
        });
      }
      sourceWidth = image.naturalWidth || image.width;
      sourceHeight = image.naturalHeight || image.height;
      drawSource = image;
      console.log(`[TextureSampler] HTMLImageElement: ${sourceWidth}x${sourceHeight}`);
    } else if (image instanceof HTMLCanvasElement) {
      sourceWidth = image.width;
      sourceHeight = image.height;
      drawSource = image;
      console.log(`[TextureSampler] HTMLCanvasElement: ${sourceWidth}x${sourceHeight}`);
    } else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      sourceWidth = image.width;
      sourceHeight = image.height;
      drawSource = image;
      console.log(`[TextureSampler] ImageBitmap: ${sourceWidth}x${sourceHeight}`);
    } else if (image.width && image.height) {
      // Fallback for other image-like objects
      sourceWidth = image.width;
      sourceHeight = image.height;
      drawSource = image as CanvasImageSource;
      console.log(`[TextureSampler] Unknown image type with dimensions: ${sourceWidth}x${sourceHeight}`);
    }

    if (!drawSource || sourceWidth === 0 || sourceHeight === 0) {
      console.warn('[TextureSampler] Invalid image source or zero dimensions');
      return false;
    }

    this.width = sourceWidth;
    this.height = sourceHeight;

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[TextureSampler] Could not get canvas 2d context');
      return false;
    }

    try {
      ctx.drawImage(drawSource, 0, 0, this.width, this.height);
      this.imageData = ctx.getImageData(0, 0, this.width, this.height);
      this.hasTexture = true;
      console.log(`[TextureSampler] Successfully initialized with ${this.width}x${this.height} texture`);
      return true;
    } catch (e) {
      console.error('[TextureSampler] Error drawing image to canvas:', e);
      return false;
    }
  }

  sample(u: number, v: number): RGB {
    if (!this.imageData || !this.hasTexture) {
      // Fallback: magenta to make it obvious there's no texture
      return { r: 255, g: 0, b: 255 };
    }

    // Wrap UV coordinates properly and clamp to valid range
    const wrappedU = ((u % 1) + 1) % 1;
    const wrappedV = ((v % 1) + 1) % 1;
    
    // Convert to pixel coordinates, clamping to valid range
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(wrappedU * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((1 - wrappedV) * this.height)));

    const idx = (y * this.width + x) * 4;
    
    // Additional bounds check
    if (idx < 0 || idx + 2 >= this.imageData.data.length) {
      return { r: 255, g: 0, b: 255 };
    }

    return {
      r: this.imageData.data[idx],
      g: this.imageData.data[idx + 1],
      b: this.imageData.data[idx + 2],
    };
  }

  dispose() {
    this.imageData = null;
    this.hasTexture = false;
  }
}

// Async helper to yield to UI
async function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Simple subdivision: split each triangle into 4 (async version)
async function subdivideGeometryAsync(
  geometry: THREE.BufferGeometry,
  iterations: number,
  onProgress: (progress: ProcessingProgress) => void
): Promise<THREE.BufferGeometry> {
  if (iterations === 0) return geometry.clone();

  // Our subdivision code expects non-indexed triangles.
  let currentGeometry = geometry.clone();
  if (currentGeometry.index) {
    const nonIndexed = currentGeometry.toNonIndexed();
    currentGeometry.dispose();
    currentGeometry = nonIndexed;
  }

  for (let iter = 0; iter < iterations; iter++) {
    onProgress({
      stage: 'subdividing',
      progress: (iter / iterations) * 100,
      message: `Subdividindo... (iteração ${iter + 1}/${iterations})`,
    });

    const positions = currentGeometry.getAttribute('position');
    const uvs = currentGeometry.getAttribute('uv');
    const normals = currentGeometry.getAttribute('normal');

    if (!positions) break;

    const newPositions: number[] = [];
    const newUvs: number[] = [];
    const newNormals: number[] = [];

    const triCount = positions.count / 3;
    const BATCH_SIZE = 1000;

    for (let batchStart = 0; batchStart < triCount; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, triCount);

      for (let i = batchStart; i < batchEnd; i++) {
        const i0 = i * 3;
        const i1 = i * 3 + 1;
        const i2 = i * 3 + 2;

        // Get vertices
        const v0 = new THREE.Vector3().fromBufferAttribute(positions, i0);
        const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
        const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);

        // Midpoints
        const m01 = v0.clone().add(v1).multiplyScalar(0.5);
        const m12 = v1.clone().add(v2).multiplyScalar(0.5);
        const m20 = v2.clone().add(v0).multiplyScalar(0.5);

        // Get UVs
        let uv0 = new THREE.Vector2(0, 0);
        let uv1 = new THREE.Vector2(1, 0);
        let uv2 = new THREE.Vector2(0.5, 1);

        if (uvs) {
          uv0.set(uvs.getX(i0), uvs.getY(i0));
          uv1.set(uvs.getX(i1), uvs.getY(i1));
          uv2.set(uvs.getX(i2), uvs.getY(i2));
        }

        const uvM01 = uv0.clone().add(uv1).multiplyScalar(0.5);
        const uvM12 = uv1.clone().add(uv2).multiplyScalar(0.5);
        const uvM20 = uv2.clone().add(uv0).multiplyScalar(0.5);

        // Get normals
        let n0 = new THREE.Vector3(0, 1, 0);
        let n1 = new THREE.Vector3(0, 1, 0);
        let n2 = new THREE.Vector3(0, 1, 0);

        if (normals) {
          n0 = new THREE.Vector3().fromBufferAttribute(normals, i0);
          n1 = new THREE.Vector3().fromBufferAttribute(normals, i1);
          n2 = new THREE.Vector3().fromBufferAttribute(normals, i2);
        }

        const nM01 = n0.clone().add(n1).normalize();
        const nM12 = n1.clone().add(n2).normalize();
        const nM20 = n2.clone().add(n0).normalize();

        // Create 4 triangles
        const triangles = [
          [v0, m01, m20],
          [m01, v1, m12],
          [m20, m12, v2],
          [m01, m12, m20],
        ];

        const uvTriangles = [
          [uv0, uvM01, uvM20],
          [uvM01, uv1, uvM12],
          [uvM20, uvM12, uv2],
          [uvM01, uvM12, uvM20],
        ];

        const normalTriangles = [
          [n0, nM01, nM20],
          [nM01, n1, nM12],
          [nM20, nM12, n2],
          [nM01, nM12, nM20],
        ];

        for (let t = 0; t < 4; t++) {
          for (let v = 0; v < 3; v++) {
            newPositions.push(triangles[t][v].x, triangles[t][v].y, triangles[t][v].z);
            newUvs.push(uvTriangles[t][v].x, uvTriangles[t][v].y);
            newNormals.push(normalTriangles[t][v].x, normalTriangles[t][v].y, normalTriangles[t][v].z);
          }
        }
      }

      // Yield to UI every few batches
      if (batchStart % (BATCH_SIZE * 5) === 0) {
        await yieldToUI();
      }
    }

    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
    newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));

    currentGeometry.dispose();
    currentGeometry = newGeometry;

    await yieldToUI();
  }

  return currentGeometry;
}

// Sample face colors using cached texture sampler (async version)
async function sampleFaceColorsAsync(
  geometry: THREE.BufferGeometry,
  sampler: TextureSampler,
  onProgress: (progress: ProcessingProgress) => void
): Promise<RGB[]> {
  const uvAttr = geometry.getAttribute('uv');
  const posAttr = geometry.getAttribute('position');
  const indexAttr = geometry.getIndex();

  const totalFaces = indexAttr
    ? indexAttr.count / 3
    : posAttr
      ? posAttr.count / 3
      : 0;

  const faceColors: RGB[] = [];
  const BATCH_SIZE = 2000;

  for (let batchStart = 0; batchStart < totalFaces; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, totalFaces);

    for (let faceIndex = batchStart; faceIndex < batchEnd; faceIndex++) {
      if (!uvAttr) {
        faceColors.push({ r: 200, g: 200, b: 200 });
        continue;
      }

      const base = faceIndex * 3;
      const vi0 = indexAttr ? indexAttr.getX(base) : base;
      const vi1 = indexAttr ? indexAttr.getX(base + 1) : base + 1;
      const vi2 = indexAttr ? indexAttr.getX(base + 2) : base + 2;

      // Get center UV of face
      const u = (uvAttr.getX(vi0) + uvAttr.getX(vi1) + uvAttr.getX(vi2)) / 3;
      const v = (uvAttr.getY(vi0) + uvAttr.getY(vi1) + uvAttr.getY(vi2)) / 3;

      faceColors.push(sampler.sample(u, v));
    }

    const progress = totalFaces === 0 ? 100 : (batchEnd / totalFaces) * 100;
    onProgress({
      stage: 'sampling',
      progress,
      message: `Amostrando cores... ${Math.round(progress)}%`,
    });

    await yieldToUI();
  }

  return faceColors;
}

// Build meshes by color group (async version)
async function buildMeshesByColorAsync(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[],
  totalFaces: number,
  onProgress: (progress: ProcessingProgress) => void
): Promise<{ meshes: ProcessedMesh[]; colorStats: { color: RGB; count: number; percentage: number }[] }> {
  onProgress({
    stage: 'grouping',
    progress: 0,
    message: 'Agrupando faces por cor...',
  });

  const colorGroups: Map<number, number[]> = new Map();
  for (let i = 0; i < totalFaces; i++) {
    const colorIdx = faceColorIndices[i];
    if (!colorGroups.has(colorIdx)) {
      colorGroups.set(colorIdx, []);
    }
    colorGroups.get(colorIdx)!.push(i);
  }

  await yieldToUI();

  onProgress({
    stage: 'building',
    progress: 0,
    message: 'Construindo meshes...',
  });

  const meshes: ProcessedMesh[] = [];
  const colorStats: { color: RGB; count: number; percentage: number }[] = [];

  const posAttr = geometry.getAttribute('position');
  const normAttr = geometry.getAttribute('normal');
  const indexAttr = geometry.getIndex();

  let processedGroups = 0;
  const totalGroups = colorGroups.size;

  for (const [colorIndex, faceIndices] of colorGroups.entries()) {
    const newPositions: number[] = [];
    const newNormals: number[] = [];

    for (const faceIdx of faceIndices) {
      for (let v = 0; v < 3; v++) {
        const base = faceIdx * 3 + v;
        const vertIdx = indexAttr ? indexAttr.getX(base) : base;

        newPositions.push(posAttr.getX(vertIdx), posAttr.getY(vertIdx), posAttr.getZ(vertIdx));
        if (normAttr) {
          newNormals.push(normAttr.getX(vertIdx), normAttr.getY(vertIdx), normAttr.getZ(vertIdx));
        }
      }
    }

    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    if (newNormals.length > 0) {
      newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
    }
    newGeometry.computeBoundingBox();

    meshes.push({
      colorIndex,
      color: palette[colorIndex],
      geometry: newGeometry,
      faceCount: faceIndices.length,
    });

    colorStats.push({
      color: palette[colorIndex],
      count: faceIndices.length,
      percentage: (faceIndices.length / totalFaces) * 100,
    });

    processedGroups++;
    onProgress({
      stage: 'building',
      progress: (processedGroups / totalGroups) * 100,
      message: `Construindo mesh ${processedGroups}/${totalGroups}...`,
    });

    await yieldToUI();
  }

  return {
    meshes,
    colorStats: colorStats.sort((a, b) => b.count - a.count),
  };
}

export async function processMeshAsync(
  geometry: THREE.BufferGeometry,
  texture: THREE.Texture | null,
  subdivisionLevel: SubdivisionLevel,
  numColors: number,
  onProgress: (progress: ProcessingProgress) => void
): Promise<ProcessingResult> {
  const iterations = SUBDIVISION_ITERATIONS[subdivisionLevel];

  const sampler = new TextureSampler();
  const textureLoaded = await sampler.initialize(texture);
  
  if (!textureLoaded) {
    console.warn('[processMeshAsync] Texture not loaded - colors will use fallback');
  }

  const originalTriangles = getTriangleCount(geometry);

  // If the input mesh is already huge, simplify first (browser safety).
  let baseGeometry: THREE.BufferGeometry = geometry;
  if (originalTriangles > TRIANGLE_LIMITS.MAX) {
    onProgress({
      stage: 'simplifying',
      progress: 0,
      message: `Simplificando malha grande (${originalTriangles.toLocaleString()} → ${TRIANGLE_LIMITS.MAX.toLocaleString()} triângulos)...`,
    });

    const simplified = await simplifyGeometryAsync(geometry, TRIANGLE_LIMITS.MAX, 0.01);
    baseGeometry = simplified.geometry;

    onProgress({
      stage: 'simplifying',
      progress: 100,
      message: `Simplificação concluída (${simplified.triangles.toLocaleString()} triângulos)`,
    });

    await yieldToUI();
  }

  // Subdivide geometry (async)
  const subdividedGeometry = await subdivideGeometryAsync(baseGeometry, iterations, onProgress);

  const processedTriangles = getTriangleCount(subdividedGeometry);

  // Sample colors from all faces (async)
  const faceColors = await sampleFaceColorsAsync(subdividedGeometry, sampler, onProgress);

  // Quantize colors (sampled for speed)
  onProgress({
    stage: 'quantizing',
    progress: 25,
    message: 'Quantizando cores...',
  });
  await yieldToUI();

  const colorsForQuantization = (() => {
    if (faceColors.length <= MAX_QUANTIZATION_SAMPLES) return faceColors;

    const stride = Math.max(1, Math.floor(faceColors.length / MAX_QUANTIZATION_SAMPLES));
    const sampled: RGB[] = [];
    for (let i = 0; i < faceColors.length && sampled.length < MAX_QUANTIZATION_SAMPLES; i += stride) {
      sampled.push(faceColors[i]);
    }
    return sampled;
  })();

  const palette = medianCut(colorsForQuantization, numColors);

  // Assign each face to nearest palette color
  onProgress({
    stage: 'quantizing',
    progress: 70,
    message: 'Atribuindo cores às faces...',
  });
  await yieldToUI();

  const faceColorIndices: number[] = faceColors.map((c) => findNearestColor(c, palette));

  // Build meshes by color (async)
  const { meshes, colorStats } = await buildMeshesByColorAsync(
    subdividedGeometry,
    faceColorIndices,
    palette,
    processedTriangles,
    onProgress
  );

  subdividedGeometry.dispose();
  sampler.dispose();

  return {
    originalTriangles,
    processedTriangles,
    meshes,
    palette,
    colorStats,
  };
}

export function getSubdivisionTriangleCount(currentCount: number, level: SubdivisionLevel): number {
  const iterations = SUBDIVISION_ITERATIONS[level];
  return currentCount * Math.pow(4, iterations);
}

// Get recommended subdivision level based on triangle count
export function getRecommendedSubdivision(triangleCount: number): SubdivisionLevel {
  if (triangleCount * 64 > TRIANGLE_LIMITS.MAX) return 'none';
  if (triangleCount * 16 > TRIANGLE_LIMITS.MAX) return 'low';
  if (triangleCount * 4 > TRIANGLE_LIMITS.MAX) return 'medium';
  return 'high';
}

// Estimate processing time in seconds
export function estimateProcessingTime(triangleCount: number, level: SubdivisionLevel): number {
  const finalCount = getSubdivisionTriangleCount(triangleCount, level);
  // Rough estimate: ~50k triangles per second on average hardware
  return Math.max(1, Math.round(finalCount / 50000));
}

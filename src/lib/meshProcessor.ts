import * as THREE from 'three';
import { RGB, medianCut, findNearestColor } from './colorQuantization';
import { simplifyGeometryAsync, getTriangleCount } from './meshSimplifier';
import { MeshSource, extractColorsFromSources, combineSourcesToGeometry } from './colorExtractor';

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
  debugInfo?: {
    totalMeshes: number;
    totalMaterials: number;
    texturedMaterials: number;
    vertexColorMeshes: number;
    facesWithTexture: number;
    facesWithVertexColor: number;
    facesWithMaterialColor: number;
  };
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

        const v0 = new THREE.Vector3().fromBufferAttribute(positions, i0);
        const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
        const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);

        const m01 = v0.clone().add(v1).multiplyScalar(0.5);
        const m12 = v1.clone().add(v2).multiplyScalar(0.5);
        const m20 = v2.clone().add(v0).multiplyScalar(0.5);

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

// Subdivide colors array to match subdivided geometry
function subdivideColors(colors: RGB[], iterations: number): RGB[] {
  if (iterations === 0) return colors;

  let currentColors = colors;
  
  for (let iter = 0; iter < iterations; iter++) {
    const newColors: RGB[] = [];
    for (const color of currentColors) {
      // Each triangle becomes 4 triangles, all with the same color
      newColors.push(color, color, color, color);
    }
    currentColors = newColors;
  }

  return currentColors;
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

  let processedGroups = 0;
  const totalGroups = colorGroups.size;

  for (const [colorIndex, faceIndices] of colorGroups.entries()) {
    const newPositions: number[] = [];
    const newNormals: number[] = [];

    for (const faceIdx of faceIndices) {
      for (let v = 0; v < 3; v++) {
        const vertIdx = faceIdx * 3 + v;

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
  sources: MeshSource[],
  subdivisionLevel: SubdivisionLevel,
  numColors: number,
  onProgress: (progress: ProcessingProgress) => void
): Promise<ProcessingResult> {
  const iterations = SUBDIVISION_ITERATIONS[subdivisionLevel];

  // Step 1: Extract colors from all sources BEFORE combining
  onProgress({
    stage: 'sampling',
    progress: 0,
    message: 'Extraindo cores dos materiais...',
  });

  const { faceColors: originalFaceColors, debugInfo } = await extractColorsFromSources(
    sources,
    (progress, message) => onProgress({ stage: 'sampling', progress, message })
  );

  console.log('[processMeshAsync] Extracted colors from', originalFaceColors.length, 'faces');
  console.log('[processMeshAsync] Debug info:', debugInfo);

  // Step 2: Combine all sources into a single geometry
  const combinedGeometry = combineSourcesToGeometry(sources);
  const originalTriangles = getTriangleCount(combinedGeometry);

  // Step 3: Simplify if too large
  let baseGeometry = combinedGeometry;
  let baseFaceColors = originalFaceColors;

  if (originalTriangles > TRIANGLE_LIMITS.MAX) {
    onProgress({
      stage: 'simplifying',
      progress: 0,
      message: `Simplificando malha grande (${originalTriangles.toLocaleString()} → ${TRIANGLE_LIMITS.MAX.toLocaleString()} triângulos)...`,
    });

    const simplified = await simplifyGeometryAsync(combinedGeometry, TRIANGLE_LIMITS.MAX, 0.01);
    baseGeometry = simplified.geometry;

    // For simplification, we need to resample colors (simplified geometry has fewer faces)
    // For now, we'll just keep the colors aligned (this may need improvement)
    const simplifiedFaceCount = getTriangleCount(baseGeometry);
    if (simplifiedFaceCount < originalFaceColors.length) {
      const stride = Math.max(1, Math.floor(originalFaceColors.length / simplifiedFaceCount));
      baseFaceColors = [];
      for (let i = 0; i < originalFaceColors.length && baseFaceColors.length < simplifiedFaceCount; i += stride) {
        baseFaceColors.push(originalFaceColors[i]);
      }
    }

    onProgress({
      stage: 'simplifying',
      progress: 100,
      message: `Simplificação concluída (${simplified.triangles.toLocaleString()} triângulos)`,
    });

    await yieldToUI();
  }

  // Step 4: Subdivide geometry
  const subdividedGeometry = await subdivideGeometryAsync(baseGeometry, iterations, onProgress);
  const processedTriangles = getTriangleCount(subdividedGeometry);

  // Step 5: Subdivide colors to match
  const subdividedFaceColors = subdivideColors(baseFaceColors, iterations);

  console.log('[processMeshAsync] After subdivision:', processedTriangles, 'triangles,', subdividedFaceColors.length, 'colors');

  // Step 6: Quantize colors
  onProgress({
    stage: 'quantizing',
    progress: 25,
    message: 'Quantizando cores...',
  });
  await yieldToUI();

  const colorsForQuantization = (() => {
    if (subdividedFaceColors.length <= MAX_QUANTIZATION_SAMPLES) return subdividedFaceColors;

    const stride = Math.max(1, Math.floor(subdividedFaceColors.length / MAX_QUANTIZATION_SAMPLES));
    const sampled: RGB[] = [];
    for (let i = 0; i < subdividedFaceColors.length && sampled.length < MAX_QUANTIZATION_SAMPLES; i += stride) {
      sampled.push(subdividedFaceColors[i]);
    }
    return sampled;
  })();

  const palette = medianCut(colorsForQuantization, numColors);

  // Step 7: Assign each face to nearest palette color
  onProgress({
    stage: 'quantizing',
    progress: 70,
    message: 'Atribuindo cores às faces...',
  });
  await yieldToUI();

  const faceColorIndices: number[] = subdividedFaceColors.map((c) => findNearestColor(c, palette));

  // Step 8: Build meshes by color
  const { meshes, colorStats } = await buildMeshesByColorAsync(
    subdividedGeometry,
    faceColorIndices,
    palette,
    processedTriangles,
    onProgress
  );

  subdividedGeometry.dispose();
  if (baseGeometry !== combinedGeometry) {
    baseGeometry.dispose();
  }
  combinedGeometry.dispose();

  return {
    originalTriangles,
    processedTriangles,
    meshes,
    palette,
    colorStats,
    debugInfo,
  };
}

export function getSubdivisionTriangleCount(currentCount: number, level: SubdivisionLevel): number {
  const iterations = SUBDIVISION_ITERATIONS[level];
  return currentCount * Math.pow(4, iterations);
}

export function getRecommendedSubdivision(triangleCount: number): SubdivisionLevel {
  if (triangleCount * 64 > TRIANGLE_LIMITS.MAX) return 'none';
  if (triangleCount * 16 > TRIANGLE_LIMITS.MAX) return 'low';
  if (triangleCount * 4 > TRIANGLE_LIMITS.MAX) return 'medium';
  return 'high';
}

export function estimateProcessingTime(triangleCount: number, level: SubdivisionLevel): number {
  const finalCount = getSubdivisionTriangleCount(triangleCount, level);
  return Math.max(1, Math.round(finalCount / 50000));
}

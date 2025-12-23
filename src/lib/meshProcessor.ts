import * as THREE from 'three';
import { RGB, medianCut, findNearestColor } from './colorQuantization';

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

// Simple subdivision: split each triangle into 4
function subdivideGeometry(geometry: THREE.BufferGeometry, iterations: number): THREE.BufferGeometry {
  if (iterations === 0) return geometry.clone();

  let currentGeometry = geometry.clone();
  
  for (let iter = 0; iter < iterations; iter++) {
    const positions = currentGeometry.getAttribute('position');
    const uvs = currentGeometry.getAttribute('uv');
    const normals = currentGeometry.getAttribute('normal');
    
    if (!positions) break;

    const newPositions: number[] = [];
    const newUvs: number[] = [];
    const newNormals: number[] = [];

    const triCount = positions.count / 3;
    
    for (let i = 0; i < triCount; i++) {
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

    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
    newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
    
    currentGeometry.dispose();
    currentGeometry = newGeometry;
  }

  return currentGeometry;
}

// Sample texture color at UV coordinate
function sampleTexture(texture: THREE.Texture | null, u: number, v: number): RGB {
  if (!texture || !texture.image) {
    return { r: 200, g: 200, b: 200 };
  }

  const image = texture.image as HTMLImageElement | HTMLCanvasElement;
  
  // Create canvas to sample
  const canvas = document.createElement('canvas');
  canvas.width = image.width || 256;
  canvas.height = image.height || 256;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return { r: 200, g: 200, b: 200 };
  
  ctx.drawImage(image, 0, 0);
  
  // Wrap UV coordinates
  const x = Math.floor(((u % 1) + 1) % 1 * canvas.width);
  const y = Math.floor((1 - ((v % 1) + 1) % 1) * canvas.height);
  
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

// Get face center UV and sample color
function getFaceColor(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  texture: THREE.Texture | null
): RGB {
  const uvAttr = geometry.getAttribute('uv');
  
  if (!uvAttr) {
    return { r: 200, g: 200, b: 200 };
  }

  const i0 = faceIndex * 3;
  const i1 = faceIndex * 3 + 1;
  const i2 = faceIndex * 3 + 2;

  // Get center UV of face
  const u = (uvAttr.getX(i0) + uvAttr.getX(i1) + uvAttr.getX(i2)) / 3;
  const v = (uvAttr.getY(i0) + uvAttr.getY(i1) + uvAttr.getY(i2)) / 3;

  return sampleTexture(texture, u, v);
}

export function processMesh(
  geometry: THREE.BufferGeometry,
  texture: THREE.Texture | null,
  subdivisionLevel: SubdivisionLevel,
  numColors: number
): ProcessingResult {
  const iterations = SUBDIVISION_ITERATIONS[subdivisionLevel];
  const subdividedGeometry = subdivideGeometry(geometry, iterations);
  
  const positions = subdividedGeometry.getAttribute('position');
  const originalPositions = geometry.getAttribute('position');
  
  const originalTriangles = originalPositions ? originalPositions.count / 3 : 0;
  const processedTriangles = positions ? positions.count / 3 : 0;

  // Sample colors from all faces
  const faceColors: RGB[] = [];
  for (let i = 0; i < processedTriangles; i++) {
    faceColors.push(getFaceColor(subdividedGeometry, i, texture));
  }

  // Quantize colors
  const palette = medianCut(faceColors, numColors);
  
  // Assign each face to nearest palette color
  const faceColorIndices: number[] = faceColors.map(c => findNearestColor(c, palette));

  // Group faces by color
  const colorGroups: Map<number, number[]> = new Map();
  for (let i = 0; i < processedTriangles; i++) {
    const colorIdx = faceColorIndices[i];
    if (!colorGroups.has(colorIdx)) {
      colorGroups.set(colorIdx, []);
    }
    colorGroups.get(colorIdx)!.push(i);
  }

  // Create separate geometries for each color
  const meshes: ProcessedMesh[] = [];
  const colorStats: { color: RGB; count: number; percentage: number }[] = [];

  colorGroups.forEach((faceIndices, colorIndex) => {
    const newPositions: number[] = [];
    const newNormals: number[] = [];

    const posAttr = subdividedGeometry.getAttribute('position');
    const normAttr = subdividedGeometry.getAttribute('normal');

    for (const faceIdx of faceIndices) {
      for (let v = 0; v < 3; v++) {
        const idx = faceIdx * 3 + v;
        newPositions.push(
          posAttr.getX(idx),
          posAttr.getY(idx),
          posAttr.getZ(idx)
        );
        if (normAttr) {
          newNormals.push(
            normAttr.getX(idx),
            normAttr.getY(idx),
            normAttr.getZ(idx)
          );
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
      percentage: (faceIndices.length / processedTriangles) * 100,
    });
  });

  subdividedGeometry.dispose();

  return {
    originalTriangles,
    processedTriangles,
    meshes,
    palette,
    colorStats: colorStats.sort((a, b) => b.count - a.count),
  };
}

export function getSubdivisionTriangleCount(currentCount: number, level: SubdivisionLevel): number {
  const iterations = SUBDIVISION_ITERATIONS[level];
  return currentCount * Math.pow(4, iterations);
}

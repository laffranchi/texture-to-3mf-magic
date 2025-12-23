import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

export interface SimplifyResult {
  geometry: THREE.BufferGeometry;
  triangles: number;
  error: number;
}

export function getTriangleCount(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const index = geometry.getIndex();
  if (index) return index.count / 3;
  return pos.count / 3;
}

function getOrCreateIndexArray(geometry: THREE.BufferGeometry): Uint32Array {
  const indexAttr = geometry.getIndex();
  if (indexAttr?.array) {
    // ensure Uint32 as required by MeshoptSimplifier
    return Uint32Array.from(indexAttr.array as ArrayLike<number>);
  }

  const pos = geometry.getAttribute('position');
  if (!pos) return new Uint32Array();

  // Non-indexed triangle list: create a trivial sequential index buffer
  const indices = new Uint32Array(pos.count);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return indices;
}

export async function simplifyGeometryAsync(
  geometry: THREE.BufferGeometry,
  targetTriangles: number,
  targetError: number = 0.01
): Promise<SimplifyResult> {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('Geometria sem atributo de posição');
  }

  // meshoptimizer uses WASM; wait for it
  await MeshoptSimplifier.ready;

  const indices = getOrCreateIndexArray(geometry);
  const positions = posAttr.array as Float32Array;

  const originalTriangles = Math.floor(indices.length / 3);
  const clampedTargetTriangles = Math.max(1, Math.min(targetTriangles, originalTriangles));
  const targetIndexCount = Math.floor(clampedTargetTriangles * 3);

  const [simplifiedIndices, error] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3,
    targetIndexCount,
    targetError
  );

  const simplifiedGeometry = new THREE.BufferGeometry();
  simplifiedGeometry.setAttribute('position', posAttr);
  const normalAttr = geometry.getAttribute('normal');
  if (normalAttr) simplifiedGeometry.setAttribute('normal', normalAttr);
  const uvAttr = geometry.getAttribute('uv');
  if (uvAttr) simplifiedGeometry.setAttribute('uv', uvAttr);

  simplifiedGeometry.setIndex(new THREE.BufferAttribute(simplifiedIndices, 1));
  simplifiedGeometry.computeBoundingBox();

  return {
    geometry: simplifiedGeometry,
    triangles: simplifiedIndices.length / 3,
    error,
  };
}

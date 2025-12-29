import { useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadedModel {
  originalObject: THREE.Object3D;
  triangleCount: number;
  name: string;
  rawFile: File;
  debugInfo: {
    meshCount: number;
    materialCount: number;
    texturedMaterials: number;
    hasVertexColors: boolean;
  };
}

function countTriangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  if (index) return index.count / 3;
  return pos ? pos.count / 3 : 0;
}

export function useModelLoader() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);

  const loadGLB = useCallback(async (file: File): Promise<LoadedModel> => {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      const url = URL.createObjectURL(file);

      loader.load(
        url,
        (gltf) => {
          URL.revokeObjectURL(url);

          let totalTriangles = 0;
          let meshCount = 0;
          let materialCount = 0;
          let texturedMaterials = 0;
          let hasVertexColors = false;

          gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              meshCount++;
              const mesh = child as THREE.Mesh;
              const geometry = mesh.geometry;
              
              if (geometry.getAttribute('position')) {
                totalTriangles += countTriangles(geometry);
              }

              // Count materials
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              materialCount += materials.length;
              
              for (const mat of materials) {
                const stdMat = mat as THREE.MeshStandardMaterial;
                if (stdMat.map) texturedMaterials++;
              }
              
              if (geometry.getAttribute('color')) {
                hasVertexColors = true;
              }
            }
          });

          if (meshCount === 0) {
            reject(new Error('Nenhuma mesh encontrada no arquivo GLB'));
            return;
          }

          console.log(`[useModelLoader] Loaded GLB: ${meshCount} meshes, ${totalTriangles} triangles, ${materialCount} materials, ${texturedMaterials} textured`);

          resolve({
            originalObject: gltf.scene,
            triangleCount: totalTriangles,
            name: file.name.replace(/\.[^/.]+$/, ''),
            rawFile: file,
            debugInfo: {
              meshCount,
              materialCount,
              texturedMaterials,
              hasVertexColors,
            },
          });
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(url);
          reject(err);
        }
      );
    });
  }, []);

  const loadModel = useCallback(
    async (files: FileList | File[]) => {
      setLoading(true);
      setError(null);

      try {
        const fileArray = Array.from(files);
        const glbFile = fileArray.find((f) => f.name.toLowerCase().endsWith('.glb'));

        if (!glbFile) {
          throw new Error('Por favor, envie um arquivo GLB');
        }

        const loadedModel = await loadGLB(glbFile);
        setModel(loadedModel);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar modelo');
      } finally {
        setLoading(false);
      }
    },
    [loadGLB]
  );

  const clearModel = useCallback(() => {
    setModel(null);
    setError(null);
  }, []);

  return {
    model,
    loading,
    error,
    loadModel,
    clearModel,
  };
}

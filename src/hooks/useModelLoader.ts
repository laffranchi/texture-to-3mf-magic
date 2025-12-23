import { useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { MeshSource } from '@/lib/colorExtractor';

export interface LoadedModel {
  sources: MeshSource[];
  originalObject: THREE.Object3D;
  triangleCount: number;
  name: string;
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

// Extract all mesh sources from a scene
function extractMeshSources(scene: THREE.Object3D): MeshSource[] {
  const sources: MeshSource[] = [];

  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mesh = child as THREE.Mesh;
      const geometry = mesh.geometry;
      
      if (!geometry.getAttribute('position')) return;

      // Handle materials (can be single or array)
      let materials: THREE.Material[];
      if (Array.isArray(mesh.material)) {
        materials = mesh.material;
      } else {
        materials = [mesh.material];
      }

      // Get groups from geometry (for multi-material meshes)
      const rawGroups = geometry.groups;
      let groups: { start: number; count: number; materialIndex: number }[];
      if (!rawGroups || rawGroups.length === 0) {
        // Create a single group covering the entire geometry
        const posAttr = geometry.getAttribute('position');
        const indexAttr = geometry.getIndex();
        const count = indexAttr ? indexAttr.count : posAttr.count;
        groups = [{ start: 0, count, materialIndex: 0 }];
      } else {
        groups = rawGroups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex ?? 0 }));
      }

      // Update world matrix
      mesh.updateMatrixWorld(true);

      sources.push({
        geometry: geometry.clone(),
        materials: materials.map(m => m.clone()),
        groups: groups.map(g => ({ ...g })),
        matrixWorld: mesh.matrixWorld.clone(),
        name: mesh.name || `mesh_${sources.length}`,
      });
    }
  });

  return sources;
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

          const sources = extractMeshSources(gltf.scene);
          
          if (sources.length === 0) {
            reject(new Error('No mesh found in GLB file'));
            return;
          }

          // Calculate total triangles
          let totalTriangles = 0;
          let materialCount = 0;
          let texturedMaterials = 0;
          let hasVertexColors = false;

          for (const source of sources) {
            totalTriangles += countTriangles(source.geometry);
            materialCount += source.materials.length;
            
            for (const mat of source.materials) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              if (stdMat.map) texturedMaterials++;
            }
            
            if (source.geometry.getAttribute('color')) {
              hasVertexColors = true;
            }
          }

          console.log(`[useModelLoader] Loaded GLB: ${sources.length} meshes, ${totalTriangles} triangles, ${materialCount} materials, ${texturedMaterials} textured`);

          resolve({
            sources,
            originalObject: gltf.scene,
            triangleCount: totalTriangles,
            name: file.name.replace(/\.[^/.]+$/, ''),
            debugInfo: {
              meshCount: sources.length,
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

  const loadOBJ = useCallback(async (objFile: File, mtlFile?: File, textureFile?: File): Promise<LoadedModel> => {
    return new Promise(async (resolve, reject) => {
      const objLoader = new OBJLoader();
      const objUrl = URL.createObjectURL(objFile);

      let materials: MTLLoader.MaterialCreator | null = null;

      // Load MTL if provided
      if (mtlFile) {
        const mtlLoader = new MTLLoader();
        const mtlUrl = URL.createObjectURL(mtlFile);

        try {
          materials = await new Promise<MTLLoader.MaterialCreator>((res, rej) => {
            mtlLoader.load(mtlUrl, res, undefined, rej);
          });
          materials.preload();
          objLoader.setMaterials(materials);
        } catch (e) {
          console.warn('Failed to load MTL:', e);
        } finally {
          URL.revokeObjectURL(mtlUrl);
        }
      }

      objLoader.load(
        objUrl,
        async (obj) => {
          URL.revokeObjectURL(objUrl);

          // Load separate texture if provided
          if (textureFile) {
            const textureLoader = new THREE.TextureLoader();
            const textureUrl = URL.createObjectURL(textureFile);
            
            try {
              const texture = await new Promise<THREE.Texture>((res, rej) => {
                textureLoader.load(textureUrl, res, undefined, rej);
              });
              
              // Apply texture to all materials
              obj.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  const material = child.material as THREE.MeshStandardMaterial;
                  if (material) {
                    material.map = texture;
                    material.needsUpdate = true;
                  }
                }
              });
            } catch (e) {
              console.warn('Failed to load texture:', e);
            } finally {
              URL.revokeObjectURL(textureUrl);
            }
          }

          const sources = extractMeshSources(obj);

          if (sources.length === 0) {
            reject(new Error('No mesh found in OBJ file'));
            return;
          }

          // Calculate totals
          let totalTriangles = 0;
          let materialCount = 0;
          let texturedMaterials = 0;
          let hasVertexColors = false;

          for (const source of sources) {
            totalTriangles += countTriangles(source.geometry);
            materialCount += source.materials.length;
            
            for (const mat of source.materials) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              if (stdMat.map) texturedMaterials++;
            }
            
            if (source.geometry.getAttribute('color')) {
              hasVertexColors = true;
            }
          }

          console.log(`[useModelLoader] Loaded OBJ: ${sources.length} meshes, ${totalTriangles} triangles`);

          resolve({
            sources,
            originalObject: obj,
            triangleCount: totalTriangles,
            name: objFile.name.replace(/\.[^/.]+$/, ''),
            debugInfo: {
              meshCount: sources.length,
              materialCount,
              texturedMaterials,
              hasVertexColors,
            },
          });
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(objUrl);
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
        const glbFile = fileArray.find((f) => f.name.toLowerCase().endsWith('.glb') || f.name.toLowerCase().endsWith('.gltf'));
        const objFile = fileArray.find((f) => f.name.toLowerCase().endsWith('.obj'));
        const mtlFile = fileArray.find((f) => f.name.toLowerCase().endsWith('.mtl'));
        const textureFile = fileArray.find(
          (f) => f.name.toLowerCase().endsWith('.png') || f.name.toLowerCase().endsWith('.jpg') || f.name.toLowerCase().endsWith('.jpeg')
        );

        let loadedModel: LoadedModel;

        if (glbFile) {
          loadedModel = await loadGLB(glbFile);
        } else if (objFile) {
          loadedModel = await loadOBJ(objFile, mtlFile, textureFile);
        } else {
          throw new Error('Please upload a GLB/GLTF or OBJ file');
        }

        setModel(loadedModel);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load model');
      } finally {
        setLoading(false);
      }
    },
    [loadGLB, loadOBJ]
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

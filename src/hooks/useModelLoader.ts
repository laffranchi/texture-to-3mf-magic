import { useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture | null;
  originalObject: THREE.Object3D;
  triangleCount: number;
  name: string;
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
          
          let geometry: THREE.BufferGeometry | null = null;
          let texture: THREE.Texture | null = null;

          gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              if (!geometry) {
                geometry = child.geometry.clone();
                
                // Ensure geometry has non-indexed format for face processing
                if (geometry.index) {
                  geometry = geometry.toNonIndexed();
                }
              }
              
              const material = child.material as THREE.MeshStandardMaterial;
              if (material.map && !texture) {
                texture = material.map;
              }
            }
          });

          if (!geometry) {
            reject(new Error('No mesh found in GLB file'));
            return;
          }

          const triangleCount = geometry.getAttribute('position').count / 3;

          resolve({
            geometry,
            texture,
            originalObject: gltf.scene,
            triangleCount,
            name: file.name.replace(/\.[^/.]+$/, ''),
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
        (obj) => {
          URL.revokeObjectURL(objUrl);
          
          let geometry: THREE.BufferGeometry | null = null;
          let texture: THREE.Texture | null = null;

          obj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              if (!geometry) {
                geometry = child.geometry.clone();
                
                if (geometry.index) {
                  geometry = geometry.toNonIndexed();
                }
              }
              
              const material = child.material as THREE.MeshStandardMaterial;
              if (material?.map && !texture) {
                texture = material.map;
              }
            }
          });

          // Load separate texture if provided
          if (textureFile && !texture) {
            const textureLoader = new THREE.TextureLoader();
            const textureUrl = URL.createObjectURL(textureFile);
            texture = textureLoader.load(textureUrl, () => {
              URL.revokeObjectURL(textureUrl);
            });
          }

          if (!geometry) {
            reject(new Error('No mesh found in OBJ file'));
            return;
          }

          const triangleCount = geometry.getAttribute('position').count / 3;

          resolve({
            geometry,
            texture,
            originalObject: obj,
            triangleCount,
            name: objFile.name.replace(/\.[^/.]+$/, ''),
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

  const loadModel = useCallback(async (files: FileList | File[]) => {
    setLoading(true);
    setError(null);

    try {
      const fileArray = Array.from(files);
      const glbFile = fileArray.find(f => f.name.toLowerCase().endsWith('.glb') || f.name.toLowerCase().endsWith('.gltf'));
      const objFile = fileArray.find(f => f.name.toLowerCase().endsWith('.obj'));
      const mtlFile = fileArray.find(f => f.name.toLowerCase().endsWith('.mtl'));
      const textureFile = fileArray.find(f => 
        f.name.toLowerCase().endsWith('.png') || 
        f.name.toLowerCase().endsWith('.jpg') || 
        f.name.toLowerCase().endsWith('.jpeg')
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
  }, [loadGLB, loadOBJ]);

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

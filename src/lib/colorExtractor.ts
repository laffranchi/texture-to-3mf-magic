// Color extraction from 3D model materials, vertex colors, and textures
import * as THREE from 'three';
import { RGB } from './colorQuantization';

export interface MeshSource {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  groups: { start: number; count: number; materialIndex: number }[];
  matrixWorld: THREE.Matrix4;
  name: string;
}

export interface ColorExtractionResult {
  faceColors: RGB[];
  debugInfo: {
    totalMeshes: number;
    totalMaterials: number;
    texturedMaterials: number;
    vertexColorMeshes: number;
    facesWithTexture: number;
    facesWithVertexColor: number;
    facesWithMaterialColor: number;
  };
}

// Async helper to yield to UI
async function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Sample texture at UV coordinates
class TextureCache {
  private cache: Map<string, ImageData | null> = new Map();

  async getImageData(texture: THREE.Texture): Promise<ImageData | null> {
    const key = texture.uuid;
    
    if (this.cache.has(key)) {
      return this.cache.get(key) || null;
    }

    const imageData = await this.loadTextureData(texture);
    this.cache.set(key, imageData);
    return imageData;
  }

  private async loadTextureData(texture: THREE.Texture): Promise<ImageData | null> {
    if (!texture?.image) {
      console.warn('[TextureCache] No texture.image');
      return null;
    }

    const image = texture.image;
    let sourceWidth = 0;
    let sourceHeight = 0;
    let drawSource: CanvasImageSource | null = null;

    if (image instanceof HTMLImageElement) {
      if (!image.complete || image.naturalWidth === 0) {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Image failed to load'));
          if (image.complete && image.naturalWidth > 0) resolve();
        });
      }
      sourceWidth = image.naturalWidth || image.width;
      sourceHeight = image.naturalHeight || image.height;
      drawSource = image;
    } else if (image instanceof HTMLCanvasElement) {
      sourceWidth = image.width;
      sourceHeight = image.height;
      drawSource = image;
    } else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      sourceWidth = image.width;
      sourceHeight = image.height;
      drawSource = image;
    } else if (image.width && image.height) {
      sourceWidth = image.width;
      sourceHeight = image.height;
      drawSource = image as CanvasImageSource;
    }

    if (!drawSource || sourceWidth === 0 || sourceHeight === 0) {
      console.warn('[TextureCache] Invalid image source');
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    try {
      ctx.drawImage(drawSource, 0, 0, sourceWidth, sourceHeight);
      return ctx.getImageData(0, 0, sourceWidth, sourceHeight);
    } catch (e) {
      console.error('[TextureCache] Error drawing image:', e);
      return null;
    }
  }

  sampleTexture(imageData: ImageData, u: number, v: number, flipY: boolean = true): RGB {
    const wrappedU = ((u % 1) + 1) % 1;
    const wrappedV = ((v % 1) + 1) % 1;
    
    const x = Math.min(imageData.width - 1, Math.max(0, Math.floor(wrappedU * imageData.width)));
    const adjustedV = flipY ? (1 - wrappedV) : wrappedV;
    const y = Math.min(imageData.height - 1, Math.max(0, Math.floor(adjustedV * imageData.height)));

    const idx = (y * imageData.width + x) * 4;
    
    if (idx < 0 || idx + 2 >= imageData.data.length) {
      return { r: 255, g: 0, b: 255 }; // Magenta fallback
    }

    return {
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2],
    };
  }

  dispose() {
    this.cache.clear();
  }
}

// Convert THREE.Color to RGB
function threeColorToRGB(color: THREE.Color): RGB {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
  };
}

// Multiply two RGB colors (for texture * material.color)
function multiplyColors(a: RGB, b: RGB): RGB {
  return {
    r: Math.round((a.r / 255) * (b.r / 255) * 255),
    g: Math.round((a.g / 255) * (b.g / 255) * 255),
    b: Math.round((a.b / 255) * (b.b / 255) * 255),
  };
}

// Extract colors from all mesh sources
export async function extractColorsFromSources(
  sources: MeshSource[],
  onProgress?: (progress: number, message: string) => void
): Promise<ColorExtractionResult> {
  const textureCache = new TextureCache();
  const allFaceColors: RGB[] = [];
  
  const debugInfo = {
    totalMeshes: sources.length,
    totalMaterials: 0,
    texturedMaterials: 0,
    vertexColorMeshes: 0,
    facesWithTexture: 0,
    facesWithVertexColor: 0,
    facesWithMaterialColor: 0,
  };

  let processedFaces = 0;
  let totalFaces = 0;

  // Count total faces for progress
  for (const source of sources) {
    const posAttr = source.geometry.getAttribute('position');
    const indexAttr = source.geometry.getIndex();
    totalFaces += indexAttr ? indexAttr.count / 3 : posAttr ? posAttr.count / 3 : 0;
  }

  console.log(`[ColorExtractor] Processing ${sources.length} meshes, ${totalFaces} total faces`);

  for (const source of sources) {
    const { geometry, materials, groups } = source;
    
    const posAttr = geometry.getAttribute('position');
    const uvAttr = geometry.getAttribute('uv');
    const colorAttr = geometry.getAttribute('color');
    const indexAttr = geometry.getIndex();

    const meshFaceCount = indexAttr ? indexAttr.count / 3 : posAttr ? posAttr.count / 3 : 0;
    
    debugInfo.totalMaterials += materials.length;
    
    if (colorAttr) {
      debugInfo.vertexColorMeshes++;
    }

    // Check for textured materials
    for (const mat of materials) {
      const stdMat = mat as THREE.MeshStandardMaterial;
      if (stdMat.map) {
        debugInfo.texturedMaterials++;
      }
    }

    // Process each face
    for (let faceIdx = 0; faceIdx < meshFaceCount; faceIdx++) {
      const base = faceIdx * 3;
      const vi0 = indexAttr ? indexAttr.getX(base) : base;
      const vi1 = indexAttr ? indexAttr.getX(base + 1) : base + 1;
      const vi2 = indexAttr ? indexAttr.getX(base + 2) : base + 2;

      let faceColor: RGB | null = null;

      // Priority 1: Vertex colors (if available)
      if (colorAttr && colorAttr.count > 0) {
        const c0 = new THREE.Color(colorAttr.getX(vi0), colorAttr.getY(vi0), colorAttr.getZ(vi0));
        const c1 = new THREE.Color(colorAttr.getX(vi1), colorAttr.getY(vi1), colorAttr.getZ(vi1));
        const c2 = new THREE.Color(colorAttr.getX(vi2), colorAttr.getY(vi2), colorAttr.getZ(vi2));
        
        const avgColor = new THREE.Color(
          (c0.r + c1.r + c2.r) / 3,
          (c0.g + c1.g + c2.g) / 3,
          (c0.b + c1.b + c2.b) / 3
        );
        
        faceColor = threeColorToRGB(avgColor);
        debugInfo.facesWithVertexColor++;
      }

      // If no vertex colors, use material
      if (!faceColor) {
        // Find material for this face using groups
        let materialIndex = 0;
        if (groups.length > 0) {
          for (const group of groups) {
            if (base >= group.start && base < group.start + group.count) {
              materialIndex = group.materialIndex;
              break;
            }
          }
        }

        const material = materials[materialIndex] || materials[0];
        
        if (material) {
          const stdMat = material as THREE.MeshStandardMaterial;
          const baseColor = stdMat.color ? threeColorToRGB(stdMat.color) : { r: 200, g: 200, b: 200 };

          // Priority 2: Texture sampling
          if (stdMat.map && uvAttr && uvAttr.count > 0) {
            const imageData = await textureCache.getImageData(stdMat.map);
            
            if (imageData) {
              // Get center UV of face
              const u = (uvAttr.getX(vi0) + uvAttr.getX(vi1) + uvAttr.getX(vi2)) / 3;
              const v = (uvAttr.getY(vi0) + uvAttr.getY(vi1) + uvAttr.getY(vi2)) / 3;
              
              const textureColor = textureCache.sampleTexture(imageData, u, v, stdMat.map.flipY);
              
              // Multiply texture color by material color (baseColorFactor in glTF)
              faceColor = multiplyColors(textureColor, baseColor);
              debugInfo.facesWithTexture++;
            }
          }

          // Priority 3: Material color only
          if (!faceColor) {
            faceColor = baseColor;
            debugInfo.facesWithMaterialColor++;
          }
        }
      }

      // Fallback: gray
      if (!faceColor) {
        faceColor = { r: 180, g: 180, b: 180 };
        debugInfo.facesWithMaterialColor++;
      }

      allFaceColors.push(faceColor);
      processedFaces++;

      // Yield to UI and update progress
      if (processedFaces % 5000 === 0) {
        const progress = (processedFaces / totalFaces) * 100;
        onProgress?.(progress, `Extraindo cores... ${Math.round(progress)}%`);
        await yieldToUI();
      }
    }
  }

  textureCache.dispose();

  console.log('[ColorExtractor] Debug info:', debugInfo);

  return {
    faceColors: allFaceColors,
    debugInfo,
  };
}

/**
 * Re-extract colors for a geometry that has been simplified.
 * Uses UV coordinates to sample from the original texture.
 * This is critical for maintaining color accuracy after simplification.
 */
export async function extractColorsFromGeometry(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  onProgress?: (progress: number, message: string) => void
): Promise<RGB[]> {
  const textureCache = new TextureCache();
  const faceColors: RGB[] = [];
  
  const posAttr = geometry.getAttribute('position');
  const uvAttr = geometry.getAttribute('uv');
  const colorAttr = geometry.getAttribute('color');
  const indexAttr = geometry.getIndex();
  
  if (!posAttr) {
    console.warn('[extractColorsFromGeometry] No position attribute');
    return faceColors;
  }
  
  // Get the material (use first if array)
  const mat = Array.isArray(material) ? material[0] : material;
  const stdMat = mat as THREE.MeshStandardMaterial;
  const baseColor = stdMat?.color ? threeColorToRGB(stdMat.color) : { r: 200, g: 200, b: 200 };
  
  // Load texture if available
  let imageData: ImageData | null = null;
  if (stdMat?.map) {
    imageData = await textureCache.getImageData(stdMat.map);
  }
  
  const faceCount = indexAttr 
    ? indexAttr.count / 3 
    : posAttr.count / 3;
  
  console.log(`[extractColorsFromGeometry] Processing ${faceCount} faces, hasTexture: ${!!imageData}, hasVertexColors: ${!!colorAttr}`);
  
  for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
    const base = faceIdx * 3;
    
    // Get vertex indices
    const vi0 = indexAttr ? indexAttr.getX(base) : base;
    const vi1 = indexAttr ? indexAttr.getX(base + 1) : base + 1;
    const vi2 = indexAttr ? indexAttr.getX(base + 2) : base + 2;
    
    let faceColor: RGB | null = null;
    
    // Priority 1: Vertex colors
    if (colorAttr && colorAttr.count > vi2) {
      const c0 = new THREE.Color(colorAttr.getX(vi0), colorAttr.getY(vi0), colorAttr.getZ(vi0));
      const c1 = new THREE.Color(colorAttr.getX(vi1), colorAttr.getY(vi1), colorAttr.getZ(vi1));
      const c2 = new THREE.Color(colorAttr.getX(vi2), colorAttr.getY(vi2), colorAttr.getZ(vi2));
      
      const avgColor = new THREE.Color(
        (c0.r + c1.r + c2.r) / 3,
        (c0.g + c1.g + c2.g) / 3,
        (c0.b + c1.b + c2.b) / 3
      );
      
      faceColor = threeColorToRGB(avgColor);
    }
    
    // Priority 2: Texture sampling via UV
    if (!faceColor && imageData && uvAttr && uvAttr.count > vi2) {
      const u = (uvAttr.getX(vi0) + uvAttr.getX(vi1) + uvAttr.getX(vi2)) / 3;
      const v = (uvAttr.getY(vi0) + uvAttr.getY(vi1) + uvAttr.getY(vi2)) / 3;
      
      const textureColor = textureCache.sampleTexture(imageData, u, v, stdMat?.map?.flipY ?? true);
      faceColor = multiplyColors(textureColor, baseColor);
    }
    
    // Priority 3: Material base color
    if (!faceColor) {
      faceColor = baseColor;
    }
    
    faceColors.push(faceColor);
    
    // Yield to UI periodically
    if (faceIdx % 5000 === 0) {
      const progress = (faceIdx / faceCount) * 100;
      onProgress?.(progress, `Re-extraindo cores... ${Math.round(progress)}%`);
      await yieldToUI();
    }
  }
  
  textureCache.dispose();
  
  console.log(`[extractColorsFromGeometry] Extracted ${faceColors.length} colors`);
  
  return faceColors;
}

// Convert sources to a single combined INDEXED geometry for further processing
// This is critical for simplification: meshoptimizer requires indexed geometry with shared vertices
// Handles negative scale transforms by flipping winding order to avoid inverted faces
export function combineSourcesToGeometry(sources: MeshSource[]): THREE.BufferGeometry {
  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allUvs: number[] = [];
  const allIndices: number[] = [];
  
  let globalVertexOffset = 0;

  for (const source of sources) {
    const { geometry, matrixWorld } = source;
    
    const posAttr = geometry.getAttribute('position');
    const normAttr = geometry.getAttribute('normal');
    const uvAttr = geometry.getAttribute('uv');
    const indexAttr = geometry.getIndex();

    if (!posAttr) continue;

    // Detect negative scale (mirroring) - determinant < 0 means winding needs to be flipped
    const det = matrixWorld.determinant();
    const flipWinding = det < 0;

    const vertexCount = posAttr.count;
    
    // First: add all vertices from this mesh (transformed)
    for (let vi = 0; vi < vertexCount; vi++) {
      // Transform position by matrixWorld
      const pos = new THREE.Vector3(
        posAttr.getX(vi),
        posAttr.getY(vi),
        posAttr.getZ(vi)
      );
      pos.applyMatrix4(matrixWorld);
      allPositions.push(pos.x, pos.y, pos.z);

      // Transform normal (and flip if needed)
      if (normAttr && vi < normAttr.count) {
        const norm = new THREE.Vector3(
          normAttr.getX(vi),
          normAttr.getY(vi),
          normAttr.getZ(vi)
        );
        norm.transformDirection(matrixWorld);
        if (flipWinding) norm.negate();
        allNormals.push(norm.x, norm.y, norm.z);
      } else {
        allNormals.push(0, 1, 0);
      }

      // Copy UVs
      if (uvAttr && vi < uvAttr.count) {
        allUvs.push(uvAttr.getX(vi), uvAttr.getY(vi));
      } else {
        allUvs.push(0, 0);
      }
    }

    // Second: add indices, adjusted by globalVertexOffset
    if (indexAttr) {
      // Source has index buffer - copy indices with offset
      const faceCount = indexAttr.count / 3;
      for (let fi = 0; fi < faceCount; fi++) {
        const base = fi * 3;
        let i0 = indexAttr.getX(base) + globalVertexOffset;
        let i1 = indexAttr.getX(base + 1) + globalVertexOffset;
        let i2 = indexAttr.getX(base + 2) + globalVertexOffset;
        
        // Flip winding if needed
        if (flipWinding) {
          allIndices.push(i0, i2, i1);
        } else {
          allIndices.push(i0, i1, i2);
        }
      }
    } else {
      // Non-indexed geometry: create sequential indices
      const faceCount = vertexCount / 3;
      for (let fi = 0; fi < faceCount; fi++) {
        const base = fi * 3;
        let i0 = base + globalVertexOffset;
        let i1 = base + 1 + globalVertexOffset;
        let i2 = base + 2 + globalVertexOffset;
        
        // Flip winding if needed
        if (flipWinding) {
          allIndices.push(i0, i2, i1);
        } else {
          allIndices.push(i0, i1, i2);
        }
      }
    }
    
    globalVertexOffset += vertexCount;
  }

  const combinedGeometry = new THREE.BufferGeometry();
  combinedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  combinedGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
  combinedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(allUvs, 2));
  combinedGeometry.setIndex(allIndices);
  combinedGeometry.computeBoundingBox();

  console.log('[combineSourcesToGeometry] Created indexed geometry:', {
    vertices: allPositions.length / 3,
    indices: allIndices.length,
    triangles: allIndices.length / 3,
    hasIndex: true
  });

  return combinedGeometry;
}

/**
 * Get the first valid material from mesh sources (for re-extraction after simplification)
 */
export function getFirstMaterialFromSources(sources: MeshSource[]): THREE.Material | null {
  for (const source of sources) {
    if (source.materials && source.materials.length > 0) {
      return source.materials[0];
    }
  }
  return null;
}

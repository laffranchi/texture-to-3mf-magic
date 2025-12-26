import JSZip from 'jszip';
import * as THREE from 'three';
import { ExportData } from './meshProcessor';
import { rgbToHex, RGB } from './colorQuantization';

// Maximum recommended triangles for OrcaSlicer compatibility
export const MAX_TRIANGLES_WARNING = 500000;
export const MAX_TRIANGLES_LIMIT = 1000000;

/**
 * OrcaSlicer's CONST_FILAMENTS table for mmu_segmentation encoding.
 * Index 0 = no painting, Index 1+ = extruder number
 * Source: OrcaSlicer TriangleSelector.cpp
 */
const CONST_FILAMENTS = [
  "",    // 0: NONE (no painting)
  "4",   // 1: Extruder 1
  "8",   // 2: Extruder 2
  "0C",  // 3: Extruder 3
  "1C",  // 4: Extruder 4
  "2C",  // 5: Extruder 5
  "3C",  // 6: Extruder 6
  "4C",  // 7: Extruder 7
  "5C",  // 8: Extruder 8
  "6C",  // 9: Extruder 9
  "7C",  // 10: Extruder 10
  "8C",  // 11: Extruder 11
  "9C",  // 12: Extruder 12
  "AC",  // 13: Extruder 13
  "BC",  // 14: Extruder 14
  "CC",  // 15: Extruder 15
  "DC",  // 16: Extruder 16
];

/**
 * Encode color index (0-based) to OrcaSlicer mmu_segmentation format.
 * colorIndex 0 -> extruder 1 -> "4"
 * colorIndex 1 -> extruder 2 -> "8"
 * colorIndex 2 -> extruder 3 -> "0C"
 * etc.
 */
function encodeMMUSegmentation(colorIndex: number): string {
  const extruder = colorIndex + 1; // 0-based to 1-based
  if (extruder >= CONST_FILAMENTS.length) {
    // Fallback for more than 16 extruders
    const idx = extruder - 3;
    return `${idx.toString(16).toUpperCase()}C`;
  }
  return CONST_FILAMENTS[extruder];
}

/**
 * Export a solid mesh to 3MF format compatible with OrcaSlicer/Bambu Studio.
 * Uses slic3rpe:mmu_segmentation for multi-material painting.
 */
export async function export3MF(exportData: ExportData, filename: string = 'model'): Promise<Blob> {
  const { geometry, faceColorIndices, palette } = exportData;
  
  const zip = new JSZip();
  
  const triCount = faceColorIndices.length;

  console.log('[export3MF] Creating OrcaSlicer-compatible export');
  console.log('[export3MF] Colors:', palette.length, palette.map(c => rgbToHex(c)));
  console.log('[export3MF] Total triangles:', triCount);

  // Content Types
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="text/plain" />
</Types>`;

  zip.file('[Content_Types].xml', contentTypes);

  // Root relationships
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  zip.folder('_rels');
  zip.file('_rels/.rels', rootRels);

  // Build the 3D model with mmu_segmentation
  const modelContent = buildModelWithMMUSegmentation(geometry, faceColorIndices, palette, filename);
  zip.folder('3D');
  zip.file('3D/3dmodel.model', modelContent);

  // Metadata folder with configs
  zip.folder('Metadata');
  
  // Slic3r_PE.config - INI format with filament_colour
  const slicerConfig = buildSlicerPEConfig(palette);
  zip.file('Metadata/Slic3r_PE.config', slicerConfig);
  console.log('[export3MF] Slic3r_PE.config:', slicerConfig);
  
  // Slic3r_PE_model.config - XML format for model metadata
  const modelConfig = buildSlicerModelConfig(palette, triCount);
  zip.file('Metadata/Slic3r_PE_model.config', modelConfig);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return blob;
}

/**
 * Build 3dmodel.model with slic3rpe namespace and mmu_segmentation attributes.
 * This is the PrusaSlicer/OrcaSlicer format where geometry is directly in the main model file.
 */
function buildModelWithMMUSegmentation(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[],
  filename: string
): string {
  const positions = geometry.getAttribute('position');
  if (!positions) return '';

  const vertices: string[] = [];
  const triangles: string[] = [];

  // Vertex deduplication with consistent precision
  const vertexMap = new Map<string, number>();
  let vertexIndex = 0;

  const triCount = positions.count / 3;

  // Build basematerials for color definitions
  const baseMaterials = palette.map((color, idx) => {
    const hex = rgbToHex(color);
    return `      <slic3rpe:base name="Color${idx + 1}" displaycolor="${hex}" />`;
  }).join('\n');

  for (let i = 0; i < triCount; i++) {
    const indices: number[] = [];

    for (let v = 0; v < 3; v++) {
      const idx = i * 3 + v;
      const x = positions.getX(idx).toFixed(6);
      const y = positions.getY(idx).toFixed(6);
      const z = positions.getZ(idx).toFixed(6);

      const key = `${x},${y},${z}`;

      if (!vertexMap.has(key)) {
        vertexMap.set(key, vertexIndex);
        vertices.push(`        <vertex x="${x}" y="${y}" z="${z}" />`);
        vertexIndex++;
      }

      indices.push(vertexMap.get(key)!);
    }

    // Get color index for this triangle
    const colorIdx = faceColorIndices[i] ?? 0;
    const mmuSegmentation = encodeMMUSegmentation(colorIdx);
    
    // Add triangle with slic3rpe:mmu_segmentation
    triangles.push(
      `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" slic3rpe:mmu_segmentation="${mmuSegmentation}" />`
    );
  }

  console.log('[buildModelWithMMUSegmentation] Vertices:', vertexIndex, 'Triangles:', triCount);
  console.log('[buildModelWithMMUSegmentation] Sample segmentation values:', 
    faceColorIndices.slice(0, 5).map(idx => `color${idx} -> "${encodeMMUSegmentation(idx)}"`));

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
  <metadata name="slic3rpe:MmPaintingVersion">1</metadata>
  <metadata name="Title">${escapeXml(filename)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
    <slic3rpe:basematerials id="1">
${baseMaterials}
    </slic3rpe:basematerials>
    <object id="1" type="model">
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;
}

/**
 * Build Slic3r_PE.config in INI format (what OrcaSlicer actually reads for filament colors)
 */
function buildSlicerPEConfig(palette: RGB[]): string {
  // Build filament_colour as semicolon-separated hex values
  const filamentColours = palette.map(color => rgbToHex(color)).join(';');
  
  // Build filament_settings_id (all Generic PLA)
  const filamentSettings = palette.map(() => 'Generic PLA').join(';');
  
  return `; Generated by 3D Texture Converter
; OrcaSlicer/Bambu Studio/PrusaSlicer compatible format

filament_colour = ${filamentColours}
filament_settings_id = ${filamentSettings}
`;
}

/**
 * Build Slic3r_PE_model.config - XML format for model metadata with extruder assignments
 */
function buildSlicerModelConfig(palette: RGB[], triCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata type="object" key="name" value="MultiColorModel"/>
    <metadata type="object" key="extruder" value="1"/>
    <volume firstid="0" lastid="${triCount - 1}">
      <metadata type="volume" key="name" value="ColoredMesh"/>
      <metadata type="volume" key="volume_type" value="ModelPart"/>
      <metadata type="volume" key="extruder" value="1"/>
    </volume>
  </object>
</config>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

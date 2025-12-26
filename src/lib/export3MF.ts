import JSZip from 'jszip';
import * as THREE from 'three';
import { ExportData } from './meshProcessor';
import { rgbToHex, RGB } from './colorQuantization';

// Maximum recommended triangles for OrcaSlicer compatibility
export const MAX_TRIANGLES_WARNING = 500000;
export const MAX_TRIANGLES_LIMIT = 1000000;

interface ColorGroup {
  colorIndex: number;
  triangleIndices: number[];
  color: RGB;
}

/**
 * Encode color index to Bambu/OrcaSlicer paint_color format.
 * Based on reverse-engineering Bambu Studio 3MF files:
 * - Color 1: "4"
 * - Color 2: "8"
 * - Color 3: "C" (12 in hex = 0C)
 * - Color 4: "1C" (16 + 12 = 28 in decimal)
 * - Color 5: "2C"
 * - Color 6: "3C"
 * - Color 7: "4C"
 * - Color 8: "5C"
 * 
 * Pattern: extruder N (1-based) -> value is (N-1) * 4 + 4, displayed in hex
 * extruder 1 -> 4 (0x04)
 * extruder 2 -> 8 (0x08)
 * extruder 3 -> 12 (0x0C -> "C")
 * extruder 4 -> 16 (0x10 -> "1C" in Bambu format, which is actually 28 = 0x1C)
 * 
 * Actually looking at the data more carefully:
 * 4 = extruder 1, 8 = extruder 2, C (12) = extruder 3, 
 * 1C (28) = extruder 4, 2C (44) = extruder 5, etc.
 * 
 * Pattern: extruder N -> (N-1) * 4 + 4, for N=1,2 it's simple
 * For N >= 3, it follows: 4, 8, C (0x0C), 1C (0x1C), 2C (0x2C), etc.
 * The "C" suffix appears from extruder 3 onwards.
 */
function encodePaintColor(colorIndex: number): string {
  // colorIndex is 0-based, convert to 1-based extruder
  const extruder = colorIndex + 1;
  
  if (extruder === 1) return '4';
  if (extruder === 2) return '8';
  
  // For extruder 3+, use the XC pattern where X = extruder - 3
  // extruder 3 -> "C" (0C without leading zero)
  // extruder 4 -> "1C"
  // extruder 5 -> "2C"
  // etc.
  const prefix = extruder - 3;
  if (prefix === 0) return 'C';
  return `${prefix.toString(16).toUpperCase()}C`;
}

/**
 * Export a solid mesh to 3MF format compatible with OrcaSlicer/Bambu Studio.
 * Uses the paint_color attribute per triangle for multi-material support.
 * 
 * File structure:
 * - 3D/Objects/object_1.model (with paint_color on triangles)
 * - Metadata/Slic3r_PE_model.config
 */
export async function export3MF(exportData: ExportData, filename: string = 'model'): Promise<Blob> {
  const { geometry, faceColorIndices, palette } = exportData;
  
  const zip = new JSZip();

  // Group triangles by color for logging
  const colorGroups = groupTrianglesByColor(faceColorIndices, palette);
  
  console.log('[export3MF] Creating OrcaSlicer-compatible export with paint_color');
  console.log('[export3MF] Colors:', palette.length);
  console.log('[export3MF] Total triangles:', faceColorIndices.length);
  console.log('[export3MF] Color groups:', colorGroups.map(g => ({
    color: rgbToHex(g.color),
    triangles: g.triangleIndices.length,
    extruder: g.colorIndex + 1,
    paintColor: encodePaintColor(g.colorIndex)
  })));

  // Content Types
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

  zip.file('[Content_Types].xml', contentTypes);

  // Root relationships
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  zip.folder('_rels');
  zip.file('_rels/.rels', rootRels);

  // Build the main 3D model file (references the object)
  const mainModel = buildMainModel(filename);
  zip.folder('3D');
  zip.file('3D/3dmodel.model', mainModel);
  
  // 3D model relationships
  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/Objects/object_1.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
  
  zip.folder('3D/_rels');
  zip.file('3D/_rels/3dmodel.model.rels', modelRels);

  // Build the object model with paint_color attributes
  const objectModel = buildObjectModelWithPaintColor(geometry, faceColorIndices, palette);
  zip.folder('3D/Objects');
  zip.file('3D/Objects/object_1.model', objectModel);

  console.log('[export3MF] object_1.model bytes:', objectModel.length);

  // Add Slic3r_PE_model.config for OrcaSlicer
  const modelConfig = buildSlicerConfig(palette);
  zip.folder('Metadata');
  zip.file('Metadata/Slic3r_PE_model.config', modelConfig);
  
  console.log('[export3MF] Slic3r_PE_model.config bytes:', modelConfig.length);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return blob;
}

/**
 * Group triangles by their color index
 */
function groupTrianglesByColor(faceColorIndices: number[], palette: RGB[]): ColorGroup[] {
  const groups = new Map<number, number[]>();
  
  for (let i = 0; i < faceColorIndices.length; i++) {
    const colorIdx = faceColorIndices[i];
    if (!groups.has(colorIdx)) {
      groups.set(colorIdx, []);
    }
    groups.get(colorIdx)!.push(i);
  }
  
  // Convert to array and sort by color index for consistent ordering
  const result: ColorGroup[] = [];
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  
  for (const colorIdx of sortedKeys) {
    result.push({
      colorIndex: colorIdx,
      triangleIndices: groups.get(colorIdx)!,
      color: palette[colorIdx] || { r: 128, g: 128, b: 128 }
    });
  }
  
  return result;
}

/**
 * Build main 3dmodel.model that references the object file
 */
function buildMainModel(filename: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Title">${escapeXml(filename)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
    <object id="1" type="model" p:path="/3D/Objects/object_1.model">
      <components>
        <component objectid="1" p:path="/3D/Objects/object_1.model" />
      </components>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;
}

/**
 * Build object model with paint_color attribute on each triangle.
 * This is the Bambu/OrcaSlicer format for multi-material painting.
 */
function buildObjectModelWithPaintColor(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[]
): string {
  const positions = geometry.getAttribute('position');
  if (!positions) return '';

  const vertices: string[] = [];
  const triangles: string[] = [];

  // Vertex deduplication map - use less aggressive rounding
  const vertexMap = new Map<string, number>();
  let vertexIndex = 0;

  const triCount = positions.count / 3;

  for (let i = 0; i < triCount; i++) {
    const indices: number[] = [];

    for (let v = 0; v < 3; v++) {
      const idx = i * 3 + v;
      // Use 4 decimal places for less aggressive deduplication
      const x = positions.getX(idx).toFixed(4);
      const y = positions.getY(idx).toFixed(4);
      const z = positions.getZ(idx).toFixed(4);

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
    const paintColor = encodePaintColor(colorIdx);
    
    // Add triangle with paint_color attribute
    triangles.push(
      `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" paint_color="${paintColor}" />`
    );
  }

  console.log('[buildObjectModelWithPaintColor] Vertices:', vertexIndex, 'Triangles:', triCount);
  console.log('[buildObjectModelWithPaintColor] Sample paint_colors:', 
    faceColorIndices.slice(0, 5).map(idx => encodePaintColor(idx)));

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
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
 * Build Slic3r_PE_model.config for OrcaSlicer/PrusaSlicer compatibility.
 * Lists the extruders/colors that are used.
 */
function buildSlicerConfig(palette: RGB[]): string {
  // Create filament entries for each color
  const filaments = palette.map((color, idx) => {
    const hex = rgbToHex(color);
    return `    <filament id="${idx + 1}" color="${hex}" name="Color${idx + 1}" />`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata type="object" key="name" value="MultiColorModel"/>
    <metadata type="object" key="extruder" value="1"/>
    <volume firstid="0" lastid="0">
      <metadata type="volume" key="name" value="ColoredModel"/>
      <metadata type="volume" key="volume_type" value="ModelPart"/>
      <metadata type="volume" key="extruder" value="1"/>
    </volume>
  </object>
  <filaments>
${filaments}
  </filaments>
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

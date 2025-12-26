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
 * Pattern: extruder N (1-based)
 * extruder 1 -> "4"
 * extruder 2 -> "8"
 * extruder 3 -> "C"
 * extruder 4 -> "1C"
 * extruder 5 -> "2C"
 * etc.
 */
function encodePaintColor(colorIndex: number): string {
  const extruder = colorIndex + 1;
  
  if (extruder === 1) return '4';
  if (extruder === 2) return '8';
  
  const prefix = extruder - 3;
  if (prefix === 0) return 'C';
  return `${prefix.toString(16).toUpperCase()}C`;
}

/**
 * Export a solid mesh to 3MF format compatible with OrcaSlicer/Bambu Studio.
 * Uses paint_color + basematerials + INI configs for full compatibility.
 */
export async function export3MF(exportData: ExportData, filename: string = 'model'): Promise<Blob> {
  const { geometry, faceColorIndices, palette } = exportData;
  
  const zip = new JSZip();

  const colorGroups = groupTrianglesByColor(faceColorIndices, palette);
  
  console.log('[export3MF] Creating OrcaSlicer-compatible export');
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

  // Build the main 3D model with basematerials
  const mainModel = buildMainModelWithMaterials(filename, palette);
  zip.folder('3D');
  zip.file('3D/3dmodel.model', mainModel);
  
  // 3D model relationships
  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/Objects/object_1.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
  
  zip.folder('3D/_rels');
  zip.file('3D/_rels/3dmodel.model.rels', modelRels);

  // Build the object model with paint_color AND pid/p1 attributes
  const objectModel = buildObjectModelWithPaintColor(geometry, faceColorIndices, palette);
  zip.folder('3D/Objects');
  zip.file('3D/Objects/object_1.model', objectModel);

  console.log('[export3MF] object_1.model bytes:', objectModel.length);

  // Metadata folder with configs
  zip.folder('Metadata');
  
  // Slic3r_PE.config - INI format with filament_colour
  const slicerConfig = buildSlicerPEConfig(palette);
  zip.file('Metadata/Slic3r_PE.config', slicerConfig);
  console.log('[export3MF] Slic3r_PE.config:', slicerConfig);
  
  // Slic3r_PE_model.config - XML format for model metadata
  const modelConfig = buildSlicerModelConfig(palette);
  zip.file('Metadata/Slic3r_PE_model.config', modelConfig);

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
 * Build main 3dmodel.model with basematerials for color definitions
 */
function buildMainModelWithMaterials(filename: string, palette: RGB[]): string {
  // Build basematerials entries
  const baseMaterials = palette.map((color, idx) => {
    const hex = rgbToHex(color);
    return `      <m:base name="Color${idx + 1}" displaycolor="${hex}" />`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Title">${escapeXml(filename)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
    <m:basematerials id="1">
${baseMaterials}
    </m:basematerials>
    <object id="2" type="model" p:path="/3D/Objects/object_1.model">
      <components>
        <component objectid="1" p:path="/3D/Objects/object_1.model" />
      </components>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`;
}

/**
 * Build object model with paint_color AND pid/p1 for dual compatibility.
 * - paint_color: OrcaSlicer/Bambu specific
 * - pid/p1: Standard 3MF material reference
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

  // Vertex deduplication
  const vertexMap = new Map<string, number>();
  let vertexIndex = 0;

  const triCount = positions.count / 3;

  // Build basematerials for this object too
  const baseMaterials = palette.map((color, idx) => {
    const hex = rgbToHex(color);
    return `      <m:base name="Color${idx + 1}" displaycolor="${hex}" />`;
  }).join('\n');

  for (let i = 0; i < triCount; i++) {
    const indices: number[] = [];

    for (let v = 0; v < 3; v++) {
      const idx = i * 3 + v;
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
    
    // Add triangle with BOTH paint_color AND pid/p1 for compatibility
    // pid="1" references basematerials id="1", p1 is the color index (0-based)
    triangles.push(
      `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" pid="1" p1="${colorIdx}" paint_color="${paintColor}" />`
    );
  }

  console.log('[buildObjectModelWithPaintColor] Vertices:', vertexIndex, 'Triangles:', triCount);

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
    <m:basematerials id="1">
${baseMaterials}
    </m:basematerials>
    <object id="1" type="model" pid="1" pindex="0">
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
 * Build Slic3r_PE.config in INI format (what OrcaSlicer actually reads)
 */
function buildSlicerPEConfig(palette: RGB[]): string {
  // Build filament_colour as semicolon-separated hex values
  const filamentColours = palette.map(color => rgbToHex(color)).join(';');
  
  // Build filament_settings_id (all Generic PLA)
  const filamentSettings = palette.map(() => 'Generic PLA').join(';');
  
  return `; Generated by 3D Texture Converter
; OrcaSlicer/Bambu Studio compatible format

[filament]
filament_colour = ${filamentColours}
filament_settings_id = ${filamentSettings}
`;
}

/**
 * Build Slic3r_PE_model.config - XML format for model metadata
 */
function buildSlicerModelConfig(palette: RGB[]): string {
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

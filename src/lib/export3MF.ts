import JSZip from 'jszip';
import * as THREE from 'three';
import { ExportData } from './meshProcessor';
import { rgbToHex, RGB } from './colorQuantization';
import { ExportMode } from './exportModes';

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
 */
function encodeMMUSegmentation(colorIndex: number): string {
  const extruder = colorIndex + 1;
  if (extruder >= CONST_FILAMENTS.length) {
    const idx = extruder - 3;
    return `${idx.toString(16).toUpperCase()}C`;
  }
  return CONST_FILAMENTS[extruder];
}

export interface ExportReport {
  mode: ExportMode;
  totalTriangles: number;
  totalVertices: number;
  palette: string[];
  colorDistribution: { color: string; count: number; percentage: number }[];
  sampleAttributes: { triangle: number; colorIndex: number; attribute: string }[];
  files: string[];
}

/**
 * Export to 3MF with configurable mode and diagnostic report.
 */
export async function export3MF(
  exportData: ExportData,
  filename: string = 'model',
  mode: ExportMode = 'mmu_segmentation'
): Promise<{ blob: Blob; report: ExportReport }> {
  const { geometry, faceColorIndices, palette } = exportData;
  
  const zip = new JSZip();
  const triCount = faceColorIndices.length;
  const positions = geometry.getAttribute('position');
  const vertexCount = positions ? positions.count : 0;

  // Build color distribution for report
  const colorCounts = new Map<number, number>();
  for (const idx of faceColorIndices) {
    colorCounts.set(idx, (colorCounts.get(idx) || 0) + 1);
  }
  
  const colorDistribution = Array.from(colorCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([colorIdx, count]) => ({
      color: rgbToHex(palette[colorIdx]),
      count,
      percentage: (count / triCount) * 100,
    }));

  // Sample attributes for report
  const sampleIndices = [0, 1, 2, 3, 4, Math.floor(triCount / 2), triCount - 1].filter(i => i < triCount);
  const sampleAttributes = sampleIndices.map(i => ({
    triangle: i,
    colorIndex: faceColorIndices[i],
    attribute: mode === 'mmu_segmentation' 
      ? encodeMMUSegmentation(faceColorIndices[i])
      : mode === 'paint_color'
        ? String(faceColorIndices[i] + 1)
        : `volume_${faceColorIndices[i]}`,
  }));

  console.log(`[export3MF] Mode: ${mode}`);
  console.log('[export3MF] Colors:', palette.length, palette.map(c => rgbToHex(c)));
  console.log('[export3MF] Total triangles:', triCount);
  console.log('[export3MF] Color distribution:', colorDistribution);

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
  zip.folder('3D');
  zip.folder('Metadata');

  const files: string[] = ['[Content_Types].xml', '_rels/.rels'];

  // Build model content based on mode
  let modelContent: string;
  
  switch (mode) {
    case 'paint_color':
      modelContent = buildModelWithPaintColor(geometry, faceColorIndices, palette, filename);
      break;
    case 'multi_volume':
      modelContent = buildModelWithMultiVolume(geometry, faceColorIndices, palette, filename);
      break;
    case 'mmu_segmentation':
    default:
      modelContent = buildModelWithMMUSegmentation(geometry, faceColorIndices, palette, filename);
      break;
  }

  zip.file('3D/3dmodel.model', modelContent);
  files.push('3D/3dmodel.model');

  // Slic3r_PE.config - INI format with filament_colour
  const slicerConfig = buildSlicerPEConfig(palette);
  zip.file('Metadata/Slic3r_PE.config', slicerConfig);
  files.push('Metadata/Slic3r_PE.config');

  // Slic3r_PE_model.config - XML format for model metadata
  const modelConfig = mode === 'multi_volume' 
    ? buildMultiVolumeModelConfig(palette)
    : buildSlicerModelConfig(palette, triCount);
  zip.file('Metadata/Slic3r_PE_model.config', modelConfig);
  files.push('Metadata/Slic3r_PE_model.config');

  // Add diagnostic report file
  const report: ExportReport = {
    mode,
    totalTriangles: triCount,
    totalVertices: vertexCount,
    palette: palette.map(c => rgbToHex(c)),
    colorDistribution,
    sampleAttributes,
    files,
  };

  const reportText = buildDiagnosticReport(report);
  zip.file('Metadata/3DTextureConverter_report.txt', reportText);
  files.push('Metadata/3DTextureConverter_report.txt');

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return { blob, report };
}

/**
 * Build diagnostic report text
 */
function buildDiagnosticReport(report: ExportReport): string {
  const lines = [
    '=== 3D Texture Converter - Export Report ===',
    `Date: ${new Date().toISOString()}`,
    `Export Mode: ${report.mode}`,
    '',
    '--- Geometry ---',
    `Total Triangles: ${report.totalTriangles.toLocaleString()}`,
    `Total Vertices: ${report.totalVertices.toLocaleString()}`,
    '',
    '--- Palette ---',
    ...report.palette.map((c, i) => `  Color ${i + 1}: ${c} (Extruder ${i + 1})`),
    '',
    '--- Color Distribution ---',
    ...report.colorDistribution.map(d => 
      `  ${d.color}: ${d.count.toLocaleString()} triangles (${d.percentage.toFixed(2)}%)`
    ),
    '',
    '--- Sample Attributes ---',
    ...report.sampleAttributes.map(s => 
      `  Triangle ${s.triangle}: colorIndex=${s.colorIndex} -> "${s.attribute}"`
    ),
    '',
    '--- Files ---',
    ...report.files.map(f => `  ${f}`),
    '',
    '=== End Report ===',
  ];
  return lines.join('\n');
}

/**
 * Mode 1: MMU Segmentation (PrusaSlicer/OrcaSlicer format)
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
  const vertexMap = new Map<string, number>();
  let vertexIndex = 0;
  const triCount = positions.count / 3;

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

    const colorIdx = faceColorIndices[i] ?? 0;
    const mmuSegmentation = encodeMMUSegmentation(colorIdx);
    
    triangles.push(
      `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" slic3rpe:mmu_segmentation="${mmuSegmentation}" />`
    );
  }

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
 * Mode 2: Paint Color (Bambu Studio format)
 * Uses standard 3MF basematerials with pid/p1 attributes
 */
function buildModelWithPaintColor(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[],
  filename: string
): string {
  const positions = geometry.getAttribute('position');
  if (!positions) return '';

  const vertices: string[] = [];
  const triangles: string[] = [];
  const vertexMap = new Map<string, number>();
  let vertexIndex = 0;
  const triCount = positions.count / 3;

  // Standard 3MF basematerials (m: namespace)
  const baseMaterials = palette.map((color, idx) => {
    const hex = rgbToHex(color);
    return `      <base name="Color${idx + 1}" displaycolor="${hex}" />`;
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

    const colorIdx = faceColorIndices[i] ?? 0;
    
    // Use pid (points to basematerials id) and p1 (material index)
    // Also add paint_color for Bambu Studio compatibility
    triangles.push(
      `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" pid="1" p1="${colorIdx}" paint_color="${colorIdx + 1}" />`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">${escapeXml(filename)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
    <basematerials id="1">
${baseMaterials}
    </basematerials>
    <object id="2" type="model">
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
    <item objectid="2" />
  </build>
</model>`;
}

/**
 * Mode 3: Multi-Volume (Universal format)
 * Creates separate objects for each color - most compatible
 */
function buildModelWithMultiVolume(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[],
  filename: string
): string {
  const positions = geometry.getAttribute('position');
  if (!positions) return '';

  const triCount = positions.count / 3;

  // Group triangles by color
  const trianglesByColor: Map<number, { positions: number[][] }> = new Map();
  
  for (let i = 0; i < triCount; i++) {
    const colorIdx = faceColorIndices[i] ?? 0;
    
    if (!trianglesByColor.has(colorIdx)) {
      trianglesByColor.set(colorIdx, { positions: [] });
    }
    
    const tri: number[][] = [];
    for (let v = 0; v < 3; v++) {
      const idx = i * 3 + v;
      tri.push([
        positions.getX(idx),
        positions.getY(idx),
        positions.getZ(idx),
      ]);
    }
    trianglesByColor.get(colorIdx)!.positions.push(...tri);
  }

  // Build objects for each color
  const objects: string[] = [];
  const buildItems: string[] = [];
  let objectId = 1;

  for (const [colorIdx, data] of trianglesByColor.entries()) {
    const color = palette[colorIdx];
    const hex = rgbToHex(color);
    
    // Deduplicate vertices for this color group
    const vertices: string[] = [];
    const triangles: string[] = [];
    const vertexMap = new Map<string, number>();
    let vertexIndex = 0;

    for (let i = 0; i < data.positions.length; i += 3) {
      const indices: number[] = [];
      
      for (let v = 0; v < 3; v++) {
        const pos = data.positions[i + v];
        const x = pos[0].toFixed(6);
        const y = pos[1].toFixed(6);
        const z = pos[2].toFixed(6);
        const key = `${x},${y},${z}`;

        if (!vertexMap.has(key)) {
          vertexMap.set(key, vertexIndex);
          vertices.push(`          <vertex x="${x}" y="${y}" z="${z}" />`);
          vertexIndex++;
        }
        indices.push(vertexMap.get(key)!);
      }

      triangles.push(`          <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" />`);
    }

    objects.push(`    <object id="${objectId}" name="Color${colorIdx + 1}_${hex.replace('#', '')}" type="model">
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>`);

    buildItems.push(`    <item objectid="${objectId}" />`);
    objectId++;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${escapeXml(filename)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
${objects.join('\n')}
  </resources>
  <build>
${buildItems.join('\n')}
  </build>
</model>`;
}

function buildSlicerPEConfig(palette: RGB[]): string {
  const filamentColours = palette.map(color => rgbToHex(color)).join(';');
  const filamentSettings = palette.map(() => 'Generic PLA').join(';');
  
  return `; Generated by 3D Texture Converter
; OrcaSlicer/Bambu Studio/PrusaSlicer compatible format

filament_colour = ${filamentColours}
filament_settings_id = ${filamentSettings}
`;
}

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

function buildMultiVolumeModelConfig(palette: RGB[]): string {
  const objectConfigs = palette.map((_, idx) => `  <object id="${idx + 1}">
    <metadata type="object" key="name" value="Color${idx + 1}"/>
    <metadata type="object" key="extruder" value="${idx + 1}"/>
  </object>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objectConfigs}
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

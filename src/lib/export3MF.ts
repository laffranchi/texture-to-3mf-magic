import JSZip from 'jszip';
import * as THREE from 'three';
import { ExportData } from './meshProcessor';
import { rgbToHex, RGB } from './colorQuantization';
import { ExportMode } from './exportModes';

// Maximum recommended triangles for OrcaSlicer compatibility
export const MAX_TRIANGLES_WARNING = 500000;
export const MAX_TRIANGLES_LIMIT = 1000000;

/**
 * Encode color index (0-based) to OrcaSlicer paint_color format.
 * Formula: (colorIndex + 1) * 4, converted to uppercase hexadecimal.
 */
function encodePaintColor(colorIndex: number): string {
  const value = (colorIndex + 1) * 4;
  return value.toString(16).toUpperCase();
}

export interface ExportReport {
  mode: ExportMode;
  totalTriangles: number;
  totalVertices: number;
  palette: string[];
  colorDistribution: { color: string; count: number; percentage: number }[];
  sampleAttributes: { triangle: number; colorIndex: number; attribute: string }[];
  files: { path: string; size: number }[];
  validation: ValidationResult;
  fileStructure: string;
  pathVerification: {
    relsTarget: string;
    wrapperPath: string;
    objectFileExists: boolean;
  };
  sampleTriangles: string[];
  wrapperXmlPreview: string;
  objectXmlPreview: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate the 3MF structure before generating the final blob.
 * Ensures all paths and references are correct.
 */
async function validate3MFStructure(
  zip: JSZip,
  baseName: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const objectPath = `3D/Objects/${baseName}.model`;
  const relsPath = '3D/_rels/3dmodel.model.rels';
  const wrapperPath = '3D/3dmodel.model';

  // Check 1: Object model exists
  if (!zip.file(objectPath)) {
    errors.push(`ERRO: ${objectPath} não existe no ZIP`);
  }

  // Check 2: .rels exists
  if (!zip.file(relsPath)) {
    errors.push(`ERRO: ${relsPath} não existe no ZIP`);
  }

  // Check 3: Wrapper exists
  if (!zip.file(wrapperPath)) {
    errors.push(`ERRO: ${wrapperPath} não existe no ZIP`);
  }

  // Check 4: .rels Target matches object path
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    const relsContent = await relsFile.async('string');
    if (!relsContent.includes(`/3D/Objects/${baseName}.model`)) {
      errors.push(`ERRO: .rels Target não aponta para /3D/Objects/${baseName}.model`);
    }
  }

  // Check 5: Wrapper p:path matches object path
  const wrapperFile = zip.file(wrapperPath);
  if (wrapperFile) {
    const wrapperContent = await wrapperFile.async('string');
    if (!wrapperContent.includes(`p:path="/3D/Objects/${baseName}.model"`)) {
      errors.push(`ERRO: Wrapper p:path não aponta para /3D/Objects/${baseName}.model`);
    }
  }

  // Check 6: Object model contains paint_color
  const objectFile = zip.file(objectPath);
  if (objectFile) {
    const objectContent = await objectFile.async('string');
    const paintColorMatches = objectContent.match(/paint_color="/g);
    const paintColorCount = paintColorMatches ? paintColorMatches.length : 0;
    if (paintColorCount === 0) {
      errors.push(`ERRO: ${objectPath} não contém nenhum paint_color`);
    } else {
      console.log(`[validate3MF] Found ${paintColorCount} triangles with paint_color`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Export to 3MF with OrcaSlicer-compatible structure.
 * Uses wrapper pattern: 3D/3dmodel.model references 3D/Objects/{name}.model
 */
export async function export3MF(
  exportData: ExportData,
  filename: string = 'model',
  mode: ExportMode = 'mmu_segmentation'
): Promise<{ blob: Blob; report: ExportReport }> {
  const { geometry, faceColorIndices, palette } = exportData;

  // Extract base name without extension
  const baseName = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'model';

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

  console.log(`[export3MF] Mode: ${mode}, BaseName: ${baseName}`);
  console.log('[export3MF] Colors:', palette.length, palette.map(c => rgbToHex(c)));
  console.log('[export3MF] Total triangles:', triCount);

  // ===== FILE STRUCTURE (OrcaSlicer Compatible) =====

  // 1. [Content_Types].xml
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="text/plain"/>
  <Default Extension="png" ContentType="image/png"/>
</Types>`;
  zip.file('[Content_Types].xml', contentTypes);

  // 2. _rels/.rels (root relationships)
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  zip.folder('_rels');
  zip.file('_rels/.rels', rootRels);

  // 3. Create folder structure
  zip.folder('3D');
  zip.folder('3D/_rels');
  zip.folder('3D/Objects');
  zip.folder('Metadata');

  // 4. 3D/_rels/3dmodel.model.rels (CRITICAL: links wrapper to geometry)
  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/Objects/${baseName}.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  zip.file('3D/_rels/3dmodel.model.rels', modelRels);

  // 5. 3D/3dmodel.model (WRAPPER - references Objects/)
  const wrapperModel = buildWrapperModel(baseName);
  zip.file('3D/3dmodel.model', wrapperModel);

  // 6. 3D/Objects/{baseName}.model (REAL GEOMETRY with paint_color)
  let objectModelContent: string;
  let sampleTriangles: string[] = [];

  if (mode === 'multi_volume') {
    objectModelContent = buildModelWithMultiVolume(geometry, faceColorIndices, palette, baseName);
  } else {
    // Both 'paint_color' and 'mmu_segmentation' use the same format
    const result = buildObjectModel(geometry, faceColorIndices, palette, baseName);
    objectModelContent = result.xml;
    sampleTriangles = result.sampleTriangles;
  }
  zip.file(`3D/Objects/${baseName}.model`, objectModelContent);

  // 7. Metadata/Slic3r_PE.config
  const slicerConfig = buildSlicerPEConfig(palette);
  zip.file('Metadata/Slic3r_PE.config', slicerConfig);

  // 8. Metadata/model_settings.config (OrcaSlicer INI format)
  const modelSettings = buildModelSettingsConfig(baseName);
  zip.file('Metadata/model_settings.config', modelSettings);

  // 9. Metadata/project_settings.config
  const projectSettings = buildProjectSettingsConfig();
  zip.file('Metadata/project_settings.config', projectSettings);

  // 10. Metadata/slice_info.config
  const sliceInfo = buildSliceInfoConfig();
  zip.file('Metadata/slice_info.config', sliceInfo);

  // 11. Metadata/Slic3r_PE_model.config (XML format)
  const modelConfig = mode === 'multi_volume'
    ? buildMultiVolumeModelConfig(palette)
    : buildSlicerModelConfig(palette, triCount);
  zip.file('Metadata/Slic3r_PE_model.config', modelConfig);

  // ===== VALIDATION =====
  const validation = await validate3MFStructure(zip, baseName);

  if (!validation.valid) {
    console.error('[export3MF] Validation FAILED:', validation.errors);
    throw new Error(`3MF Validation Failed:\n${validation.errors.join('\n')}`);
  }

  console.log('[export3MF] Validation PASSED ✓');

  // ===== BUILD FILE LIST WITH SIZES =====
  const fileList: { path: string; size: number }[] = [];
  const zipFiles = zip.files;
  for (const [path, file] of Object.entries(zipFiles)) {
    if (!file.dir) {
      const content = await file.async('string');
      fileList.push({ path, size: content.length });
    }
  }

  // ===== SAMPLE ATTRIBUTES FOR REPORT =====
  const sampleIndices = [0, 1, 2, 3, 4, Math.floor(triCount / 2), triCount - 1].filter(i => i < triCount);
  const sampleAttributes = sampleIndices.map(i => ({
    triangle: i,
    colorIndex: faceColorIndices[i],
    attribute: `paint_color="${encodePaintColor(faceColorIndices[i])}"`,
  }));

  // ===== BUILD REPORT =====
  const report: ExportReport = {
    mode,
    totalTriangles: triCount,
    totalVertices: vertexCount,
    palette: palette.map(c => rgbToHex(c)),
    colorDistribution,
    sampleAttributes,
    files: fileList,
    validation,
    fileStructure: fileList.map(f => `  ${f.path} (${formatBytes(f.size)})`).join('\n'),
    pathVerification: {
      relsTarget: `/3D/Objects/${baseName}.model`,
      wrapperPath: `/3D/Objects/${baseName}.model`,
      objectFileExists: zip.file(`3D/Objects/${baseName}.model`) !== null,
    },
    sampleTriangles,
    wrapperXmlPreview: wrapperModel.split('\n').slice(0, 20).join('\n'),
    objectXmlPreview: objectModelContent.split('\n').slice(0, 50).join('\n'),
  };

  // ===== DIAGNOSTIC REPORT FILE =====
  const reportText = buildExpandedDiagnosticReport(report, baseName);
  zip.file('Metadata/3DTextureConverter_report.txt', reportText);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return { blob, report };
}

/**
 * Build the wrapper model XML (3D/3dmodel.model)
 * This file references the actual geometry in Objects/
 */
function buildWrapperModel(baseName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
    <object id="1" type="model">
      <components>
        <component p:path="/3D/Objects/${baseName}.model" objectid="1"/>
      </components>
    </object>
  </resources>
  <build>
    <item objectid="1" printable="1"/>
  </build>
</model>`;
}

/**
 * Build the actual object model with geometry and paint_color
 * This goes in 3D/Objects/{baseName}.model
 */
function buildObjectModel(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[],
  baseName: string
): { xml: string; sampleTriangles: string[] } {
  const positions = geometry.getAttribute('position');
  if (!positions) return { xml: '', sampleTriangles: [] };

  const vertices: string[] = [];
  const triangles: string[] = [];
  const sampleTriangles: string[] = [];
  const vertexMap = new Map<string, number>();
  let vertexIndex = 0;
  const triCount = positions.count / 3;

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
        vertices.push(`        <vertex x="${x}" y="${y}" z="${z}"/>`);
        vertexIndex++;
      }
      indices.push(vertexMap.get(key)!);
    }

    const colorIdx = faceColorIndices[i] ?? 0;
    const paintColor = encodePaintColor(colorIdx);

    const triangleLine = `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" paint_color="${paintColor}"/>`;
    triangles.push(triangleLine);

    // Collect samples for debug report
    if (sampleTriangles.length < 5) {
      sampleTriangles.push(triangleLine.trim());
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"
       xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Title">${escapeXml(baseName)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
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
    <item objectid="1"/>
  </build>
</model>`;

  return { xml, sampleTriangles };
}

/**
 * Multi-Volume mode: separate objects for each color
 */
function buildModelWithMultiVolume(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[],
  baseName: string
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
          vertices.push(`          <vertex x="${x}" y="${y}" z="${z}"/>`);
          vertexIndex++;
        }
        indices.push(vertexMap.get(key)!);
      }

      triangles.push(`          <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}"/>`);
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

    buildItems.push(`    <item objectid="${objectId}"/>`);
    objectId++;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Title">${escapeXml(baseName)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
${objects.join('\n')}
  </resources>
  <build>
${buildItems.join('\n')}
  </build>
</model>`;
}

// ===== METADATA CONFIG BUILDERS =====

function buildSlicerPEConfig(palette: RGB[]): string {
  const filamentColours = palette.map(color => rgbToHex(color)).join(';');
  const filamentSettings = palette.map(() => 'Generic PLA').join(';');

  return `; Generated by 3D Texture Converter
; OrcaSlicer/Bambu Studio/PrusaSlicer compatible format

filament_colour = ${filamentColours}
filament_settings_id = ${filamentSettings}
`;
}

function buildModelSettingsConfig(baseName: string): string {
  return `; OrcaSlicer model settings
; Generated by 3D Texture Converter

[plate]
print_sequence = 
plate_index = 0
label_object_enabled = 0

[object:1]
name = ${baseName}
extruder = 1
`;
}

function buildProjectSettingsConfig(): string {
  return `; OrcaSlicer project settings
; Generated by 3D Texture Converter

[project]
name = 3D Texture Converter Export
`;
}

function buildSliceInfoConfig(): string {
  return `; OrcaSlicer slice info
; Generated by 3D Texture Converter

[slice_info]
plate_count = 1
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

// ===== EXPANDED DIAGNOSTIC REPORT =====

function buildExpandedDiagnosticReport(report: ExportReport, baseName: string): string {
  const usedColors = new Set<string>();
  report.sampleAttributes.forEach(s => {
    usedColors.add(s.attribute.match(/paint_color="([^"]+)"/)?.[1] || '');
  });

  const lines = [
    '=== 3D Texture Converter - Debug Report ===',
    `Date: ${new Date().toISOString()}`,
    `Export Mode: ${report.mode}`,
    '',
    '--- File Structure ---',
    report.fileStructure,
    '',
    '--- Path Verification ---',
    `  .rels Target: ${report.pathVerification.relsTarget} ${report.pathVerification.objectFileExists ? '✓' : '✗'}`,
    `  Wrapper p:path: ${report.pathVerification.wrapperPath} ${report.pathVerification.objectFileExists ? '✓' : '✗'}`,
    `  Object file exists: ${report.pathVerification.objectFileExists ? 'YES ✓' : 'NO ✗'}`,
    '',
    '--- Geometry ---',
    `  Total Triangles: ${report.totalTriangles.toLocaleString()}`,
    `  Total Vertices: ${report.totalVertices.toLocaleString()}`,
    '',
    '--- Palette ---',
    ...report.palette.map((c, i) => `  Color ${i + 1}: ${c} -> paint_color="${encodePaintColor(i)}"`),
    '',
    '--- Color Distribution ---',
    ...report.colorDistribution.map(d =>
      `  ${d.color}: ${d.count.toLocaleString()} triangles (${d.percentage.toFixed(2)}%)`
    ),
    '',
    '--- Paint Color Stats ---',
    `  Triangles with paint_color: ${report.totalTriangles.toLocaleString()} (100%)`,
    `  Colors used: ${Array.from(usedColors).filter(c => c).join(', ')} (${report.palette.length} extruders)`,
    '',
    '--- Sample Triangles (5 lines) ---',
    ...report.sampleTriangles.map(t => `  ${t}`),
    '',
    '--- Wrapper XML (first 20 lines) ---',
    report.wrapperXmlPreview,
    '',
    '--- Object Model XML (first 50 lines) ---',
    report.objectXmlPreview,
    '',
    '--- Validation Result ---',
    report.validation.valid ? '  ✓ All checks passed' : `  ✗ ERRORS:\n${report.validation.errors.map(e => `    - ${e}`).join('\n')}`,
    '',
    '--- Manual Validation Checklist ---',
    `  1. Rename .3mf to .zip and extract`,
    `  2. Check: 3D/Objects/${baseName}.model exists`,
    `  3. Open 3D/Objects/${baseName}.model and search for paint_color=`,
    `  4. Open 3D/_rels/3dmodel.model.rels and verify Target="/3D/Objects/${baseName}.model"`,
    `  5. Open 3D/3dmodel.model and verify p:path="/3D/Objects/${baseName}.model"`,
    '',
    '=== End Report ===',
  ];
  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

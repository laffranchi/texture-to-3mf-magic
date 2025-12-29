import JSZip from 'jszip';
import * as THREE from 'three';
import { ExportData } from './meshProcessor';
import { rgbToHex, RGB } from './colorQuantization';

// Maximum recommended triangles for OrcaSlicer compatibility
export const MAX_TRIANGLES_WARNING = 500000;
export const MAX_TRIANGLES_LIMIT = 1000000;

export interface ExportReport {
  totalTriangles: number;
  totalVertices: number;
  palette: string[];
  colorDistribution: { color: string; count: number; percentage: number }[];
  objectStats: { colorIndex: number; color: string; vertices: number; triangles: number }[];
  files: { path: string; size: number }[];
  validation: ValidationResult;
  fileStructure: string;
  modelXmlPreview: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  xmlParseResults: { file: string; valid: boolean; error?: string }[];
  geometryStats: { totalVertices: number; totalTriangles: number; objectCount: number };
}

/**
 * Generate a simple UUID based on index for deterministic output
 */
function generateUUID(seed: number): string {
  const hex = seed.toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}

/**
 * Validate XML is well-formed using DOMParser.
 */
function validateXmlWellFormed(xml: string, filename: string): { valid: boolean; error?: string } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      return { valid: false, error: parseError.textContent?.slice(0, 200) || 'XML parse error' };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: String(e).slice(0, 200) };
  }
}

/**
 * Validate the 3MF structure (flat format - trimesh style).
 */
async function validate3MFStructure(zip: JSZip): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const xmlParseResults: { file: string; valid: boolean; error?: string }[] = [];
  let geometryStats = { totalVertices: 0, totalTriangles: 0, objectCount: 0 };

  const modelPath = '3D/3dmodel.model';

  // Check 1: Main model exists
  if (!zip.file(modelPath)) {
    errors.push(`ERRO: ${modelPath} não existe no ZIP`);
  }

  // Check 2: Content_Types exists
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    const content = await contentTypesFile.async('string');
    const parseResult = validateXmlWellFormed(content, '[Content_Types].xml');
    xmlParseResults.push({ file: '[Content_Types].xml', ...parseResult });
    if (!parseResult.valid) {
      errors.push(`ERRO: [Content_Types].xml inválido: ${parseResult.error}`);
    }
  } else {
    errors.push('ERRO: [Content_Types].xml não existe');
  }

  // Check 3: Root .rels exists and points to model
  const rootRelsFile = zip.file('_rels/.rels');
  if (rootRelsFile) {
    const content = await rootRelsFile.async('string');
    const parseResult = validateXmlWellFormed(content, '_rels/.rels');
    xmlParseResults.push({ file: '_rels/.rels', ...parseResult });
    if (!parseResult.valid) {
      errors.push(`ERRO: _rels/.rels inválido: ${parseResult.error}`);
    } else if (!content.includes('/3D/3dmodel.model')) {
      errors.push('ERRO: _rels/.rels não aponta para /3D/3dmodel.model');
    }
  } else {
    errors.push('ERRO: _rels/.rels não existe');
  }

  // Check 4: Parse and validate main model XML + geometry
  const modelFile = zip.file(modelPath);
  if (modelFile) {
    const modelContent = await modelFile.async('string');
    const parseResult = validateXmlWellFormed(modelContent, modelPath);
    xmlParseResults.push({ file: modelPath, ...parseResult });

    if (!parseResult.valid) {
      errors.push(`ERRO: ${modelPath} XML inválido: ${parseResult.error}`);
    } else {
      const parser = new DOMParser();
      const doc = parser.parseFromString(modelContent, 'application/xml');

      // Count objects
      const objects = doc.querySelectorAll('object');
      geometryStats.objectCount = objects.length;

      if (objects.length === 0) {
        errors.push(`ERRO: ${modelPath} não contém <object>`);
      }

      // Count total vertices and triangles across all objects
      const meshes = doc.querySelectorAll('mesh');
      let totalVerts = 0;
      let totalTris = 0;

      meshes.forEach(mesh => {
        totalVerts += mesh.querySelectorAll('vertex').length;
        totalTris += mesh.querySelectorAll('triangle').length;
      });

      geometryStats.totalVertices = totalVerts;
      geometryStats.totalTriangles = totalTris;

      if (totalTris === 0) {
        errors.push(`ERRO: ${modelPath} não contém triângulos`);
      }

      // Check build items
      const buildItems = doc.querySelectorAll('build item');
      if (buildItems.length === 0) {
        errors.push(`ERRO: ${modelPath} não contém <item> em <build>`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, xmlParseResults, geometryStats };
}

/**
 * Export to 3MF with flat structure (trimesh compatible).
 * Each color becomes a separate object in the same model file.
 */
export async function export3MF(
  exportData: ExportData,
  filename: string = 'model'
): Promise<{ blob: Blob; report: ExportReport }> {
  const { geometry, faceColorIndices, palette } = exportData;

  // Extract base name without extension
  const baseName = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'model';

  const zip = new JSZip();
  const triCount = faceColorIndices.length;

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

  console.log(`[export3MF] Mode: flat (trimesh style), BaseName: ${baseName}`);
  console.log('[export3MF] Colors:', palette.length, palette.map(c => rgbToHex(c)));
  console.log('[export3MF] Total triangles:', triCount);

  // ===== FILE STRUCTURE (Flat - trimesh compatible) =====

  // 1. [Content_Types].xml
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  zip.file('[Content_Types].xml', contentTypes);

  // 2. _rels/.rels (root relationships - points directly to 3D/3dmodel.model)
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  zip.folder('_rels');
  zip.file('_rels/.rels', rootRels);

  // 3. Create 3D folder
  zip.folder('3D');

  // 4. 3D/3dmodel.model (FLAT STRUCTURE - all geometry here)
  const { xml: modelXml, objectStats } = buildFlatModel(geometry, faceColorIndices, palette, baseName);
  zip.file('3D/3dmodel.model', modelXml);

  // 5. Metadata folder with slicer configs
  zip.folder('Metadata');

  // Slic3r_PE.config (filament colors)
  const slicerConfig = buildSlicerPEConfig(palette);
  zip.file('Metadata/Slic3r_PE.config', slicerConfig);

  // Slic3r_PE_model.config (object configs)
  const modelConfig = buildModelConfig(palette);
  zip.file('Metadata/Slic3r_PE_model.config', modelConfig);

  // ===== VALIDATION =====
  const validation = await validate3MFStructure(zip);

  if (!validation.valid) {
    console.error('[export3MF] Validation FAILED:', validation.errors);
    throw new Error(`3MF Validation Failed:\n${validation.errors.join('\n')}`);
  }

  console.log('[export3MF] Validation PASSED ✓');
  console.log(`[export3MF] Objects: ${validation.geometryStats.objectCount}, Triangles: ${validation.geometryStats.totalTriangles}`);

  // ===== BUILD FILE LIST WITH SIZES =====
  const fileList: { path: string; size: number }[] = [];
  const zipFiles = zip.files;
  for (const [path, file] of Object.entries(zipFiles)) {
    if (!file.dir) {
      const content = await file.async('string');
      fileList.push({ path, size: content.length });
    }
  }

  // ===== BUILD REPORT =====
  const report: ExportReport = {
    totalTriangles: triCount,
    totalVertices: validation.geometryStats.totalVertices,
    palette: palette.map(c => rgbToHex(c)),
    colorDistribution,
    objectStats,
    files: fileList,
    validation,
    fileStructure: fileList.map(f => `  ${f.path} (${formatBytes(f.size)})`).join('\n'),
    modelXmlPreview: modelXml.split('\n').slice(0, 60).join('\n'),
  };

  // ===== DIAGNOSTIC REPORT FILE =====
  const reportText = buildDiagnosticReport(report);
  zip.file('Metadata/3DTextureConverter_report.txt', reportText);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return { blob, report };
}

/**
 * Build flat model XML with multiple objects (one per color).
 * This is the trimesh-compatible format that works with OrcaSlicer.
 */
function buildFlatModel(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[],
  baseName: string
): { xml: string; objectStats: { colorIndex: number; color: string; vertices: number; triangles: number }[] } {
  const positions = geometry.getAttribute('position');
  if (!positions) return { xml: '', objectStats: [] };

  const triCount = positions.count / 3;

  // Group triangles by color
  const trianglesByColor: Map<number, number[][]> = new Map();

  for (let i = 0; i < triCount; i++) {
    const colorIdx = faceColorIndices[i] ?? 0;

    if (!trianglesByColor.has(colorIdx)) {
      trianglesByColor.set(colorIdx, []);
    }

    const tri: number[] = [];
    for (let v = 0; v < 3; v++) {
      const idx = i * 3 + v;
      tri.push(
        positions.getX(idx),
        positions.getY(idx),
        positions.getZ(idx)
      );
    }
    trianglesByColor.get(colorIdx)!.push(tri);
  }

  // Build objects for each color
  const objects: string[] = [];
  const buildItems: string[] = [];
  const objectStats: { colorIndex: number; color: string; vertices: number; triangles: number }[] = [];
  let objectId = 1;

  // Sort by color index for consistent output
  const sortedColors = Array.from(trianglesByColor.keys()).sort((a, b) => a - b);

  for (const colorIdx of sortedColors) {
    const triangleData = trianglesByColor.get(colorIdx)!;
    const color = palette[colorIdx];
    const hex = rgbToHex(color);
    const objectName = `Cor_${colorIdx + 1}`;

    const vertices: string[] = [];
    const triangles: string[] = [];
    const vertexMap = new Map<string, number>();
    let vertexIndex = 0;

    // Each triangle has 9 values: x1,y1,z1,x2,y2,z2,x3,y3,z3
    for (const tri of triangleData) {
      const indices: number[] = [];

      for (let v = 0; v < 3; v++) {
        const x = tri[v * 3].toFixed(6);
        const y = tri[v * 3 + 1].toFixed(6);
        const z = tri[v * 3 + 2].toFixed(6);
        const key = `${x},${y},${z}`;

        if (!vertexMap.has(key)) {
          vertexMap.set(key, vertexIndex);
          vertices.push(`        <vertex x="${x}" y="${y}" z="${z}"/>`);
          vertexIndex++;
        }
        indices.push(vertexMap.get(key)!);
      }

      triangles.push(`        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}"/>`);
    }

    const uuid = generateUUID(objectId);

    objects.push(`    <object id="${objectId}" name="${objectName}" type="model" p:UUID="${uuid}">
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>`);

    // Identity transform matrix: 1 0 0 0 1 0 0 0 1 0 0 0
    const itemUuid = generateUUID(1000 + objectId);
    buildItems.push(`    <item objectid="${objectId}" transform="1 0 0 0 1 0 0 0 1 0 0 0" p:UUID="${itemUuid}"/>`);

    objectStats.push({
      colorIndex: colorIdx,
      color: hex,
      vertices: vertices.length,
      triangles: triangles.length,
    });

    objectId++;
  }

  const buildUuid = generateUUID(9999);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Title">${escapeXml(baseName)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <resources>
${objects.join('\n')}
  </resources>
  <build p:UUID="${buildUuid}">
${buildItems.join('\n')}
  </build>
</model>`;

  return { xml, objectStats };
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

function buildModelConfig(palette: RGB[]): string {
  const objectConfigs = palette.map((color, idx) => `  <object id="${idx + 1}">
    <metadata type="object" key="name" value="Cor_${idx + 1}"/>
    <metadata type="object" key="extruder" value="${idx + 1}"/>
  </object>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objectConfigs}
</config>`;
}

// ===== DIAGNOSTIC REPORT =====

function buildDiagnosticReport(report: ExportReport): string {
  const lines = [
    '=== 3D Texture Converter - Export Report ===',
    `Date: ${new Date().toISOString()}`,
    `Export Mode: Flat Structure (trimesh compatible)`,
    '',
    '--- File Structure ---',
    report.fileStructure,
    '',
    '--- XML Validation ---',
    ...(report.validation.xmlParseResults?.map(r =>
      `  ${r.file}: ${r.valid ? 'OK ✓' : `ERRO ✗ - ${r.error}`}`
    ) || ['  (no parse results)']),
    '',
    '--- Geometry Stats ---',
    `  Total Objects: ${report.validation.geometryStats?.objectCount || 0}`,
    `  Total Vertices: ${report.validation.geometryStats?.totalVertices?.toLocaleString() || 'N/A'}`,
    `  Total Triangles: ${report.validation.geometryStats?.totalTriangles?.toLocaleString() || 'N/A'}`,
    '',
    '--- Objects by Color ---',
    ...report.objectStats.map(o =>
      `  ${o.color} (Color ${o.colorIndex + 1}): ${o.triangles.toLocaleString()} triangles, ${o.vertices.toLocaleString()} vertices`
    ),
    '',
    '--- Palette ---',
    ...report.palette.map((c, i) => `  Cor_${i + 1}: ${c}`),
    '',
    '--- Color Distribution ---',
    ...report.colorDistribution.map(d =>
      `  ${d.color}: ${d.count.toLocaleString()} triangles (${d.percentage.toFixed(2)}%)`
    ),
    '',
    '--- Model XML Preview (first 60 lines) ---',
    report.modelXmlPreview,
    '',
    '--- Validation Result ---',
    report.validation.valid
      ? '  ✓ All checks passed - File should open in OrcaSlicer'
      : `  ✗ ERRORS:\n${report.validation.errors.map(e => `    - ${e}`).join('\n')}`,
    ...(report.validation.warnings?.length
      ? [`  ⚠ WARNINGS:\n${report.validation.warnings.map(w => `    - ${w}`).join('\n')}`]
      : []),
    '',
    '--- Usage in OrcaSlicer ---',
    '  1. Open File > Import > Import 3MF',
    '  2. Each color appears as a separate object',
    '  3. Right-click object > Change Filament to assign extruder',
    '  4. Colors in palette match the RGB values shown above',
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

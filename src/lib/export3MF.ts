import JSZip from 'jszip';
import * as THREE from 'three';
import { ExportData } from './meshProcessor';
import { rgbToHex, RGB } from './colorQuantization';

// Maximum recommended triangles for OrcaSlicer compatibility
export const MAX_TRIANGLES_WARNING = 500000;
export const MAX_TRIANGLES_LIMIT = 1000000;

/**
 * Export a solid mesh with per-triangle color assignments to 3MF format.
 * Uses slic3rpe:mmu_segmentation for OrcaSlicer/BambuStudio compatibility.
 */
export async function export3MF(exportData: ExportData, filename: string = 'model'): Promise<Blob> {
  const { geometry, faceColorIndices, palette } = exportData;
  
  const zip = new JSZip();

  // Content Types
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

  zip.file('[Content_Types].xml', contentTypes);

  // Relationships
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  zip.folder('_rels');
  zip.file('_rels/.rels', rels);

  // Build the mesh XML with per-triangle mmu_segmentation
  const meshXml = buildSolidMeshXML(geometry, faceColorIndices);

  // 3D Model with slic3rpe namespace for OrcaSlicer compatibility
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
  <metadata name="Title">${escapeXml(filename)}</metadata>
  <metadata name="Application">3D Texture Converter</metadata>
  <metadata name="slic3rpe:Version3mf">1</metadata>
  <metadata name="slic3rpe:MmPaintingVersion">1</metadata>
  <resources>
    <object id="1" type="model">
${meshXml}
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  console.log('[export3MF] colors:', palette.length);
  console.log('[export3MF] triangles:', faceColorIndices.length);
  console.log('[export3MF] model.xml bytes:', model.length);

  zip.folder('3D');
  zip.file('3D/3dmodel.model', model);

  // Add Slic3r_PE_model.config for OrcaSlicer
  const triCount = faceColorIndices.length;
  const modelConfig = buildModelConfig(triCount, palette.length);
  zip.folder('Metadata');
  zip.file('Metadata/Slic3r_PE_model.config', modelConfig);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return blob;
}

/**
 * Build mesh XML for a single solid object with per-triangle mmu_segmentation.
 * Uses slic3rpe:mmu_segmentation attribute for OrcaSlicer multi-material painting.
 */
function buildSolidMeshXML(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[]
): string {
  const positions = geometry.getAttribute('position');
  if (!positions) return '';

  const vertices: string[] = [];
  const triangles: string[] = [];

  // Vertex deduplication map
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
        vertices.push(`          <vertex x="${x}" y="${y}" z="${z}" />`);
        vertexIndex++;
      }

      indices.push(vertexMap.get(key)!);
    }

    // Get color index for this triangle (0-based)
    const colorIdx = faceColorIndices[i] ?? 0;
    
    // OrcaSlicer uses slic3rpe:mmu_segmentation with extruder index (1-based)
    // The value is the extruder number as a string: "1", "2", "3", etc.
    const extruderIndex = colorIdx + 1;
    
    triangles.push(
      `          <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" slic3rpe:mmu_segmentation="${extruderIndex}" />`
    );
  }

  return `      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>`;
}

/**
 * Build Slic3r_PE_model.config for OrcaSlicer compatibility.
 * Defines the object and volume configuration.
 */
function buildModelConfig(triangleCount: number, numColors: number): string {
  // Create extruder metadata - default to extruder 1, painting will override
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata type="object" key="name" value="MultiColorModel"/>
    <metadata type="object" key="extruder" value="1"/>
    <volume firstid="0" lastid="${triangleCount - 1}">
      <metadata type="volume" key="name" value="ColoredVolume"/>
      <metadata type="volume" key="volume_type" value="ModelPart"/>
      <metadata type="volume" key="extruder" value="1"/>
      <metadata type="volume" key="mmu_segmentation" value="1"/>
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

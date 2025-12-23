import JSZip from 'jszip';
import * as THREE from 'three';
import { ExportData } from './meshProcessor';
import { rgbToHex, RGB } from './colorQuantization';

/**
 * Export a solid mesh with per-triangle color assignments to 3MF format.
 * Uses basematerials with pid/p1 attributes on triangles for slicer compatibility.
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

  // Build the single mesh XML with per-triangle color properties
  const meshXml = buildSolidMeshXML(geometry, faceColorIndices, palette);

  // 3D Model with basematerials
  const materialsXml = palette
    .map((color, idx) => {
      const hex = rgbToHex(color).toUpperCase();
      return `      <base name="Color_${idx + 1}" displaycolor="${hex}" />`;
    })
    .join('\n');

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${escapeXml(filename)}</metadata>
  <metadata name="Designer">3D Texture Converter</metadata>
  <metadata name="Description">Multi-color model for AMS printing</metadata>
  <resources>
    <basematerials id="1">
${materialsXml}
    </basematerials>
${meshXml}
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`;

  console.log('[export3MF] colors:', palette.length);
  console.log('[export3MF] triangles:', faceColorIndices.length);
  console.log('[export3MF] model.xml bytes:', model.length);

  zip.folder('3D');
  zip.file('3D/3dmodel.model', model);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return blob;
}

/**
 * Build mesh XML for a single solid object with per-triangle color assignments.
 * Uses vertex deduplication and assigns pid/p1 attributes to triangles.
 */
function buildSolidMeshXML(
  geometry: THREE.BufferGeometry,
  faceColorIndices: number[],
  palette: RGB[]
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
        vertices.push(`        <vertex x="${x}" y="${y}" z="${z}" />`);
        vertexIndex++;
      }

      indices.push(vertexMap.get(key)!);
    }

    // Get color index for this triangle (default to 0 if out of bounds)
    const colorIdx = faceColorIndices[i] ?? 0;
    
    // pid="1" references the basematerials group (id="1")
    // p1 is the 0-based index within basematerials for this triangle
    triangles.push(
      `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" pid="1" p1="${colorIdx}" />`
    );
  }

  // Object id="2" (id="1" is used by basematerials)
  return `    <object id="2" type="model">
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>`;
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

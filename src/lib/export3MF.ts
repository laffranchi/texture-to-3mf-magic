import JSZip from 'jszip';
import * as THREE from 'three';
import { ProcessedMesh } from './meshProcessor';
import { rgbToHex } from './colorQuantization';

function geometryToMeshXML(
  geometry: THREE.BufferGeometry,
  objectId: number,
  materialIndex: number
): string {
  const positions = geometry.getAttribute('position');
  if (!positions) return '';

  const vertices: string[] = [];
  const triangles: string[] = [];

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

    triangles.push(
      `        <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" />`
    );
  }

  // Object-level material assignment: most slicers understand this better than per-triangle properties
  // pid references the basematerials group id, pindex is the 0-based index within that group.
  return `    <object id="${objectId}" type="model" pid="1" pindex="${materialIndex}">
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

export async function export3MF(meshes: ProcessedMesh[], filename: string = 'model'): Promise<Blob> {
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

  // Build basematerials (core spec, no namespace prefix)
  const materialsXml = meshes
    .map((mesh, idx) => {
      const hex = rgbToHex(mesh.color).toUpperCase(); // #RRGGBB
      return `      <base name="Color_${idx + 1}" displaycolor="${hex}" />`;
    })
    .join('\n');

  // Objects XML (one object per color)
  const objectsXml = meshes
    .map((mesh, idx) => geometryToMeshXML(mesh.geometry, idx + 1, idx))
    .join('\n');

  // Build items (references to objects)
  const itemsXml = meshes.map((_, idx) => `    <item objectid="${idx + 1}" />`).join('\n');

  // 3D Model
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${filename}</metadata>
  <metadata name="Designer">3D Texture Converter</metadata>
  <metadata name="Description">Multi-material model for AMS printing</metadata>
  <resources>
    <basematerials id="1">
${materialsXml}
    </basematerials>
${objectsXml}
  </resources>
  <build>
${itemsXml}
  </build>
</model>`;

  console.log('[export3MF] colors:', meshes.length);
  console.log('[export3MF] model.xml bytes:', model.length);

  zip.folder('3D');
  zip.file('3D/3dmodel.model', model);

  // 3MF is a zip package; this mimeType helps some environments
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
  return blob;
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

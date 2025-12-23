import JSZip from 'jszip';
import * as THREE from 'three';
import { ProcessedMesh } from './meshProcessor';
import { rgbToHex } from './colorQuantization';

/**
 * Exports multi-color 3MF with proper material-per-triangle support.
 * 
 * According to 3MF spec:
 * - basematerials define the color palette
 * - Each triangle can reference a material via pid (property group id) and p1 (material index)
 * - For flat shading (same color per triangle), p1=p2=p3 or just p1 is enough
 */

interface VertexData {
  x: string;
  y: string;
  z: string;
}

interface TriangleData {
  v1: number;
  v2: number;
  v3: number;
  materialIndex: number;
}

function buildMeshData(meshes: ProcessedMesh[]): { vertices: VertexData[]; triangles: TriangleData[] } {
  const vertexMap = new Map<string, number>();
  const vertices: VertexData[] = [];
  const triangles: TriangleData[] = [];

  meshes.forEach((mesh, materialIndex) => {
    const positions = mesh.geometry.getAttribute('position');
    if (!positions) return;

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
          vertexMap.set(key, vertices.length);
          vertices.push({ x, y, z });
        }

        indices.push(vertexMap.get(key)!);
      }

      triangles.push({
        v1: indices[0],
        v2: indices[1],
        v3: indices[2],
        materialIndex: materialIndex
      });
    }
  });

  return { vertices, triangles };
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

  // Build combined mesh data
  const { vertices, triangles } = buildMeshData(meshes);

  // Build vertices XML
  const verticesXml = vertices.map(v => 
    `          <vertex x="${v.x}" y="${v.y}" z="${v.z}" />`
  ).join('\n');

  // Build triangles XML with material references (pid=1 points to basematerials, p1=materialIndex)
  const trianglesXml = triangles.map(t => 
    `          <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}" pid="1" p1="${t.materialIndex}" />`
  ).join('\n');

  // Build basematerials for colors
  const materialsXml = meshes.map((mesh, idx) => {
    const hex = rgbToHex(mesh.color).toUpperCase();
    return `      <base name="Color_${idx + 1}" displaycolor="${hex}FF" />`;
  }).join('\n');

  // 3D Model with single object containing all triangles with per-triangle materials
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">${filename}</metadata>
  <metadata name="Designer">3D Texture Converter</metadata>
  <metadata name="Description">Multi-material model for AMS printing</metadata>
  <resources>
    <m:basematerials id="1">
${materialsXml}
    </m:basematerials>
    <object id="2" type="model">
      <mesh>
        <vertices>
${verticesXml}
        </vertices>
        <triangles>
${trianglesXml}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`;

  zip.folder('3D');
  zip.file('3D/3dmodel.model', model);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
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

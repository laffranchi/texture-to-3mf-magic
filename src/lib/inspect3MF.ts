import JSZip from 'jszip';

export interface Inspect3MFResult {
  files: string[];
  modelFile: string | null;
  analysis: {
    hasMMUSegmentation: boolean;
    hasPaintColor: boolean;
    hasPidP1: boolean;
    hasBasematerials: boolean;
    hasSlic3rpeNamespace: boolean;
    hasMmPaintingVersion: boolean;
    triangleCount: number;
    vertexCount: number;
    objectCount: number;
    mmuSegmentationValues: string[];
    paintColorValues: string[];
    pidP1Values: string[];
    uniqueSegmentationCount: number;
    uniquePaintColorCount: number;
  };
  metadata: Record<string, string>;
  configFiles: { name: string; content: string }[];
  issues: string[];
  suggestions: string[];
  rawModelXml: string;
}

/**
 * Inspect a 3MF file to analyze its structure and attributes
 */
export async function inspect3MF(file: File): Promise<Inspect3MFResult> {
  const zip = await JSZip.loadAsync(file);
  
  const files: string[] = [];
  zip.forEach((path) => {
    files.push(path);
  });

  // Find the main model file
  let modelFile: string | null = null;
  const possibleModelPaths = [
    '3D/3dmodel.model',
    '3D/Objects/model.model',
    '3D/model.model',
  ];

  for (const path of possibleModelPaths) {
    if (zip.file(path)) {
      modelFile = path;
      break;
    }
  }

  // Also check for any .model file in 3D folder
  if (!modelFile) {
    for (const path of files) {
      if (path.endsWith('.model') && path.startsWith('3D/')) {
        modelFile = path;
        break;
      }
    }
  }

  let rawModelXml = '';
  const analysis = {
    hasMMUSegmentation: false,
    hasPaintColor: false,
    hasPidP1: false,
    hasBasematerials: false,
    hasSlic3rpeNamespace: false,
    hasMmPaintingVersion: false,
    triangleCount: 0,
    vertexCount: 0,
    objectCount: 0,
    mmuSegmentationValues: [] as string[],
    paintColorValues: [] as string[],
    pidP1Values: [] as string[],
    uniqueSegmentationCount: 0,
    uniquePaintColorCount: 0,
  };

  const metadata: Record<string, string> = {};
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (modelFile) {
    const modelFileObj = zip.file(modelFile);
    if (modelFileObj) {
      rawModelXml = await modelFileObj.async('text');
      
      // Check for namespaces
      analysis.hasSlic3rpeNamespace = rawModelXml.includes('xmlns:slic3rpe');
      
      // Check for MmPaintingVersion
      analysis.hasMmPaintingVersion = rawModelXml.includes('MmPaintingVersion');
      
      // Check for basematerials
      analysis.hasBasematerials = rawModelXml.includes('basematerials');
      
      // Parse XML to count elements and attributes
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawModelXml, 'text/xml');
      
      // Check for parse errors
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        issues.push(`XML Parse Error: ${parseError.textContent?.slice(0, 100)}`);
      }
      
      // Count vertices
      const vertices = doc.querySelectorAll('vertex');
      analysis.vertexCount = vertices.length;
      
      // Count triangles and analyze attributes
      const triangles = doc.querySelectorAll('triangle');
      analysis.triangleCount = triangles.length;
      
      const mmuValues = new Set<string>();
      const paintValues = new Set<string>();
      const pidP1Values = new Set<string>();
      
      triangles.forEach((tri, idx) => {
        // Check for slic3rpe:mmu_segmentation
        const mmuSeg = tri.getAttribute('slic3rpe:mmu_segmentation') || 
                       tri.getAttributeNS('http://schemas.slic3r.org/3mf/2017/06', 'mmu_segmentation');
        if (mmuSeg) {
          analysis.hasMMUSegmentation = true;
          mmuValues.add(mmuSeg);
          if (idx < 10) {
            analysis.mmuSegmentationValues.push(mmuSeg);
          }
        }
        
        // Check for paint_color
        const paintColor = tri.getAttribute('paint_color');
        if (paintColor) {
          analysis.hasPaintColor = true;
          paintValues.add(paintColor);
          if (idx < 10) {
            analysis.paintColorValues.push(paintColor);
          }
        }
        
        // Check for pid/p1
        const pid = tri.getAttribute('pid');
        const p1 = tri.getAttribute('p1');
        if (pid && p1) {
          analysis.hasPidP1 = true;
          pidP1Values.add(`${pid}:${p1}`);
          if (idx < 10) {
            analysis.pidP1Values.push(`pid=${pid} p1=${p1}`);
          }
        }
      });
      
      analysis.uniqueSegmentationCount = mmuValues.size;
      analysis.uniquePaintColorCount = paintValues.size;
      
      // Count objects
      const objects = doc.querySelectorAll('object');
      analysis.objectCount = objects.length;
      
      // Extract metadata
      const metadataElements = doc.querySelectorAll('metadata');
      metadataElements.forEach((meta) => {
        const name = meta.getAttribute('name');
        const content = meta.textContent;
        if (name && content) {
          metadata[name] = content;
        }
      });
    }
  }

  // Read config files
  const configFiles: { name: string; content: string }[] = [];
  const configPaths = [
    'Metadata/Slic3r_PE.config',
    'Metadata/Slic3r_PE_model.config',
    'Metadata/model_settings.config',
  ];
  
  for (const path of configPaths) {
    const configFile = zip.file(path);
    if (configFile) {
      const content = await configFile.async('text');
      configFiles.push({ name: path, content });
    }
  }

  // Generate issues and suggestions
  if (!modelFile) {
    issues.push('No model file found in 3MF');
  }

  if (analysis.triangleCount === 0) {
    issues.push('No triangles found in model');
  }

  if (!analysis.hasMMUSegmentation && !analysis.hasPaintColor && !analysis.hasPidP1) {
    issues.push('No color attributes found on triangles (mmu_segmentation, paint_color, or pid/p1)');
    suggestions.push('Try using multi_volume export mode for maximum compatibility');
  }

  if (analysis.hasMMUSegmentation && analysis.uniqueSegmentationCount <= 1) {
    issues.push(`All triangles have the same mmu_segmentation value (${analysis.mmuSegmentationValues[0] || 'none'})`);
    suggestions.push('Check if color extraction is working correctly');
  }

  if (analysis.hasPaintColor && analysis.uniquePaintColorCount <= 1) {
    issues.push('All triangles have the same paint_color value');
  }

  if (analysis.hasMMUSegmentation && !analysis.hasSlic3rpeNamespace) {
    issues.push('Using mmu_segmentation but slic3rpe namespace is not declared');
  }

  if (analysis.hasMMUSegmentation && !analysis.hasMmPaintingVersion) {
    suggestions.push('Consider adding MmPaintingVersion metadata for better OrcaSlicer compatibility');
  }

  if (!analysis.hasBasematerials) {
    suggestions.push('No basematerials found - colors may not display in slicer');
  }

  if (analysis.objectCount > 1) {
    suggestions.push(`Found ${analysis.objectCount} separate objects - this may work better with multi-volume mode`);
  }

  return {
    files,
    modelFile,
    analysis,
    metadata,
    configFiles,
    issues,
    suggestions,
    rawModelXml,
  };
}

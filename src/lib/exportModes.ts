// Export modes for different slicer compatibility

export type ExportMode = 'mmu_segmentation' | 'paint_color' | 'multi_volume';

export interface ExportModeInfo {
  id: ExportMode;
  label: string;
  description: string;
  slicers: string[];
}

export const EXPORT_MODES: ExportModeInfo[] = [
  {
    id: 'mmu_segmentation',
    label: 'MMU Segmentation',
    description: 'Usa slic3rpe:mmu_segmentation (Prusa/Orca)',
    slicers: ['PrusaSlicer', 'OrcaSlicer'],
  },
  {
    id: 'paint_color',
    label: 'Paint Color',
    description: 'Usa paint_color + basematerials (Bambu)',
    slicers: ['Bambu Studio', 'OrcaSlicer'],
  },
  {
    id: 'multi_volume',
    label: 'Multi-Volume',
    description: 'Um volume separado por cor (universal)',
    slicers: ['Todos os slicers'],
  },
];

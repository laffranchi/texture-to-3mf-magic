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
    id: 'paint_color',
    label: 'Paint Color (Recomendado)',
    description: 'Formato paint_color do OrcaSlicer - cores por face',
    slicers: ['OrcaSlicer', 'PrusaSlicer', 'Bambu Studio'],
  },
  {
    id: 'mmu_segmentation',
    label: 'MMU Segmentation',
    description: 'Mesmo formato paint_color (compatibilidade)',
    slicers: ['OrcaSlicer', 'PrusaSlicer'],
  },
  {
    id: 'multi_volume',
    label: 'Multi-Volume',
    description: 'Um objeto separado por cor (mais compatível)',
    slicers: ['Todos os slicers'],
  },
];

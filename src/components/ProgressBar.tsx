import { ProcessingProgress } from '@/lib/meshProcessor';
import { Progress } from '@/components/ui/progress';
import { Loader2, Scissors, Palette, Layers, Box } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  progress: ProcessingProgress;
  className?: string;
}

const STAGE_ICONS = {
  subdividing: Scissors,
  sampling: Palette,
  quantizing: Palette,
  grouping: Layers,
  building: Box,
};

const STAGE_LABELS = {
  subdividing: 'Subdivisão',
  sampling: 'Amostragem',
  quantizing: 'Quantização',
  grouping: 'Agrupamento',
  building: 'Construção',
};

export function ProgressBar({ progress, className }: ProgressBarProps) {
  const Icon = STAGE_ICONS[progress.stage];
  
  return (
    <div className={cn("space-y-3 p-4 bg-secondary/50 rounded-lg border border-border", className)}>
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20">
          <Icon className="w-4 h-4 text-primary animate-pulse" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-foreground">
              {STAGE_LABELS[progress.stage]}
            </span>
            <span className="text-sm font-mono text-muted-foreground">
              {Math.round(progress.progress)}%
            </span>
          </div>
          <Progress value={progress.progress} className="h-2" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        {progress.message}
      </p>
    </div>
  );
}

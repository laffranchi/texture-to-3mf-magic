import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  message?: string;
  progress?: number;
  className?: string;
}

export function ProgressBar({ message, progress = 0, className }: ProgressBarProps) {
  return (
    <div className={cn('space-y-3 p-4 bg-secondary/50 rounded-lg border border-border', className)}>
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-foreground">Processando</span>
            {progress > 0 && (
              <span className="text-sm font-mono text-muted-foreground">{Math.round(progress)}%</span>
            )}
          </div>
          {progress > 0 && <Progress value={progress} className="h-2" />}
        </div>
      </div>
      {message && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          {message}
        </p>
      )}
    </div>
  );
}

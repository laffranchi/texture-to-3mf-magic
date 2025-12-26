import { ExportMode, EXPORT_MODES } from '@/lib/exportModes';
import { cn } from '@/lib/utils';

interface ExportModeSelectorProps {
  value: ExportMode;
  onChange: (mode: ExportMode) => void;
  disabled?: boolean;
}

export function ExportModeSelector({ value, onChange, disabled }: ExportModeSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">Modo de Export:</label>
      <div className="grid grid-cols-1 gap-2">
        {EXPORT_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onChange(mode.id)}
            disabled={disabled}
            className={cn(
              "p-2 rounded-md text-left transition-all border",
              "hover:border-primary/50",
              value === mode.id
                ? "bg-primary/20 border-primary text-foreground"
                : "bg-secondary/50 border-border text-muted-foreground"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{mode.label}</span>
              <span className="text-xs text-muted-foreground">
                {mode.slicers.join(', ')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

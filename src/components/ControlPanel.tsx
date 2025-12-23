import { DetailLevel, getEstimatedTriangleCount } from '@/lib/meshProcessor';
import { RGB, rgbToHex } from '@/lib/colorQuantization';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { 
  Download, 
  Loader2, 
  Triangle, 
  Palette,
  Settings2,
  Eye,
  EyeOff
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DETAIL_OPTIONS: { value: DetailLevel; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'Otimizado automaticamente' },
  { value: 'low', label: 'Baixo', description: '~100k triângulos' },
  { value: 'medium', label: 'Médio', description: '~300k triângulos' },
  { value: 'high', label: 'Alto', description: '~500k triângulos' },
];

interface ControlPanelProps {
  // Model info
  originalTriangles: number;
  
  // Detail level
  detailLevel: DetailLevel;
  onDetailLevelChange: (level: DetailLevel) => void;
  
  // Colors
  numColors: number;
  onNumColorsChange: (num: number) => void;
  
  // Processing state
  isProcessing: boolean;
  isProcessed: boolean;
  onProcess: () => void;
  
  // Preview toggle
  showProcessed: boolean;
  onTogglePreview: () => void;
  
  // Export
  onExport: () => void;
  
  // Results
  colorStats?: { color: RGB; count: number; percentage: number }[];
  processedTriangles?: number;
  
  // Safety
  estimatedTriangles?: number;
  exceedsLimit?: boolean;
}

export function ControlPanel({
  originalTriangles,
  detailLevel,
  onDetailLevelChange,
  numColors,
  onNumColorsChange,
  isProcessing,
  isProcessed,
  onProcess,
  showProcessed,
  onTogglePreview,
  onExport,
  colorStats,
  processedTriangles,
  estimatedTriangles: propEstimatedTriangles,
  exceedsLimit = false,
}: ControlPanelProps) {
  const estimatedTriangles = propEstimatedTriangles ?? getEstimatedTriangleCount(originalTriangles, detailLevel);
  const willSimplify = originalTriangles > estimatedTriangles;
  const willSubdivide = originalTriangles < 100000 && detailLevel !== 'low';

  return (
    <div className="space-y-6 p-6 bg-card rounded-lg border border-border">
      {/* Model Info */}
      <div className="pb-4 border-b border-border">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Modelo</h3>
        <div className="flex items-center gap-2 text-foreground">
          <Triangle className="w-4 h-4 text-primary" />
          <span className="font-mono text-sm">
            {originalTriangles.toLocaleString()} triângulos
          </span>
        </div>
      </div>

      {/* Detail Level */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Nível de Detalhe</h3>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {DETAIL_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onDetailLevelChange(option.value)}
              disabled={isProcessing}
              className={cn(
                "px-3 py-2 rounded-md text-sm transition-all",
                "border border-border hover:border-primary/50",
                detailLevel === option.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className={cn(
          "mt-2 text-xs",
          exceedsLimit ? "text-destructive" : "text-muted-foreground"
        )}>
          {willSimplify && <span className="text-amber-500">Simplificará: </span>}
          {willSubdivide && <span className="text-green-500">Subdividirá: </span>}
          {!willSimplify && !willSubdivide && "Estimativa: "}
          <span className={cn("font-mono", exceedsLimit ? "text-destructive" : "text-foreground")}>
            {estimatedTriangles.toLocaleString()}
          </span> triângulos
          {exceedsLimit && " (limite excedido!)"}
        </p>
      </div>

      {/* Number of Colors */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Cores</h3>
          </div>
          <span className="font-mono text-lg text-primary">{numColors}</span>
        </div>
        <Slider
          value={[numColors]}
          onValueChange={([value]) => onNumColorsChange(value)}
          min={2}
          max={16}
          step={1}
          disabled={isProcessing}
          className="py-2"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>2</span>
          <span>16</span>
        </div>
      </div>

      {/* Process Button */}
      <Button
        onClick={onProcess}
        disabled={isProcessing || exceedsLimit}
        className="w-full"
        size="lg"
        variant={exceedsLimit ? "destructive" : "default"}
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Processando...
          </>
        ) : exceedsLimit ? (
          'Limite Excedido'
        ) : (
          'Processar Cores'
        )}
      </Button>

      {/* Results */}
      {isProcessed && colorStats && (
        <div className="space-y-4 pt-4 border-t border-border animate-slide-up">
          {/* Toggle Preview */}
          <Button
            variant="outline"
            onClick={onTogglePreview}
            className="w-full"
          >
            {showProcessed ? (
              <>
                <EyeOff className="w-4 h-4 mr-2" />
                Ver Original
              </>
            ) : (
              <>
                <Eye className="w-4 h-4 mr-2" />
                Ver Processado
              </>
            )}
          </Button>

          {/* Triangle Count */}
          {processedTriangles && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Triângulos finais:</span>
              <span className="font-mono text-foreground">
                {processedTriangles.toLocaleString()}
              </span>
            </div>
          )}

          {/* Color Palette */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">Paleta de Cores</h4>
            <div className="space-y-2">
              {colorStats.map((stat, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-2 bg-secondary/50 rounded-md"
                >
                  <div
                    className="w-8 h-8 rounded-md border border-border shadow-sm"
                    style={{ backgroundColor: rgbToHex(stat.color) }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs text-muted-foreground">
                        {rgbToHex(stat.color).toUpperCase()}
                      </span>
                      <span className="text-sm text-foreground">
                        {stat.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${stat.percentage}%`,
                          backgroundColor: rgbToHex(stat.color),
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Export Button */}
          <Button
            onClick={onExport}
            className="w-full glow-primary"
            size="lg"
          >
            <Download className="w-4 h-4 mr-2" />
            Exportar 3MF
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            {colorStats.length} meshes separadas para AMS
          </p>
        </div>
      )}
    </div>
  );
}

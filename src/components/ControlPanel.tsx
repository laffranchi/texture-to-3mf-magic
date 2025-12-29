import { PaletteColor } from '@/lib/api';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { 
  Download, 
  Loader2, 
  Triangle, 
  Palette,
} from 'lucide-react';

interface ControlPanelProps {
  originalTriangles: number;
  numColors: number;
  onNumColorsChange: (num: number) => void;
  isProcessing: boolean;
  isProcessed: boolean;
  onProcess: () => void;
  onDownload: () => void;
  palette?: PaletteColor[];
  processingMessage?: string;
}

export function ControlPanel({
  originalTriangles,
  numColors,
  onNumColorsChange,
  isProcessing,
  isProcessed,
  onProcess,
  onDownload,
  palette,
  processingMessage,
}: ControlPanelProps) {
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
        disabled={isProcessing}
        className="w-full"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {processingMessage || 'Processando...'}
          </>
        ) : (
          'Processar Cores'
        )}
      </Button>

      {/* Processing message */}
      {isProcessing && processingMessage && (
        <p className="text-xs text-center text-muted-foreground animate-pulse">
          O servidor pode demorar alguns segundos na primeira requisição
        </p>
      )}

      {/* Results */}
      {isProcessed && palette && palette.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-border animate-slide-up">
          {/* Color Palette */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">Paleta de Cores</h4>
            <div className="space-y-2">
              {palette.map((color, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-2 bg-secondary/50 rounded-md"
                >
                  <div
                    className="w-8 h-8 rounded-md border border-border shadow-sm"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-foreground">
                        {color.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {color.hex.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      RGB({color.rgb})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Download Button */}
          <Button
            onClick={onDownload}
            className="w-full glow-primary"
            size="lg"
          >
            <Download className="w-4 h-4 mr-2" />
            Baixar 3MF
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            {palette.length} cores extraídas
          </p>
        </div>
      )}
    </div>
  );
}

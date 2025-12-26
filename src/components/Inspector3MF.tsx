import { useState, useCallback } from 'react';
import { inspect3MF, Inspect3MFResult } from '@/lib/inspect3MF';
import { Button } from '@/components/ui/button';
import { 
  Upload, 
  FileSearch, 
  AlertCircle, 
  CheckCircle, 
  AlertTriangle,
  Copy,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Inspector3MFProps {
  onClose: () => void;
}

export function Inspector3MF({ onClose }: Inspector3MFProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<Inspect3MFResult | null>(null);
  const [showRawXml, setShowRawXml] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.3mf')) {
      toast.error('Por favor, selecione um arquivo .3mf');
      return;
    }

    setIsAnalyzing(true);
    try {
      const inspectResult = await inspect3MF(file);
      setResult(inspectResult);
      console.log('[Inspector3MF] Analysis result:', inspectResult);
    } catch (err) {
      toast.error('Erro ao analisar arquivo');
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copiado!');
  }, []);

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Inspector 3MF</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!result ? (
            // Upload area
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                isDragging ? "border-primary bg-primary/10" : "border-border",
                isAnalyzing && "opacity-50 pointer-events-none"
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-foreground mb-2">
                {isAnalyzing ? 'Analisando...' : 'Arraste um arquivo .3mf aqui'}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                ou clique para selecionar
              </p>
              <input
                type="file"
                accept=".3mf"
                onChange={handleFileSelect}
                className="hidden"
                id="inspector-file-input"
              />
              <Button asChild variant="outline">
                <label htmlFor="inspector-file-input" className="cursor-pointer">
                  Selecionar Arquivo
                </label>
              </Button>
            </div>
          ) : (
            // Analysis result
            <div className="space-y-6">
              {/* Status */}
              <div className={cn(
                "p-4 rounded-lg border",
                result.issues.length === 0 
                  ? "bg-green-500/10 border-green-500/30"
                  : "bg-amber-500/10 border-amber-500/30"
              )}>
                <div className="flex items-center gap-2 mb-2">
                  {result.issues.length === 0 ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <span className="font-medium text-green-500">Arquivo parece OK</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                      <span className="font-medium text-amber-500">
                        {result.issues.length} problema(s) encontrado(s)
                      </span>
                    </>
                  )}
                </div>
                
                {result.issues.length > 0 && (
                  <ul className="text-sm text-amber-400 space-y-1 ml-7">
                    {result.issues.map((issue, i) => (
                      <li key={i}>• {issue}</li>
                    ))}
                  </ul>
                )}
                
                {result.suggestions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Sugestões:</p>
                    <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                      {result.suggestions.map((suggestion, i) => (
                        <li key={i}>• {suggestion}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Analysis Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-secondary/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Triângulos</p>
                  <p className="text-xl font-mono text-foreground">
                    {result.analysis.triangleCount.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Vértices</p>
                  <p className="text-xl font-mono text-foreground">
                    {result.analysis.vertexCount.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Objetos</p>
                  <p className="text-xl font-mono text-foreground">
                    {result.analysis.objectCount}
                  </p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Model File</p>
                  <p className="text-sm font-mono text-foreground truncate">
                    {result.modelFile || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Attributes */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">Atributos Detectados</h3>
                <div className="space-y-2">
                  <AttributeRow 
                    label="slic3rpe:mmu_segmentation" 
                    present={result.analysis.hasMMUSegmentation}
                    values={result.analysis.mmuSegmentationValues}
                    uniqueCount={result.analysis.uniqueSegmentationCount}
                  />
                  <AttributeRow 
                    label="paint_color" 
                    present={result.analysis.hasPaintColor}
                    values={result.analysis.paintColorValues}
                    uniqueCount={result.analysis.uniquePaintColorCount}
                  />
                  <AttributeRow 
                    label="pid/p1 (basematerials)" 
                    present={result.analysis.hasPidP1}
                    values={result.analysis.pidP1Values}
                  />
                  <AttributeRow 
                    label="slic3rpe namespace" 
                    present={result.analysis.hasSlic3rpeNamespace}
                  />
                  <AttributeRow 
                    label="MmPaintingVersion" 
                    present={result.analysis.hasMmPaintingVersion}
                  />
                  <AttributeRow 
                    label="basematerials" 
                    present={result.analysis.hasBasematerials}
                  />
                </div>
              </div>

              {/* Files */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">Arquivos no 3MF</h3>
                <div className="bg-secondary/30 rounded-lg p-3 max-h-32 overflow-y-auto">
                  <ul className="text-xs font-mono text-muted-foreground space-y-1">
                    {result.files.map((file, i) => (
                      <li key={i}>{file}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Config Files */}
              {result.configFiles.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-3">Arquivos de Configuração</h3>
                  <div className="space-y-2">
                    {result.configFiles.map((cfg, i) => (
                      <div key={i} className="bg-secondary/30 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-mono text-primary">{cfg.name}</span>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => copyToClipboard(cfg.content)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap max-h-24 overflow-y-auto">
                          {cfg.content.slice(0, 500)}
                          {cfg.content.length > 500 && '...'}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw XML */}
              <div>
                <button
                  onClick={() => setShowRawXml(!showRawXml)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showRawXml ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Ver XML do modelo
                </button>
                
                {showRawXml && (
                  <div className="mt-2 bg-secondary/30 rounded-lg p-3 relative">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => copyToClipboard(result.rawModelXml)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto pr-8">
                      {result.rawModelXml.slice(0, 3000)}
                      {result.rawModelXml.length > 3000 && '\n... (truncated)'}
                    </pre>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setResult(null)}
                >
                  Analisar Outro
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => {
                    const report = JSON.stringify(result, null, 2);
                    copyToClipboard(report);
                  }}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copiar Relatório
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttributeRow({ 
  label, 
  present, 
  values,
  uniqueCount
}: { 
  label: string; 
  present: boolean;
  values?: string[];
  uniqueCount?: number;
}) {
  return (
    <div className="flex items-center justify-between p-2 bg-secondary/30 rounded">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {values && values.length > 0 && (
          <span className="text-xs font-mono text-muted-foreground">
            [{values.slice(0, 3).join(', ')}{values.length > 3 ? '...' : ''}]
            {uniqueCount && uniqueCount > 1 && (
              <span className="ml-1 text-primary">({uniqueCount} únicos)</span>
            )}
          </span>
        )}
        {present ? (
          <CheckCircle className="w-4 h-4 text-green-500" />
        ) : (
          <AlertCircle className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

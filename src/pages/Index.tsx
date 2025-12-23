import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { ModelViewer } from '@/components/ModelViewer';
import { ControlPanel } from '@/components/ControlPanel';
import { ProgressBar } from '@/components/ProgressBar';
import { useModelLoader } from '@/hooks/useModelLoader';
import { 
  processMeshAsync, 
  SubdivisionLevel, 
  ProcessingResult, 
  ProcessingProgress,
  getSubdivisionTriangleCount,
  TRIANGLE_LIMITS,
  estimateProcessingTime
} from '@/lib/meshProcessor';
import { export3MF, downloadBlob } from '@/lib/export3MF';
import { toast } from 'sonner';
import { AlertCircle, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Index() {
  const { model, loading, error, loadModel, clearModel } = useModelLoader();
  
  const [subdivisionLevel, setSubdivisionLevel] = useState<SubdivisionLevel>('none');
  const [numColors, setNumColors] = useState(4);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [processingResult, setProcessingResult] = useState<ProcessingResult | null>(null);
  const [showProcessed, setShowProcessed] = useState(false);

  // Calculate estimated triangles and warnings
  const estimatedTriangles = model ? getSubdivisionTriangleCount(model.triangleCount, subdivisionLevel) : 0;
  const showWarning = estimatedTriangles > TRIANGLE_LIMITS.WARNING;
  const exceedsLimit = estimatedTriangles > TRIANGLE_LIMITS.MAX;
  const estimatedTime = model ? estimateProcessingTime(model.triangleCount, subdivisionLevel) : 0;

  const handleProcess = useCallback(async () => {
    if (!model) return;

    if (exceedsLimit) {
      toast.error(`Limite excedido! Máximo: ${TRIANGLE_LIMITS.MAX.toLocaleString()} triângulos. Reduza a subdivisão.`);
      return;
    }

    setIsProcessing(true);
    setShowProcessed(false);
    setProcessingProgress({ stage: 'subdividing', progress: 0, message: 'Iniciando...' });
    
    try {
      const result = await processMeshAsync(
        model.geometry,
        model.texture,
        subdivisionLevel,
        numColors,
        setProcessingProgress
      );
      
      setProcessingResult(result);
      setShowProcessed(true);
      toast.success(`Processado! ${result.meshes.length} meshes criadas.`);
    } catch (err) {
      toast.error('Erro ao processar modelo');
      console.error(err);
    } finally {
      setIsProcessing(false);
      setProcessingProgress(null);
    }
  }, [model, subdivisionLevel, numColors, exceedsLimit]);

  const handleExport = useCallback(async () => {
    if (!processingResult || !model) return;

    try {
      const blob = await export3MF(processingResult.meshes, model.name);
      downloadBlob(blob, `${model.name}_multi-material.3mf`);
      toast.success('3MF exportado com sucesso!');
    } catch (err) {
      toast.error('Erro ao exportar 3MF');
      console.error(err);
    }
  }, [processingResult, model]);

  const handleReset = useCallback(() => {
    clearModel();
    setProcessingResult(null);
    setShowProcessed(false);
  }, [clearModel]);

  return (
    <div className="min-h-screen bg-background dark">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        {!model ? (
          // Upload State
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-foreground mb-2">
                Converta Texturas 3D para Multi-Material
              </h2>
              <p className="text-muted-foreground">
                Carregue um modelo GLB ou OBJ texturizado e exporte um 3MF com meshes separadas por cor,
                pronto para impressão colorida no AMS/Bambu Studio/OrcaSlicer.
              </p>
            </div>

            <FileUpload 
              onFilesSelected={loadModel} 
              loading={loading}
            />

            {error && (
              <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Erro ao carregar</p>
                  <p className="text-sm text-destructive/80">{error}</p>
                </div>
              </div>
            )}

            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 bg-card rounded-lg border border-border">
                <div className="text-2xl mb-2">📤</div>
                <h3 className="font-medium text-foreground">1. Upload</h3>
                <p className="text-sm text-muted-foreground">
                  Carregue GLB ou OBJ com textura
                </p>
              </div>
              <div className="p-4 bg-card rounded-lg border border-border">
                <div className="text-2xl mb-2">🎨</div>
                <h3 className="font-medium text-foreground">2. Configure</h3>
                <p className="text-sm text-muted-foreground">
                  Escolha subdivisão e quantidade de cores
                </p>
              </div>
              <div className="p-4 bg-card rounded-lg border border-border">
                <div className="text-2xl mb-2">📦</div>
                <h3 className="font-medium text-foreground">3. Exporte</h3>
                <p className="text-sm text-muted-foreground">
                  Baixe 3MF com meshes separadas por cor
                </p>
              </div>
            </div>
          </div>
        ) : (
          // Editor State
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
            {/* 3D Viewer */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Novo modelo
                </Button>
                <span className="text-sm text-muted-foreground">
                  {model.name}
                </span>
              </div>
              
              <div className="aspect-[4/3] lg:aspect-[16/10] rounded-lg overflow-hidden border border-border viewer-gradient">
                <ModelViewer
                  originalObject={model.originalObject}
                  processedMeshes={processingResult?.meshes}
                  showProcessed={showProcessed}
                  className="w-full h-full"
                />
              </div>

              {/* Processing Progress */}
              {isProcessing && processingProgress && (
                <ProgressBar progress={processingProgress} />
              )}

              {/* Warning for high triangle count */}
              {!isProcessing && showWarning && (
                <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-warning">
                      {exceedsLimit ? 'Limite excedido!' : 'Alto número de triângulos'}
                    </p>
                    <p className="text-xs text-warning/80">
                      {exceedsLimit 
                        ? `Máximo: ${TRIANGLE_LIMITS.MAX.toLocaleString()}. Reduza a subdivisão.`
                        : `Estimativa: ${estimatedTriangles.toLocaleString()} triângulos (~${estimatedTime}s)`
                      }
                    </p>
                  </div>
                </div>
              )}

              {showProcessed && processingResult && (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className="px-3 py-1 bg-primary/20 text-primary rounded-full">
                    Visualizando: Modelo Processado
                  </span>
                </div>
              )}
            </div>

            {/* Control Panel */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <ControlPanel
                originalTriangles={model.triangleCount}
                subdivisionLevel={subdivisionLevel}
                onSubdivisionChange={setSubdivisionLevel}
                numColors={numColors}
                onNumColorsChange={setNumColors}
                isProcessing={isProcessing}
                isProcessed={!!processingResult}
                onProcess={handleProcess}
                showProcessed={showProcessed}
                onTogglePreview={() => setShowProcessed(!showProcessed)}
                onExport={handleExport}
                colorStats={processingResult?.colorStats}
                processedTriangles={processingResult?.processedTriangles}
                estimatedTriangles={estimatedTriangles}
                exceedsLimit={exceedsLimit}
              />
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border mt-12 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Processamento 100% local no navegador • Seus arquivos não são enviados</p>
        </div>
      </footer>
    </div>
  );
}

import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { ModelViewer } from '@/components/ModelViewer';
import { ControlPanel } from '@/components/ControlPanel';
import { useModelLoader } from '@/hooks/useModelLoader';
import { processMesh, SubdivisionLevel, ProcessingResult } from '@/lib/meshProcessor';
import { export3MF, downloadBlob } from '@/lib/export3MF';
import { toast } from 'sonner';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Index() {
  const { model, loading, error, loadModel, clearModel } = useModelLoader();
  
  const [subdivisionLevel, setSubdivisionLevel] = useState<SubdivisionLevel>('none');
  const [numColors, setNumColors] = useState(4);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingResult, setProcessingResult] = useState<ProcessingResult | null>(null);
  const [showProcessed, setShowProcessed] = useState(false);

  const handleProcess = useCallback(async () => {
    if (!model) return;

    setIsProcessing(true);
    setShowProcessed(false);
    
    try {
      // Use setTimeout to allow UI to update
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const result = processMesh(
        model.geometry,
        model.texture,
        subdivisionLevel,
        numColors
      );
      
      setProcessingResult(result);
      setShowProcessed(true);
      toast.success(`Processado! ${result.meshes.length} meshes criadas.`);
    } catch (err) {
      toast.error('Erro ao processar modelo');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  }, [model, subdivisionLevel, numColors]);

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

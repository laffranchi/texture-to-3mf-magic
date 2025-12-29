import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { ModelViewer } from '@/components/ModelViewer';
import { ControlPanel } from '@/components/ControlPanel';
import { Inspector3MF } from '@/components/Inspector3MF';
import { useModelLoader } from '@/hooks/useModelLoader';
import { convertModel, downloadBase64File, PaletteColor } from '@/lib/api';
import { toast } from 'sonner';
import { AlertCircle, ArrowLeft, Info, FileSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Index() {
  const { model, loading, error, loadModel, clearModel } = useModelLoader();
  
  const [numColors, setNumColors] = useState(4);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [palette, setPalette] = useState<PaletteColor[] | null>(null);
  const [file3MF, setFile3MF] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  const handleProcess = useCallback(async () => {
    if (!model?.rawFile) return;

    setIsProcessing(true);
    setProcessingMessage('Enviando para processamento...');
    setPalette(null);
    setFile3MF(null);
    setFilename(null);
    
    try {
      const result = await convertModel(
        model.rawFile,
        numColors,
        setProcessingMessage
      );
      
      setPalette(result.palette);
      setFile3MF(result.file_base64);
      setFilename(result.filename);
      toast.success(`Processado! ${result.palette.length} cores extraídas.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao processar';
      toast.error(message);
      console.error('[API Error]', err);
    } finally {
      setIsProcessing(false);
      setProcessingMessage(null);
    }
  }, [model, numColors]);

  const handleDownload = useCallback(() => {
    if (!file3MF || !filename) return;
    
    try {
      downloadBase64File(file3MF, filename);
      toast.success('3MF baixado com sucesso!');
    } catch (err) {
      toast.error('Erro ao baixar arquivo');
      console.error('[Download Error]', err);
    }
  }, [file3MF, filename]);

  const handleReset = useCallback(() => {
    clearModel();
    setPalette(null);
    setFile3MF(null);
    setFilename(null);
  }, [clearModel]);

  return (
    <div className="min-h-screen bg-background dark">
      <Header />
      
      {/* Inspector Modal */}
      {showInspector && <Inspector3MF onClose={() => setShowInspector(false)} />}
      
      <main className="container mx-auto px-4 py-8">
        {!model ? (
          // Upload State
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-foreground mb-2">
                Converta Texturas 3D para Multi-Material
              </h2>
              <p className="text-muted-foreground">
                Carregue um modelo GLB texturizado e exporte um 3MF com meshes separadas por cor,
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
                  Carregue um arquivo GLB com textura
                </p>
              </div>
              <div className="p-4 bg-card rounded-lg border border-border">
                <div className="text-2xl mb-2">🎨</div>
                <h3 className="font-medium text-foreground">2. Configure</h3>
                <p className="text-sm text-muted-foreground">
                  Escolha a quantidade de cores (2-16)
                </p>
              </div>
              <div className="p-4 bg-card rounded-lg border border-border">
                <div className="text-2xl mb-2">📦</div>
                <h3 className="font-medium text-foreground">3. Baixe</h3>
                <p className="text-sm text-muted-foreground">
                  Receba o 3MF pronto para imprimir
                </p>
              </div>
            </div>
            
            {/* Inspector Button */}
            <div className="mt-8 text-center">
              <Button 
                variant="outline" 
                onClick={() => setShowInspector(true)}
                className="gap-2"
              >
                <FileSearch className="w-4 h-4" />
                Analisar arquivo 3MF existente
              </Button>
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
                  showProcessed={false}
                  className="w-full h-full"
                />
              </div>

              {/* Model Debug Info */}
              {model.debugInfo && (
                <div className="p-3 bg-muted/50 border border-border rounded-lg flex items-start gap-3">
                  <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>
                      <span className="font-medium">Meshes:</span> {model.debugInfo.meshCount} | 
                      <span className="font-medium ml-2">Materiais:</span> {model.debugInfo.materialCount} | 
                      <span className="font-medium ml-2">Texturas:</span> {model.debugInfo.texturedMaterials}
                      {model.debugInfo.hasVertexColors && <span className="ml-2 text-primary">• Vertex Colors</span>}
                    </p>
                  </div>
                </div>
              )}

              {/* Processing indicator */}
              {isProcessing && (
                <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-center">
                  <p className="text-sm text-primary animate-pulse">
                    {processingMessage || 'Processando...'}
                  </p>
                </div>
              )}

              {/* Success indicator */}
              {palette && palette.length > 0 && !isProcessing && (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className="px-3 py-1 bg-primary/20 text-primary rounded-full">
                    ✓ Modelo processado com {palette.length} cores
                  </span>
                </div>
              )}
            </div>

            {/* Control Panel */}
            <div className="lg:sticky lg:top-4 lg:self-start space-y-4">
              <ControlPanel
                originalTriangles={model.triangleCount}
                numColors={numColors}
                onNumColorsChange={setNumColors}
                isProcessing={isProcessing}
                isProcessed={!!palette && palette.length > 0}
                onProcess={handleProcess}
                onDownload={handleDownload}
                palette={palette || undefined}
                processingMessage={processingMessage || undefined}
              />
              
              {/* Inspector Button */}
              <Button 
                variant="outline" 
                onClick={() => setShowInspector(true)}
                className="w-full gap-2"
              >
                <FileSearch className="w-4 h-4" />
                Inspector 3MF
              </Button>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border mt-12 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Processamento seguro via API • Seus arquivos não são armazenados</p>
        </div>
      </footer>
    </div>
  );
}

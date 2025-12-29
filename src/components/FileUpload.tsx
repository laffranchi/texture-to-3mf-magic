import { useCallback, useState } from 'react';
import { Upload, File, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFilesSelected: (files: FileList | File[]) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function FileUpload({ onFilesSelected, loading, disabled }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (disabled) return;
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFiles(Array.from(files));
      onFilesSelected(files);
    }
  }, [disabled, onFilesSelected]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFiles(Array.from(files));
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const clearFiles = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-lg p-8 transition-all duration-200 cursor-pointer",
          "hover:border-primary/60 hover:bg-primary/5",
          isDragging && "border-primary bg-primary/10 scale-[1.02]",
          disabled && "opacity-50 cursor-not-allowed",
          loading && "animate-pulse",
          "border-border bg-card/50"
        )}
      >
        <input
          type="file"
          accept=".glb"
          onChange={handleFileInput}
          disabled={disabled || loading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        
        <div className="flex flex-col items-center gap-4 text-center">
          <div className={cn(
            "p-4 rounded-full transition-colors",
            isDragging ? "bg-primary/20" : "bg-secondary"
          )}>
            <Upload className={cn(
              "w-8 h-8 transition-colors",
              isDragging ? "text-primary" : "text-muted-foreground"
            )} />
          </div>
          
          <div>
            <p className="text-lg font-medium text-foreground">
              {loading ? 'Carregando modelo...' : 'Arraste seu modelo 3D aqui'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Apenas arquivos GLB
            </p>
          </div>
          
          <div className="flex gap-2 flex-wrap justify-center text-xs text-muted-foreground">
            <span className="px-2 py-1 bg-secondary rounded">.glb</span>
          </div>
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Arquivo selecionado:</span>
            <button
              onClick={clearFiles}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Limpar
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-md text-sm"
              >
                <File className="w-4 h-4 text-primary" />
                <span className="text-foreground">{file.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

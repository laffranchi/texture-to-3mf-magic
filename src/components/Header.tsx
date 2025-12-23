import { Boxes, Github } from 'lucide-react';

export function Header() {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Boxes className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                3D Texture Converter
              </h1>
              <p className="text-xs text-muted-foreground">
                Converta texturas 3D em multi-material para AMS
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-accent/20 text-accent rounded-full text-xs font-medium">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
              100% no navegador
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

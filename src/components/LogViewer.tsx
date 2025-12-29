import { useState, useEffect, useRef } from 'react';
import { logger, LogEntry, LogLevel } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { FileText, Copy, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const levelColors: Record<LogLevel, string> = {
  DEBUG: 'bg-muted text-muted-foreground',
  INFO: 'bg-blue-500/20 text-blue-400',
  WARN: 'bg-yellow-500/20 text-yellow-400',
  ERROR: 'bg-destructive/20 text-destructive',
};

interface LogEntryItemProps {
  entry: LogEntry;
}

function LogEntryItem({ entry }: LogEntryItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasData = entry.data && Object.keys(entry.data).length > 0;

  return (
    <div className="border-b border-border/50 py-2 px-3 text-sm font-mono">
      <div 
        className={`flex items-start gap-2 ${hasData ? 'cursor-pointer' : ''}`}
        onClick={() => hasData && setExpanded(!expanded)}
      >
        {hasData && (
          <span className="text-muted-foreground mt-0.5">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
        <span className="text-muted-foreground text-xs shrink-0">
          {entry.timestamp.toLocaleTimeString('pt-BR')}
        </span>
        <Badge variant="outline" className={`text-xs px-1.5 py-0 ${levelColors[entry.level]}`}>
          {entry.level}
        </Badge>
        <span className="text-primary/70 shrink-0">[{entry.context}]</span>
        <span className="text-foreground break-all">{entry.message}</span>
      </div>
      
      {expanded && hasData && (
        <pre className="mt-2 ml-6 p-2 bg-muted/50 rounded text-xs overflow-x-auto">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | 'ALL'>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load initial logs
    setLogs(logger.getLogs());

    // Subscribe to new logs
    const unsubscribe = logger.subscribe(() => {
      setLogs(logger.getLogs());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const filteredLogs = filter === 'ALL' 
    ? logs 
    : logs.filter(log => log.level === filter);

  const handleCopy = () => {
    navigator.clipboard.writeText(logger.getLogsAsText());
    toast({ title: 'Logs copiados!', description: `${logs.length} entradas copiadas para a área de transferência.` });
  };

  const handleClear = () => {
    logger.clear();
    setLogs([]);
  };

  const errorCount = logs.filter(l => l.level === 'ERROR').length;
  const warnCount = logs.filter(l => l.level === 'WARN').length;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="fixed bottom-4 right-4 z-50 gap-2 shadow-lg"
        >
          <FileText className="h-4 w-4" />
          Logs
          {errorCount > 0 && (
            <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs">
              {errorCount}
            </Badge>
          )}
          {warnCount > 0 && errorCount === 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs bg-yellow-500/20 text-yellow-400">
              {warnCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      
      <SheetContent className="w-[500px] sm:max-w-[600px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <span>Logs de Debug ({filteredLogs.length})</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClear}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="flex gap-1 py-2 flex-wrap">
          {(['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const).map((level) => (
            <Button
              key={level}
              variant={filter === level ? 'default' : 'ghost'}
              size="sm"
              className="text-xs h-7"
              onClick={() => setFilter(level)}
            >
              {level}
              {level !== 'ALL' && (
                <span className="ml-1 opacity-60">
                  ({logs.filter(l => l.level === level).length})
                </span>
              )}
            </Button>
          ))}
        </div>

        <ScrollArea className="flex-1 border rounded-md bg-background/50" ref={scrollRef}>
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Nenhum log ainda. Interaja com a aplicação para ver os logs.
            </div>
          ) : (
            filteredLogs.map(entry => (
              <LogEntryItem key={entry.id} entry={entry} />
            ))
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

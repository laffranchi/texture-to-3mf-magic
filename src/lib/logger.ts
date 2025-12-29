// Structured Logging System for API Debugging

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  data?: Record<string, unknown>;
}

type LogListener = (entry: LogEntry) => void;

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 200;
  private listeners: Set<LogListener> = new Set();

  private createEntry(
    level: LogLevel,
    context: string,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      context,
      message,
      data,
    };

    this.logs.push(entry);
    
    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Notify listeners
    this.listeners.forEach(listener => listener(entry));

    // Also log to console with styling
    this.consoleLog(entry);

    return entry;
  }

  private consoleLog(entry: LogEntry): void {
    const timestamp = entry.timestamp.toLocaleTimeString('pt-BR');
    const prefix = `[${timestamp}] [${entry.context}]`;
    
    const styles: Record<LogLevel, string> = {
      DEBUG: 'color: #888',
      INFO: 'color: #3b82f6',
      WARN: 'color: #f59e0b',
      ERROR: 'color: #ef4444; font-weight: bold',
    };

    console.groupCollapsed(`%c${prefix} ${entry.message}`, styles[entry.level]);
    if (entry.data) {
      console.table(entry.data);
    }
    console.groupEnd();
  }

  debug(context: string, message: string, data?: Record<string, unknown>): LogEntry {
    return this.createEntry('DEBUG', context, message, data);
  }

  info(context: string, message: string, data?: Record<string, unknown>): LogEntry {
    return this.createEntry('INFO', context, message, data);
  }

  warn(context: string, message: string, data?: Record<string, unknown>): LogEntry {
    return this.createEntry('WARN', context, message, data);
  }

  error(context: string, message: string, data?: Record<string, unknown>): LogEntry {
    return this.createEntry('ERROR', context, message, data);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsAsText(): string {
    return this.logs.map(entry => {
      const timestamp = entry.timestamp.toISOString();
      const dataStr = entry.data ? `\n${JSON.stringify(entry.data, null, 2)}` : '';
      return `[${timestamp}] ${entry.level} [${entry.context}] ${entry.message}${dataStr}`;
    }).join('\n\n');
  }

  clear(): void {
    this.logs = [];
    this.listeners.forEach(listener => listener({
      id: 'clear',
      timestamp: new Date(),
      level: 'INFO',
      context: 'Logger',
      message: 'Logs limpos',
    }));
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const logger = new Logger();

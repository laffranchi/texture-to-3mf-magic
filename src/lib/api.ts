// API Client for 3D Model Conversion with Detailed Logging

import { logger } from './logger';

export interface PaletteColor {
  name: string;
  rgb: string;  // "255,0,0"
  hex: string;  // "#FF0000"
}

export interface ConvertResponse {
  success: boolean;
  palette: PaletteColor[];
  file_base64: string;
  filename: string;
  error?: string;
}

export interface ApiHealthStatus {
  online: boolean;
  latency?: number;
  error?: string;
}

const API_BASE = 'https://api-conversor-3d.onrender.com';
const API_ENDPOINT = `${API_BASE}/convert`;
const API_TIMEOUT = 120000; // 2 minutos (cold start pode demorar)

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function classifyError(error: unknown): { type: string; message: string; suggestions: string[] } {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return {
        type: 'TIMEOUT',
        message: 'A requisição excedeu o tempo limite',
        suggestions: [
          'A API pode estar em cold start (aguarde 1-2 min e tente novamente)',
          'O arquivo pode ser muito grande para processar',
          'Verifique sua conexão com a internet'
        ]
      };
    }
    
    if (error.message === 'Failed to fetch') {
      return {
        type: 'NETWORK',
        message: 'Falha de conexão com o servidor',
        suggestions: [
          'A API pode estar offline ou em cold start',
          'Pode haver bloqueio de CORS no servidor',
          'Verifique sua conexão com a internet',
          'Aguarde alguns segundos e tente novamente'
        ]
      };
    }
  }
  
  return {
    type: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Erro desconhecido',
    suggestions: ['Tente novamente em alguns instantes']
  };
}

export async function checkApiHealth(): Promise<ApiHealthStatus> {
  const startTime = Date.now();
  
  logger.info('API', 'Verificando status da API...', { endpoint: API_BASE });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      logger.info('API', 'API online', { latency: `${latency}ms`, status: response.status });
      return { online: true, latency };
    } else {
      logger.warn('API', 'API respondeu com erro', { status: response.status, latency: `${latency}ms` });
      return { online: false, error: `Status ${response.status}` };
    }
  } catch (err) {
    const latency = Date.now() - startTime;
    const classified = classifyError(err);
    
    logger.error('API', 'Falha ao verificar status da API', {
      errorType: classified.type,
      message: classified.message,
      latency: `${latency}ms`,
      suggestions: classified.suggestions
    });
    
    return { online: false, error: classified.message };
  }
}

export async function convertModel(
  file: File, 
  colors: number,
  onProgress?: (message: string) => void
): Promise<ConvertResponse> {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  logger.info('API', 'Iniciando conversão', {
    requestId,
    fileName: file.name,
    fileSize: formatFileSize(file.size),
    fileSizeBytes: file.size,
    colors,
    endpoint: API_ENDPOINT
  });

  const formData = new FormData();
  formData.append('file', file);
  formData.append('colors', colors.toString());

  onProgress?.('Conectando ao servidor...');
  logger.debug('API', 'Enviando requisição...', { requestId });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.warn('API', 'Timeout atingido, abortando requisição', { 
      requestId, 
      timeoutMs: API_TIMEOUT 
    });
    controller.abort();
  }, API_TIMEOUT);

  try {
    onProgress?.('Enviando modelo para o servidor...');
    
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    logger.info('API', 'Resposta recebida', {
      requestId,
      status: response.status,
      statusText: response.statusText,
      responseTime: `${responseTime}ms`,
      contentType: response.headers.get('content-type')
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Erro desconhecido');
      
      logger.error('API', 'Servidor retornou erro', {
        requestId,
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText.substring(0, 500),
        responseTime: `${responseTime}ms`
      });
      
      throw new Error(`Erro na API (${response.status}): ${errorText}`);
    }

    onProgress?.('Processando resposta...');
    logger.debug('API', 'Parseando JSON da resposta...', { requestId });

    const data: ConvertResponse = await response.json();
    
    if (!data.success) {
      logger.error('API', 'API retornou success=false', {
        requestId,
        error: data.error,
        responseTime: `${responseTime}ms`
      });
      throw new Error(data.error || 'Erro desconhecido no processamento');
    }

    const totalTime = Date.now() - startTime;
    
    logger.info('API', 'Conversão concluída com sucesso!', {
      requestId,
      totalTime: `${totalTime}ms`,
      paletteColors: data.palette.length,
      outputFilename: data.filename,
      outputSizeBase64: formatFileSize(data.file_base64.length),
      palette: data.palette.map(c => ({ name: c.name, hex: c.hex }))
    });

    return data;
    
  } catch (err) {
    clearTimeout(timeoutId);
    const errorTime = Date.now() - startTime;
    const classified = classifyError(err);
    
    logger.error('API', 'Falha na conversão', {
      requestId,
      errorType: classified.type,
      message: classified.message,
      suggestions: classified.suggestions,
      timeBeforeError: `${errorTime}ms`,
      fileName: file.name,
      fileSize: formatFileSize(file.size),
      colors
    });
    
    // Re-throw com mensagem mais amigável
    throw new Error(`${classified.message}. ${classified.suggestions[0]}`);
  }
}

export function downloadBase64File(base64: string, filename: string): void {
  // Decode base64 to binary
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const blob = new Blob([bytes], { 
    type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' 
  });
  
  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// API Client for 3D Model Conversion

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

const API_ENDPOINT = 'https://api-conversor-3d.onrender.com/convert';

export async function convertModel(
  file: File, 
  colors: number,
  onProgress?: (message: string) => void
): Promise<ConvertResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('colors', colors.toString());

  onProgress?.('Enviando modelo para o servidor...');

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Erro desconhecido');
    throw new Error(`Erro na API (${response.status}): ${errorText}`);
  }

  onProgress?.('Processando resposta...');

  const data: ConvertResponse = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || 'Erro desconhecido no processamento');
  }

  return data;
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

// Color quantization using median cut algorithm

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorBucket {
  colors: RGB[];
  color: RGB;
}

function getColorRange(colors: RGB[]): { channel: 'r' | 'g' | 'b'; range: number } {
  let rMin = 255, rMax = 0;
  let gMin = 255, gMax = 0;
  let bMin = 255, bMax = 0;

  for (const c of colors) {
    rMin = Math.min(rMin, c.r);
    rMax = Math.max(rMax, c.r);
    gMin = Math.min(gMin, c.g);
    gMax = Math.max(gMax, c.g);
    bMin = Math.min(bMin, c.b);
    bMax = Math.max(bMax, c.b);
  }

  const rRange = rMax - rMin;
  const gRange = gMax - gMin;
  const bRange = bMax - bMin;

  if (rRange >= gRange && rRange >= bRange) return { channel: 'r', range: rRange };
  if (gRange >= rRange && gRange >= bRange) return { channel: 'g', range: gRange };
  return { channel: 'b', range: bRange };
}

function averageColor(colors: RGB[]): RGB {
  if (colors.length === 0) return { r: 0, g: 0, b: 0 };
  
  let r = 0, g = 0, b = 0;
  for (const c of colors) {
    r += c.r;
    g += c.g;
    b += c.b;
  }
  
  return {
    r: Math.round(r / colors.length),
    g: Math.round(g / colors.length),
    b: Math.round(b / colors.length),
  };
}

export function medianCut(colors: RGB[], numColors: number): RGB[] {
  if (colors.length === 0) return [];
  if (numColors <= 1) return [averageColor(colors)];

  let buckets: RGB[][] = [colors];

  while (buckets.length < numColors) {
    // Find the bucket with the largest range
    let maxRangeIdx = 0;
    let maxRange = 0;
    let splitChannel: 'r' | 'g' | 'b' = 'r';

    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      const { channel, range } = getColorRange(buckets[i]);
      if (range > maxRange) {
        maxRange = range;
        maxRangeIdx = i;
        splitChannel = channel;
      }
    }

    if (maxRange === 0) break;

    // Split the bucket
    const bucketToSplit = buckets[maxRangeIdx];
    bucketToSplit.sort((a, b) => a[splitChannel] - b[splitChannel]);
    
    const mid = Math.floor(bucketToSplit.length / 2);
    const bucket1 = bucketToSplit.slice(0, mid);
    const bucket2 = bucketToSplit.slice(mid);

    buckets.splice(maxRangeIdx, 1, bucket1, bucket2);
  }

  return buckets.map(averageColor);
}

export function findNearestColor(color: RGB, palette: RGB[]): number {
  let minDist = Infinity;
  let nearestIdx = 0;

  for (let i = 0; i < palette.length; i++) {
    const dist = 
      Math.pow(color.r - palette[i].r, 2) +
      Math.pow(color.g - palette[i].g, 2) +
      Math.pow(color.b - palette[i].b, 2);
    
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = i;
    }
  }

  return nearestIdx;
}

export function rgbToHex(color: RGB): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : { r: 0, g: 0, b: 0 };
}

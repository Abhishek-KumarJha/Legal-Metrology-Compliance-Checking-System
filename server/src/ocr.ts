import { createWorker, PSM } from 'tesseract.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import type { CheckResult, NumericReExtraction } from './ruleEngine.js';

const LEGIBILITY_THRESHOLDS = { sizeDifferenceRatio: 0.35, crampedGapRatio: -0.15, stretchedGapRatio: 2.5 };

export type OcrSymbol = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; fontName?: string; symbols: OcrSymbol[] };
export type OcrLine = { text: string; words: OcrWord[]; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number };
export type LegibilityAssessment = {
  fontSizeConsistent: boolean | null;
  fontSizeNote: string;
  spacingIssue: boolean | null;
  spacingNote: string;
  styleSignal: string;
  fontSizeMm?: number;
};

export type OcrAnalysis = {
  text: string;
  confidence: number | null;
  minimumWordHeightPx: number | null;
  typicalWordHeightPx: number | null;
  wordCount: number;
  words: OcrWord[];
  pages: OcrPage[];
};
export type ImageQuality = { resolution: 'GOOD' | 'FAIR' | 'POOR'; blur: 'GOOD' | 'FAIR' | 'POOR'; brightness: 'GOOD' | 'FAIR' | 'POOR'; contrast: 'GOOD' | 'FAIR' | 'POOR'; glare: 'GOOD' | 'FAIR' | 'POOR'; tiltAngleDeg: number | null; textHeightPx: number | null; overallQuality: 'GOOD' | 'FAIR' | 'POOR' | 'UNUSABLE'; note: string };
export type OcrPage = { text: string; lines: OcrLine[]; confidence: number | null; minimumWordHeightPx: number | null; typicalWordHeightPx: number | null; wordCount: number; words: OcrWord[]; width: number; height: number; imageQuality: ImageQuality };

export type NumericRegion = { x: number; y: number; width: number; height: number; coordinateWidth?: number; coordinateHeight?: number };

type PaddlePage = { path: string; texts: string[]; scores: number[]; boxes: number[][] };
let paddleWorker: ReturnType<typeof spawn> | null = null;
let paddleWorkerQueue = Promise.resolve();

function requestPaddleWorker(paths: string[]) {
  const request = paddleWorkerQueue.then(() => new Promise<PaddlePage[]>((resolve, reject) => {
    const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'paddle_ocr.py');
    const python = process.env.PADDLE_PYTHON ?? 'py';
    if (!paddleWorker || paddleWorker.killed) {
      const pythonArgs = process.platform === 'win32' ? ['-3.11', scriptPath, '--worker'] : [scriptPath, '--worker'];
      paddleWorker = spawn(python, pythonArgs, { env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' }, stdio: ['pipe', 'pipe', 'ignore'] });
      paddleWorker.once('error', (error) => { paddleWorker = null; reject(error); });
    }
    const worker = paddleWorker;
    const reader = createInterface({ input: worker.stdout! });
    const cleanup = () => reader.close();
    reader.once('line', (line) => { cleanup(); try { resolve(JSON.parse(line) as PaddlePage[]); } catch (error) { reject(error); } });
    worker.once('exit', () => { paddleWorker = null; cleanup(); reject(new Error('PaddleOCR worker exited')); });
    worker.stdin!.write(`${JSON.stringify(paths)}\n`);
  }));
  paddleWorkerQueue = request.then(() => undefined, () => undefined);
  return request;
}

async function analyzeWithPaddle(filePaths: string[]): Promise<OcrAnalysis> {
  const normalizedPaths = await Promise.all(filePaths.map(async (filePath) => {
    const normalizedPath = `${filePath}.paddle.png`;
    await fs.writeFile(normalizedPath, await sharp(filePath, { failOn: 'error' }).rotate().resize({ width: 1200, fit: 'inside', withoutEnlargement: true }).png().toBuffer());
    return normalizedPath;
  }));
  try {
    const paddlePages = await requestPaddleWorker(normalizedPaths);
  const pages: OcrPage[] = [];
  for (const paddlePage of paddlePages) {
    const metadata = await sharp(paddlePage.path, { failOn: 'error' }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const words = paddlePage.texts.map((text, index) => {
      const box = paddlePage.boxes[index] ?? [0, 0, 0, 0];
      return { text, confidence: Math.round((paddlePage.scores[index] ?? 0) * 100), bbox: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] }, symbols: [] };
    });
    const lines = reconstructOcrLines(words);
    const heights = words.map((word) => word.bbox.y1 - word.bbox.y0).filter((item) => item > 0).sort((left, right) => left - right);
    const image = await sharp(paddlePage.path, { failOn: 'error' }).rotate();
    const stats = await image.stats();
    const grayscale = await image.grayscale().raw().toBuffer({ resolveWithObject: true });
    const glareRatio = grayscale.data.reduce((count, value) => count + (value >= 245 ? 1 : 0), 0) / Math.max(1, grayscale.data.length);
    const confidence = words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : null;
    pages.push({ text: lines.map((line) => line.text).join('\n'), lines, confidence, minimumWordHeightPx: heights[0] ?? null, typicalWordHeightPx: heights.length ? heights[Math.floor(heights.length * 0.5)] : null, wordCount: words.length, words, width, height, imageQuality: assessImageQuality(width, height, stats, laplacianVariance(grayscale.data, grayscale.info.width, grayscale.info.height), glareRatio, null, heights.length ? heights[Math.floor(heights.length * 0.5)] : null) });
  }
  const allWords = pages.flatMap((page) => page.words);
  const heights = allWords.map((word) => word.bbox.y1 - word.bbox.y0).filter((item) => item > 0).sort((left, right) => left - right);
    return { text: pages.map((page) => page.text).join('\n'), confidence: allWords.length ? allWords.reduce((sum, word) => sum + word.confidence, 0) / allWords.length : null, minimumWordHeightPx: heights[0] ?? null, typicalWordHeightPx: heights.length ? heights[Math.floor(heights.length * 0.5)] : null, wordCount: allWords.length, words: allWords, pages };
  } finally {
    await Promise.all(normalizedPaths.map((normalizedPath) => fs.rm(normalizedPath, { force: true })));
  }
}

export function boundingBoxForValue(value: string | null, words: OcrWord[]) {
  if (!value) return undefined;
  const tokens = value.split(/[^a-z0-9]+/i).map(normalizedToken).filter(Boolean);
  const matches = words.filter((word) => tokens.some((token) => normalizedToken(word.text).includes(token) || token.includes(normalizedToken(word.text))));
  if (!matches.length) return undefined;
  const left = Math.min(...matches.map((word) => word.bbox.x0));
  const top = Math.min(...matches.map((word) => word.bbox.y0));
  const right = Math.max(...matches.map((word) => word.bbox.x1));
  const bottom = Math.max(...matches.map((word) => word.bbox.y1));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function fieldEvidenceForValue(value: string | null, words: OcrWord[]) {
  const matches = value ? wordsForValue(value, words) : [];
  if (!matches.length) return { confidence: null, boundingBox: undefined, tokens: [] as string[] };
  return {
    confidence: Math.round(matches.reduce((sum, word) => sum + word.confidence, 0) / matches.length),
    boundingBox: boundingBoxForValue(value, matches),
    tokens: matches.map((word) => word.text)
  };
}

function isMeaningfulOcrWord(word: OcrWord) {
  const normalized = word.text.replace(/[^\p{L}\p{N}@+₹./-]/gu, '');
  if (!normalized || word.confidence < 20) return false;
  if (/^[^\p{L}\p{N}]+$/u.test(normalized)) return false;
  if (/^[|>*_=~`^]+$/.test(normalized)) return false;
  if (/^(.)\1{2,}$/.test(normalized)) return false;
  return normalized.length >= 2 || /\d/.test(normalized) || /^[gGlL]$/.test(normalized);
}

export function reconstructOcrLines(words: OcrWord[]) {
  const meaningful = words.filter(isMeaningfulOcrWord).sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
  const lines: OcrLine[] = [];
  for (const word of meaningful) {
    const height = word.bbox.y1 - word.bbox.y0;
    const line = lines.find((candidate) => Math.abs(((candidate.bbox.y0 + candidate.bbox.y1) / 2) - ((word.bbox.y0 + word.bbox.y1) / 2)) <= Math.max(height, candidate.bbox.y1 - candidate.bbox.y0) * 0.55);
    if (line) {
      line.words.push(word);
      line.bbox = { x0: Math.min(line.bbox.x0, word.bbox.x0), y0: Math.min(line.bbox.y0, word.bbox.y0), x1: Math.max(line.bbox.x1, word.bbox.x1), y1: Math.max(line.bbox.y1, word.bbox.y1) };
      line.confidence = line.words.reduce((sum, item) => sum + item.confidence, 0) / line.words.length;
    } else lines.push({ text: word.text, words: [word], bbox: { ...word.bbox }, confidence: word.confidence });
  }
  return lines.sort((left, right) => left.bbox.y0 - right.bbox.y0).map((line) => ({ ...line, words: line.words.sort((left, right) => left.bbox.x0 - right.bbox.x0), text: line.words.map((word) => word.text).join(' ') }));
}

export function selectDeclarationLines(lines: OcrLine[]) {
  const declarationTerms = /\b(?:mrp|maximum|retail|net|qty|quantity|weight|mfd|mfg|manufactur|packed|packer|marketed|import|consumer|customer|care|helpline|toll|contact|best|before|expiry|exp|pkd)\b|₹|rs\.?|inr|\b(?:1800|[6-9]\d{2})[\s-\d]{7,}/i;
  const nutritionTerms = /\b(?:nutrition|calories?|protein|carbohydrate|fat|sodium|serving|daily value|sugars?)\b/i;
  return lines.filter((line) => {
    const text = line.text.trim();
    if (!text || text.length < 2) return false;
    if (nutritionTerms.test(text) && !declarationTerms.test(text)) return false;
    const digitRun = text.replace(/\D/g, '');
    if (digitRun.length >= 10 && !declarationTerms.test(text)) return false;
    const meaningful = text.replace(/[^\p{L}\p{N}₹@.+/-]/gu, '');
    return meaningful.length >= 3 && (declarationTerms.test(text) || /\d+\s*(?:kg|g|gm|ml|l|litre)\b/i.test(text));
  });
}

function assessImageQuality(width: number, height: number, stats: { channels: Array<{ mean: number; stdev: number }> }, blurVariance: number, glareRatio: number, tiltAngleDeg: number | null, textHeightPx: number | null): ImageQuality {
  const resolution = width >= 1000 && height >= 700 ? 'GOOD' : width >= 700 && height >= 450 ? 'FAIR' : 'POOR';
  const brightness = stats.channels.reduce((sum, channel) => sum + channel.mean, 0) / Math.max(1, stats.channels.length);
  const deviation = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, stats.channels.length);
  const brightnessGrade = brightness < 35 || brightness > 235 ? 'POOR' : brightness < 55 || brightness > 210 ? 'FAIR' : 'GOOD';
  const contrast = deviation < 18 ? 'POOR' : deviation < 30 ? 'FAIR' : 'GOOD';
  const blur = blurVariance < 20 ? 'POOR' : blurVariance < 80 ? 'FAIR' : 'GOOD';
  const glare = glareRatio > 0.12 ? 'POOR' : glareRatio > 0.04 ? 'FAIR' : 'GOOD';
  const tiltPoor = tiltAngleDeg !== null && Math.abs(tiltAngleDeg) > 12;
  const overallQuality = resolution === 'POOR' || blur === 'POOR' || brightnessGrade === 'POOR' && contrast === 'POOR' ? 'UNUSABLE' : resolution === 'GOOD' && blur === 'GOOD' && brightnessGrade === 'GOOD' && contrast === 'GOOD' && glare === 'GOOD' && !tiltPoor ? 'GOOD' : 'FAIR';
  return { resolution, blur, brightness: brightnessGrade, contrast, glare, tiltAngleDeg, textHeightPx, overallQuality, note: overallQuality === 'UNUSABLE' ? 'Resolution, blur, brightness, glare, or blur prevents reliable inspection.' : 'Image metrics include blur, glare, tilt, contrast, and recognized text height.' };
}

function estimateTextTilt(words: OcrWord[]) {
  const angles = words.flatMap((word) => {
    const symbols = word.symbols.filter((symbol) => symbol.text.trim());
    if (symbols.length < 2) return [];
    const first = symbols[0].bbox;
    const last = symbols[symbols.length - 1].bbox;
    return [Math.atan2(((last.y0 + last.y1) - (first.y0 + first.y1)) / 2, ((last.x0 + last.x1) - (first.x0 + first.x1)) / 2) * 180 / Math.PI];
  }).filter((angle) => Number.isFinite(angle));
  return angles.length ? angles.sort((left, right) => left - right)[Math.floor(angles.length / 2)] : null;
}

function laplacianVariance(data: Buffer, width: number, height: number) {
  if (width < 3 || height < 3) return 0;
  let count = 0;
  let sum = 0;
  let sumSquares = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 500));
  for (let y = 1; y < height - 1; y += step) for (let x = 1; x < width - 1; x += step) {
    const center = data[y * width + x];
    const value = 4 * center - data[(y - 1) * width + x] - data[(y + 1) * width + x] - data[y * width + x - 1] - data[y * width + x + 1];
    sum += value;
    sumSquares += value * value;
    count += 1;
  }
  const mean = sum / Math.max(1, count);
  return sumSquares / Math.max(1, count) - mean * mean;
}

export function assessReadability(analysis: Pick<OcrAnalysis, 'confidence' | 'minimumWordHeightPx'> & { typicalWordHeightPx?: number | null }, confidenceThreshold = 60) {
  const confidenceOk = analysis.confidence === null || analysis.confidence > confidenceThreshold;
  const height = analysis.typicalWordHeightPx ?? analysis.minimumWordHeightPx;
  const heightOk = height === null || height >= 8;
  return {
    confidenceOk,
    heightOk,
    readable: confidenceOk && heightOk,
    note: !confidenceOk ? 'OCR confidence is below the readability threshold' : !heightOk ? 'Some recognized text is too small for reliable OCR' : 'OCR confidence and recognized text height are readable'
  };
}

export function validateScaleMmPerPixel(value: number | undefined) {
  if (value === undefined) return { value: undefined, valid: true };
  return value >= 0.001 && value <= 0.5 ? { value, valid: true } : { value, valid: false };
}

function numericRead(fieldName: string, text: string, initialRead?: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const withinExpectedDigitGrowth = (value: string | null) => {
    if (!value || !initialRead) return value;
    const initialDigits = (initialRead.match(/\d/g) ?? []).length;
    const candidateDigits = (value.match(/\d/g) ?? []).length;
    return candidateDigits <= initialDigits + 1 ? value : null;
  };
  if (fieldName === 'mrp') {
    const match = normalized.match(/\d+(?:[.,-]\s*\d{1,2})?/);
    return withinExpectedDigitGrowth(match?.[0].replace(/\s+/g, '').replace(',', '.').replace(/(\d+)-(?=\d{1,2}$)/, '$1.') ?? null);
  }
  if (fieldName === 'netQuantity') {
    const match = normalized.match(/(?:\d+\s*[xX]\s*)?\d+(?:[.,-]\s*\d+)?\s*(?:kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?|pairs?|sheets?)?\b/i);
    if (!match) return null;
    const value = match[0].replace(/\s+/g, ' ').replace(',', '.').replace(/(\d+)-(?=\d{1,2}\s)/, '$1.').trim();
    const unit = value.match(/(?:kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?|pairs?|sheets?)$/i)?.[0] ?? initialRead?.match(/(?:kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?|pairs?|sheets?)\b/i)?.[0];
    return withinExpectedDigitGrowth(unit && !new RegExp(`(?:kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?|pairs?|sheets?)$`, 'i').test(value) ? `${value} ${unit}` : value);
  }
  return withinExpectedDigitGrowth(normalized.match(/\d+(?:[./-]\d+)+/)?.[0] ?? null);
}

type NumericCropResult = { buffer: Buffer; x: number; y: number; width: number; height: number };

function expandedNumericRegion(region: NumericRegion, factor: number): NumericRegion {
  const coordinateWidth = region.coordinateWidth ?? region.x + region.width;
  const coordinateHeight = region.coordinateHeight ?? region.y + region.height;
  const width = Math.min(coordinateWidth, region.width * factor);
  const height = Math.min(coordinateHeight, region.height * factor);
  return {
    x: Math.max(0, Math.min(coordinateWidth - width, region.x - (width - region.width) / 2)),
    y: Math.max(0, Math.min(coordinateHeight - height, region.y - (height - region.height) / 2)),
    width,
    height,
    coordinateWidth,
    coordinateHeight
  };
}

async function numericCrop(filePath: string, region: NumericRegion, mode: 'normalized' | 'threshold' | 'high-threshold'): Promise<NumericCropResult | null> {
  const source = await fs.readFile(filePath);
  const oriented = await sharp(source, { failOn: 'error' }).rotate().toBuffer();
  const metadata = await sharp(oriented, { failOn: 'error' }).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (!sourceWidth || !sourceHeight) return null;
  const scaleX = sourceWidth / Math.max(1, region.coordinateWidth ?? sourceWidth);
  const scaleY = sourceHeight / Math.max(1, region.coordinateHeight ?? sourceHeight);
  const scale = Math.max(scaleX, scaleY);
  const padding = Math.max(2, Math.ceil(2 * scale));
  const left = Math.max(0, Math.floor(region.x * scale - padding));
  const top = Math.max(0, Math.floor(region.y * scale - padding));
  const width = Math.min(sourceWidth - left, Math.max(1, Math.ceil(region.width * scale + padding * 2)));
  const height = Math.min(sourceHeight - top, Math.max(1, Math.ceil(region.height * scale + padding * 2)));
  let pipeline = sharp(oriented, { failOn: 'error' }).extract({ left, top, width, height }).grayscale().resize({ width: Math.max(1, width * 4), height: Math.max(1, height * 4), fit: 'fill', kernel: sharp.kernel.lanczos3 });
  pipeline = mode === 'normalized' ? pipeline.normalize().sharpen() : pipeline.normalize().threshold(mode === 'high-threshold' ? 200 : 160);
  return { buffer: await pipeline.png().toBuffer(), x: left, y: top, width, height };
}

export async function reextractNumericRegion(filePath: string, region: NumericRegion, fieldName: string, initialRead: string): Promise<NumericReExtraction> {
  const worker = await createWorker('eng');
  const candidateReads: string[] = [];
  const confidencePerPass: number[] = [];
  const cropAttempts: NonNullable<NumericReExtraction['crop_attempts']> = [];
  const passResults: Array<{ read: string; confidence: number; expansionFactor: number; textWidth: number | null; textHeight: number | null }> = [];
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.,-', tessedit_pageseg_mode: PSM.SINGLE_LINE });
    for (const expansionFactor of [1.5, 1.75, 2] as const) {
      const expanded = expandedNumericRegion(region, expansionFactor);
      const attemptReads: string[] = [];
      const attemptConfidence: number[] = [];
      const previewPaths: string[] = [];
      for (const mode of ['normalized', 'threshold', 'high-threshold'] as const) {
        const crop = await numericCrop(filePath, expanded, mode);
        if (!crop) continue;
        if (process.env.DEBUG_OCR_RESCAN === 'true') {
          const previewDirectory = path.resolve(process.cwd(), 'uploads', 'ocr-rescans');
          await fs.mkdir(previewDirectory, { recursive: true });
          const previewPath = path.join(previewDirectory, `${Date.now()}-${expansionFactor}-${mode}.png`);
          await fs.writeFile(previewPath, crop.buffer);
          previewPaths.push(previewPath);
        }
        await worker.setParameters({ tessedit_char_whitelist: '0123456789.,-', tessedit_pageseg_mode: mode === 'threshold' ? PSM.SINGLE_WORD : PSM.SINGLE_LINE });
        const result = await worker.recognize(crop.buffer, {}, { text: true, blocks: true });
        const read = numericRead(fieldName, result.data.text, initialRead);
        const confidence = typeof result.data.confidence === 'number' ? Math.round(result.data.confidence) : 0;
        const recognizedWords = result.data.blocks?.flatMap((block) => block.paragraphs?.flatMap((paragraph) => paragraph.lines?.flatMap((line) => line.words ?? []) ?? []) ?? []) ?? [];
        const numericWords = recognizedWords.filter((word) => /\d/.test(word.text));
        const textWidth = numericWords.length ? Math.max(...numericWords.map((word) => word.bbox.x1)) - Math.min(...numericWords.map((word) => word.bbox.x0)) : null;
        const textHeight = numericWords.length ? Math.max(...numericWords.map((word) => word.bbox.y1)) - Math.min(...numericWords.map((word) => word.bbox.y0)) : null;
        if (read) {
          candidateReads.push(read);
          attemptReads.push(read);
          passResults.push({ read, confidence, expansionFactor, textWidth, textHeight });
        }
        if (typeof result.data.confidence === 'number') {
          confidencePerPass.push(confidence);
          attemptConfidence.push(confidence);
        }
      }
      const attempt = { expansion_factor: expansionFactor, x: expanded.x, y: expanded.y, width: expanded.width, height: expanded.height, candidate_reads: attemptReads, confidence_per_pass: attemptConfidence, ...(previewPaths.length ? { preview_paths: previewPaths } : {}) };
      cropAttempts.push(attempt);
      console.debug(`[OCR numeric re-scan] ${JSON.stringify(attempt)}`);
    }
  } finally {
    await worker.terminate();
  }
  const counts = new Map<string, number>();
  for (const read of candidateReads) counts.set(read, (counts.get(read) ?? 0) + 1);
  const widthPlausible = (read: string, pass: { expansionFactor: number; textWidth: number | null; textHeight: number | null }) => {
    const observedWidthRatio = pass.textWidth && pass.textHeight
      ? pass.textWidth / pass.textHeight
      : region.width / Math.max(1, region.height);
    const expectedWidthRatio = read.replace(/\s/g, '').length * 0.6;
    const expandedBoxRatio = (region.width * pass.expansionFactor) / Math.max(1, region.height * pass.expansionFactor);
    return observedWidthRatio >= expectedWidthRatio * 0.25 && (observedWidthRatio <= expectedWidthRatio * 2.5 || expandedBoxRatio <= expectedWidthRatio * 2.5);
  };
  const repeated = [...counts.entries()]
    .filter(([read, count]) => count >= 2 && passResults.some((pass) => pass.read === read && widthPlausible(read, pass)))
    .sort((left, right) => {
      const leftPasses = passResults.filter((pass) => pass.read === left[0]);
      const rightPasses = passResults.filter((pass) => pass.read === right[0]);
      return (right[1] - left[1]) || (Math.max(...rightPasses.map((pass) => pass.confidence), 0) - Math.max(...leftPasses.map((pass) => pass.confidence), 0)) || (right[0].replace(/\s/g, '').length - left[0].replace(/\s/g, '').length);
    })[0]?.[0] ?? null;
  return { initial_read: initialRead, candidate_reads: candidateReads, final_value: repeated, resolution_method: repeated ? 'auto_resolved' : 'manual_required', confidence_per_pass: confidencePerPass, crop_attempts: cropAttempts };
}

export async function analyzeImages(filePaths: string[]): Promise<OcrAnalysis> {
  if (!filePaths.length) return { text: '', confidence: null, minimumWordHeightPx: null, typicalWordHeightPx: null, wordCount: 0, words: [], pages: [] };
  if (process.env.OCR_PROVIDER === 'paddle') return analyzeWithPaddle(filePaths);
  const fastTesseract = process.env.OCR_FAST !== 'false';
  const worker = await createWorker('eng');
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const texts: string[] = [];
    const confidences: number[] = [];
    const wordHeights: number[] = [];
    const words = new Map<string, OcrWord>();
      const pages: OcrPage[] = [];
    for (const filePath of filePaths) {
      const source = await fs.readFile(filePath);
      const image = sharp(source, { failOn: 'error' });
      const oriented = await sharp(source, { failOn: 'error' }).rotate().toBuffer();
      const orientedMetadata = await sharp(oriented, { failOn: 'error' }).metadata();
      const orientedWidth = orientedMetadata.width ?? 0;
      const orientedHeight = orientedMetadata.height ?? 0;
      const input = await image
        .rotate()
        .grayscale()
        .normalize()
        .sharpen()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: false })
        .png()
        .toBuffer();
      const inputMetadata = await sharp(input, { failOn: 'error' }).metadata();
      const imageStats = await sharp(oriented, { failOn: 'error' }).stats();
      const grayscale = await sharp(oriented, { failOn: 'error' }).grayscale().raw().toBuffer({ resolveWithObject: true });
      const focusedInputs = orientedWidth && orientedHeight
        ? await Promise.all([
          { left: 0.4, top: 0, width: 0.6, height: 0.5 },
          { left: 0, top: 0.15, width: 0.55, height: 0.55 },
          { left: 0, top: 0.45, width: 0.6, height: 0.55 }
        ].map((region) => sharp(oriented, { failOn: 'error' }).extract({ left: Math.floor(orientedWidth * region.left), top: Math.floor(orientedHeight * region.top), width: Math.max(1, Math.floor(orientedWidth * region.width)), height: Math.max(1, Math.floor(orientedHeight * region.height)) }).grayscale().normalize().sharpen().resize({ width: 2400, height: 1600, fit: 'inside', withoutEnlargement: false }).png().toBuffer()))
        : [input];
      const passResults = [];
      const pageWords = new Map<string, OcrWord>();
      const pageTexts: string[] = [];
      const pageConfidences: number[] = [];
      for (const candidate of (fastTesseract ? [input] : [input, ...focusedInputs])) {
        for (const mode of (fastTesseract ? [PSM.SPARSE_TEXT] : [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK])) {
          await worker.setParameters({ tessedit_pageseg_mode: mode });
          passResults.push(await worker.recognize(candidate, {}, { text: true, blocks: true, hocr: true }));
        }
      }
      const primary = passResults[0].data;
      for (const [passIndex, pass] of passResults.entries()) {
        if (pass.data.text.trim()) { texts.push(pass.data.text.trim()); pageTexts.push(pass.data.text.trim()); }
        if (typeof pass.data.confidence === 'number') { confidences.push(pass.data.confidence); pageConfidences.push(pass.data.confidence); }
        for (const block of pass.data.blocks ?? []) {
          for (const paragraph of block.paragraphs ?? []) {
            for (const line of paragraph.lines ?? []) {
              for (const word of line.words ?? []) {
                if (!word.text.trim()) continue;
                const mapped: OcrWord = {
                  text: word.text,
                  confidence: word.confidence,
                  bbox: word.bbox,
                  fontName: word.font_name,
                  symbols: (word.symbols ?? []).map((symbol) => ({ text: symbol.text, bbox: symbol.bbox }))
                };
                const key = `${mapped.text}|${mapped.bbox.x0}|${mapped.bbox.y0}|${mapped.bbox.x1}|${mapped.bbox.y1}`;
                words.set(key, mapped);
                // Crop passes have local coordinates. Keep the primary full-image
                // pass as the page geometry source so lines and boxes do not mix
                // incompatible coordinate systems.
                if (passIndex === 0) pageWords.set(key, mapped);
              }
            }
          }
        }
      }
      const pageLineData = reconstructOcrLines([...pageWords.values()]);
      const pageHeights = [...pageWords.values()].filter(isMeaningfulOcrWord).map((word) => word.bbox.y1 - word.bbox.y0).filter((height) => height > 0).sort((left, right) => left - right);
      const glarePixels = grayscale.data.reduce((count, value) => count + (value >= 245 ? 1 : 0), 0);
      const glareRatio = glarePixels / Math.max(1, grayscale.data.length);
      const typicalPageHeight = pageHeights.length ? pageHeights[Math.floor(pageHeights.length * 0.5)] : null;
      pages.push({ text: pageLineData.map((line) => line.text).join('\n'), lines: pageLineData, confidence: pageConfidences.length ? Math.max(...pageConfidences) : null, minimumWordHeightPx: pageHeights.length ? pageHeights[0] : null, typicalWordHeightPx: typicalPageHeight, wordCount: pageWords.size, words: [...pageWords.values()], width: inputMetadata.width ?? 0, height: inputMetadata.height ?? 0, imageQuality: assessImageQuality(orientedWidth, orientedHeight, imageStats, laplacianVariance(grayscale.data, grayscale.info.width, grayscale.info.height), glareRatio, estimateTextTilt([...pageWords.values()]), typicalPageHeight) });
      wordHeights.push(...[...words.values()].map((word) => word.bbox.y1 - word.bbox.y0).filter((height) => height > 0));
    }
    const sortedHeights = [...wordHeights].sort((left, right) => left - right);
    return {
      text: pages.map((page) => page.text).join('\n'),
      confidence: confidences.length ? Math.max(...confidences) : null,
      minimumWordHeightPx: wordHeights.length ? Math.min(...wordHeights) : null,
      typicalWordHeightPx: sortedHeights.length ? sortedHeights[Math.floor(sortedHeights.length * 0.5)] : null,
      wordCount: words.size,
      words: [...words.values()],
      pages
    };
  } finally {
    await worker.terminate();
  }
}

function normalizedToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function wordsForDeclaration(check: CheckResult, words: OcrWord[]) {
  if (!check.detectedValue) return [];
  return wordsForValue(check.detectedValue, words);
}

function wordsForValue(value: string, words: OcrWord[]) {
  const tokens = value.split(/[^a-z0-9]+/i).map(normalizedToken).filter(Boolean);
  return words.filter((word) => tokens.some((token) => normalizedToken(word.text).includes(token) || token.includes(normalizedToken(word.text))));
}

function spacingForWords(words: OcrWord[]) {
  const gaps: number[] = [];
  for (const word of words) {
    const symbols = word.symbols.filter((symbol) => symbol.text.trim()).sort((left, right) => left.bbox.x0 - right.bbox.x0);
    for (let index = 1; index < symbols.length; index += 1) {
      const previous = symbols[index - 1].bbox;
      const current = symbols[index].bbox;
      gaps.push((current.x0 - previous.x1) / Math.max(1, current.y1 - current.y0));
    }
  }
  const sortedWords = [...words].sort((left, right) => left.bbox.x0 - right.bbox.x0);
  for (let index = 1; index < sortedWords.length; index += 1) {
    const previous = sortedWords[index - 1].bbox;
    const current = sortedWords[index].bbox;
    if (Math.abs((previous.y0 + previous.y1) / 2 - (current.y0 + current.y1) / 2) <= Math.max(previous.y1 - previous.y0, current.y1 - current.y0) * 0.6) {
      gaps.push((current.x0 - previous.x1) / Math.max(1, current.y1 - current.y0));
    }
  }
  if (!gaps.length) return null;
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return { issue: averageGap < LEGIBILITY_THRESHOLDS.crampedGapRatio || averageGap > LEGIBILITY_THRESHOLDS.stretchedGapRatio, averageGap };
}

export function assessLegibility(checks: CheckResult[], analysis: Pick<OcrAnalysis, 'confidence' | 'words'> & { scaleMmPerPixel?: number }): CheckResult[] {
  const measurements = checks.map((check) => ({ check, words: wordsForDeclaration(check, analysis.words) }));
  const heights = measurements.flatMap(({ words }) => words.map((word) => word.bbox.y1 - word.bbox.y0)).filter((height) => height > 0);
  const medianHeight = heights.length ? [...heights].sort((left, right) => left - right)[Math.floor(heights.length / 2)] : null;
  return measurements.map(({ check, words }) => {
    if (!words.length || medianHeight === null) return { ...check, legibility: { fontSizeConsistent: null, fontSizeNote: 'Unable to assess: OCR field geometry is insufficient.', spacingIssue: null, spacingNote: 'Unable to assess: OCR character geometry is insufficient.', styleSignal: 'Unable to assess: no field-level OCR geometry was found.' } };
    const averageHeight = words.reduce((sum, word) => sum + word.bbox.y1 - word.bbox.y0, 0) / words.length;
    const sizeDifference = Math.abs(averageHeight - medianHeight) / medianHeight;
    const spacing = spacingForWords(words);
    const fontNames = [...new Set(words.map((word) => word.fontName).filter(Boolean))];
    const styleSignal = fontNames.some((name) => /bold|italic/i.test(name ?? ''))
      ? `Approximate OCR style signal: ${fontNames.join(', ')}`
      : 'Approximate style signal: regular/unknown; OCR font metadata is not reliable enough to confirm bold or italic.';
    const measuredFontSizeMm = analysis.scaleMmPerPixel ? averageHeight * analysis.scaleMmPerPixel : undefined;
    return {
      ...check,
      legibility: {
        fontSizeConsistent: measuredFontSizeMm === undefined ? sizeDifference <= LEGIBILITY_THRESHOLDS.sizeDifferenceRatio : measuredFontSizeMm >= check.minFontSizeMm,
        fontSizeNote: measuredFontSizeMm === undefined ? `${Math.round(averageHeight)} px average word height; ${Math.round(sizeDifference * 100)}% from label median. Calibrated scale required for Rule 8 millimetre compliance.` : `${measuredFontSizeMm.toFixed(2)} mm measured from ${Math.round(averageHeight)} px at calibrated scale; minimum ${check.minFontSizeMm} mm.`,
        fontSizeMm: measuredFontSizeMm,
        spacingIssue: spacing?.issue ?? null,
        spacingNote: spacing ? `${spacing.issue ? 'Abnormal' : 'Normal'} estimated gap (${spacing.averageGap.toFixed(2)}x word height).` : 'Unable to assess: no adjacent character or word boxes.',
        styleSignal
      }
    };
  });
}

export async function extractTextFromImages(filePaths: string[]): Promise<string> {
  return (await analyzeImages(filePaths)).text;
}

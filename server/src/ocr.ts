import { createWorker, PSM } from 'tesseract.js';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import type { CheckResult } from './ruleEngine.js';

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
export type ImageQuality = { resolution: 'GOOD' | 'FAIR' | 'POOR'; blur: 'GOOD' | 'FAIR' | 'POOR'; brightness: 'GOOD' | 'FAIR' | 'POOR'; contrast: 'GOOD' | 'FAIR' | 'POOR'; overallQuality: 'GOOD' | 'FAIR' | 'POOR' | 'UNUSABLE'; note: string };
export type OcrPage = { text: string; lines: OcrLine[]; confidence: number | null; minimumWordHeightPx: number | null; typicalWordHeightPx: number | null; wordCount: number; words: OcrWord[]; width: number; height: number; imageQuality: ImageQuality };

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

function assessImageQuality(width: number, height: number, stats: { channels: Array<{ mean: number; stdev: number }> }, blurVariance: number): ImageQuality {
  const resolution = width >= 1000 && height >= 700 ? 'GOOD' : width >= 700 && height >= 450 ? 'FAIR' : 'POOR';
  const brightness = stats.channels.reduce((sum, channel) => sum + channel.mean, 0) / Math.max(1, stats.channels.length);
  const deviation = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, stats.channels.length);
  const brightnessGrade = brightness < 35 || brightness > 235 ? 'POOR' : brightness < 55 || brightness > 210 ? 'FAIR' : 'GOOD';
  const contrast = deviation < 18 ? 'POOR' : deviation < 30 ? 'FAIR' : 'GOOD';
  const blur = blurVariance < 20 ? 'POOR' : blurVariance < 80 ? 'FAIR' : 'GOOD';
  const overallQuality = resolution === 'POOR' || blur === 'POOR' || brightnessGrade === 'POOR' && contrast === 'POOR' ? 'UNUSABLE' : resolution === 'GOOD' && blur === 'GOOD' && brightnessGrade === 'GOOD' && contrast === 'GOOD' ? 'GOOD' : 'FAIR';
  return { resolution, blur, brightness: brightnessGrade, contrast, overallQuality, note: overallQuality === 'UNUSABLE' ? 'Resolution, blur, brightness, or contrast prevents reliable inspection.' : 'Image metrics are sufficient for field-level OCR review.' };
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

export async function analyzeImages(filePaths: string[]): Promise<OcrAnalysis> {
  if (!filePaths.length) return { text: '', confidence: null, minimumWordHeightPx: null, typicalWordHeightPx: null, wordCount: 0, words: [], pages: [] };
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
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: false })
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
        ].map((region) => sharp(oriented, { failOn: 'error' }).extract({ left: Math.floor(orientedWidth * region.left), top: Math.floor(orientedHeight * region.top), width: Math.max(1, Math.floor(orientedWidth * region.width)), height: Math.max(1, Math.floor(orientedHeight * region.height)) }).grayscale().normalize().sharpen().resize({ width: 1800, height: 1200, fit: 'inside', withoutEnlargement: false }).png().toBuffer()))
        : [input];
      const passResults = [];
      const pageWords = new Map<string, OcrWord>();
      const pageTexts: string[] = [];
      const pageConfidences: number[] = [];
      for (const candidate of [input, ...focusedInputs]) {
        for (const mode of [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK]) {
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
      pages.push({ text: pageLineData.map((line) => line.text).join('\n'), lines: pageLineData, confidence: pageConfidences.length ? Math.max(...pageConfidences) : null, minimumWordHeightPx: pageHeights.length ? pageHeights[0] : null, typicalWordHeightPx: pageHeights.length ? pageHeights[Math.floor(pageHeights.length * 0.5)] : null, wordCount: pageWords.size, words: [...pageWords.values()], width: inputMetadata.width ?? 0, height: inputMetadata.height ?? 0, imageQuality: assessImageQuality(orientedWidth, orientedHeight, imageStats, laplacianVariance(grayscale.data, grayscale.info.width, grayscale.info.height)) });
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

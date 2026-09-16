import { rules, type Rule } from './rules.js';

export type CheckResult = {
  fieldName: string;
  label: string;
  detectedValue: string | null;
  isCompliant: boolean;
  ruleSection: string;
  confidenceNote: string;
  confidence?: number | null;
  ocrTokens?: string[];
  sourceText?: string;
  matchedVia?: 'explicit_label' | 'inferred' | 'derived_from_duration';
  numericEvidence?: NumericEvidence;
  numericReExtraction?: NumericReExtraction;
  validationChecks?: { digit_count_ok: boolean; decimal_clear: boolean; proximity_ok: boolean };
  sourceImageIndex?: number;
  sourcePanel?: 'principal' | 'declarations' | 'side' | 'unknown';
  boundingBox?: { x: number; y: number; width: number; height: number };
  sourceImageWidth?: number;
  sourceImageHeight?: number;
  minFontSizeMm: number;
  expectedPanel?: 'principal' | 'declarations';
  status?: EvidenceStatus;
  outputStatus?: 'passed' | 'needs_review' | 'not_visible_in_images';
  sourceImage?: string;
  manualValue?: string;
  originalOcrValue?: string | null;
  originalOcrConfidence?: number | null;
  verifiedBy?: string;
  verifiedAt?: string;
  manualReason?: string;
  legibility?: {
    fontSizeConsistent: boolean | null;
    fontSizeNote: string;
    spacingIssue: boolean | null;
    spacingNote: string;
    styleSignal: string;
  };
};

export type EvidenceStatus = 'verified' | 'detected-low-confidence' | 'not-detected' | 'not-visible-in-uploaded-images' | 'panel-not-provided' | 'image-quality-insufficient' | 'manual-verified';
export type NumericEvidence = { digitCountPlausible: boolean; separatorUnambiguous: boolean; structuralCheckPassed: boolean; widthPlausible?: boolean; reviewReason?: string };
export type NumericReExtraction = {
  initial_read: string;
  candidate_reads: string[];
  final_value: string | null;
  resolution_method: 'auto_resolved' | 'manual_required';
  confidence_per_pass: number[];
  crop_attempts?: Array<{ expansion_factor: number; x: number; y: number; width: number; height: number; candidate_reads: string[]; confidence_per_pass: number[]; preview_paths?: string[] }>;
};

export function classifyEvidenceStatus(detected: boolean, fieldConfidence: number | null, imageUnusable: boolean, verificationThreshold: number) : EvidenceStatus {
  if (imageUnusable) return 'image-quality-insufficient';
  if (!detected) return 'not-detected';
  if (fieldConfidence === null || fieldConfidence < verificationThreshold) return 'detected-low-confidence';
  return 'verified';
}

export function sourceTextForField(fieldName: string, sourceText: string, detectedValue: string | null) {
  if (!detectedValue) return undefined;
  const escapedValue = detectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns: Record<string, RegExp> = {
    mrp: /(?:(?:M\s*\.?\s*R\s*\.?\s*P|MAXIMUM\s+RETAIL\s+PRICE)\s*[:.-]?\s*)?(?:₹|Rs\.?|INR)\s*[0-9OIl]+(?:[.,\-/\s][0-9OIl]{1,2})?/i,
    netQuantity: new RegExp(`(?:NETT?|NET)\\s*(?:WEIGHT|WT|QUANTITY|QTY|CONTENTS)?\\s*[:.-]?\\s*${escapedValue}`, 'i'),
    date: new RegExp(`(?:(?:MFG|MFD|MANUF|PKD|PACKED|MANUFACTURED|BEST\\s+BEFORE|USE\\s+BY|EXP(?:IRY)?)\\s*[:.-]?\\s*)?${escapedValue}`, 'i'),
    manufacturer: /(?:MFD?\.?\s*BY|MFG\.?\s*BY|MANUFACTURED\s*BY|PACK(?:ED|ER)\s*BY|MARKETED\s*BY|IMPORTED\s*BY|DISTRIBUTED\s*BY|MANUFACTURER)\s*[:.-]?\s*[^\n]+/i,
    consumerCare: /(?:CONSUMER|CUSTOMER)\s*CARE[^\n]*|(?:1800[\s-]*\d{3}[\s-]*\d{3,4}|[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4})|[\w.+-]+@[\w.-]+\.[A-Z]{2,}/i
  };
  const match = patterns[fieldName]?.exec(sourceText);
  return match?.[0].trim() ?? detectedValue;
}

export function assessNumericEvidence(fieldName: string, value: string | null, sourceText: string, sourceTokens: string[]) : NumericEvidence | undefined {
  if (!value || !['mrp', 'netQuantity', 'date'].includes(fieldName)) return undefined;
  const valueDigits = (value.match(/\d/g) ?? []).length;
  const sourceNumeric = sourceTokens.filter((token) => /\d/.test(token));
  const sourceDigits = sourceNumeric.reduce((sum, token) => sum + (token.match(/\d/g) ?? []).length, 0);
  const digitCountPlausible = sourceDigits === 0 || sourceDigits >= valueDigits;
  // A standard decimal point is clear; OCR dashes, commas, or split digits remain review-required.
  const separatorUnambiguous = fieldName !== 'mrp' || !/\d(?:\s+|-|,)\s*\d/.test(sourceText);
  const structuralCheckPassed = fieldName === 'date' ? /(?:MFG|MFD|MANUF|PKD|PACK|EXP|BEST|USE)/i.test(sourceText) : fieldName === 'netQuantity' ? /(?:NET|QTY|QUANTITY|WEIGHT|CONTENTS)|\b(?:g|kg|ml|l|n|nos|pieces?)\b/i.test(sourceText) : /(?:MRP|PRICE|₹|Rs\.?|INR)/i.test(sourceText);
  const failures = [!digitCountPlausible ? 'OCR digit count does not match the numeric evidence' : '', !separatorUnambiguous ? 'Currency separator is ambiguous in the OCR source' : '', !structuralCheckPassed ? 'Numeric value lacks a structural field anchor' : ''].filter(Boolean);
  return { digitCountPlausible, separatorUnambiguous, structuralCheckPassed, reviewReason: failures.join('; ') || undefined };
}

export function validationChecksForNumericEvidence(evidence?: NumericEvidence) {
  return evidence ? { digit_count_ok: evidence.digitCountPlausible, decimal_clear: evidence.separatorUnambiguous, proximity_ok: evidence.structuralCheckPassed, width_plausible: evidence.widthPlausible ?? evidence.digitCountPlausible } : undefined;
}

export function runRuleEngine(ocrText: string, activeRules: Rule[] = rules): CheckResult[] {
  return activeRules.map((rule) => {
    const matches = [...ocrText.matchAll(new RegExp(rule.pattern.source, `${rule.pattern.flags.replace('g', '')}g`))];
    const match = rule.fieldName === 'mrp'
      ? matches.sort((left, right) => (right.slice(1).filter(Boolean).join('').length - left.slice(1).filter(Boolean).join('').length))[0]
      : matches[0];
    const normalizeNumber = (value: string) => value.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
    const captures = match?.slice(1).filter(Boolean) ?? [];
    const normalizePrice = (value: string) => normalizeNumber(value.trim()).replace(',', '.').replace(/(\d+)[\s-](?=\d{2}(?:\D|$))/, '$1.');
    const rawDetectedValue = match ? (rule.fieldName === 'netQuantity' ? match[0].match(/(?:^|[^A-Za-z])([0-9OIl]+(?:[.,-][0-9OIl]+)?)\s*(kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?)\b/i)?.[0].trim().replace(/^([0-9OIl]+)/, (value) => normalizeNumber(value)).replace(',', '.').replace(/(\d+)-(?=\d{1,2}(?:\D|$))/, '$1.') ?? captures[0]?.trim() : rule.fieldName === 'mrp' ? normalizePrice(captures[0] ?? '') : rule.fieldName === 'consumerCare' ? match[0].replace(/\s+/g, ' ').trim() : captures[0]?.trim() ?? null) : null;
    const detectedValue = rawDetectedValue;
    const validValue = Boolean(rawDetectedValue && isSaneValue(rule.fieldName, rawDetectedValue));
    const invalidMatch = Boolean(rawDetectedValue) && !validValue;
    return {
      fieldName: rule.fieldName,
      label: rule.label,
      detectedValue,
      isCompliant: validValue,
      ruleSection: rule.ruleSection,
      confidenceNote: invalidMatch ? 'OCR text matched the field label but the detected value failed validation' : detectedValue ? `Matched ${rule.regexPattern.toLowerCase()}` : `No declaration matched ${rule.regexPattern.toLowerCase()}`,
      minFontSizeMm: rule.minFontSizeMm,
      expectedPanel: rule.expectedPanel,
      status: validValue ? 'verified' : invalidMatch ? 'detected-low-confidence' : 'not-detected',
      matchedVia: rule.fieldName === 'date' && /\b(?:days?|months?|years?)\b.*\b(?:from|after|of)\b/i.test(detectedValue ?? '') ? 'derived_from_duration' : rule.fieldName === 'consumerCare' && !/consumer|customer|care|helpline|toll|contact/i.test(match?.[0] ?? '') ? 'inferred' : 'explicit_label'
    };
  });
}

function isSaneValue(fieldName: string, value: string) {
  if (fieldName === 'netQuantity') return /\b(?:\d+\s*[xX]\s*)?\d+(?:[.,]\d+)?\s*(?:kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?|pairs?|sheets?)\b/i.test(value) && !/^[il]{1,3}\b/i.test(value.trim());
  if (fieldName === 'mrp') return /\d/.test(value) && Number(value.replace(',', '.')) >= 0;
  if (fieldName === 'date') return /\d/.test(value) || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(value) || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\s+(?:days?|months?|years?)\s+(?:from|after|of)\b/i.test(value);
  if (fieldName === 'manufacturer') return value.replace(/[^a-z]/gi, '').length >= 3 && !/(nutrition|thicken|sodium|sugar|serving|calorie|ingredient|wheat gluten)/i.test(value);
  if (fieldName === 'consumerCare') return /@|(?:\d\D*){7,}/.test(value);
  return value.trim().length > 0;
}

export function summarizeChecks(checks: CheckResult[]) {
  const passed = checks.filter((check) => check.isCompliant).length;
  return { passed, failed: checks.length - passed, total: checks.length, isCompliant: passed === checks.length };
}

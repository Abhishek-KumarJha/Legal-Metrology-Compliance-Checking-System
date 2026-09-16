import type { CheckResult } from './ruleEngine.js';

type RegisteredProduct = {
  declaredMrp?: number;
  declaredNetQuantity?: number;
  declaredNetUnit?: string;
  manufacturerDetails?: string;
  consumerCareDetails?: string;
};

export type ComparisonStatus = 'match' | 'mismatch' | 'not-compared';

export type ComparedCheck = CheckResult & {
  needsReview?: boolean;
  comparisonStatus: ComparisonStatus;
  registeredValue: string | null;
  comparisonNote: string;
};

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9@]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function manufacturerMatches(detectedValue: string, registeredValue: string) {
  const detected = normalizedText(detectedValue);
  const registered = normalizedText(registeredValue);
  if (!detected || !registered) return false;
  if (detected.includes(registered) || registered.includes(detected)) return true;
  const detectedTokens = new Set(detected.split(' ').filter((token) => token.length > 2));
  const registeredTokens = new Set(registered.split(' ').filter((token) => token.length > 2));
  const overlap = [...detectedTokens].filter((token) => registeredTokens.has(token)).length;
  const shorterTokenCount = Math.min(detectedTokens.size, registeredTokens.size);
  return shorterTokenCount > 0 && overlap / shorterTokenCount >= 0.7;
}

function quantityInBase(value: number, unit: string) {
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit === 'kg') return value * 1000;
  if (normalizedUnit === 'mg') return value / 1000;
  if (normalizedUnit === 'g' || normalizedUnit === 'gm') return value;
  if (normalizedUnit === 'l') return value * 1000;
  if (normalizedUnit === 'ml') return value;
  return null;
}

function extractQuantity(value: string) {
  const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|g|gm|mg|l|litre|ml)/i);
  return match ? { amount: Number(match[1]), unit: match[2] } : null;
}

function compareCheck(check: CheckResult, product: RegisteredProduct): ComparedCheck {
  let registeredValue: string | null = null;
  let comparisonStatus: ComparisonStatus = 'not-compared';
  let comparisonNote = 'No registered product value was supplied';

  if (check.fieldName === 'mrp' && typeof product.declaredMrp === 'number') {
    registeredValue = `Rs. ${product.declaredMrp}`;
    comparisonStatus = check.isCompliant && Number(check.detectedValue) === product.declaredMrp ? 'match' : check.isCompliant ? 'mismatch' : 'not-compared';
    comparisonNote = comparisonStatus === 'match' ? 'Detected price matches the registered MRP' : comparisonStatus === 'mismatch' ? 'Detected price differs from the registered MRP' : 'No price available to compare';
  }
  if (check.fieldName === 'netQuantity' && typeof product.declaredNetQuantity === 'number' && product.declaredNetUnit) {
    registeredValue = `${product.declaredNetQuantity} ${product.declaredNetUnit}`;
    const detected = check.detectedValue ? extractQuantity(check.detectedValue) : null;
    const detectedAmount = detected ? quantityInBase(detected.amount, detected.unit) : null;
    const registeredAmount = quantityInBase(product.declaredNetQuantity, product.declaredNetUnit);
    comparisonStatus = check.isCompliant && detectedAmount !== null && registeredAmount !== null && detectedAmount === registeredAmount ? 'match' : check.isCompliant ? 'mismatch' : 'not-compared';
    comparisonNote = comparisonStatus === 'match' ? 'Quantity matches after unit normalization' : comparisonStatus === 'mismatch' ? 'Quantity differs after unit normalization' : 'No quantity available to compare';
  }
  if (check.fieldName === 'manufacturer' && product.manufacturerDetails) {
    registeredValue = product.manufacturerDetails;
    comparisonStatus = check.isCompliant && manufacturerMatches(check.detectedValue ?? '', product.manufacturerDetails) ? 'match' : check.isCompliant ? 'mismatch' : 'not-compared';
    comparisonNote = comparisonStatus === 'match' ? 'Manufacturer details substantially match' : comparisonStatus === 'mismatch' ? 'Manufacturer details differ from the registered record' : 'No manufacturer details available to compare';
  }
  if (check.fieldName === 'consumerCare' && product.consumerCareDetails) {
    registeredValue = product.consumerCareDetails;
    const detected = normalizedText(check.detectedValue ?? '');
    const registered = normalizedText(product.consumerCareDetails);
    const registeredEmail = registered.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/)?.[0];
    const registeredPhone = registered.replace(/\D/g, '').slice(-10);
    const matches = registeredEmail ? detected.includes(registeredEmail) : registeredPhone.length >= 7 && detected.replace(/\D/g, '').includes(registeredPhone);
    comparisonStatus = check.isCompliant && matches ? 'match' : check.isCompliant ? 'mismatch' : 'not-compared';
    comparisonNote = comparisonStatus === 'match' ? 'Consumer care contact matches' : comparisonStatus === 'mismatch' ? 'Consumer care contact differs from the registered record' : 'No consumer care value available to compare';
  }

  return { ...check, comparisonStatus, registeredValue, comparisonNote };
}

export function compareChecks(checks: CheckResult[], product?: RegisteredProduct): ComparedCheck[] {
  return checks.map((check) => compareCheck(check, product ?? {}));
}

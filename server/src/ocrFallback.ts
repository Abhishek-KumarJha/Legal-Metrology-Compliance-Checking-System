export const DEMO_OCR_TEXT = 'MRP Rs. 120\nNET QUANTITY 500 g\nMFG: 04/2026\nMfd by: Bharat Foods Pvt Ltd\nCustomer Care: 1800 123 4567';

export function applyOcrFallback(extractedText: string, allowFallback: boolean) {
  if (extractedText.trim()) return { text: extractedText.trim(), fallbackUsed: false };
  if (!allowFallback) return { text: '', fallbackUsed: false };
  return { text: DEMO_OCR_TEXT, fallbackUsed: true };
}
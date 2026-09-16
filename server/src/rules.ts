  export type Rule = {
  id: string;
  fieldName: string;
  label: string;
  pattern: RegExp;
  regexPattern: string;
  ruleSection: string;
  minFontSizeMm: number;
  description: string;
  expectedPanel: 'principal' | 'declarations';
};

export function minimumFontSizeForPack(quantity?: number, unit?: string) {
  if (!quantity || !unit) return 2;
  const normalizedUnit = unit.toLowerCase();
  const grams = normalizedUnit === 'kg' ? quantity * 1000 : normalizedUnit === 'mg' ? quantity / 1000 : normalizedUnit === 'g' || normalizedUnit === 'gm' ? quantity : null;
  const millilitres = normalizedUnit === 'l' ? quantity * 1000 : normalizedUnit === 'ml' ? quantity : normalizedUnit === 'litre' ? quantity * 1000 : null;
  if ((grams !== null && grams < 50) || (millilitres !== null && millilitres < 50)) return 1;
  if ((grams !== null && grams >= 500) || (millilitres !== null && millilitres >= 500)) return 3;
  return 2;
}

export const rules: Rule[] = [
  // MRP labels may be abbreviated, followed by explanatory text, or reordered by OCR.
  { id: 'mrp', fieldName: 'mrp', label: 'Maximum Retail Price', pattern: /(?:(?:M\s*\.?\s*R\s*\.?\s*P|MAXIMUM\s+RETAIL\s+PRICE)[\s\S]{0,240}?(?:₹|Rs\.?|INR)[\s\S]{0,120}?([0-9][0-9OIl]*(?:(?:[.,-]|\s)[0-9OIl]{1,2})?)|(?:₹|Rs\.?|INR)\s*([0-9][0-9OIl]*(?:(?:[.,-]|\s)[0-9OIl]{1,2})?)|(?:M\s*\.?\s*R\s*\.?\s*P|MAXIMUM\s+RETAIL\s+PRICE)[^\n]{0,80}?([0-9][0-9OIl]*(?:(?:[.,-]|\s)[0-9OIl]{1,2})?))/i, regexPattern: 'MRP or maximum retail price near a numeric currency price', ruleSection: 'Rule 6(1)(e)', minFontSizeMm: 2, description: 'Price inclusive of all taxes', expectedPanel: 'principal' },
  // Net quantity is commonly printed as Net/Nett Weight, Wt, Qty, Contents, or a standalone first quantity line.
  { id: 'netQuantity', fieldName: 'netQuantity', label: 'Net quantity', pattern: /(?:(?:NETT?|NET|CONTENTS?|QUANTITY)\s*(?:WEIGHT|WT|QUANTITY|QTY|CONTENTS?)?\s*[:.-]?\s*((?:[0-9OIl]+\s*[xX]\s*)?[0-9OIl]+(?:[.,-][0-9OIl]+)?)\s*(kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?|pairs?|sheets?)\b|(?:^|\n)\s*((?:[0-9OIl]+\s*[xX]\s*)?[0-9OIl]+(?:[.,-][0-9OIl]+)?)\s*(kg|litre|gm|mg|ml|g|l|n|nos|pieces?|tablets?|pairs?|sheets?)\b)/i, regexPattern: 'Net/Nett weight, quantity, contents, or standalone count/quantity with unit', ruleSection: 'Rule 6(1)(d)', minFontSizeMm: 2, description: 'Standard units, counts, multipacks, and numerals', expectedPanel: 'declarations' },
  // Dates appear as MFG/PKD, manufacturing or packed-on text, and may be read before their label.
  { id: 'date', fieldName: 'date', label: 'Date marking', pattern: /(?:(?:MFG|MFD|MANUF|PKD|PACKED|PACKED\s*ON|MANUFACTURED|MANUFACTURING\s*DATE|DATE\s*OF\s*(?:MANUFACTURE|PACKING)|BEST\s*BEFORE|USE\s*BY|EXP(?:IRY)?)\s*[:.-]?[\s\S]{0,80}?([0-9]{1,2}\s+[A-Z]{3}\s+[0-9]{2,4}|[0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4}|[0-9]{4}[\/.-][0-9]{1,2}(?:[\/.-][0-9]{1,2})?|[0-9]{1,2}[\/.-][0-9]{4}|[A-Z]{3}\s*[0-9]{4}|[A-Z]{3}[0-9]{4}|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|[0-9]+)\s+(?:days?|months?|years?)\s+(?:from|after|of)\s+(?:the\s+)?(?:manufactur(?:e|ing)?|mfg|mfd|pack|packaging|pkd|open|opening))|([0-9]{1,2}\s+[A-Z]{3}\s+[0-9]{2,4}|[0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4}|[0-9]{4}[\/.-][0-9]{1,2}(?:[\/.-][0-9]{1,2})?|[0-9]{1,2}[\/.-][0-9]{4}|[A-Z]{3}\s*[0-9]{4}|[A-Z]{3}[0-9]{4}|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|[0-9]+)\s+(?:days?|months?|years?)\s+(?:from|after|of)\s+(?:the\s+)?(?:manufactur(?:e|ing)?|mfg|mfd|pack|packaging|pkd|open|opening))[\s\S]{0,80}?(?:MFG|MFD|MANUF|PKD|PACKED|MANUFACTURED|MANUFACTURING\s*DATE|BEST\s*BEFORE|USE\s*BY|EXP(?:IRY)?))/i, regexPattern: 'Absolute or word/number duration-based date marking near manufacturing, packing, best-before, use-by, or expiry context', ruleSection: 'Rule 6(1)(c)', minFontSizeMm: 2, description: 'Date, month, year, or duration marking', expectedPanel: 'declarations' },
  // Manufacturer wording covers common MFD/packed/marketed labels and captures the following line.
  { id: 'manufacturer', fieldName: 'manufacturer', label: 'Manufacturer / packer', pattern: /(?:MANUFACTURED\s+([A-Za-z][^\n]{1,80}?)\s+PACK(?:ED|ER)[\s\S]{0,30}?\s*BY|MFD?\.?\s*BY|MFG\.?\s*BY|MANUFACTURED(?:\s*&\s*PACKED)?(?:[\s\S]{0,80}?\s*BY)?|PACK(?:ED|ER)(?:[\s\S]{0,80}?\s*BY)?|MARKETED\s*BY|IMPORTED\s*BY|DISTRIBUTED\s*BY|MANUFACTURER)\s*[:.-]?\s*([^\n]*(?:\n[^\n]*){0,2})/i, regexPattern: 'Manufacturer, packer, marketer, importer, distributor, or associated address block', ruleSection: 'Rule 6(1)(a)', minFontSizeMm: 2, description: 'Name and address of manufacturer, packer, importer, or distributor', expectedPanel: 'declarations' },
  // Consumer support may be labelled customer care, consumer care, helpline, or contact.
  { id: 'consumerCare', fieldName: 'consumerCare', label: 'Consumer care', pattern: /[\w.+-]+\s*@\s*[\w.-]+\s*\.\s*[A-Z]{2,}|\b(?:1800[\s-]*\d{3}[\s-]*\d{3,4}|[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4})\b/i, regexPattern: 'Indian phone number or email contact, with or without care heading', ruleSection: 'Rule 6(1)(f)', minFontSizeMm: 2, description: 'Consumer complaint contact details', expectedPanel: 'declarations' }
];

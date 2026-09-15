export type Rule = {
  id: string;
  fieldName: string;
  label: string;
  pattern: RegExp;
  regexPattern: string;
  ruleSection: string;
  minFontSizeMm: number;
  description: string;
};

export const rules: Rule[] = [
  { id: 'mrp', fieldName: 'mrp', label: 'Maximum Retail Price', pattern: /(?:MRP|M\.R\.P)\s*(?:₹|Rs\.?|INR)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i, regexPattern: '(MRP|M.R.P) followed by price', ruleSection: 'Rule 6(1)(e)', minFontSizeMm: 2, description: 'Price inclusive of all taxes' },
  { id: 'netQuantity', fieldName: 'netQuantity', label: 'Net quantity', pattern: /(?:NET\s*(?:QTY|QUANTITY)?|CONTENTS?)\s*[:.-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(kg|g|gm|mg|l|litre|ml)/i, regexPattern: 'quantity + g|kg|ml|l', ruleSection: 'Rule 6(1)(d)', minFontSizeMm: 2, description: 'Standard units and numerals' },
  { id: 'date', fieldName: 'date', label: 'Date marking', pattern: /(?:MFG|PKD|PACKED|MANUFACTURED|BEST\s*BEFORE)\s*[:.-]?\s*([0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4}|[0-9]{1,2}[\/.-][0-9]{4}|[A-Z][a-z]+\s*[0-9]{4})/i, regexPattern: 'MFG|PKD with date', ruleSection: 'Rule 6(1)(c)', minFontSizeMm: 2, description: 'Month and year of manufacture or packing' },
  { id: 'manufacturer', fieldName: 'manufacturer', label: 'Manufacturer / packer', pattern: /(?:MFD?\.?\s*BY|MANUFACTURED\s*BY|PACKED\s*BY|MARKETED\s*BY)\s*[:.-]?\s*([^\n]+)/i, regexPattern: 'Mfd by|Packed by|Marketed by + name', ruleSection: 'Rule 6(1)(a)', minFontSizeMm: 2, description: 'Name and address of manufacturer, packer or importer' },
  { id: 'consumerCare', fieldName: 'consumerCare', label: 'Consumer care', pattern: /(?:CUSTOMER\s*CARE|CONSUMER\s*CARE|HELPLINE|CONTACT)\s*[:.-]?\s*([^\n]+|[+()0-9][+()0-9 -]{7,})/i, regexPattern: 'customer care + phone/email', ruleSection: 'Rule 6(1)(f)', minFontSizeMm: 2, description: 'Consumer complaint contact details' }
];

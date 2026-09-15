import { rules, type Rule } from './rules.js';

export type CheckResult = {
  fieldName: string;
  label: string;
  detectedValue: string | null;
  isCompliant: boolean;
  ruleSection: string;
  confidenceNote: string;
  minFontSizeMm: number;
};

export function runRuleEngine(ocrText: string, activeRules: Rule[] = rules): CheckResult[] {
  return activeRules.map((rule) => {
    const match = ocrText.match(rule.pattern);
    const detectedValue = match ? (rule.fieldName === 'netQuantity' ? match[0].match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|g|gm|mg|l|litre|ml)/i)?.[0] ?? match[1]?.trim() : match[1]?.trim() ?? null) : null;
    return {
      fieldName: rule.fieldName,
      label: rule.label,
      detectedValue,
      isCompliant: Boolean(match),
      ruleSection: rule.ruleSection,
      confidenceNote: match ? `Matched ${rule.regexPattern.toLowerCase()}` : `No declaration matched ${rule.regexPattern.toLowerCase()}`,
      minFontSizeMm: rule.minFontSizeMm
    };
  });
}

export function summarizeChecks(checks: CheckResult[]) {
  const passed = checks.filter((check) => check.isCompliant).length;
  return { passed, failed: checks.length - passed, total: checks.length, isCompliant: passed === checks.length };
}

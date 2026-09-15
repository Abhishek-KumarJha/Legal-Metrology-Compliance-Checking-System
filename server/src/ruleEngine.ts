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
    const detectedValue = match?.[1]?.trim() ?? null;
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

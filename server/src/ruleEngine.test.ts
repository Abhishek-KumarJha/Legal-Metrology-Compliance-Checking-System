import assert from 'node:assert/strict';
import { runRuleEngine, summarizeChecks } from './ruleEngine.js';

const checks = runRuleEngine('MRP Rs. 120\nNet Quantity 500 g\nMFG: 04/2026\nMfd by: Bharat Foods Pvt Ltd\nCustomer Care: 1800 123 4567');
assert.equal(summarizeChecks(checks).isCompliant, true);
assert.equal(checks.find((check) => check.fieldName === 'mrp')?.detectedValue, '120');
assert.equal(runRuleEngine('MRP Rs. 120')[1].isCompliant, false);
console.log('rule engine checks passed');

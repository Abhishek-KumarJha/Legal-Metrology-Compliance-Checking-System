import assert from 'node:assert/strict';
import { runRuleEngine, summarizeChecks } from './ruleEngine.js';
import { compareChecks } from './productMatching.js';

const checks = runRuleEngine('MRP Rs. 120\nNet Quantity 500 g\nMFG: 04/2026\nMfd by: Bharat Foods Pvt Ltd\nCustomer Care: 1800 123 4567');
assert.equal(summarizeChecks(checks).isCompliant, true);
assert.equal(checks.find((check) => check.fieldName === 'mrp')?.detectedValue, '120');
assert.equal(runRuleEngine('MRP Rs. 120')[1].isCompliant, false);
const registeredChecks = compareChecks(runRuleEngine('MRP Rs. 120\nNET QUANTITY 1 kg\nMfd by: Bharat Foods\nCustomer Care: 1800 123 4567'), { declaredMrp: 120, declaredNetQuantity: 1000, declaredNetUnit: 'g', manufacturerDetails: 'Bharat Foods', consumerCareDetails: '1800 123 4567' });
assert.equal(registeredChecks.find((check) => check.fieldName === 'mrp')?.comparisonStatus, 'match');
assert.equal(registeredChecks.find((check) => check.fieldName === 'netQuantity')?.comparisonStatus, 'match');
const seededProductChecks = compareChecks(runRuleEngine('MRP Rs. 120\nNET QUANTITY 500 g'), { declaredMrp: 120, declaredNetQuantity: 500, declaredNetUnit: 'g' });
assert.equal(seededProductChecks.find((check) => check.fieldName === 'netQuantity')?.comparisonStatus, 'match');
assert.equal(runRuleEngine('MRP Rs. 120\nNET QUANTITY 500 g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '500 g');
assert.equal(runRuleEngine('MRP Rs. 120\nNET 500 g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '500 g');
assert.equal(compareChecks(runRuleEngine('MRP Rs. 99'), { declaredMrp: 120 }).find((check) => check.fieldName === 'mrp')?.comparisonStatus, 'mismatch');
console.log('rule engine checks passed');

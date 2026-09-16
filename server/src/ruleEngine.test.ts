import assert from 'node:assert/strict';
import { assessNumericEvidence, classifyEvidenceStatus, runRuleEngine, sourceTextForField, summarizeChecks, validationChecksForNumericEvidence } from './ruleEngine.js';
import { compareChecks } from './productMatching.js';
import { assessReadability, boundingBoxForValue, fieldEvidenceForValue, reconstructOcrLines, selectDeclarationLines, validateScaleMmPerPixel } from './ocr.js';
import { minimumFontSizeForPack } from './rules.js';
import { applyOcrFallback, DEMO_OCR_TEXT } from './ocrFallback.js';

const checks = runRuleEngine('MRP Rs. 120\nNet Quantity 500 g\nMFG: 04/2026\nMfd by: Bharat Foods Pvt Ltd\nCustomer Care: 1800 123 4567');
assert.equal(summarizeChecks(checks).isCompliant, true);
assert.equal(checks.find((check) => check.fieldName === 'mrp')?.detectedValue, '120');
assert.equal(runRuleEngine('Maximum Retail Price (MRP)\n\nRs. 129.00 (Inclusive of all taxes)').find((check) => check.fieldName === 'mrp')?.detectedValue, '129.00');
assert.equal(runRuleEngine('MFG: FEB2014').find((check) => check.fieldName === 'date')?.isCompliant, true);
assert.equal(runRuleEngine('Nett Weight: 100 g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '100 g');
assert.equal(runRuleEngine('100 g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '100 g');
assert.equal(runRuleEngine('Net Quantity: 40G').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '40G');
assert.equal(runRuleEngine('Net Quantity: 40 gm').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '40 gm');
assert.equal(runRuleEngine('Net Quantity: 40gm').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '40gm');
assert.equal(runRuleEngine('Net Quantity: 200 g il').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '200 g');
assert.equal(runRuleEngine('Contents: 2N').find((check) => check.fieldName === 'netQuantity')?.isCompliant, true);
assert.equal(runRuleEngine('Net Quantity: 10 x 2N').find((check) => check.fieldName === 'netQuantity')?.isCompliant, true);
assert.equal(runRuleEngine('Distributed by: Acme Retail Pvt Ltd').find((check) => check.fieldName === 'manufacturer')?.isCompliant, true);
assert.equal(runRuleEngine('Manufactured & Packed by: HarvestGold Foods Pvt Ltd').find((check) => check.fieldName === 'manufacturer')?.isCompliant, true);
assert.equal(runRuleEngine('Packed FEB 2027 by II\nBiscuits HarvestGold Foods Pvt. Ltd').find((check) => check.fieldName === 'manufacturer')?.isCompliant, true);
assert.equal(runRuleEngine('MRP 180.00 Plot No. 12, Agro Park').find((check) => check.fieldName === 'manufacturer')?.isCompliant, false);
assert.equal(runRuleEngine('Net Weight: 295 g\nProtein: 15.8 g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '295 g');
const garbageQuantity = runRuleEngine('Net Quantity il');
assert.equal(garbageQuantity.find((check) => check.fieldName === 'netQuantity')?.isCompliant, false);
assert.equal(garbageQuantity.find((check) => check.fieldName === 'netQuantity')?.status, 'detected-low-confidence');
assert.equal(runRuleEngine('MRP Rs. 10').find((check) => check.fieldName === 'mrp')?.expectedPanel, 'principal');
assert.equal(runRuleEngine('Net Quantity: 70 g').find((check) => check.fieldName === 'netQuantity')?.expectedPanel, 'declarations');
assert.equal(runRuleEngine('Maximum Retail Price (Inclusive of all Taxes): Rs.29-00').find((check) => check.fieldName === 'mrp')?.detectedValue, '29.00');
assert.equal(runRuleEngine('Rs.29 00\nMaximum Retail Price').find((check) => check.fieldName === 'mrp')?.detectedValue, '29.00');
const quakerOcr = 'OR call us at 1800 224 020\nOR email us at consumer. feedback@pepsico.com\nMRP. Rs.\n(Inclusive of all taxes)\n15.00\nMANUF\n07 JUL 15';
const quakerChecks = runRuleEngine(quakerOcr);
assert.equal(quakerChecks.find((check) => check.fieldName === 'mrp')?.detectedValue, '15.00');
assert.equal(runRuleEngine('Net Quantity: 40g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '40g');
assert.equal(quakerChecks.find((check) => check.fieldName === 'date')?.detectedValue, '07 JUL 15');
assert.equal(quakerChecks.find((check) => check.fieldName === 'consumerCare')?.isCompliant, true);
assert.notEqual(quakerChecks.find((check) => check.fieldName === 'mrp')?.detectedValue, 'i');
const realPhotoOcr = '( umin\nAppalan\n100 g\nPp\nwelig!\nRs\n9-00\nFEB2014\nMaximum Retail Price\nInclusive of all Taxes\n0T Na. 01\nManufacturing Date\nLOT No\nTRI- 74/98';
assert.equal(runRuleEngine(realPhotoOcr + '\nRs.29 00\nMaximum Retail Price').find((check) => check.fieldName === 'mrp')?.detectedValue, '29.00');
assert.equal(runRuleEngine(realPhotoOcr).find((check) => check.fieldName === 'netQuantity')?.detectedValue, '100 g');
assert.equal(runRuleEngine(realPhotoOcr).find((check) => check.fieldName === 'date')?.detectedValue, 'FEB2014');
const handwashChecks = compareChecks(runRuleEngine('Net Quantity\n250 ml\nMaximum Retail Price (MRP)\nRs. 129.00 (Inclusive of all taxes)\nManufactured / Packed by\nKaveri Home Care Pvt. Ltd.,\nConsumer Care\nCustomer Care: 1800-419-2233'), { declaredMrp: 129, declaredNetQuantity: 250, declaredNetUnit: 'ml', manufacturerDetails: 'Kaveri Home Care Pvt. Ltd.', consumerCareDetails: '1800-419-2233' });
for (const fieldName of ['mrp', 'netQuantity', 'manufacturer', 'consumerCare']) assert.equal(handwashChecks.find((check) => check.fieldName === fieldName)?.comparisonStatus, 'match');
assert.equal(compareChecks(runRuleEngine('Maximum Retail Price (MRP)\nRs. 129.00'), { declaredMrp: 130 }).find((check) => check.fieldName === 'mrp')?.comparisonStatus, 'mismatch');
for (const fieldName of ['mrp', 'netQuantity', 'date', 'manufacturer', 'consumerCare']) assert.equal(checks.find((check) => check.fieldName === fieldName)?.isCompliant, true);
const missingChecks = runRuleEngine('MRP Rs. 120');
for (const fieldName of ['netQuantity', 'date', 'manufacturer', 'consumerCare']) assert.equal(missingChecks.find((check) => check.fieldName === fieldName)?.isCompliant, false);
const emptyOcrChecks = runRuleEngine('');
for (const fieldName of ['mrp', 'netQuantity', 'date', 'manufacturer', 'consumerCare']) assert.equal(emptyOcrChecks.find((check) => check.fieldName === fieldName)?.status, 'not-detected');
const registeredChecks = compareChecks(runRuleEngine('MRP Rs. 120\nNET QUANTITY 1 kg\nMfd by: Bharat Foods\nCustomer Care: 1800 123 4567'), { declaredMrp: 120, declaredNetQuantity: 1000, declaredNetUnit: 'g', manufacturerDetails: 'Bharat Foods', consumerCareDetails: '1800 123 4567' });
assert.equal(registeredChecks.find((check) => check.fieldName === 'mrp')?.comparisonStatus, 'match');
assert.equal(registeredChecks.find((check) => check.fieldName === 'netQuantity')?.comparisonStatus, 'match');
const seededProductChecks = compareChecks(runRuleEngine('MRP Rs. 120\nNET QUANTITY 500 g'), { declaredMrp: 120, declaredNetQuantity: 500, declaredNetUnit: 'g' });
assert.equal(seededProductChecks.find((check) => check.fieldName === 'netQuantity')?.comparisonStatus, 'match');
assert.equal(runRuleEngine('MRP Rs. 120\nNET QUANTITY 500 g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '500 g');
assert.equal(runRuleEngine('MRP Rs. 120\nNET 500 g').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '500 g');
assert.equal(compareChecks(runRuleEngine('MRP Rs. 99'), { declaredMrp: 120 }).find((check) => check.fieldName === 'mrp')?.comparisonStatus, 'mismatch');
assert.equal(compareChecks(runRuleEngine('Mfd by: Acme Cleaning'), { manufacturerDetails: 'Bharat Foods' }).find((check) => check.fieldName === 'manufacturer')?.comparisonStatus, 'mismatch');
assert.equal(compareChecks(runRuleEngine('Manufactured / Packed by\nKaveri Home Care Pvt. Ltd.,'), { manufacturerDetails: 'Kaveri Home Care Pvt. Ltd., Plot 42, Industrial Area Phase 2, Chandigarh, 160002' }).find((check) => check.fieldName === 'manufacturer')?.comparisonStatus, 'match');
assert.equal(compareChecks(runRuleEngine('Manufactured / Packed by\nSharma Traders Pvt Ltd'), { manufacturerDetails: 'Kaveri Home Care Pvt. Ltd., Plot 42, Industrial Area Phase 2, Chandigarh, 160002' }).find((check) => check.fieldName === 'manufacturer')?.comparisonStatus, 'mismatch');
assert.equal(compareChecks(runRuleEngine('Customer Care: 1800 000 0000'), { consumerCareDetails: '1800 123 4567' }).find((check) => check.fieldName === 'consumerCare')?.comparisonStatus, 'mismatch');
assert.equal(applyOcrFallback('', false).fallbackUsed, false);
assert.equal(applyOcrFallback('', false).text, '');
assert.equal(applyOcrFallback('', true).fallbackUsed, true);
assert.equal(applyOcrFallback('', true).text, DEMO_OCR_TEXT);
assert.equal(applyOcrFallback('real OCR text', true).fallbackUsed, false);
assert.equal(assessReadability({ confidence: 92, minimumWordHeightPx: 14 }).readable, true);
assert.equal(assessReadability({ confidence: 42, minimumWordHeightPx: 14 }).readable, false);
assert.equal(assessReadability({ confidence: 60, minimumWordHeightPx: 14 }).readable, false);
assert.equal(assessReadability({ confidence: 92, minimumWordHeightPx: 5 }).heightOk, false);
assert.equal(minimumFontSizeForPack(40, 'g'), 1);
assert.equal(minimumFontSizeForPack(150, 'g'), 2);
assert.equal(minimumFontSizeForPack(500, 'g'), 3);
assert.equal(minimumFontSizeForPack(500, 'ml'), 3);
assert.equal(validateScaleMmPerPixel(0.08).valid, true);
assert.equal(validateScaleMmPerPixel(0.8).valid, false);
assert.deepEqual(boundingBoxForValue('₹129', [{ text: '129', confidence: 58, bbox: { x0: 120, y0: 240, x1: 300, y1: 285 }, symbols: [] }]), { x: 120, y: 240, width: 180, height: 45 });
assert.equal(fieldEvidenceForValue('129', [
	{ text: '129', confidence: 58, bbox: { x0: 120, y0: 240, x1: 300, y1: 285 }, symbols: [] },
	{ text: 'clean', confidence: 96, bbox: { x0: 400, y0: 240, x1: 450, y1: 285 }, symbols: [] }
]).confidence, 58);
assert.equal(classifyEvidenceStatus(true, 58, false, 85), 'detected-low-confidence');
assert.equal(classifyEvidenceStatus(true, 91, false, 85), 'verified');
assert.equal(classifyEvidenceStatus(true, 91, true, 85), 'image-quality-insufficient');
assert.equal(classifyEvidenceStatus(false, null, false, 85), 'not-detected');
assert.equal(sourceTextForField('mrp', '100 g Rs 9-00', '9.00'), 'Rs 9-00');
assert.equal(sourceTextForField('netQuantity', '100 g Rs 9-00', '100 g'), '100 g');
assert.equal(sourceTextForField('date', 'Maximum Retail Price Inclusive of all Taxes FEB2014 01', 'FEB2014'), 'FEB2014');
assert.equal(runRuleEngine('2025/01').find((check) => check.fieldName === 'date')?.detectedValue, null);
assert.equal(runRuleEngine('Net Contents: 2N').find((check) => check.fieldName === 'netQuantity')?.detectedValue, '2N');
assert.equal(runRuleEngine('Customer service: care@example.com').find((check) => check.fieldName === 'consumerCare')?.isCompliant, true);
assert.equal(runRuleEngine('Best Before 6 months from manufacturing date').find((check) => check.fieldName === 'date')?.matchedVia, 'derived_from_duration');
assert.equal(runRuleEngine('MFG FEB2014').find((check) => check.fieldName === 'date')?.detectedValue, 'FEB2014');
assert.equal(assessNumericEvidence('mrp', '29.00', 'MRP Rs 29-00', ['MRP', 'Rs', '29-00'])?.separatorUnambiguous, false);
assert.equal(runRuleEngine('Best Before Three Months From Manufacturing').find((check) => check.fieldName === 'date')?.matchedVia, 'derived_from_duration');
assert.match(runRuleEngine('Best Before Three Months From Manufacturing').find((check) => check.fieldName === 'date')?.detectedValue ?? '', /Manufacturing/i);
assert.deepEqual(validationChecksForNumericEvidence(assessNumericEvidence('mrp', '29.00', 'MRP Rs 29.00', ['MRP', 'Rs', '29.00'])), { digit_count_ok: true, decimal_clear: false, proximity_ok: true, width_plausible: true });
assert.equal(reconstructOcrLines([
	{ text: 'NET', confidence: 90, bbox: { x0: 10, y0: 10, x1: 45, y1: 30 }, symbols: [] },
	{ text: '|', confidence: 99, bbox: { x0: 50, y0: 10, x1: 52, y1: 30 }, symbols: [] },
	{ text: '250', confidence: 88, bbox: { x0: 60, y0: 10, x1: 100, y1: 30 }, symbols: [] },
	{ text: 'g', confidence: 86, bbox: { x0: 110, y0: 10, x1: 125, y1: 30 }, symbols: [] }
]).map((line) => line.text).join('\n'), 'NET 250 g');
assert.deepEqual(selectDeclarationLines(reconstructOcrLines([
	{ text: 'Nutrition', confidence: 90, bbox: { x0: 0, y0: 0, x1: 80, y1: 20 }, symbols: [] },
	{ text: 'Calories 170', confidence: 90, bbox: { x0: 0, y0: 30, x1: 120, y1: 50 }, symbols: [] },
	{ text: 'NET 250 g', confidence: 90, bbox: { x0: 0, y0: 60, x1: 120, y1: 80 }, symbols: [] }
])).map((line) => line.text), ['NET 250 g']);
console.log('rule engine checks passed');

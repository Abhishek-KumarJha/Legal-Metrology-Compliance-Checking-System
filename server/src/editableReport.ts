import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import type { ReportInput } from './report.js';

export async function generateComplianceDocx(input: ReportInput, outputDirectory: string) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const children: Paragraph[] = [
    new Paragraph({ text: 'METRO-CHECK', heading: HeadingLevel.TITLE }),
    new Paragraph({ text: 'Legal Metrology Compliance Report', heading: HeadingLevel.HEADING_1 }),
    new Paragraph(`Report ${input.reportId} | Inspection ${input.inspectionId}`),
    new Paragraph(`Company: ${input.companyName} (${input.companyId})`),
    new Paragraph(`Product: ${input.productName} | Category: ${input.productCategory || 'Not specified'}`),
    new Paragraph(`Triggered by: ${input.actorLabel}`),
    new Paragraph(`Completed: ${new Date(input.createdAt).toLocaleString('en-IN')}`),
    new Paragraph({ text: `VERDICT: ${input.status.toUpperCase()} | SCORE: ${input.score}%`, heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: 'Declaration checks', heading: HeadingLevel.HEADING_2 })
  ];
  for (const check of input.checks) {
    const result = check.comparisonStatus === 'mismatch' ? 'MISMATCH' : check.comparisonStatus === 'match' ? 'MATCH' : check.isCompliant ? 'PASS' : 'REVIEW';
    const source = check.status === 'manual-verified' ? 'Officer manually verified' : check.status === 'verified' ? 'OCR-verified' : 'Review required';
    children.push(new Paragraph({ children: [new TextRun({ text: `${result}  ${check.label}: `, bold: true }), new TextRun(check.detectedValue ? `Detected ${check.detectedValue}` : 'No value confirmed'), new TextRun(` | ${check.ruleSection}`), new TextRun(` | Verification source: ${source}`), new TextRun(` | ${check.confidenceNote}`)] }));
  }
  children.push(new Paragraph({ text: 'Evidence photographs', heading: HeadingLevel.HEADING_2 }));
  for (const imagePath of input.imagePaths) {
    try {
      const imageData = await fs.readFile(imagePath);
      children.push(new Paragraph({ children: [new ImageRun({ data: imageData, transformation: { width: 460, height: 300 }, type: 'jpg' })] }));
    } catch {
      children.push(new Paragraph(`Evidence image unavailable: ${path.basename(imagePath)}`));
    }
  }
  children.push(new Paragraph('This editable report is generated from OCR output and the active rule registry. It requires competent-authority review before filing.'));
  const document = new Document({ sections: [{ children }] });
  const filePath = path.join(outputDirectory, `${input.reportId}.docx`);
  await fs.writeFile(filePath, await Packer.toBuffer(document));
  return filePath;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import type { ComparedCheck } from './productMatching.js';

export type ReportInput = {
  reportId: string;
  inspectionId: string;
  companyName: string;
  companyId: string;
  productName: string;
  productCategory: string;
  actorLabel: string;
  createdAt: string;
  status: string;
  score: number;
  checks: ComparedCheck[];
  imagePaths: string[];
};

export async function generateCompliancePdf(input: ReportInput, outputDirectory: string) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const { width, height } = page.getSize();
  let y = height - 50;
  const write = (text: string, size = 10, font = regular, color = rgb(0.1, 0.17, 0.16)) => { page.drawText(text.slice(0, 105), { x: 42, y, size, font, color }); y -= size + 8; };
  const line = () => { page.drawLine({ start: { x: 42, y }, end: { x: width - 42, y }, thickness: 1, color: rgb(0.86, 0.85, 0.8) }); y -= 18; };

  write('METRO-CHECK', 22, bold, rgb(0.06, 0.17, 0.16));
  write('Legal Metrology Compliance Report', 13, bold);
  write(`Report ${input.reportId}  |  Inspection ${input.inspectionId}`, 9);
  line();
  write(`Company: ${input.companyName} (${input.companyId})`, 11, bold);
  write(`Product: ${input.productName} | Category: ${input.productCategory || 'Not specified'}`, 10);
  write(`Triggered by: ${input.actorLabel}`, 10);
  write(`Completed: ${new Date(input.createdAt).toLocaleString('en-IN')}`, 10);
  y -= 5;
  page.drawRectangle({ x: 42, y: y - 24, width: width - 84, height: 38, color: input.status === 'Compliant' ? rgb(0.86, 0.93, 0.89) : rgb(0.96, 0.89, 0.86) });
  page.drawText(`VERDICT: ${input.status.toUpperCase()}    SCORE: ${input.score}%`, { x: 55, y: y - 1, size: 13, font: bold, color: input.status === 'Compliant' ? rgb(0.12, 0.4, 0.34) : rgb(0.65, 0.22, 0.16) });
  y -= 55;
  write('Declaration checks', 14, bold);
  for (const check of input.checks) {
    const value = check.detectedValue ? `Detected: ${check.detectedValue}` : 'Not detected';
    const result = check.comparisonStatus === 'mismatch' ? 'MISMATCH' : check.comparisonStatus === 'match' ? 'MATCH' : check.isCompliant ? 'PASS' : 'FAIL';
    const resultColor = check.comparisonStatus === 'mismatch' ? rgb(0.65, 0.42, 0.08) : check.isCompliant ? rgb(0.12, 0.4, 0.34) : rgb(0.65, 0.22, 0.16);
    page.drawText(`${result}  ${check.label}`, { x: 48, y, size: 10, font: bold, color: resultColor });
    page.drawText(`${value} | ${check.ruleSection}`, { x: 190, y, size: 9, font: regular, color: rgb(0.25, 0.3, 0.28) });
    y -= 19;
    if (check.comparisonStatus === 'mismatch') { page.drawText(`Registered value: ${check.registeredValue ?? 'not supplied'}`, { x: 190, y, size: 8, font: regular, color: resultColor }); y -= 16; }
  }
  y -= 10;
  write('This report is generated from OCR output and the active transparent rule registry. It is not a legal determination without competent-authority review.', 8, regular, rgb(0.4, 0.42, 0.39));

  for (const imagePath of input.imagePaths) {
    try {
      const imageBuffer = await sharp(imagePath).png().toBuffer();
      const image = await pdf.embedPng(imageBuffer);
      const imagePage = pdf.addPage([612, 792]);
      const scale = Math.min(520 / image.width, 650 / image.height, 1);
      imagePage.drawText(`Label evidence for ${input.inspectionId}`, { x: 42, y: 750, size: 13, font: bold });
      imagePage.drawImage(image, { x: (612 - image.width * scale) / 2, y: 80, width: image.width * scale, height: image.height * scale });
    } catch {
      // Keep the report usable if an uploaded file cannot be rendered as an image.
    }
  }

  const filePath = path.join(outputDirectory, `${input.reportId}.pdf`);
  await fs.writeFile(filePath, await pdf.save());
  return filePath;
}

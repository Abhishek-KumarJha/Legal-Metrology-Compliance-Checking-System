import { createWorker } from 'tesseract.js';
import fs from 'node:fs/promises';

export async function extractTextFromImages(filePaths: string[]): Promise<string> {
  if (!filePaths.length) return '';
  const worker = await createWorker('eng');
  try {
    const output: string[] = [];
    for (const filePath of filePaths) {
      const { data } = await worker.recognize(await fs.readFile(filePath));
      if (data.text.trim()) output.push(data.text.trim());
    }
    return output.join('\n');
  } finally {
    await worker.terminate();
  }
}

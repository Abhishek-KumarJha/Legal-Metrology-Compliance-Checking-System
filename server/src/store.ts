import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function readCollection<T>(name: string, fallback: T[]): Promise<T[]> {
  await ensureDataDir();
  const filePath = path.join(dataDir, `${name}.json`);
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeCollection(name, fallback);
    return fallback;
  }
}

export async function writeCollection<T>(name: string, values: T[]) {
  await ensureDataDir();
  const filePath = path.join(dataDir, `${name}.json`);
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(values, null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
}

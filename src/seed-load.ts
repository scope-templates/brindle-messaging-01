/**
 * Reading `data/seed.json`, the twelve months a store starts from. Nothing here writes;
 * `openStore` decides when the seed is wanted.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, emptyData, type Data } from './types.js';

/** The package directory, whether this module is running from `src/` or from `dist/`. */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function seedFile(): string {
  return join(packageRoot(), 'data', 'seed.json');
}

export function readSeed(file: string = seedFile()): Data {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Data>;
  const data = { ...emptyData(), ...parsed };

  for (const name of COLLECTIONS) {
    if (!Array.isArray(data[name])) {
      throw new Error(`${file} has no ${name} in it, so it is not a Brindle seed`);
    }
  }
  if (data.accounts.length === 0 || data.api_keys.length === 0) {
    throw new Error(`${file} has no accounts or no keys in it, so nothing could authenticate`);
  }
  return data;
}

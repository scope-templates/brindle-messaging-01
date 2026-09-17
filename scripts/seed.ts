/**
 * Puts the twelve months in `data/seed.json` into a store by hand. The server does this for itself
 * the first time it finds nothing in `DATA_DIR`; this is for putting it back over a store you have
 * been sending test traffic through.
 */
import { existsSync, rmSync } from 'node:fs';
import { openStore, storeFile } from '../src/store.js';

function main(): void {
  const replace = process.argv.slice(2).includes('--replace');
  const file = storeFile();

  if (existsSync(file)) {
    if (!replace) {
      console.error(`${file} already has a store in it. Run this again with --replace to put the seed back over it.`);
      process.exitCode = 1;
      return;
    }
    rmSync(file);
  }

  const store = openStore();
  console.log(`The seed is in ${file}.`);
  for (const [name, count] of Object.entries(store.counts())) {
    console.log(`  ${String(count).padStart(7)}  ${name}`);
  }
  store.close();
}

main();

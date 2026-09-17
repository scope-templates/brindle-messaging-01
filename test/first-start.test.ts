import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELIVERY_TTL_MS, IDEMPOTENCY_TTL_MS, openStore, storeFile } from '../src/store.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'brindle-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('starting somewhere new', () => {
  it('fills an empty directory from the seed and writes it out', () => {
    const store = openStore({ dataDir: directory });

    expect(existsSync(storeFile(directory))).toBe(true);
    expect(store.data.accounts.length).toBeGreaterThan(200);
    expect(store.data.messages.length).toBeGreaterThan(5000);
    expect(store.data.api_keys.some((key) => key.mode === 'test')).toBe(true);

    const days = store.data.messages.map((message) => message.created_at.slice(0, 10));
    expect(new Set(days.map((day) => day.slice(0, 7))).size).toBe(13);
    expect(days.at(0)).toBe('2025-09-16');
    expect(days.at(-1)).toBe('2026-09-15');

    // Anything the docs promise we do not keep is thrown away as the store opens.
    const now = Date.now();
    expect(
      store.data.idempotency.every((row) => now - Date.parse(row.created_at) < IDEMPOTENCY_TTL_MS),
    ).toBe(true);
    expect(
      store.data.webhook_deliveries.every((row) => now - Date.parse(row.created_at) < DELIVERY_TTL_MS),
    ).toBe(true);
    store.close();
  });

  it('reads back what the last run left behind rather than seeding over it', () => {
    const first = openStore({ dataDir: directory });
    const dropped = first.data.templates.pop();
    if (!dropped) throw new Error('the seed has no templates in it');
    first.save();
    first.close();

    const second = openStore({ dataDir: directory });
    expect(second.data.templates).toHaveLength(first.data.templates.length);
    expect(second.template(dropped.id)).toBeUndefined();
    second.close();
  });
});

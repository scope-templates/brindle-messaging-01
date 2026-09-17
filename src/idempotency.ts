/**
 * `Idempotency-Key` on a POST: the first request under a key is run and its answer kept, and a
 * repeat under the same key gets that answer back. The same key over a different body is refused.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { refuse } from './errors.js';
import type { Store } from './store.js';
import type { IdempotencyRecord } from './types.js';

export const HEADER = 'idempotency-key';
export const REPLAY_HEADER = 'Idempotency-Replayed';
export const MAX_KEY_LENGTH = 255;

export interface Outcome {
  status: number;
  payload: unknown;
}

export function keyOf(request: Request): string | null {
  const value = request.header(HEADER);
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw refuse(
      'invalid_request',
      `Idempotency-Key: ${MAX_KEY_LENGTH} characters at most, and that one was ${trimmed.length}.`,
    );
  }
  return trimmed;
}

/** A body is the same body if it says the same thing, whatever order the keys arrived in. */
export function fingerprint(body: unknown): string {
  return createHash('sha256').update(stable(body)).digest('hex');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(',')}}`;
}

/**
 * Runs `work` under the caller's idempotency key, if they sent one, and writes the answer out.
 */
export async function underKey(
  store: Store,
  request: Request,
  response: Response,
  route: string,
  work: () => Promise<Outcome>,
): Promise<void> {
  const caller = request.caller;
  const key = keyOf(request);
  if (!caller || !key) {
    const outcome = await work();
    response.status(outcome.status).json(outcome.payload);
    return;
  }

  const mark = fingerprint(request.body);
  const seen = store.idempotency(caller.account.id, route, key);

  if (seen) {
    if (seen.request_fingerprint !== mark) {
      throw refuse(
        'idempotency_conflict',
        `Idempotency-Key "${key}" was used on ${route} with a different body. Use a new key.`,
      );
    }
    response.setHeader(REPLAY_HEADER, 'true');
    response.status(seen.status).json(seen.response);
    return;
  }

  const outcome = await work();
  const record: IdempotencyRecord = {
    account_id: caller.account.id,
    key,
    route,
    request_fingerprint: mark,
    status: outcome.status,
    response: outcome.payload,
    created_at: new Date().toISOString(),
  };
  store.rememberIdempotency(record);
  response.status(outcome.status).json(outcome.payload);
}

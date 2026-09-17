/**
 * `Authorization: Bearer <key>` on everything under `/v1`. A test key is accepted like a live one
 * and everything it does is recorded, but its messages are marked `sandboxed` and never sent.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Account, ApiKey } from './types.js';
import { refuse } from './errors.js';
import type { Store } from './store.js';

export interface Caller {
  account: Account;
  key: ApiKey;
  sandboxed: boolean;
}

declare global {
  namespace Express {
    interface Request {
      caller?: Caller;
    }
  }
}

export const LIVE_PREFIX = 'bk_live_';
export const TEST_PREFIX = 'bk_test_';

export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const value = rest.join('');
  return value.length > 0 ? value : null;
}

export function requireKey(store: Store) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const presented = bearerFrom(request.header('authorization'));
    if (!presented) {
      next(
        refuse(
          'authentication_required',
          'Send your key as an Authorization header: `Authorization: Bearer bk_live_...`.',
        ),
      );
      return;
    }

    const key = store.keyByValue(presented);
    const account = key ? store.account(key.account_id) : undefined;
    if (!key || !account) {
      next(refuse('invalid_key', 'That key is not one of ours. Check which environment it came from.'));
      return;
    }

    touch(store, key);
    request.caller = { account, key, sandboxed: key.mode === 'test' };
    next();
  };
}

/**
 * Keys carry the day they were last used, which is what the dashboard shows and what support looks
 * at when an integration goes quiet. A day is as fine as anybody needs it, so a key that has
 * already been used today is left alone rather than writing the store out on every request.
 */
function touch(store: Store, key: ApiKey): void {
  const now = new Date().toISOString();
  if (key.last_used_at?.slice(0, 10) === now.slice(0, 10)) return;
  key.last_used_at = now;
  store.save();
}

export function callerOf(request: Request): Caller {
  const caller = request.caller;
  if (!caller) throw new Error('a route under /v1 was reached without a key');
  return caller;
}

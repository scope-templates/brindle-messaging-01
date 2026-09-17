/**
 * A request budget per account, held in memory. The window opens on an account's first request and
 * runs for a minute. It counts requests, not messages, so a batch of five hundred costs one.
 */
import type { NextFunction, Request, Response } from 'express';
import { callerOf, type Caller } from './auth.js';
import { refuse } from './errors.js';

const WINDOW_MS = 60_000;

interface Window {
  startedAt: number;
  used: number;
}

export class Budget {
  private readonly windows = new Map<string, Window>();

  /** Take one request off the account's minute. Returns what the headers should say. */
  spend(caller: Caller, now = Date.now()): { limit: number; remaining: number; resetAt: number; allowed: boolean } {
    const limit = caller.account.rate_limit_per_minute;
    const current = this.windows.get(caller.account.id);
    const window =
      current && now - current.startedAt < WINDOW_MS ? current : { startedAt: now, used: 0 };
    this.windows.set(caller.account.id, window);

    const allowed = window.used < limit;
    if (allowed) window.used += 1;

    return {
      limit,
      remaining: Math.max(limit - window.used, 0),
      resetAt: Math.ceil((window.startedAt + WINDOW_MS) / 1000),
      allowed,
    };
  }
}

export function meter(budget: Budget) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const spent = budget.spend(callerOf(request));
    response.setHeader('X-RateLimit-Limit', String(spent.limit));
    response.setHeader('X-RateLimit-Remaining', String(spent.remaining));
    response.setHeader('X-RateLimit-Reset', String(spent.resetAt));

    if (!spent.allowed) {
      const after = Math.max(spent.resetAt - Math.floor(Date.now() / 1000), 1);
      response.setHeader('Retry-After', String(after));
      next(
        refuse(
          'rate_limited',
          `Your plan allows ${spent.limit} requests a minute. Try again in ${after} seconds.`,
        ),
      );
      return;
    }
    next();
  };
}

/**
 * The loop that actually posts webhook deliveries. The server starts one; it wakes on a timer,
 * takes the deliveries whose backoff has run out and attempts each one. Every attempt has its own
 * timeout, so an endpoint that never answers costs the loop ten seconds and nothing else.
 */
import { attemptDelivery, isDue, type Poster } from './webhooks.js';
import type { Store } from './store.js';

// FIXME(BRN-38): attempts only go out on this tick, so the 2s and 10s backoffs each stretch to 45s.
export const EVERY_MS = 45_000;
export const FIRST_RUN_AFTER_MS = 5_000;
export const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
/** How many endpoints to hold open at once. */
const AT_ONCE = 8;

export interface Run {
  attempted: number;
  landed: number;
}

export class Dispatcher {
  private readonly store: Store;
  private readonly send: Poster | undefined;
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;
  private prunedAt = Date.now();

  constructor(store: Store, send?: Poster) {
    this.store = store;
    this.send = send;
  }

  /** One pass over everything that is due. Overlapping passes are skipped, not queued. */
  async runOnce(now: Date = new Date()): Promise<Run> {
    if (this.running) return { attempted: 0, landed: 0 };
    this.running = true;
    try {
      const due = this.store.pendingDeliveries().filter((delivery) => isDue(delivery, now.getTime()));
      let landed = 0;

      for (let at = 0; at < due.length; at += AT_ONCE) {
        const slice = due.slice(at, at + AT_ONCE);
        await Promise.all(
          slice.map(async (delivery) => {
            const hook = this.store.webhook(delivery.webhook_id);
            if (!hook || !hook.active) return;
            await attemptDelivery(this.store, delivery, hook, this.send);
            if (delivery.status === 'succeeded') landed += 1;
          }),
        );
      }

      if (now.getTime() - this.prunedAt >= PRUNE_EVERY_MS) {
        this.prunedAt = now.getTime();
        this.store.prune(now);
      }

      return { attempted: due.length, landed };
    } finally {
      this.running = false;
    }
  }

  start(everyMs = EVERY_MS, firstAfterMs = FIRST_RUN_AFTER_MS): void {
    if (this.timer) return;
    this.first = setTimeout(() => {
      this.first = null;
      void this.runOnce();
    }, firstAfterMs);
    this.first.unref();

    this.timer = setInterval(() => void this.runOnce(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = null;
    this.timer = null;
  }
}

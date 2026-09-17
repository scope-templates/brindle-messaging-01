/**
 * What happens to a message after it is accepted. Carrier outcomes are simulated: the fate of a
 * message is worked out from its id, so the same message always ends the same way. Everything
 * downstream is driven from the events it produces.
 */
import { newId, spread } from './ids.js';
import type { Store } from './store.js';
import { queueDeliveries } from './webhooks.js';
import type {
  Channel,
  EventType,
  Message,
  MessageEvent,
  MessageStatus,
  Suppression,
  SuppressionReason,
} from './types.js';

interface Step {
  type: EventType;
  after: number;
  detail: string | null;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const BOUNCE_DETAIL = 'The receiving server said the address does not exist.';
const FAILED_DETAIL = 'The carrier would not take the message and will not take it again.';

/** The whole life of a message, as offsets in milliseconds from the moment it was accepted. */
export function planFor(message: Pick<Message, 'id' | 'channel' | 'sandboxed'>): Step[] {
  const { id, channel } = message;
  const steps: Step[] = [{ type: 'sent', after: 2 * SECOND, detail: null }];

  if (message.sandboxed) {
    steps.push({ type: 'delivered', after: 3 * SECOND, detail: 'Test key: nothing left Brindle.' });
    return steps;
  }

  const handover = 4 * SECOND + Math.floor(spread(id, 'handover') * 16 * SECOND);
  const fate = spread(id, 'fate');
  const settled = settle(channel, fate);

  if (settled === 'delivered') {
    steps.push({ type: 'delivered', after: handover, detail: null });
    if (channel === 'email' && spread(id, 'open') < 0.44) {
      steps.push({ type: 'opened', after: handover + 6 * MINUTE, detail: null });
      if (spread(id, 'click') < 0.26) {
        steps.push({ type: 'clicked', after: handover + 11 * MINUTE, detail: null });
      }
    }
    if (channel === 'email' && spread(id, 'complaint') < 0.004) {
      steps.push({
        type: 'complaint',
        after: handover + 3 * HOUR,
        detail: 'The recipient marked this as spam at their provider.',
      });
    }
    return steps;
  }

  steps.push({
    type: settled,
    after: handover,
    detail: settled === 'bounced' ? BOUNCE_DETAIL : FAILED_DETAIL,
  });
  return steps;
}

function settle(channel: Channel, fate: number): 'delivered' | 'bounced' | 'failed' {
  if (channel === 'email') {
    if (fate < 0.972) return 'delivered';
    return fate < 0.991 ? 'bounced' : 'failed';
  }
  return fate < 0.958 ? 'delivered' : 'failed';
}

/** The event types that are the end of a message; anything after them is engagement. */
export function statusAfter(current: MessageStatus, event: EventType): MessageStatus {
  switch (event) {
    case 'sent':
      return current === 'queued' ? 'sent' : current;
    case 'delivered':
    case 'bounced':
    case 'failed':
      return event;
    default:
      return current;
  }
}

export function recordEvent(
  store: Store,
  message: Message,
  type: EventType,
  occurredAt: Date,
  detail: string | null = null,
): MessageEvent {
  const event: MessageEvent = {
    id: newId('evt'),
    message_id: message.id,
    account_id: message.account_id,
    type,
    occurred_at: occurredAt.toISOString(),
    detail,
  };
  store.addEvent(event);
  message.status = statusAfter(message.status, type);
  suppressIfNeeded(store, message, event);
  queueDeliveries(store, event);
  return event;
}

const SUPPRESS_ON: Partial<Record<EventType, SuppressionReason>> = {
  bounced: 'hard_bounce',
  complaint: 'complaint',
};

/**
 * A hard bounce or a complaint puts the recipient on the account's suppression list. Carrying on
 * writing to an address that has done either is how a sending domain gets itself refused.
 */
function suppressIfNeeded(store: Store, message: Message, event: MessageEvent): void {
  const reason = SUPPRESS_ON[event.type];
  if (!reason) return;
  const row: Suppression = {
    account_id: message.account_id,
    address: message.to,
    reason,
    created_at: event.occurred_at,
  };
  store.addSuppression(row);
}

interface InFlight {
  message: Message;
  steps: Step[];
  next: number;
  acceptedAt: number;
}

/**
 * Holds the messages that have been accepted but have not finished yet, and moves them on as their
 * timings come round. The server runs one of these on a timer; the tests drive `runDue` by hand.
 */
export class Carrier {
  private readonly store: Store;
  private readonly inFlight = new Map<string, InFlight>();
  private timer: NodeJS.Timeout | null = null;

  constructor(store: Store) {
    this.store = store;
  }

  /** Record the `queued` event and take the message on. */
  accept(message: Message, at: Date = new Date()): MessageEvent {
    const event = recordEvent(this.store, message, 'queued', at);
    this.inFlight.set(message.id, {
      message,
      steps: planFor(message),
      next: 0,
      acceptedAt: at.getTime(),
    });
    return event;
  }

  get waiting(): number {
    return this.inFlight.size;
  }

  /** Apply every step that is due by `now`. Returns how many events that came to. */
  runDue(now: Date = new Date()): number {
    let written = 0;
    for (const [id, flight] of this.inFlight) {
      while (flight.next < flight.steps.length) {
        const step = flight.steps[flight.next];
        if (!step) break;
        const due = flight.acceptedAt + step.after;
        if (due > now.getTime()) break;
        recordEvent(this.store, flight.message, step.type, new Date(due), step.detail);
        flight.next += 1;
        written += 1;
      }
      if (flight.next >= flight.steps.length) this.inFlight.delete(id);
    }
    return written;
  }

  start(everyMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runDue(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

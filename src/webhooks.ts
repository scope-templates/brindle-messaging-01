/**
 * Webhooks: signing, delivery records and one attempt at one delivery. Bodies carry
 * `Brindle-Signature: t=<unix seconds>,v1=<hex>`, an HMAC of `<t>.<body>` under the endpoint's
 * secret; the timestamp is inside the signed string so an old body cannot be replayed later.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { newId } from './ids.js';
import type { Store } from './store.js';
import type { MessageEvent, Webhook, WebhookDelivery } from './types.js';

export const SIGNATURE_HEADER = 'Brindle-Signature';
/** How far out of step a receiver should let a timestamp be before refusing the body. */
export const TOLERANCE_SECONDS = 300;
/** How long we wait for an endpoint to answer before giving up on the attempt. */
export const ANSWER_TIMEOUT_MS = 10_000;

/**
 * The waits between attempts, in seconds. The first attempt is made as soon as the delivery is
 * written; five waits after it means six attempts in all, over about a quarter of an hour.
 */
export const BACKOFF_SECONDS = [2, 10, 60, 300, 600] as const;
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${sign(secret, timestamp, body)}`;
}

export function parseSignature(header: string): { t: number; v1: string } | null {
  const parts = new Map<string, string>();
  for (const piece of header.split(',')) {
    const at = piece.indexOf('=');
    if (at > 0) parts.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
  }
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!Number.isFinite(t) || !v1) return null;
  return { t, v1 };
}

/** The check Brindle asks receivers to make, kept here so the docs and the tests agree with it. */
export function verify(header: string, secret: string, body: string, now = Date.now()): boolean {
  const parsed = parseSignature(header);
  if (!parsed) return false;
  if (Math.abs(Math.floor(now / 1000) - parsed.t) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(sign(secret, parsed.t, body), 'utf8');
  const presented = Buffer.from(parsed.v1, 'utf8');
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

export function bodyFor(store: Store, event: MessageEvent): string {
  const message = store.message(event.message_id);
  return JSON.stringify({
    id: event.id,
    type: `message.${event.type}`,
    occurred_at: event.occurred_at,
    data: {
      message_id: event.message_id,
      channel: message?.channel ?? null,
      to: message?.to ?? null,
      status: message?.status ?? null,
      tags: message?.tags ?? [],
      detail: event.detail,
    },
  });
}

/** One pending record per endpoint that asked for this event type. */
export function queueDeliveries(store: Store, event: MessageEvent): WebhookDelivery[] {
  const made: WebhookDelivery[] = [];
  for (const hook of store.webhooksFor(event.account_id)) {
    if (!hook.active || !hook.events.includes(event.type)) continue;
    const delivery: WebhookDelivery = {
      id: newId('whd'),
      webhook_id: hook.id,
      account_id: event.account_id,
      event_id: event.id,
      event_type: event.type,
      status: 'pending',
      attempts: 0,
      last_error: null,
      created_at: event.occurred_at,
      updated_at: event.occurred_at,
    };
    store.addDelivery(delivery);
    made.push(delivery);
  }
  return made;
}

/** The wait before the next attempt, given how many have already been made. */
export function backoffSeconds(attempts: number): number {
  return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1] ?? 600;
}

/** Whether a delivery is ready for another go. */
export function isDue(delivery: WebhookDelivery, now: number): boolean {
  if (delivery.status !== 'pending') return false;
  if (delivery.attempts === 0) return true;
  if (delivery.attempts >= MAX_ATTEMPTS) return false;
  const waited = (now - Date.parse(delivery.updated_at)) / 1000;
  return waited >= backoffSeconds(delivery.attempts);
}

export type Poster = (url: string, init: RequestInit) => Promise<{ status: number }>;

const post: Poster = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status };
};

/**
 * One attempt at one delivery. A 2xx settles it; anything else, a connection that will not open,
 * or an endpoint that does not answer inside `ANSWER_TIMEOUT_MS`, is written down against the
 * record. After `MAX_ATTEMPTS` the record is marked failed and nobody tries it again.
 */
export async function attemptDelivery(
  store: Store,
  delivery: WebhookDelivery,
  hook: Webhook,
  send: Poster = post,
): Promise<WebhookDelivery> {
  const body = bodyForEvent(store, delivery);
  const timestamp = Math.floor(Date.now() / 1000);

  delivery.attempts += 1;
  delivery.updated_at = new Date().toISOString();

  try {
    const response = await send(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signatureHeader(hook.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
    });
    if (response.status >= 200 && response.status < 300) {
      delivery.status = 'succeeded';
      delivery.last_error = null;
    } else {
      delivery.last_error = `The endpoint answered ${response.status}.`;
      delivery.status = delivery.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    }
  } catch (error) {
    delivery.last_error = describe(error);
    delivery.status = delivery.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  }

  store.save();
  return delivery;
}

/** What to write against the record. `fetch` on its own says "fetch failed"; the cause says why. */
function describe(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `The endpoint did not answer within ${ANSWER_TIMEOUT_MS / 1000} seconds.`;
  }
  if (!(error instanceof Error)) return String(error);
  const because = error.cause instanceof Error ? error.cause.message : '';
  return because ? `${error.message}: ${because}` : error.message;
}

function bodyForEvent(store: Store, delivery: WebhookDelivery): string {
  const event = store.data.events.find((row) => row.id === delivery.event_id);
  if (event) return bodyFor(store, event);
  return JSON.stringify({
    id: delivery.event_id,
    type: `message.${delivery.event_type}`,
    occurred_at: delivery.created_at,
    data: { message_id: null, channel: null, to: null, status: null, tags: [], detail: null },
  });
}

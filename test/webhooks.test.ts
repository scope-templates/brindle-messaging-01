import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptDelivery, signatureHeader, verify } from '../src/webhooks.js';
import { brindle, headers, serving, HOOK_ID, HOOK_SECRET, type Serving, type UnderTest } from './harness.js';

let brindleUnderTest: UnderTest;
let api: Serving;

beforeEach(async () => {
  brindleUnderTest = brindle();
  api = await serving(brindleUnderTest.app);
});

afterEach(async () => {
  brindleUnderTest.carrier.stop();
  await api.stop();
});

describe('webhook endpoints', () => {
  it('hands the secret over once, when the endpoint is made, and not again', async () => {
    const made = await fetch(`${api.url}/v1/webhooks`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ url: 'https://api.wainstall-cycles.co.uk/hooks/second', events: ['delivered'] }),
    });
    const hook = (await made.json()) as { id: string; secret?: string };

    const listed = await fetch(`${api.url}/v1/webhooks`, { headers: headers() });
    const page = (await listed.json()) as { data: { id: string; secret?: string }[] };

    expect(made.status).toBe(201);
    expect(hook.secret?.startsWith('whsec_')).toBe(true);
    expect(page.data.every((row) => row.secret === undefined)).toBe(true);

    const off = await fetch(`${api.url}/v1/webhooks/${hook.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ active: false }),
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { active: boolean }).active).toBe(false);
    expect(brindleUnderTest.store.webhook(hook.id)?.active).toBe(false);

    const removed = await fetch(`${api.url}/v1/webhooks/${hook.id}`, { method: 'DELETE', headers: headers() });
    const gone = await fetch(`${api.url}/v1/webhooks/${hook.id}/deliveries`, { headers: headers() });

    expect(removed.status).toBe(204);
    expect(((await gone.json()) as { code: string }).code).toBe('webhook_not_found');
  });

  it('writes a delivery only for the event types the endpoint asked for', async () => {
    const sent = await fetch(`${api.url}/v1/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ to: 'tobias.ingham@brookmail.com', channel: 'email', subject: 'Ready', body: '<p>Ready.</p>' }),
    });
    await sent.json();
    brindleUnderTest.carrier.runDue(new Date(Date.now() + 60 * 60 * 1000));

    const response = await fetch(`${api.url}/v1/webhooks/${HOOK_ID}/deliveries`, { headers: headers() });
    const page = (await response.json()) as { data: { event_type: string; attempts: number }[] };

    expect(page.data.length).toBeGreaterThan(0);
    for (const delivery of page.data) {
      expect(['delivered', 'bounced']).toContain(delivery.event_type);
      expect(delivery.attempts).toBe(0);
    }

    const waiting = brindleUnderTest.store.deliveriesFor(HOOK_ID)[0];
    const hook = brindleUnderTest.store.webhook(HOOK_ID);
    if (!waiting || !hook) throw new Error('the fixture lost a webhook');

    await attemptDelivery(brindleUnderTest.store, waiting, hook, async () => ({ status: 503 }));
    expect(waiting.attempts).toBe(1);
    expect(waiting.status).toBe('pending');
    expect(waiting.last_error).toBe('The endpoint answered 503.');

    await attemptDelivery(brindleUnderTest.store, waiting, hook, async () => ({ status: 200 }));
    expect(waiting.attempts).toBe(2);
    expect(waiting.status).toBe('succeeded');
    expect(waiting.last_error).toBe(null);
  });

  it('signs a body so a receiver can tell it came from us and has not been changed', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'message.delivered' });
    const now = Date.now();
    const header = signatureHeader(HOOK_SECRET, Math.floor(now / 1000), body);

    expect(verify(header, HOOK_SECRET, body, now)).toBe(true);
    expect(verify(header, HOOK_SECRET, `${body} `, now)).toBe(false);
    expect(verify(header, 'whsec_somebodyelses', body, now)).toBe(false);
    expect(verify(header, HOOK_SECRET, body, now + 20 * 60 * 1000)).toBe(false);
  });
});

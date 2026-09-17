import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planFor } from '../src/delivery.js';
import { brindle, headers, serving, type Serving, type UnderTest } from './harness.js';

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

describe('what happened to a message', () => {
  it('writes a queued event the moment a message is taken', async () => {
    const sent = await fetch(`${api.url}/v1/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ to: '+447700900455', channel: 'sms', body: 'Ready to collect.' }),
    });
    const message = (await sent.json()) as { id: string; created_at: string };

    const response = await fetch(`${api.url}/v1/messages/${message.id}/events`, { headers: headers() });
    const events = (await response.json()) as { type: string; occurred_at: string }[];

    expect(response.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('queued');
    expect(events[0]?.occurred_at).toBe(message.created_at);

    const somebodyElses = await fetch(`${api.url}/v1/messages/msg_netherby1`, { headers: headers() });
    expect(somebodyElses.status).toBe(404);
    expect(((await somebodyElses.json()) as { code: string }).code).toBe('message_not_found');
  });

  it('carries a message through to its outcome and moves the status with it', async () => {
    const sent = await fetch(`${api.url}/v1/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ to: 'kieran.yarrow@brookmail.com', channel: 'email', subject: 'Ready', body: '<p>Ready.</p>' }),
    });
    const message = (await sent.json()) as { id: string };

    brindleUnderTest.carrier.runDue(new Date(Date.now() + 60 * 60 * 1000));

    const response = await fetch(`${api.url}/v1/messages/${message.id}/events`, { headers: headers() });
    const events = (await response.json()) as { type: string }[];
    const types = events.map((event) => event.type);

    const read = await fetch(`${api.url}/v1/messages/${message.id}`, { headers: headers() });
    const after = (await read.json()) as { status: string };

    expect(types.slice(0, 2)).toEqual(['queued', 'sent']);
    expect(['delivered', 'bounced', 'failed']).toContain(types[2]);
    expect(after.status).toBe(types.filter((type) => type !== 'opened' && type !== 'clicked').at(-1));
    expect(brindleUnderTest.carrier.waiting).toBe(0);
  });

  it('never reports an open or a click on a text message, and never bounces a sandboxed one', () => {
    const text = planFor({ id: 'msg_readyforthepost', channel: 'sms', sandboxed: false });
    const trial = planFor({ id: 'msg_readyforthepost', channel: 'email', sandboxed: true });

    expect(text.map((step) => step.type)).not.toContain('opened');
    expect(text.map((step) => step.type)).not.toContain('clicked');
    expect(trial.map((step) => step.type)).toEqual(['sent', 'delivered']);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordEvent } from '../src/delivery.js';
import { brindle, headers, serving, SUPPRESSED, WAINSTALL, type Serving, type UnderTest } from './harness.js';

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

function send(to: string) {
  return fetch(`${api.url}/v1/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ to, channel: 'email', subject: 'Your order', body: '<p>On its way.</p>' }),
  });
}

describe('the suppression list', () => {
  it('will not write to an address on the list, and says which one', async () => {
    const response = await send(SUPPRESSED);
    const problem = (await response.json()) as { code: string; detail: string };

    expect(response.status).toBe(422);
    expect(problem.code).toBe('recipient_suppressed');
    expect(problem.detail).toContain(SUPPRESSED);
  });

  it('takes an address on to the list and puts it at the top of it', async () => {
    const added = await fetch(`${api.url}/v1/suppressions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ address: 'zara.tewson@brookmail.com', reason: 'complaint' }),
    });
    expect(added.status).toBe(201);

    const listed = await fetch(`${api.url}/v1/suppressions`, { headers: headers() });
    const page = (await listed.json()) as { data: { address: string; reason: string }[]; next_cursor: string | null };

    expect(page.data[0]?.address).toBe('zara.tewson@brookmail.com');
    expect(page.data[0]?.reason).toBe('complaint');
    expect(page.data).toHaveLength(2);
  });

  it('lets an address off the list, and the next send goes through', async () => {
    const removed = await fetch(`${api.url}/v1/suppressions/${encodeURIComponent(SUPPRESSED)}`, {
      method: 'DELETE',
      headers: headers(),
    });
    const after = await send(SUPPRESSED);

    expect(removed.status).toBe(204);
    expect(after.status).toBe(201);

    const never = await fetch(`${api.url}/v1/suppressions/nobody@brookmail.com`, {
      method: 'DELETE',
      headers: headers(),
    });

    expect(never.status).toBe(404);
    expect(((await never.json()) as { code: string }).code).toBe('suppression_not_found');
  });

  it('puts a recipient on the list itself when a message bounces or is marked as spam', () => {
    const bounced = brindleUnderTest.store.message('msg_week1');
    const complained = brindleUnderTest.store.message('msg_week4');
    if (!bounced || !complained) throw new Error('the fixture lost a message');

    recordEvent(brindleUnderTest.store, bounced, 'bounced', new Date(), 'No such address.');
    recordEvent(brindleUnderTest.store, complained, 'complaint', new Date());

    expect(brindleUnderTest.store.suppression(WAINSTALL, bounced.to)?.reason).toBe('hard_bounce');
    expect(brindleUnderTest.store.suppression(WAINSTALL, complained.to)?.reason).toBe('complaint');
  });
});

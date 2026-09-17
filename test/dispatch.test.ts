import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/dispatch.js';
import type { Poster } from '../src/webhooks.js';
import { brindle, headers, serving, HOOK_ID, type Serving, type UnderTest } from './harness.js';

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

/** Send one message and take it through to an outcome, which leaves a delivery waiting. */
async function somethingToPost(): Promise<void> {
  await fetch(`${api.url}/v1/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ to: 'wren.nairn@brookmail.com', channel: 'email', subject: 'Ready', body: '<p>Ready.</p>' }),
  });
  brindleUnderTest.carrier.runDue(new Date(Date.now() + 60 * 60 * 1000));
}

describe('the delivery loop', () => {
  it('posts the deliveries that are waiting and marks them landed', async () => {
    await somethingToPost();

    const posted: { url: string; signed: boolean }[] = [];
    const takeIt: Poster = async (url, init) => {
      const sent = new Headers(init.headers as Record<string, string>);
      posted.push({ url, signed: Boolean(sent.get('brindle-signature')) });
      return { status: 200 };
    };

    const run = await new Dispatcher(brindleUnderTest.store, takeIt).runOnce();
    const waiting = brindleUnderTest.store.deliveriesFor(HOOK_ID);

    expect(run.attempted).toBeGreaterThan(0);
    expect(run.landed).toBe(run.attempted);
    expect(posted[0]?.url).toBe('https://api.wainstall-cycles.co.uk/hooks/brindle');
    expect(posted[0]?.signed).toBe(true);
    expect(waiting.every((delivery) => delivery.status === 'succeeded')).toBe(true);
    expect(waiting.every((delivery) => delivery.attempts === 1)).toBe(true);
  });

  it('writes down an endpoint that does not answer in time, and leaves it to be tried again', async () => {
    await somethingToPost();

    let armed = false;
    const neverAnswers: Poster = (_url, init) => {
      armed = Boolean(init.signal);
      return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    };

    const run = await new Dispatcher(brindleUnderTest.store, neverAnswers).runOnce();
    const delivery = brindleUnderTest.store.deliveriesFor(HOOK_ID)[0];

    expect(armed).toBe(true);
    expect(run.landed).toBe(0);
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.status).toBe('pending');
    expect(delivery?.last_error).toBe('The endpoint did not answer within 10 seconds.');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const ORDER = {
  to: 'harriet.ilsley@brookmail.com',
  channel: 'email',
  subject: 'Your order is ready',
  body: '<p>Come and get it.</p>',
};

function send(body: unknown, key?: string) {
  return fetch(`${api.url}/v1/messages`, {
    method: 'POST',
    headers: key ? { ...headers(), 'idempotency-key': key } : headers(),
    body: JSON.stringify(body),
  });
}

describe('retrying a send', () => {
  it('gives the first answer back rather than sending a second message', async () => {
    const before = brindleUnderTest.store.data.messages.length;
    const first = (await (await send(ORDER, 'order-8841')).json()) as { id: string };
    const again = await send(ORDER, 'order-8841');
    const second = (await again.json()) as { id: string };

    expect(second.id).toBe(first.id);
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotency-replayed')).toBe('true');
    expect(brindleUnderTest.store.data.messages.length).toBe(before + 1);
  });

  it('refuses the same key over a different message', async () => {
    await send(ORDER, 'order-9002');
    const response = await send({ ...ORDER, to: 'someone.else@brookmail.com' }, 'order-9002');
    const problem = (await response.json()) as { code: string; detail: string };

    expect(response.status).toBe(409);
    expect(problem.code).toBe('idempotency_conflict');
    expect(problem.detail).toContain('order-9002');
  });

  it('sends every time when no key is given', async () => {
    const before = brindleUnderTest.store.data.messages.length;
    await send(ORDER);
    await send(ORDER);

    expect(brindleUnderTest.store.data.messages.length).toBe(before + 2);
  });
});

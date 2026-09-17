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

interface Listing {
  data: { id: string; status: string; channel: string }[];
  next_cursor: string | null;
}

async function list(query: string): Promise<Listing> {
  const response = await fetch(`${api.url}/v1/messages${query}`, { headers: headers() });
  return (await response.json()) as Listing;
}

describe('listing messages', () => {
  it('gives newest first, a page at a time, with a cursor for the next one', async () => {
    const page = await list('?limit=2');

    expect(page.data.map((row) => row.id)).toEqual(['msg_week6', 'msg_week5']);
    expect(page.next_cursor).not.toBe(null);
  });

  it('carries on from where the last page stopped and stops at the end', async () => {
    const first = await list('?limit=4');
    const second = await list(`?limit=4&cursor=${encodeURIComponent(first.next_cursor ?? '')}`);

    expect(second.data.map((row) => row.id)).toEqual(['msg_week2', 'msg_week1']);
    expect(second.next_cursor).toBe(null);

    const tooBig = await fetch(`${api.url}/v1/messages?limit=500`, { headers: headers() });
    const nonsense = await fetch(`${api.url}/v1/messages?cursor=nothinglikeacursor`, { headers: headers() });

    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { code: string }).code).toBe('invalid_request');
    expect(nonsense.status).toBe(400);
    expect(((await nonsense.json()) as { code: string }).code).toBe('invalid_request');
  });

  it('narrows by status and by channel', async () => {
    const delivered = await list('?status=delivered');
    const texts = await list('?channel=sms');

    expect(delivered.data.map((row) => row.id)).toEqual(['msg_week4', 'msg_week3', 'msg_week1']);
    expect(texts.data.map((row) => row.id)).toEqual(['msg_week5', 'msg_week3']);
  });
});

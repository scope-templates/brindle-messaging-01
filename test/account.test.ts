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

describe('the account', () => {
  it('answers with the plan, what the plan allows, and the month so far', async () => {
    const response = await fetch(`${api.url}/v1/account`, { headers: headers() });
    const account = (await response.json()) as {
      plan: string;
      limits: { messages_included_per_month: number; requests_per_minute: number; batch_size: number };
      usage: { period_start: string; messages: number; email: number; sms: number };
    };

    expect(account.plan).toBe('growth');
    expect(account.limits.messages_included_per_month).toBe(150_000);
    expect(account.limits.requests_per_minute).toBe(600);
    expect(account.limits.batch_size).toBe(500);
    expect(account.usage.period_start.endsWith('-01T00:00:00.000Z')).toBe(true);
    expect(account.usage.messages).toBe(account.usage.email + account.usage.sms);

    // A message counts towards the month the moment it is accepted, not when it lands.
    await fetch(`${api.url}/v1/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ to: '+447700900909', channel: 'sms', body: 'Your bike is ready.' }),
    });

    const after = (await (await fetch(`${api.url}/v1/account`, { headers: headers() })).json()) as {
      usage: { messages: number; sms: number };
    };

    expect(after.usage.messages).toBe(account.usage.messages + 1);
    expect(after.usage.sms).toBe(account.usage.sms + 1);
  });

  it('puts the request budget on every answer and refuses once it is spent', async () => {
    const response = await fetch(`${api.url}/v1/account`, { headers: headers() });

    expect(response.headers.get('x-ratelimit-limit')).toBe('600');
    expect(Number(response.headers.get('x-ratelimit-remaining'))).toBe(599);
    expect(Number(response.headers.get('x-ratelimit-reset'))).toBeGreaterThan(0);

    for (let n = 0; n < 599; n += 1) {
      await fetch(`${api.url}/v1/account`, { headers: headers() });
    }

    const refused = await fetch(`${api.url}/v1/account`, { headers: headers() });
    const problem = (await refused.json()) as { code: string };

    expect(refused.status).toBe(429);
    expect(problem.code).toBe('rate_limited');
    expect(refused.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brindle, headers, serving, LIVE_KEY, TEST_KEY, type Serving, type UnderTest } from './harness.js';

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

describe('keys', () => {
  it('turns away a request with no key, and one with a key it never issued', async () => {
    const bare = await fetch(`${api.url}/v1/account`);
    const problem = (await bare.json()) as Record<string, unknown>;

    expect(bare.status).toBe(401);
    expect(bare.headers.get('content-type')).toContain('application/problem+json');
    expect(problem.code).toBe('authentication_required');
    expect(problem.status).toBe(401);
    expect(problem.type).toContain('authentication_required');
    expect(typeof problem.detail).toBe('string');

    const wrong = await fetch(`${api.url}/v1/account`, { headers: headers('bk_live_somebodyelseskey') });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { code: string }).code).toBe('invalid_key');
  });

  it('answers a live key with the account the key belongs to', async () => {
    const response = await fetch(`${api.url}/v1/account`, { headers: headers(LIVE_KEY) });
    const account = (await response.json()) as { name: string; plan: string };

    expect(response.status).toBe(200);
    expect(account.name).toBe('Wainstall Cycles');
    expect(account.plan).toBe('growth');
  });

  it('takes a test key and marks what it sends sandboxed', async () => {
    const response = await fetch(`${api.url}/v1/messages`, {
      method: 'POST',
      headers: headers(TEST_KEY),
      body: JSON.stringify({ to: 'niamh.quayle@brookmail.com', channel: 'email', subject: 'A trial run', body: 'Nothing to see.' }),
    });
    const message = (await response.json()) as { sandboxed: boolean; status: string };

    expect(response.status).toBe(201);
    expect(message.sandboxed).toBe(true);
    expect(message.status).toBe('queued');
  });
});

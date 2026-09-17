import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_VERSION } from '../src/app.js';
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

describe('the API itself', () => {
  it('answers the health check and serves the spec without a key, and names its version on both', async () => {
    const health = await fetch(`${api.url}/health`);
    const up = (await health.json()) as { status: string; version: string };

    expect(health.status).toBe(200);
    expect(up.status).toBe('ok');
    expect(up.version).toBe(API_VERSION);
    expect(health.headers.get('brindle-version')).toBe(API_VERSION);

    const spec = await fetch(`${api.url}/openapi.yaml`);
    const yaml = await spec.text();

    expect(spec.status).toBe(200);
    expect(spec.headers.get('content-type')).toContain('yaml');
    expect(spec.headers.get('brindle-version')).toBe(API_VERSION);
    expect(yaml).toContain('openapi: 3.1.0');
    expect(yaml).toContain(`version: '${API_VERSION}'`);
    expect(yaml).toContain('/v1/messages/batch');
  });


  it('refuses a route it does not have, a body that is not JSON, and one that is too big', async () => {
    const nowhere = await fetch(`${api.url}/v1/parcels`, { headers: headers() });
    const rubbish = await fetch(`${api.url}/v1/messages`, {
      method: 'POST',
      headers: headers(),
      body: '{ this is not json',
    });
    const enormous = await fetch(`${api.url}/v1/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ to: 'wren.nairn@brookmail.com', channel: 'email', subject: 'Big', body: 'x'.repeat(6_000_000) }),
    });

    expect(nowhere.status).toBe(404);
    expect(((await nowhere.json()) as { code: string }).code).toBe('not_found');
    expect(rubbish.status).toBe(400);
    expect(((await rubbish.json()) as { code: string }).code).toBe('invalid_request');
    expect(enormous.status).toBe(413);
    expect(((await enormous.json()) as { code: string }).code).toBe('payload_too_large');
  });
});

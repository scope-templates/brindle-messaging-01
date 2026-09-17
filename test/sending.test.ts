import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  brindle,
  headers,
  serving,
  CODE_TEMPLATE,
  DISPATCH_TEMPLATE,
  OTHER_TEMPLATE,
  type Serving,
  type UnderTest,
} from './harness.js';

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

async function send(body: unknown, key?: string) {
  const response = await fetch(`${api.url}/v1/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('sending a message', () => {
  it('takes a template send and answers with the message as it was queued', async () => {
    const sent = await send({
      to: 'esme.ingham@brookmail.com',
      channel: 'email',
      template_id: DISPATCH_TEMPLATE,
      variables: { first_name: 'Esme', order_number: 'W-4410', link: 'https://wainstall-cycles.co.uk/t/4410' },
      tags: ['delivery'],
    });

    expect(sent.status).toBe(201);
    expect(String(sent.body.id).startsWith('msg_')).toBe(true);
    expect(sent.body.status).toBe('queued');
    expect(sent.body.template_id).toBe(DISPATCH_TEMPLATE);
    expect(sent.body.template_version).toBe(2);
    expect(sent.body.sandboxed).toBe(false);
    expect(sent.body.tags).toEqual(['delivery']);
  });

  it('takes a message written out in the request rather than from a template', async () => {
    const sent = await send({
      to: '+447700900123',
      channel: 'sms',
      body: 'Your bike is ready to collect until Saturday.',
    });

    expect(sent.status).toBe(201);
    expect(sent.body.template_id).toBe(null);
    expect(sent.body.body).toBe('Your bike is ready to collect until Saturday.');
  });

  it('will not send a template from another account, on the wrong channel, or with a gap in it', async () => {
    const missing = await send({ to: 'wren.nairn@brookmail.com', channel: 'email', template_id: 'tmpl_nosuchthing' });
    const somebodyElses = await send({ to: 'wren.nairn@brookmail.com', channel: 'email', template_id: OTHER_TEMPLATE });
    const wrongChannel = await send({ to: 'wren.nairn@brookmail.com', channel: 'email', template_id: CODE_TEMPLATE });
    const short = await send({
      to: 'esme.ingham@brookmail.com',
      channel: 'email',
      template_id: DISPATCH_TEMPLATE,
      variables: { first_name: 'Esme' },
    });

    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('template_not_found');
    expect(somebodyElses.body.code).toBe('template_not_found');
    expect(wrongChannel.status).toBe(422);
    expect(wrongChannel.body.code).toBe('channel_mismatch');
    expect(short.status).toBe(422);
    expect(short.body.code).toBe('variable_missing');
    expect(String(short.body.detail)).toContain('order_number');
  });

  it('refuses an address that cannot be sent to on that channel, and an email with no subject', async () => {
    const notAnAddress = await send({ to: 'wren at brookmail', channel: 'email', subject: 'Hello', body: 'Hello' });
    const notANumber = await send({ to: '07700 900123', channel: 'sms', body: 'Hello' });
    const noSubject = await send({ to: 'wren.nairn@brookmail.com', channel: 'email', body: '<p>Hello</p>' });

    expect(notAnAddress.status).toBe(400);
    expect(notAnAddress.body.code).toBe('invalid_request');
    expect(notANumber.body.code).toBe('invalid_request');
    expect(String(notANumber.body.detail)).toContain('international form');
    expect(noSubject.body.code).toBe('invalid_request');
  });
});

/**
 * The client, run against a Brindle in the same process. `baseUrl` points at a server the test
 * starts, so these exercise the same wire the published package talks over.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brindle as underTest, serving, DISPATCH_TEMPLATE, LIVE_KEY, SUPPRESSED, type Serving, type UnderTest } from '../../../test/harness.js';
import { Brindle, BrindleError } from '../src/index.js';

let running: UnderTest;
let api: Serving;
let client: Brindle;

beforeEach(async () => {
  running = underTest();
  api = await serving(running.app);
  client = new Brindle({ apiKey: LIVE_KEY, baseUrl: api.url });
});

afterEach(async () => {
  running.carrier.stop();
  await api.stop();
});

describe('@brindle/node', () => {
  it('sends a message from a template and reads it back', async () => {
    const sent = await client.messages.send({
      to: 'esme.ingham@brookmail.com',
      channel: 'email',
      templateId: DISPATCH_TEMPLATE,
      variables: { first_name: 'Esme', order_number: 'W-4410', link: 'https://wainstall-cycles.co.uk/t/4410' },
      tags: ['delivery'],
    });

    expect(sent.status).toBe('queued');
    expect(sent.template_version).toBe(2);

    const again = await client.messages.get(sent.id);
    expect(again.id).toBe(sent.id);
    expect(again.to).toBe('esme.ingham@brookmail.com');
  });

  it('sends a message written out in the call', async () => {
    const sent = await client.messages.send({
      to: '+447700900321',
      channel: 'sms',
      body: 'Your bike is ready to collect until Saturday.',
    });

    expect(sent.channel).toBe('sms');
    expect(sent.template_id).toBe(null);
    expect(sent.body).toBe('Your bike is ready to collect until Saturday.');
  });

  it('lists and renders templates', async () => {
    const page = await client.templates.list({ limit: 2 });
    expect(page.data).toHaveLength(2);

    const one = await client.templates.get(DISPATCH_TEMPLATE);
    expect(one.name).toBe('On its way');

    const rendered = await client.templates.render(DISPATCH_TEMPLATE, {
      first_name: 'Orla',
      order_number: 'W-3301',
      link: 'https://wainstall-cycles.co.uk/t/3301',
    });
    expect(rendered.subject).toBe('W-3301 is on its way');
    expect(rendered.body).toContain('Hi Orla,');
  });

  it('throws a BrindleError carrying the code the API refused with', async () => {
    const refusal = await client.messages
      .send({ to: SUPPRESSED, channel: 'email', subject: 'Your order', body: '<p>On its way.</p>' })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(BrindleError);
    const error = refusal as BrindleError;
    expect(error.code).toBe('recipient_suppressed');
    expect(error.status).toBe(422);
    expect(error.title).toBe('Recipient suppressed');
    expect(error.message).toContain(SUPPRESSED);
  });

  it('will not be built without a key', () => {
    expect(() => new Brindle({ apiKey: '' })).toThrow('apiKey');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brindle, headers, serving, DISPATCH_TEMPLATE, type Serving, type UnderTest } from './harness.js';

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

describe('templates', () => {
  it('starts a new template at version one', async () => {
    const response = await fetch(`${api.url}/v1/templates`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Service due',
        channel: 'email',
        subject: 'Your {{item}} is due a service',
        body: '<p>Hello {{first_name}},</p>\n<p>Bring it in any weekday before six.</p>',
      }),
    });
    const template = (await response.json()) as { id: string; current_version: number; channel: string };

    expect(response.status).toBe(201);
    expect(template.current_version).toBe(1);
    expect(template.channel).toBe('email');

    const withASubject = await fetch(`${api.url}/v1/templates`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Collection ready',
        channel: 'sms',
        subject: 'Ready',
        body: 'Your bike is ready to collect.',
      }),
    });

    expect(withASubject.status).toBe(400);
    expect(((await withASubject.json()) as { code: string; detail: string }).detail).toContain('must not have one');
  });

  it('writes a new version on a change and leaves the old wording where it was', async () => {
    const response = await fetch(`${api.url}/v1/templates/${DISPATCH_TEMPLATE}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        subject: '{{order_number}} has left the workshop',
        body: '<p>Hi {{first_name}},</p>\n<p>{{order_number}} is with the courier.</p>',
      }),
    });
    const template = (await response.json()) as { current_version: number; subject: string };

    expect(response.status).toBe(200);
    expect(template.current_version).toBe(3);

    const first = brindleUnderTest.store.versionOf(DISPATCH_TEMPLATE, 1);
    expect(first?.subject).toBe('Your order {{order_number}}');
  });

  it('hands back the whole history of a template', async () => {
    const response = await fetch(`${api.url}/v1/templates/${DISPATCH_TEMPLATE}/versions`, { headers: headers() });
    const versions = (await response.json()) as { version: number }[];

    expect(response.status).toBe(200);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });

  it('renders a template without sending it, escaping what goes into an email', async () => {
    const response = await fetch(`${api.url}/v1/templates/${DISPATCH_TEMPLATE}/render`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        variables: {
          first_name: 'Tom & Sons',
          order_number: 'W-7781',
          link: 'https://wainstall-cycles.co.uk/t/7781',
        },
      }),
    });
    const rendered = (await response.json()) as { subject: string; body: string; version: number };

    expect(response.status).toBe(200);
    expect(rendered.version).toBe(2);
    expect(rendered.subject).toBe('W-7781 is on its way');
    expect(rendered.body).toContain('Tom &amp; Sons');
    expect(rendered.body).not.toContain('Tom & Sons');

    const older = await fetch(`${api.url}/v1/templates/${DISPATCH_TEMPLATE}/render`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ version: 1, variables: { first_name: 'Orla', order_number: 'W-3300' } }),
    });
    const asItWent = (await older.json()) as { subject: string; version: number };

    expect(asItWent.version).toBe(1);
    expect(asItWent.subject).toBe('Your order W-3300');
  });

  it.skip('fills an email subject with values as they are, because a subject is not HTML (BRN-47)', async () => {
    const response = await fetch(`${api.url}/v1/templates/${DISPATCH_TEMPLATE}/render`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        variables: {
          first_name: 'Tom & Sons',
          order_number: 'W-7781 & W-7782',
          link: 'https://wainstall-cycles.co.uk/t/7781',
        },
      }),
    });
    const rendered = (await response.json()) as { subject: string; body: string };

    expect(rendered.subject).toBe('W-7781 & W-7782 is on its way');
    expect(rendered.body).toContain('Tom &amp; Sons');
  });
});

/**
 * A small Brindle to test against: two accounts, three templates, a week of messages, one address
 * on the suppression list and one webhook endpoint. It is held in memory and never touches the
 * disk, so a test can send as much as it likes and the next test starts from the same place.
 *
 * `test/first-start.test.ts` is the one that uses the committed seed instead.
 */
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
import type { Carrier } from '../src/delivery.js';
import { emptyData, type Data, type Message, type MessageEvent } from '../src/types.js';

export const LIVE_KEY = 'bk_live_wainstallcyclesproduction';
export const TEST_KEY = 'bk_test_wainstallcyclesstaging1';
export const OTHER_KEY = 'bk_live_netherbytravelproduction';

export const WAINSTALL = 'acct_wainstall';
export const NETHERBY = 'acct_netherby';
export const DISPATCH_TEMPLATE = 'tmpl_dispatch';
export const CODE_TEMPLATE = 'tmpl_code';
export const OTHER_TEMPLATE = 'tmpl_netherby';
export const SUPPRESSED = 'ada.wardle@brookmail.com';
export const HOOK_ID = 'wh_wainstall';
export const HOOK_SECRET = 'whsec_wainstallfixture';

export function fixtureData(): Data {
  const data = emptyData();

  data.accounts.push(
    {
      id: WAINSTALL,
      name: 'Wainstall Cycles',
      plan: 'growth',
      contact_email: 'platform@wainstall-cycles.co.uk',
      monthly_included: 150_000,
      rate_limit_per_minute: 600,
      created_at: '2024-06-03T09:12:00.000Z',
    },
    {
      id: NETHERBY,
      name: 'Netherby Travel',
      plan: 'starter',
      contact_email: 'ops@netherby-travel.co.uk',
      monthly_included: 25_000,
      rate_limit_per_minute: 300,
      created_at: '2025-02-17T14:40:00.000Z',
    },
  );

  data.api_keys.push(
    {
      id: 'key_wainlive',
      account_id: WAINSTALL,
      key: LIVE_KEY,
      mode: 'live',
      label: 'production',
      created_at: '2024-06-03T09:14:00.000Z',
      last_used_at: '2026-09-06T08:02:00.000Z',
    },
    {
      id: 'key_waintest',
      account_id: WAINSTALL,
      key: TEST_KEY,
      mode: 'test',
      label: 'staging',
      created_at: '2024-06-03T09:15:00.000Z',
      last_used_at: null,
    },
    {
      id: 'key_nethlive',
      account_id: NETHERBY,
      key: OTHER_KEY,
      mode: 'live',
      label: 'production',
      created_at: '2025-02-17T14:41:00.000Z',
      last_used_at: null,
    },
  );

  data.templates.push(
    {
      id: DISPATCH_TEMPLATE,
      account_id: WAINSTALL,
      name: 'On its way',
      channel: 'email',
      current_version: 2,
      created_at: '2025-04-08T10:00:00.000Z',
      updated_at: '2025-11-19T16:20:00.000Z',
    },
    {
      id: CODE_TEMPLATE,
      account_id: WAINSTALL,
      name: 'Two-factor code',
      channel: 'sms',
      current_version: 1,
      created_at: '2025-05-21T11:30:00.000Z',
      updated_at: '2025-05-21T11:30:00.000Z',
    },
    {
      id: OTHER_TEMPLATE,
      account_id: NETHERBY,
      name: 'Booking confirmed',
      channel: 'email',
      current_version: 1,
      created_at: '2025-03-02T08:45:00.000Z',
      updated_at: '2025-03-02T08:45:00.000Z',
    },
  );

  data.template_versions.push(
    {
      id: 'tv_dispatch1',
      template_id: DISPATCH_TEMPLATE,
      version: 1,
      subject: 'Your order {{order_number}}',
      body: '<p>Hello {{first_name}},</p>\n<p>{{order_number}} has left us.</p>',
      created_at: '2025-04-08T10:00:00.000Z',
    },
    {
      id: 'tv_dispatch2',
      template_id: DISPATCH_TEMPLATE,
      version: 2,
      subject: '{{order_number}} is on its way',
      body: '<p>Hi {{first_name}},</p>\n<p>{{order_number}} left us today. Follow it at {{link}}.</p>',
      created_at: '2025-11-19T16:20:00.000Z',
    },
    {
      id: 'tv_code1',
      template_id: CODE_TEMPLATE,
      version: 1,
      subject: null,
      body: '{{code}} is your Wainstall Cycles code. It lasts five minutes.',
      created_at: '2025-05-21T11:30:00.000Z',
    },
    {
      id: 'tv_netherby1',
      template_id: OTHER_TEMPLATE,
      version: 1,
      subject: 'Your booking on {{date}}',
      body: '<p>Hello {{first_name}}, your booking is confirmed for {{date}}.</p>',
      created_at: '2025-03-02T08:45:00.000Z',
    },
  );

  const week: [string, 'email' | 'sms', Message['status'], string][] = [
    ['msg_week1', 'email', 'delivered', '2026-09-01T08:04:11.000Z'],
    ['msg_week2', 'email', 'bounced', '2026-09-01T09:31:40.000Z'],
    ['msg_week3', 'sms', 'delivered', '2026-09-02T07:58:02.000Z'],
    ['msg_week4', 'email', 'delivered', '2026-09-03T10:12:55.000Z'],
    ['msg_week5', 'sms', 'failed', '2026-09-04T16:44:09.000Z'],
    ['msg_week6', 'email', 'queued', '2026-09-06T08:01:37.000Z'],
  ];

  week.forEach(([id, channel, status, at], index) => {
    const message: Message = {
      id,
      account_id: WAINSTALL,
      channel,
      to: channel === 'email' ? `rider${index + 1}@brookmail.com` : `+4477009005${index}0`,
      template_id: channel === 'email' ? DISPATCH_TEMPLATE : CODE_TEMPLATE,
      template_version: channel === 'email' ? 2 : 1,
      variables:
        channel === 'email'
          ? { first_name: 'Orla', order_number: `W-2${index}41`, link: 'https://wainstall-cycles.co.uk/t/9' }
          : { code: `71${index}4` },
      subject: null,
      body: null,
      tags: index % 2 === 0 ? ['delivery'] : ['delivery', 'transactional'],
      status,
      sandboxed: false,
      batch_id: null,
      created_at: at,
    };
    data.messages.push(message);

    const history: MessageEvent['type'][] =
      status === 'queued' ? ['queued'] : status === 'delivered' ? ['queued', 'sent', 'delivered'] : ['queued', 'sent', status];

    history.forEach((type, step) => {
      data.events.push({
        id: `evt_${id.slice(4)}${step}`,
        message_id: id,
        account_id: WAINSTALL,
        type,
        occurred_at: new Date(Date.parse(at) + step * 4000).toISOString(),
        detail: null,
      });
    });
  });

  data.messages.push({
    id: 'msg_netherby1',
    account_id: NETHERBY,
    channel: 'email',
    to: 'guest@pinepost.co.uk',
    template_id: OTHER_TEMPLATE,
    template_version: 1,
    variables: { first_name: 'Idris', date: '2026-09-20' },
    subject: null,
    body: null,
    tags: ['booking'],
    status: 'delivered',
    sandboxed: false,
    batch_id: null,
    created_at: '2026-09-02T12:00:00.000Z',
  });

  data.suppressions.push({
    account_id: WAINSTALL,
    address: SUPPRESSED,
    reason: 'hard_bounce',
    created_at: '2026-08-14T06:22:10.000Z',
  });

  data.webhooks.push({
    id: HOOK_ID,
    account_id: WAINSTALL,
    url: 'https://api.wainstall-cycles.co.uk/hooks/brindle',
    events: ['delivered', 'bounced'],
    secret: HOOK_SECRET,
    active: true,
    created_at: '2025-04-09T09:00:00.000Z',
  });

  return data;
}

export interface UnderTest {
  store: Store;
  app: Express;
  carrier: Carrier;
}

export function brindle(): UnderTest {
  const store = new Store(fixtureData(), null);
  const { app, carrier } = createApp(store);
  return { store, app, carrier };
}

export interface Serving {
  url: string;
  stop: () => Promise<void>;
}

export function serving(app: Express): Promise<Serving> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

export function headers(key: string = LIVE_KEY): Record<string, string> {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

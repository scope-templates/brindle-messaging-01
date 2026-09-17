/**
 * Writes `data/seed.json`, the twelve months of traffic an empty store starts from. It is a
 * thinned extract: every account, key and template, and one message in `THINNING`, kept in the
 * proportions the real months have. One fixed seed, so the file comes out the same every run.
 *
 * Ids, keys and secrets are minted through `src/ids.ts`, and events come from the same carrier
 * plan the running API uses, so seeded rows and rows written a minute ago have the same shape.
 *
 * Run it with `npm run build-seed`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFor, statusAfter } from '../src/delivery.js';
import { fingerprint } from '../src/idempotency.js';
import { draw, mintId, mintKey, mintSecret, type IdPrefix } from '../src/ids.js';
import { publicMessage } from '../src/shape.js';
import { BACKOFF_SECONDS } from '../src/webhooks.js';
import { COLLECTIONS, type Account, type ApiKey, type Channel, type Data, type IdempotencyRecord, type Message, type MessageEvent, type Plan, type Suppression, type SuppressionReason, type Template, type TemplateVersion, type Webhook, type WebhookDelivery } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'data', 'seed.json');

const SEED = 20260615;
const FROM = '2025-09-16';
const TO = '2026-09-15';
const ACCOUNTS = 300;
const TEMPLATES = 52;
const MESSAGES = 10_000;
const SUPPRESSIONS = 400;
const WEBHOOK_ACCOUNTS = 90;
/** One message in this many is kept. Plans are sized from the traffic that implies. */
const THINNING = 1500;
/** Messages still with a carrier when the extract was taken. */
const IN_FLIGHT = 12;
/** The day the batch route shipped. Nothing before it has a batch id. */
const BATCHES_FROM = '2026-06-15';

/* --------------------------------------------------------------------- the dice */

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = makeRandom(SEED);

function int(low: number, high: number): number {
  return low + Math.floor(rnd() * (high - low + 1));
}

function chance(p: number): boolean {
  return rnd() < p;
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(rnd() * items.length)];
  if (item === undefined) throw new Error('picked from an empty list');
  return item;
}

function weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let mark = rnd() * total;
  for (const item of items) {
    mark -= weight(item);
    if (mark <= 0) return item;
  }
  const last = items[items.length - 1];
  if (last === undefined) throw new Error('picked from an empty list');
  return last;
}

/** The same mint the API uses, rolled off the seeded dice instead of the random ones. */
function id(prefix: IdPrefix): string {
  return mintId(prefix, rnd);
}

function keyValue(mode: 'live' | 'test'): string {
  return mintKey(mode, rnd);
}

/* ------------------------------------------------------------------ the calendar */

const DAY = 86_400_000;

function dayNumber(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / DAY;
}

function isoDay(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/** The last day anything in the file may be dated. Nothing is generated past it. */
const LAST_DAY = () => dayNumber(TO);

/**
 * A day at or after `from`, at most `within` days later, and never past the end of the extract.
 * Everything dated relative to something else goes through here.
 */
function dayFrom(from: string, within: number): string {
  const start = Math.min(dayNumber(from.slice(0, 10)), LAST_DAY());
  const span = Math.max(Math.min(LAST_DAY() - start, within), 0);
  return isoDay(start + int(0, span));
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = dayNumber(from); day <= dayNumber(to); day += 1) out.push(isoDay(day));
  return out;
}

function stamp(day: string, hour: number, minute: number, second: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day}T${pad(hour)}:${pad(minute)}:${pad(second)}.000Z`;
}

/**
 * How much traffic a day carries. Weekdays are four or five times a weekend, the business has
 * grown through the year, and there are two weeks in it that were quieter than they should have
 * been: the fortnight over Christmas, when our customers' customers stop buying things.
 */
function dayWeight(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const month = day.slice(0, 7);
  const growth: Record<string, number> = {
    '2025-09': 0.62,
    '2025-10': 0.7,
    '2025-11': 0.86,
    '2025-12': 0.78,
    '2026-01': 0.9,
    '2026-02': 0.95,
    '2026-03': 1.05,
    '2026-04': 1.02,
    '2026-05': 1.14,
    '2026-06': 1.2,
    '2026-07': 1.16,
    '2026-08': 1.1,
    '2026-09': 1.32,
  };
  const week = weekday === 0 ? 0.22 : weekday === 6 ? 0.3 : weekday === 1 ? 1.15 : 1;
  const quiet = day >= '2025-12-22' && day <= '2026-01-02' ? 0.35 : 1;
  return (growth[month] ?? 1) * week * quiet;
}

/** Weekday mornings carry the day: the eight, nine and ten o'clock sends are most of it. */
function timeOnDay(day: string): string {
  const hour = weightedPick(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    (h) => {
      if (h >= 7 && h <= 10) return 22;
      if (h >= 11 && h <= 14) return 11;
      if (h >= 15 && h <= 18) return 8;
      if (h >= 19 && h <= 21) return 4;
      return 1;
    },
  );
  return stamp(day, hour, int(0, 59), int(0, 59));
}

/* ------------------------------------------------------------------- word banks */

const HOUSE_NAMES = [
  'Alderstone', 'Amberwell', 'Arncliffe', 'Bardsley', 'Barrowfield', 'Beckwith', 'Bramhope',
  'Brinscall', 'Calderwick', 'Cawthorne', 'Chellow', 'Cranbeck', 'Dalehead', 'Denholme',
  'Dunsforth', 'Eastrigg', 'Elmsworth', 'Farthinghoe', 'Fleetsend', 'Garrowby', 'Glensyke',
  'Haddonlea', 'Halewood', 'Harbury', 'Hazelrigg', 'Heathersage', 'Holmefield', 'Ingleby',
  'Kirkstall', 'Langsett', 'Lindholme', 'Loxwood', 'Marsden', 'Meanwood', 'Netherby',
  'Norwood', 'Oakenshaw', 'Otterburn', 'Pannal', 'Pickering', 'Quayline', 'Rawdon',
  'Rothwell', 'Saltaire', 'Scholes', 'Shadwell', 'Skipbridge', 'Stanhope', 'Swinnow',
  'Thackley', 'Thorpewood', 'Tollerton', 'Ulverley', 'Wainstall', 'Wetherby', 'Whinmoor',
  'Wortley', 'Yeadon', 'Abbeygate', 'Blakeney', 'Corbridge', 'Duxford', 'Elmswell',
  'Fallowfield', 'Grassington', 'Hollingbourne', 'Inglewhite', 'Jesmond', 'Kettleby',
];

const TRADES = [
  'Software', 'Systems', 'Labs', 'Studio', 'Digital', 'Rentals', 'Travel', 'Logistics',
  'Retail', 'Finance', 'Learning', 'Fitness', 'Grocers', 'Tickets', 'Cycles', 'Energy',
  'Clinic', 'Legal', 'Hire', 'Property', 'Deliveries', 'Payroll', 'Wardrobe', 'Pantry',
  'Works', 'Field', 'Health', 'Books', 'Kitchen', 'Motors',
];

const FIRST_NAMES = [
  'Ada', 'Aisha', 'Alun', 'Bethan', 'Callum', 'Cerys', 'Daniel', 'Deepa', 'Eleri', 'Ellie',
  'Fatima', 'Fraser', 'Gwen', 'Harriet', 'Idris', 'Imogen', 'Jamal', 'Joseph', 'Kirsty',
  'Lachlan', 'Leila', 'Mairead', 'Marcus', 'Nadia', 'Niamh', 'Oliver', 'Orla', 'Priya',
  'Rhodri', 'Rosalind', 'Samir', 'Sian', 'Tobias', 'Tomasz', 'Ursula', 'Viktor', 'Wren',
  'Yusuf', 'Zara', 'Bartek', 'Colm', 'Esme', 'Hafsa', 'Ivor', 'Kieran',
];

const SURNAMES = [
  'Ainsworth', 'Balogun', 'Brightwell', 'Carlisle', 'Chaudhry', 'Dunmore', 'Eastaway',
  'Fairhurst', 'Gallacher', 'Haverstock', 'Ingham', 'Jankowski', 'Keatley', 'Lindfield',
  'Mabbutt', 'Nowak', 'Ogilvie', 'Peascod', 'Quayle', 'Rutherglen', 'Sandhu', 'Thirkell',
  'Underhill', 'Vasilescu', 'Wardle', 'Yarrow', 'Bevan', 'Coulthard', 'Ditchfield',
  'Eglington', 'Fennimore', 'Gillanders', 'Hoxha', 'Ilsley', 'Jarrold', 'Kozlowski',
  'Laverick', 'Musgrove', 'Nairn', 'Ormerod', 'Pennington', 'Rafferty', 'Stanbury', 'Tewson',
];

const MAILBOXES = ['brookmail.com', 'pinepost.co.uk', 'hedgerow.net', 'marchpost.com', 'quill.email', 'wickmail.co.uk', 'stonebridge.email'];

const DIALLING = ['+447700900', '+447700901', '+447700902'];

const TAG_BANK = [
  'transactional', 'order', 'billing', 'account', 'delivery', 'reminder', 'security',
  'onboarding', 'receipt', 'digest', 'alert', 'support', 'renewal', 'shift', 'booking',
];

interface Archetype {
  key: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  tags: string[];
}

const ARCHETYPES: Archetype[] = [
  {
    key: 'order-confirmed',
    channel: 'email',
    name: 'Order confirmed',
    subject: 'Your order {{order_number}} is confirmed',
    body: '<p>Hello {{first_name}},</p>\n<p>Thanks for your order. We have taken {{amount}} and {{order_number}} is with our packers now.</p>\n<p>We will write again the moment it leaves the building.</p>\n<p>{{company}}</p>',
    tags: ['order', 'transactional'],
  },
  {
    key: 'dispatch',
    channel: 'email',
    name: 'On its way',
    subject: '{{order_number}} is on its way',
    body: '<p>Hello {{first_name}},</p>\n<p>{{order_number}} left us this morning and should be with you on {{date}}. The courier will try twice; after that it waits at the depot for a week.</p>\n<p>You can follow it at {{link}}.</p>',
    tags: ['delivery', 'transactional'],
  },
  {
    key: 'password-reset',
    channel: 'email',
    name: 'Reset your password',
    subject: 'Reset your {{company}} password',
    body: '<p>Somebody asked to reset the password on this address. If that was you, use {{link}} within an hour.</p>\n<p>If it was not you, there is nothing to do; the password has not changed.</p>',
    tags: ['security', 'account'],
  },
  {
    key: 'invoice-ready',
    channel: 'email',
    name: 'Invoice ready',
    subject: 'Invoice {{reference}} — {{amount}}',
    body: '<p>Hello {{first_name}},</p>\n<p>Invoice {{reference}} for {{amount}} is ready and is due on {{date}}. It is attached to your account under Billing.</p>\n<p>If the purchase order number on it is wrong, reply to this and we will reissue it.</p>\n<p>{{company}} accounts</p>',
    tags: ['billing', 'receipt'],
  },
  {
    key: 'welcome',
    channel: 'email',
    name: 'Welcome',
    subject: 'Welcome to {{company}}',
    body: '<p>Hello {{first_name}},</p>\n<p>Your account is open. The first thing most people do is add their team, which is under Settings.</p>\n<p>If you get stuck, answer this message; it comes to a person.</p>',
    tags: ['onboarding'],
  },
  {
    key: 'appointment',
    channel: 'email',
    name: 'Appointment reminder',
    subject: 'Your appointment on {{date}}',
    body: '<p>Hello {{first_name}},</p>\n<p>This is a reminder that you are booked in for {{time}} on {{date}} at our {{city}} branch.</p>\n<p>Please give us a day’s notice if you cannot make it, so somebody else can have the slot.</p>',
    tags: ['booking', 'reminder'],
  },
  {
    key: 'renewal',
    channel: 'email',
    name: 'Renewal notice',
    subject: 'Your {{plan}} plan renews on {{date}}',
    body: '<p>Hello {{first_name}},</p>\n<p>Your {{plan}} plan renews on {{date}} and we will take {{amount}} from the card ending {{code}}.</p>\n<p>Change or cancel it at {{link}} any time before then.</p>',
    tags: ['billing', 'renewal'],
  },
  {
    key: 'refund',
    channel: 'email',
    name: 'Refund sent',
    subject: 'We have refunded {{amount}}',
    body: '<p>Hello {{first_name}},</p>\n<p>{{amount}} has gone back to the card you paid on, against {{order_number}}. Banks take three to five working days to show it.</p>',
    tags: ['billing', 'receipt'],
  },
  {
    key: 'digest',
    channel: 'email',
    name: 'Weekly digest',
    subject: 'Your week at {{company}}',
    body: '<p>Hello {{first_name}},</p>\n<p>Here is the week just gone. Nothing needs your attention unless something below is marked for you.</p>\n<p>Open the full view at {{link}}.</p>',
    tags: ['digest'],
  },
  {
    key: 'ticket-reply',
    channel: 'email',
    name: 'Reply on your ticket',
    subject: 'Re: {{reference}}',
    body: '<p>Hello {{first_name}},</p>\n<p>{{adviser_name}} has replied on {{reference}}. Read it and answer at {{link}}; replying to this message works too.</p>',
    tags: ['support'],
  },
  {
    key: 'card-expiring',
    channel: 'email',
    name: 'Card expiring',
    subject: 'The card on your account expires soon',
    body: '<p>Hello {{first_name}},</p>\n<p>The card ending {{code}} expires at the end of {{date}}. Put a new one on at {{link}} and nothing will be interrupted.</p>',
    tags: ['billing', 'account'],
  },
  {
    key: 'shift-published',
    channel: 'email',
    name: 'Rota published',
    subject: 'Your shifts for week beginning {{date}}',
    body: '<p>Hello {{first_name}},</p>\n<p>The rota for the week beginning {{date}} is up. You are on at {{time}} on three days; the whole week is at {{link}}.</p>\n<p>Swaps close on the Thursday before.</p>',
    tags: ['shift'],
  },
  {
    key: 'back-in-stock',
    channel: 'email',
    name: 'Back in stock',
    subject: '{{item}} is back',
    body: '<p>Hello {{first_name}},</p>\n<p>{{item}} is back on the shelf. We have held one for you until {{date}}; after that it goes back to everyone else.</p>\n<p>{{link}}</p>',
    tags: ['alert'],
  },
  {
    key: 'signature',
    channel: 'email',
    name: 'Signature requested',
    subject: '{{company}} needs your signature on {{reference}}',
    body: '<p>Hello {{first_name}},</p>\n<p>{{reference}} is waiting for your signature. It takes a minute at {{link}} and you will get a copy straight after.</p>',
    tags: ['transactional'],
  },
  {
    key: 'two-factor',
    channel: 'sms',
    name: 'Two-factor code',
    subject: null,
    body: '{{code}} is your {{company}} code. It lasts five minutes. We will never ring you and ask for it.',
    tags: ['security'],
  },
  {
    key: 'delivery-window',
    channel: 'sms',
    name: 'Delivery window',
    subject: null,
    body: '{{company}}: {{driver}} will be with you between {{time}} today with {{order_number}}. Reply STOP to stop these.',
    tags: ['delivery'],
  },
  {
    key: 'appointment-sms',
    channel: 'sms',
    name: 'Appointment reminder',
    subject: null,
    body: 'Reminder: {{time}} on {{date}} at {{company}} {{city}}. Reply C to cancel.',
    tags: ['booking', 'reminder'],
  },
  {
    key: 'low-balance',
    channel: 'sms',
    name: 'Low balance',
    subject: null,
    body: '{{company}}: your balance is {{amount}}. Top up at {{link}} to keep things running.',
    tags: ['billing', 'alert'],
  },
  {
    key: 'job-finished',
    channel: 'sms',
    name: 'Job finished',
    subject: null,
    body: '{{company}}: {{reference}} is finished and ready to collect from {{city}} until {{date}}.',
    tags: ['alert'],
  },
  {
    key: 'waitlist',
    channel: 'sms',
    name: 'Waitlist opened',
    subject: null,
    body: '{{company}}: a place has come up at {{time}} on {{date}}. First to reply Y gets it.',
    tags: ['booking'],
  },
];

const CITIES = ['Leeds', 'Sheffield', 'Bristol', 'Glasgow', 'Cardiff', 'Norwich', 'Dundee', 'Plymouth', 'Derby', 'Belfast'];
const ITEMS = ['the olive linen cover', 'the 40mm brass handle', 'the walnut shelf', 'the wide grey runner', 'the small cast pan'];
const PLANS_TEXT = ['Standard', 'Plus', 'Team', 'Studio'];

function variableValue(name: string, company: string, firstName: string): string {
  switch (name) {
    case 'first_name':
      return firstName;
    case 'adviser_name':
      return `${pick(FIRST_NAMES)} ${pick(SURNAMES).slice(0, 1)}`;
    case 'order_number':
      return `${String.fromCharCode(65 + int(0, 5))}-${int(10_000, 99_999)}`;
    case 'reference':
      return `${pick(['INV', 'REF', 'JOB', 'DOC'])}-${int(1000, 9999)}`;
    case 'amount':
      return `£${int(4, 640)}.${String(int(0, 99)).padStart(2, '0')}`;
    case 'date':
      return isoDay(dayNumber(FROM) + int(0, 364));
    case 'time':
      return `${int(8, 18)}:${pick(['00', '15', '30', '45'])}`;
    case 'code':
      return String(int(1000, 9999));
    case 'link':
      return `https://${company.toLowerCase().replace(/[^a-z]/g, '')}.co.uk/a/${draw(8, rnd)}`;
    case 'company':
      return company;
    case 'city':
      return pick(CITIES);
    case 'plan':
      return pick(PLANS_TEXT);
    case 'item':
      return pick(ITEMS);
    case 'driver':
      return pick(FIRST_NAMES);
    default:
      return 'unknown';
  }
}

function placeholdersOf(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
    const name = match[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/* -------------------------------------------------------------------- accounts */

const PLAN_SHAPE: Record<Plan, { included: number; perMinute: number }> = {
  trial: { included: 500, perMinute: 60 },
  starter: { included: 25_000, perMinute: 300 },
  growth: { included: 150_000, perMinute: 600 },
  scale: { included: 1_200_000, perMinute: 1500 },
};

const PLAN_ORDER: Plan[] = ['trial', 'starter', 'growth', 'scale'];

/** The smallest plan whose allowance still has room over the account's busiest month. */
function planForVolume(busiestMonth: number): Plan {
  const wanted = busiestMonth * THINNING * 1.3;
  return PLAN_ORDER.find((plan) => PLAN_SHAPE[plan].included >= wanted) ?? 'scale';
}

/** Put every account on a plan its own traffic fits inside. */
function settlePlans(built: Built[], messages: Message[]): void {
  const perMonth = new Map<string, number>();
  for (const message of messages) {
    const at = `${message.account_id}|${message.created_at.slice(0, 7)}`;
    perMonth.set(at, (perMonth.get(at) ?? 0) + 1);
  }

  const busiest = new Map<string, number>();
  for (const [at, count] of perMonth) {
    const accountId = at.slice(0, at.indexOf('|'));
    busiest.set(accountId, Math.max(busiest.get(accountId) ?? 0, count));
  }

  for (const entry of built) {
    const plan = planForVolume(busiest.get(entry.account.id) ?? 0);
    entry.account.plan = plan;
    entry.account.monthly_included = PLAN_SHAPE[plan].included;
    entry.account.rate_limit_per_minute = PLAN_SHAPE[plan].perMinute;
  }
}

interface Built {
  account: Account;
  slug: string;
  weight: number;
}

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

const WHALE_SINCE = '2025-01-21';

function buildAccounts(): { built: Built[]; keys: ApiKey[]; whale: Built } {
  const built: Built[] = [];
  const keys: ApiKey[] = [];
  const taken = new Set<string>();

  while (built.length < ACCOUNTS) {
    const name = `${pick(HOUSE_NAMES)} ${pick(TRADES)}`;
    if (taken.has(name)) continue;
    taken.add(name);

    const slug = slugOf(name);
    const created = dayFrom('2024-03-04', 900);

    const account: Account = {
      id: id('acct'),
      name,
      // Settled from the account's own traffic once the year has been generated.
      plan: 'trial',
      contact_email: `${pick(['ops', 'platform', 'engineering', 'dev', 'tech'])}@${slug}.co.uk`,
      monthly_included: PLAN_SHAPE.trial.included,
      rate_limit_per_minute: PLAN_SHAPE.trial.perMinute,
      created_at: stamp(created, int(8, 18), int(0, 59), int(0, 59)),
    };

    // A few accounts carry most of the traffic and a long tail barely sends at all.
    const weight = Math.round(2 ** (rnd() * 9));
    built.push({ account, slug, weight });
  }

  // Alphabetical by name, so a list of accounts reads the way a list of accounts ought to.
  built.sort((a, b) => (a.account.name < b.account.name ? -1 : 1));

  // The customer who turns into a quarter of the traffic has been with us since the start of 2025.
  const whale = built.reduce((most, entry) => (entry.weight > most.weight ? entry : most), built[0] as Built);
  whale.account.created_at = stamp(WHALE_SINCE, 10, 41, 6);

  built.forEach((entry, index) => {
    const live: ApiKey = {
      id: id('key'),
      account_id: entry.account.id,
      key: keyValue('live'),
      mode: 'live',
      label: pick(['production', 'production', 'live', 'backend', 'main']),
      created_at: entry.account.created_at,
      last_used_at: null,
    };
    keys.push(live);

    // Most accounts also cut themselves a test key at some point. Not all of them ever do.
    if (index % 10 !== 3 && chance(0.72)) {
      keys.push({
        id: id('key'),
        account_id: entry.account.id,
        key: keyValue('test'),
        mode: 'test',
        label: pick(['staging', 'sandbox', 'local', 'ci']),
        created_at: stamp(dayFrom(entry.account.created_at, 200), int(9, 17), int(0, 59), int(0, 59)),
        last_used_at: null,
      });
    }
  });

  return { built, keys, whale };
}

/* ------------------------------------------------------------------- templates */

interface BuiltTemplate {
  template: Template;
  versions: TemplateVersion[];
  tags: string[];
}

function buildTemplates(built: Built[]): BuiltTemplate[] {
  const out: BuiltTemplate[] = [];
  const heavy = [...built].sort((a, b) => b.weight - a.weight).slice(0, 40);

  for (let n = 0; n < TEMPLATES; n += 1) {
    const owner = heavy[n % heavy.length];
    if (!owner) break;
    const archetype = ARCHETYPES[n % ARCHETYPES.length];
    if (!archetype) break;

    // A template cannot predate the account that owns it, and the first ones went up not long
    // after each account opened.
    const opened = owner.account.created_at.slice(0, 10);
    const firstDay = dayFrom(opened, 240);
    const template: Template = {
      id: id('tmpl'),
      account_id: owner.account.id,
      name: archetype.name,
      channel: archetype.channel,
      current_version: 1,
      created_at: stamp(firstDay, int(9, 17), int(0, 59), int(0, 59)),
      updated_at: stamp(firstDay, int(9, 17), int(0, 59), int(0, 59)),
    };

    const versions: TemplateVersion[] = [
      {
        id: id('tv'),
        template_id: template.id,
        version: 1,
        subject: archetype.subject,
        body: archetype.body,
        created_at: template.created_at,
      },
    ];

    const wanted = int(2, 3);
    let last = firstDay;
    for (let v = 2; v <= wanted; v += 1) {
      last = dayFrom(isoDay(dayNumber(last) + 30), 270);
      const when = stamp(last, int(9, 17), int(0, 59), int(0, 59));
      versions.push({
        id: id('tv'),
        template_id: template.id,
        version: v,
        subject: archetype.subject === null ? null : reword(archetype.subject, v, 'subject'),
        body: reword(archetype.body, v, 'body'),
        created_at: when,
      });
      template.current_version = v;
      template.updated_at = when;
    }

    out.push({ template, versions, tags: archetype.tags });
  }

  return out;
}

/**
 * What a second and third pass at a template look like: the greeting tightened, then a line about
 * how to stop them added to the body. Each version builds on the one before, and subject lines are
 * left alone after the second pass.
 */
function reword(text: string, version: number, part: 'subject' | 'body'): string {
  const tightened = version >= 2 ? text.replace('Hello {{first_name}},', 'Hi {{first_name}},') : text;
  if (version < 3 || part === 'subject') return tightened;
  return tightened.includes('</p>')
    ? `${tightened}\n<p>You can stop these under Notifications in your account.</p>`
    : `${tightened} Reply STOP to stop these.`;
}

/* -------------------------------------------------------------------- messages */

interface Recipient {
  given: string;
  email: string;
  phone: string;
}

/** Whoever this message is for. The name in the variables is the name on the address. */
function recipientFor(slug: string): Recipient {
  const given = pick(FIRST_NAMES);
  const last = pick(SURNAMES).toLowerCase();
  const box = chance(0.82) ? pick(MAILBOXES) : `${slug}.co.uk`;
  return {
    given,
    email: `${given.toLowerCase()}.${last}@${box}`,
    phone: `${pick(DIALLING)}${String(int(0, 999)).padStart(3, '0')}`,
  };
}

interface Traffic {
  messages: Message[];
  events: MessageEvent[];
}

function buildTraffic(built: Built[], whale: Built, templates: BuiltTemplate[], days: string[]): Traffic {
  const messages: Message[] = [];
  const events: MessageEvent[] = [];

  const byAccount = new Map<string, BuiltTemplate[]>();
  for (const entry of templates) {
    const list = byAccount.get(entry.template.account_id);
    if (list) list.push(entry);
    else byAccount.set(entry.template.account_id, [entry]);
  }

  const others = built.filter((entry) => entry !== whale);

  const cutoff = Date.parse(`${TO}T23:59:59.000Z`);
  const weights = days.map(dayWeight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // One busy account bouncing for a week, and one stalled morning still sitting in the queue.
  const badDays = { account: whale.account.id, from: '2026-04-13', to: '2026-04-19' };
  const stuckDay = '2026-06-11';

  days.forEach((day, index) => {
    const share = (weights[index] ?? 0) / totalWeight;
    const forDay = Math.round(MESSAGES * share);

    // Only customers who had opened an account by this day are sending on it.
    const open = others.filter((other) => other.account.created_at < day);
    if (open.length === 0) return;
    const whaleIsOpen = whale.account.created_at < day;

    // From the June release onwards, some sends come in through the batch route.
    let batch: { entry: Built; id: string; at: string; left: number } | null = null;

    for (let n = 0; n < forDay; n += 1) {
      if (batch && batch.left === 0) batch = null;
      const entry: Built = batch
        ? batch.entry
        : whaleIsOpen && chance(0.25)
          ? whale
          : weightedPick(open, (other) => other.weight);

      if (!batch && day >= BATCHES_FROM && chance(0.02) && forDay - n >= 2) {
        batch = {
          entry,
          id: id('batch'),
          at: timeOnDay(day),
          left: int(2, Math.min(200, forDay - n)),
        };
      }

      const sentAt = batch ? batch.at : timeOnDay(day);
      // A template that had not been written by now cannot have been used.
      const owned = (byAccount.get(entry.account.id) ?? []).filter(
        (entry2) => entry2.template.created_at <= sentAt,
      );
      const useTemplate = owned.length > 0 && chance(0.82);
      const chosen = useTemplate ? pick(owned) : null;

      const channel: Channel = chosen
        ? chosen.template.channel
        : chance(0.79)
          ? 'email'
          : 'sms';
      const recipient = recipientFor(entry.slug);
      const given = recipient.given;
      const sandboxed = chance(0.035);

      let variables: Record<string, string> | null = null;
      let templateVersion: number | null = null;
      let subject: string | null = null;
      let body: string | null = null;

      if (chosen) {
        // The newest wording that existed at the time, and not everybody moves the day it is written.
        const written = chosen.versions.filter((row) => row.created_at <= sentAt);
        const usable = written.length > 0 ? written : chosen.versions.slice(0, 1);
        const versionRow = chance(0.86) ? usable[usable.length - 1] : pick(usable);
        if (!versionRow) throw new Error('a template with no versions');
        templateVersion = versionRow.version;
        variables = {};
        for (const name of [...placeholdersOf(versionRow.body), ...placeholdersOf(versionRow.subject ?? '')]) {
          variables[name] = variableValue(name, entry.account.name, given);
        }
      } else if (channel === 'email') {
        subject = pick([
          'Your receipt',
          'A note about your account',
          'Confirmation of your booking',
          'We have had a look at your report',
          'Your export is ready to download',
        ]);
        body = `<p>Hello,</p>\n<p>${pick([
          'This is the confirmation you asked for. Nothing else is needed from you.',
          'Your file is ready and will sit in your account for thirty days.',
          'We have made the change you asked for. If it does not look right, answer this message.',
          'Here is the summary for the period you selected.',
        ])}</p>`;
      } else {
        body = pick([
          'Your code is 4821. It lasts five minutes.',
          'We are running about twenty minutes late today. Sorry.',
          'Your collection is ready. The shop shuts at six.',
          'Confirmed. We will send the details by email as well.',
        ]);
      }

      const tags = chosen ? [...chosen.tags] : [];
      if (chance(0.55)) tags.push(pick(TAG_BANK));

      const message: Message = {
        id: id('msg'),
        account_id: entry.account.id,
        channel,
        to: channel === 'email' ? recipient.email : recipient.phone,
        template_id: chosen ? chosen.template.id : null,
        template_version: templateVersion,
        variables,
        subject,
        body,
        tags: [...new Set(tags)],
        status: 'queued',
        sandboxed,
        batch_id: batch ? batch.id : null,
        created_at: sentAt,
      };
      if (batch) batch.left -= 1;

      const bad =
        message.account_id === badDays.account &&
        channel === 'email' &&
        !sandboxed &&
        day >= badDays.from &&
        day <= badDays.to;

      const stuck =
        !sandboxed &&
        day === stuckDay &&
        Number(message.created_at.slice(11, 13)) >= 6 &&
        Number(message.created_at.slice(11, 13)) < 11;

      messages.push(message);
      events.push(...historyOf(message, cutoff, bad, stuck));
    }
  });

  messages.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

  // The tail of the file was still with a carrier when the extract was taken: queued and sent, and
  // nothing after that yet.
  const stillOut = new Set(
    messages
      .filter((message) => message.status !== 'queued')
      .slice(-IN_FLIGHT)
      .map((message) => {
        message.status = 'sent';
        return message.id;
      }),
  );
  const kept = events.filter(
    (event) => !stillOut.has(event.message_id) || event.type === 'queued' || event.type === 'sent',
  );

  kept.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
  return { messages, events: kept };
}

/**
 * The events behind one message, on the carrier's own plan. Anything that would have happened
 * after the extract was taken is not in the file.
 */
function historyOf(message: Message, cutoff: number, forceBounce: boolean, stuck: boolean): MessageEvent[] {
  const started = Date.parse(message.created_at);
  const steps = planFor(message);
  const out: MessageEvent[] = [
    {
      id: id('evt'),
      message_id: message.id,
      account_id: message.account_id,
      type: 'queued',
      occurred_at: message.created_at,
      detail: null,
    },
  ];
  message.status = 'queued';
  if (stuck) return out;

  for (const step of steps) {
    const at = started + step.after;
    if (at > cutoff) break;

    const type = forceBounce && step.type !== 'sent' ? 'bounced' : step.type;
    const detail =
      forceBounce && type === 'bounced'
        ? 'The receiving server said the sending domain is not allowed to send for it.'
        : step.detail;

    out.push({
      id: id('evt'),
      message_id: message.id,
      account_id: message.account_id,
      type,
      occurred_at: new Date(at).toISOString(),
      detail,
    });
    message.status = statusAfter(message.status, type);
    if (forceBounce && type === 'bounced') break;
  }

  return out;
}

/* ----------------------------------------------------------------- suppressions */

const REASON_TEXT: SuppressionReason[] = ['hard_bounce', 'complaint', 'unsubscribed', 'manual'];

function buildSuppressions(messages: Message[], events: MessageEvent[]): Suppression[] {
  const eventById = new Map<string, MessageEvent[]>();
  for (const event of events) {
    const list = eventById.get(event.message_id);
    if (list) list.push(event);
    else eventById.set(event.message_id, [event]);
  }

  // What Brindle put on the list itself, and when. A later send to the same address means the
  // customer took it off again, so those are not in the file.
  const automatic = new Map<string, { reason: SuppressionReason; at: string }>();
  const lastTo = new Map<string, string>();

  for (const message of messages) {
    const at = `${message.account_id}|${message.to.toLowerCase()}`;
    lastTo.set(at, message.created_at);
    for (const event of eventById.get(message.id) ?? []) {
      if (event.type === 'bounced') automatic.set(at, { reason: 'hard_bounce', at: event.occurred_at });
      if (event.type === 'complaint') automatic.set(at, { reason: 'complaint', at: event.occurred_at });
    }
  }

  const out: Suppression[] = [];
  const seen = new Set<string>();

  for (const [at, entry] of automatic) {
    if (out.length >= Math.round(SUPPRESSIONS * 0.62)) break;
    if ((lastTo.get(at) ?? '') > entry.at) continue;
    const accountId = at.slice(0, at.indexOf('|'));
    const address = at.slice(at.indexOf('|') + 1);
    if (!accountId || !address || seen.has(at)) continue;
    seen.add(at);
    out.push({ account_id: accountId, address, reason: entry.reason, created_at: entry.at });
  }

  // The rest came from people asking to be taken off, and from support.
  const accounts = [...new Set(messages.map((message) => message.account_id))];
  while (out.length < SUPPRESSIONS && accounts.length > 0) {
    const accountId = pick(accounts);
    const address = chance(0.12)
      ? `${pick(DIALLING)}${String(int(0, 999)).padStart(3, '0')}`
      : `${pick(FIRST_NAMES).toLowerCase()}.${pick(SURNAMES).toLowerCase()}@${pick(MAILBOXES)}`;
    const at = `${accountId}|${address.toLowerCase()}`;
    if (seen.has(at)) continue;
    seen.add(at);
    out.push({
      account_id: accountId,
      address,
      reason: pick(REASON_TEXT.slice(2)),
      created_at: stamp(isoDay(dayNumber(FROM) + int(0, 364)), int(7, 21), int(0, 59), int(0, 59)),
    });
  }

  out.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return out;
}

/* -------------------------------------------------------------------- webhooks */

const HOOK_PATHS = ['/hooks/brindle', '/webhooks/messaging', '/api/brindle/events', '/integrations/brindle', '/events/inbound'];
const HOOK_EVENTS: MessageEvent['type'][][] = [
  ['delivered', 'bounced', 'failed'],
  ['delivered', 'opened', 'clicked', 'bounced'],
  ['bounced', 'failed'],
  ['queued', 'sent', 'delivered', 'bounced', 'opened', 'clicked', 'failed'],
  ['delivered'],
];

/** How long after the first attempt a delivery settles, on the retry ladder the API uses. */
function settledAfter(attempts: number): number {
  const waits = BACKOFF_SECONDS.slice(0, Math.max(attempts - 1, 0)).reduce((sum, n) => sum + n, 0);
  return (waits + attempts) * 1000;
}

function buildWebhooks(built: Built[], events: MessageEvent[]): { hooks: Webhook[]; deliveries: WebhookDelivery[] } {
  const heavy = [...built].sort((a, b) => b.weight - a.weight).slice(0, WEBHOOK_ACCOUNTS);
  const hooks: Webhook[] = [];

  for (const entry of heavy) {
    hooks.push({
      id: id('wh'),
      account_id: entry.account.id,
      url: `https://api.${entry.slug}.co.uk${pick(HOOK_PATHS)}`,
      events: [...pick(HOOK_EVENTS)],
      secret: mintSecret(rnd),
      active: true,
      created_at: stamp(dayFrom(entry.account.created_at, 120), int(9, 18), int(0, 59), int(0, 59)),
    });

    // A handful run a second endpoint, usually a warehouse or a data team wanting the same feed.
    if (chance(0.12)) {
      hooks.push({
        id: id('wh'),
        account_id: entry.account.id,
        url: `https://events.${entry.slug}.co.uk${pick(HOOK_PATHS)}`,
        events: [...pick(HOOK_EVENTS)],
        secret: mintSecret(rnd),
        active: chance(0.8),
        created_at: stamp(dayFrom(entry.account.created_at, 900), int(9, 18), int(0, 59), int(0, 59)),
      });
    }
  }

  // Delivery records are kept for a fortnight, so only the last fourteen days are in the extract.
  const keepFrom = isoDay(dayNumber(TO) - 13);
  const byAccount = new Map<string, Webhook[]>();
  for (const hook of hooks) {
    const list = byAccount.get(hook.account_id);
    if (list) list.push(hook);
    else byAccount.set(hook.account_id, [hook]);
  }

  // One endpoint failing for ten days.
  const brokenFrom = isoDay(dayNumber(TO) - 9);
  const brokenOwner = heavy[0]?.account.id;
  const broken = hooks.find((hook) => hook.account_id === brokenOwner) ?? hooks[0];

  const deliveries: WebhookDelivery[] = [];
  for (const event of events) {
    if (event.occurred_at.slice(0, 10) < keepFrom) continue;
    for (const hook of byAccount.get(event.account_id) ?? []) {
      if (!hook.active || !hook.events.includes(event.type)) continue;

      const brokenNow = hook === broken && event.occurred_at.slice(0, 10) >= brokenFrom;
      const stillGoing = brokenNow && event.occurred_at.slice(0, 10) === TO;
      const attempts = brokenNow ? (stillGoing ? int(1, 5) : 6) : chance(0.04) ? int(2, 3) : 1;
      const failed = (brokenNow && !stillGoing) || chance(0.012);

      deliveries.push({
        id: id('whd'),
        webhook_id: hook.id,
        account_id: event.account_id,
        event_id: event.id,
        event_type: event.type,
        status: stillGoing ? 'pending' : failed ? 'failed' : 'succeeded',
        attempts,
        last_error: brokenNow
          ? 'The endpoint answered 500.'
          : failed
            ? 'The endpoint answered 502.'
            : null,
        created_at: event.occurred_at,
        updated_at: new Date(Date.parse(event.occurred_at) + settledAfter(attempts)).toISOString(),
      });
    }
  }

  return { hooks, deliveries };
}

/* ----------------------------------------------------------------- idempotency */

/**
 * Keys are kept for a day, so the extract has the last day of them. The fingerprint is the one the
 * running API computes over the request body, and the kept answer is the message as it went back.
 */
function buildIdempotency(messages: Message[]): IdempotencyRecord[] {
  const lastDay = messages.filter((message) => message.created_at.slice(0, 10) === TO).slice(-60);

  return lastDay
    .filter(() => chance(0.55))
    .map((message) => {
      const body: Record<string, unknown> = { to: message.to, channel: message.channel };
      if (message.template_id) {
        body.template_id = message.template_id;
        body.variables = message.variables ?? {};
      } else {
        if (message.subject !== null) body.subject = message.subject;
        body.body = message.body ?? '';
      }
      if (message.tags.length > 0) body.tags = message.tags;

      const reference = message.variables?.order_number ?? message.variables?.reference;

      return {
        account_id: message.account_id,
        key: reference ? `order-${reference.toLowerCase()}` : `send-${draw(12, rnd)}`,
        route: 'POST /v1/messages',
        request_fingerprint: fingerprint(body),
        status: 201,
        // What the caller was handed at the time, before the carrier moved it on.
        response: { ...publicMessage(message), status: 'queued' },
        created_at: message.created_at,
      };
    });
}

/* ------------------------------------------------------------------- the file */

function serialise(data: Data): string {
  const blocks = COLLECTIONS.map((key) => {
    const rows = data[key] as unknown[];
    if (rows.length === 0) return `  ${JSON.stringify(key)}: []`;
    const lines = rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
    return `  ${JSON.stringify(key)}: [\n${lines}\n  ]`;
  });
  return `{\n${blocks.join(',\n')}\n}\n`;
}

function main(): void {
  const days = daysBetween(FROM, TO);
  const { built, keys, whale } = buildAccounts();

  // One customer is a quarter of everything. They have never opened the sandbox: one live key,
  // cut the day they signed up at the start of 2025, and a few thousand calls a day against it.
  const kept = keys.filter((key) => key.account_id !== whale.account.id || key.mode === 'live');

  const templates = buildTemplates(built);
  const { messages, events } = buildTraffic(built, whale, templates, days);
  settlePlans(built, messages);
  const suppressions = buildSuppressions(messages, events);
  const { hooks, deliveries } = buildWebhooks(built, events);
  const idempotency = buildIdempotency(messages);

  // A key's last use is the last thing that went out on the account it belongs to.
  const lastSend = new Map<string, string>();
  for (const message of messages) {
    const current = lastSend.get(message.account_id);
    if (!current || current < message.created_at) lastSend.set(message.account_id, message.created_at);
  }
  for (const key of kept) {
    const last = lastSend.get(key.account_id);
    const used = last && last >= key.created_at && (key.mode === 'live' || chance(0.4));
    key.last_used_at = used ? (last as string) : null;
  }

  const data: Data = {
    accounts: built.map((entry) => entry.account),
    api_keys: kept,
    templates: templates.map((entry) => entry.template),
    template_versions: templates.flatMap((entry) => entry.versions),
    messages,
    events,
    suppressions,
    webhooks: hooks,
    webhook_deliveries: deliveries,
    idempotency,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serialise(data), 'utf8');

  console.log(`Wrote ${OUT}`);
  for (const name of COLLECTIONS) {
    console.log(`  ${String(data[name].length).padStart(7)}  ${name}`);
  }
}

main();

/** The shapes the store holds and the routes hand back. */

export type Channel = 'email' | 'sms';

export type Plan = 'trial' | 'starter' | 'growth' | 'scale';

export type MessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed';

export type EventType =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'opened'
  | 'clicked'
  | 'complaint'
  | 'failed';

export type SuppressionReason =
  | 'hard_bounce'
  | 'complaint'
  | 'unsubscribed'
  | 'manual';

export interface Account {
  id: string;
  name: string;
  plan: Plan;
  contact_email: string;
  monthly_included: number;
  rate_limit_per_minute: number;
  created_at: string;
}

export interface ApiKey {
  id: string;
  account_id: string;
  key: string;
  mode: 'live' | 'test';
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Template {
  id: string;
  account_id: string;
  name: string;
  channel: Channel;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version: number;
  subject: string | null;
  body: string;
  created_at: string;
}

export interface Message {
  id: string;
  account_id: string;
  channel: Channel;
  to: string;
  template_id: string | null;
  template_version: number | null;
  variables: Record<string, string> | null;
  subject: string | null;
  body: string | null;
  tags: string[];
  status: MessageStatus;
  sandboxed: boolean;
  batch_id: string | null;
  created_at: string;
}

export interface MessageEvent {
  id: string;
  message_id: string;
  account_id: string;
  type: EventType;
  occurred_at: string;
  detail: string | null;
}

export interface Suppression {
  account_id: string;
  address: string;
  reason: SuppressionReason;
  created_at: string;
}

export interface Webhook {
  id: string;
  account_id: string;
  url: string;
  events: EventType[];
  secret: string;
  active: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  account_id: string;
  event_id: string;
  event_type: EventType;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdempotencyRecord {
  account_id: string;
  key: string;
  route: string;
  request_fingerprint: string;
  status: number;
  response: unknown;
  created_at: string;
}

export interface Data {
  accounts: Account[];
  api_keys: ApiKey[];
  templates: Template[];
  template_versions: TemplateVersion[];
  messages: Message[];
  events: MessageEvent[];
  suppressions: Suppression[];
  webhooks: Webhook[];
  webhook_deliveries: WebhookDelivery[];
  idempotency: IdempotencyRecord[];
}

export const COLLECTIONS: (keyof Data)[] = [
  'accounts',
  'api_keys',
  'templates',
  'template_versions',
  'messages',
  'events',
  'suppressions',
  'webhooks',
  'webhook_deliveries',
  'idempotency',
];

export function emptyData(): Data {
  return {
    accounts: [],
    api_keys: [],
    templates: [],
    template_versions: [],
    messages: [],
    events: [],
    suppressions: [],
    webhooks: [],
    webhook_deliveries: [],
    idempotency: [],
  };
}

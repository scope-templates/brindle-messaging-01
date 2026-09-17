/**
 * The shapes that go over the wire. Routes never hand a stored row straight to a caller, so a
 * field cannot appear on one route and be missing from another.
 */
import type {
  Account,
  Message,
  MessageEvent,
  Suppression,
  Template,
  TemplateVersion,
  Webhook,
  WebhookDelivery,
} from './types.js';

export function publicMessage(message: Message) {
  return {
    id: message.id,
    channel: message.channel,
    to: message.to,
    template_id: message.template_id,
    template_version: message.template_version,
    variables: message.variables,
    subject: message.subject,
    body: message.body,
    tags: message.tags,
    status: message.status,
    sandboxed: message.sandboxed,
    batch_id: message.batch_id,
    created_at: message.created_at,
  };
}

export function publicEvent(event: MessageEvent) {
  return {
    id: event.id,
    type: event.type,
    occurred_at: event.occurred_at,
    detail: event.detail,
  };
}

export function publicTemplate(template: Template) {
  return {
    id: template.id,
    name: template.name,
    channel: template.channel,
    current_version: template.current_version,
    created_at: template.created_at,
    updated_at: template.updated_at,
  };
}

export function publicVersion(version: TemplateVersion) {
  return {
    id: version.id,
    template_id: version.template_id,
    version: version.version,
    subject: version.subject,
    body: version.body,
    created_at: version.created_at,
  };
}

export function publicSuppression(row: Suppression) {
  return {
    address: row.address,
    reason: row.reason,
    created_at: row.created_at,
  };
}

/** The secret goes out once, when the endpoint is made, and is never listed again. */
export function publicWebhook(hook: Webhook, secret: string | null = null) {
  return {
    id: hook.id,
    url: hook.url,
    events: hook.events,
    active: hook.active,
    created_at: hook.created_at,
    ...(secret === null ? {} : { secret }),
  };
}

export function publicDelivery(delivery: WebhookDelivery) {
  return {
    id: delivery.id,
    event_id: delivery.event_id,
    event_type: delivery.event_type,
    status: delivery.status,
    attempts: delivery.attempts,
    last_error: delivery.last_error,
    created_at: delivery.created_at,
    updated_at: delivery.updated_at,
  };
}

export function publicAccount(
  account: Account,
  usage: { messages: number; email: number; sms: number; period_start: string },
) {
  return {
    id: account.id,
    name: account.name,
    plan: account.plan,
    limits: {
      messages_included_per_month: account.monthly_included,
      requests_per_minute: account.rate_limit_per_minute,
      batch_size: 500,
    },
    usage: {
      period_start: usage.period_start,
      messages: usage.messages,
      email: usage.email,
      sms: usage.sms,
    },
    created_at: account.created_at,
  };
}

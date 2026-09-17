/**
 * `/v1/webhooks`. An endpoint, the event types it wants, and a secret handed over once. Every
 * attempt is written down with its count and the last thing that went wrong.
 */
import { Router } from 'express';
import { z } from 'zod';
import { callerOf } from '../auth.js';
import { fromParseFailure, refuse } from '../errors.js';
import { newId, newSecret } from '../ids.js';
import { pageQuery, paginate } from '../pagination.js';
import { publicDelivery, publicWebhook } from '../shape.js';
import type { Store } from '../store.js';
import type { Webhook } from '../types.js';

const EVENT_TYPES = [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'opened',
  'clicked',
  'complaint',
  'failed',
] as const;

const createBody = z
  .object({
    url: z.string().trim().url().max(500),
    events: z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length),
  })
  .strict();

const patchBody = z.object({ active: z.boolean() }).strict();

export function webhookRoutes(store: Store): Router {
  const routes = Router();

  routes.post('/webhooks', (request, response) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) throw fromParseFailure(parsed.error);
    if (!parsed.data.url.startsWith('https://')) {
      throw refuse('invalid_request', 'url: webhook endpoints must be https.');
    }

    const secret = newSecret();
    const hook: Webhook = {
      id: newId('wh'),
      account_id: callerOf(request).account.id,
      url: parsed.data.url,
      events: [...new Set(parsed.data.events)],
      secret,
      active: true,
      created_at: new Date().toISOString(),
    };

    store.addWebhook(hook);
    response.status(201).json(publicWebhook(hook, secret));
  });

  routes.get('/webhooks', (request, response) => {
    const parsed = pageQuery.safeParse(request.query);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const rows = store
      .webhooksFor(callerOf(request).account.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

    const cut = paginate(rows, parsed.data);
    response.json({ data: cut.data.map((hook) => publicWebhook(hook)), next_cursor: cut.next_cursor });
  });

  routes.get('/webhooks/:id/deliveries', (request, response) => {
    const parsed = pageQuery.safeParse(request.query);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const hook = mine(store, request.params.id, callerOf(request).account.id);
    const rows = store
      .deliveriesFor(hook.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

    const cut = paginate(rows, parsed.data);
    response.json({ data: cut.data.map(publicDelivery), next_cursor: cut.next_cursor });
  });

  /** Turning an endpoint off keeps it and its history; deliveries simply stop being written. */
  routes.patch('/webhooks/:id', (request, response) => {
    const parsed = patchBody.safeParse(request.body);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const hook = mine(store, request.params.id, callerOf(request).account.id);
    hook.active = parsed.data.active;
    store.save();
    response.json(publicWebhook(hook));
  });

  routes.delete('/webhooks/:id', (request, response) => {
    const hook = mine(store, request.params.id, callerOf(request).account.id);
    store.removeWebhook(hook.id);
    response.status(204).end();
  });

  return routes;
}

function mine(store: Store, id: string, accountId: string): Webhook {
  const hook = store.webhook(id);
  if (!hook || hook.account_id !== accountId) {
    throw refuse('webhook_not_found', `There is no webhook ${id} on this account.`);
  }
  return hook;
}

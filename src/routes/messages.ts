/** `/v1/messages`: sending one or five hundred, reading one back, listing, and its events. */
import { Router } from 'express';
import { z } from 'zod';
import { callerOf } from '../auth.js';
import type { Carrier } from '../delivery.js';
import { ApiError, fromParseFailure, refuse } from '../errors.js';
import { newId } from '../ids.js';
import { underKey } from '../idempotency.js';
import { pageQuery, paginate } from '../pagination.js';
import { acceptMessage, MAX_BATCH, sendBody } from '../sending.js';
import { publicEvent, publicMessage } from '../shape.js';
import type { Store } from '../store.js';

const listQuery = pageQuery.extend({
  status: z.enum(['queued', 'sent', 'delivered', 'bounced', 'failed']).optional(),
  channel: z.enum(['email', 'sms']).optional(),
});

const batchBody = z
  .object({ messages: z.array(z.unknown()).min(1) })
  .strict();

export function messageRoutes(store: Store, carrier: Carrier): Router {
  const routes = Router();

  routes.post('/messages', async (request, response) => {
    await underKey(store, request, response, 'POST /v1/messages', async () => {
      const parsed = sendBody.safeParse(request.body);
      if (!parsed.success) throw fromParseFailure(parsed.error);
      const message = acceptMessage(store, carrier, callerOf(request), parsed.data);
      return { status: 201, payload: publicMessage(message) };
    });
  });

  /**
   * A batch is not all-or-nothing. Every row that can be sent is sent, and the rows that cannot
   * come back with their position in the array and the code that would have been the status of
   * that row on its own, so the caller can fix those and leave the rest alone.
   */
  routes.post('/messages/batch', async (request, response) => {
    await underKey(store, request, response, 'POST /v1/messages/batch', async () => {
      const parsed = batchBody.safeParse(request.body);
      if (!parsed.success) throw fromParseFailure(parsed.error);
      if (parsed.data.messages.length > MAX_BATCH) {
        throw refuse(
          'batch_too_large',
          `A batch takes at most ${MAX_BATCH} messages and that one had ${parsed.data.messages.length}.`,
        );
      }

      const caller = callerOf(request);
      const batchId = newId('batch');
      const accepted: { index: number; id: string }[] = [];
      const rejected: { index: number; code: string; detail: string }[] = [];

      parsed.data.messages.forEach((row, index) => {
        const one = sendBody.safeParse(row);
        if (!one.success) {
          const problem = fromParseFailure(one.error);
          rejected.push({ index, code: problem.code, detail: problem.message });
          return;
        }
        try {
          const message = acceptMessage(store, carrier, caller, one.data, batchId);
          accepted.push({ index, id: message.id });
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          rejected.push({ index, code: error.code, detail: error.message });
        }
      });

      return { status: 202, payload: { batch_id: batchId, accepted, rejected } };
    });
  });

  routes.get('/messages', (request, response) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const { status, channel, ...page } = parsed.data;
    const rows = store
      .messagesFor(callerOf(request).account.id)
      .filter((message) => (status ? message.status === status : true))
      .filter((message) => (channel ? message.channel === channel : true));

    const cut = paginate(rows, page);
    response.json({ data: cut.data.map(publicMessage), next_cursor: cut.next_cursor });
  });

  routes.get('/messages/:id', (request, response) => {
    response.json(publicMessage(mine(store, request.params.id, callerOf(request).account.id)));
  });

  routes.get('/messages/:id/events', (request, response) => {
    const message = mine(store, request.params.id, callerOf(request).account.id);
    response.json(store.eventsOf(message.id).map(publicEvent));
  });

  return routes;
}

/**
 * Somebody else's message is not found rather than forbidden: an id from another account should
 * not be confirmed as existing by the answer to it.
 */
function mine(store: Store, id: string, accountId: string) {
  const message = store.message(id);
  if (!message || message.account_id !== accountId) {
    throw refuse('message_not_found', `There is no message ${id} on this account.`);
  }
  return message;
}

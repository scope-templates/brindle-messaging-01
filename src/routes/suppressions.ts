/**
 * `/v1/suppressions`. Addresses and numbers this account must not write to. Brindle adds to it
 * itself on a hard bounce or a complaint; a send to one is refused, never quietly dropped.
 */
import { Router } from 'express';
import { z } from 'zod';
import { callerOf } from '../auth.js';
import { fromParseFailure, refuse } from '../errors.js';
import { pageQuery, paginateBy } from '../pagination.js';
import { publicSuppression } from '../shape.js';
import type { Store } from '../store.js';
import type { Suppression } from '../types.js';

const addBody = z
  .object({
    address: z.string().trim().min(3).max(320),
    reason: z.enum(['hard_bounce', 'complaint', 'unsubscribed', 'manual']).optional(),
  })
  .strict();

export function suppressionRoutes(store: Store): Router {
  const routes = Router();

  routes.get('/suppressions', (request, response) => {
    const parsed = pageQuery.safeParse(request.query);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    // The store keys the list by the lowercased address, so the cursor has to as well.
    const rows = store.suppressionsFor(callerOf(request).account.id);
    const cut = paginateBy(rows, (row) => row.address.toLowerCase(), parsed.data);
    response.json({ data: cut.data.map(publicSuppression), next_cursor: cut.next_cursor });
  });

  routes.post('/suppressions', (request, response) => {
    const parsed = addBody.safeParse(request.body);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const row: Suppression = {
      account_id: callerOf(request).account.id,
      address: parsed.data.address.trim(),
      reason: parsed.data.reason ?? 'manual',
      created_at: new Date().toISOString(),
    };
    const kept = store.addSuppression(row);
    response.status(201).json(publicSuppression(kept));
  });

  routes.delete('/suppressions/:address', (request, response) => {
    const address = request.params.address;
    const gone = store.removeSuppression(callerOf(request).account.id, address);
    if (!gone) {
      throw refuse('suppression_not_found', `${address} is not on this account's suppression list.`);
    }
    response.status(204).end();
  });

  return routes;
}

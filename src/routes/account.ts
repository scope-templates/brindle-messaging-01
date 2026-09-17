/**
 * `/v1/account`. The plan, its limits, and the calendar month so far. This is the count the invoice
 * is drawn from: every message accepted this month, sandboxed ones included.
 */
import { Router } from 'express';
import { callerOf } from '../auth.js';
import { publicAccount } from '../shape.js';
import type { Store } from '../store.js';

export function accountRoutes(store: Store): Router {
  const routes = Router();

  routes.get('/account', (request, response) => {
    const account = callerOf(request).account;
    const periodStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

    let email = 0;
    let sms = 0;
    for (const message of store.messagesFor(account.id)) {
      if (message.created_at < periodStart) break;
      if (message.channel === 'email') email += 1;
      else sms += 1;
    }

    response.json(publicAccount(account, { messages: email + sms, email, sms, period_start: periodStart }));
  });

  return routes;
}

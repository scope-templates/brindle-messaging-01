/**
 * The Express application. Everything under `/v1` wants a key and is metered; `/health` and
 * `/openapi.yaml` are open. `Brindle-Version`, the dated version this deployment speaks, goes out
 * on every answer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, Router } from 'express';
import { requireKey } from './auth.js';
import { Carrier } from './delivery.js';
import { notFoundHandler, problemHandler } from './errors.js';
import { Budget, meter } from './ratelimit.js';
import { accountRoutes } from './routes/account.js';
import { messageRoutes } from './routes/messages.js';
import { suppressionRoutes } from './routes/suppressions.js';
import { templateRoutes } from './routes/templates.js';
import { webhookRoutes } from './routes/webhooks.js';
import { packageRoot } from './seed-load.js';
import type { Store } from './store.js';

export const API_VERSION = '2026-06-15';
export const VERSION_HEADER = 'Brindle-Version';
export const SPEC_FILE = join('openapi', 'brindle.v1.yaml');

/** Which build is answering. The API version is a promise; this is just what is deployed. */
export function buildVersion(): string {
  const manifest = JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as {
    version?: string;
  };
  return manifest.version ?? '0.0.0';
}

export interface Built {
  app: Express;
  carrier: Carrier;
  budget: Budget;
}

export function createApp(store: Store): Built {
  const app = express();
  const carrier = new Carrier(store);
  const budget = new Budget();

  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '5mb' }));

  app.use((_request, response, next) => {
    response.setHeader(VERSION_HEADER, API_VERSION);
    next();
  });

  const build = buildVersion();
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', version: API_VERSION, build });
  });

  /** The spec as it is committed, so a reader always has the file this build was written against. */
  app.get('/openapi.yaml', (_request, response) => {
    response.type('application/yaml').send(readFileSync(join(packageRoot(), SPEC_FILE), 'utf8'));
  });

  const v1 = Router();
  v1.use(requireKey(store));
  v1.use(meter(budget));
  v1.use(messageRoutes(store, carrier));
  v1.use(templateRoutes(store));
  v1.use(suppressionRoutes(store));
  v1.use(webhookRoutes(store));
  v1.use(accountRoutes(store));
  app.use('/v1', v1);

  app.use(notFoundHandler);
  app.use(problemHandler);

  return { app, carrier, budget };
}

/**
 * `/v1/templates`. Wording is never edited in place: a `PUT` writes a new version and points the
 * template at it, so a message sent last month still reads against the wording that went out.
 */
import { Router } from 'express';
import { z } from 'zod';
import { callerOf } from '../auth.js';
import { fromParseFailure, refuse } from '../errors.js';
import { newId } from '../ids.js';
import { pageQuery, paginate } from '../pagination.js';
import { renderVersion } from '../render.js';
import { publicTemplate, publicVersion } from '../shape.js';
import type { Store } from '../store.js';
import type { Template, TemplateVersion } from '../types.js';

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    channel: z.enum(['email', 'sms']),
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().min(1).max(100_000),
  })
  .strict();

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().min(1).max(100_000),
  })
  .strict();

const renderBody = z
  .object({
    variables: z.record(z.string()).optional(),
    version: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export function templateRoutes(store: Store): Router {
  const routes = Router();

  routes.post('/templates', (request, response) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) throw fromParseFailure(parsed.error);
    if (parsed.data.channel === 'email' && !parsed.data.subject) {
      throw refuse('invalid_request', 'subject: an email template needs one.');
    }
    if (parsed.data.channel === 'sms' && parsed.data.subject) {
      throw refuse('invalid_request', 'subject: an SMS template must not have one.');
    }

    const now = new Date().toISOString();
    const template: Template = {
      id: newId('tmpl'),
      account_id: callerOf(request).account.id,
      name: parsed.data.name,
      channel: parsed.data.channel,
      current_version: 1,
      created_at: now,
      updated_at: now,
    };
    const first: TemplateVersion = {
      id: newId('tv'),
      template_id: template.id,
      version: 1,
      subject: parsed.data.channel === 'email' ? (parsed.data.subject ?? null) : null,
      body: parsed.data.body,
      created_at: now,
    };

    store.addTemplate(template, first);
    response.status(201).json({ ...publicTemplate(template), ...trimmedVersion(first) });
  });

  routes.get('/templates', (request, response) => {
    const parsed = pageQuery.safeParse(request.query);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const rows = store
      .templatesFor(callerOf(request).account.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

    const cut = paginate(rows, parsed.data);
    response.json({ data: cut.data.map(publicTemplate), next_cursor: cut.next_cursor });
  });

  routes.get('/templates/:id', (request, response) => {
    const template = mine(store, request.params.id, callerOf(request).account.id);
    const current = store.versionOf(template.id, template.current_version);
    response.json({ ...publicTemplate(template), ...(current ? trimmedVersion(current) : {}) });
  });

  routes.put('/templates/:id', (request, response) => {
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const template = mine(store, request.params.id, callerOf(request).account.id);
    if (template.channel === 'email' && !parsed.data.subject) {
      throw refuse('invalid_request', 'subject: an email template needs one on every version.');
    }
    if (template.channel === 'sms' && parsed.data.subject) {
      throw refuse('invalid_request', 'subject: an SMS template must not have one.');
    }

    const now = new Date().toISOString();
    const next: TemplateVersion = {
      id: newId('tv'),
      template_id: template.id,
      version: template.current_version + 1,
      subject: template.channel === 'email' ? (parsed.data.subject ?? null) : null,
      body: parsed.data.body,
      created_at: now,
    };

    store.addVersion(next);
    template.current_version = next.version;
    template.updated_at = now;
    if (parsed.data.name) template.name = parsed.data.name;
    store.save();

    response.json({ ...publicTemplate(template), ...trimmedVersion(next) });
  });

  /** A template has a handful of versions, so the whole history comes back rather than a page. */
  routes.get('/templates/:id/versions', (request, response) => {
    const template = mine(store, request.params.id, callerOf(request).account.id);
    response.json(store.versionsOf(template.id).map(publicVersion));
  });

  /**
   * Renders a template without sending anything. Support live in this one: it is how a customer's
   * "the name is blank in the email" turns into either their variables or our template.
   */
  routes.post('/templates/:id/render', (request, response) => {
    const parsed = renderBody.safeParse(request.body ?? {});
    if (!parsed.success) throw fromParseFailure(parsed.error);

    const template = mine(store, request.params.id, callerOf(request).account.id);
    const wanted = parsed.data.version ?? template.current_version;
    const version = store.versionOf(template.id, wanted);
    if (!version) {
      throw refuse('version_not_found', `Template ${template.id} has no version ${wanted}.`);
    }

    const rendered = renderVersion(version, template.channel, parsed.data.variables ?? {});
    response.json({ ...rendered, template_id: template.id, version: version.version });
  });

  return routes;
}

function trimmedVersion(version: TemplateVersion) {
  return { subject: version.subject, body: version.body };
}

function mine(store: Store, id: string, accountId: string): Template {
  const template = store.template(id);
  if (!template || template.account_id !== accountId) {
    throw refuse('template_not_found', `There is no template ${id} on this account.`);
  }
  return template;
}

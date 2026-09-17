/**
 * Taking one message in. A single send and a row of a batch both come through here, so both are
 * refused for the same reason with the same code. The checks run in the order they are written.
 */
import { z } from 'zod';
import type { Caller } from './auth.js';
import type { Carrier } from './delivery.js';
import { refuse } from './errors.js';
import { newId } from './ids.js';
import { renderVersion } from './render.js';
import type { Store } from './store.js';
import type { Channel, Message, TemplateVersion } from './types.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+[1-9]\d{6,14}$/;

export const MAX_BATCH = 500;
export const MAX_TAGS = 10;

export const sendBody = z
  .object({
    to: z.string().trim().min(3),
    channel: z.enum(['email', 'sms']),
    template_id: z.string().trim().min(1).optional(),
    variables: z.record(z.string()).optional(),
    subject: z.string().max(200).optional(),
    body: z.string().max(100_000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.template_id) !== Boolean(value.body), {
    message: 'send either a template_id or a body, not both and not neither',
    path: ['template_id'],
  });

export type SendBody = z.infer<typeof sendBody>;

export function addressLooksRight(to: string, channel: Channel): boolean {
  return channel === 'email' ? EMAIL.test(to) : PHONE.test(to);
}

export function acceptMessage(
  store: Store,
  carrier: Carrier,
  caller: Caller,
  body: SendBody,
  batchId: string | null = null,
): Message {
  const to = body.to.trim();

  if (!addressLooksRight(to, body.channel)) {
    throw refuse(
      'invalid_request',
      body.channel === 'email'
        ? `to: "${to}" is not an email address.`
        : `to: "${to}" is not a phone number in international form, such as +447700900123.`,
    );
  }

  if (!body.template_id && body.channel === 'email' && !body.subject) {
    throw refuse('invalid_request', 'subject: an email written out in the request needs one.');
  }

  if (store.suppression(caller.account.id, to)) {
    throw refuse(
      'recipient_suppressed',
      `${to} is on your suppression list. Take it off the list if you mean to write to it again.`,
    );
  }

  const variables = body.variables ?? {};
  let version: TemplateVersion | null = null;

  if (body.template_id) {
    const template = store.template(body.template_id);
    if (!template || template.account_id !== caller.account.id) {
      throw refuse('template_not_found', `There is no template ${body.template_id} on this account.`);
    }
    if (template.channel !== body.channel) {
      throw refuse(
        'channel_mismatch',
        `Template ${template.id} is a ${template.channel} template and this send is ${body.channel}.`,
      );
    }
    version = store.versionOf(template.id, template.current_version) ?? null;
    if (!version) {
      throw refuse('version_not_found', `Template ${template.id} has no version ${template.current_version}.`);
    }
    // Render now so a template that cannot be filled in is refused rather than queued.
    renderVersion(version, body.channel, variables);
  }

  const message: Message = {
    id: newId('msg'),
    account_id: caller.account.id,
    channel: body.channel,
    to,
    template_id: version ? version.template_id : null,
    template_version: version ? version.version : null,
    variables: version ? variables : null,
    subject: version ? null : (body.subject ?? null),
    body: version ? null : (body.body ?? null),
    tags: body.tags ?? [],
    status: 'queued',
    sandboxed: caller.sandboxed,
    batch_id: batchId,
    created_at: new Date().toISOString(),
  };

  store.addMessage(message);
  carrier.accept(message, new Date(message.created_at));
  return message;
}

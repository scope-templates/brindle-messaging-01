/**
 * The store: one JSON file under `DATA_DIR`, read into memory at start and written back after a
 * change. An empty directory is filled from `data/seed.json`. Writes are coalesced and go to a
 * temporary name and then a rename, so a reader never sees half a file.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLLECTIONS,
  emptyData,
  type Account,
  type ApiKey,
  type Data,
  type IdempotencyRecord,
  type Message,
  type MessageEvent,
  type Suppression,
  type Template,
  type TemplateVersion,
  type Webhook,
  type WebhookDelivery,
} from './types.js';
import { packageRoot, readSeed } from './seed-load.js';

const WRITE_DELAY_MS = 250;

/** What the docs promise about how long we hold things. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const DELIVERY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface StoreOptions {
  /** Where `store.json` lives. Defaults to `DATA_DIR`, or `data/` beside the package. */
  dataDir?: string;
  /** False keeps everything in memory and never touches the disk. The tests use it. */
  persist?: boolean;
}

export class Store {
  readonly data: Data;
  private readonly file: string | null;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  private readonly accountsById = new Map<string, Account>();
  private readonly keysByValue = new Map<string, ApiKey>();
  private readonly templatesById = new Map<string, Template>();
  private readonly versionsByTemplate = new Map<string, TemplateVersion[]>();
  private readonly messagesById = new Map<string, Message>();
  private readonly messagesByAccount = new Map<string, Message[]>();
  private readonly eventsByMessage = new Map<string, MessageEvent[]>();
  private readonly suppressedByAccount = new Map<string, Map<string, Suppression>>();
  private readonly webhooksById = new Map<string, Webhook>();
  private readonly idempotencyByKey = new Map<string, IdempotencyRecord>();

  constructor(data: Data, file: string | null) {
    this.data = data;
    this.file = file;
    this.reindex();
  }

  /* ------------------------------------------------------------------- indexes */

  private reindex(): void {
    for (const account of this.data.accounts) this.accountsById.set(account.id, account);
    for (const key of this.data.api_keys) this.keysByValue.set(key.key, key);
    for (const template of this.data.templates) this.templatesById.set(template.id, template);
    for (const version of this.data.template_versions) this.pushVersion(version);
    for (const message of this.data.messages) this.indexMessage(message);
    for (const event of this.data.events) this.pushEvent(event);
    for (const row of this.data.suppressions) this.indexSuppression(row);
    for (const hook of this.data.webhooks) this.webhooksById.set(hook.id, hook);
    for (const record of this.data.idempotency) {
      this.idempotencyByKey.set(idempotencyIndex(record.account_id, record.route, record.key), record);
    }
  }

  private pushVersion(version: TemplateVersion): void {
    const list = this.versionsByTemplate.get(version.template_id);
    if (list) list.push(version);
    else this.versionsByTemplate.set(version.template_id, [version]);
  }

  private indexMessage(message: Message): void {
    this.messagesById.set(message.id, message);
    const list = this.messagesByAccount.get(message.account_id);
    if (list) list.push(message);
    else this.messagesByAccount.set(message.account_id, [message]);
  }

  private pushEvent(event: MessageEvent): void {
    const list = this.eventsByMessage.get(event.message_id);
    if (list) list.push(event);
    else this.eventsByMessage.set(event.message_id, [event]);
  }

  private indexSuppression(row: Suppression): void {
    let byAddress = this.suppressedByAccount.get(row.account_id);
    if (!byAddress) {
      byAddress = new Map();
      this.suppressedByAccount.set(row.account_id, byAddress);
    }
    byAddress.set(row.address.toLowerCase(), row);
  }

  /* ------------------------------------------------------------------- reading */

  account(id: string): Account | undefined {
    return this.accountsById.get(id);
  }

  keyByValue(value: string): ApiKey | undefined {
    return this.keysByValue.get(value);
  }

  template(id: string): Template | undefined {
    return this.templatesById.get(id);
  }

  templatesFor(accountId: string): Template[] {
    return this.data.templates.filter((template) => template.account_id === accountId);
  }

  versionsOf(templateId: string): TemplateVersion[] {
    return [...(this.versionsByTemplate.get(templateId) ?? [])].sort((a, b) => a.version - b.version);
  }

  versionOf(templateId: string, version: number): TemplateVersion | undefined {
    return this.versionsByTemplate.get(templateId)?.find((row) => row.version === version);
  }

  message(id: string): Message | undefined {
    return this.messagesById.get(id);
  }

  /** Everything an account has sent, newest first. */
  messagesFor(accountId: string): Message[] {
    const list = [...(this.messagesByAccount.get(accountId) ?? [])];
    list.sort((a, b) => compareNewestFirst(a.created_at, a.id, b.created_at, b.id));
    return list;
  }

  eventsOf(messageId: string): MessageEvent[] {
    const list = [...(this.eventsByMessage.get(messageId) ?? [])];
    list.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
    return list;
  }

  suppression(accountId: string, address: string): Suppression | undefined {
    return this.suppressedByAccount.get(accountId)?.get(address.toLowerCase());
  }

  suppressionsFor(accountId: string): Suppression[] {
    const rows = [...(this.suppressedByAccount.get(accountId)?.values() ?? [])];
    rows.sort((a, b) => compareNewestFirst(a.created_at, a.address, b.created_at, b.address));
    return rows;
  }

  webhook(id: string): Webhook | undefined {
    return this.webhooksById.get(id);
  }

  webhooksFor(accountId: string): Webhook[] {
    return this.data.webhooks.filter((hook) => hook.account_id === accountId);
  }

  deliveriesFor(webhookId: string): WebhookDelivery[] {
    return this.data.webhook_deliveries.filter((row) => row.webhook_id === webhookId);
  }

  /** Deliveries that have not landed and have attempts left. */
  pendingDeliveries(): WebhookDelivery[] {
    return this.data.webhook_deliveries.filter((row) => row.status === 'pending');
  }

  idempotency(accountId: string, route: string, key: string): IdempotencyRecord | undefined {
    return this.idempotencyByKey.get(idempotencyIndex(accountId, route, key));
  }

  /* ------------------------------------------------------------------- writing */

  addTemplate(template: Template, first: TemplateVersion): void {
    this.data.templates.push(template);
    this.templatesById.set(template.id, template);
    this.addVersion(first);
  }

  addVersion(version: TemplateVersion): void {
    this.data.template_versions.push(version);
    this.pushVersion(version);
    this.save();
  }

  addMessage(message: Message): void {
    this.data.messages.push(message);
    this.indexMessage(message);
    this.save();
  }

  addEvent(event: MessageEvent): void {
    this.data.events.push(event);
    this.pushEvent(event);
    this.save();
  }

  /** Putting an address on the list twice replaces the reason rather than making a second row. */
  addSuppression(row: Suppression): Suppression {
    const existing = this.suppression(row.account_id, row.address);
    if (existing) {
      existing.reason = row.reason;
      this.save();
      return existing;
    }
    this.data.suppressions.push(row);
    this.indexSuppression(row);
    this.save();
    return row;
  }

  removeSuppression(accountId: string, address: string): boolean {
    const byAddress = this.suppressedByAccount.get(accountId);
    const found = byAddress?.get(address.toLowerCase());
    if (!byAddress || !found) return false;
    byAddress.delete(address.toLowerCase());
    this.data.suppressions = this.data.suppressions.filter((row) => row !== found);
    this.save();
    return true;
  }

  addWebhook(hook: Webhook): void {
    this.data.webhooks.push(hook);
    this.webhooksById.set(hook.id, hook);
    this.save();
  }

  removeWebhook(id: string): boolean {
    const hook = this.webhooksById.get(id);
    if (!hook) return false;
    this.webhooksById.delete(id);
    this.data.webhooks = this.data.webhooks.filter((row) => row !== hook);
    this.data.webhook_deliveries = this.data.webhook_deliveries.filter((row) => row.webhook_id !== id);
    this.save();
    return true;
  }

  addDelivery(delivery: WebhookDelivery): void {
    this.data.webhook_deliveries.push(delivery);
    this.save();
  }

  rememberIdempotency(record: IdempotencyRecord): void {
    this.data.idempotency.push(record);
    this.idempotencyByKey.set(idempotencyIndex(record.account_id, record.route, record.key), record);
    this.save();
  }

  /**
   * Throw away what we promised not to keep: idempotency keys after a day, delivery records after
   * a fortnight. Runs when the store is opened and once a day while it is up.
   */
  prune(now: Date = new Date()): { idempotency: number; webhook_deliveries: number } {
    const keysBefore = now.getTime() - IDEMPOTENCY_TTL_MS;
    const deliveriesBefore = now.getTime() - DELIVERY_TTL_MS;

    const keys = this.data.idempotency.filter((row) => Date.parse(row.created_at) >= keysBefore);
    const deliveries = this.data.webhook_deliveries.filter(
      (row) => Date.parse(row.created_at) >= deliveriesBefore,
    );

    const dropped = {
      idempotency: this.data.idempotency.length - keys.length,
      webhook_deliveries: this.data.webhook_deliveries.length - deliveries.length,
    };
    if (dropped.idempotency === 0 && dropped.webhook_deliveries === 0) return dropped;

    this.data.idempotency = keys;
    this.data.webhook_deliveries = deliveries;
    this.idempotencyByKey.clear();
    for (const record of keys) {
      this.idempotencyByKey.set(idempotencyIndex(record.account_id, record.route, record.key), record);
    }
    this.save();
    return dropped;
  }

  /* ------------------------------------------------------------------ the file */

  /** Mark the store changed. The file catches up a moment later. */
  save(): void {
    if (!this.file || this.timer) {
      this.dirty = this.file !== null;
      return;
    }
    this.dirty = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, WRITE_DELAY_MS);
    this.timer.unref();
  }

  /** Write the file now, if anything is waiting to go into it. */
  flush(): void {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    writeData(this.file, this.data);
  }

  /** Stop the timer and leave the file up to date. */
  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of COLLECTIONS) out[name] = this.data[name].length;
    return out;
  }
}

function compareNewestFirst(aAt: string, aId: string, bAt: string, bId: string): number {
  if (aAt !== bAt) return aAt < bAt ? 1 : -1;
  return aId < bId ? 1 : aId > bId ? -1 : 0;
}

function idempotencyIndex(accountId: string, route: string, key: string): string {
  return `${accountId}\u0000${route}\u0000${key}`;
}

export function dataDirectory(override?: string): string {
  return override ?? process.env.DATA_DIR ?? join(packageRoot(), 'data');
}

export function storeFile(override?: string): string {
  return join(dataDirectory(override), 'store.json');
}

function writeData(file: string, data: Data): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data)}\n`, 'utf8');
  renameSync(temporary, file);
}

/**
 * Open the store. A directory with no `store.json` in it is filled from the seed and written out,
 * so a fresh checkout has a working Brindle the first time it is started.
 */
export function openStore(options: StoreOptions = {}): Store {
  if (options.persist === false) {
    const store = new Store(readSeed(), null);
    store.prune();
    return store;
  }

  const directory = dataDirectory(options.dataDir);
  const file = join(directory, 'store.json');
  mkdirSync(directory, { recursive: true });

  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8');
    const parsed = raw.trim().length === 0 ? emptyData() : (JSON.parse(raw) as Partial<Data>);
    const store = new Store({ ...emptyData(), ...parsed }, file);
    store.prune();
    return store;
  }

  const seeded = readSeed();
  writeData(file, seeded);
  const store = new Store(seeded, file);
  store.prune();
  return store;
}

/**
 * @brindle/node — the Node client library for the Brindle API.
 *
 * It is a thin wrapper over `fetch`: it puts the key on the request, parses the answer, and turns
 * a problem object into a `BrindleError` you can branch on by `code`. Everything it returns is the
 * JSON the API returned.
 */

export type Channel = 'email' | 'sms';

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
}

export interface Message {
  id: string;
  channel: Channel;
  to: string;
  template_id: string | null;
  template_version: number | null;
  variables: Record<string, string> | null;
  subject: string | null;
  body: string | null;
  tags: string[];
  status: MessageStatus;
  batch_id: string | null;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  channel: Channel;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface Rendered {
  subject: string | null;
  body: string;
  template_id: string;
  version: number;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface SendOptions {
  to: string;
  channel: Channel;
  templateId?: string;
  variables?: Record<string, string>;
  subject?: string;
  body?: string;
  tags?: string[];
}

export interface ListOptions {
  cursor?: string;
  limit?: number;
}

export interface BrindleOptions {
  /** A key from your Brindle dashboard: `bk_live_...` or `bk_test_...`. */
  apiKey: string;
  /** Where to send requests. The production API otherwise. */
  baseUrl?: string;
  /** Your own fetch, if you have one. The global one otherwise. */
  fetch?: typeof fetch;
}

export const DEFAULT_BASE_URL = 'https://api.brindle.dev';

/** A refusal from the API, carrying the problem object it came from. */
export class BrindleError extends Error {
  readonly code: string;
  readonly status: number;
  readonly title: string;
  readonly type: string;

  constructor(problem: Problem) {
    super(problem.detail);
    this.name = 'BrindleError';
    this.code = problem.code;
    this.status = problem.status;
    this.title = problem.title;
    this.type = problem.type;
  }
}

export class Brindle {
  readonly messages: Messages;
  readonly templates: Templates;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly send: typeof fetch;

  constructor(options: BrindleOptions) {
    if (!options.apiKey) throw new Error('Brindle needs an apiKey');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.send = options.fetch ?? fetch;
    this.messages = new Messages(this);
    this.templates = new Templates(this);
  }

  /** @internal */
  async request<T>(method: string, path: string, body?: unknown, query?: ListOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query?.cursor) url.searchParams.set('cursor', query.cursor);
    if (query?.limit !== undefined) url.searchParams.set('limit', String(query.limit));

    const response = await this.send(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (response.status === 204) return undefined as T;

    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new BrindleError(asProblem(parsed, response.status));
    return parsed as T;
  }
}

class Messages {
  private readonly client: Brindle;

  constructor(client: Brindle) {
    this.client = client;
  }

  /** Send one message, from a template or written out here. */
  send(options: SendOptions): Promise<Message> {
    return this.client.request<Message>('POST', '/v1/messages', {
      to: options.to,
      channel: options.channel,
      ...(options.templateId === undefined ? {} : { template_id: options.templateId }),
      ...(options.variables === undefined ? {} : { variables: options.variables }),
      ...(options.subject === undefined ? {} : { subject: options.subject }),
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.tags === undefined ? {} : { tags: options.tags }),
    });
  }

  get(id: string): Promise<Message> {
    return this.client.request<Message>('GET', `/v1/messages/${encodeURIComponent(id)}`);
  }
}

class Templates {
  private readonly client: Brindle;

  constructor(client: Brindle) {
    this.client = client;
  }

  list(options: ListOptions = {}): Promise<Page<Template>> {
    return this.client.request<Page<Template>>('GET', '/v1/templates', undefined, options);
  }

  get(id: string): Promise<Template> {
    return this.client.request<Template>('GET', `/v1/templates/${encodeURIComponent(id)}`);
  }

  /** Fill a template in without sending it. */
  render(id: string, variables: Record<string, string> = {}): Promise<Rendered> {
    return this.client.request<Rendered>('POST', `/v1/templates/${encodeURIComponent(id)}/render`, {
      variables,
    });
  }
}

function asProblem(parsed: unknown, status: number): Problem {
  if (parsed && typeof parsed === 'object' && 'code' in parsed && 'detail' in parsed) {
    return parsed as Problem;
  }
  return {
    type: 'https://docs.brindle.dev/errors/unknown',
    title: 'Unexpected answer',
    status,
    detail: `The API answered ${status} with something this client could not read.`,
    code: 'unknown',
  };
}

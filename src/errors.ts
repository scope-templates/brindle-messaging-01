/**
 * Every refusal is the same object: `{type, title, status, detail, code}`. Callers branch on
 * `code`, which keeps its meaning once published; `detail` is for a person and may be reworded.
 */
import type { NextFunction, Request, Response } from 'express';
import type { ZodError } from 'zod';

export const ERROR_BASE = 'https://docs.brindle.dev/errors';

export type ErrorCode =
  | 'authentication_required'
  | 'invalid_key'
  | 'invalid_request'
  | 'message_not_found'
  | 'template_not_found'
  | 'version_not_found'
  | 'webhook_not_found'
  | 'suppression_not_found'
  | 'not_found'
  | 'channel_mismatch'
  | 'variable_missing'
  | 'recipient_suppressed'
  | 'batch_too_large'
  | 'payload_too_large'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'internal_error';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCode;
}

const TITLES: Record<ErrorCode, string> = {
  authentication_required: 'Authentication required',
  invalid_key: 'Invalid key',
  invalid_request: 'Invalid request',
  message_not_found: 'Message not found',
  template_not_found: 'Template not found',
  version_not_found: 'Template version not found',
  webhook_not_found: 'Webhook not found',
  suppression_not_found: 'Suppression not found',
  not_found: 'Not found',
  channel_mismatch: 'Channel mismatch',
  variable_missing: 'Variable missing',
  recipient_suppressed: 'Recipient suppressed',
  batch_too_large: 'Batch too large',
  payload_too_large: 'Payload too large',
  idempotency_conflict: 'Idempotency conflict',
  rate_limited: 'Rate limited',
  internal_error: 'Something went wrong at our end',
};

const STATUSES: Record<ErrorCode, number> = {
  authentication_required: 401,
  invalid_key: 401,
  invalid_request: 400,
  message_not_found: 404,
  template_not_found: 404,
  version_not_found: 404,
  webhook_not_found: 404,
  suppression_not_found: 404,
  not_found: 404,
  channel_mismatch: 422,
  variable_missing: 422,
  recipient_suppressed: 422,
  batch_too_large: 422,
  payload_too_large: 413,
  idempotency_conflict: 409,
  rate_limited: 429,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUSES[code];
  }

  toProblem(): Problem {
    return {
      type: `${ERROR_BASE}/${this.code}`,
      title: TITLES[this.code],
      status: this.status,
      detail: this.message,
      code: this.code,
    };
  }
}

export function refuse(code: ErrorCode, detail: string): ApiError {
  return new ApiError(code, detail);
}

/** Turns a parsing failure into the one sentence that says what was wrong with the body. */
export function fromParseFailure(error: ZodError): ApiError {
  const first = error.issues[0];
  if (!first) return refuse('invalid_request', 'That request body could not be read.');
  const where = first.path.length > 0 ? first.path.join('.') : 'the body';
  return refuse('invalid_request', `${where}: ${first.message.toLowerCase()}`);
}

export function sendProblem(response: Response, problem: Problem): void {
  response.status(problem.status).type('application/problem+json').json(problem);
}

/** The last middleware in the stack. Anything that is not an ApiError is ours, not the caller's. */
export function problemHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ApiError) {
    sendProblem(response, error.toProblem());
    return;
  }
  const kind = bodyParserKind(error);
  if (kind === 'entity.too.large') {
    sendProblem(
      response,
      refuse('payload_too_large', 'That request body is larger than this API accepts.').toProblem(),
    );
    return;
  }
  if (kind !== null || (error instanceof SyntaxError && 'body' in error)) {
    sendProblem(response, refuse('invalid_request', 'That request body is not JSON.').toProblem());
    return;
  }
  console.error(error);
  sendProblem(
    response,
    refuse('internal_error', 'The request could not be completed. Nothing was recorded.').toProblem(),
  );
}

/** Body-parser failures carry a `type` saying which one they are. */
function bodyParserKind(error: unknown): string | null {
  if (error && typeof error === 'object' && 'type' in error && typeof error.type === 'string') {
    return error.type;
  }
  return null;
}

export function notFoundHandler(_request: Request, response: Response): void {
  sendProblem(response, refuse('not_found', 'There is no such route on this API.').toProblem());
}

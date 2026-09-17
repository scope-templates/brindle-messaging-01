/**
 * Cursor pages: `?cursor=&limit=` in, `{data, next_cursor}` out, newest first. A cursor is the
 * position of the last row on the page, encoded so nobody builds one by hand.
 */
import { z } from 'zod';
import { refuse } from './errors.js';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export const pageQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

export type PageQuery = z.infer<typeof pageQuery>;

export function encodeCursor(id: string): string {
  return Buffer.from(`brindle:${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!decoded.startsWith('brindle:') || decoded.length <= 'brindle:'.length) {
    throw refuse('invalid_request', 'cursor: that is not a cursor this API handed out.');
  }
  return decoded.slice('brindle:'.length);
}

/**
 * Cuts one page out of a list that is already in the order the caller will see it. A cursor that
 * points at a row which has since gone is refused rather than silently starting again at the top.
 */
export function paginate<T extends { id: string }>(rows: T[], query: PageQuery): Page<T> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  let start = 0;

  if (query.cursor) {
    const after = decodeCursor(query.cursor);
    const at = rows.findIndex((row) => row.id === after);
    if (at < 0) throw refuse('invalid_request', 'cursor: that page has moved on. Start the list again.');
    start = at + 1;
  }

  const data = rows.slice(start, start + limit);
  const more = start + data.length < rows.length;
  const last = data[data.length - 1];
  return { data, next_cursor: more && last ? encodeCursor(last.id) : null };
}

/** The suppression list is keyed by address rather than by an id, so it pages on the address. */
export function paginateBy<T>(rows: T[], key: (row: T) => string, query: PageQuery): Page<T> {
  const withIds = rows.map((row) => ({ id: key(row), row }));
  const page = paginate(withIds, query);
  return { data: page.data.map((entry) => entry.row), next_cursor: page.next_cursor };
}

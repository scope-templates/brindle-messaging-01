# Changelog

The API is versioned by date. Every answer carries `Brindle-Version` with the version the
deployment speaks. What a dated version promises is in [`docs/versioning.md`](docs/versioning.md).

## Known issues

Wrong in what is deployed now, filed and not fixed yet.

- Values filled into an email template's subject are HTML-escaped as if the subject were HTML, so
  `{{order_number}}` filled with `W-1 & W-2` renders as `W-1 &amp; W-2`. Only the body is HTML;
  the subject should take values as they are. (BRN-47)
- Webhook attempts only go out when the delivery loop passes, which is every 45 seconds. The first
  attempt can wait up to 45 seconds rather than going straight away, the 2- and 10-second waits
  each come to 45, and the sixth attempt goes out nearly nineteen minutes after the first, not
  sixteen. The README and `docs/events-and-webhooks.md` still promise sixteen. (BRN-38)
- `GET /v1/messages?status=queued` (or `sent`) cannot be walked while messages are moving. Once
  the message a cursor points at changes status it drops out of the filtered list, and the next
  page is refused with `invalid_request`. Walks without `status`, or on `delivered`, `bounced` or
  `failed`, are not affected. (BRN-55)

## 2026-06-15

Sending in bulk, and knowing what happened afterwards without asking us.

- `POST /v1/messages/batch` takes up to five hundred messages and answers `202` with
  `{batch_id, accepted, rejected}`. Rows that cannot be sent come back in `rejected` with their
  position in the array and the code that row would have been refused with on its own; the rest of
  the batch goes. Accepted messages carry `batch_id`.
- `GET /v1/messages/{id}/events` returns the whole history of a message: `queued`, `sent`,
  `delivered`, `bounced`, `opened`, `clicked`, `complaint`, `failed`, oldest first, with `detail`
  on a bounce or a failure.
- `complaint` is a new event type, written when a recipient marks an email as spam at their
  provider. Like `opened` and `clicked` it does not move the message's `status`.
- The suppression list has routes of its own: `GET /v1/suppressions`, `POST /v1/suppressions`,
  `DELETE /v1/suppressions/{address}`. Before this it could only be seen in the dashboard. A send
  to a suppressed address is refused with `recipient_suppressed`, and a `bounced` or `complaint`
  event now adds the recipient to the list as it is written.
- `Idempotency-Key` is honoured on `POST /v1/messages` and `POST /v1/messages/batch`. The first
  request under a key is run and its answer kept for a day; a repeat under the same key returns
  that answer with `Idempotency-Replayed: true`. The same key over a different body is refused with
  `idempotency_conflict`.
- **Breaking:** `PUT /v1/templates/{id}` writes a new version and points the template at it rather
  than overwriting the wording. `current_version` goes up on every `PUT`,
  `GET /v1/templates/{id}/versions` lists the history, and every message records the
  `template_version` it was rendered from. Callers that treated `PUT` as an edit see the same
  wording go out; callers that relied on version numbers staying still do not.
- `POST /v1/templates/{id}/render` takes an optional `version`, so an older wording can be
  reproduced.
- `GET /v1/webhooks/{id}/deliveries` shows what happened to each post, with `attempts` and
  `last_error`. Records are kept for a fortnight. `PATCH /v1/webhooks/{id}` turns an endpoint off
  and on without losing it.
- Webhook signatures gained the timestamp: `Brindle-Signature: t=<unix>,v1=<hmac>` over
  `<t>.<body>`. Receivers should refuse a body whose timestamp is more than five minutes out.
- New refusal codes: `recipient_suppressed`, `idempotency_conflict`, `batch_too_large`,
  `payload_too_large`, `version_not_found`, `channel_mismatch`.

## 2025-09-01

Pagination and limits, mostly, after a customer walked their message list with `offset` for three
days and got the same page twice.

- **Breaking:** lists return `{data, next_cursor}` and take `?cursor=&limit=` instead of
  `?page=&per_page=`. `limit` is 25 by default and 100 at most. A cursor is a position, so rows
  arriving mid-walk no longer shift the page you are on.
- `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` on every answer under `/v1`,
  and `Retry-After` on a `429`. The budget counts requests, not messages.
- `GET /v1/messages` narrows by `status` and `channel`.
- `tags` on a message, up to ten, handed back on the message and in every webhook body.
- `GET /v1/account` returns the plan, its limits and the calendar month's usage.
- `POST /v1/templates/{id}/render` renders a template without sending it.
- Refusals are now sent as `application/problem+json` rather than `application/json`. The body is
  unchanged.

## 2025-01-20

The first public version: `POST /v1/messages`, `GET /v1/messages/{id}`, `GET /v1/messages`,
templates with `{{variables}}`, webhooks with an HMAC signature, bearer keys in live and test.
Refusals are problem objects — `{type, title, status, detail, code}` — and `code` is the part to
branch on.

# Pagination, errors and rate limits

The conventions every route follows.

## Pages

Lists that can grow without bound — messages, templates, suppressions, webhooks, webhook
deliveries — come back a page at a time, newest first:

```
curl "https://api.brindle.dev/v1/messages?limit=2&status=bounced" \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

```json
{
  "data": [
    {
      "id": "msg_901pn19hh7xt",
      "channel": "email",
      "to": "hafsa.tewson@stonebridge.email",
      "template_id": "tmpl_13jprr39jzhs",
      "template_version": 3,
      "variables": { "first_name": "Hafsa", "amount": "£146.22", "order_number": "C-35627", "company": "Bramhope Hire" },
      "subject": null,
      "body": null,
      "tags": ["order", "transactional", "security"],
      "status": "bounced",
      "sandboxed": false,
      "batch_id": null,
      "created_at": "2026-09-01T20:56:11.000Z"
    },
    {
      "id": "msg_qxb04bq0rtv4",
      "channel": "email",
      "to": "kieran.rutherglen@brookmail.com",
      "template_id": "tmpl_qjts448zffpx",
      "template_version": 2,
      "variables": { "first_name": "Kieran", "amount": "£447.33", "order_number": "F-47328", "company": "Bramhope Hire" },
      "subject": null,
      "body": null,
      "tags": ["order", "transactional", "alert"],
      "status": "bounced",
      "sandboxed": false,
      "batch_id": null,
      "created_at": "2026-08-11T18:33:14.000Z"
    }
  ],
  "next_cursor": "YnJpbmRsZTptc2dfcXhiMDRicTBydHY0"
}
```

`limit` is 25 unless you say otherwise, and 100 at most. Pass `next_cursor` back as `cursor` to get
the next page. `"next_cursor": null` means that was the last one.

```
curl "https://api.brindle.dev/v1/messages?limit=2&status=bounced&cursor=YnJpbmRsZTptc2dfcXhiMDRicTBydHY0" \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

A cursor is a position, not a page number: rows added while you are walking a list do not shift the
page you are on. Treat the string as opaque — do not build one, and do not keep one for long. A
cursor whose row has since gone is refused with `invalid_request` rather than quietly starting
again at the top.

`GET /v1/messages` also takes `status` and `channel`. Filters go on every page of the walk, not
just the first.

Two lists are bounded by a single object and come back whole rather than as a page: a message's
`/events` and a template's `/versions`.

## Errors

Every refusal is the same object, sent as `application/problem+json`:

```json
{
  "type": "https://docs.brindle.dev/errors/template_not_found",
  "title": "Template not found",
  "status": 404,
  "detail": "There is no template tmpl_nosuchthing on this account.",
  "code": "template_not_found"
}
```

Branch on `code`. It is stable: once a code is published it keeps its meaning. `detail` is written
for a person and may be reworded at any time, so do not match on it.

| Code | Status | When |
| --- | --- | --- |
| `authentication_required` | 401 | No `Authorization` header. |
| `invalid_key` | 401 | A key Brindle does not recognise. |
| `invalid_request` | 400 | The body or the query could not be read. |
| `message_not_found` | 404 | No such message on this account. |
| `template_not_found` | 404 | No such template on this account. |
| `version_not_found` | 404 | No such version of that template. |
| `webhook_not_found` | 404 | No such endpoint on this account. |
| `suppression_not_found` | 404 | That address is not on the list. |
| `not_found` | 404 | No such route. |
| `channel_mismatch` | 422 | The template's channel is not the one you sent on. |
| `variable_missing` | 422 | A `{{placeholder}}` had no value. |
| `recipient_suppressed` | 422 | The recipient is on your suppression list. |
| `batch_too_large` | 422 | More than five hundred messages in one batch. |
| `payload_too_large` | 413 | The request body is bigger than the API accepts. |
| `idempotency_conflict` | 409 | A key reused over a different body. |
| `rate_limited` | 429 | The account's requests for this window are spent. |
| `internal_error` | 500 | Something went wrong at our end. Nothing was recorded. |

A `500` means the request did not happen. It is safe to retry, and safer still under an idempotency
key.

## Rate limits

Every answer to a request with a valid key carries the account's budget for the current window:

```
X-RateLimit-Limit: 1500
X-RateLimit-Remaining: 1473
X-RateLimit-Reset: 1789657897
```

A window opens on your first request and runs for a minute; `X-RateLimit-Reset` is the Unix second
at which the one you are in ends and the budget goes back to `X-RateLimit-Limit`. The budget counts
requests, not messages: one batch of five hundred costs the same as one send, which is the reason
to batch.

Past the limit the answer is `429` with `rate_limited` and a `Retry-After` in seconds. Wait that
long; do not retry straight away. Your limit is on [`GET /v1/account`](#the-account) and moves with
your plan.

## Retrying safely

Put an `Idempotency-Key` of your own on `POST /v1/messages` and `POST /v1/messages/batch`:

```
-H "Idempotency-Key: order-w-4410-confirmation"
```

The first request under a key is run and its answer kept for a day. A repeat under the same key
gets that answer back, with `Idempotency-Replayed: true`, and nothing is sent a second time. So a
timeout, a dropped connection or a retried job costs you nothing.

Make the key from the thing that caused the send — the order number, the shift id, the invoice
reference — not from a random value, or a retry will make a new key and a second message. Keys are
255 characters at most; a longer one is `invalid_request`.

The same key over a different body is a mistake in the caller rather than a retry, and is refused:

```json
{
  "type": "https://docs.brindle.dev/errors/idempotency_conflict",
  "title": "Idempotency conflict",
  "status": 409,
  "detail": "Idempotency-Key \"order-w-4410-confirmation\" was used on POST /v1/messages with a different body. Use a new key.",
  "code": "idempotency_conflict"
}
```

## The account

```
curl https://api.brindle.dev/v1/account -H "Authorization: Bearer $BRINDLE_KEY"
```

```json
{
  "id": "acct_t4h63750",
  "name": "Bramhope Hire",
  "plan": "scale",
  "limits": {
    "messages_included_per_month": 1200000,
    "requests_per_minute": 1500,
    "batch_size": 500
  },
  "usage": {
    "period_start": "2026-09-01T00:00:00.000Z",
    "messages": 161,
    "email": 150,
    "sms": 11
  },
  "created_at": "2025-01-21T10:41:06.000Z"
}
```

`usage` is the calendar month so far, counted from the moment each message was accepted. Sandboxed
messages are in it, because they are accepted and recorded like any other.

`GET /health` needs no key and answers
`{"status":"ok","version":"2026-06-15","build":"2.8.0"}`. `version` is the dated API version;
`build` is the deployment. Point your monitor at that one.

# Quickstart

Ten minutes, three calls: make a template, send it, read what happened. Everything below is `curl`
against the live API with a test key, so nothing you do here reaches a real inbox.

Your keys are on the Keys page of your dashboard. A test key begins `bk_test_`; a live one begins
`bk_live_`. Put one in your shell:

```
export BRINDLE_KEY=bk_test_...
```

## 1. Make a template

Templates hold your wording. `{{placeholders}}` are filled in when you send.

```
curl https://api.brindle.dev/v1/templates \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order confirmed",
    "channel": "email",
    "subject": "Your order {{order_number}} is confirmed",
    "body": "<p>Hello {{first_name}},</p>\n<p>We have taken {{amount}} and {{order_number}} is with our packers.</p>"
  }'
```

```json
{
  "id": "tmpl_25gjvf90bnq5",
  "name": "Order confirmed",
  "channel": "email",
  "current_version": 1,
  "created_at": "2026-09-17T09:11:37.737Z",
  "updated_at": "2026-09-17T09:11:37.737Z",
  "subject": "Your order {{order_number}} is confirmed",
  "body": "<p>Hello {{first_name}},</p>\n<p>We have taken {{amount}} and {{order_number}} is with our packers.</p>"
}
```

Keep the `id`.

## 2. Send it

```
curl https://api.brindle.dev/v1/messages \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-w-4410-confirmation" \
  -d '{
    "to": "esme.ingham@brookmail.com",
    "channel": "email",
    "template_id": "tmpl_25gjvf90bnq5",
    "variables": {
      "first_name": "Esme",
      "order_number": "W-4410",
      "amount": "£82.40"
    },
    "tags": ["order"]
  }'
```

```json
{
  "id": "msg_nsr08nrrht1x",
  "channel": "email",
  "to": "esme.ingham@brookmail.com",
  "template_id": "tmpl_25gjvf90bnq5",
  "template_version": 1,
  "variables": { "first_name": "Esme", "order_number": "W-4410", "amount": "£82.40" },
  "subject": null,
  "body": null,
  "tags": ["order"],
  "status": "queued",
  "sandboxed": true,
  "batch_id": null,
  "created_at": "2026-09-17T09:11:37.752Z"
}
```

`status` is `queued`: Brindle has the message and has not handed it on yet. `sandboxed` is `true`
because you sent it with a test key, so it is recorded like any other message and nothing leaves
Brindle.

The `Idempotency-Key` is yours to choose. Send the same request again under the same key — after a
timeout, say — and you get this same answer back rather than a second email.

## 3. Read what happened to it

```
curl https://api.brindle.dev/v1/messages/msg_nsr08nrrht1x/events \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

```json
[
  { "id": "evt_8gn8m3bbstjx", "type": "queued",    "occurred_at": "2026-09-17T09:11:37.752Z", "detail": null },
  { "id": "evt_q4rw46054w1f", "type": "sent",      "occurred_at": "2026-09-17T09:11:39.752Z", "detail": null },
  { "id": "evt_nnmt3pj907q1", "type": "delivered", "occurred_at": "2026-09-17T09:11:40.752Z", "detail": "Test key: nothing left Brindle." }
]
```

A sandboxed message settles in a few seconds and always ends `delivered`; the `detail` on the last
event says why. On a live key the same three events arrive over the ten or twenty seconds a real
handover takes, and the message can end `bounced` or `failed` instead.

The message itself follows along: `GET /v1/messages/msg_nsr08nrrht1x` now says
`"status": "delivered"`.

## Where next

- [Authentication](authentication.md) — keys, live and test.
- [Sending](sending.md) — channels, batches, tags.
- [Templates](templates.md) — variables, versions, rendering.
- [Events and webhooks](events-and-webhooks.md) — being told rather than asking.
- [Suppressions](suppressions.md) — who you must not write to.
- [Pagination and errors](pagination-and-errors.md) — pages, codes, rate limits.
- [Versioning](versioning.md) — what `Brindle-Version` means.

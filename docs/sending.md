# Sending

One route sends one message: `POST /v1/messages`. It takes a recipient, a channel, and either a
template or the wording itself.

## The body

| Field | Required | Notes |
| --- | --- | --- |
| `to` | yes | An email address, or a phone number in international form (`+447700900123`) for `sms`. |
| `channel` | yes | `email` or `sms`. |
| `template_id` | one of | Sends the template's current version. Not with `body`. |
| `variables` | with a template | A string value for every `{{placeholder}}` in it. |
| `subject` | for email | Required for an email written out here; ignored for `sms`. |
| `body` | one of | The message itself, when it does not come from a template. Not with `template_id`. |
| `tags` | no | Up to ten short labels of your own. |

Send either `template_id` or `body`. Both together, or neither, is `invalid_request`.

```
curl https://api.brindle.dev/v1/messages \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+447700900123",
    "channel": "sms",
    "body": "Your bike is ready to collect until Saturday.",
    "tags": ["collection"]
  }'
```

The answer is the message with `"status": "queued"` and an id beginning `msg_`. Keep the id: it is
how you read the message back and how you read its events.

## Channels

**Email.** `to` is an address. A message from a template uses the template's subject; a message
written out here needs its own `subject`. Bodies are HTML; values put into a template are escaped
as they go in, so a customer called `Tom & Sons` arrives as `Tom &amp; Sons` and not as broken
markup.

**SMS.** `to` is a phone number in international form. A message written out here needs no
`subject`, and an SMS template must not have one.
Bodies are plain text and are not escaped. Long messages are split by the carrier and billed per
part.

The channel must match the template. An `sms` template sent with `"channel": "email"` is refused
with `channel_mismatch` rather than sent as something it was not written for.

## Tags

`tags` are up to ten short strings of your own, stored with the message and handed back on it and
on every webhook body. Most people tag by the thing that caused the send — `order`, `password`,
`digest` — so that support can find a run of messages later.

Tags are not used for filtering the message list. `GET /v1/messages` narrows by `status` and
`channel`.

## Batches

`POST /v1/messages/batch` takes up to five hundred of exactly the bodies above:

```
curl https://api.brindle.dev/v1/messages/batch \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: rota-week-2026-06-22" \
  -d '{
    "messages": [
      { "to": "colm.wardle@brookmail.com", "channel": "email", "template_id": "tmpl_13jprr39jzhs", "variables": { "first_name": "Colm", "order_number": "W-4411", "amount": "£19.00" } },
      { "to": "+447700900771", "channel": "sms", "template_id": "tmpl_1hjhpvx6q447", "variables": { "code": "4471" } }
    ]
  }'
```

```json
{
  "batch_id": "batch_qt1tspng4bt8",
  "accepted": [
    { "index": 0, "id": "msg_104j3gt24gqs" },
    { "index": 1, "id": "msg_30rjz767vgz7" }
  ],
  "rejected": []
}
```

A batch is not all or nothing. Rows that can be sent are sent; rows that cannot come back in
`rejected` with their position in the array you sent and the code that row would have been refused
with on its own:

```json
{
  "batch_id": "batch_qt1tspng4bt8",
  "accepted": [{ "index": 0, "id": "msg_104j3gt24gqs" }],
  "rejected": [
    { "index": 1, "code": "recipient_suppressed", "detail": "hafsa.tewson@stonebridge.email is on your suppression list. Take it off the list if you mean to write to it again." },
    { "index": 2, "code": "invalid_request", "detail": "to: \"wren at brookmail\" is not an email address." }
  ]
}
```

The answer is `202`. Read `rejected` before you treat a batch as sent; an empty `rejected` is the
only sign that every row went.

More than five hundred rows is `batch_too_large`, and a body larger than the API accepts is
`payload_too_large`. Split it and send the parts; a batch costs one
request against your rate limit however many messages are in it.

Every accepted row carries the same `batch_id` on the message.

## Retrying

`Idempotency-Key` on `POST /v1/messages` and `POST /v1/messages/batch` makes a retry safe: the
first request under a key is run and its answer kept for a day, and a repeat under the same key
gets that answer back rather than sending again. See
[Pagination and errors](pagination-and-errors.md#retrying-safely).

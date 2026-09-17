# Events and webhooks

Everything that happens to a message is an event. You can ask for them, or Brindle can post them to
you.

## Event types

| Type | Channel | What it means |
| --- | --- | --- |
| `queued` | both | Brindle has the message. Written the moment it is accepted. |
| `sent` | both | Handed to a carrier. |
| `delivered` | both | The carrier confirmed it reached the recipient. |
| `bounced` | email | The receiving server refused it. `detail` says why. |
| `failed` | both | It cannot be delivered and will not be tried again. `detail` says why. |
| `opened` | email | The recipient opened it. |
| `clicked` | email | The recipient followed a link in it. |
| `complaint` | email | The recipient marked it as spam at their provider. |

`queued`, `sent`, `delivered`, `bounced` and `failed` move the message's `status`. `opened`,
`clicked` and `complaint` do not: an opened message stays `delivered`.

A message ends at `delivered`, `bounced` or `failed`. `opened` and `clicked` can arrive days later,
and can arrive more than once — a forwarded email opened by four people is four `opened` events.

A `bounced` or a `complaint` event also puts the recipient on your
[suppression list](suppressions.md), so nothing else goes to them until you take them off it.

Text messages have no `opened`, `clicked` or `complaint`; there is nothing in an SMS to measure.

## Asking

```
curl https://api.brindle.dev/v1/messages/msg_901pn19hh7xt/events \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

```json
[
  { "id": "evt_7gsp79b2gn3w", "type": "queued",  "occurred_at": "2026-09-01T20:56:11.000Z", "detail": null },
  { "id": "evt_9nh1ft4swvvm", "type": "sent",    "occurred_at": "2026-09-01T20:56:13.000Z", "detail": null },
  { "id": "evt_pnf5b6n1zwnq", "type": "bounced", "occurred_at": "2026-09-01T20:56:19.386Z", "detail": "The receiving server said the address does not exist." }
]
```

Oldest first. A message has a handful of events, so this is the whole history rather than a page.

## Being told

Register an endpoint and Brindle posts to it instead:

```
curl https://api.brindle.dev/v1/webhooks \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.your-app.example/hooks/brindle",
    "events": ["delivered", "bounced", "failed"]
  }'
```

```json
{
  "id": "wh_0g389xqn9q",
  "url": "https://api.your-app.example/hooks/brindle",
  "events": ["delivered", "bounced", "failed"],
  "active": true,
  "created_at": "2026-09-17T09:11:44.913Z",
  "secret": "whsec_9wxm11zn2gmr1qxbntspgg907f3w6pxz"
}
```

The `secret` is in that answer and in no other. Put it straight into your environment.

Endpoints must be `https`. Ask only for the types you act on: an endpoint subscribed to `opened`
on a busy account will be posted to a great deal.

`GET /v1/webhooks` is a cursor page of your endpoints, without their secrets.
`PATCH /v1/webhooks/{id}` with `{"active": false}` stops deliveries being written for an endpoint
and keeps it and its history; `{"active": true}` starts them again.

Each body is one event:

```json
{
  "id": "evt_pnf5b6n1zwnq",
  "type": "message.bounced",
  "occurred_at": "2026-09-01T20:56:19.386Z",
  "data": {
    "message_id": "msg_901pn19hh7xt",
    "channel": "email",
    "to": "hafsa.tewson@stonebridge.email",
    "status": "bounced",
    "tags": ["order", "transactional", "security"],
    "detail": "The receiving server said the address does not exist."
  }
}
```

## Checking the signature

Every post carries:

```
Brindle-Signature: t=1788296179,v1=4a21a915917c5a5b53254d94cdf410b814ea2f037529e81411ace48e9ef46716
```

`t` is Unix seconds — the second the event happened, which is the second we post it in. `v1` is
HMAC-SHA256 of the string `<t>.<raw body>` under your endpoint's secret, in hex. Check it against
the raw bytes you received, before parsing them: re-serialising the JSON first will change the body
and the signature will not match.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(header, secret, rawBody, toleranceSeconds = 300) {
  const parts = new Map(header.split(',').map((piece) => {
    const at = piece.indexOf('=');
    return [piece.slice(0, at).trim(), piece.slice(at + 1).trim()];
  }));

  const timestamp = Number(parts.get('t'));
  const presented = parts.get('v1');
  if (!Number.isFinite(timestamp) || !presented) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

In Express, reach the raw body with `express.raw({ type: 'application/json' })` on that route
rather than `express.json()`.

Reject anything that does not verify, and anything whose timestamp is more than five minutes out.
Compare with a constant-time comparison, not `===`.

## Retries and delivery records

Answer `2xx` as soon as you have the body safely. Brindle waits ten seconds for an answer and
counts anything slower as a failed attempt.

The first attempt goes out as soon as the delivery is written. Anything other than a `2xx` — a
`500`, a timeout, a connection that will not open — is tried again after 2 seconds, then 10, then
60, then 300, then 600. That is six attempts, the last of them about sixteen minutes after the
first; after the sixth the delivery is marked `failed` and is not tried again.

Deliveries are recorded and kept for a fortnight:

```
curl https://api.brindle.dev/v1/webhooks/wh_0g389xqn9q/deliveries \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

```json
{
  "data": [
    {
      "id": "whd_r4v6b2sntq8w",
      "event_id": "evt_pnf5b6n1zwnq",
      "event_type": "bounced",
      "status": "failed",
      "attempts": 6,
      "last_error": "The endpoint answered 500.",
      "created_at": "2026-09-01T20:56:19.386Z",
      "updated_at": "2026-09-01T21:12:37.386Z"
    }
  ],
  "next_cursor": null
}
```

`attempts` and `last_error` are the first place to look when an endpoint goes quiet. An endpoint
that never answers reads `"last_error": "The endpoint did not answer within 10 seconds."`.

Deliveries can arrive out of order and the same event can arrive twice. Key on `id`, which is the
event id, and make your handler safe to run twice.

`DELETE /v1/webhooks/{id}` removes an endpoint and its delivery records.

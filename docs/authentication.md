# Authentication

Every request under `/v1` carries a key as a bearer token:

```
Authorization: Bearer bk_live_9w34rx5nmgmgzx99vggbht830q
```

`GET /health` is the only route that does not want one.

## Live keys and test keys

| Prefix | What happens |
| --- | --- |
| `bk_live_` | The message is rendered, handed to a carrier and delivered. It is billed. |
| `bk_test_` | The message is rendered and recorded exactly as a live one, marked `"sandboxed": true`, and nothing leaves Brindle. |

A test key reaches every route a live key does and sees the same account, the same templates and
the same suppression list. Sandboxed messages get events too, so you can build against `/events`
and webhooks without sending anybody anything. They count towards your usage on
[`GET /v1/account`](pagination-and-errors.md), because they are accepted and recorded like any
other message.

Use a test key in development, in your test suite and in staging. Use a live key in production and
nowhere else.

## Getting and replacing keys

Keys are made on the Keys page of your dashboard. You see the whole key once, when it is made;
after that only the last four characters. Most accounts keep one live key per environment and one
test key.

To replace a key: make the new one, deploy it, watch the old key's "last used" go quiet on the Keys
page, then delete the old one. Both work at once, so nothing has to be swapped in a single moment.

If a key gets out, delete it from the dashboard. It stops working immediately and requests carrying
it are refused with `invalid_key`.

## Keeping a key safe

- Put keys in your environment, not in your repository.
- Never put a key in front-end code. Anything a browser can read, anyone can read.
- Send from your own backend, or from a job runner that holds the key.

## What refusals look like

No key at all:

```json
{
  "type": "https://docs.brindle.dev/errors/authentication_required",
  "title": "Authentication required",
  "status": 401,
  "detail": "Send your key as an Authorization header: `Authorization: Bearer bk_live_...`.",
  "code": "authentication_required"
}
```

A key Brindle does not recognise — usually a test key on a live deployment, or a key that has been
deleted:

```json
{
  "type": "https://docs.brindle.dev/errors/invalid_key",
  "title": "Invalid key",
  "status": 401,
  "detail": "That key is not one of ours. Check which environment it came from.",
  "code": "invalid_key"
}
```

Objects belong to the account their key belongs to. A message id or a template id from another
account comes back as `404` with a `_not_found` code, not as `403`.

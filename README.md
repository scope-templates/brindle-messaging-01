# Brindle

Brindle is a transactional messaging API. I am Femi Adeyemi, and there are four of us, in an office
above a bike shop in Leeds. What we sell is one HTTP call. A product team posts a message to
`/v1/messages` — a template and some variables, or the wording itself — and we render it, hand it to
a carrier, keep the events and the suppression list, and tell them what happened to it. About three
hundred apps send through us, somewhere near forty thousand messages a day, most of it between eight
and ten on a weekday morning. The people who integrate us are product and platform engineers working
in Node, Python, Go and Ruby, and what they want from us is that a receipt goes out the first time
and that they can find out later whether it arrived.

## What is in it

This is the API itself: the routes, the store behind them, the seed the store starts from, and the
scripts we run beside it.

The store holds `accounts` (plan, limits, contact), `api_keys` (live and test, one account each),
`templates` and their `template_versions`, `messages`, `events`, `suppressions`, `webhooks`,
`webhook_deliveries` (kept a fortnight) and `idempotency` records (kept a day).

What the routes do, and what each one will not do:

- `POST /v1/messages` takes one message: a recipient, a channel, and either a template with its
  variables or the wording written out. It refuses an address that is not an address on that
  channel, a template that is not on the account or is on the other channel, a template with a
  `{{placeholder}}` the request has no value for, and a recipient on the account's suppression
  list. A message accepted with a test key is recorded like any other and marked `sandboxed`.
- `POST /v1/messages/batch` takes up to five hundred of the same. It is not all or nothing: the
  rows that can go, go, and the rest come back with their position in the array and the code each
  would have been refused with on its own. More than five hundred is refused outright.
- `GET /v1/messages` is a cursor page, newest first, narrowed by status and channel. A cursor we
  did not hand out, or one whose row has gone, is refused rather than quietly starting again.
- `GET /v1/messages/{id}` and `/events` are one message and everything that happened to it. An id
  belonging to another account is not found, not forbidden.
- `POST /v1/templates` and `PUT /v1/templates/{id}`: a `PUT` never edits wording, it writes the
  next version and points the template at it, so a message sent in March can still be read against
  what actually went out. An email template without a subject is refused.
  `POST /v1/templates/{id}/render` fills one in without sending it.
- `GET`, `POST` and `DELETE` on `/v1/suppressions` are the list of people this account must not
  write to. A bounce or a complaint puts the recipient on it as the event is written. Taking an
  address off that was never on it is refused by name.
- `POST /v1/webhooks` registers an https endpoint and hands over its signing secret once and never
  again. Every event we post is signed `t=<unix>,v1=<hmac>`, and every attempt is written down with
  its count and the last thing that went wrong. The server posts them itself on a timer, giving an
  endpoint ten seconds to answer and trying six times over sixteen minutes;
  `PATCH /v1/webhooks/{id}` turns one off without losing its history.
- `GET /v1/account` is the plan, what the plan allows and the calendar month so far.
- `GET /health` is for the monitor and wants no key.

Everything under `/v1` wants `Authorization: Bearer <key>` and is metered: `X-RateLimit-*` on every
answer to a request with a valid key, `429` and `Retry-After` past the limit. Refusals are always
`{type, title, status, detail, code}`, and `code` is the part callers branch on. `Idempotency-Key`
on a mutating POST makes a retry cost nothing.

## Running locally

```
npm ci
npm run build
npm start
```

It listens on `PORT`, or 3000. The store is a JSON file at `data/store.json`; put it somewhere else
with `DATA_DIR`. There is no database server to bring up and nothing to log into.

`npm run dev` is the same thing without building first. `npm run seed` puts the seed into a store
by hand, with `--replace` to put it back over one you have been sending through.
`npm run deliver-webhooks` is the catch-up for a store nothing is serving, and `--dry` prints what
it would try without posting anything.

## Tests

```
npm test
```

They run in memory against a small Brindle of their own — two accounts, three templates, a week of
messages — and start a server on a spare port for the ones that go over HTTP. Nothing touches
`data/`, so running them on a machine that has a store on it leaves the store alone.

## The data

An empty `DATA_DIR` fills itself on first start from `data/seed.json`, which is twelve months to
15 September 2026: every account, every key and every template as they stand, and about one message
in fifteen hundred, kept in the proportions the real months have. It is written by
`npm run build-seed` from one fixed seed, so it comes out the same every time and a change in it is
a change somebody meant to make.

It reads like the year did. One customer is a quarter of everything, most accounts send very
little, weekday mornings carry the week, and the fortnight over Christmas barely registers.

## Docs and clients

Public docs are in `docs/`. The spec is `openapi/brindle.v1.yaml`, served at `/openapi.yaml`. The
Node client library is `clients/node`, version 0.9.2, published to npm as `@brindle/node`.

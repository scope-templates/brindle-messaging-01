# @brindle/node

The Node client for the Brindle API. It wraps `fetch`, puts your key on the request and turns a
refusal into an error you can branch on.

```
npm install @brindle/node
```

Node 20 or newer.

## Getting started

```js
import { Brindle } from '@brindle/node';

const brindle = new Brindle({ apiKey: process.env.BRINDLE_API_KEY });

const message = await brindle.messages.send({
  to: 'esme.ingham@brookmail.com',
  channel: 'email',
  templateId: 'tmpl_13jprr39jzhs',
  variables: { first_name: 'Esme', order_number: 'W-4410' },
  tags: ['delivery'],
});

console.log(message.id, message.status); // msg_901pn19hh7xt queued
```

A `bk_test_` key works everywhere a live one does and nothing it sends leaves Brindle.

## What it does

| Call | Route |
| --- | --- |
| `brindle.messages.send(options)` | `POST /v1/messages` |
| `brindle.messages.get(id)` | `GET /v1/messages/{id}` |
| `brindle.templates.list({ cursor, limit })` | `GET /v1/templates` |
| `brindle.templates.get(id)` | `GET /v1/templates/{id}` |
| `brindle.templates.render(id, variables)` | `POST /v1/templates/{id}/render` |

`send` takes `to`, `channel`, and then either `templateId` with `variables`, or `subject` and
`body`. `tags` is optional. Everything comes back as the API returned it.

## Errors

Anything the API refuses is thrown as a `BrindleError` carrying the problem object. Branch on
`code`; `detail` is written for a person.

```js
import { Brindle, BrindleError } from '@brindle/node';

try {
  await brindle.messages.send({ to: address, channel: 'email', templateId: 'tmpl_13jprr39jzhs' });
} catch (error) {
  if (error instanceof BrindleError && error.code === 'recipient_suppressed') {
    await markUnreachable(address);
    return;
  }
  throw error;
}
```

`error.status` is the HTTP status and `error.title` is the short name of the refusal.

## Options

```js
const brindle = new Brindle({
  apiKey: process.env.BRINDLE_API_KEY,
  baseUrl: 'https://api.brindle.dev',
  fetch: myFetch,
});
```

`baseUrl` points the client somewhere else, which is how our own tests run it against an app in
the same process. `fetch` replaces the global one.

The full API is documented at <https://docs.brindle.dev>.

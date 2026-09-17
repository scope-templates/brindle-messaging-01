# Versioning

The API is versioned by date. The version this deployment speaks is on every answer:

```
Brindle-Version: 2026-06-15
```

`GET /health` says the same thing in its body, next to `build`, which names the deployment rather
than the API version. The spec at `https://api.brindle.dev/openapi.yaml` is the spec for the
version a deployment speaks.

## What a version covers

A dated version covers the shape of every request and answer: which routes exist, which fields are
required, what the `code` on a refusal will be, and what the webhook bodies look like.

Within a version we will:

- add a route;
- add an optional field to a request;
- add a field to an answer;
- add a value to a list such as `tags`;
- reword a `detail` on a refusal.

So parse answers leniently: ignore fields you were not expecting, and do not treat a new key in an
object as an error.

Within a version we will not:

- remove or rename a field;
- make an optional field required;
- change what an existing `code` means, or the status it comes with;
- change the meaning of an event type.

Any of those is a new dated version.

## Released versions

| Version | What changed |
| --- | --- |
| `2026-06-15` | `POST /v1/messages/batch`; `GET /v1/messages/{id}/events`; the suppressions routes; the `complaint` event; `Idempotency-Key` on mutating POSTs; `PUT /v1/templates/{id}` writes a new version instead of overwriting. |
| `2025-09-01` | Lists became cursor pages returning `{data, next_cursor}`; `X-RateLimit-*` on every answer; `POST /v1/templates/{id}/render`; webhook bodies gained `tags`. |
| `2025-01-20` | The first public version, with problem objects on every refusal. |

The root `CHANGELOG.md` in the API repository carries the same list with the detail.

## Moving between versions

Deployments speak one version. When a new one is released we run both for at least six months and
write to the technical contact on every account with the date the old one stops.

To move:

1. Read the row for the new version above and the entry in the changelog.
2. Point a test key at the new version in staging and run your own suite against it.
3. Deploy, and watch your webhook handler: bodies are the part people forget.

If you are on a version that is closing and need longer, write to support@brindle.dev before the
date rather than after it.

## The spec

`https://api.brindle.dev/openapi.yaml` is the OpenAPI 3.1 description of the version that
deployment speaks, and `openapi/brindle.v1.yaml` in the API repository is the same file. It carries
every route, the schemas, examples and the security scheme.

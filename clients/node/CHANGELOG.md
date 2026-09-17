# Changelog

## 0.9.2 — 2026-02-20

- `templates.render` sends `{}` rather than no body when no variables are passed, which some
  proxies were turning into a 411.
- Types for `Message.variables` allow `null`, which is what the API returns for a message that was
  written out rather than rendered.

## 0.9.1 — 2026-01-14

- `BrindleError` keeps `title` and `type` from the problem object instead of dropping them.
- The client no longer sets `content-type` on a GET.

## 0.9.0 — 2025-11-27

- `templates.render(id, variables)` added.
- `baseUrl` may now be passed with or without a trailing slash.

## 0.8.0 — 2025-09-30

- `templates.list` takes `cursor` and `limit` and returns `{ data, next_cursor }`, following the
  change to cursor pages in the `2025-09-01` API version.
- **Breaking:** `templates.list` no longer returns a bare array.

## 0.7.1 — 2025-06-18

- `messages.send` no longer sends keys whose value is `undefined`, which the API was refusing with
  `invalid_request`.

## 0.7.0 — 2025-05-06

- `messages.get(id)` added.
- `tags` added to `messages.send`.

## 0.6.1 — 2025-04-02

- A refusal with a body the client cannot read is now a `BrindleError` with code `unknown` rather
  than a `SyntaxError`.

## 0.6.0 — 2025-03-11

- First release on npm as `@brindle/node`: `messages.send` and `templates.list`, bearer auth,
  `BrindleError` from the problem object.

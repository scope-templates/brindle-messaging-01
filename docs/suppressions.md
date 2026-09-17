# Suppressions

The suppression list is the set of addresses your account must not write to. A send to an address
on it is refused, not quietly dropped, so you always know it did not go.

## Why an address ends up on it

| Reason | Who put it there |
| --- | --- |
| `hard_bounce` | Brindle, on a `bounced` event: the receiving server said the address does not exist. |
| `complaint` | Brindle, on a `complaint` event: the recipient marked a message as spam. |
| `unsubscribed` | You, when somebody asked you to stop. |
| `manual` | You, for any other reason. |

Brindle adds `hard_bounce` and `complaint` itself, the moment the event is written. Continuing to
write to addresses that bounce is the fastest way to have your mail refused by everybody, so it is
not optional.

Lists are per account. An address suppressed on your account is not suppressed on anybody else's.

## SMS

Phone numbers go on the same list, in international form, and are refused for the same reason with
the same code. Add one when a recipient replies STOP to a text; Brindle does not see those replies,
because the reply goes to the carrier rather than to us.

## What a refused send looks like

```json
{
  "type": "https://docs.brindle.dev/errors/recipient_suppressed",
  "title": "Recipient suppressed",
  "status": 422,
  "detail": "hafsa.tewson@stonebridge.email is on your suppression list. Take it off the list if you mean to write to it again.",
  "code": "recipient_suppressed"
}
```

In a batch it is one `rejected` row with `"code": "recipient_suppressed"`; the rest of the batch
goes.

The check runs before the template is rendered, so a suppressed recipient is refused for that
reason even if the request is wrong in other ways too.

## Reading the list

```
curl "https://api.brindle.dev/v1/suppressions?limit=2" \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

```json
{
  "data": [
    { "address": "hafsa.tewson@stonebridge.email", "reason": "hard_bounce", "created_at": "2026-09-01T20:56:19.386Z" },
    { "address": "bethan.gillanders@brookmail.com", "reason": "complaint", "created_at": "2026-08-24T11:57:20.310Z" }
  ],
  "next_cursor": "YnJpbmRsZTpiZXRoYW4uZ2lsbGFuZGVyc0Bicm9va21haWwuY29t"
}
```

The first of those went on the list by itself: `msg_901pn19hh7xt` bounced at that second, and the
address was suppressed as the event was written.

Newest first, a page at a time. Pass `next_cursor` back as `cursor` for the next page.

## Adding an address

```
curl https://api.brindle.dev/v1/suppressions \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "address": "zara.tewson@brookmail.com", "reason": "unsubscribed" }'
```

`reason` is optional and defaults to `manual`. Adding an address that is already on the list
changes its reason rather than making a second row.

Most people call this from their own unsubscribe page, so the wish is honoured even if a job
somewhere else still has the address on a list of its own.

## Taking one off

```
curl -X DELETE "https://api.brindle.dev/v1/suppressions/zara.tewson%40brookmail.com" \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

`204` and the next send goes through. Percent-encode the address in the path: `@` is `%40` and the
`+` on a phone number is `%2B`.

An address that was never on the list is `404` with `suppression_not_found`.

Take an address off when the person has asked you to start again — they have signed up a second
time, or they have told support the bounce was their mail server having a bad week. Taking off an
address that hard-bounced without that is how a sending domain gets itself refused everywhere.

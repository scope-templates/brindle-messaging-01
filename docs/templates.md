# Templates

A template is a name, a channel and a body with `{{placeholders}}` in it. Keeping your wording in
Brindle means marketing can change a sentence without a deploy, and it means a message that went
out last March can still be read against the wording it was rendered from.

## Making one

```
curl https://api.brindle.dev/v1/templates \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Appointment reminder",
    "channel": "email",
    "subject": "Your appointment on {{date}}",
    "body": "<p>Hello {{first_name}},</p>\n<p>You are booked in for {{time}} on {{date}} at our {{city}} branch.</p>"
  }'
```

An email template needs a `subject`. An SMS template must not have one: a text message has no
subject line, and sending one is refused with `invalid_request` rather than quietly dropped.

## Variables

A placeholder is `{{name}}`. Names are letters, digits, underscores and dots. Whitespace inside the
braces is ignored, so `{{ first_name }}` and `{{first_name}}` are the same placeholder.

Every placeholder in the subject and the body needs a value at send time. A missing one stops the
send:

```json
{
  "type": "https://docs.brindle.dev/errors/variable_missing",
  "title": "Variable missing",
  "status": 422,
  "detail": "This template needs a value for \"amount\" and the request did not carry one.",
  "code": "variable_missing"
}
```

That is on purpose. A receipt with a gap in it is worse than a receipt that did not go.

Values are strings. Format numbers, money and dates yourself, in the customer's own terms —
`£82.40`, `Tuesday 23 June` — because Brindle does not know your currency or their timezone.

On `email`, values are HTML-escaped as they go in: `Tom & Sons` arrives as `Tom &amp; Sons`, and a
value carrying `<script>` arrives as text. On `sms`, values go in as they are, because the message
is plain text.

## Versions

`PUT /v1/templates/{id}` does not edit the wording. It writes the next version and points the
template at it:

```
curl -X PUT https://api.brindle.dev/v1/templates/tmpl_13jprr39jzhs \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Order {{order_number}} is confirmed",
    "body": "<p>Hi {{first_name}},</p>\n<p>Thanks for your order. We have taken {{amount}} and {{order_number}} is with our packers now.</p>\n<p>You can stop these under Notifications in your account.</p>"
  }'
```

```json
{
  "id": "tmpl_13jprr39jzhs",
  "name": "Order confirmed",
  "channel": "email",
  "current_version": 4,
  "created_at": "2025-02-17T13:08:52.000Z",
  "updated_at": "2026-09-17T09:11:37.772Z",
  "subject": "Order {{order_number}} is confirmed",
  "body": "<p>Hi {{first_name}},</p>\n<p>Thanks for your order. We have taken {{amount}} and {{order_number}} is with our packers now.</p>\n<p>You can stop these under Notifications in your account.</p>"
}
```

Sending always uses the current version. The ones before it are still there:

```
curl https://api.brindle.dev/v1/templates/tmpl_13jprr39jzhs/versions \
  -H "Authorization: Bearer $BRINDLE_KEY"
```

```json
[
  {
    "id": "tv_wr1q44jj27s6",
    "template_id": "tmpl_13jprr39jzhs",
    "version": 1,
    "subject": "Your order {{order_number}} is confirmed",
    "body": "<p>Hello {{first_name}},</p>\n<p>Thanks for your order. We have taken {{amount}} and {{order_number}} is with our packers now.</p>\n<p>We will write again the moment it leaves the building.</p>\n<p>{{company}}</p>",
    "created_at": "2025-02-17T13:08:52.000Z"
  },
  {
    "id": "tv_rjbppqmh7g34",
    "template_id": "tmpl_13jprr39jzhs",
    "version": 2,
    "subject": "Your order {{order_number}} is confirmed",
    "body": "<p>Hi {{first_name}},</p>\n<p>Thanks for your order. We have taken {{amount}} and {{order_number}} is with our packers now.</p>\n<p>We will write again the moment it leaves the building.</p>\n<p>{{company}}</p>",
    "created_at": "2025-10-12T10:57:57.000Z"
  },
  {
    "id": "tv_wg1vrt80b880",
    "template_id": "tmpl_13jprr39jzhs",
    "version": 3,
    "subject": "Your order {{order_number}} is confirmed",
    "body": "<p>Hi {{first_name}},</p>\n<p>Thanks for your order. We have taken {{amount}} and {{order_number}} is with our packers now.</p>\n<p>We will write again the moment it leaves the building.</p>\n<p>{{company}}</p>\n<p>You can stop these under Notifications in your account.</p>",
    "created_at": "2026-04-22T14:05:07.000Z"
  },
  {
    "id": "tv_64rtsjmsb93x",
    "template_id": "tmpl_13jprr39jzhs",
    "version": 4,
    "subject": "Order {{order_number}} is confirmed",
    "body": "<p>Hi {{first_name}},</p>\n<p>Thanks for your order. We have taken {{amount}} and {{order_number}} is with our packers now.</p>\n<p>You can stop these under Notifications in your account.</p>",
    "created_at": "2026-09-17T09:11:37.772Z"
  }
]
```

Every message records the `template_version` it was rendered from, so a message sent before a
change can be read back against the wording that actually went out.

A template has a handful of versions, so `/versions` gives you all of them rather than a page.

`name` can be changed on a `PUT` along with the wording. It is for your own lists and is not sent
to anybody.

## Rendering without sending

`POST /v1/templates/{id}/render` fills a template in and hands it back:

```
curl https://api.brindle.dev/v1/templates/tmpl_13jprr39jzhs/render \
  -H "Authorization: Bearer $BRINDLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "variables": { "first_name": "Esme", "order_number": "W-4410", "amount": "£82.40" } }'
```

```json
{
  "subject": "Order W-4410 is confirmed",
  "body": "<p>Hi Esme,</p>\n<p>Thanks for your order. We have taken £82.40 and W-4410 is with our packers now.</p>\n<p>You can stop these under Notifications in your account.</p>",
  "template_id": "tmpl_13jprr39jzhs",
  "version": 4
}
```

Pass `"version": 1` to render an older one — which is how to see what a customer was actually sent
last month. Nothing is queued, nothing is billed, and the same `variable_missing` rules apply, so
this is the quickest way to check a template before you point production at it.

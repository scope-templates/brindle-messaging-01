# Working on Brindle

There are four of us, and every piece of work starts as a ticket in our tracker. A ticket's key
looks like `BRN-123`.

- Name the branch after the ticket, key first: `BRN-123-cursor-on-filtered-lists`.
- Start every commit message with the key: `BRN-123: Keep the cursor when a row changes status`.
  The tracker links the branch and its commits to the ticket, so a change can be read in one place.
- A bug you find while working on something else gets a ticket of its own. File it, say where you
  saw it, and carry on with what you were doing; a fix slipped into a diff about something else is
  one nobody finds again.
- A bug we know about and have not fixed yet goes under Known issues at the top of `CHANGELOG.md`
  with its key, and as `FIXME(BRN-123)` at the spot in the code. A test that shows it is skipped
  with the key in its name, so whoever fixes it knows which test to turn back on.
- Before you push: `npm ci`, `npm run build`, `npm test`. The tests run in memory and leave `data/`
  alone. CI runs the same, and type-checks `clients/node` as well.
- A change to what the API promises goes in `CHANGELOG.md` under its dated version;
  [`docs/versioning.md`](docs/versioning.md) says what a version may and may not change.

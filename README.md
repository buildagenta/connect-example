# Agenta Connect Example

This is an example implementation of the `/connect` endpoint, which allows
you to authenticate Slack, Teams, and Copilot users with your product.

Without a Customer Sign-In URL an agent runs as its owner. This endpoint is what
makes it run as each of your customers instead.

## The flow

1. An unlinked user messages the agent — or runs its command, clicks one of its
   buttons, or reacts to point it at something. Agenta posts a **Connect** button
2. The button opens your Customer Sign-In URL with a ten-minute, single-use token
   as `?token=`, and the app they came from as `?platform=`
3. Your page signs the visitor in the way your product already does
4. Your backend asks `POST /api/v1/customer-links/preview` who the token names,
   and your page shows it next to who they are signed in as. Only then does it
   offer Connect
5. Your backend `POST`s the token and your own identifier for that user to
   `POST /api/v1/customer-links`, with your Agenta API key
6. Agenta stores the link. It is durable — only the token was short-lived — and
   the user's next message runs as that customer

Agenta never sees the customer's credentials.

## Files

| File                   | What it is                                                 |
| ---------------------- | ---------------------------------------------------------- |
| `src/connect.ts`       | `POST /connect` and its preview proxy                      |
| `src/connect-page.tsx` | The page the Connect button opens. Five states, no styling |

## Environment

Server side only — an `AGENTA_API_KEY` that reaches the browser is a leaked
credential:

| Variable         | What it is                                                          |
| ---------------- | ------------------------------------------------------------------- |
| `AGENTA_API_KEY` | A standard user API key, minted at <https://app.buildagenta.com/api-keys> |
| `AGENTA_API_URL` | `https://app.buildagenta.com/api/v1`                                      |

## Your Customer Sign-In URL

Set it on the agent's Publish page, in the last step of Slack or Teams setup.
Serving the page below at `/connect` makes it:

```
https://app.example.com/connect
```

## What can go wrong

| Agenta answers        | What happened                                    | What to tell them            |
| --------------------- | ------------------------------------------------ | ---------------------------- |
| `400 invalid_request` | Expired, tampered with, or not a token           | Ask the agent for a new link |
| `409 link_token_used` | The link was already redeemed                    | Ask for a new one if needed  |
| `401` to `404`        | Your API key or plan, or an agent it doesn't own | Try again later              |
| No answer, or a `5xx` | Agenta could not be reached                      | Try again                    |

Your endpoints answer `502` for the last two rows. Neither is the person's
link, so neither may read as an expired one: they would only ask the agent for
a new link that fails the same way.

Only redeeming says a link was used. The preview reads the token, not whether
it has been redeemed, so a spent link still names its account until it
expires.

## Two things to keep

Both are in the example. They are easy to drop when you rewrite the page in your
own components, and each one is load-bearing.

**Say whose chat account is being linked.** A link token is a bearer credential:
anyone holding the URL can click Connect. So an attacker asks the agent for their
own Connect link and sends it to one of your customers, who signs in as
themselves and binds *the attacker's* Slack account to their account — after
which the attacker's messages run as them. Every request in that sequence is
first-party, correctly signed, and impossible to tell from the real thing at the
server. The only place it can be caught is on the page, by a person reading
"Connect your account (you@corp.com) to Slack (@attacker in Some Other Corp)".
That is what `preview` is for, and why the page offers no Connect button until
it has answered, or when it could not.

**Take a JSON body, not a form post.** An HTML form can only send urlencoded,
multipart, or plain text bodies, so a server that requires `application/json`
cannot be driven by a form on someone else's site. Combined with a `SameSite=Lax`
session cookie, that is what stops another origin redeeming a link as whoever is
signed in — no CSRF token needed. If you change `/connect` to accept a form
post, add one.

## Running the checks

```bash
bun install
bun run check && bun run typecheck && bun test
```

This is source to copy, not an app to boot — you already have a server, a router
and a sign-in flow. Take the two files and see `AGENTS.md`.

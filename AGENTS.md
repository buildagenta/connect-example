# Applying this example

Instructions for a coding agent adding Agenta account linking to an existing web
app. Read `README.md` first for the flow.

## 1. Add the endpoint

Copy `src/connect.ts` into wherever the app keeps its server code, next to its
other routes.

Mount `handleConnectRequest` at `POST /connect`, passing the app's own
session check as `authenticate`. It has to return the app's own identifier for the
signed-in user — the id the app already uses in its own database — or `null` when
the request carries no session.

If the app's framework does not use web `Request`/`Response` (Express, Fastify,
Koa), drop `handleConnectRequest` and call `redeemLinkToken(token, customerId)`
from a handler written in that framework's own style. `redeemLinkToken` is the
part that matters; the wrapper is convenience.

Three things this endpoint must not do, because they are the whole security model:

- Do not accept a `customerId` from the request body. The server decides who the
  caller is; a body-supplied id lets anyone link a chat account to anyone
- Do not expose the endpoint unauthenticated
- Do not accept a body that is not `Content-Type: application/json`. Refuse it
  with 415 before reading the session. Parsing whatever arrives is not enough:
  a `text/plain` form on another site can send a body that parses as JSON, and
  would redeem its own token as whoever is signed in here. The handlers do this;
  a handler you write in your framework's own style has to as well, and so does
  your preview route

Mount `handlePreviewRequest` at `POST /connect/preview`. The page calls it first
so it can name the chat account before anyone clicks Connect.

## 2. Add the environment variables

`AGENTA_API_KEY` and `AGENTA_API_URL`, as described in `README.md`. Server-side
only. In a framework that prefixes public variables (`NEXT_PUBLIC_`, `VITE_`),
neither takes that prefix.

## 3. Add the page

Copy `src/connect-page.tsx` in and route it at `/connect`, so the endpoint
and the page share a path and the URL is easy to say out loud.

Wire its props to the app's own auth: `loading` and `isAuthenticated` from
whatever hook the app already uses, and `signIn(returnTo)` to whatever starts the
sign-in flow. Read `token` and `platform` from the query string with the app's own
router — Agenta sends both, so nothing has to decode a token in the browser.

Then restyle it. It renders bare `<main>`, `<h1>` and `<button>` so the states are
readable; use the app's own layout, logo and components. What must survive the
restyle:

- The five states, and the wording that sends people back to the chat app. A
  person on this page came from Slack or Teams and needs to be told to go back
- No Connect button until the preview has named the chat account, including
  when the preview fails. That name is the only check a person can make against
  a link somebody else sent them
- The `noindex,nofollow` and `no-referrer` meta tags. The URL carries a token
- Sign-in starting on arrival rather than behind a second click

If the page cannot post to `/connect` with cookies alone (an auth SDK that
holds a bearer token), add the header to the `fetch` in `connect`.

## 4. Set the Customer Sign-In URL

On the agent's Publish page at <https://app.buildagenta.com>, in the last step of Slack
or Teams setup, set `https://app.example.com/connect`. It must be https.
Until it is set, the agent runs as its owner rather than as your customers.

## 5. Check it

Message the agent in Slack or Teams as a user who has never linked. The Connect
button should appear, the link should sign you in and connect, and the next
message should get a real answer.

// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * `POST /connect` — the endpoint that turns a Slack or Teams user into one
 * of your customers.
 *
 * The link token arrives in the browser, from the Connect button Agenta posted
 * to an unlinked user. It names that platform user and nothing else; who they are
 * in *your* product is a question only you can answer, which is why this exchange
 * happens on your server, against your session, with your API key.
 *
 * Framework-free on purpose. `redeemLinkToken` is the part that matters and drops
 * into anything; `handleConnectRequest` wraps it for any runtime that speaks the
 * web `Request`/`Response` types (Next.js route handlers, Hono, Bun.serve).
 */

/** What went wrong, in the terms the page has to explain to a person. */
export type ConnectFailure = "invalid" | "used" | "unreachable";

export type ConnectResult = { connected: true } | { connected: false; reason: ConnectFailure };

/**
 * Why there is nothing to show for a link token.
 *
 * No `used`: the preview reads the token, not whether it has been redeemed, so a
 * spent link still previews until it expires. Only redeeming it says so.
 */
export type PreviewFailure = "invalid" | "unreachable";

export type PreviewResult =
    | { described: true; description: LinkDescription }
    | { described: false; reason: PreviewFailure };

/**
 * Who a link token names, for the page to show before anyone clicks Connect.
 *
 * Absent names are normal: a platform only tells Agenta what it will, and Teams
 * will not name a tenant at all.
 */
export interface LinkDescription {
    agentName: string;
    surface: "slack" | "teams" | "copilot";
    workspaceName?: string;
    platformUserName?: string;
}

/**
 * Per-customer values the agent's tools resolve at run time.
 *
 * Use them to hand the agent this customer's own access to your API, so a run in
 * Slack acts as them rather than as you.
 */
export interface RequestValues {
    variables?: Record<string, string>;
    secrets?: Record<string, string>;
}

const env = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
};

/**
 * Redeems a link token against Agenta, binding it to one of your customers.
 * @param linkToken The `?token=` the Connect button carried into the browser.
 * @param customerId Your own identifier for the signed-in user.
 * @param values Per-customer variables and secrets for this customer's runs.
 * @returns Whether the link was made, and why not when it was not.
 */
export async function redeemLinkToken(
    linkToken: string,
    customerId: string,
    values: RequestValues = {},
): Promise<ConnectResult> {
    let response: Response;
    try {
        response = await fetch(`${env("AGENTA_API_URL")}/customer-links`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env("AGENTA_API_KEY")}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ linkToken, customerId, ...values }),
        });
    } catch {
        return { connected: false, reason: "unreachable" };
    }

    if (response.ok) return { connected: true };
    // A token that is expired, tampered with, or simply wrong is one case to the
    // person holding it: ask the agent for a new link.
    if (response.status === 400) return { connected: false, reason: "invalid" };
    // A second click on the same button. The link is single-use by design.
    if (response.status === 409) return { connected: false, reason: "used" };
    return { connected: false, reason: "unreachable" };
}

const SURFACES: ReadonlySet<string> = new Set(["slack", "teams", "copilot"]);

const optionalName = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

/**
 * Asks Agenta who a link token names, without redeeming it.
 *
 * Show what this returns. A link token is a bearer credential: whoever holds the
 * URL can click Connect, so an attacker only has to get their own Connect link
 * in front of somebody else — every request that follows is first-party, signed,
 * and indistinguishable from the real thing. Naming the chat account the link
 * would bind to is the one part of the flow the victim can recognise as wrong.
 * @param linkToken The `?token=` the Connect button carried into the browser.
 * @returns Who the token names, or why there is nothing to show.
 */
export async function previewLinkToken(linkToken: string): Promise<PreviewResult> {
    let response: Response;
    try {
        response = await fetch(`${env("AGENTA_API_URL")}/customer-links/preview`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env("AGENTA_API_KEY")}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ linkToken }),
        });
    } catch {
        return { described: false, reason: "unreachable" };
    }

    // Only a 400 is about the link: expired, tampered with, or simply wrong. A 401
    // is your API key, and a 403 or 404 an agent that key does not own or that no
    // longer exists. None of those is the person's fault, and calling the link
    // expired would only send them for a new one that fails the same way.
    if (response.status === 400) return { described: false, reason: "invalid" };
    if (!response.ok) return { described: false, reason: "unreachable" };

    let body: Record<string, unknown>;
    try {
        body = (await response.json()) as Record<string, unknown>;
    } catch {
        return { described: false, reason: "unreachable" };
    }
    if (typeof body.agentName !== "string" || !SURFACES.has(body.surface as string)) {
        return { described: false, reason: "unreachable" };
    }
    return {
        described: true,
        description: {
            agentName: body.agentName,
            surface: body.surface as LinkDescription["surface"],
            workspaceName: optionalName(body.workspaceName),
            platformUserName: optionalName(body.platformUserName),
        },
    };
}

/** Resolves the signed-in user, or null when the request carries no session. */
export type Authenticate = (request: Request) => Promise<string | null>;

const STATUS_BY_REASON: Record<ConnectFailure, number> = {
    invalid: 400,
    used: 409,
    unreachable: 502,
};

const MESSAGE_BY_REASON: Record<ConnectFailure, string> = {
    invalid: "This connection link is invalid or has expired",
    used: "This connection link has already been used",
    unreachable: "Agenta could not be reached",
};

const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

/**
 * Builds the route handler.
 * @param authenticate Your own session check, returning the customer id.
 * @returns A handler to mount at `POST /connect`.
 */
export function handleConnectRequest(
    authenticate: Authenticate,
): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
        const customerId = await authenticate(request);
        if (!customerId) return json({ error: "Unauthorized" }, 401);

        const body = (await request.json().catch(() => ({}))) as { token?: string };
        const linkToken = body.token?.trim();
        if (!linkToken) return json({ error: "A connection token is required" }, 400);

        // Whatever this customer's runs need, if the agent's tools take any:
        //   { variables: { yourServerUrl: API_BASE }, secrets: { yourToken: ... } }
        const result = await redeemLinkToken(linkToken, customerId);
        if (result.connected) return json({ connected: true }, 200);

        return json({ error: MESSAGE_BY_REASON[result.reason] }, STATUS_BY_REASON[result.reason]);
    };
}

/**
 * Builds the route handler behind the identity the page shows.
 *
 * Separate from the redeem handler because the page calls it first, on arrival,
 * and because it changes nothing. Your API key stays on your server either way;
 * this is the proxy that keeps it there.
 * @param authenticate Your own session check, returning the customer id.
 * @returns A handler to mount at `POST /connect/preview`.
 */
export function handlePreviewRequest(
    authenticate: Authenticate,
): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
        if (!(await authenticate(request))) return json({ error: "Unauthorized" }, 401);

        const body = (await request.json().catch(() => ({}))) as { token?: string };
        const linkToken = body.token?.trim();
        if (!linkToken) return json({ error: "A connection token is required" }, 400);

        const result = await previewLinkToken(linkToken);
        if (result.described) return json(result.description, 200);
        return json({ error: MESSAGE_BY_REASON[result.reason] }, STATUS_BY_REASON[result.reason]);
    };
}

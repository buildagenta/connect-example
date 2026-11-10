// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    handleConnectRequest,
    handlePreviewRequest,
    previewLinkToken,
    redeemLinkToken,
} from "../src/connect.js";

const originalFetch = globalThis.fetch;

const respondWith = (status: number, body?: unknown): void => {
    globalThis.fetch = (async () =>
        new Response(body === undefined ? null : JSON.stringify(body), {
            status,
        })) as unknown as typeof fetch;
};

const DESCRIPTION = {
    agentId: "agent-1",
    agentName: "Bookings",
    platform: "slack",
    surface: "slack",
    workspaceName: "Acme Corp",
    platformUserName: "alice",
    expiresAt: "2026-01-01T00:10:00.000Z",
};

const post = (body: unknown, contentType = "application/json"): Request =>
    new Request("https://example.com/connect", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });

// All a cross-site form can send. `text/plain` carries JSON as well as any,
// which is how a form on another site would redeem its own token here.
const FORM_TYPES = ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"];

beforeEach(() => {
    process.env.AGENTA_API_URL = "https://app.buildagenta.com/api/v1";
    process.env.AGENTA_API_KEY = "agenta_test";
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("redeemLinkToken", () => {
    test("connects on success", async () => {
        respondWith(200);
        expect(await redeemLinkToken("token", "customer-1")).toEqual({ connected: true });
    });

    test("reports an expired or tampered token", async () => {
        respondWith(400);
        expect(await redeemLinkToken("token", "customer-1")).toEqual({
            connected: false,
            reason: "invalid",
        });
    });

    test("reports a link that has already been used", async () => {
        respondWith(409);
        expect(await redeemLinkToken("token", "customer-1")).toEqual({
            connected: false,
            reason: "used",
        });
    });

    test("reports Agenta being unreachable", async () => {
        globalThis.fetch = (async () => {
            throw new Error("network");
        }) as unknown as typeof fetch;
        expect(await redeemLinkToken("token", "customer-1")).toEqual({
            connected: false,
            reason: "unreachable",
        });
    });

    test("sends the customer's own values", async () => {
        let sent: string | undefined;
        globalThis.fetch = (async (_url: string, init: RequestInit) => {
            sent = init.body as string;
            return new Response(null, { status: 200 });
        }) as unknown as typeof fetch;

        await redeemLinkToken("token", "customer-1", { secrets: { yourToken: "s3cret" } });

        expect(JSON.parse(sent ?? "{}")).toEqual({
            linkToken: "token",
            customerId: "customer-1",
            secrets: { yourToken: "s3cret" },
        });
    });
});

describe("handleConnectRequest", () => {
    const authenticated = async (): Promise<string> => "customer-1";

    test("refuses an unauthenticated caller before reaching Agenta", async () => {
        respondWith(200);
        const handler = handleConnectRequest(async () => null);
        expect((await handler(post({ token: "token" }))).status).toBe(401);
    });

    test("refuses a request with no token", async () => {
        respondWith(200);
        const handler = handleConnectRequest(authenticated);
        expect((await handler(post({}))).status).toBe(400);
    });

    test.each(FORM_TYPES)("refuses a %s post before asking who is signed in", async (type) => {
        let reached = false;
        globalThis.fetch = (async () => {
            reached = true;
            return new Response(null, { status: 200 });
        }) as unknown as typeof fetch;
        let authenticated = false;
        const handler = handleConnectRequest(async () => {
            authenticated = true;
            return "customer-1";
        });

        const response = await handler(post(JSON.stringify({ token: "attacker-token" }), type));

        expect(response.status).toBe(415);
        expect(authenticated).toBe(false);
        expect(reached).toBe(false);
    });

    test("accepts JSON with a charset", async () => {
        respondWith(200);
        const handler = handleConnectRequest(authenticated);
        const response = await handler(post({ token: "token" }, "application/json; charset=utf-8"));
        expect(response.status).toBe(200);
    });

    test("answers 200 once the link is made", async () => {
        respondWith(200);
        const handler = handleConnectRequest(authenticated);
        const response = await handler(post({ token: "token" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ connected: true });
    });

    test("passes Agenta's refusal through as its own status", async () => {
        respondWith(409);
        const handler = handleConnectRequest(authenticated);
        expect((await handler(post({ token: "token" }))).status).toBe(409);
    });
});

describe("previewLinkToken", () => {
    test("names the chat account the token would bind to", async () => {
        respondWith(200, DESCRIPTION);
        expect(await previewLinkToken("token")).toEqual({
            described: true,
            description: {
                agentName: "Bookings",
                surface: "slack",
                workspaceName: "Acme Corp",
                platformUserName: "alice",
            },
        });
    });

    test("leaves out names the platform did not give", async () => {
        respondWith(200, { agentName: "Bookings", surface: "teams" });
        expect(await previewLinkToken("token")).toEqual({
            described: true,
            description: {
                agentName: "Bookings",
                surface: "teams",
                workspaceName: undefined,
                platformUserName: undefined,
            },
        });
    });

    test("reports an expired or tampered token as invalid", async () => {
        respondWith(400);
        expect(await previewLinkToken("token")).toEqual({ described: false, reason: "invalid" });
    });

    // A bad API key, or an agent the key does not own or that is gone: none of
    // them is the link's fault, so none of them may read as an expired link.
    test.each([401, 403, 404, 500])(
        "reports Agenta answering %i as unreachable",
        async (status) => {
            respondWith(status);
            expect(await previewLinkToken("token")).toEqual({
                described: false,
                reason: "unreachable",
            });
        },
    );

    test("reports Agenta being unreachable", async () => {
        globalThis.fetch = (async () => {
            throw new Error("network");
        }) as unknown as typeof fetch;
        expect(await previewLinkToken("token")).toEqual({
            described: false,
            reason: "unreachable",
        });
    });

    test.each([
        ["no surface", { agentName: "Bookings" }],
        ["an unknown surface", { agentName: "Bookings", surface: "irc" }],
        ["no agent name", { surface: "slack" }],
    ])("reports a description with %s as unreachable", async (_label, body) => {
        respondWith(200, body);
        expect(await previewLinkToken("token")).toEqual({
            described: false,
            reason: "unreachable",
        });
    });

    test("reports a body that is not JSON as unreachable", async () => {
        globalThis.fetch = (async () =>
            new Response("not json", { status: 200 })) as unknown as typeof fetch;
        expect(await previewLinkToken("token")).toEqual({
            described: false,
            reason: "unreachable",
        });
    });
});

describe("handlePreviewRequest", () => {
    const authenticated = async (): Promise<string> => "customer-1";

    test("refuses an unauthenticated caller before reaching Agenta", async () => {
        respondWith(200, DESCRIPTION);
        const handler = handlePreviewRequest(async () => null);
        expect((await handler(post({ token: "token" }))).status).toBe(401);
    });

    test("refuses a request with no token", async () => {
        respondWith(200, DESCRIPTION);
        const handler = handlePreviewRequest(authenticated);
        expect((await handler(post({}))).status).toBe(400);
    });

    test.each(FORM_TYPES)("refuses a %s post", async (type) => {
        let reached = false;
        globalThis.fetch = (async () => {
            reached = true;
            return new Response(null, { status: 200 });
        }) as unknown as typeof fetch;
        const handler = handlePreviewRequest(authenticated);

        const response = await handler(post(JSON.stringify({ token: "token" }), type));

        expect(response.status).toBe(415);
        expect(reached).toBe(false);
    });

    test("answers the description, and never the API key that fetched it", async () => {
        respondWith(200, DESCRIPTION);
        const handler = handlePreviewRequest(authenticated);
        const response = await handler(post({ token: "token" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            agentName: "Bookings",
            surface: "slack",
            workspaceName: "Acme Corp",
            platformUserName: "alice",
        });
    });

    test("reports a token Agenta will not preview as invalid", async () => {
        respondWith(400);
        const handler = handlePreviewRequest(authenticated);
        expect((await handler(post({ token: "token" }))).status).toBe(400);
    });

    test("reports Agenta refusing your API key as a 502, not an invalid link", async () => {
        respondWith(401);
        const handler = handlePreviewRequest(authenticated);
        const response = await handler(post({ token: "token" }));
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "Agenta could not be reached" });
    });
});

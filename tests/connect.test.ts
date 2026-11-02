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

const post = (body: unknown): Request =>
    new Request("https://example.com/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

beforeEach(() => {
    process.env.AGENTA_API_URL = "https://app.buildagenta.com/api/v1";
    process.env.AGENTA_API_KEY = "a2anet_test";
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
            agentName: "Bookings",
            surface: "slack",
            workspaceName: "Acme Corp",
            platformUserName: "alice",
        });
    });

    test("leaves out names the platform did not give", async () => {
        respondWith(200, { agentName: "Bookings", surface: "teams" });
        expect(await previewLinkToken("token")).toEqual({
            agentName: "Bookings",
            surface: "teams",
            workspaceName: undefined,
            platformUserName: undefined,
        });
    });

    test.each([400, 404, 500])("has nothing to show when Agenta answers %i", async (status) => {
        respondWith(status);
        expect(await previewLinkToken("token")).toBeNull();
    });

    test("has nothing to show when Agenta is unreachable", async () => {
        globalThis.fetch = (async () => {
            throw new Error("network");
        }) as unknown as typeof fetch;
        expect(await previewLinkToken("token")).toBeNull();
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
});

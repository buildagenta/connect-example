// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { appName, identityLabel } from "../src/connect-page.js";

describe("identityLabel", () => {
    test("names a Slack account as Slack shows it", () => {
        expect(
            identityLabel({
                agentName: "Bookings",
                surface: "slack",
                workspaceName: "Acme Corp",
                platformUserName: "Alice Smith",
            }),
        ).toBe("Slack (@Alice Smith in Acme Corp)");
    });

    test.each([
        ["teams", "Teams"],
        ["copilot", "Copilot"],
    ] as const)("names a %s account without an @", (surface, app) => {
        expect(
            identityLabel({ agentName: "Bookings", surface, platformUserName: "Alice Smith" }),
        ).toBe(`${app} (Alice Smith)`);
    });

    test("falls back to the app alone when the platform names nobody", () => {
        expect(identityLabel({ agentName: "Bookings", surface: "teams" })).toBe("Teams");
    });
});

describe("appName", () => {
    test("names the app Agenta said the visitor came from", () => {
        expect(appName("copilot")).toBe("Copilot");
    });

    test.each([undefined, "", "irc"])("names all three apps for %p", (surface) => {
        expect(appName(surface)).toBe("Slack, Teams, or Copilot");
    });
});

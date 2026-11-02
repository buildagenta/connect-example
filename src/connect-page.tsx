// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The page the Connect button opens.
 *
 * It reads `?token=`, makes sure the visitor is signed in to your product, asks
 * your server who the token names, and posts the token back to your own
 * `/connect`. Everything it renders is one of five states, because those
 * are the only five things that can happen and each one needs a person to be
 * told something different.
 *
 * Unstyled by design: drop it into your own layout and give it your own
 * components. What matters is the states and the order they happen in.
 */

import { useEffect, useRef, useState } from "react";
import type { LinkDescription } from "./connect.js";

/**
 * Where the visitor is.
 *
 * `ready` is the only state with a button. The other four are terminal, and the
 * three that are not `failed` all end the same way: go back to the chat app.
 */
export type ConnectStatus = "ready" | "connected" | "invalid" | "used" | "failed";

interface StatusContent {
    title: string;
    detail: string;
}

const APP_NAMES: Record<LinkDescription["surface"], string> = {
    slack: "Slack",
    teams: "Teams",
    copilot: "Copilot",
};

/** What to call the chat app before the description has said which one it is. */
const ANY_APP = "Slack, Teams, or Copilot";

/**
 * What to say in each terminal state.
 * @param status Where the visitor ended up.
 * @param platform The chat app they came from.
 * @returns The heading and explanation, or undefined while there is still a button.
 */
export function statusContent(status: ConnectStatus, platform: string): StatusContent | undefined {
    if (status === "connected") {
        return {
            title: "Account connected",
            detail: `Return to ${platform} and send a message to the agent`,
        };
    }
    if (status === "invalid") {
        return {
            title: "This link has expired",
            detail: `Return to ${platform} and ask the agent for a new link`,
        };
    }
    if (status === "used") {
        return {
            title: "This link has already been used",
            detail: `Return to ${platform} and ask the agent for a new link if you still need one`,
        };
    }
    return undefined;
}

/**
 * Names the chat account a link would bind to, as specifically as Agenta can.
 *
 * Show this next to who the visitor is signed in as. Someone who was sent a
 * link they did not ask for is reading the only line on the page that can tell
 * them so.
 * @param description What your server got back from Agenta, if anything.
 * @returns A phrase such as "Slack (@alice in Acme Corp)".
 */
export function identityLabel(description: LinkDescription | undefined): string {
    if (!description) return ANY_APP;
    const inside = [
        description.platformUserName && `@${description.platformUserName}`,
        description.workspaceName && `in ${description.workspaceName}`,
    ]
        .filter(Boolean)
        .join(" ");
    const app = APP_NAMES[description.surface];
    return inside ? `${app} (${inside})` : app;
}

export interface ConnectPageProps {
    /** The `?token=` query parameter, however your router hands it over. */
    token: string;
    /** Whether your own session is loading. */
    loading: boolean;
    /** Whether the visitor is signed in to your product. */
    isAuthenticated: boolean;
    /** Starts your sign-in flow, returning the visitor to this URL afterwards. */
    signIn: (returnTo: string) => Promise<void>;
    /** Who they are in your product, shown beside the account they are linking. */
    accountName?: string;
}

/** Links the signed-in visitor's account to the chat identity that sent them here. */
export function ConnectPage({
    token,
    loading,
    isAuthenticated,
    signIn,
    accountName,
}: ConnectPageProps) {
    const [status, setStatus] = useState<ConnectStatus>("ready");
    const [submitting, setSubmitting] = useState(false);
    const [description, setDescription] = useState<LinkDescription>();
    const signInStarted = useRef(false);

    // A link carries a token, so the page must not be indexed and must not leak
    // it to whatever the visitor clicks next.
    useEffect(() => {
        const robots = document.createElement("meta");
        robots.name = "robots";
        robots.content = "noindex,nofollow";
        const referrer = document.createElement("meta");
        referrer.name = "referrer";
        referrer.content = "no-referrer";
        document.head.append(robots, referrer);
        return () => {
            robots.remove();
            referrer.remove();
        };
    }, []);

    // Sign-in happens on arrival rather than behind the button: the visitor came
    // here to connect, and being asked to click twice explains nothing.
    useEffect(() => {
        if (status !== "ready" || !token || loading || isAuthenticated) return;
        if (signInStarted.current) return;
        signInStarted.current = true;
        signIn(`/connect?${new URLSearchParams({ token }).toString()}`).catch(() =>
            setStatus("failed"),
        );
    }, [isAuthenticated, loading, signIn, status, token]);

    // Asked for before the button is offered, so nobody clicks Connect without
    // having been told what they are connecting.
    useEffect(() => {
        if (!token || !isAuthenticated) return;
        let live = true;
        void (async () => {
            try {
                const response = await fetch("/connect/preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                });
                if (!live) return;
                if (response.ok) setDescription((await response.json()) as LinkDescription);
                else if (response.status === 400) setStatus("invalid");
            } catch {
                // Leaves the button offered against the generic noun. A dead
                // token is caught again on redeem, where it costs nothing.
            }
        })();
        return () => {
            live = false;
        };
    }, [isAuthenticated, token]);

    const connect = async (): Promise<void> => {
        if (submitting) return;
        setSubmitting(true);
        try {
            // A JSON body, not a form post. A cross-site form can only send
            // urlencoded, multipart, or plain text, so a server that requires
            // JSON cannot be driven by one — which is what stops another site
            // redeeming a link as whoever is signed in here.
            const response = await fetch("/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });
            if (response.ok) setStatus("connected");
            else if (response.status === 400) setStatus("invalid");
            else if (response.status === 409) setStatus("used");
            else setStatus("failed");
        } catch {
            setStatus("failed");
        } finally {
            setSubmitting(false);
        }
    };

    const target = identityLabel(description);
    const content = statusContent(status, description ? APP_NAMES[description.surface] : ANY_APP);
    if (content) {
        return (
            <main>
                <h1>{content.title}</h1>
                <p>{content.detail}</p>
            </main>
        );
    }

    // No token at all is the same thing to a person as an expired one: the link
    // they clicked does not work any more.
    if (!token) {
        return (
            <main>
                <h1>This link has expired</h1>
                <p>Return to {ANY_APP} and ask the agent for a new link</p>
            </main>
        );
    }

    if (loading || !isAuthenticated) {
        return (
            <main>
                <h1>Connect your account</h1>
                {status === "failed" ? (
                    <p>We could not sign you in. Please try again.</p>
                ) : (
                    <p>Signing you in…</p>
                )}
            </main>
        );
    }

    return (
        <main>
            <h1>Connect your account</h1>
            <p>
                Connect your account{accountName ? ` (${accountName})` : ""} to {target}
            </p>
            {status === "failed" && <p>We could not connect the account. Please try again.</p>}
            <button type="button" onClick={() => void connect()} disabled={submitting}>
                {submitting ? "Connecting…" : "Connect"}
            </button>
        </main>
    );
}

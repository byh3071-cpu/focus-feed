import { describe, expect, it } from "vitest";
import {
  oauthAuthorizeUrlReturnsToOrigin,
  oauthCallbackUrl,
  oauthNextFromRequest,
  oauthSuccessUrl,
  originFromRequest,
  sanitizeOAuthNext,
} from "./oauth-redirect";

describe("sanitizeOAuthNext", () => {
  it("allows in-app paths and query strings", () => {
    expect(sanitizeOAuthNext("/knowledge")).toBe("/knowledge");
    expect(sanitizeOAuthNext("/knowledge?job=abc")).toBe("/knowledge?job=abc");
  });

  it("rejects off-site and protocol-relative targets", () => {
    expect(sanitizeOAuthNext("https://youtube-summary-lac.vercel.app/knowledge")).toBe("/");
    expect(sanitizeOAuthNext("//youtube-summary-lac.vercel.app/knowledge")).toBe("/");
    expect(sanitizeOAuthNext("knowledge")).toBe("/");
  });
});

describe("oauthCallbackUrl", () => {
  it("never includes a next query", () => {
    expect(oauthCallbackUrl("http://localhost:3000")).toBe("http://localhost:3000/auth/callback");
    expect(oauthCallbackUrl("http://localhost:3000/")).toBe("http://localhost:3000/auth/callback");
  });

  it("rewrites the 0.0.0.0 bind address to localhost", () => {
    expect(oauthCallbackUrl("http://0.0.0.0:3000")).toBe("http://localhost:3000/auth/callback");
  });
});

describe("oauthNextFromRequest", () => {
  it("prefers the cookie so callback URLs can stay query-free", () => {
    expect(oauthNextFromRequest("/ignored", "%2Fknowledge")).toBe("/knowledge");
    expect(oauthNextFromRequest("/knowledge", undefined)).toBe("/knowledge");
  });
});

describe("oauthSuccessUrl", () => {
  it("stays on the callback origin", () => {
    expect(oauthSuccessUrl("http://localhost:3000", "/knowledge")).toBe(
      "http://localhost:3000/knowledge?auth_success=1",
    );
  });

  it("does not send the browser to 0.0.0.0 after login", () => {
    expect(oauthSuccessUrl("http://0.0.0.0:3000", "/knowledge")).toBe(
      "http://localhost:3000/knowledge?auth_success=1",
    );
  });
});

describe("originFromRequest", () => {
  it("rewrites a 0.0.0.0 Host to localhost", () => {
    const req = new Request("http://0.0.0.0:3000/auth/callback?code=abc", {
      headers: { host: "0.0.0.0:3000" },
    });
    expect(originFromRequest(req)).toBe("http://localhost:3000");
  });
});

describe("oauthAuthorizeUrlReturnsToOrigin", () => {
  it("accepts only the exact local callback", () => {
    const origin = "http://localhost:3000";
    const ok = `https://example.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${origin}/auth/callback`)}`;
    const vercel = `https://example.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent("https://youtube-summary-lac.vercel.app/auth/callback")}`;
    const withNext = `https://example.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${origin}/auth/callback?next=/knowledge`)}`;
    expect(oauthAuthorizeUrlReturnsToOrigin(ok, origin)).toBe(true);
    expect(oauthAuthorizeUrlReturnsToOrigin(vercel, origin)).toBe(false);
    expect(oauthAuthorizeUrlReturnsToOrigin(withNext, origin)).toBe(false);
  });

  it("treats 0.0.0.0 login as localhost callback", () => {
    const authorize = `https://example.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent("http://localhost:3000/auth/callback")}`;
    expect(oauthAuthorizeUrlReturnsToOrigin(authorize, "http://0.0.0.0:3000")).toBe(true);
  });
});

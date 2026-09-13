/**
 * Google OAuth 복귀 주소.
 * redirectTo 에 ?next= 를 붙이면 Supabase Allow list의
 * `/auth/callback` 과 다른 URL로 보여 Site URL(Vercel)로 떨어진다.
 * `next dev -H 0.0.0.0` 이면 request.origin 이 bind 주소가 되어
 * 브라우저가 http://0.0.0.0:3000 으로 떨어지므로 localhost 로 고친다.
 */

export const OAUTH_NEXT_COOKIE = "ff_oauth_next";
export const AUTH_CALLBACK_PATH = "/auth/callback";
const MAX_NEXT_CHARS = 512;

export function sanitizeOAuthNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  const value = raw.trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("://")) return "/";
  if (value.length > MAX_NEXT_CHARS) return "/";
  return value;
}

/** 0.0.0.0 / :: 는 listen 주소라 쿠키·OAuth 복귀에 쓰지 않는다. */
export function normalizeOAuthOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]" || url.hostname === "::") {
    url.hostname = "localhost";
  }
  return url.origin;
}

export function originFromRequest(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(":", "");
  return normalizeOAuthOrigin(`${proto}://${host}`);
}

export function oauthCallbackUrl(origin: string): string {
  return `${normalizeOAuthOrigin(origin)}${AUTH_CALLBACK_PATH}`;
}

export function decodeOAuthCookieValue(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function oauthNextFromRequest(
  queryNext: string | null | undefined,
  cookieValue: string | undefined,
): string {
  const fromCookie = sanitizeOAuthNext(decodeOAuthCookieValue(cookieValue));
  if (cookieValue) return fromCookie;
  return sanitizeOAuthNext(queryNext);
}

export function oauthSuccessUrl(origin: string, nextPath: string): string {
  const base = new URL(normalizeOAuthOrigin(origin));
  const url = new URL(sanitizeOAuthNext(nextPath), base);
  if (url.origin !== base.origin) {
    return `${base.origin}/?auth_success=1`;
  }
  url.searchParams.set("auth_success", "1");
  return url.toString();
}

export function oauthAuthorizeUrlReturnsToOrigin(authorizeUrl: string, origin: string): boolean {
  try {
    const redirectTo = new URL(authorizeUrl).searchParams.get("redirect_to") ?? "";
    return redirectTo === oauthCallbackUrl(origin);
  } catch {
    return false;
  }
}

export function rememberOAuthNext(next: string): void {
  if (typeof document === "undefined") return;
  const safe = sanitizeOAuthNext(next);
  document.cookie = `${OAUTH_NEXT_COOKIE}=${encodeURIComponent(safe)}; Path=/; Max-Age=600; SameSite=Lax`;
}

export function rewriteBindAddressLocation(): boolean {
  if (typeof window === "undefined") return false;
  const normalized = normalizeOAuthOrigin(window.location.origin);
  if (normalized === window.location.origin) return false;
  const url = new URL(window.location.href);
  url.hostname = new URL(normalized).hostname;
  window.location.replace(url.toString());
  return true;
}

export function clearOAuthNextCookieOptions(): {
  path: string;
  maxAge: number;
} {
  return { path: "/", maxAge: 0 };
}

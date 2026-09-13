import { createServerSupabaseFromCookies, type CookieStore } from "./supabase-server-cookies";

export type KnowledgeAuthState =
  | { status: "authenticated"; user: { id: string } }
  | { status: "login_required" | "unavailable" };

const SESSION_ERRORS = new Set(["bad_jwt", "session_not_found", "session_expired", "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "no_authorization"]);

export function classifyKnowledgeAuth(user: { id: string } | null, error: unknown): KnowledgeAuthState {
  if (error) {
    const failure = error as { name?: string; code?: string; status?: number };
    if (failure.status === 429 || (failure.status && failure.status >= 500)) return { status: "unavailable" };
    if (failure.name === "AuthSessionMissingError" || (failure.code && SESSION_ERRORS.has(failure.code))) return { status: "login_required" };
    return { status: "unavailable" };
  }
  return user ? { status: "authenticated", user: { id: user.id } } : { status: "login_required" };
}

export async function getKnowledgeAuth(cookieStore: CookieStore): Promise<KnowledgeAuthState> {
  try {
    const client = createServerSupabaseFromCookies(cookieStore);
    if (!client) return { status: "unavailable" };
    const { data, error } = await client.auth.getUser();
    return classifyKnowledgeAuth(data.user, error);
  } catch {
    return { status: "unavailable" };
  }
}

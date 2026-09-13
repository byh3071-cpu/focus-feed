/** Process liveness only: no database, login or model availability claim. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ service: "focus-feed", version: 1 }, { headers: { "Cache-Control": "no-store" } });
}

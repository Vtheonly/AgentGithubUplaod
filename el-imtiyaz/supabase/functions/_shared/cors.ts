// ============================================================================
// _shared/cors.ts — CORS headers + OPTIONS handler for all Edge Functions
// ============================================================================
// Plan §13.04: All Edge Functions must respect ALLOWED_ORIGINS env var
// and reject requests from disallowed origins.

export const corsHeaders = (origin: string | null): Record<string, string> => {
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",");
  const allowOrigin =
    origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-request-id",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
};

export function handleOptions(req: Request): Response {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req.headers.get("origin")) });
  }
  return new Response("Method Not Allowed", {
    status: 405,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export function jsonError(
  req: Request,
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  return new Response(
    JSON.stringify({ error: { code, message, details } }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(req.headers.get("origin")),
      },
    }
  );
}

export function jsonOk<T>(req: Request, data: T, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
    },
  });
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: "This legacy device-admin endpoint has been decommissioned. Use support-device-admin." }),
  { status: 410, headers: { "content-type": "application/json" } }
));

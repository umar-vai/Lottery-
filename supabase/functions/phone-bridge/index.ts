import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: "This legacy phone bridge has been decommissioned. Use support-phone-bridge." }),
  { status: 410, headers: { "content-type": "application/json" } }
));

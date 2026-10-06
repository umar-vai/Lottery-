import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: "This demo-credit endpoint has been permanently decommissioned." }),
  { status: 410, headers: { "content-type": "application/json" } }
));

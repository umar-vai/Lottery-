import { withSupabase } from "npm:@supabase/server@1.9.0";

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSeed() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function deterministicInt(seed: string, max: number, counter: { value: number }) {
  const limit = Math.floor(0x100000000 / max) * max;
  while (true) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`${seed}:${counter.value++}`),
    );
    const value = new DataView(digest).getUint32(0, false);
    if (value < limit) return value % max;
  }
}

async function uniqueNumbers(seed: string, count: number, max: number, counter: { value: number }) {
  const numbers = new Set<number>();
  while (numbers.size < count) {
    numbers.add((await deterministicInt(seed, max, counter)) + 1);
  }
  return [...numbers].sort((a, b) => a - b);
}

async function powerPlay(seed: string, jackpot: number, counter: { value: number }) {
  const tenX = jackpot <= 150_000_000;
  const weighted = tenX
    ? [10, 5, 5, 4, 4, 4, ...Array(13).fill(3), ...Array(24).fill(2)]
    : [5, 5, 4, 4, 4, ...Array(13).fill(3), ...Array(24).fill(2)];
  return weighted[await deterministicInt(seed, weighted.length, counter)];
}

function evaluatePrize(
  whiteMatches: number,
  pbMatch: boolean,
  jackpot: number,
  selectedPowerPlay: boolean,
  multiplier: number,
) {
  let tier = "NO_PRIZE";
  let base = 0;

  if (whiteMatches === 5 && pbMatch) { tier = "JACKPOT"; base = jackpot; }
  else if (whiteMatches === 5) { tier = "MATCH_5"; base = 1_000_000; }
  else if (whiteMatches === 4 && pbMatch) { tier = "MATCH_4_PB"; base = 50_000; }
  else if (whiteMatches === 4) { tier = "MATCH_4"; base = 100; }
  else if (whiteMatches === 3 && pbMatch) { tier = "MATCH_3_PB"; base = 100; }
  else if (whiteMatches === 3) { tier = "MATCH_3"; base = 7; }
  else if (whiteMatches === 2 && pbMatch) { tier = "MATCH_2_PB"; base = 7; }
  else if (whiteMatches === 1 && pbMatch) { tier = "MATCH_1_PB"; base = 4; }
  else if (whiteMatches === 0 && pbMatch) { tier = "PB_ONLY"; base = 4; }

  let finalPrize = base;
  if (selectedPowerPlay && base > 0 && tier !== "JACKPOT") {
    finalPrize = tier === "MATCH_5" ? 2_000_000 : base * multiplier;
  }

  return { tier, base, finalPrize };
}

async function ensureSeed(admin: any, draw: any) {
  if (draw.seed_commitment) {
    const { data, error } = await admin
      .from("draw_secrets")
      .select("seed")
      .eq("draw_id", draw.id)
      .single();
    if (error) throw error;
    return data.seed as string;
  }

  const seed = randomSeed();
  const commitment = await sha256Hex(seed);

  const { error: secretError } = await admin
    .from("draw_secrets")
    .insert({ draw_id: draw.id, seed });
  if (secretError) throw secretError;

  const { error: drawError } = await admin
    .from("draws")
    .update({ seed_commitment: commitment, status: "locked" })
    .eq("id", draw.id)
    .eq("status", "open");
  if (drawError) throw drawError;

  await admin.from("draw_events").insert({
    draw_id: draw.id,
    event_type: "DRAW_LOCKED",
    payload: { seed_commitment: commitment },
  });

  return seed;
}

async function processDraw(admin: any, draw: any, settings: any) {
  const seed = await ensureSeed(admin, draw);
  const counter = { value: 0 };
  const whites = await uniqueNumbers(seed, 5, 69, counter);
  const pb = (await deterministicInt(seed, 26, counter)) + 1;
  const multiplier = await powerPlay(seed, Number(draw.jackpot_amount), counter);

  const { error: drawingError } = await admin
    .from("draws")
    .update({ status: "drawing" })
    .eq("id", draw.id)
    .in("status", ["open", "locked"]);
  if (drawingError) throw drawingError;

  const { data: tickets, error: ticketsError } = await admin
    .from("tickets")
    .select("id,user_id,white_numbers,powerball,power_play")
    .eq("draw_id", draw.id);
  if (ticketsError) throw ticketsError;

  const results = (tickets ?? []).map((ticket: any) => {
    const whiteMatches = ticket.white_numbers.filter((n: number) => whites.includes(n)).length;
    const pbMatch = ticket.powerball === pb;
    const prize = evaluatePrize(
      whiteMatches,
      pbMatch,
      Number(draw.jackpot_amount),
      Boolean(ticket.power_play),
      multiplier,
    );
    return {
      ticket_id: ticket.id,
      draw_id: draw.id,
      user_id: ticket.user_id,
      white_matches: whiteMatches,
      powerball_match: pbMatch,
      prize_tier: prize.tier,
      simulated_prize: prize.base,
      power_play_multiplier: ticket.power_play ? multiplier : null,
      simulated_final_prize: prize.finalPrize,
    };
  });

  if (results.length) {
    const { error } = await admin.from("ticket_results").upsert(results, { onConflict: "ticket_id" });
    if (error) throw error;
  }

  const jackpotWinners = results.filter((r: any) => r.prize_tier === "JACKPOT").length;

  const { error: completeError } = await admin
    .from("draws")
    .update({
      status: "completed",
      white_numbers: whites,
      powerball: pb,
      power_play_multiplier: multiplier,
      seed_reveal: seed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", draw.id);
  if (completeError) throw completeError;

  await admin.from("draw_events").insert({
    draw_id: draw.id,
    event_type: "DRAW_COMPLETED",
    payload: {
      white_numbers: whites,
      powerball: pb,
      power_play_multiplier: multiplier,
      ticket_count: tickets?.length ?? 0,
      jackpot_winners: jackpotWinners,
    },
  });

  const nextJackpot = jackpotWinners > 0
    ? Number(settings.starting_jackpot)
    : Number(draw.jackpot_amount) + Number(settings.rollover_increment);

  const now = new Date();
  const drawAt = new Date(now.getTime() + Number(settings.draw_interval_minutes) * 60_000);
  const cutoffAt = new Date(drawAt.getTime() - Number(settings.ticket_cutoff_seconds) * 1000);

  const { data: active } = await admin
    .from("draws")
    .select("id")
    .in("status", ["open", "locked", "drawing"])
    .limit(1);

  if (!active?.length) {
    const { data: next, error: nextError } = await admin.from("draws").insert({
      status: "open",
      opens_at: now.toISOString(),
      cutoff_at: cutoffAt.toISOString(),
      draw_at: drawAt.toISOString(),
      jackpot_amount: nextJackpot,
    }).select("id").single();
    if (nextError) throw nextError;

    await admin.from("draw_events").insert({
      draw_id: next.id,
      event_type: "DRAW_OPENED",
      payload: { jackpot_amount: nextJackpot },
    });
  }

  return { draw_id: draw.id, whites, pb, multiplier, jackpot_winners: jackpotWinners };
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (_req, ctx) => {
    const admin = ctx.supabaseAdmin;
    const nowIso = new Date().toISOString();

    const { data: settings, error: settingsError } = await admin
      .from("game_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (settingsError) throw settingsError;

    const { data: lockable, error: lockError } = await admin
      .from("draws")
      .select("*")
      .eq("status", "open")
      .lte("cutoff_at", nowIso)
      .gt("draw_at", nowIso)
      .limit(3);
    if (lockError) throw lockError;

    for (const draw of lockable ?? []) await ensureSeed(admin, draw);

    const { data: due, error: dueError } = await admin
      .from("draws")
      .select("*")
      .in("status", ["open", "locked"])
      .lte("draw_at", nowIso)
      .order("draw_at", { ascending: true })
      .limit(3);
    if (dueError) throw dueError;

    const completed = [];
    for (const draw of due ?? []) completed.push(await processDraw(admin, draw, settings));

    return Response.json({ ok: true, locked: lockable?.length ?? 0, completed });
  }),
};

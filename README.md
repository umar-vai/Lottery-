# DRAW//01 — Public Powerball-style Test System

A public multiplayer draw application for GitHub Pages. It reproduces the core Powerball-style game mechanics for simulation/testing only: 5 unique white numbers from 1–69, one Powerball from 1–26, scheduled ticket cutoff, shared server-side draw results, Power Play, prize tiers, jackpot rollover, Google sign-in and user ticket history.

## Live architecture

- **Frontend:** GitHub Pages
- **Backend project:** Supabase `Lottery DRAW01`
- **Auth:** Supabase Auth + Google OAuth
- **Database:** Supabase Postgres
- **Security:** Row Level Security (RLS)
- **Realtime:** Supabase Realtime on the `draws` table
- **Automatic draw:** Postgres `pg_cron` runs `private.run_draw_engine()` every minute
- **Draw fairness:** cryptographic seed, SHA-256 commitment before draw, seed reveal after draw

## Current repo structure

- `index.html` — public multiplayer UI
- `styles.css` + `multiplayer.css` — responsive tech UI
- `app.js` — Google auth, ticket submission, realtime draw/history UI
- `config.js` — live Supabase project URL + public publishable key
- `supabase/schema.sql` — core schema, RLS, validation triggers, realtime setup
- `supabase/secure_draw.sql` — protected draw seed storage and single-active-draw guard
- `supabase/automatic_draw_scheduler.sql` — live database draw engine + cron scheduler
- `supabase/functions/draw-engine/index.ts` — earlier Edge Function implementation kept as an alternative/reference; the live scheduler currently runs in Postgres
- `GOOGLE_AUTH_SETUP.md` — exact remaining Google OAuth setup steps

## Core game logic

- 5 unique white balls: 1–69
- 1 Powerball: 1–26
- Ticket writes are rejected by the database after cutoff
- Multiple tickets per authenticated user are supported
- Public visitors can view draws without login
- Google login is required only to submit/save tickets
- 9 Powerball-style prize combinations are calculated automatically
- Power Play uses 2X/3X/4X/5X/10X weighted multiplier logic; 10X is only available when the simulated jackpot is $150M or less
- Match 5 + Power Play is fixed at a simulated $2M
- Jackpot resets to the configured starting jackpot after a simulated jackpot winner; otherwise it rolls over by the configured test increment

## Test schedule

The live test system currently uses a draw every **10 minutes** with a **60-second ticket cutoff** before draw time. The cron engine checks once per minute. These values live in `game_settings`, so they can later be changed without editing frontend code.

## Verified server-side test

The first forced backend verification completed successfully:

- Draw #1: `32 38 46 49 63 + 21`
- Power Play: `5X`
- Seed commitment stored before completion and seed revealed after completion
- Draw #2 opened automatically
- Simulated jackpot rolled from `$20M` to `$30M` because there was no jackpot winner

## Remaining Google OAuth setup

The backend and frontend are already connected. Google OAuth requires a Client ID and Client Secret from the project owner's Google Cloud account. Follow `GOOGLE_AUTH_SETUP.md`.

Never commit a Google Client Secret or Supabase service-role/secret key to this repository.

## Public site

https://umar-vai.github.io/Lottery-/

## Disclaimer

This repository is a simulation/testing project. It does not sell tickets, accept payments, provide cash prizes, or operate a real-money lottery. It is not affiliated with Powerball®, MUSL, or any lottery operator.

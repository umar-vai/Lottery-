# DRAW//01 — Public Powerball-style Test System

A minimal public multiplayer draw application for GitHub Pages. It reproduces the core Powerball-style game mechanics for simulation/testing only: 5 unique white numbers from 1–69, one Powerball from 1–26, scheduled ticket cutoff, shared server-side draw results, Power Play, prize tiers, jackpot rollover, Google sign-in and user ticket history.

## Architecture

- **Frontend:** GitHub Pages
- **Auth:** Supabase Auth + Google OAuth
- **Database:** Supabase Postgres
- **Security:** Row Level Security (RLS)
- **Realtime:** Supabase Realtime on the `draws` table
- **Automatic draw:** Supabase Edge Function `draw-engine`
- **Draw fairness:** cryptographic seed, SHA-256 commitment before draw, seed reveal after draw

## Current repo structure

- `index.html` — public multiplayer UI
- `styles.css` + `multiplayer.css` — responsive tech UI
- `app.js` — Google auth, ticket submission, realtime draw/history UI
- `config.js` — public Supabase URL + publishable key (currently blank until backend project is created)
- `supabase/schema.sql` — core schema, RLS, validation triggers, realtime setup
- `supabase/secure_draw.sql` — protected draw seed storage and single-active-draw guard
- `supabase/functions/draw-engine/index.ts` — automatic draw engine
- `supabase/config.toml` — function auth configuration

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

V1 defaults to a draw every **10 minutes** with a **30-second cutoff** before draw time. These values live in `game_settings`, so they can be changed without editing frontend code.

## Backend activation checklist

1. Create a dedicated Supabase project.
2. Apply `supabase/schema.sql`.
3. Apply `supabase/secure_draw.sql`.
4. Deploy the `draw-engine` Edge Function.
5. Create a Supabase Cron job that invokes the draw engine regularly.
6. Enable Google Auth in Supabase and add the GitHub Pages URL as an allowed redirect URL.
7. Put only the **project URL** and **publishable key** in `config.js`. Never put a secret/service-role key in GitHub Pages.

## Public site

https://umar-vai.github.io/Lottery-/

## Disclaimer

This repository is a simulation/testing project. It does not sell tickets, accept payments, provide cash prizes, or operate a real-money lottery. It is not affiliated with Powerball®, MUSL, or any lottery operator.

# Phase 0 — Stability Foundation

Phase 0 is the safety layer that must stay in place before larger UI, draw-animation, admin, and product changes are shipped.

## Production source of truth

- Public homepage: `index.html`
- Lottery archive: `lotteries.html`
- Lottery detail/draw: `lottery.html`
- Winners Hall: `winners.html`
- Player profile/referrals: `profile.html`
- Love Points: `love-points.html`
- Current admin: `ops-v4.html`
- Shared shell/header/footer/auth: `site-shell.js`
- Live logo animation: `live-logo.js`
- Draw presentation: `draw-machine.js` + `draw-machine.css`

Compatibility URLs such as `event.html`, `events.html`, `admin.html`, `ops-v2.html`, `control-panel.html`, `game-zone.html`, `slot.html`, and `plinko.html` intentionally redirect to the current production pages.

## New deployment gate

Every push to `main` now runs:

```bash
node scripts/phase0-smoke.mjs
```

before GitHub Pages is uploaded.

The deployment is blocked if the check detects:

- a missing critical production file;
- a broken local CSS/JS/page reference in an HTML file;
- a compatibility redirect whose destination disappeared;
- removal of the animated Lootera logo from either header or footer;
- removal of critical lottery draw assets;
- ticket purchase bypassing the protected `purchase_event_ticket` RPC;
- browser code directly mutating `profiles.balance`, `profiles.role`, or inserting `event_tickets`;
- obvious committed private-key / secret-key material;
- removal of the public winners RPC integration.

This is deliberately zero-dependency so the protection itself is simple and reliable.

## Phase 0 rule

Phase 0 should not redesign the site. It exists to make later phases safer.

Large changes should be made on a branch, pass the smoke gate, merge to `main`, and only be considered live after the Pages workflow succeeds.

## Rollback

If a future deployment causes a regression:

1. identify the last known-good commit on `main`;
2. revert the bad merge/commit;
3. let the same smoke gate run;
4. verify the Pages deployment completes successfully.

Do not patch production by weakening or deleting the smoke checks just to make a deployment pass. Fix the underlying regression.

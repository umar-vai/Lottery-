# Phase 3 — Live Draw Control Room

Phase 3 starts by turning the existing admin workspace into an operational control room rather than adding another disconnected dashboard.

## Server-authoritative payload

`admin_get_live_draw_control_room()` is an admin-only RPC. It returns:

- event lifecycle state derived on the database clock,
- ticket and distinct-player counts,
- ticket credit volume,
- configured capacity and fill percentages,
- draw readiness,
- selected-winner progress,
- per-event draw failure/recovery state,
- platform draw/cron operational health,
- Draw Credit reconciliation state.

The RPC is `SECURITY DEFINER`, has an explicit safe search path, calls `is_admin()`, revokes anonymous execution and grants only `authenticated` execution.

The browser does not gain broader direct access to private runtime tables.

## Admin UX

The new Control Room tab provides:

- live summary counters,
- global integrity / cron health,
- active and recent event cards,
- countdown to open/cutoff/draw,
- ticket/player capacity bars,
- winner progress,
- failure detail when an event is unhealthy,
- guarded “Draw now” for eligible events,
- guarded “Retry due draws” for overdue scheduled events,
- links to public event pages,
- quick navigation back to Lottery management.

The view refreshes automatically while visible and refreshes immediately after operational actions.

## Phase 3 direction

After this slice, Phase 3 should continue with:

1. event lifecycle command UX (publish/lock/draw/relaunch in a safer guided flow),
2. winner verification / post-draw review,
3. richer player and ticket investigation,
4. mobile admin polish,
5. operational notifications and recovery affordances.

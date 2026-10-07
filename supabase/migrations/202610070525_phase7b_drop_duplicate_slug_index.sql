-- Phase 7B — remove one proven duplicate public index.
-- lottery_events_slug_key is the UNIQUE constraint index on the same btree key and
-- can satisfy the exact slug lookup path. The duplicate non-unique index adds write/storage cost.

drop index if exists public.lottery_events_slug_idx;

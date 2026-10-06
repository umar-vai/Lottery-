-- Phase 2 follow-up: avoid carrying an unused secondary audit index.
-- Canonical admin audit reads are primarily time-ordered and row-oriented.
drop index if exists private.admin_change_audit_actor_created_idx;

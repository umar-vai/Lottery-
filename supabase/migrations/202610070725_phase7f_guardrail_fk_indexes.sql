-- Phase 7F — cover foreign keys introduced by abuse-hardening tables.

create index if not exists production_mutation_guardrails_updated_by_idx
  on private.production_mutation_guardrails(updated_by);

create index if not exists ticket_purchase_idempotency_event_id_idx
  on private.ticket_purchase_idempotency(event_id);

-- Phase 7G cleanup: remove synthetic rate-limit buckets while preserving probe evidence.

delete from private.mutation_rate_limit_windows
where bucket like 'phase7g-%';

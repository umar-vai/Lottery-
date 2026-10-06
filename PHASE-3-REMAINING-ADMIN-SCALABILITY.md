# Phase 3 — Remaining Admin Scalability

This block removes the remaining fixed/bulk admin read paths.

## Lotteries
- server-side keyset pagination
- full editable event payload per row
- prize tiers embedded per event
- authoritative ticket/player counts embedded per event
- exact single-event detail RPC for edit actions
- base Overview receives only one focus event plus eight recent audit items

This removes the old 500-event and 5,000-prize-tier base preloads.

## Audit and canonical admin changes
- Audit Trail pages by created_at + id
- Canonical Admin Change history pages by created_at + id
- server-side search/filtering
- no 500-row / 150-row browser cutoffs

## Support administration
Support reads move to admin-only database RPCs:
- exact summary totals
- paginated Love Point/player balances
- paginated verified transfers
- paginated linked devices

Sensitive support fields such as token_hash, sender_hash and sms_fingerprint are never returned.

Support mutations remain on the protected support-device-admin Edge Function:
- create/revoke/enable device
- adjust Support/Love Points

## Security
All new browser-callable RPCs require public.is_admin(), revoke PUBLIC/anon execution and grant execute only to authenticated.

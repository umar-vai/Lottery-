# Production Edge Function snapshot

This directory mirrors the Edge Functions deployed to Supabase project `Lottery DRAW01` during the Phase 1 security audit.

| Function | Status | Version | JWT verification | Production bundle SHA-256 | Role |
|---|---|---:|---|---|---|
| `support-phone-bridge` | ACTIVE | 3 | disabled | `2b8a92a624d84ff080e0e3ac7c0272a61dda40fcfdf720abbb19535bb6e090ac` | Current custom-token phone ingest |
| `support-device-admin` | ACTIVE | 3 | enabled | `dd8968f136b5b80a84f70110b8df8d09bb9bbff051eac4df1d6ed1f360ddb979` | Current admin device management |
| `claim-support-points` | ACTIVE | 3 | enabled | `49d3b97b59841aabaa2a6f11863aa770f1930f85f9a2c1ea803a33312de639a8` | Current authenticated support claim |
| `binance-pay-create-order` | ACTIVE | 1 | enabled | `48cbde4a7cc6ffd2ec63d94e0ae023e33acf5fb17ad3b73e6c87a181df4f586c` | Current Binance Pay order creation |
| `binance-pay-webhook` | ACTIVE | 1 | disabled | `750bab5ade2f2947937fc2722173d055b1629fcb9ab9496f2305ab7fd0fd9a15` | External Binance webhook |
| `phone-bridge` | ACTIVE | 2 | disabled | `69aa53871751026f9cdbdd7f088d36238ffb920ae958b84daabff87708e944a7` | Legacy/deprecated bridge |
| `bridge-device-admin` | ACTIVE | 2 | enabled | `7f0d4a076c4299c97e4f027e2cb30676b3614b11fe5d9a21c0729742d762f685` | Legacy/deprecated bridge admin |
| `claim-demo-credit` | ACTIVE | 3 | enabled | `8d4297f1f4003e60b0dd1d04cc619e45f05d40bf85a530f11134647ee4e5cd1d` | Decommissioned 410 stub |

## Authentication notes

- `support-phone-bridge` intentionally disables Supabase JWT verification because it authenticates devices with its own `x-bridge-token`.
- `binance-pay-webhook` intentionally disables Supabase JWT verification because an external provider webhook cannot carry a Supabase user JWT; provider authenticity must be validated inside the function.
- Current user/admin functions use Supabase JWT verification.
- Legacy `phone-bridge` is retained only for compatibility/deprecation tracking.
- `claim-demo-credit` is decommissioned and can be deleted from Supabase after confirming no callers remain.

## Source-control rule

Production changes to these functions must be mirrored here. Never commit service-role keys, bridge tokens, webhook secrets, OAuth client secrets, private keys, or other runtime credentials. Runtime credentials must come from Supabase Edge Function secrets/environment variables.

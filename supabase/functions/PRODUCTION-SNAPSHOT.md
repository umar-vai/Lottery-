# Production Edge Function snapshot

This directory mirrors the Edge Functions deployed to Supabase project `Lottery DRAW01` during the Phase 1 security audit.

| Function | Status | Version | JWT verification | Production bundle SHA-256 | Role |
|---|---|---:|---|---|---|
| `support-phone-bridge` | ACTIVE | 3 | disabled | `2b8a92a624d84ff080e0e3ac7c0272a61dda40fcfdf720abbb19535bb6e090ac` | Current custom-token phone ingest |
| `support-device-admin` | ACTIVE | 3 | enabled | `dd8968f136b5b80a84f70110b8df8d09bb9bbff051eac4df1d6ed1f360ddb979` | Current admin device management |
| `claim-support-points` | ACTIVE | 3 | enabled | `49d3b97b59841aabaa2a6f11863aa770f1930f85f9a2c1ea803a33312de639a8` | Current authenticated support claim |
| `binance-pay-create-order` | ACTIVE | 1 | enabled | `48cbde4a7cc6ffd2ec63d94e0ae023e33acf5fb17ad3b73e6c87a181df4f586c` | Current Binance Pay order creation |
| `binance-pay-webhook` | ACTIVE | 1 | disabled | `750bab5ade2f2947937fc2722173d055b1629fcb9ab9496f2305ab7fd0fd9a15` | External Binance webhook |
| `phone-bridge` | ACTIVE | 3 | disabled | `6c6908f36efdcbc56387a3783b0785e617fb95f184528eb4a62be9d53efe1b6c` | Decommissioned 410 stub |
| `bridge-device-admin` | ACTIVE | 3 | enabled | `04fc5c92a1adcb5096fb1e5c08623ea7825978d785db9683d5b97fd1d25ae51b` | Decommissioned 410 stub |
| `claim-demo-credit` | ACTIVE | 4 | enabled | `ddfc36b370e92e8c9add77ec105cb620ce6a482362cc646a93c12210e821737e` | Decommissioned 410 stub |

## Authentication notes

- `support-phone-bridge` intentionally disables Supabase JWT verification because it authenticates devices with its own `x-bridge-token`.
- `binance-pay-webhook` intentionally disables Supabase JWT verification because an external provider webhook cannot carry a Supabase user JWT; provider authenticity must be validated inside the function.
- Current user/admin functions use Supabase JWT verification.
- `phone-bridge`, `bridge-device-admin`, and `claim-demo-credit` are decommissioned 410 stubs.
- Two caller/log observation passes found no active callers and zero recent traffic for all three. They are ready for physical deletion once a deletion-capable Supabase surface is available.

## Source-control rule

Production changes to these functions must be mirrored here. Never commit service-role keys, bridge tokens, webhook secrets, OAuth client secrets, private keys, or other runtime credentials. Runtime credentials must come from Supabase Edge Function secrets/environment variables.

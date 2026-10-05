-- Harden private referral helpers so browser-authenticated roles cannot call them directly.
revoke all on function private.make_referral_code(text) from public,anon,authenticated;
revoke all on function private.apply_referral_support_reward(uuid,numeric,uuid) from public,anon,authenticated;

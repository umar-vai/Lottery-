drop policy if exists "credit requests insert own" on public.credit_requests;
create policy "credit requests insert own" on public.credit_requests
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and private.platform_feature_enabled('master')
);

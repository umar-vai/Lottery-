-- Fix Game Zone catalog RLS for anonymous visitors.
--
-- The original shared SELECT policy evaluated public.is_admin() for anon
-- requests as part of an OR expression. anon intentionally has no EXECUTE
-- permission on is_admin(), which caused public game config requests to fail
-- with: permission denied for function is_admin.
--
-- Public visitors may read only active/coming-soon catalog rows. Authenticated
-- users get the same public rows; authenticated admins may additionally read
-- non-public game rows.

drop policy if exists "public can read game catalog" on public.games;
drop policy if exists "anon can read public game catalog" on public.games;
drop policy if exists "authenticated can read game catalog" on public.games;

create policy "anon can read public game catalog"
on public.games
for select
to anon
using (status in ('active','coming_soon'));

create policy "authenticated can read game catalog"
on public.games
for select
to authenticated
using (status in ('active','coming_soon') or public.is_admin());

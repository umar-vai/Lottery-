-- Phase 1 — profile write hardening
-- Make public.profiles read-only to ordinary authenticated clients.
-- User-editable profile fields must go through the validated update_my_profile RPC.

alter table public.profiles enable row level security;

-- Remove every direct UPDATE path exposed to the authenticated Data API role.
revoke update on table public.profiles from authenticated;
revoke update (
  id,
  display_name,
  nickname,
  avatar_url,
  email,
  role,
  balance,
  referral_code,
  created_at,
  updated_at
) on table public.profiles from authenticated;

drop policy if exists "users can update own profile" on public.profiles;

create or replace function public.update_my_profile(
  p_display_name text,
  p_nickname text
)
returns table(
  display_name text,
  nickname text,
  referral_code text
)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_display_name),'') is null
     or char_length(trim(p_display_name)) > 80 then
    raise exception 'Name must be between 1 and 80 characters';
  end if;

  if nullif(trim(p_nickname),'') is not null
     and char_length(trim(p_nickname)) not between 2 and 30 then
    raise exception 'Nickname must be between 2 and 30 characters';
  end if;

  update public.profiles
  set
    display_name = trim(p_display_name),
    nickname = nullif(trim(p_nickname),''),
    updated_at = now()
  where id = uid;

  return query
  select p.display_name, p.nickname, p.referral_code
  from public.profiles p
  where p.id = uid;
end;
$$;

revoke all on function public.update_my_profile(text,text) from public, anon;
grant execute on function public.update_my_profile(text,text) to authenticated;

comment on function public.update_my_profile(text,text) is
  'Phase 1 server-authoritative profile edit RPC. Direct authenticated UPDATE on public.profiles is intentionally revoked.';

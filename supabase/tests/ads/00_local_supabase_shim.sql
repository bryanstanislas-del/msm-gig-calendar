-- LOCAL TEST SCAFFOLDING ONLY -- NEVER RUN AGAINST PRODUCTION.
--
-- A minimal stand-in for the pieces of a real Supabase project that the
-- advertising migration (20261015120000_ads_platform_phase1.sql) depends
-- on, so that migration and its regression tests can be exercised on a
-- throwaway vanilla Postgres 16 (see scripts/ads-local-db-test.sh).
--
-- Reproduces, from read-only introspection of the live project on
-- 2026-10-15 (definitions only, never row data):
--   * roles anon / authenticated / service_role (service_role BYPASSRLS)
--   * Supabase's default privileges in `public` (new tables/functions are
--     granted to anon/authenticated -- the reason the ads migration revokes
--     explicitly instead of relying on "nobody was granted it")
--   * auth.users + auth.uid()/auth.role() reading request.jwt.claims
--   * storage.buckets / storage.objects (RLS enabled) + storage.foldername
--   * public.profiles(user_id, role), public.user_roles(user_id, role),
--     has_role(), is_admin_or_above(), update_updated_at() -- bodies copied
--     verbatim from the live definitions.
-- Anything else in the real schema is deliberately absent.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create extension if not exists pgcrypto;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role'
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, role text, band_name text
);
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, role text
);

create or replace function public.has_role(check_role text) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = check_role);
$$;
create or replace function public.is_admin_or_above() returns boolean
language sql stable security definer set search_path to '' as $$
  select public.has_role('super_admin') or public.has_role('admin')
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin');
$$;
create or replace function public.update_updated_at() returns trigger
language plpgsql set search_path to '' as $$
begin new.updated_at = now(); return new; end; $$;

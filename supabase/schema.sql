-- Kazikwanza database for Supabase.
--
-- Paste this whole file into Supabase → SQL Editor → New query, and press Run.
-- It is safe to run again: it only creates what is missing and replaces the functions.
--
-- Nothing here is reachable from the app directly: every table has Row Level
-- Security switched on with no policies, and the functions can only be called
-- with the service role key. The "kazi" Edge Function (supabase/functions/kazi)
-- is the only door in; it checks who is signed in and what they may change.

-- ───────── Tables ─────────

create table if not exists public.kazi_accounts (
  id text primary key,
  email_key text not null unique,          -- normalized email or phone, for sign-in and verifier lookups
  verifier_key text,                       -- normalized contact of the person who checks this account's work
  parent_id text,
  version integer not null default 1,      -- bumped on every change; stops two phones overwriting each other
  data jsonb not null,                     -- the full account as the app sees it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kazi_accounts_verifier_key on public.kazi_accounts (verifier_key);
create index if not exists kazi_accounts_parent_id on public.kazi_accounts (parent_id);

create table if not exists public.kazi_tasks (
  id text primary key,
  owner_id text not null,
  created_by text not null,
  verifier_id text,                        -- parent who checks a child's task
  verifier_key text,                       -- normalized contact of the verifier for personal tasks
  approved_by text,
  version integer not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists kazi_tasks_owner_id on public.kazi_tasks (owner_id);
create index if not exists kazi_tasks_created_by on public.kazi_tasks (created_by);
create index if not exists kazi_tasks_verifier_id on public.kazi_tasks (verifier_id);
create index if not exists kazi_tasks_verifier_key on public.kazi_tasks (verifier_key);
create index if not exists kazi_tasks_approved_by on public.kazi_tasks (approved_by);

create table if not exists public.kazi_notifications (
  id text primary key,
  account_id text not null,
  at bigint not null,
  data jsonb not null
);
create index if not exists kazi_notifications_account on public.kazi_notifications (account_id, at desc);

create table if not exists public.kazi_messages (
  id text primary key,
  from_id text not null,
  to_id text not null,
  at bigint not null,
  data jsonb not null
);
create index if not exists kazi_messages_from on public.kazi_messages (from_id);
create index if not exists kazi_messages_to on public.kazi_messages (to_id);

create table if not exists public.kazi_link_codes (
  code text primary key,
  parent_id text not null,
  expires_at bigint not null,
  data jsonb not null
);
create index if not exists kazi_link_codes_parent on public.kazi_link_codes (parent_id);

create table if not exists public.kazi_time_requests (
  id text primary key,
  child_id text not null,
  parent_id text not null,
  data jsonb not null
);
create index if not exists kazi_time_requests_child on public.kazi_time_requests (child_id);
create index if not exists kazi_time_requests_parent on public.kazi_time_requests (parent_id);

-- Sign-in sessions. Only a hash of each token is stored.
create table if not exists public.kazi_sessions (
  token_key text primary key,
  account_id text not null,
  created_at bigint not null,
  last_used bigint not null
);
create index if not exists kazi_sessions_account on public.kazi_sessions (account_id);

-- ───────── Lock the tables down ─────────

do $$
declare t text;
begin
  foreach t in array array['kazi_accounts', 'kazi_tasks', 'kazi_notifications', 'kazi_messages', 'kazi_link_codes', 'kazi_time_requests', 'kazi_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ───────── Loading one person's data ─────────

-- Everything a request by p_actor can need: their account, the people they are
-- connected to, tasks involving them or their children, their messages,
-- notifications, family codes and time requests. p_code adds the family code a
-- child is typing in. Mirrors subsetFor() in server/repo.ts.
create or replace function public.kazi_load(p_actor text, p_code text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with me as (
    select * from kazi_accounts where id = p_actor
  ),
  base_accounts as (
    select a.* from kazi_accounts a, me
    where a.id = me.id
       or (me.verifier_key is not null and a.email_key = me.verifier_key)
       or a.verifier_key = me.email_key
       or a.id = me.parent_id
       or a.parent_id = me.id
  ),
  children as (
    select id from kazi_accounts where parent_id = p_actor
  ),
  tasks as (
    select t.* from kazi_tasks t, me
    where t.owner_id = me.id
       or t.owner_id in (select id from children)
       or t.created_by = me.id
       or t.verifier_id = me.id
       or t.verifier_key = me.email_key
       or t.approved_by = me.id
  ),
  msgs as (
    select * from kazi_messages where from_id = p_actor or to_id = p_actor
  ),
  notes as (
    select * from kazi_notifications where account_id = p_actor order by at desc limit 100
  ),
  codes as (
    select * from kazi_link_codes
    where parent_id = p_actor
       or (coalesce(btrim(p_code), '') <> '' and code = upper(btrim(p_code)))
  ),
  reqs as (
    select * from kazi_time_requests where child_id = p_actor or parent_id = p_actor
  ),
  ref_ids as (
    select owner_id as id from tasks
    union select created_by from tasks
    union select verifier_id from tasks where verifier_id is not null
    union select approved_by from tasks where approved_by is not null
    union select case when from_id = p_actor then to_id else from_id end from msgs
    union select parent_id from codes
  ),
  all_accounts as (
    select * from base_accounts
    union select a.* from kazi_accounts a where a.id in (select id from ref_ids)
    union select a.* from kazi_accounts a where a.email_key in (select verifier_key from tasks where verifier_key is not null)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'version', 1,
      'sessionId', null,
      'accounts', coalesce((select jsonb_object_agg(id, data) from all_accounts), '{}'::jsonb),
      'tasks', coalesce((select jsonb_object_agg(id, data) from tasks), '{}'::jsonb),
      'notifications', coalesce((select jsonb_agg(data order by at desc) from notes), '[]'::jsonb),
      'messages', coalesce((select jsonb_agg(data order by at) from msgs), '[]'::jsonb),
      'linkCodes', coalesce((select jsonb_agg(data) from codes), '[]'::jsonb),
      'timeRequests', coalesce((select jsonb_agg(data) from reqs), '[]'::jsonb)
    ),
    'versions', jsonb_build_object(
      'accounts', coalesce((select jsonb_object_agg(id, version) from all_accounts), '{}'::jsonb),
      'tasks', coalesce((select jsonb_object_agg(id, version) from tasks), '{}'::jsonb)
    )
  );
$$;

-- ───────── Saving changes, all or nothing ─────────

-- Applies one request's changes in a single transaction. If an account or task
-- changed since it was loaded, raises 'kazi_conflict' and nothing is saved (the
-- Edge Function then retries). A new account whose email/phone is taken raises 'kazi_taken'.
create or replace function public.kazi_commit(p jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  n integer;
  touched text[] := '{}';
begin
  for r in select * from jsonb_array_elements(coalesce(p->'accounts', '[]'::jsonb)) loop
    if jsonb_typeof(r->'version') is distinct from 'number' then
      begin
        insert into kazi_accounts (id, email_key, verifier_key, parent_id, version, data)
        values (r->>'id', r->>'email_key', r->>'verifier_key', r->>'parent_id', 1, r->'data');
      exception when unique_violation then
        raise exception 'kazi_taken';
      end;
    else
      update kazi_accounts
         set email_key = r->>'email_key', verifier_key = r->>'verifier_key', parent_id = r->>'parent_id',
             data = r->'data', version = version + 1, updated_at = now()
       where id = r->>'id' and version = (r->>'version')::integer;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'kazi_conflict'; end if;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'tasks', '[]'::jsonb)) loop
    if jsonb_typeof(r->'version') is distinct from 'number' then
      begin
        insert into kazi_tasks (id, owner_id, created_by, verifier_id, verifier_key, approved_by, version, data)
        values (r->>'id', r->>'owner_id', r->>'created_by', r->>'verifier_id', r->>'verifier_key', r->>'approved_by', 1, r->'data');
      exception when unique_violation then
        raise exception 'kazi_conflict';
      end;
    else
      update kazi_tasks
         set owner_id = r->>'owner_id', created_by = r->>'created_by', verifier_id = r->>'verifier_id',
             verifier_key = r->>'verifier_key', approved_by = r->>'approved_by',
             data = r->'data', version = version + 1, updated_at = now()
       where id = r->>'id' and version = (r->>'version')::integer;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'kazi_conflict'; end if;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'deletedTasks', '[]'::jsonb)) loop
    delete from kazi_tasks where id = r->>'id' and version = (r->>'version')::integer;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'kazi_conflict'; end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'notifications', '[]'::jsonb)) loop
    insert into kazi_notifications (id, account_id, at, data)
    values (r->>'id', r->>'accountId', (r->>'at')::bigint, r)
    on conflict (id) do update set data = excluded.data;
    touched := touched || (r->>'accountId');
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'messages', '[]'::jsonb)) loop
    insert into kazi_messages (id, from_id, to_id, at, data)
    values (r->>'id', r->>'from', r->>'to', (r->>'at')::bigint, r)
    on conflict (id) do update set data = excluded.data;
  end loop;

  delete from kazi_link_codes where code in (select jsonb_array_elements_text(coalesce(p->'deletedCodes', '[]'::jsonb)));
  for r in select * from jsonb_array_elements(coalesce(p->'linkCodes', '[]'::jsonb)) loop
    insert into kazi_link_codes (code, parent_id, expires_at, data)
    values (r->>'code', r->>'parentId', (r->>'expiresAt')::bigint, r)
    on conflict (code) do update set parent_id = excluded.parent_id, expires_at = excluded.expires_at, data = excluded.data;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'timeRequests', '[]'::jsonb)) loop
    insert into kazi_time_requests (id, child_id, parent_id, data)
    values (r->>'id', r->>'childId', r->>'parentId', r)
    on conflict (id) do update set data = excluded.data;
  end loop;

  -- Keep each person's newest 100 notifications.
  if array_length(touched, 1) > 0 then
    delete from kazi_notifications k
     using (
       select id from (
         select id, row_number() over (partition by account_id order by at desc) as rn
           from kazi_notifications where account_id = any (touched)
       ) ranked where rn > 100
     ) old
     where k.id = old.id;
  end if;
end;
$$;

-- ───────── Accounts and sessions ─────────

create or replace function public.kazi_find_account(p_email_key text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select data from kazi_accounts where email_key = p_email_key;
$$;

create or replace function public.kazi_session_get(p_key text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('accountId', account_id, 'createdAt', created_at, 'lastUsed', last_used)
    from kazi_sessions where token_key = p_key;
$$;

create or replace function public.kazi_session_put(p_key text, p_account text, p_created bigint, p_last bigint)
returns void
language sql
set search_path = public
as $$
  insert into kazi_sessions (token_key, account_id, created_at, last_used)
  values (p_key, p_account, p_created, p_last)
  on conflict (token_key) do update set last_used = excluded.last_used;
  -- Forget sessions nobody has used for 180 days.
  delete from kazi_sessions where last_used < p_last - 180::bigint * 24 * 60 * 60 * 1000;
$$;

create or replace function public.kazi_session_delete(p_key text)
returns void
language sql
set search_path = public
as $$
  delete from kazi_sessions where token_key = p_key;
$$;

-- Only the service role (used inside the Edge Function) may call these.
do $$
declare f text;
begin
  foreach f in array array[
    'kazi_load(text, text)', 'kazi_commit(jsonb)', 'kazi_find_account(text)',
    'kazi_session_get(text)', 'kazi_session_put(text, text, bigint, bigint)', 'kazi_session_delete(text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%s from anon, authenticated', f);
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;

-- ───────── Photo storage ─────────

-- A private bucket for proof photos. With no storage policies, only the Edge
-- Function (service role) can read or write it; photos are deleted once checked.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('kazi-proofs', 'kazi-proofs', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;

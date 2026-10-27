-- My Daily: tables that sync your to-do list, learning log, work log and settings.
--
-- Run once in your Supabase project:
--   Dashboard → SQL Editor → New query → paste this file → Run.
-- It's safe to run again; it only creates what's missing.
--
-- Every row belongs to a signed-in user, and row-level security makes sure
-- each user can only read and change their own rows.

create table if not exists public.tasks (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  notes       text not null default '',
  due         date,
  important   boolean not null default false,
  url         text,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),  -- set by the device; the newest edit wins
  deleted     boolean not null default false,       -- kept so deletions reach your other devices
  synced_at   timestamptz not null default now()    -- set by the server; devices pull rows newer than this
);

create table if not exists public.learning_log (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id     text not null,          -- e.g. devto:12345 or hn:4567
  topic       text,
  title       text,
  url         text,
  image       text,
  kind        text,                   -- learn or trend
  read_at     timestamptz,            -- "Read it"
  done_at     timestamptz,            -- "Tried it"
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.preferences (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,   -- name, theme, sources, topics
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);

create table if not exists public.work_log (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  data        jsonb not null,                       -- the day's commits, repos, pull requests and summary
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists tasks_user_synced on public.tasks (user_id, synced_at);
create index if not exists work_log_user_synced on public.work_log (user_id, synced_at);
create index if not exists learning_log_user_synced on public.learning_log (user_id, synced_at);

-- Runs before every write:
--   * keeps the newest edit: an update older than what's stored is skipped,
--     so a device coming back online can't overwrite newer changes;
--   * stamps synced_at with the server's clock, so pulls never miss a change
--     even if a device's clock is off. clock_timestamp() differs row to row.
create or replace function public.touch_synced_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists touch_synced_at on public.tasks;
create trigger touch_synced_at before insert or update on public.tasks
  for each row execute function public.touch_synced_at();

drop trigger if exists touch_synced_at on public.learning_log;
create trigger touch_synced_at before insert or update on public.learning_log
  for each row execute function public.touch_synced_at();

drop trigger if exists touch_synced_at on public.work_log;
create trigger touch_synced_at before insert or update on public.work_log
  for each row execute function public.touch_synced_at();

drop trigger if exists touch_synced_at on public.preferences;
create trigger touch_synced_at before insert or update on public.preferences
  for each row execute function public.touch_synced_at();

alter table public.tasks enable row level security;
alter table public.learning_log enable row level security;
alter table public.preferences enable row level security;
alter table public.work_log enable row level security;

drop policy if exists "Own rows" on public.work_log;
create policy "Own rows" on public.work_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Own rows" on public.tasks;
create policy "Own rows" on public.tasks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Own rows" on public.learning_log;
create policy "Own rows" on public.learning_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Own rows" on public.preferences;
create policy "Own rows" on public.preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Cost Tracker — Supabase schema (locked-down / code-gated).
--
-- Security model: a group is a capability guarded by its share_code. Tables
-- have RLS enabled with NO permissive policies, so the public anon key cannot
-- read or write them directly (no enumerating other people's groups). All
-- access goes through the SECURITY DEFINER functions below, each of which
-- requires the group's share_code. Know the code → you're in; don't → you see
-- nothing.
--
-- Run this whole file once in the Supabase SQL editor. It is safe to re-run.

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  home_currency text not null,
  currencies    jsonb not null default '[]'::jsonb,
  share_code    text not null unique,
  created_at    timestamptz not null default now()
);
alter table groups add column if not exists currencies jsonb not null default '[]'::jsonb;

create table if not exists members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  name       text not null,
  color      text not null,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references groups(id) on delete cascade,
  label           text not null,
  payer_member_id uuid not null,
  currency        text not null,
  fx_rate_to_home numeric not null default 1,
  tax_rate        numeric not null default 0,
  split_mode      text not null check (split_mode in ('equal','itemized')),
  subtotal        numeric,
  line_items      jsonb not null default '[]'::jsonb,
  participants    jsonb not null default '[]'::jsonb,
  date            date not null default current_date,
  note            text,
  created_at      timestamptz not null default now()
);

create table if not exists settlements (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups(id) on delete cascade,
  from_member_id uuid not null,
  to_member_id   uuid not null,
  amount         numeric not null,
  date           date not null default current_date,
  note           text,
  created_at     timestamptz not null default now()
);

-- Added after initial release; safe to re-run.
alter table members     add column if not exists active boolean not null default true;
alter table expenses    add column if not exists archived_at timestamptz;
alter table expenses    add column if not exists deleted_at timestamptz;
alter table settlements add column if not exists archived_at timestamptz;
alter table groups      add column if not exists fx_rates jsonb not null default '{}'::jsonb;

create index if not exists members_group_idx    on members(group_id);
create index if not exists expenses_group_idx    on expenses(group_id);
create index if not exists settlements_group_idx on settlements(group_id);

-- ----------------------------------------------------------------------------
-- Lock down: RLS on, and remove any legacy permissive policies so the anon key
-- has no direct table access. Access is only via the functions below.
-- ----------------------------------------------------------------------------

alter table groups      enable row level security;
alter table members     enable row level security;
alter table expenses    enable row level security;
alter table settlements enable row level security;

drop policy if exists "anon full access" on groups;
drop policy if exists "anon full access" on members;
drop policy if exists "anon full access" on expenses;
drop policy if exists "anon full access" on settlements;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Resolve a share_code to its group id, or raise if unknown.
create or replace function app_group_id(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from groups where share_code = upper(p_code);
  if v_id is null then
    raise exception 'group not found' using errcode = 'no_data_found';
  end if;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Group functions
-- ----------------------------------------------------------------------------

create or replace function create_group(
  p_name text,
  p_home_currency text,
  p_currencies jsonb
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_alpha text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_row groups;
  i int;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, floor(random() * length(v_alpha))::int + 1, 1);
    end loop;
    begin
      insert into groups (name, home_currency, currencies, share_code)
      values (p_name, p_home_currency, coalesce(p_currencies, '[]'::jsonb), v_code)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- code collided, try again
    end;
  end loop;
end;
$$;

create or replace function get_group_bundle(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_group groups;
begin
  select * into v_group from groups where share_code = upper(p_code);
  if not found then
    return null;
  end if;
  return json_build_object(
    'group', row_to_json(v_group),
    'members', coalesce(
      (select json_agg(m order by m.created_at) from members m where m.group_id = v_group.id),
      '[]'::json),
    'expenses', coalesce(
      (select json_agg(e order by e.date) from expenses e where e.group_id = v_group.id),
      '[]'::json),
    'settlements', coalesce(
      (select json_agg(s order by s.date) from settlements s where s.group_id = v_group.id),
      '[]'::json)
  );
end;
$$;

-- Permanently delete a whole group and everything in it (FK cascade).
create or replace function delete_group(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from groups where id = app_group_id(p_code);
end;
$$;

-- Note: the older 4-arg update_group (without p_fx_rates) is intentionally left
-- in place so a previously-deployed frontend keeps working during a rollout.
-- This 5-arg version is what the current app calls.
create or replace function update_group(
  p_code text,
  p_name text,
  p_home_currency text,
  p_currencies jsonb,
  p_fx_rates jsonb
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare v_row groups;
begin
  update groups set
    name = coalesce(p_name, name),
    home_currency = coalesce(p_home_currency, home_currency),
    currencies = coalesce(p_currencies, currencies),
    fx_rates = coalesce(p_fx_rates, fx_rates)
  where id = app_group_id(p_code)
  returning * into v_row;
  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Member functions
-- ----------------------------------------------------------------------------

create or replace function add_member(p_code text, p_name text, p_color text)
returns members
language plpgsql security definer set search_path = public
as $$
declare v_row members;
begin
  insert into members (group_id, name, color)
  values (app_group_id(p_code), p_name, p_color)
  returning * into v_row;
  return v_row;
end;
$$;

-- Drop the pre-active signature if it exists, then recreate with p_active.
drop function if exists update_member(text, uuid, text, text);
create or replace function update_member(
  p_code text, p_member_id uuid, p_name text, p_color text, p_active boolean
)
returns members
language plpgsql security definer set search_path = public
as $$
declare v_row members;
begin
  update members set
    name = coalesce(p_name, name),
    color = coalesce(p_color, color),
    active = coalesce(p_active, active)
  where id = p_member_id and group_id = app_group_id(p_code)
  returning * into v_row;
  if not found then raise exception 'member not in group'; end if;
  return v_row;
end;
$$;

create or replace function remove_member(p_code text, p_member_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from members where id = p_member_id and group_id = app_group_id(p_code);
end;
$$;

-- ----------------------------------------------------------------------------
-- Expense functions (payload passed as jsonb with the app's camelCase keys)
-- ----------------------------------------------------------------------------

create or replace function add_expense(p_code text, p_expense jsonb)
returns expenses
language plpgsql security definer set search_path = public
as $$
declare v_row expenses;
begin
  insert into expenses (
    group_id, label, payer_member_id, currency, fx_rate_to_home, tax_rate,
    split_mode, subtotal, line_items, participants, date, note
  ) values (
    app_group_id(p_code),
    p_expense->>'label',
    (p_expense->>'payerMemberId')::uuid,
    p_expense->>'currency',
    coalesce((p_expense->>'fxRateToHome')::numeric, 1),
    coalesce((p_expense->>'taxRate')::numeric, 0),
    p_expense->>'splitMode',
    (p_expense->>'subtotal')::numeric,
    coalesce(p_expense->'lineItems', '[]'::jsonb),
    coalesce(p_expense->'participants', '[]'::jsonb),
    coalesce((p_expense->>'date')::date, current_date),
    p_expense->>'note'
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function update_expense(
  p_code text, p_expense_id uuid, p_expense jsonb
)
returns expenses
language plpgsql security definer set search_path = public
as $$
declare v_row expenses;
begin
  update expenses set
    label = p_expense->>'label',
    payer_member_id = (p_expense->>'payerMemberId')::uuid,
    currency = p_expense->>'currency',
    fx_rate_to_home = coalesce((p_expense->>'fxRateToHome')::numeric, 1),
    tax_rate = coalesce((p_expense->>'taxRate')::numeric, 0),
    split_mode = p_expense->>'splitMode',
    subtotal = (p_expense->>'subtotal')::numeric,
    line_items = coalesce(p_expense->'lineItems', '[]'::jsonb),
    participants = coalesce(p_expense->'participants', '[]'::jsonb),
    date = coalesce((p_expense->>'date')::date, current_date),
    note = p_expense->>'note'
  where id = p_expense_id and group_id = app_group_id(p_code)
  returning * into v_row;
  if not found then raise exception 'expense not in group'; end if;
  return v_row;
end;
$$;

-- Soft delete: move an expense to Trash (recoverable).
create or replace function delete_expense(p_code text, p_expense_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update expenses set deleted_at = now()
  where id = p_expense_id and group_id = app_group_id(p_code);
end;
$$;

create or replace function restore_expense(p_code text, p_expense_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update expenses set deleted_at = null
  where id = p_expense_id and group_id = app_group_id(p_code);
end;
$$;

-- Permanent delete (empties Trash). Cannot be undone.
create or replace function purge_expense(p_code text, p_expense_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from expenses where id = p_expense_id and group_id = app_group_id(p_code);
end;
$$;

-- ----------------------------------------------------------------------------
-- Settlement functions
-- ----------------------------------------------------------------------------

create or replace function add_settlement(p_code text, p_settlement jsonb)
returns settlements
language plpgsql security definer set search_path = public
as $$
declare v_row settlements;
begin
  insert into settlements (group_id, from_member_id, to_member_id, amount, date, note)
  values (
    app_group_id(p_code),
    (p_settlement->>'fromMemberId')::uuid,
    (p_settlement->>'toMemberId')::uuid,
    (p_settlement->>'amount')::numeric,
    coalesce((p_settlement->>'date')::date, current_date),
    p_settlement->>'note'
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function delete_settlement(p_code text, p_settlement_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from settlements where id = p_settlement_id and group_id = app_group_id(p_code);
end;
$$;

-- Close the books: archive all still-active expenses and settlements at once.
create or replace function archive_settled(p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_gid uuid := app_group_id(p_code);
begin
  update expenses set archived_at = now()
    where group_id = v_gid and archived_at is null and deleted_at is null;
  update settlements set archived_at = now()
    where group_id = v_gid and archived_at is null;
end;
$$;

-- ----------------------------------------------------------------------------
-- Expose functions to the anon (public) API role; keep tables locked.
-- ----------------------------------------------------------------------------

grant execute on function create_group(text, text, jsonb)            to anon, authenticated;
grant execute on function get_group_bundle(text)                     to anon, authenticated;
grant execute on function update_group(text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function delete_group(text)                         to anon, authenticated;
grant execute on function add_member(text, text, text)                 to anon, authenticated;
grant execute on function update_member(text, uuid, text, text, boolean) to anon, authenticated;
grant execute on function remove_member(text, uuid)                    to anon, authenticated;
grant execute on function add_expense(text, jsonb)                     to anon, authenticated;
grant execute on function update_expense(text, uuid, jsonb)            to anon, authenticated;
grant execute on function delete_expense(text, uuid)                   to anon, authenticated;
grant execute on function restore_expense(text, uuid)                  to anon, authenticated;
grant execute on function purge_expense(text, uuid)                    to anon, authenticated;
grant execute on function add_settlement(text, jsonb)                  to anon, authenticated;
grant execute on function delete_settlement(text, uuid)                to anon, authenticated;
grant execute on function archive_settled(text)                        to anon, authenticated;

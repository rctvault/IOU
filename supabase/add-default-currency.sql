-- MIGRATION: per-group default currency for new expenses.
--
-- Adds groups.default_currency (the currency a new expense starts in, separate
-- from the home currency used for settle-up) and a 6-arg update_group that can
-- set it. Purely additive: the existing 4- and 5-arg update_group functions are
-- left alone, so an already-deployed frontend keeps working before and after.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.

alter table groups add column if not exists default_currency text;

create or replace function update_group(
  p_code text,
  p_name text,
  p_home_currency text,
  p_currencies jsonb,
  p_fx_rates jsonb,
  p_default_currency text
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gid uuid := app_group_id(p_code);
  v_row groups;
begin
  update groups set
    name = coalesce(p_name, name),
    home_currency = coalesce(p_home_currency, home_currency),
    currencies = coalesce(p_currencies, currencies),
    fx_rates = coalesce(p_fx_rates, fx_rates),
    default_currency = coalesce(p_default_currency, default_currency)
  where id = v_gid
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function update_group(text, text, text, jsonb, jsonb, text) to anon, authenticated;

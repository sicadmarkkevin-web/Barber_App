-- 0016_payment_provider_config.sql
-- Phase 2 of online payments: connects each business's OWN PayMongo account
-- (Model 1 — see chat) so checkout sessions can be created server-side.
-- Additive only — does not modify 0001-0016. No webhooks, no auto-confirm,
-- no refunds/payouts — that's Phase 3.
--
-- Inspected first (see chat): Phase 1 (0016) already added
-- online_payments_enabled/payment_methods/deposit_* to barbers.booking_settings
-- and total_amount/deposit_amount/payment_status/etc to bookings — reused
-- as-is, nothing duplicated here. PayMongo has no native "connected
-- sub-accounts" feature, so Model 1 is implemented by having each business
-- supply their OWN PayMongo secret key, used to create checkout sessions on
-- THEIR account (money goes straight to them, platform never touches it).
--
-- Secret storage: Supabase Vault (pgsodium-encrypted, built into every
-- Supabase project — no new infrastructure). The raw key is never stored in
-- a plain column and is only ever decrypted by the service_role (i.e. the
-- create-checkout Edge Function) — never by `authenticated` or `anon`, and
-- never returned to the browser, including back to the business that
-- entered it.

alter table barbers add column if not exists paymongo_connected boolean not null default false;

-- ---------------------------------------------------------------------------
-- set_paymongo_secret_key: lets a barber save/replace their OWN PayMongo
-- secret key. SECURITY DEFINER so it can write to vault.secrets (not
-- normally writable by `authenticated`), but the auth.uid() check below
-- means a barber can only ever set their OWN key — never another business's.
-- Write-only by design: there is no corresponding "get my secret key" RPC
-- for authenticated/anon roles (see get_paymongo_secret_key below, granted
-- to service_role only).
-- ---------------------------------------------------------------------------
create or replace function set_paymongo_secret_key(p_barber_id uuid, p_secret_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vault_name text := 'paymongo_secret:' || p_barber_id::text;
  v_existing_id uuid;
begin
  if not exists (select 1 from barbers where id = p_barber_id and owner_profile_id = auth.uid()) then
    raise exception 'Not authorized to configure payments for this business.';
  end if;

  if p_secret_key is null or trim(p_secret_key) = '' then
    raise exception 'A secret key is required.';
  end if;

  select id into v_existing_id from vault.secrets where name = v_vault_name;
  if v_existing_id is not null then
    perform vault.update_secret(v_existing_id, trim(p_secret_key));
  else
    perform vault.create_secret(trim(p_secret_key), v_vault_name, 'PayMongo secret key for barber ' || p_barber_id::text);
  end if;

  update barbers set paymongo_connected = true where id = p_barber_id;
end;
$$;

grant execute on function set_paymongo_secret_key to authenticated;

-- ---------------------------------------------------------------------------
-- disconnect_paymongo: lets a barber remove their stored key (e.g. before
-- rotating it, or to turn off online payments entirely at the credential
-- level, not just the booking_settings toggle).
-- ---------------------------------------------------------------------------
create or replace function disconnect_paymongo(p_barber_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vault_name text := 'paymongo_secret:' || p_barber_id::text;
begin
  if not exists (select 1 from barbers where id = p_barber_id and owner_profile_id = auth.uid()) then
    raise exception 'Not authorized to configure payments for this business.';
  end if;

  delete from vault.secrets where name = v_vault_name;
  update barbers set paymongo_connected = false where id = p_barber_id;
end;
$$;

grant execute on function disconnect_paymongo to authenticated;

-- ---------------------------------------------------------------------------
-- get_paymongo_secret_key: the ONLY way to read a decrypted key back.
-- Granted to service_role only — the create-checkout Edge Function calls
-- this using the Supabase service role key. `authenticated`/`anon` have no
-- grant on this function at all, so a normal user session can never call it
-- even if they knew it existed.
-- ---------------------------------------------------------------------------
create or replace function get_paymongo_secret_key(p_barber_id uuid)
returns text
language sql
security definer
set search_path = public, vault
stable
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'paymongo_secret:' || p_barber_id::text
  limit 1;
$$;

revoke all on function get_paymongo_secret_key(uuid) from public, authenticated, anon;
grant execute on function get_paymongo_secret_key to service_role;
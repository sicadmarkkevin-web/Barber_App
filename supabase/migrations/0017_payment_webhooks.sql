-- 0017_payment_webhooks.sql
-- Phase 3 of online payments: webhook receipt, signature verification,
-- idempotent processing, and automatic booking confirmation. Additive only —
-- does not modify 0001-0017's tables/columns; extends disconnect_paymongo
-- in place to also clean up the new webhook state it introduces (same
-- established pattern as extending create_booking across phases).
--
-- Inspected first (see chat): 0016 added bookings.payment_status/
-- deposit_amount/amount_paid/remaining_balance/paid_at/payment_transaction_id
-- (reused as-is, nothing duplicated). 0017 added barbers.paymongo_connected
-- + set_paymongo_secret_key/get_paymongo_secret_key/disconnect_paymongo,
-- storing each business's OWN PayMongo secret key in Supabase Vault (Model
-- 1 — reused as-is). This migration adds what's specific to Phase 3: each
-- business also needs their OWN webhook signing secret (PayMongo has no
-- platform-wide webhook secret — every registered endpoint gets its own),
-- since our single webhook URL receives events from many different
-- merchant accounts.

-- ---------------------------------------------------------------------------
-- 1. Webhook idempotency ledger. PayMongo retries undelivered webhooks up to
-- 12 times, so the same event can arrive more than once — this table is
-- what makes reprocessing safe. RLS enabled with NO policies granted to any
-- client role: only service_role (i.e. the paymongo-webhook Edge Function)
-- can ever touch it, by design — this is purely internal bookkeeping, never
-- meant to be queried by a barber or customer.
-- ---------------------------------------------------------------------------
create table if not exists payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paymongo',
  event_id text not null,
  event_type text,
  booking_id uuid references bookings(id) on delete set null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
alter table payment_webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- 2. barbers.paymongo_webhook_id: the webhook resource's own id (hook_...),
-- not sensitive, needed to disable it on disconnect.
-- ---------------------------------------------------------------------------
alter table barbers add column if not exists paymongo_webhook_id text;

-- ---------------------------------------------------------------------------
-- 3. set_paymongo_webhook_secret: stores the webhook signing secret PayMongo
-- returns when the connect-paymongo Edge Function registers the endpoint.
-- Same ownership-check + Vault pattern as 0017's set_paymongo_secret_key.
-- ---------------------------------------------------------------------------
create or replace function set_paymongo_webhook_secret(p_barber_id uuid, p_webhook_secret text, p_webhook_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vault_name text := 'paymongo_webhook_secret:' || p_barber_id::text;
  v_existing_id uuid;
begin
  if not exists (select 1 from barbers where id = p_barber_id and owner_profile_id = auth.uid()) then
    raise exception 'Not authorized to configure payments for this business.';
  end if;

  select id into v_existing_id from vault.secrets where name = v_vault_name;
  if v_existing_id is not null then
    perform vault.update_secret(v_existing_id, p_webhook_secret);
  else
    perform vault.create_secret(p_webhook_secret, v_vault_name, 'PayMongo webhook secret for barber ' || p_barber_id::text);
  end if;

  update barbers set paymongo_webhook_id = p_webhook_id where id = p_barber_id;
end;
$$;

grant execute on function set_paymongo_webhook_secret to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_paymongo_webhook_secret: read access restricted to service_role
-- only — the paymongo-webhook Edge Function is the only caller. Mirrors
-- 0017's get_paymongo_secret_key exactly.
-- ---------------------------------------------------------------------------
create or replace function get_paymongo_webhook_secret(p_barber_id uuid)
returns text
language sql
security definer
set search_path = public, vault
stable
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'paymongo_webhook_secret:' || p_barber_id::text
  limit 1;
$$;

revoke all on function get_paymongo_webhook_secret(uuid) from public, authenticated, anon;
grant execute on function get_paymongo_webhook_secret to service_role;

-- ---------------------------------------------------------------------------
-- 5. Extend disconnect_paymongo (0017) to also clean up the webhook secret
-- and id this migration introduces — same function, same signature, just
-- more to tidy up, so a disconnected business doesn't leave an orphaned
-- webhook secret behind.
-- ---------------------------------------------------------------------------
create or replace function disconnect_paymongo(p_barber_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_name text := 'paymongo_secret:' || p_barber_id::text;
  v_webhook_secret_name text := 'paymongo_webhook_secret:' || p_barber_id::text;
begin
  if not exists (select 1 from barbers where id = p_barber_id and owner_profile_id = auth.uid()) then
    raise exception 'Not authorized to configure payments for this business.';
  end if;

  delete from vault.secrets where name = v_secret_name;
  delete from vault.secrets where name = v_webhook_secret_name;
  update barbers set paymongo_connected = false, paymongo_webhook_id = null where id = p_barber_id;
end;
$$;

grant execute on function disconnect_paymongo to authenticated;

-- ---------------------------------------------------------------------------
-- 6. confirm_deposit_paid: the ONLY way a booking's payment_status becomes
-- 'paid'. Atomic (a single function call is one Postgres transaction) and
-- idempotent (short-circuits if already paid, rather than re-applying).
-- Verifies the provider-confirmed amount matches our own recorded deposit —
-- never trusts a client-supplied amount, and this function itself is only
-- reachable by service_role, never by a browser. Automatically confirms the
-- booking (status -> 'confirmed') ONLY if it was still 'pending' — an
-- already-cancelled or already-confirmed booking is left alone, per "don't
-- override existing business logic".
-- ---------------------------------------------------------------------------
create or replace function confirm_deposit_paid(
  p_booking_id uuid,
  p_provider_payment_id text,
  p_amount_paid_centavos bigint
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_amount_paid numeric;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  -- Idempotent short-circuit: a retried/duplicate webhook for an
  -- already-confirmed payment is a safe no-op, not an error.
  if v_booking.payment_status = 'paid' then
    return v_booking;
  end if;

  v_amount_paid := round(p_amount_paid_centavos / 100.0, 2);

  if v_amount_paid != v_booking.deposit_amount then
    raise exception 'Payment amount mismatch: expected %, got %', v_booking.deposit_amount, v_amount_paid;
  end if;

  update bookings set
    payment_status = 'paid',
    amount_paid = v_amount_paid,
    remaining_balance = coalesce(total_amount, v_amount_paid) - v_amount_paid,
    payment_transaction_id = p_provider_payment_id,
    paid_at = now(),
    status = case when status = 'pending' then 'confirmed' else status end
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke all on function confirm_deposit_paid(uuid, text, bigint) from public, authenticated, anon;
grant execute on function confirm_deposit_paid to service_role;

-- ---------------------------------------------------------------------------
-- 7. mark_payment_failed: records a failed payment WITHOUT touching booking
-- status — the appointment slot/booking is left exactly as-is (per spec:
-- never delete or reinterpret a valid booking just because one payment
-- attempt failed; the customer may retry or pay at the appointment).
-- ---------------------------------------------------------------------------
create or replace function mark_payment_failed(p_booking_id uuid, p_provider_payment_id text)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.payment_status = 'paid' then
    -- A failure event arriving after a successful payment was already
    -- recorded (e.g. out-of-order delivery) must never downgrade a paid
    -- booking back to failed.
    return v_booking;
  end if;

  update bookings set
    payment_status = 'failed',
    payment_transaction_id = p_provider_payment_id
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke all on function mark_payment_failed(uuid, text) from public, authenticated, anon;
grant execute on function mark_payment_failed to service_role;

-- ---------------------------------------------------------------------------
-- 8. get_booking_payment_status: lets the customer's payment-return page
-- check real status after coming back from checkout. Most customers here
-- book without an account, so the normal bookings RLS policy (which
-- requires customers.profile_id = auth.uid()) can never let them read their
-- own booking back — there is no logged-in session to match against.
--
-- This is a deliberately narrow exception: it returns ONLY payment/status
-- fields (no customer name/phone/email, no barber private info, no other
-- booking's data) for a single booking id. Safety comes from the id itself
-- being an unguessable uuid that only reaches this page because it was
-- returned to the customer's own browser after THEY created that booking —
-- the same trust model as any "order confirmation" URL industry-wide, not a
-- general "look up any booking" hole.
-- ---------------------------------------------------------------------------
create or replace function get_booking_payment_status(p_booking_id uuid)
returns table (
  booking_status text,
  payment_status text,
  total_amount numeric,
  deposit_amount numeric,
  amount_paid numeric,
  remaining_balance numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select status, payment_status, total_amount, deposit_amount, amount_paid, remaining_balance
  from bookings
  where id = p_booking_id;
$$;

grant execute on function get_booking_payment_status to authenticated, anon;
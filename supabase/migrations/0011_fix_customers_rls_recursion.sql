-- 0011_fix_customers_rls_recursion.sql
-- Fixes: "infinite recursion detected in policy for relation customers"
--
-- Root cause: the customers SELECT/UPDATE policies (0002) query `bookings`
-- to check "is a barber who owns this booking looking me up", and the
-- bookings SELECT/UPDATE policies query `customers` to check "is this the
-- booking's own customer". Both tables have RLS enabled, so each policy's
-- subquery re-triggers the other table's policy, which re-triggers the
-- first again -> infinite recursion.
--
-- Fix: move the "barber has a booking with this customer" check into a
-- SECURITY DEFINER function. It's owned by the same role that owns the
-- tables (the migration role), so table-owner RLS bypass applies inside
-- it — its query against bookings/barbers does not re-evaluate their RLS
-- policies. That breaks the cycle: customers' policy calls the function
-- (no RLS re-entry) instead of querying bookings directly.

create or replace function public.is_barber_for_customer(target_customer_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from bookings bk
    join barbers b on b.id = bk.barber_id
    where bk.customer_id = target_customer_id
      and b.owner_profile_id = auth.uid()
  );
$$;

-- Callers only need EXECUTE, not table access — the function itself owns
-- the elevated read via SECURITY DEFINER.
grant execute on function public.is_barber_for_customer(uuid) to authenticated, anon;

drop policy if exists "customers: select own or booked-with" on customers;
create policy "customers: select own or booked-with" on customers for select using (
  profile_id = auth.uid()
  or public.is_barber_for_customer(customers.id)
);

drop policy if exists "customers: update own or booked-with" on customers;
create policy "customers: update own or booked-with" on customers for update using (
  profile_id = auth.uid()
  or public.is_barber_for_customer(customers.id)
);

-- bookings' policies are left as-is: they query `customers` directly, but
-- since customers' own policy no longer queries `bookings` via a normal
-- (RLS-subject) subquery, that direction no longer loops back.
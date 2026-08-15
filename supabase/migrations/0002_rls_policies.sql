-- 0002_rls_policies.sql
-- Enforces: a barber can only touch their own data; public booking-page data
-- (services, styles, hours, the barber's public profile fields) is readable
-- by anyone, including signed-out visitors; customer PII is never public.
--
-- NOTE on `bookings` INSERT: there is deliberately no client-facing INSERT
-- policy on bookings. All booking creation goes through the create_booking()
-- RPC in 0003_create_booking_rpc.sql, which is SECURITY DEFINER and validates
-- slot availability atomically before inserting — this is what prevents the
-- double-booking race condition described in the product brief (§29).

alter table profiles enable row level security;
alter table barbers enable row level security;
alter table services enable row level security;
alter table hair_styles enable row level security;
alter table business_hours enable row level security;
alter table blocked_dates enable row level security;
alter table customers enable row level security;
alter table bookings enable row level security;
alter table customer_preferences enable row level security;
alter table customer_reference_photos enable row level security;
alter table reviews enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table notifications enable row level security;

-- ---------------------------------------------------------------------------
-- profiles — private. Only the owner can read/write their own row.
-- ---------------------------------------------------------------------------
create policy "profiles: select own" on profiles for select using (id = auth.uid());
create policy "profiles: insert own" on profiles for insert with check (id = auth.uid());
create policy "profiles: update own" on profiles for update using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- barbers — public columns are the whole point of the /:username page, so
-- SELECT is public. No customer PII lives on this table.
-- ---------------------------------------------------------------------------
create policy "barbers: public select" on barbers for select using (true);
create policy "barbers: owner insert" on barbers for insert with check (owner_profile_id = auth.uid());
create policy "barbers: owner update" on barbers for update using (owner_profile_id = auth.uid());
create policy "barbers: owner delete" on barbers for delete using (owner_profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- services / hair_styles / business_hours / blocked_dates — same shape:
-- public read (needed for the booking page), owner-only write.
-- ---------------------------------------------------------------------------
create policy "services: public select" on services for select using (true);
create policy "services: owner write" on services for all using (
  exists (select 1 from barbers b where b.id = services.barber_id and b.owner_profile_id = auth.uid())
) with check (
  exists (select 1 from barbers b where b.id = services.barber_id and b.owner_profile_id = auth.uid())
);

create policy "hair_styles: public select" on hair_styles for select using (true);
create policy "hair_styles: owner write" on hair_styles for all using (
  exists (select 1 from barbers b where b.id = hair_styles.barber_id and b.owner_profile_id = auth.uid())
) with check (
  exists (select 1 from barbers b where b.id = hair_styles.barber_id and b.owner_profile_id = auth.uid())
);

create policy "business_hours: public select" on business_hours for select using (true);
create policy "business_hours: owner write" on business_hours for all using (
  exists (select 1 from barbers b where b.id = business_hours.barber_id and b.owner_profile_id = auth.uid())
) with check (
  exists (select 1 from barbers b where b.id = business_hours.barber_id and b.owner_profile_id = auth.uid())
);

create policy "blocked_dates: public select" on blocked_dates for select using (true);
create policy "blocked_dates: owner write" on blocked_dates for all using (
  exists (select 1 from barbers b where b.id = blocked_dates.barber_id and b.owner_profile_id = auth.uid())
) with check (
  exists (select 1 from barbers b where b.id = blocked_dates.barber_id and b.owner_profile_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- customers — readable by the customer themself, or by a barber who has a
-- booking with them. Insert is open (guest checkout creates a customer row
-- with no account); tighten with rate limiting in Phase 8 if spam becomes
-- an issue.
-- ---------------------------------------------------------------------------
create policy "customers: select own or booked-with" on customers for select using (
  profile_id = auth.uid()
  or exists (
    select 1 from bookings bk
    join barbers b on b.id = bk.barber_id
    where bk.customer_id = customers.id and b.owner_profile_id = auth.uid()
  )
);
create policy "customers: insert" on customers for insert with check (true);
create policy "customers: update own or booked-with" on customers for update using (
  profile_id = auth.uid()
  or exists (
    select 1 from bookings bk
    join barbers b on b.id = bk.barber_id
    where bk.customer_id = customers.id and b.owner_profile_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- bookings — visible to the owning barber and the booking's customer only.
-- Both may update (barber: confirm/cancel/complete; customer: cancel/
-- reschedule per the barber's rules). No client-facing insert — see note
-- at top of file.
-- ---------------------------------------------------------------------------
create policy "bookings: select barber or customer" on bookings for select using (
  exists (select 1 from barbers b where b.id = bookings.barber_id and b.owner_profile_id = auth.uid())
  or exists (select 1 from customers c where c.id = bookings.customer_id and c.profile_id = auth.uid())
);
create policy "bookings: update barber or customer" on bookings for update using (
  exists (select 1 from barbers b where b.id = bookings.barber_id and b.owner_profile_id = auth.uid())
  or exists (select 1 from customers c where c.id = bookings.customer_id and c.profile_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- customer_preferences ("Haircut Passport") — barber-owned, private to that
-- barber and the customer it describes.
-- ---------------------------------------------------------------------------
create policy "customer_preferences: select" on customer_preferences for select using (
  exists (select 1 from barbers b where b.id = customer_preferences.barber_id and b.owner_profile_id = auth.uid())
  or exists (select 1 from customers c where c.id = customer_preferences.customer_id and c.profile_id = auth.uid())
);
create policy "customer_preferences: barber write" on customer_preferences for insert with check (
  exists (select 1 from barbers b where b.id = customer_preferences.barber_id and b.owner_profile_id = auth.uid())
);
create policy "customer_preferences: barber update" on customer_preferences for update using (
  exists (select 1 from barbers b where b.id = customer_preferences.barber_id and b.owner_profile_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- customer_reference_photos — private by default; readable by the uploading
-- customer and the barber attached to the related booking.
-- ---------------------------------------------------------------------------
create policy "reference_photos: select" on customer_reference_photos for select using (
  exists (select 1 from customers c where c.id = customer_reference_photos.customer_id and c.profile_id = auth.uid())
  or exists (
    select 1 from bookings bk
    join barbers b on b.id = bk.barber_id
    where bk.id = customer_reference_photos.booking_id and b.owner_profile_id = auth.uid()
  )
);
create policy "reference_photos: insert" on customer_reference_photos for insert with check (true);

-- ---------------------------------------------------------------------------
-- reviews — public read (they're meant to display on the barber page),
-- but only insertable by the customer on their own completed booking.
-- ---------------------------------------------------------------------------
create policy "reviews: public select" on reviews for select using (true);
create policy "reviews: customer insert own" on reviews for insert with check (
  exists (
    select 1 from bookings bk
    join customers c on c.id = bk.customer_id
    where bk.id = reviews.booking_id and c.profile_id = auth.uid() and bk.status = 'completed'
  )
);

-- ---------------------------------------------------------------------------
-- subscriptions / payments / notifications — barber-owner only. No public
-- access, no customer access (payments status surfaces via bookings.deposit_status
-- instead, which the customer can already read through their booking).
-- ---------------------------------------------------------------------------
create policy "subscriptions: owner select" on subscriptions for select using (
  exists (select 1 from barbers b where b.id = subscriptions.barber_id and b.owner_profile_id = auth.uid())
);

create policy "payments: owner select" on payments for select using (
  exists (
    select 1 from bookings bk
    join barbers b on b.id = bk.barber_id
    where bk.id = payments.booking_id and b.owner_profile_id = auth.uid()
  )
);

create policy "notifications: recipient select" on notifications for select using (
  (recipient_type = 'barber' and exists (
    select 1 from barbers b where b.id = notifications.recipient_id and b.owner_profile_id = auth.uid()
  ))
  or
  (recipient_type = 'customer' and exists (
    select 1 from customers c where c.id = notifications.recipient_id and c.profile_id = auth.uid()
  ))
);

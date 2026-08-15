-- 0001_init_schema.sql
-- Core tables for the multi-barber booking platform.
-- Run after creating a fresh Supabase project. RLS policies are in 0002_rls_policies.sql —
-- run that one immediately after this one; tables are unprotected until it runs.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth.users row. role distinguishes barbers/customers/admins.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('barber', 'customer', 'admin')),
  full_name text,
  phone text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created, so the app
-- never has to worry about a missing profile. The app also upserts on signup
-- as a belt-and-suspenders measure (see src/api/auth.js) in case this trigger
-- fires before user_metadata is fully available.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- barbers: one row per barber/shop. Public columns are readable by anyone
-- (this is the data the /:username page shows).
-- ---------------------------------------------------------------------------
create table if not exists barbers (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  username text not null unique,
  shop_name text not null,
  tagline text,
  bio text,
  profile_image_url text,
  cover_image_url text,
  phone text,
  location text,
  facebook_url text,
  instagram_url text,
  tiktok_url text,
  timezone text not null default 'Asia/Manila',
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  booking_settings jsonb not null default '{
    "min_advance_minutes": 60,
    "max_advance_days": 30,
    "buffer_minutes": 0,
    "slot_interval_minutes": 15,
    "deposit_required": false,
    "deposit_type": "fixed",
    "deposit_amount": 0,
    "cancellation_notice_hours": 24
  }'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists barbers_owner_profile_id_key on barbers(owner_profile_id);
create index if not exists barbers_username_idx on barbers(lower(username));

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  duration_minutes int not null check (duration_minutes > 0),
  has_styles boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists services_barber_id_idx on services(barber_id);

-- ---------------------------------------------------------------------------
-- hair_styles
-- ---------------------------------------------------------------------------
create table if not exists hair_styles (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  category text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists hair_styles_barber_id_idx on hair_styles(barber_id);

-- ---------------------------------------------------------------------------
-- business_hours: one row per barber per weekday (0 = Sunday .. 6 = Saturday)
-- ---------------------------------------------------------------------------
create table if not exists business_hours (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  is_closed boolean not null default false,
  open_time time not null default '09:00',
  close_time time not null default '18:00',
  unique (barber_id, day_of_week)
);

-- ---------------------------------------------------------------------------
-- blocked_dates
-- ---------------------------------------------------------------------------
create table if not exists blocked_dates (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers(id) on delete cascade,
  date date not null,
  reason text,
  unique (barber_id, date)
);

-- ---------------------------------------------------------------------------
-- customers: profile_id is nullable to support guest bookings (no account).
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);
create index if not exists customers_profile_id_idx on customers(profile_id);

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  service_id uuid not null references services(id),
  hair_style_id uuid references hair_styles(id),
  date date not null,
  start_time time not null,
  duration_minutes int not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  deposit_status text not null default 'not_required' check (deposit_status in ('not_required', 'pending', 'submitted', 'verified')),
  reference_photo_url text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists bookings_barber_date_idx on bookings(barber_id, date);
create index if not exists bookings_customer_id_idx on bookings(customer_id);

-- ---------------------------------------------------------------------------
-- customer_preferences: the "Haircut Passport" backing table.
-- ---------------------------------------------------------------------------
create table if not exists customer_preferences (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  favorite_service_id uuid references services(id),
  favorite_style_id uuid references hair_styles(id),
  barber_notes text,
  visit_count int not null default 0,
  total_spent numeric(10,2) not null default 0,
  last_visit_at timestamptz,
  unique (barber_id, customer_id)
);

-- ---------------------------------------------------------------------------
-- customer_reference_photos
-- ---------------------------------------------------------------------------
create table if not exists customer_reference_photos (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  image_url text not null,
  is_private boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  barber_id uuid not null references barbers(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists reviews_barber_id_idx on reviews(barber_id);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null unique references barbers(id) on delete cascade,
  plan_id text not null default 'free',
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  current_period_end timestamptz
);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  amount numeric(10,2) not null,
  type text not null check (type in ('deposit', 'full')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'refunded')),
  provider_ref text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('barber', 'customer')),
  recipient_id uuid not null,
  type text not null,
  payload jsonb not null default '{}',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on notifications(recipient_type, recipient_id);

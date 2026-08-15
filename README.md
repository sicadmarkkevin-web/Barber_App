# Chair — multi-barber booking platform

A multi-tenant SaaS booking platform for barbers. Each barber gets their own account,
customizable public page (`yourapp.com/username`), and a full customer-facing booking
flow. Built with React + Vite + Supabase (Postgres, Auth, Storage, RLS).

## Current feature set

**Barber side (behind login, at `/dashboard`):**
- Signup, login, logout, username claiming
- Profile: shop name, bio, phone, profile photo, 5 social links
- Services: name, price (₱), duration, "has styles" toggle — full CRUD
- Haircut styles: name, optional photo (themed icon fallback) — full CRUD
- Business hours: per-day open/closed + times, "copy Monday to all weekdays"
- Booking settings: minimum notice, max advance window, buffer time, style-selection
  toggle, manual-confirmation toggle (internal config, not shown publicly)

**Customer side (public, no account needed):**
- Public barber page at `/username` — profile, services, styles, hours, social links
- Full booking flow at `/username/book`: service → style/reference-photo/no-preference
  → calendar → available times → your details → review → confirm → success
- Real-time availability calculated server-side (business hours, buffer, existing
  bookings, minimum notice, max advance window all respected)
- Optional reference-photo upload (private storage, never public)

**Not yet built:** barber appointment dashboard (barbers can't see/manage incoming
bookings yet), customer-initiated cancel/reschedule, notifications, payments, reviews,
subscriptions/monetization, admin panel, social link previews (Open Graph).

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project. Pick a region close to
   your users (e.g. Southeast Asia for a PH-focused launch).
2. **Project Settings → API** → copy the **Project URL** and **anon public** key.
   Never put the `service_role` key in frontend code — this app never needs it.

## 2. Run the migrations, in order

Open **SQL Editor** in the Supabase dashboard and run each file in
`supabase/migrations/`, in this exact order:

| # | File | What it does |
|---|------|---------------|
| 1 | `0001_init_schema.sql` | All tables |
| 2 | `0002_rls_policies.sql` | Row Level Security — tables are unprotected between #1 and this, run back-to-back |
| 3 | `0003_create_booking_rpc.sql` | Original booking-creation function |
| 4 | `0004_storage.sql` | 3 storage buckets (profile-images, style-images, reference-photos) + policies |
| 5 | `0005_grants.sql` | **Required.** Tables made via SQL Editor don't get Supabase's automatic anon/authenticated grants — without this every query 403s regardless of correct RLS |
| 6 | `0006_phase2a_profile.sql` | Adds `messenger_url`, `website_url` to barbers |
| 7 | `0007_phase2c_styles.sql` | Adds `icon` to hair_styles |
| 8 | `0008_phase3a_booking_foundation.sql` | Booking security hardening: style-ownership check, real double-booking `EXCLUDE` constraint, `updated_at`, tightened RLS |
| 9 | `0009_phase3b_availability.sql` | The `get_available_slots` function — the whole availability engine |
| 10 | `0010_phase3c_reference_photos.sql` | Fixes reference-photo storage path/policy, adds photo-ownership check to `create_booking` |

If you have the Supabase CLI installed, `supabase db push` applies all ten in order
instead of pasting them manually.

## 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from step 1.

## 4. Install and run

```bash
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`).

## 5. Smoke test

1. `/signup` → create a barber account → you land on `/onboarding` → pick a username.
2. You land on `/dashboard` — set up profile, services, styles, hours, booking
   settings from the cards there.
3. Open `/yourusername` in an incognito window — confirm everything you set up
   shows up publicly.
4. Click **Book an appointment** → walk through the full flow → confirm the booking
   succeeds and you land on the success screen.
5. `/doesnotexist` → should show a proper 404, not an error.

## What's next

Barber appointment dashboard (see/confirm/cancel incoming bookings, view reference
photos) is the natural next phase. See the chat history for the full running list of
what's been built and what's still outstanding.

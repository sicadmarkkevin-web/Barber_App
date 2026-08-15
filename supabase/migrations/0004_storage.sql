-- 0004_storage.sql
-- Buckets + policies for images. Upload path convention (enforced by the app,
-- not the database): the first path segment is always the owning barber_id
-- or customer_id, e.g. "profile-images/<barber_id>/avatar.jpg" — policies
-- below check that segment against ownership.

insert into storage.buckets (id, name, public)
values
  ('profile-images', 'profile-images', true),
  ('style-images', 'style-images', true),
  ('reference-photos', 'reference-photos', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- profile-images / style-images — public read (they're shown on the public
-- booking page), write restricted to the owning barber.
-- ---------------------------------------------------------------------------
create policy "public-images: public read"
  on storage.objects for select
  using (bucket_id in ('profile-images', 'style-images'));

create policy "public-images: owner write"
  on storage.objects for insert
  with check (
    bucket_id in ('profile-images', 'style-images')
    and exists (
      select 1 from barbers b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_profile_id = auth.uid()
    )
  );

create policy "public-images: owner update"
  on storage.objects for update
  using (
    bucket_id in ('profile-images', 'style-images')
    and exists (
      select 1 from barbers b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_profile_id = auth.uid()
    )
  );

create policy "public-images: owner delete"
  on storage.objects for delete
  using (
    bucket_id in ('profile-images', 'style-images')
    and exists (
      select 1 from barbers b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- reference-photos — private. Readable by the customer who uploaded it, or
-- the barber attached to the related booking. Path: "<customer_id>/<file>".
-- ---------------------------------------------------------------------------
create policy "reference-photos: owner or barber read"
  on storage.objects for select
  using (
    bucket_id = 'reference-photos'
    and (
      exists (
        select 1 from customers c
        where c.id::text = (storage.foldername(name))[1] and c.profile_id = auth.uid()
      )
      or exists (
        select 1 from bookings bk
        join barbers b on b.id = bk.barber_id
        join customers c on c.id = bk.customer_id
        where c.id::text = (storage.foldername(name))[1] and b.owner_profile_id = auth.uid()
      )
    )
  );

create policy "reference-photos: anyone uploads their own"
  on storage.objects for insert
  with check (bucket_id = 'reference-photos');

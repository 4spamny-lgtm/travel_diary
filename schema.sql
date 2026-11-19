-- Supabase Dashboard > SQL Editor에서 한 번 실행합니다.
-- 실행 전 반드시 기존 여행기록을 JSON으로 백업하세요.
create table if not exists public.trips (
 id text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 region text not null,
 title text not null,
 visit_date date,
 tag text not null default '',
 note text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.trip_photos (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 trip_id text not null references public.trips(id) on delete cascade,
 storage_path text not null unique,
 sort_order int not null default 0
);
create index if not exists trip_photos_trip_idx on public.trip_photos(trip_id);
create table if not exists public.region_colors (
 user_id uuid not null references auth.users(id) on delete cascade,
 region text not null,
 color text not null,
 primary key(user_id, region)
);

alter table public.trips enable row level security;
alter table public.trip_photos enable row level security;
alter table public.region_colors enable row level security;

drop policy if exists own_trips on public.trips;
create policy own_trips on public.trips for all to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id);
drop policy if exists own_photos on public.trip_photos;
create policy own_photos on public.trip_photos for all to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id);
drop policy if exists own_colors on public.region_colors;
create policy own_colors on public.region_colors for all to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id);

-- 사진은 공개 URL이 아닌 비공개 저장소에 보관됩니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 values ('travel-photos', 'travel-photos', false, 5242880, array['image/jpeg'])
 on conflict (id) do update set public = false,
 file_size_limit = excluded.file_size_limit,
 allowed_mime_types = excluded.allowed_mime_types;

-- 경로: 로그인사용자UID/여행ID/사진UUID.jpg
-- 읽기, 업로드, 삭제 모두 본인 UID 폴더만 허용합니다.
drop policy if exists travel_storage_read on storage.objects;
create policy travel_storage_read on storage.objects for select to authenticated
 using (bucket_id = 'travel-photos'
   and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists travel_storage_insert on storage.objects;
create policy travel_storage_insert on storage.objects for insert to authenticated
 with check (bucket_id = 'travel-photos'
   and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists travel_storage_delete on storage.objects;
create policy travel_storage_delete on storage.objects for delete to authenticated
 using (bucket_id = 'travel-photos'
   and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 자동 갱신 알림을 위한 publication
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trips')
 THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.trips; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_photos')
 THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_photos; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'region_colors')
 THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.region_colors; END IF;
END $$;

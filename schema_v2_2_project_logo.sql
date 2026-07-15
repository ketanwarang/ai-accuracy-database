-- ============================================================
-- Project brand logos
-- Run in Supabase SQL Editor after schema_v2_display_name.sql.
-- Adds a storage bucket for logo images + a logo_url column on
-- projects. Purely additive.
-- ============================================================

-- 1. Column to store the public URL of the uploaded logo.
alter table projects add column if not exists logo_url text;

-- 2. Storage bucket for logo images. Public read (logos are small,
-- non-sensitive brand images shown throughout the UI); writes are
-- gated to project members below.
insert into storage.buckets (id, name, public)
values ('project-logos', 'project-logos', true)
on conflict (id) do nothing;

-- 3. RLS on storage.objects for this bucket. Files are stored as
-- "<project_id>/logo.<ext>", so (storage.foldername(name))[1] is the
-- project_id — reuses the existing can_access_project() function.
drop policy if exists "project_logos_select" on storage.objects;
drop policy if exists "project_logos_insert" on storage.objects;
drop policy if exists "project_logos_update" on storage.objects;
drop policy if exists "project_logos_delete" on storage.objects;

create policy "project_logos_select" on storage.objects for select
  using (bucket_id = 'project-logos');

create policy "project_logos_insert" on storage.objects for insert
  with check (
    bucket_id = 'project-logos'
    and can_access_project(((storage.foldername(name))[1])::uuid)
  );

create policy "project_logos_update" on storage.objects for update
  using (
    bucket_id = 'project-logos'
    and can_access_project(((storage.foldername(name))[1])::uuid)
  );

create policy "project_logos_delete" on storage.objects for delete
  using (
    bucket_id = 'project-logos'
    and can_access_project(((storage.foldername(name))[1])::uuid)
  );

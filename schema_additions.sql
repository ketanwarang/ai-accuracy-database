-- ============================================================
-- Schema additions for new features
-- Run in Supabase SQL Editor after complete_migration.sql
-- ============================================================

-- 1. Add uploaded_by to snapshots table
alter table snapshots add column if not exists uploaded_by text;

-- 2. Create snapshot_comments table for annotations/notes
create table if not exists snapshot_comments (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references snapshots(id) on delete cascade not null,
  author_email text not null,
  body text not null,
  created_at timestamptz default now()
);

-- 3. Enable RLS on snapshot_comments
alter table snapshot_comments enable row level security;

-- 4. Policies: anyone who can see the snapshot can see/add comments
drop policy if exists "snapshot_comments_select" on snapshot_comments;
drop policy if exists "snapshot_comments_insert" on snapshot_comments;
drop policy if exists "snapshot_comments_delete" on snapshot_comments;

create policy "snapshot_comments_select" on snapshot_comments for select
  using (exists (
    select 1 from snapshots s where s.id = snapshot_id
    and can_access_project(s.project_id)
  ));

create policy "snapshot_comments_insert" on snapshot_comments for insert
  with check (exists (
    select 1 from snapshots s where s.id = snapshot_id
    and can_access_project(s.project_id)
  ));

create policy "snapshot_comments_delete" on snapshot_comments for delete
  using (
    author_email = auth_email()
    or is_super_admin()
  );

-- ============================================================
-- V2.0 — Display Name toggle + project-scoped upload
-- Run in Supabase SQL Editor after schema_additions.sql.
-- Purely additive: no existing table's data is modified, only
-- new tables/columns. Existing category_metrics/confusion_pairs
-- rows get view_mode='raw' via the column default — their
-- numeric values are untouched.
-- ============================================================

-- 1. CGC sheet mapping: one row per class_name -> display_name,
-- unique per project. Replaced wholesale on each CGC re-upload.
create table if not exists project_cgc_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  class_name text not null,
  display_name text not null,
  created_at timestamptz default now(),
  unique (project_id, class_name)
);

alter table project_cgc_mappings enable row level security;

drop policy if exists "cgc_mappings_select" on project_cgc_mappings;
drop policy if exists "cgc_mappings_insert" on project_cgc_mappings;
drop policy if exists "cgc_mappings_delete" on project_cgc_mappings;

create policy "cgc_mappings_select" on project_cgc_mappings for select
  using (can_access_project(project_id));

create policy "cgc_mappings_insert" on project_cgc_mappings for insert
  with check (can_access_project(project_id));

create policy "cgc_mappings_delete" on project_cgc_mappings for delete
  using (can_access_project(project_id));

-- 2. Per-row annotation data, minimal columns needed to recompute
-- accuracy metrics later (e.g. when a CGC sheet is uploaded/changed).
-- Populated at upload time going forward; NOT backfilled for
-- snapshots that already exist today (their raw rows were already
-- discarded under the pre-V2.0 design).
create table if not exists snapshot_annotations (
  id bigint generated always as identity primary key,
  snapshot_id uuid references snapshots(id) on delete cascade not null,
  category_name text,
  annotation_type text,
  shop_key text,
  row_date text,
  gpd text,
  wrong_group text,
  wrong_class text,
  actual_group text,
  predicted_group text,
  actual_class text,
  predicted_class text,
  openset_actual text,
  openset_prediction text,
  sticker_value_actual text,
  sticker_value_predicted text,
  image_id text
);

create index if not exists snapshot_annotations_snapshot_id_idx on snapshot_annotations(snapshot_id);

alter table snapshot_annotations enable row level security;

drop policy if exists "snapshot_annotations_select" on snapshot_annotations;
drop policy if exists "snapshot_annotations_insert" on snapshot_annotations;
drop policy if exists "snapshot_annotations_delete" on snapshot_annotations;

create policy "snapshot_annotations_select" on snapshot_annotations for select
  using (exists (
    select 1 from snapshots s where s.id = snapshot_id
    and can_access_project(s.project_id)
  ));

create policy "snapshot_annotations_insert" on snapshot_annotations for insert
  with check (exists (
    select 1 from snapshots s where s.id = snapshot_id
    and can_access_project(s.project_id)
  ));

create policy "snapshot_annotations_delete" on snapshot_annotations for delete
  using (exists (
    select 1 from snapshots s where s.id = snapshot_id
    and can_access_project(s.project_id)
  ));

-- 3. Tag existing metric tables with which view they belong to.
-- Default 'raw' means every existing row keeps its current meaning
-- with zero data change — this just labels what's already there.
alter table category_metrics add column if not exists view_mode text not null default 'raw';
alter table confusion_pairs add column if not exists view_mode text not null default 'raw';

-- Idempotent constraint add (Postgres has no "add constraint if not exists")
do $$ begin
  alter table category_metrics add constraint category_metrics_view_mode_check check (view_mode in ('raw','display'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table confusion_pairs add constraint confusion_pairs_view_mode_check check (view_mode in ('raw','display'));
exception when duplicate_object then null;
end $$;

-- Composite indexes to keep the common query (snapshot + view_mode)
-- fast now that each snapshot may have two label-sets of rows.
create index if not exists category_metrics_snapshot_view_idx on category_metrics(snapshot_id, view_mode);
create index if not exists confusion_pairs_snapshot_view_idx on confusion_pairs(snapshot_id, view_mode);

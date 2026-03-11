create schema if not exists ortho;

grant usage on schema ortho to service_role;

create or replace function ortho.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists ortho.conditions (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  aliases text not null default '',
  body_region text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists ortho.images (
  id bigint generated always as identity primary key,
  condition_id bigint not null references ortho.conditions(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null default '',
  view_label text not null default '',
  sort_order integer not null default 0,
  asset_url text not null default '',
  thumb_url text not null default '',
  source text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists conditions_body_region_idx on ortho.conditions (body_region, name);
create index if not exists images_condition_sort_idx on ortho.images (condition_id, sort_order, id);

drop trigger if exists set_conditions_updated_at on ortho.conditions;
create trigger set_conditions_updated_at
before update on ortho.conditions
for each row
execute function ortho.set_updated_at();

drop trigger if exists set_images_updated_at on ortho.images;
create trigger set_images_updated_at
before update on ortho.images
for each row
execute function ortho.set_updated_at();

grant select, insert, update, delete on all tables in schema ortho to service_role;
grant usage, select on all sequences in schema ortho to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ortho-images',
  'ortho-images',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

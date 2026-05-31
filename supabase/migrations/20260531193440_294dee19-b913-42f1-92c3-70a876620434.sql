create table public.builder_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope text not null default 'section' check (scope in ('section')),
  data jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.builder_templates to authenticated;
grant all on public.builder_templates to service_role;

alter table public.builder_templates enable row level security;

create policy "templates_read_all" on public.builder_templates
  for select to authenticated using (true);

create policy "templates_insert_own" on public.builder_templates
  for insert to authenticated with check (auth.uid() = created_by);

create policy "templates_delete_own" on public.builder_templates
  for delete to authenticated using (auth.uid() = created_by);

create index builder_templates_created_at_idx on public.builder_templates (created_at desc);
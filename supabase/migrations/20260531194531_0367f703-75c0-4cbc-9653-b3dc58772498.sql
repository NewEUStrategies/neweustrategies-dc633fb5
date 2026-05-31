-- Drop legacy rows that have no tenant context
delete from public.builder_templates where true;

-- Add tenant_id with default from current_tenant_id()
alter table public.builder_templates
  add column tenant_id uuid not null default public.current_tenant_id();

-- Relax scope constraint to allow page/widget templates later
alter table public.builder_templates
  drop constraint if exists builder_templates_scope_check;
alter table public.builder_templates
  add constraint builder_templates_scope_check
  check (scope in ('section','page','widget'));

-- Replace policies with tenant-scoped versions
drop policy if exists "templates_read_all" on public.builder_templates;
drop policy if exists "templates_insert_own" on public.builder_templates;
drop policy if exists "templates_delete_own" on public.builder_templates;

create policy "templates_read_tenant" on public.builder_templates
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "templates_insert_tenant" on public.builder_templates
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and auth.uid() = created_by
  );

create policy "templates_delete_own" on public.builder_templates
  for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and auth.uid() = created_by
  );

-- Replace index by tenant+date
drop index if exists builder_templates_created_at_idx;
create index builder_templates_tenant_created_idx
  on public.builder_templates (tenant_id, created_at desc);
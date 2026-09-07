alter table public.crm_companies
  add column if not exists tax_id text;

comment on column public.crm_companies.tax_id is
  'Numer podatkowy firmy (NIP / VAT ID) uzywany na fakturach.';

create index if not exists crm_companies_tenant_tax_id_idx
  on public.crm_companies (tenant_id, tax_id)
  where tax_id is not null;
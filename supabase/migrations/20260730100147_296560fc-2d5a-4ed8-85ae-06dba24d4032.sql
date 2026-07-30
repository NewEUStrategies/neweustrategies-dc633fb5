alter table public.subscriptions
  add column if not exists trial_ends_at timestamptz,
  add column if not exists last_dunning_transaction_id text,
  add column if not exists last_dunning_at timestamptz;

alter table public.payment_webhook_events
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retried_at timestamptz,
  add column if not exists retried_by uuid references auth.users(id) on delete set null;

comment on column public.subscriptions.trial_ends_at is 'Koniec okresu próbnego wg operatora płatności (null = brak triala).';
comment on column public.subscriptions.last_dunning_transaction_id is 'Ostatnia transakcja, dla której uruchomiono windykację - blokuje duplikaty transaction.payment_failed / transaction.past_due.';
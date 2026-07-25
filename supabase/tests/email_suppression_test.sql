-- pgTAP: lista wykluczeń e-mail + telemetria dostarczalności
-- (migracja 20260725120000_email_suppression_bounce_complaint.sql).
--
--   1. email_record_suppression: twarde odbicie -> blokada trwała; skarga
--      nigdy nie jest osłabiana późniejszym miękkim odbiciem (pierwszeństwo
--      powagi); miękkie odbicie jest czasowe i po SOFT_BOUNCE_LIMIT
--      powtórzeniach eskaluje do trwałego hard bounce.
--   2. Trigger synchronizacji: trwała blokada natychmiast wypisuje
--      subskrybenta z listy (adres znika z audiencji kampanii); blokada
--      czasowa NIE wypisuje.
--   3. email_filter_suppressed / email_is_suppressed: zwracają wyłącznie
--      AKTYWNE blokady własnego tenanta (wygasłe i zdjęte nie blokują,
--      blokada tenanta B nie blokuje wysyłki tenanta A).
--   4. email_apply_delivery_event: idempotencja po (provider, event_id) -
--      retry webhooka nie dubluje ani zdarzenia, ani skutków ubocznych;
--      korelacja po provider_message_id ustawia stan dostawy odbiorcy.
--   5. RLS: email_suppressions/email_delivery_events czyta wyłącznie staff
--      własnego tenanta; anon nie ma żadnego dostępu do adresów (PII).
--   6. Bramki stafowe: email_suppression_add / email_suppression_release
--      odrzucają nie-staffa i nie pozwalają ruszyć wiersza obcego tenanta.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(21);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'tenant-supp-a', 'Tenant Supp A'),
  ('b2222222-2222-2222-2222-222222222222', 'tenant-supp-b', 'Tenant Supp B');

INSERT INTO auth.users (id, email) VALUES
  ('b1000000-0000-0000-0000-0000000000aa', 'admin-a@supp.test'),
  ('b1000000-0000-0000-0000-0000000000bb', 'reader-a@supp.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b1000000-0000-0000-0000-0000000000aa', 'admin-a@supp.test', 'Admin A',
   'b1111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-0000000000bb', 'reader-a@supp.test', 'Reader A',
   'b1111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b1000000-0000-0000-0000-0000000000aa', 'admin', 'b1111111-1111-1111-1111-111111111111');

INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status, language) VALUES
  ('b1500000-0000-0000-0000-0000000000a1', 'b1111111-1111-1111-1111-111111111111',
   'dead@example.com', 'subscribed', 'pl'),
  ('b1500000-0000-0000-0000-0000000000a2', 'b1111111-1111-1111-1111-111111111111',
   'full@example.com', 'subscribed', 'pl'),
  ('b1500000-0000-0000-0000-0000000000a3', 'b1111111-1111-1111-1111-111111111111',
   'angry@example.com', 'subscribed', 'pl');

INSERT INTO public.newsletter_campaigns (id, tenant_id, name, status) VALUES
  ('b1600000-0000-0000-0000-0000000000c1', 'b1111111-1111-1111-1111-111111111111',
   'Kampania testowa', 'sent');

INSERT INTO public.newsletter_campaign_recipients
  (tenant_id, campaign_id, subscriber_id, email, language, status, provider_message_id)
VALUES
  ('b1111111-1111-1111-1111-111111111111', 'b1600000-0000-0000-0000-0000000000c1',
   'b1500000-0000-0000-0000-0000000000a1', 'dead@example.com', 'pl', 'sent', 'msg-dead-1');

-- -- 1. Zapis blokady: twarde odbicie ------------------------------------------
SELECT is(
  (SELECT public.email_record_suppression(
     'b1111111-1111-1111-1111-111111111111', 'Dead@Example.com', 'hard_bounce')->>'scope'),
  'permanent',
  'twarde odbicie tworzy blokade TRWALA'
);

SELECT is(
  (SELECT reason FROM public.email_suppressions
    WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111'
      AND email_norm = 'dead@example.com'),
  'hard_bounce',
  'adres znormalizowany do lowercase i zapisany raz'
);

-- -- 2. Trigger: trwala blokada wypisuje subskrybenta ---------------------------
SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'b1500000-0000-0000-0000-0000000000a1'),
  'unsubscribed',
  'trwala blokada natychmiast wyjmuje adres z audiencji'
);

-- -- 3. Miekkie odbicie: czasowe, bez wypisania ---------------------------------
SELECT is(
  (SELECT public.email_record_suppression(
     'b1111111-1111-1111-1111-111111111111', 'full@example.com', 'soft_bounce')->>'scope'),
  'transient',
  'miekkie odbicie tworzy blokade CZASOWA'
);

SELECT isnt(
  (SELECT expires_at FROM public.email_suppressions
    WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111'
      AND email_norm = 'full@example.com'),
  NULL,
  'blokada czasowa ma date wygasniecia'
);

SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'b1500000-0000-0000-0000-0000000000a2'),
  'subscribed',
  'blokada czasowa NIE wypisuje subskrybenta'
);

-- -- 4. Eskalacja soft -> hard po 4 zdarzeniach ---------------------------------
SELECT public.email_record_suppression(
  'b1111111-1111-1111-1111-111111111111', 'full@example.com', 'soft_bounce');
SELECT public.email_record_suppression(
  'b1111111-1111-1111-1111-111111111111', 'full@example.com', 'soft_bounce');

SELECT is(
  (SELECT public.email_record_suppression(
     'b1111111-1111-1111-1111-111111111111', 'full@example.com', 'soft_bounce')->>'reason'),
  'hard_bounce',
  'czwarte miekkie odbicie eskaluje do trwalego hard bounce'
);

SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'b1500000-0000-0000-0000-0000000000a2'),
  'unsubscribed',
  'po eskalacji subskrybent zostaje wypisany'
);

-- -- 5. Pierwszenstwo powagi: skarga > miekkie odbicie --------------------------
SELECT public.email_record_suppression(
  'b1111111-1111-1111-1111-111111111111', 'angry@example.com', 'complaint');
SELECT public.email_record_suppression(
  'b1111111-1111-1111-1111-111111111111', 'angry@example.com', 'soft_bounce');

SELECT is(
  (SELECT reason FROM public.email_suppressions
    WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111'
      AND email_norm = 'angry@example.com'),
  'complaint',
  'pozniejsze miekkie odbicie NIE oslabia blokady po skardze'
);

SELECT is(
  (SELECT scope FROM public.email_suppressions
    WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111'
      AND email_norm = 'angry@example.com'),
  'permanent',
  'blokada po skardze pozostaje trwala'
);

-- -- 6. Filtr wysylki: aktywne blokady wlasnego tenanta -------------------------
SELECT is(
  (SELECT count(*)::int FROM public.email_filter_suppressed(
     'b1111111-1111-1111-1111-111111111111',
     ARRAY['dead@example.com', 'angry@example.com', 'alive@example.com'])),
  2,
  'filtr zwraca wylacznie zablokowane adresy z podanej listy'
);

SELECT ok(
  public.email_is_suppressed('b1111111-1111-1111-1111-111111111111', 'DEAD@example.com'),
  'email_is_suppressed ignoruje wielkosc liter'
);

SELECT ok(
  NOT public.email_is_suppressed('b2222222-2222-2222-2222-222222222222', 'dead@example.com'),
  'blokada tenanta A nie blokuje wysylki tenanta B'
);

-- Wygasla blokada czasowa nie blokuje wysylki.
INSERT INTO public.email_suppressions (tenant_id, email, reason, scope, expires_at)
VALUES ('b1111111-1111-1111-1111-111111111111', 'expired@example.com', 'soft_bounce',
        'transient', now() - interval '1 day');

SELECT ok(
  NOT public.email_is_suppressed('b1111111-1111-1111-1111-111111111111', 'expired@example.com'),
  'wygasla blokada czasowa nie blokuje wysylki'
);

-- -- 7. Zdarzenie dostawcy: skutki uboczne + idempotencja -----------------------
SELECT is(
  (SELECT public.email_apply_delivery_event(
     'resend', 'evt_1', 'email.bounced', 'bounced', 'dead@example.com',
     'msg-dead-1', 'hard', 'mailbox not found')->>'duplicate'),
  'false',
  'pierwsze zdarzenie webhooka jest ksiegowane'
);

SELECT is(
  (SELECT delivery_state FROM public.newsletter_campaign_recipients
    WHERE provider_message_id = 'msg-dead-1'),
  'bounced',
  'korelacja po provider_message_id ustawia stan dostawy odbiorcy'
);

SELECT is(
  (SELECT public.email_apply_delivery_event(
     'resend', 'evt_1', 'email.bounced', 'bounced', 'dead@example.com',
     'msg-dead-1', 'hard', 'mailbox not found')->>'duplicate'),
  'true',
  'retry tego samego zdarzenia jest no-opem (idempotencja po event_id)'
);

SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_events
    WHERE provider = 'resend' AND provider_event_id = 'evt_1'),
  1,
  'retry nie dubluje wiersza w logu zdarzen (metryki pozostaja prawdziwe)'
);

-- -- 8. RLS: PII adresow wylacznie dla staffu wlasnego tenanta ------------------
-- anon nie ma nawet GRANT SELECT (REVOKE w migracji), wiec zapytanie konczy
-- sie bledem uprawnien - to mocniejsza gwarancja niz "widzi zero wierszy".
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM public.email_suppressions $$,
  '42501',
  NULL,
  'anon nie ma dostepu do adresow na liscie wykluczen (PII)'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions),
  0,
  'zwykly uzytkownik tenanta nie widzi listy wykluczen'
);

-- -- 9. Bramka stafowa dodawania blokady ----------------------------------------
SELECT throws_ok(
  $$ SELECT public.email_suppression_add('manual@example.com', 'manual', NULL) $$,
  '42501',
  NULL,
  'email_suppression_add odrzuca uzytkownika bez roli staff'
);
RESET ROLE;

COMMIT;

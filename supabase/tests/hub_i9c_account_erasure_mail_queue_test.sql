-- pgTAP: RODO po usunięciu konta - poczta w kolejce (I9c-X1, migracja
-- 20261020160900; polecenie właściciela 2026-10-20 „ok rozumiem, optymalizuj").
--
-- CO PRZYPINA:
--   * warstwa 1 (`_hub_account_erase_mail_queue` z wyzwalacza A2): niewysłane
--     kroki ścieżek ZAPISU KONTA (marketing i usługa) i digest konta znikają
--     z kolejki `transactional_emails`; dziennik dostaje `suppressed`
--     z powodem `cancelled:account_deleted`, adres każdego wpisu tej
--     wiadomości -> `[redacted]`, najemca z wpisu `pending`;
--   * zostają: poczta transakcyjna konta (np. ostrzeżenie o płatności),
--     potwierdzenie newslettera (zgoda niezależna od konta), krok ścieżki
--     kontaktu CRM bez konta (A2: osobna czynność CRM) i digest innej osoby;
--     powtórka zwraca 0;
--   * warstwa 2 (`email_queue_send_recheck`, dren przed wysyłką): zapis
--     zakończony wyjściem, zapis usunięty, brak zgody marketingowej (wypis
--     w trakcie cyklu), konto usunięte, digest wyłączony -> `skipped:…`;
--     usługa bez zgody marketingowej, poczta spoza listy i klucz spoza
--     konwencji -> `ok`;
--   * lista etykiet SQL = lustro TS; ACL (dren - wyłącznie service_role).
--
-- Kolejka przez API pgmq (`enqueue_email`, `pgmq.read` z czasem
-- niewidzialności 0 - nic nie chowa), bez nazw tabel rozszerzenia.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9c_account_erasure_mail_queue
BEGIN;
SELECT plan(16);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name)
VALUES ('19c10000-0000-4000-8000-0000000000a1', 'i9c-poczta', 'I9c Poczta');

-- U - konto usuwane; K - konto zostające.
INSERT INTO auth.users (id, email) VALUES
  ('19c10000-0000-4000-8000-00000000d001', 'usuwana@i9c-poczta.test'),
  ('19c10000-0000-4000-8000-00000000d002', 'zostaje@i9c-poczta.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19c10000-0000-4000-8000-00000000d001', 'usuwana@i9c-poczta.test', 'Usuwana', '19c10000-0000-4000-8000-0000000000a1'),
  ('19c10000-0000-4000-8000-00000000d002', 'zostaje@i9c-poczta.test', 'Zostaje', '19c10000-0000-4000-8000-0000000000a1');
INSERT INTO public.notification_preferences (user_id, tenant_id, email_digest) VALUES
  ('19c10000-0000-4000-8000-00000000d001', '19c10000-0000-4000-8000-0000000000a1', 'daily'),
  ('19c10000-0000-4000-8000-00000000d002', '19c10000-0000-4000-8000-0000000000a1', 'daily')
ON CONFLICT (user_id) DO UPDATE SET email_digest = EXCLUDED.email_digest;

-- Leady: konta U i K (z wyzwalacza profilu, S4 - asekuracja, gdyby go nie
-- było) oraz kontakt X bez konta; wszystkie ze zgodą marketingową.
INSERT INTO public.crm_leads (tenant_id, email, email_norm, user_id)
SELECT p.tenant_id, p.email, p.email, p.id FROM public.profiles p
 WHERE p.tenant_id = '19c10000-0000-4000-8000-0000000000a1'
   AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.tenant_id = p.tenant_id AND l.email_norm = p.email);
INSERT INTO public.crm_leads (tenant_id, email, email_norm)
VALUES ('19c10000-0000-4000-8000-0000000000a1', 'kontakt@i9c-poczta.test', 'kontakt@i9c-poczta.test');
UPDATE public.crm_leads SET marketing_consent = true WHERE tenant_id = '19c10000-0000-4000-8000-0000000000a1';

CREATE FUNCTION pg_temp.lead(p_email text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT l.id FROM public.crm_leads l
   WHERE l.tenant_id = '19c10000-0000-4000-8000-0000000000a1' AND l.email_norm = p_email
$$;

-- Ścieżka marketingowa i usługowa; zapisy: konta U (marketing), kontaktu X
-- (marketing i usługa), konta K.
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category, legal_basis) VALUES
  ('19c10000-0000-4000-8000-0000000010a1', '19c10000-0000-4000-8000-0000000000a1', 'i9c-marketing', 'Marketing',
   'active', 'marketing', NULL),
  ('19c10000-0000-4000-8000-0000000010a2', '19c10000-0000-4000-8000-0000000000a1', 'i9c-usluga', 'Usługa',
   'active', 'service', 'Umowa o dostęp do treści');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum,
                                     published_at) VALUES
  ('19c10000-0000-4000-8000-0000000011a1', '19c10000-0000-4000-8000-0000000000a1', '19c10000-0000-4000-8000-0000000010a1', 1,
   'account.registered.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
   'x', now() - interval '1 hour'),
  ('19c10000-0000-4000-8000-0000000011a2', '19c10000-0000-4000-8000-0000000000a1', '19c10000-0000-4000-8000-0000000010a2', 1,
   'account.registered.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
   'x', now() - interval '1 hour');
INSERT INTO public.journey_enrollments (id, tenant_id, journey_id, version_id, lead_id, user_id, status,
                                        trigger_snapshot, enrollment_key) VALUES
  ('19c10000-0000-4000-8000-0000000012a1', '19c10000-0000-4000-8000-0000000000a1', '19c10000-0000-4000-8000-0000000010a1',
   '19c10000-0000-4000-8000-0000000011a1', pg_temp.lead('usuwana@i9c-poczta.test'), '19c10000-0000-4000-8000-00000000d001',
   'waiting', '{}', 'u-1'),
  ('19c10000-0000-4000-8000-0000000012a2', '19c10000-0000-4000-8000-0000000000a1', '19c10000-0000-4000-8000-0000000010a1',
   '19c10000-0000-4000-8000-0000000011a1', pg_temp.lead('kontakt@i9c-poczta.test'), NULL,
   'waiting', '{}', 'x-1'),
  ('19c10000-0000-4000-8000-0000000012a3', '19c10000-0000-4000-8000-0000000000a1', '19c10000-0000-4000-8000-0000000010a2',
   '19c10000-0000-4000-8000-0000000011a2', pg_temp.lead('kontakt@i9c-poczta.test'), NULL,
   'waiting', '{}', 'x-2');

-- Producent poczty (`enqueueRawEmail`): wpis `pending`, potem `enqueue_email`
-- z kluczem idempotencji producenta.
CREATE FUNCTION pg_temp.queue_mail(p_message_id text, p_to text, p_label text, p_key text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, tenant_id)
  VALUES (p_message_id, p_label, p_to, 'pending', '19c10000-0000-4000-8000-0000000000a1');
  PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
    'message_id', p_message_id, 'to', p_to, 'subject', 'Temat', 'html', '<p>Treść</p>', 'text', 'Treść',
    'label', p_label, 'idempotency_key', p_key, 'tenant_id', '19c10000-0000-4000-8000-0000000000a1',
    'queued_at', now()));
END $$;

SELECT pg_temp.queue_mail('i9c-m1', 'usuwana@i9c-poczta.test', 'journey',
                          'journey:19c10000-0000-4000-8000-0000000012a1:email-1');
SELECT pg_temp.queue_mail('i9c-m2', 'usuwana@i9c-poczta.test', 'journey_service',
                          'journey:19c10000-0000-4000-8000-0000000012a1:email-2');
SELECT pg_temp.queue_mail('i9c-m3', 'usuwana@i9c-poczta.test', 'digest_daily',
                          'digest:daily:19c10000-0000-4000-8000-00000000d001:2026-10-20');
SELECT pg_temp.queue_mail('i9c-m4', 'usuwana@i9c-poczta.test', 'payment_failed', 'invoice:i9c:1');
SELECT pg_temp.queue_mail('i9c-m5', 'kontakt@i9c-poczta.test', 'journey',
                          'journey:19c10000-0000-4000-8000-0000000012a2:email-1');
SELECT pg_temp.queue_mail('i9c-m6', 'zostaje@i9c-poczta.test', 'digest_daily',
                          'digest:daily:19c10000-0000-4000-8000-00000000d002:2026-10-20');
SELECT pg_temp.queue_mail('i9c-m7', 'usuwana@i9c-poczta.test', 'newsletter_confirmed', 'newsletter:i9c:1');

-- Identyfikatory wiadomości widocznych w kolejce (czas niewidzialności 0).
CREATE FUNCTION pg_temp.queued() RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(q.message ->> 'message_id' ORDER BY q.message ->> 'message_id'), ARRAY[]::text[])
    FROM pgmq.read('transactional_emails', 0, 1000) q
   WHERE q.message ->> 'message_id' LIKE 'i9c-m%'
$$;

-- 1. Lista etykiet = lustro TS (`ACCOUNT_BOUND_EMAIL_LABELS`).
SELECT is(public._hub_account_bound_email_labels(),
          ARRAY['journey', 'journey_service', 'journey_test', 'digest_daily', 'digest_weekly']::text[],
          'etykiety poczty związanej z kontem albo zapisem (lustro TS)');

-- 2. Fikstura: siedem wiadomości w kolejce.
SELECT is(pg_temp.queued(), ARRAY['i9c-m1', 'i9c-m2', 'i9c-m3', 'i9c-m4', 'i9c-m5', 'i9c-m6', 'i9c-m7'],
          'fikstura: kolejka ma krok ścieżki (marketing i usługa), digest, transakcyjny, newsletter, kontakt CRM, cudzy digest');

-- ── Usunięcie konta U (wyzwalacze RODO włączone) ────────────────────────────
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_retain_accounting;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_revenue;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_hub;
DELETE FROM auth.users WHERE id = '19c10000-0000-4000-8000-00000000d001';

-- 3. Warstwa 1: z kolejki znikają kroki ścieżki zapisu konta i digest konta.
SELECT is(pg_temp.queued(), ARRAY['i9c-m4', 'i9c-m5', 'i9c-m6', 'i9c-m7'],
          'po usunięciu: krok ścieżki (marketing i usługa) i digest konta anulowane; transakcyjny, newsletter, kontakt CRM i cudzy digest zostają');

-- 4. Stan anulowania w dzienniku: bez treści i bez adresu, najemca zostaje.
SELECT results_eq(
  $$ SELECT message_id, status, error_message, recipient_email, tenant_id::text
       FROM public.email_send_log
      WHERE message_id IN ('i9c-m1', 'i9c-m2', 'i9c-m3') AND status = 'suppressed'
      ORDER BY message_id $$,
  $$ VALUES ('i9c-m1'::text, 'suppressed'::text, 'cancelled:account_deleted'::text, '[redacted]'::text,
             '19c10000-0000-4000-8000-0000000000a1'::text),
            ('i9c-m2', 'suppressed', 'cancelled:account_deleted', '[redacted]', '19c10000-0000-4000-8000-0000000000a1'),
            ('i9c-m3', 'suppressed', 'cancelled:account_deleted', '[redacted]', '19c10000-0000-4000-8000-0000000000a1') $$,
  'dziennik: suppressed z powodem cancelled:account_deleted, adres [redacted], najemca z wpisu pending');

SELECT is(
  (SELECT count(*)::int FROM public.email_send_log
    WHERE message_id IN ('i9c-m1', 'i9c-m2', 'i9c-m3') AND recipient_email <> '[redacted]'),
  0, 'dziennik: żaden wpis anulowanej wiadomości (także pending) nie niesie adresu');

-- 5. Poczta, która zostaje, zostaje też w dzienniku bez zmian.
SELECT results_eq(
  $$ SELECT message_id, status, recipient_email FROM public.email_send_log
      WHERE message_id IN ('i9c-m4', 'i9c-m5', 'i9c-m6', 'i9c-m7') ORDER BY message_id $$,
  $$ VALUES ('i9c-m4'::text, 'pending'::text, 'usuwana@i9c-poczta.test'::text),
            ('i9c-m5', 'pending', 'kontakt@i9c-poczta.test'),
            ('i9c-m6', 'pending', 'zostaje@i9c-poczta.test'),
            ('i9c-m7', 'pending', 'usuwana@i9c-poczta.test') $$,
  'transakcyjna, newsletter, kontakt CRM bez konta i cudzy digest: wpis pending bez zmian (do wysyłki)');

-- 6. Powtórka nic nie zmienia.
SELECT is(public._hub_account_erase_mail_queue('19c10000-0000-4000-8000-00000000d001', 'usuwana@i9c-poczta.test'), 0,
          'powtórka anulowania: 0 (wiadomości już nie ma, dziennik ma stan końcowy)');

-- ── Warstwa 2: dren przed wysyłką ────────────────────────────────────────────
-- 7. Zapis konta zakończony usunięciem (także gdy wiadomość była w locie).
SELECT is(public.email_queue_send_recheck('journey', 'journey:19c10000-0000-4000-8000-0000000012a1:email-1'),
          'skipped:exited:account_deleted', 'dren: krok ścieżki zapisu konta po usunięciu -> skipped:exited:account_deleted');
SELECT is(public.email_queue_send_recheck('digest_daily', 'digest:daily:19c10000-0000-4000-8000-00000000d001:2026-10-20'),
          'skipped:account_deleted', 'dren: digest usuniętego konta -> skipped:account_deleted');

-- 8. Digest konta żyjącego: włączony -> ok; wyłączony -> pominięty.
SELECT is(public.email_queue_send_recheck('digest_daily', 'digest:daily:19c10000-0000-4000-8000-00000000d002:2026-10-20'),
          'ok', 'dren: digest konta z włączonym digestem -> ok');
UPDATE public.notification_preferences SET email_digest = 'off' WHERE user_id = '19c10000-0000-4000-8000-00000000d002';
SELECT is(public.email_queue_send_recheck('DIGEST_DAILY', 'digest:daily:19c10000-0000-4000-8000-00000000d002:2026-10-20'),
          'skipped:digest_disabled', 'dren: digest wyłączony w trakcie cyklu -> skipped:digest_disabled');

-- 9. Wypis w trakcie cyklu: marketing pominięty, usługa (bez zgody marketingowej) dalej ok.
SELECT is(public.email_queue_send_recheck('journey', 'journey:19c10000-0000-4000-8000-0000000012a2:email-1'),
          'ok', 'dren: kontakt CRM ze zgodą, zapis w toku -> ok');
INSERT INTO public.newsletter_subscribers (tenant_id, email, status)
VALUES ('19c10000-0000-4000-8000-0000000000a1', 'kontakt@i9c-poczta.test', 'unsubscribed');
SELECT ok(
  public.email_queue_send_recheck('journey', 'journey:19c10000-0000-4000-8000-0000000012a2:email-1') = 'skipped:unsubscribed'
  AND public.email_queue_send_recheck('journey_service', 'journey:19c10000-0000-4000-8000-0000000012a3:email-1') = 'ok',
  'dren: wypis w trakcie cyklu zatrzymuje marketing (skipped:unsubscribed), usługa z podstawą prawną wychodzi');

-- 10. Zapis usunięty (kontakt usunięty przez admina), klucz spoza konwencji,
--     poczta spoza listy.
SELECT ok(
  public.email_queue_send_recheck('journey_test', 'journey:19c10000-0000-4000-8000-0000000012ff:email-1')
    = 'skipped:enrollment_missing'
  AND public.email_queue_send_recheck('journey', 'ręczny-klucz') = 'ok'
  AND public.email_queue_send_recheck('payment_failed', 'invoice:i9c:1') = 'ok'
  AND public.email_queue_send_recheck(NULL, NULL) = 'ok',
  'dren: zapis usunięty -> skipped:enrollment_missing; klucz spoza konwencji i poczta transakcyjna -> ok');

-- ── ACL ──────────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.email_queue_send_recheck(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.email_queue_send_recheck(text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.email_queue_send_recheck(text, text)', 'EXECUTE'),
  'acl: pytanie drenu wyłącznie dla service_role');
SELECT ok(
  NOT has_function_privilege('service_role', 'public._hub_account_erase_mail_queue(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._hub_account_erase_mail_queue(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._hub_account_erase_mail_queue(uuid, text)', 'EXECUTE'),
  'acl: anulowanie poczty konta - wewnętrzne (bez EXECUTE dla ról API)');

SELECT * FROM finish();
ROLLBACK;

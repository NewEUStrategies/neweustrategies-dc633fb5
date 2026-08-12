-- pgTAP: „Zapytanie do eksperta" po scaleniu dwóch generacji (migracja
-- 20260806160001_expert_request_single_generation).
--
-- Plik przybija dokładnie te własności, których brak kosztował dwie dziury
-- i jedną martwą funkcję na świeżej bazie:
--
--   1. PULA NIE JEST DO OBEJŚCIA. Licznik liczy WSZYSTKIE wysłane w miesiącu,
--      więc pętla „wyślij → anuluj → wyślij" (anulowanie jest dostępne nadawcy
--      z UI oraz wprost przez Data API) nie zeruje puli. Wcześniej licznik
--      pomijał `cancelled`, czyli Plus z pulą 2 wysyłał dowolnie wiele.
--   2. JEDNA IMPLEMENTACJA. Nazwy „inmail" (kontrakt wywołań klienta) i nazwy
--      domenowe zwracają IDENTYCZNY wynik - delegaty nie mają własnego ciała,
--      w którym dałoby się zapomnieć poprawki.
--   3. WSZYSTKIE 5 RPC KLIENTA ISTNIEJĄ i celują w istniejącą tabelę. Na świeżej
--      bazie rename z 20260723180000 zostawiał `send_expert_inmail` z 42P01,
--      a cztery pozostałe RPC nie istniały wcale (PGRST202).
--   4. GRANICA OBSZARU ROBOCZEGO. Odbiorca z innego tenanta jest niedostępny,
--      a konto po dryfie tenanta (profil przepięty, wiersze zostały) nie czyta
--      ani nie domyka zapytań poprzedniego obszaru - także przez RPC
--      (SECURITY DEFINER omija RLS, więc tenant jest sprawdzany W CIELE).
--   5. MASZYNA STANÓW I GUARD KOLUMNOWY. Wycofać można tylko `pending`;
--      nadawca nie podrabia wyniku ani stempla „w powietrzu", a wycofanie przez
--      RPC (stempel `responded_at`) przechodzi - wcześniej guard je odrzucał.
--   6. ANTYSPAM 5/24 h per odbiorca - jedyny limit warstw „bezpośrednich".
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(29);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa tenanty, nadawca Plus, dwóch ekspertów, super admin ────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e5a11111-1111-1111-1111-1111111111a1', 'esg-a', 'ESG Tenant A', 'a.esg.example'),
  ('e5b22222-2222-2222-2222-2222222222b2', 'esg-b', 'ESG Tenant B', 'b.esg.example');

INSERT INTO auth.users (id, email) VALUES
  ('e5000000-0000-0000-0000-0000000000a1', 'plus-a@esg.test'),
  ('e5000000-0000-0000-0000-0000000000a2', 'expert-a@esg.test'),
  ('e5000000-0000-0000-0000-0000000000a3', 'expert-a2@esg.test'),
  ('e5000000-0000-0000-0000-0000000000a4', 'super-a@esg.test'),
  ('e5000000-0000-0000-0000-0000000000b1', 'expert-b@esg.test'),
  ('e5000000-0000-0000-0000-0000000000b2', 'plus-b@esg.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e5000000-0000-0000-0000-0000000000a1', 'plus-a@esg.test',   'Plus A',     'e5a11111-1111-1111-1111-1111111111a1'),
  ('e5000000-0000-0000-0000-0000000000a2', 'expert-a@esg.test', 'Expert A',   'e5a11111-1111-1111-1111-1111111111a1'),
  ('e5000000-0000-0000-0000-0000000000a3', 'expert-a2@esg.test','Expert A2',  'e5a11111-1111-1111-1111-1111111111a1'),
  ('e5000000-0000-0000-0000-0000000000a4', 'super-a@esg.test',  'Super A',    'e5a11111-1111-1111-1111-1111111111a1'),
  ('e5000000-0000-0000-0000-0000000000b1', 'expert-b@esg.test', 'Expert B',   'e5b22222-2222-2222-2222-2222222222b2'),
  ('e5000000-0000-0000-0000-0000000000b2', 'plus-b@esg.test',   'Plus B',     'e5b22222-2222-2222-2222-2222222222b2');

-- `is_expert_user` czyta m.in. rolę redakcyjną, `is_super_admin` - rolę super_admin.
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e5000000-0000-0000-0000-0000000000a2', 'author',      'e5a11111-1111-1111-1111-1111111111a1'),
  ('e5000000-0000-0000-0000-0000000000a3', 'author',      'e5a11111-1111-1111-1111-1111111111a1'),
  ('e5000000-0000-0000-0000-0000000000a4', 'super_admin', 'e5a11111-1111-1111-1111-1111111111a1'),
  ('e5000000-0000-0000-0000-0000000000b1', 'author',      'e5b22222-2222-2222-2222-2222222222b2');

-- Warstwa Plus: LICZBA (kanoniczna) = 1, dawna flaga boolowska = 2. Pula
-- efektywna to GREATEST, więc ujednolicenie nikomu nie odbiera puli: 2.
-- Upsert zamiast UPDATE, żeby test nie zależał od zawartości seedu katalogu.
INSERT INTO public.membership_tiers (tenant_id, key, rank, name_pl, name_en, features) VALUES
  ('e5a11111-1111-1111-1111-1111111111a1', 'member', 10, 'Plus', 'Plus',
   '{"chat_enabled": true, "expert_request_quota": 1, "chat_inmail_quota_2": true}'::jsonb),
  ('e5b22222-2222-2222-2222-2222222222b2', 'member', 10, 'Plus', 'Plus',
   '{"chat_enabled": true, "expert_request_quota": 1, "chat_inmail_quota_2": true}'::jsonb)
ON CONFLICT (tenant_id, key) DO UPDATE
  SET features = public.membership_tiers.features
              || '{"chat_enabled": true, "expert_request_quota": 1, "chat_inmail_quota_2": true}'::jsonb;

INSERT INTO public.membership_grants (tenant_id, user_id, tier_key) VALUES
  ('e5a11111-1111-1111-1111-1111111111a1', 'e5000000-0000-0000-0000-0000000000a1', 'member'),
  ('e5b22222-2222-2222-2222-2222222222b2', 'e5000000-0000-0000-0000-0000000000b2', 'member');

-- ── (3) Kontrakt obiektów: jedna tabela, dziesięć żywych RPC ─────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('expert_inmails', 'expert_requests')),
  1,
  'schemat: dokładnie JEDNA relacja fizyczna zapytań (rename nie rozdwaja świata)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('my_inmail_quota', 'send_expert_inmail', 'resolve_expert_inmail',
                        'list_my_inmails', 'admin_list_inmails',
                        'my_expert_request_quota', 'send_expert_request',
                        'resolve_expert_request', 'list_my_expert_requests',
                        'admin_list_expert_requests')),
  10,
  'RPC: 5 nazw wołanych przez klienta + 5 domenowych istnieje (żadnego 42P01/PGRST202)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('my_inmail_quota', 'send_expert_inmail', 'resolve_expert_inmail',
                        'list_my_inmails', 'admin_list_inmails',
                        'my_expert_request_quota', 'send_expert_request',
                        'resolve_expert_request', 'list_my_expert_requests',
                        'admin_list_expert_requests')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'ACL: anon nie ma EXECUTE na żadnym RPC zapytań'
);

-- ── (4) Polityki RLS wiążą tenanta w KAŻDEJ ścieżce właściciela ──────────────
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expert_inmails'
      AND (qual IS NOT NULL OR with_check IS NOT NULL)
      AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%current_tenant_id()%'
      AND coalesce(with_check, '') <> 'false'),
  0,
  'RLS: każda polityka poza „no direct insert" wiąże wiersz z current_tenant_id()'
);

SET LOCAL ROLE authenticated;

-- ── (1)(2) Pula: wartość, parytet delegatu, wyczerpanie ─────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (public.my_inmail_quota() ->> 'quota')::int, 2,
  'pula = GREATEST(features.expert_request_quota, dawna flaga chat_inmail_quota_2)'
);
SELECT is(
  public.my_inmail_quota(), public.my_expert_request_quota(),
  'delegat „inmail" zwraca dokładnie to samo co funkcja domenowa'
);
SELECT is(
  (public.my_inmail_quota() ->> 'direct')::boolean, false,
  'Plus nie jest warstwą „bezpośrednią" (widzi pulę, nie omija jej)'
);

SELECT lives_ok(
  $$SELECT public.send_expert_inmail('e5000000-0000-0000-0000-0000000000a2',
      'Pierwsze zapytanie testowe',
      'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.')$$,
  'wysyłka 1/2 przechodzi'
);
SELECT lives_ok(
  $$SELECT public.send_expert_inmail('e5000000-0000-0000-0000-0000000000a3',
      'Drugie zapytanie testowe',
      'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.')$$,
  'wysyłka 2/2 przechodzi'
);
SELECT is(
  (public.my_inmail_quota() ->> 'used')::int, 2,
  'licznik puli po dwóch wysyłkach = 2'
);
SELECT throws_ok(
  $$SELECT public.send_expert_inmail('e5000000-0000-0000-0000-0000000000a2',
      'Trzecie zapytanie testowe',
      'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.')$$,
  'P0001', 'expert_request: monthly quota exceeded',
  'trzecia wysyłka odbija się od puli miesięcznej'
);

-- ── (1) FIX: wycofanie NIE zwraca puli - pętla wyślij→anuluj→wyślij zamknięta ─
SELECT lives_ok(
  $$SELECT public.resolve_expert_inmail(
      (SELECT id FROM public.expert_inmails
        WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1' AND status = 'pending'
        ORDER BY created_at LIMIT 1), 'cancel')$$,
  'nadawca wycofuje własne zapytanie przez RPC (guard dopuszcza stempel responded_at)'
);
SELECT is(
  (SELECT count(*)::int FROM public.expert_inmails
    WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1' AND status = 'cancelled'),
  1,
  'wycofanie faktycznie ustawiło status cancelled'
);
SELECT is(
  (public.my_inmail_quota() ->> 'used')::int, 2,
  'anulowane NADAL liczy się do puli (obejście przez anulowanie zamknięte)'
);
SELECT throws_ok(
  $$SELECT public.send_expert_inmail('e5000000-0000-0000-0000-0000000000a2',
      'Zapytanie po anulowaniu',
      'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.')$$,
  'P0001', 'expert_request: monthly quota exceeded',
  'po anulowaniu pula pozostaje wyczerpana (pętla obejścia nie działa)'
);

-- ── Zapis wprost do tabeli: zamknięty dla klienta ───────────────────────────
-- Data API omijało maszynę stanów RPC (PATCH statusu wycofywał zapytanie już
-- zatwierdzone), więc `authenticated` traci INSERT/UPDATE. Czytanie zostaje.
SELECT throws_ok(
  $$UPDATE public.expert_inmails SET status = 'cancelled'
     WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1' AND status = 'pending'$$,
  '42501', 'permission denied for table expert_inmails',
  'Data API: klient nie zmienia statusu wprost (maszyna stanów tylko przez RPC)'
);
SELECT throws_ok(
  $$INSERT INTO public.expert_inmails (tenant_id, sender_id, recipient_id, subject, reason)
    VALUES ('e5a11111-1111-1111-1111-1111111111a1',
            'e5000000-0000-0000-0000-0000000000a1',
            'e5000000-0000-0000-0000-0000000000a2',
            'Wstawka bezposrednia', 'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.')$$,
  '42501', 'permission denied for table expert_inmails',
  'Data API: wstawka bezpośrednia jest zamknięta (tylko RPC)'
);
SELECT is(
  (SELECT count(*)::int FROM public.expert_inmails
    WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1'),
  2,
  'odczyt własnych zapytań przez tabelę nadal działa (RLS uczestnika + tenant)'
);

-- ── (5) Guard kolumnowy: druga warstwa, gdyby grant zapisu kiedyś wrócił ─────
-- Trigger rozstrzyga po `auth.uid()` z żądania, a nie po roli bazy, więc
-- kontrakt kolumn sprawdzamy rolą, która grant ma (service_role) - z JWT
-- nadawcy. Bez tego test mierzyłby wyłącznie brak grantu.
RESET ROLE;
INSERT INTO public.expert_inmails (tenant_id, sender_id, recipient_id, subject, reason) VALUES
  ('e5a11111-1111-1111-1111-1111111111a1',
   'e5000000-0000-0000-0000-0000000000a1',
   'e5000000-0000-0000-0000-0000000000a2',
   'Zapytanie do prób guardu', 'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.');
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$UPDATE public.expert_inmails SET status = 'approved'
     WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1' AND status = 'pending'$$,
  'P0001', 'expert_inmails: senders may only cancel their request',
  'guard: nadawca nie zatwierdza własnego zapytania'
);
SELECT throws_ok(
  $$UPDATE public.expert_inmails SET responded_at = now()
     WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1' AND status = 'pending'$$,
  'P0001', 'expert_inmails: senders may only cancel their request',
  'guard: nadawca nie stawia stempla rozstrzygnięcia bez wycofania'
);
SET LOCAL ROLE authenticated;

-- ── (5) Maszyna stanów: zatwierdzonego nie da się wycofać ────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT is(
  public.resolve_expert_inmail(
    (SELECT id FROM public.expert_inmails
      WHERE recipient_id = 'e5000000-0000-0000-0000-0000000000a2' AND status = 'pending'
      ORDER BY created_at LIMIT 1), 'approve') ->> 'status',
  'approved',
  'odbiorca zatwierdza zapytanie (powstaje bezpośrednia konwersacja)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.resolve_expert_inmail(
      (SELECT id FROM public.expert_inmails
        WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1' AND status = 'approved'
        LIMIT 1), 'cancel')$$,
  'P0001', 'expert_request: invalid status transition',
  'maszyna stanów: wycofać można tylko zapytanie oczekujące'
);

-- ── (4) Granica obszaru roboczego ───────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.send_expert_inmail('e5000000-0000-0000-0000-0000000000b1',
      'Zapytanie poza tenant',
      'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.')$$,
  'P0001', 'expert_request: recipient not available',
  'tenant: ekspert z innego obszaru roboczego jest niedostępny'
);

-- Dryf tenanta: profil nadawcy przepięty do B, jego wiersze zostają w A.
-- `profiles_pin_tenant_id` (20260721052806) czyni tenanta konta niezmiennym dla
-- właściciela wiersza - przepięcie jest wyłącznie operacją serwerową, więc idzie
-- rolą `service_role`, tą samą ścieżką co provisioning w produkcie.
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.profiles SET tenant_id = 'e5b22222-2222-2222-2222-2222222222b2'
 WHERE id = 'e5000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.list_my_inmails('sent')),
  0,
  'tenant: po dryfie profilu skrzynka nie pokazuje wierszy poprzedniego obszaru'
);
-- Celujemy w wiersz ZATWIERDZONY: bez bramki tenanta wołanie doszłoby do
-- maszyny stanów i rzuciło „invalid status transition", więc komunikat
-- „not found" dowodzi, że zadziałało właśnie sprawdzenie tenanta w ciele.
SELECT throws_ok(
  $$SELECT public.resolve_expert_inmail(
      (SELECT id FROM public.expert_inmails
        WHERE sender_id = 'e5000000-0000-0000-0000-0000000000a1' AND status = 'approved'
        LIMIT 1), 'cancel')$$,
  'P0001', 'expert_request: not found',
  'tenant: po dryfie profilu nie da się domknąć wiersza poprzedniego obszaru'
);

RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.profiles SET tenant_id = 'e5a11111-1111-1111-1111-1111111111a1'
 WHERE id = 'e5000000-0000-0000-0000-0000000000a1';
RESET ROLE;
-- Zapytanie tenanta B - moderacja tenanta A nie ma prawa go widzieć.
INSERT INTO public.expert_inmails (tenant_id, sender_id, recipient_id, subject, reason) VALUES
  ('e5b22222-2222-2222-2222-2222222222b2',
   'e5000000-0000-0000-0000-0000000000b2',
   'e5000000-0000-0000-0000-0000000000b1',
   'Zapytanie tenanta B', 'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.');
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.admin_list_inmails(NULL, 500, 0)
    WHERE tenant_id <> 'e5a11111-1111-1111-1111-1111111111a1'),
  0,
  'tenant: moderacja super admina nie wychodzi poza jego obszar roboczy'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.admin_list_inmails(NULL, 10, 0)$$,
  'P0001', 'expert_request: forbidden',
  'authz: lista moderacyjna wymaga super admina'
);

-- ── (6) Antyspam per odbiorca dla warstwy „bezpośredniej" ───────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT is(
  (public.my_inmail_quota() ->> 'direct')::boolean, true,
  'ekspert pisze bez puli (direct) - CTA zapytania nie dotyczy jego warstwy'
);

DO $seed$
DECLARE i integer;
BEGIN
  -- Ekspert A2 jest już odbiorcą jednego zapytania od Plus A; tu liczymy parę
  -- (ekspert A → ekspert A2): pięć wchodzi, szóste odbija się o antyspam.
  FOR i IN 1..5 LOOP
    PERFORM public.send_expert_inmail('e5000000-0000-0000-0000-0000000000a3',
      format('Zapytanie eksperckie numer %s', i),
      'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.');
  END LOOP;
END $seed$;

SELECT throws_ok(
  $$SELECT public.send_expert_inmail('e5000000-0000-0000-0000-0000000000a3',
      'Zapytanie eksperckie szóste',
      'Uzasadnienie testowe dłuższe niż dwadzieścia znaków.')$$,
  'P0001', 'expert_request: rate limit',
  'antyspam: 5 zapytań na 24 h do TEGO SAMEGO odbiorcy, także bez limitu puli'
);

SELECT * FROM finish();
ROLLBACK;

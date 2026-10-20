-- pgTAP: cennik v6.2 - decyzje właściciela 2026-10-20 o Zespole i NGO (I9b,
-- migracje 20261020160100 i 20261020160200).
--
-- CO PRZYPINA:
--   1. SEED NOWEGO NAJEMCY = dokładnie v6.2: Zespół z trackerem
--      (`regulatory_monitoring`) i pulą 3 zapytań, BEZ kanału bezpośredniego;
--      NGO z rangą 40, flagami Partnera i pulą 3, `sort_order` 85; opisy
--      i pierwsza pozycja karty Zespołu bez „bez monitoringu";
--   2. NAJEMCA ISTNIEJĄCY (stan v6.2 sprzed decyzji odtworzony w teście):
--      tracker dodany, kanał bezpośredni ZOSTAJE (brak obniżki), NGO ∪
--      Partner (prawda wygrywa, liczba - większa), ranga 40, opisy i pozycje
--      karty zmienione tylko tam, gdzie równe tekstowi katalogu - pozycja
--      o korespondencji mówi „bez limitu" przy kanale bezpośrednim;
--   3. RĘCZNE ZMIANY ADMINA zostają: opis i benefit przepisane w panelu,
--      `sort_order` NGO ustawiony ręcznie, ranga NGO podniesiona ponad 40;
--   4. IDEMPOTENCJA: druga runda zwraca 0 i nie tworzy nowej wersji krotki;
--   5. ACL funkcji najemcy i katalogu.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_pricing_decisions
BEGIN;
SELECT plan(19);

-- ── 1. Seed nowego najemcy ──────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name)
VALUES ('19b20000-0000-4000-8000-0000000000a1', 'i9b-fresh', 'I9b Fresh');

SELECT ok(
  (SELECT features @> '{"regulatory_monitoring": true, "expert_request_quota": 3}'::jsonb
          AND NOT features ? 'chat_direct_gated'
     FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000a1' AND key = 'team'),
  'seed: Zespół = tracker + pula 3 zapytań, bez kanału bezpośredniego (dokładnie v6.2)');
SELECT is(
  (SELECT description_pl || ' | ' || description_en FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000a1' AND key = 'team'),
  'Pełny zakres Członka Pro dla każdego miejsca, jedna faktura, wspólne wejście do klubów. | The full Member Pro scope for every seat, one invoice and joint entry to clubs.',
  'seed: opis karty Zespołu PL/EN bez dopisku o braku monitoringu');
SELECT is(
  (SELECT benefits -> 0 ->> 'pl' FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000a1' AND key = 'team'),
  'Pełny zakres Członka Pro dla każdego miejsca',
  'seed: pierwsza pozycja karty Zespołu - pełny zakres Pro');
SELECT ok(
  (SELECT benefits @> '[{"pl":"Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce"}]'::jsonb
     FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000a1' AND key = 'team'),
  'seed: karta Zespołu mówi o puli 3 zapytań - tyle daje bramka nowego najemcy');
SELECT results_eq(
  $$SELECT rank, sort_order,
           features @> (SELECT p.features - 'included_event_tickets' FROM public.membership_tiers p
                         WHERE p.tenant_id = '19b20000-0000-4000-8000-0000000000a1' AND p.key = 'partner'),
           (features ->> 'expert_request_quota')::int
      FROM public.membership_tiers
     WHERE tenant_id = '19b20000-0000-4000-8000-0000000000a1' AND key = 'ngo'$$,
  $$VALUES (40, 85, true, 3)$$,
  'seed: NGO - ranga 40, sort_order 85, flagi Partnera, pula 3 zachowana');
SELECT is(
  (SELECT description_pl FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000a1' AND key = 'ngo'),
  'Zakres Partnera Instytucjonalnego w stawce -50% dla organizacji pozarządowych i think-tanków non-profit, po weryfikacji KRS lub statutu.',
  'seed: opis karty NGO - zakres Partnera -50%');
SELECT is(public._pricing_v62_owner_decisions('19b20000-0000-4000-8000-0000000000a1'), 0,
  'seed: najemca nowy jest już w stanie docelowym - funkcja nic nie zmienia');

-- ── 2. Najemca istniejący w stanie v6.2 sprzed decyzji ─────────────────────
INSERT INTO public.tenants (id, slug, name)
VALUES ('19b20000-0000-4000-8000-0000000000b2', 'i9b-legacy', 'I9b Legacy');

UPDATE public.membership_tiers
   SET features = '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "included_event_tickets_org": 3}'::jsonb,
       description_pl = 'Zakres Członka Pro dla każdego miejsca (bez monitoringu regulacyjnego), jedna faktura, wspólne wejście do klubów.',
       description_en = 'The Member Pro scope for every seat (without regulatory monitoring), one invoice and joint entry to clubs.',
       benefits = '[{"pl":"Zakres progu Członek Pro dla każdego miejsca, bez monitoringu regulacyjnego","en":"The Member Pro scope for every seat, without regulatory monitoring"},
                    {"pl":"Onboarding zespołowy: przypisanie wszystkich miejsc do klubów w 7 dni od zakupu","en":"Team onboarding: every seat assigned to a club within 7 days of purchase"},
                    {"pl":"Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce","en":"Expert correspondence: 3 requests a month per seat"}]'::jsonb
 WHERE tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND key = 'team';
UPDATE public.membership_tiers
   SET rank = 20, sort_order = 50,
       features = '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "gift_links": true, "chat_enabled": true, "chatham_house_events": true, "early_access": true, "expert_request_quota": 3, "included_event_tickets": 1, "regulatory_monitoring": false}'::jsonb,
       description_pl = 'Stawka preferencyjna dla organizacji pozarządowych i think-tanków non-profit: -50% stawki Partnera Instytucjonalnego, po weryfikacji KRS lub statutu.',
       description_en = 'A preferential rate for NGOs and non-profit think-tanks: 50% off the Institutional Partner rate, after registry (KRS) or statute verification.'
 WHERE tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND key = 'ngo';
-- Partner tego najemcy z RĘCZNIE podniesionym biletem (2) - NGO bierze większą liczbę.
UPDATE public.membership_tiers
   SET features = features || '{"included_event_tickets": 2}'::jsonb
 WHERE tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND key = 'partner';

SELECT is(public._pricing_v62_owner_decisions('19b20000-0000-4000-8000-0000000000b2') > 0, true,
  'istniejący: funkcja wprowadza decyzje');
SELECT ok(
  (SELECT features @> '{"regulatory_monitoring": true, "chat_direct_gated": true, "included_event_tickets_org": 3}'::jsonb
     FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND key = 'team'),
  'istniejący: Zespół dostaje tracker, kanał bezpośredni ZOSTAJE (brak obniżki)');
SELECT is(
  (SELECT description_pl || ' | ' || description_en FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND key = 'team'),
  'Pełny zakres Członka Pro dla każdego miejsca, jedna faktura, wspólne wejście do klubów. | The full Member Pro scope for every seat, one invoice and joint entry to clubs.',
  'istniejący: opis Zespołu równy tekstowi katalogu - zamieniony (PL i EN)');
SELECT results_eq(
  $$SELECT e ->> 'pl' FROM public.membership_tiers mt, jsonb_array_elements(mt.benefits) WITH ORDINALITY AS x(e, n)
     WHERE mt.tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND mt.key = 'team' ORDER BY n$$,
  $$VALUES ('Pełny zakres Członka Pro dla każdego miejsca'),
           ('Onboarding zespołowy: przypisanie wszystkich miejsc do klubów w 7 dni od zakupu'),
           ('Korespondencja z ekspertami bez limitu dla każdego miejsca (kanał bezpośredni)')$$,
  'istniejący: karta Zespołu - pełny zakres Pro i „bez limitu" przy kanale bezpośrednim, kolejność bez zmian');
SELECT results_eq(
  $$SELECT rank, sort_order,
           (features ->> 'regulatory_monitoring')::boolean, (features ->> 'chat_direct_gated')::boolean,
           (features ->> 'strategic_partner')::boolean, (features ->> 'expert_request_quota')::int,
           (features ->> 'included_event_tickets')::int
      FROM public.membership_tiers
     WHERE tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND key = 'ngo'$$,
  $$VALUES (40, 85, true, true, true, 3, 2)$$,
  'istniejący: NGO ranga 40, NGO ∪ Partner (prawda wygrywa z fałszem, bilet - większy z dwóch), pula 3 zostaje');
SELECT is(
  (SELECT description_en FROM public.membership_tiers
    WHERE tenant_id = '19b20000-0000-4000-8000-0000000000b2' AND key = 'ngo'),
  'The Institutional Partner scope at 50% off for NGOs and non-profit think-tanks, after registry (KRS) or statute verification.',
  'istniejący: opis NGO EN zamieniony');

-- ── 3. Ręczne zmiany admina zostają ─────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name)
VALUES ('19b20000-0000-4000-8000-0000000000c3', 'i9b-custom', 'I9b Custom');
UPDATE public.membership_tiers
   SET features = features - 'regulatory_monitoring' || '{"chat_direct_gated": true}'::jsonb,
       description_pl = 'Nasz zespołowy pakiet - opis z panelu.',
       benefits = '[{"pl":"Pozycja z panelu","en":"Panel item"},
                    {"pl":"Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce","en":"Expert correspondence: 3 requests a month per seat (panel)"}]'::jsonb
 WHERE tenant_id = '19b20000-0000-4000-8000-0000000000c3' AND key = 'team';
UPDATE public.membership_tiers
   SET rank = 45, sort_order = 33, description_pl = 'Opis NGO z panelu.'
 WHERE tenant_id = '19b20000-0000-4000-8000-0000000000c3' AND key = 'ngo';
SELECT lives_ok($$ SELECT public._pricing_v62_owner_decisions('19b20000-0000-4000-8000-0000000000c3') $$,
  'ręczne: funkcja przechodzi');
SELECT results_eq(
  $$SELECT description_pl, benefits::text FROM public.membership_tiers
     WHERE tenant_id = '19b20000-0000-4000-8000-0000000000c3' AND key = 'team'$$,
  $$VALUES ('Nasz zespołowy pakiet - opis z panelu.',
            '[{"en": "Panel item", "pl": "Pozycja z panelu"}, {"en": "Expert correspondence: 3 requests a month per seat (panel)", "pl": "Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce"}]')$$,
  'ręczne: opis i pozycje karty przepisane w panelu nietknięte (także przy zmienionym EN)');
SELECT results_eq(
  $$SELECT rank, sort_order, description_pl FROM public.membership_tiers
     WHERE tenant_id = '19b20000-0000-4000-8000-0000000000c3' AND key = 'ngo'$$,
  $$VALUES (45, 33, 'Opis NGO z panelu.')$$,
  'ręczne: ranga NGO ponad 40 nie obniżona, ręczny sort_order i opis zostają');

-- ── 4. Idempotencja ─────────────────────────────────────────────────────────
CREATE TEMP TABLE tiers_before ON COMMIT DROP AS
  SELECT id, ctid::text AS c FROM public.membership_tiers
   WHERE tenant_id IN ('19b20000-0000-4000-8000-0000000000b2', '19b20000-0000-4000-8000-0000000000c3');
SELECT is(
  public._pricing_v62_owner_decisions('19b20000-0000-4000-8000-0000000000b2')
    + public._pricing_v62_owner_decisions('19b20000-0000-4000-8000-0000000000c3'),
  0, 'idempotencja: druga runda zwraca 0');
SELECT is_empty(
  $$SELECT 1 FROM public.membership_tiers t JOIN tiers_before b ON b.id = t.id WHERE t.ctid::text <> b.c$$,
  'idempotencja: brak nowej wersji krotki (brak UPDATE i zdarzenia)');

-- ── 5. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public._pricing_v62_owner_decisions(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._pricing_v62_owner_decisions(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._pricing_v62_owner_decisions(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.pricing_catalog_v62_rows()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.pricing_catalog_v62_benefits()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.pricing_catalog_v62_rows()', 'EXECUTE'),
  'acl: funkcja najemcy bez EXECUTE dla ról API; katalog tylko service_role');

SELECT * FROM finish();
ROLLBACK;

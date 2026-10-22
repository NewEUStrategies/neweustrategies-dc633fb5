-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b, 3/5): CENNIK v6.2 - DECYZJE WŁAŚCICIELA
-- U NAJEMCÓW ISTNIEJĄCYCH (ZESPÓŁ, NGO) I BENEFITY KARTY ZESPOŁU.
-- Decyzja właściciela 2026-10-20 (zgoda delegowana). Zasada nadrzędna:
-- obietnica v6.2 to MINIMUM - nic nie odbieramy, brakujące dodajemy.
--
-- DEFEKT
--   1. Najemcy istniejący mieli Zespół bez trackera i z opisem „bez
--      monitoringu regulacyjnego", a NGO z rangą 20 i zakresem Członka Pro
--      (katalog 20261020160100 zmienia wyłącznie seed nowego najemcy).
--   2. Pierwsza pozycja karty Zespołu mówiła „bez monitoringu regulacyjnego"
--      - po dodaniu trackera karta obiecywałaby MNIEJ niż bramka i v6.2.
--   3. U najemców istniejących Zespół zachowuje kanał bezpośredni
--      (`chat_direct_gated`, brak obniżki), a karta mówiła „3 zapytania
--      miesięcznie na miejsce" - liczba, której bramka nie liczy. Karta ma
--      mówić prawdę o bramce: kanał bezpośredni = bez limitu.
--
-- ZMIANA
--   A. `pricing_catalog_v62_benefits()` (seed): pozycja 1 Zespołu = „Pełny
--      zakres Członka Pro dla każdego miejsca"; „3 zapytania miesięcznie na
--      miejsce" zostaje - nowy najemca ma dokładnie tę pulę. Reszta katalogu
--      bit w bit jak w 20261018160200.
--   B. `_pricing_v62_owner_decisions(p_tenant)` - najemca istniejący, po
--      kluczu (nigdy po UUID), każda zmiana ze strażnikiem:
--      * `team`: `features || {"regulatory_monitoring": true}`; kanał
--        bezpośredni ZOSTAJE - admin może wyrównać do puli 3 w
--        /admin/membership (Zespół → Bramki i limity: wyłączyć
--        `chat_direct_gated`, ustawić „Zapytania do eksperta" na 3);
--      * `ngo`: ranga podniesiona do 40 (nigdy obniżona), features = flagi
--        NGO ∪ flagi progu `partner` TEGO najemcy (bez progu - z katalogu):
--        prawda wygrywa z fałszem, liczby - większa z dwóch;
--        `sort_order` 50 → 85 tylko, gdy admin go nie zmienił;
--      * opisy kart PL i EN (osobno) oraz pozycje benefitów Zespołu (PL i EN
--        razem) - WYŁĄCZNIE tam, gdzie są równe dotychczasowemu tekstowi
--        katalogu v6.2: tekst zmieniony ręcznie w panelu zostaje. Pozycja
--        o korespondencji zmienia się tylko przy `chat_direct_gated`.
--      Każdy UPDATE ma strażnik IS DISTINCT FROM / równości z tekstem
--      katalogu - powtórka nie dotyka `updated_at` i nie emituje drugi raz
--      `membership_tier.changed.v1`. Seed nowego najemcy jest już w stanie
--      docelowym, więc funkcja nic w nim nie zmienia.
--   C. Wywołanie dla każdego najemcy.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020160100 (flagi Partnera z katalogu dla
-- najemcy bez progu `partner`). `SET lock_timeout` przy UPDATE
-- `membership_tiers`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (benefity - CIALO-Z niżej;
-- `_pricing_v62_owner_decisions` - nowa nazwa), UPDATE-y ze strażnikami;
-- druga runda zwraca 0.
-- DOWÓD: supabase/tests/hub_i9b_pricing_decisions_test.sql (seed; najemca
-- istniejący: tracker dodany, kanał zostaje, NGO ∪ Partner, ranga 40, opis
-- i benefit ręczny nietknięty; druga runda bez zmian),
-- src/components/pricing/__tests__/tierCardV62Catalog.test.tsx.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Benefity kart v6.2 z decyzjami.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261018160200
CREATE OR REPLACE FUNCTION public.pricing_catalog_v62_benefits()
RETURNS TABLE (key text, benefits jsonb)
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (VALUES
    ('reader', '[
      {"pl":"Konto NES: obserwowane tematy, zapisane analizy, historia lektury","en":"An NES account: followed topics, saved analyses, reading history"},
      {"pl":"5 analiz miesięcznie po rejestracji (bez konta: 0)","en":"5 analyses a month once you register (none without an account)"},
      {"pl":"Policy papers we fragmentach z kluczowymi wnioskami","en":"Policy paper excerpts with the key takeaways"},
      {"pl":"Cotygodniowy przegląd geopolityczny: 52 wydania rocznie","en":"The weekly geopolitical review: 52 issues a year"},
      {"pl":"Otwarte dyskusje społeczności","en":"Open community discussions"},
      {"pl":"Zaproszenia na wydarzenia otwarte","en":"Invitations to open events"}]'::jsonb),
    ('supporter', '[
      {"pl":"Wszystko z progu Czytelnik","en":"Everything in Reader"},
      {"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb),
    ('member', '[
      {"pl":"Pełne archiwum analiz i policy papers, bez limitu","en":"The full archive of analyses and policy papers, no limits",
       "group_pl":"Wszystko z progu Czytelnik, oraz:","group_en":"All of Reader, plus:"},
      {"pl":"Wszystkie briefingi członkowskie online w roku, wraz z nagraniami","en":"Every online member briefing in the year, with recordings"},
      {"pl":"1 wliczony bilet rocznie na wydarzenie biletowane, w tym „Geopolityczna Gra Mocarstw”","en":"1 included ticket a year for a ticketed event, including „Geopolityczna Gra Mocarstw”"},
      {"pl":"Pogłębiony digest członkowski: 44 wydania rocznie","en":"The in-depth member digest: 44 issues a year"},
      {"pl":"1 zapytanie do eksperta miesięcznie","en":"1 expert request a month"},
      {"pl":"Czat i wiadomości z innymi członkami","en":"Chat and messages with other members"},
      {"pl":"Kluby: obserwator w jednym klubie otwartym","en":"Clubs: observer in one open club"},
      {"pl":"Panel „Analiza Tygodnia”: mapy, wykresy, dane","en":"The „Analysis of the Week” panel: maps, charts, data"},
      {"pl":"Podcast „Depesza Dyplomaty” w całości, wywiady i materiały wideo","en":"The full „Depesza Dyplomaty” podcast, interviews and video"},
      {"pl":"Narzędzia cytowania: Chicago, APA, BibTeX","en":"Citation tools: Chicago, APA, BibTeX"},
      {"pl":"Rezygnacja w każdej chwili, bez okresu wypowiedzenia","en":"Cancel at any time, with no notice period"}]'::jsonb),
    ('student', '[
      {"pl":"Ten sam zakres treściowy co Członek: pełne archiwum analiz i policy papers","en":"The same content scope as Member: the full archive of analyses and policy papers",
       "detail_pl":"Bez wliczonego biletu i bez zapytań do ekspertów - te pozycje należą do progu Członek.","detail_en":"No included ticket and no expert requests - those belong to the Member tier."},
      {"pl":"Wszystkie briefingi członkowskie online wraz z nagraniami","en":"All online member briefings, with recordings"},
      {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
      {"pl":"Cotygodniowy przegląd i pogłębiony digest członkowski","en":"The weekly review and the in-depth member digest"},
      {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; legitymacja wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; a student ID only for domains outside the list"}]'::jsonb),
    ('educator', '[
      {"pl":"Licencja na wykorzystanie analiz na zajęciach (licencja umowna)","en":"A licence to use analyses in class (a contractual licence)",
       "group_pl":"Wszystko ze stawki studenckiej, oraz:","group_en":"All of the Student rate, plus:"},
      {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
      {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; dokument afiliacyjny wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; an affiliation document only for domains outside the list"}]'::jsonb),
    ('pro', '[
      {"pl":"Kluby: pełne członkostwo w jednym klubie do wyboru","en":"Clubs: full membership of one club of your choice",
       "group_pl":"Wszystko z progu Członek - wraz z tym samym jednym biletem rocznie, nie drugim - oraz:","group_en":"All of Member - including the same single yearly ticket, not a second one - plus:"},
      {"pl":"Monitoring regulacyjny: tracker legislacyjny UE z alertami","en":"Regulatory monitoring: the EU legislative tracker with alerts"},
      {"pl":"4 zamknięte briefingi Pro rocznie: marzec, czerwiec, wrzesień, grudzień","en":"4 closed-door Pro briefings a year: March, June, September, December"},
      {"pl":"Onboarding klubowy: przypisanie w 48 godzin od zakupu, imienne powitanie w wątku, pytanie otwierające od moderatora","en":"Club onboarding: assignment within 48 hours of purchase, a personal welcome in the thread and an opening question from the moderator"},
      {"pl":"Kluby: wątki, dokumenty, ankiety, kalendarz klubu","en":"Clubs: threads, documents, polls and the club calendar"},
      {"pl":"4 noty foresightowe rocznie, w ostatnim tygodniu kwartału","en":"4 foresight notes a year, in the last week of each quarter"},
      {"pl":"3 zapytania do eksperta miesięcznie","en":"3 expert requests a month"},
      {"pl":"Priorytet pytań w sesjach Q&A z ekspertami","en":"Priority questions in expert Q&A sessions"},
      {"pl":"Linki podarunkowe: 3 pełne analizy miesięcznie dla osób spoza platformy","en":"Gift links: 3 full analyses a month for people outside the platform"},
      {"pl":"Wczesny dostęp do raportów: 72 godziny przed publikacją otwartą","en":"Early access to reports: 72 hours before open publication"},
      {"pl":"Spotkania prowadzone w regule Chatham House","en":"Meetings held under the Chatham House Rule"},
      {"pl":"Wydarzenia o ograniczonej liczbie miejsc, z kolejką rezerwową","en":"Limited-capacity events, with a waiting list"}]'::jsonb),
    ('vip', '[
      {"pl":"2 Decision Laby rocznie w roli obserwatora","en":"2 Decision Labs a year as an observer",
       "group_pl":"Wszystko z progu Członek Pro, oraz:","group_en":"All of Member Pro, plus:"},
      {"pl":"Zjazd Rady raz w roku oraz 2 kolacje eksperckie","en":"The Council Assembly once a year and 2 expert dinners"},
      {"pl":"Sounding board: rekomendacje udostępniane 10 dni roboczych przed publikacją, z prawem komentarza","en":"Sounding board: recommendations shared 10 working days before publication, with the right to comment",
       "detail_pl":"Komentarz jest rejestrowany i rozpatrywany przez zespół badawczy. Nie daje prawa do zmiany treści, usunięcia wniosku ani wstrzymania publikacji.","detail_en":"Comments are logged and considered by the research team. They give no right to change the text, remove a finding or stop publication."},
      {"pl":"Zgłoszenie tematu badawczego: nabór do 30 września, rozstrzygnięcie do 31 października, jeden temat rocznie wchodzi do agendy","en":"Research topic proposals: submissions by 30 September, decision by 31 October, one topic a year enters the agenda",
       "detail_pl":"Zgłoszenie jest wnioskiem, nie zleceniem - rada programowa może odmówić bez uzasadnienia.","detail_en":"A proposal is a request, not a commission - the programme board may decline without giving reasons."},
      {"pl":"Korespondencja z ekspertami bez limitu, kanałem bezpośrednim","en":"Unlimited correspondence with experts through a direct channel"},
      {"pl":"Kluby: członkostwo we wszystkich klubach otwartych dla Rady","en":"Clubs: membership of every club open to the Council"},
      {"pl":"4 godziny konsultacji analitycznych rocznie, jednostka 30 minut, reakcja 5 dni roboczych","en":"4 hours of analytical consultation a year, in 30-minute units, with a 5-working-day response"},
      {"pl":"Osobisty opiekun i onboarding w 7 dni od przystąpienia","en":"A personal account manager and onboarding within 7 days of joining"}]'::jsonb),
    ('team', '[
      {"pl":"Pełny zakres Członka Pro dla każdego miejsca","en":"The full Member Pro scope for every seat"},
      {"pl":"Onboarding zespołowy: przypisanie wszystkich miejsc do klubów w 7 dni od zakupu","en":"Team onboarding: every seat assigned to a club within 7 days of purchase"},
      {"pl":"3 wliczone bilety rocznie na organizację, niezależnie od liczby miejsc","en":"3 included tickets a year per organisation, regardless of seat count"},
      {"pl":"Wejścia rangi 25: kluby i treści otwarte dla Rady Instytutu","en":"Rank 25 entries: clubs and content open to the Institute Council"},
      {"pl":"Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce","en":"Expert correspondence: 3 requests a month per seat"},
      {"pl":"Kluby: jedno członkostwo klubowe na miejsce","en":"Clubs: one club membership per seat"},
      {"pl":"Panel miejsc: zapraszanie, odbieranie i przenoszenie między osobami","en":"A seat panel: invite, revoke and reassign between people"},
      {"pl":"Wspólna biblioteka i archiwum organizacji","en":"A shared library and organisation archive"},
      {"pl":"Jedna zbiorcza faktura dla całego zespołu","en":"One consolidated invoice for the whole team"},
      {"pl":"Rabat wolumenowy od 11 miejsc: 79 zł za miejsce","en":"Volume discount from 11 seats: a lower rate for every seat"}]'::jsonb),
    ('ngo', '[
      {"pl":"Stawka preferencyjna: -50% ceny Partnera Instytucjonalnego (cena i zakres - na karcie Partnera)","en":"Preferential rate: 50% off the Institutional Partner price (price and scope on the Partner card)"},
      {"pl":"Dla organizacji pozarządowych i think-tanków non-profit, po weryfikacji KRS lub statutu","en":"For NGOs and non-profit think-tanks, after registry (KRS) or statute verification"},
      {"pl":"Faktura wystawiana na organizację, umowa roczna","en":"Invoice issued to the organisation, annual agreement"}]'::jsonb),
    ('business', '[
      {"pl":"Pełny zakres planu Pro dla konta firmowego - analizy, monitoring regulacyjny, briefingi","en":"The full Pro scope for the company account - analyses, regulatory monitoring, briefings"},
      {"pl":"Cykliczny briefing sektorowy dla firm","en":"A recurring sector briefing for business"},
      {"pl":"Status partnera biznesowego z wyróżnieniem w sekcji partnerów serwisu","en":"Business partner status with recognition in the site''s partners section"},
      {"pl":"Zaproszenia na wydarzenia i wybrane Decision Labs","en":"Invitations to events and selected Decision Labs"},
      {"pl":"Cykl rozliczeń do wyboru: 2 tygodnie, miesiąc lub kwartał - anulowanie w każdej chwili","en":"Choose your billing cycle: 2 weeks, monthly or quarterly - cancel anytime"}]'::jsonb),
    ('corporate', '[
      {"pl":"Pula miejsc z pełnym zakresem Pro dla każdego użytkownika","en":"A seat pool with the full Pro scope for every user"},
      {"pl":"Wspólna biblioteka materiałów i archiwum dla organizacji","en":"A shared library of materials and an organisation archive"},
      {"pl":"Kwartalny briefing dla organizacji","en":"A quarterly briefing for your organisation"},
      {"pl":"Panel administracyjny do zarządzania miejscami i uprawnieniami","en":"An admin panel for managing seats and permissions"},
      {"pl":"Faktura i umowa roczna z opiekunem wdrożenia","en":"Invoicing and an annual agreement with an onboarding manager"}]'::jsonb),
    ('partner', '[
      {"pl":"Do 10 osób nominowanych z pełnym zakresem Pro","en":"Up to 10 nominated people with the full Pro scope",
       "group_pl":"Wszystko z progu Członek Pro dla osób nominowanych, oraz:","group_en":"All of Member Pro for nominated people, plus:"},
      {"pl":"1 Decision Lab rocznie z dwoma miejscami dla osób nominowanych","en":"1 Decision Lab a year with two seats for nominated people"},
      {"pl":"Sounding board dla osób nominowanych, na zasadach i z granicą wpływu jak dla Rady Instytutu","en":"A sounding board for nominated people, on the same terms and with the same boundary of influence as the Institute Council"},
      {"pl":"4 briefingi zamknięte dla organizacji w roku","en":"4 closed-door briefings for the organisation a year"},
      {"pl":"Wszystkie kluby dyskusyjne dla osób nominowanych","en":"All discussion clubs for nominated people"},
      {"pl":"Korespondencja z ekspertami bez limitu dla osób nominowanych","en":"Unlimited expert correspondence for nominated people"},
      {"pl":"8 godzin konsultacji analitycznych rocznie, jednostka 30 minut, reakcja 5 dni roboczych","en":"8 hours of analytical consultation a year, in 30-minute units, with a 5-working-day response"},
      {"pl":"Faktura, umowa roczna, opiekun wdrożenia","en":"Invoice, annual agreement and an onboarding manager"},
      {"pl":"Organizacje pozarządowe i think-tanki non-profit: stawka preferencyjna -50%, po weryfikacji KRS lub statutu","en":"NGOs and non-profit think-tanks: a preferential rate of 50% off, after registry (KRS) or statute verification"}]'::jsonb),
    ('partner_general', '[
      {"pl":"Do 25 osób nominowanych","en":"Up to 25 nominated people",
       "group_pl":"Wszystko z progu Partner Instytucjonalny, oraz:","group_en":"All of Institutional Partner, plus:"},
      {"pl":"1 własna grupa zadaniowa rocznie: cykl 4 spotkań zakończony raportem sygnowanym wspólnie przez NES i partnera","en":"1 own task force a year: a cycle of 4 meetings closing with a report co-signed by NES and the partner"},
      {"pl":"2 dedykowane briefingi szyte na miarę w roku","en":"2 dedicated, tailor-made briefings a year"},
      {"pl":"20 godzin dostępu do analityka rocznie","en":"20 hours of analyst access a year"},
      {"pl":"Prywatny mikroserwis klubowy dla organizacji","en":"A private club micro-site for the organisation"},
      {"pl":"1 slot prelegencki na konferencji New European Strategies w roku","en":"1 speaking slot at the New European Strategies conference each year"},
      {"pl":"2 kolacje eksperckie na poziomie zarządu w roku","en":"2 board-level expert dinners a year"}]'::jsonb),
    ('presidents_circle', '[
      {"pl":"Bez limitu osób nominowanych","en":"No limit on nominated people"},
      {"pl":"Dedykowany analityk prowadzący","en":"A dedicated lead analyst"},
      {"pl":"Współsygnowane badania i publikacje","en":"Co-signed research and publications"},
      {"pl":"Miejsce w panelu recenzenckim publikacji","en":"A seat on the publications review panel"},
      {"pl":"Udział w dorocznym posiedzeniu agendy strategicznej instytutu","en":"Participation in the institute''s annual strategic agenda session",
       "detail_pl":"Fundatorzy zgłaszają obszary i priorytety badawcze. Wybór tematów, metodyka i wnioski pozostają wyłączną kompetencją zespołu badawczego i rady programowej; zapis nie podlega negocjacji w umowie indywidualnej.","detail_en":"Founders propose research areas and priorities. The choice of topics, methodology and findings remain solely with the research team and the programme board; this is not negotiable in individual agreements."}]'::jsonb)
  ) AS v(key, benefits);
$$;

REVOKE ALL ON FUNCTION public.pricing_catalog_v62_benefits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_v62_benefits() TO service_role;

COMMENT ON FUNCTION public.pricing_catalog_v62_benefits() IS
  'Benefity kart progów wg katalogu v6.2 z decyzjami właściciela 2026-10-20 (Zespół: pełny zakres Pro z trackerem) (PL/EN, format [{pl,en,group_*,detail_*}]). Łączona po kluczu z pricing_catalog_v62_rows() w seedzie i apply.';

-- ----------------------------------------------------------------------------
-- B) Najemca istniejący.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pricing_v62_owner_decisions(p_tenant uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
  v_n integer;
  v_partner jsonb;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN 0;
  END IF;

  -- (1) Zespół: tracker dokładany, nic nie zdejmowane.
  UPDATE public.membership_tiers
     SET features = features || '{"regulatory_monitoring": true}'::jsonb
   WHERE tenant_id = p_tenant
     AND key = 'team'
     AND (features -> 'regulatory_monitoring') IS DISTINCT FROM 'true'::jsonb;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.membership_tiers
     SET description_pl = 'Pełny zakres Członka Pro dla każdego miejsca, jedna faktura, wspólne wejście do klubów.'
   WHERE tenant_id = p_tenant
     AND key = 'team'
     AND description_pl = 'Zakres Członka Pro dla każdego miejsca (bez monitoringu regulacyjnego), jedna faktura, wspólne wejście do klubów.';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.membership_tiers
     SET description_en = 'The full Member Pro scope for every seat, one invoice and joint entry to clubs.'
   WHERE tenant_id = p_tenant
     AND key = 'team'
     AND description_en = 'The Member Pro scope for every seat (without regulatory monitoring), one invoice and joint entry to clubs.';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- Benefity Zespołu: pozycja po pozycji, tylko element równy tekstowi
  -- katalogu (PL i EN razem); kolejność listy bez zmian.
  WITH swaps AS (
    SELECT mt.id,
           (SELECT jsonb_agg(
                     CASE
                       WHEN e.value = '{"pl":"Zakres progu Członek Pro dla każdego miejsca, bez monitoringu regulacyjnego","en":"The Member Pro scope for every seat, without regulatory monitoring"}'::jsonb
                         THEN '{"pl":"Pełny zakres Członka Pro dla każdego miejsca","en":"The full Member Pro scope for every seat"}'::jsonb
                       WHEN e.value = '{"pl":"Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce","en":"Expert correspondence: 3 requests a month per seat"}'::jsonb
                            AND (mt.features -> 'chat_direct_gated') = 'true'::jsonb
                         THEN '{"pl":"Korespondencja z ekspertami bez limitu dla każdego miejsca (kanał bezpośredni)","en":"Unlimited expert correspondence for every seat (direct channel)"}'::jsonb
                       ELSE e.value
                     END ORDER BY e.ord)
              FROM jsonb_array_elements(mt.benefits) WITH ORDINALITY AS e(value, ord)) AS benefits
      FROM public.membership_tiers mt
     WHERE mt.tenant_id = p_tenant
       AND mt.key = 'team'
       AND jsonb_typeof(mt.benefits) = 'array'
       AND jsonb_array_length(mt.benefits) > 0
  )
  UPDATE public.membership_tiers mt
     SET benefits = s.benefits
    FROM swaps s
   WHERE mt.id = s.id
     AND mt.benefits IS DISTINCT FROM s.benefits;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- (4) NGO: zakres Partnera Instytucjonalnego. Flagi Partnera z progu
  -- `partner` TEGO najemcy (admin mógł je dostosować), bez progu - z katalogu.
  SELECT COALESCE(
           (SELECT p.features FROM public.membership_tiers p
             WHERE p.tenant_id = p_tenant AND p.key = 'partner'
             ORDER BY p.created_at LIMIT 1),
           (SELECT c.features FROM public.pricing_catalog_v62_rows() c WHERE c.key = 'partner'),
           '{}'::jsonb)
    INTO v_partner;

  WITH merged AS (
    SELECT n.id,
           (SELECT jsonb_object_agg(k.key,
                     CASE
                       WHEN jsonb_typeof(n.features -> k.key) = 'number'
                            AND jsonb_typeof(v_partner -> k.key) = 'number'
                         THEN to_jsonb(GREATEST((n.features ->> k.key)::numeric, (v_partner ->> k.key)::numeric))
                       WHEN (n.features -> k.key) = 'true'::jsonb OR (v_partner -> k.key) = 'true'::jsonb
                         THEN 'true'::jsonb
                       ELSE COALESCE(n.features -> k.key, v_partner -> k.key)
                     END)
              FROM (SELECT jsonb_object_keys(n.features) AS key
                    UNION
                    SELECT jsonb_object_keys(v_partner)) k) AS features
      FROM public.membership_tiers n
     WHERE n.tenant_id = p_tenant
       AND n.key = 'ngo'
       AND jsonb_typeof(n.features) = 'object'
  )
  UPDATE public.membership_tiers n
     SET features = m.features
    FROM merged m
   WHERE n.id = m.id
     AND m.features IS NOT NULL
     AND n.features IS DISTINCT FROM m.features;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.membership_tiers
     SET rank = 40
   WHERE tenant_id = p_tenant AND key = 'ngo' AND rank < 40;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.membership_tiers
     SET sort_order = 85
   WHERE tenant_id = p_tenant AND key = 'ngo' AND sort_order = 50;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.membership_tiers
     SET description_pl = 'Zakres Partnera Instytucjonalnego w stawce -50% dla organizacji pozarządowych i think-tanków non-profit, po weryfikacji KRS lub statutu.'
   WHERE tenant_id = p_tenant
     AND key = 'ngo'
     AND description_pl = 'Stawka preferencyjna dla organizacji pozarządowych i think-tanków non-profit: -50% stawki Partnera Instytucjonalnego, po weryfikacji KRS lub statutu.';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.membership_tiers
     SET description_en = 'The Institutional Partner scope at 50% off for NGOs and non-profit think-tanks, after registry (KRS) or statute verification.'
   WHERE tenant_id = p_tenant
     AND key = 'ngo'
     AND description_en = 'A preferential rate for NGOs and non-profit think-tanks: 50% off the Institutional Partner rate, after registry (KRS) or statute verification.';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_rows + v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._pricing_v62_owner_decisions(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._pricing_v62_owner_decisions(uuid) IS
  'Hub I9b: decyzje właściciela 2026-10-20 u najemcy istniejącego - Zespół + tracker (kanał bezpośredni zostaje), NGO ranga 40 i flagi NGO ∪ Partner, opisy i benefity tylko tam, gdzie równe tekstowi katalogu v6.2. Zwraca liczbę zmian (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- C) Wszyscy najemcy.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

DO $apply$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public._pricing_v62_owner_decisions(r.id);
  END LOOP;
END
$apply$;

RESET lock_timeout;

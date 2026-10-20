-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b, 2/5): CENNIK v6.2 - DECYZJE WŁAŚCICIELA
-- O ZESPOLE I NGO (KATALOG PROGÓW SEEDU).
-- Decyzja właściciela 2026-10-20 (zgoda delegowana). Zasada nadrzędna:
-- obietnica v6.2 to MINIMUM - migracja nigdy nie odbiera uprawnień obecnym
-- klientom, brakujące DODAJE, nowy najemca (seed) dostaje dokładnie v6.2.
--
-- DEFEKT (obietnice v6.2 bez pokrycia, lista z PR #520)
--   1. Zespół „pełny zakres Pro": próg `team` nie miał `regulatory_monitoring`
--      (bramka trackera UE), a opis karty dopisywał „bez monitoringu".
--   2. Zespół „3 zapytania do ekspertów na miejsce": seed dawał
--      `chat_direct_gated` (kanał bez limitu) zamiast puli 3.
--   4. NGO: v6.2 sprzedaje zakres rangi 40 (Partner Instytucjonalny -50%),
--      a próg `ngo` miał rangę 20 i zakres Członka Pro bez trackera.
--   (3 - limit miejsc: 20261020160300; 5 - pula 2/5 u istniejących: bez
--   zmian, brak obniżki; 6 - pytania do archiwum: funkcja nie istnieje.)
--
-- ZMIANA
--   `pricing_catalog_v62_rows()` (seed nowego najemcy i prezentacja apply):
--   Zespół = zakres Pro + `regulatory_monitoring` + `expert_request_quota` 3,
--   BEZ `chat_direct_gated`; NGO = ranga 40, flagi dawnego NGO ∪ flagi
--   Partnera, `sort_order` 85 (remis rangi 40: Partner pierwszy); nowe opisy
--   kart PL/EN. Seed i apply czytają tę funkcję w chwili wywołania - nowy
--   najemca od razu dostaje katalog z decyzjami. Najemcy istniejący
--   (dodanie trackera, NGO ∪ Partner, ranga, opisy i benefity tylko tam,
--   gdzie admin ich nie zmienił) - 20261020160200, razem z benefitami.
--
-- SKUTKI RANGI 40 DLA NGO (opis w dzienniku wdrożenia, §21): kluby, treści
-- i wydarzenia z `min_tier_rank` ≤ 40 jak Partner; licznik artykułów (P19,
-- 20261020120200) nie odblokowuje niczego ponad rangę - ranga wyższa daje
-- więcej, nie mniej; ranga nie jest unikalna (indeks (tenant_id, rank DESC)
-- nieunikalny) - remis z Partnerem rozstrzyga `sort_order`.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261018160300 (seed i apply v6.2), przed
-- 20261020160200 (najemcy istniejący czytają flagi Partnera z katalogu).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (CIALO-Z niżej), bez zapisu
-- danych.
-- DOWÓD: supabase/tests/hub_i9b_pricing_decisions_test.sql (seed: flagi,
-- ranga, opisy), supabase/tests/pricing_catalog_v62_test.sql,
-- src/lib/billing/__tests__/tierCatalogParity.test.ts (rangi TS ⇄ SQL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Katalog progów v6.2 z decyzjami.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261018160100
CREATE OR REPLACE FUNCTION public.pricing_catalog_v62_rows()
RETURNS TABLE (
  key text, rank integer, name_pl text, name_en text,
  desc_pl text, desc_en text, features jsonb,
  is_default boolean, sort_order integer, audience_key text,
  badge_pl text, badge_en text, highlight boolean,
  per_seat boolean, price_note_pl text, price_note_en text, cta_mode text,
  pricing_visible boolean, apply_presentation boolean
)
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (VALUES
    -- ------------------------------------------------------------- Dla Ciebie
    ('reader', 0, 'Czytelnik', 'Reader',
     'Konto w ekosystemie NES. Bez karty płatniczej, bez zobowiązania.',
     'An account in the NES ecosystem. No payment card, no commitment.',
     '{}'::jsonb,
     true, 0, 'individual', NULL, NULL, false,
     false, NULL, NULL, 'auto', true, true),
    -- Wspierający: v6.2 nazywa ten próg WYCOFANYM - darowizna wróciła na
    -- własną ścieżkę (bezwarunkowy pasek darowizny na /pricing ze zdaniem
    -- „nie jest progiem członkostwa i nie daje pakietu benefitów"). Próg
    -- zostaje (status nadawany po darowiźnie, `tg_donations_grant_supporter`),
    -- ale nie jest kartą cennika, a jego opis nie obiecuje żadnego benefitu -
    -- inaczej pasek przeczyłby sam sobie.
    ('supporter', 5, 'Wspierający', 'Supporter',
     'Status nadawany po darowiźnie na rzecz instytutu. Darowizna nie jest progiem członkostwa i nie daje pakietu benefitów.',
     'A status granted after a donation to the institute. A donation is not a membership tier and comes with no benefit package.',
     '{"supporter_updates": true}'::jsonb,
     false, 5, 'individual', NULL, NULL, false,
     false, NULL, NULL, 'auto', false, true),
    ('member', 10, 'Członek', 'Member',
     'Pełne archiwum, wszystkie wydarzenia członkowskie i jedno wydarzenie biletowane w roku.',
     'The full archive, every member event and one ticketed event a year.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "chat_enabled": true, "expert_request_quota": 1, "included_event_tickets": 1}'::jsonb,
     false, 10, 'individual', NULL, NULL, false,
     false, NULL, NULL, 'auto', true, true),
    -- Wyróżnienie na Członku Pro: v6.2 nie wskazuje karty z badge'em, ale
    -- wyznacza cel - Pro ma mieć 50-70% płacących (zakładka „Pomiar").
    ('pro', 20, 'Członek Pro', 'Member Pro',
     'Klub dyskusyjny, monitoring regulacyjny i cztery zamknięte briefingi w roku.',
     'A discussion club, regulatory monitoring and four closed-door briefings a year.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chatham_house_events": true, "early_access": true, "expert_request_quota": 3, "included_event_tickets": 1}'::jsonb,
     false, 20, 'individual', 'Najpopularniejszy', 'Most popular', true,
     false, NULL, NULL, 'auto', true, true),
    -- Rada Instytutu: „od 6 000 zł/rok · rozmowa" - bez planu i bez kasy.
    ('vip', 25, 'Rada Instytutu', 'Institute Council',
     'Dwa Decision Laby, Zjazd Rady i prawo głosu wobec rekomendacji przed publikacją.',
     'Two Decision Labs, the Council Assembly and a voice on recommendations before publication.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "vip_concierge": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "included_event_tickets": 1}'::jsonb,
     false, 25, 'individual', NULL, NULL, false,
     false, 'od 6 000 zł rocznie', 'from PLN 6,000 a year · agreement in PLN, invoiced', 'contact', true, true),
    -- ------------------------------------------------------ Program Akademicki
    -- Stawki akademickie: v6.2 - „ten sam zakres TREŚCIOWY" co Członek, ale
    -- bez wliczonego biletu (zniżka 50%) i bez zapytań do ekspertów (próg
    -- nie ma `expert_request_quota`). Kadra dodatkowo: licencja dydaktyczna [P].
    ('student', 10, 'Student i Doktorant', 'Student & Doctoral Candidate',
     'Ten sam zakres treściowy co Członek, w stawce studenckiej - zamiast wliczonego biletu zniżka 50% na wydarzenia biletowane.',
     'The same content scope as Member at a student rate - 50% off ticketed events in place of an included ticket.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "chat_enabled": true, "event_ticket_discount_pct": 50}'::jsonb,
     false, 30, 'academic', NULL, NULL, false,
     false, NULL, NULL, 'auto', true, true),
    ('educator', 10, 'Kadra Akademicka', 'Academic Faculty',
     'Dla wykładowców i pracowników naukowych: zakres stawki studenckiej oraz licencja na wykorzystanie analiz na zajęciach.',
     'For lecturers and researchers: the student-rate scope plus a licence to use analyses in class.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "chat_enabled": true, "teaching_licence": true, "event_ticket_discount_pct": 50}'::jsonb,
     false, 40, 'academic', NULL, NULL, false,
     false, NULL, NULL, 'auto', true, true),
    -- NGO (decyzja właściciela 2026-10-20, I9b): v6.2 sprzedaje organizacjom
    -- pozarządowym ZAKRES Partnera Instytucjonalnego w stawce -50%, więc próg
    -- ma rangę 40 i features = flagi dawnego progu NGO ∪ flagi Partnera (nic
    -- nie odebrane - pula 3 zapytań zostaje, choć kanał bezpośredni ją
    -- zastępuje). `sort_order` 85: kafel zostaje w segmencie akademickim, a
    -- w listach sortowanych rangą (remis 40) Partner (80) poprzedza NGO -
    -- ściana płatności nazywa wtedy próg ogólny, nie stawkę po weryfikacji.
    ('ngo', 40, 'Organizacja Non-profit', 'Non-profit Organisation',
     'Zakres Partnera Instytucjonalnego w stawce -50% dla organizacji pozarządowych i think-tanków non-profit, po weryfikacji KRS lub statutu.',
     'The Institutional Partner scope at 50% off for NGOs and non-profit think-tanks, after registry (KRS) or statute verification.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "strategic_partner": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "expert_request_quota": 3, "included_event_tickets": 1}'::jsonb,
     false, 85, 'academic', NULL, NULL, false,
     false, '-50% stawki Partnera Instytucjonalnego · po weryfikacji KRS lub statutu',
     '50% off the Institutional Partner rate · after KRS or statute verification', 'contact', true, true),
    -- ------------------------------------------------------------ Dla zespolow
    -- Zespół (decyzja właściciela 2026-10-20, I9b): pełny zakres Pro razem
    -- z monitoringiem regulacyjnym (bramka trackera) i pula 3 zapytań do
    -- ekspertów na miejsce - DOKŁADNIE v6.2, więc nowy najemca nie dostaje
    -- kanału bezpośredniego (`chat_direct_gated`). Najemcy istniejący go
    -- zachowują (brak obniżki w opłaconym okresie - UPDATE niżej dokłada
    -- tylko tracker). Sprzedaż przez rozmowę (3-20 miejsc): plan `team` poza
    -- sprzedażą samoobsługową (`for_sale = false`, 20261018160300), limit
    -- 20 miejsc egzekwuje 20261020160300. Nota EN bez kwoty w PLN - karta EN
    -- pokazuje cenę w EUR (`formatDisplayMoney`).
    ('team', 25, 'Zespół', 'Team',
     'Pełny zakres Członka Pro dla każdego miejsca, jedna faktura, wspólne wejście do klubów.',
     'The full Member Pro scope for every seat, one invoice and joint entry to clubs.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chatham_house_events": true, "early_access": true, "expert_request_quota": 3, "included_event_tickets_org": 3}'::jsonb,
     false, 60, 'team', NULL, NULL, false,
     true, '3-20 miejsc · od 11 miejsc 79 zł za miejsce', '3-20 seats · a lower per-seat rate from 11 seats',
     'contact', true, true),
    -- --------------------------------------------------------------- Dla firm
    -- Partner Biznesowy: wycofany ze sprzedaży (decyzja 3). Próg zostaje
    -- w drabince (ranga 28, uprawnienia obecnych klientów), karta znika.
    ('business', 28, 'Partner Biznesowy', 'Business Partner',
     'Samoobsługowa subskrypcja dla firm: pełen zakres Pro, briefing sektorowy i status partnera biznesowego - w cyklu 2 tygodni, miesiąca lub kwartału.',
     'A self-serve business subscription: the full Pro scope, a sector briefing and business partner status - billed every 2 weeks, monthly or quarterly.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "expert_request_quota": 3}'::jsonb,
     false, 65, 'business', 'Nowość', 'New', false,
     false, NULL, NULL, 'auto', false, false),
    -- Enterprise: karta ukryta (decyzja 4), próg i ranga 30 zostają - to też
    -- próg klubów i wydarzeń (20260822090000 przemapował na nią rangę 28).
    ('corporate', 30, 'Enterprise', 'Enterprise',
     'Pula miejsc Pro dla organizacji, wspólna biblioteka i opiekun wdrożenia.',
     'A pool of Pro seats for your organisation, a shared library and guided onboarding.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "included_event_tickets": 1}'::jsonb,
     false, 70, 'business', NULL, NULL, false,
     false, NULL, NULL, 'auto', false, false),
    -- Progi instytucjonalne: ceny wywoławcze „od", bez publicznego planu.
    ('partner', 40, 'Partner Instytucjonalny', 'Institutional Partner',
     'Do 10 osób nominowanych z pełnym zakresem Pro, Decision Lab z dwoma miejscami i sounding board.',
     'Up to 10 nominated people with the full Pro scope, a Decision Lab with two seats and a sounding board.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "strategic_partner": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "included_event_tickets": 1}'::jsonb,
     false, 80, 'business', NULL, NULL, false,
     false, 'od 24 000 zł rocznie', 'from PLN 24,000 a year · agreement in PLN, invoiced', 'contact', true, true),
    ('partner_general', 50, 'Partner Strategiczny', 'Strategic Partner',
     'Do 25 osób nominowanych i własna grupa zadaniowa zakończona raportem sygnowanym wspólnie.',
     'Up to 25 nominated people and an own task force closing with a co-signed report.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "strategic_partner": true, "general_partner": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "included_event_tickets": 1}'::jsonb,
     false, 90, 'business', NULL, NULL, false,
     false, 'od 60 000 zł rocznie', 'from PLN 60,000 a year · agreement in PLN, invoiced', 'contact', true, true),
    -- Krąg Założycieli: na zaproszenie - bez przycisku (cta_mode 'none').
    ('presidents_circle', 60, 'Krąg Założycieli', 'Founders'' Circle',
     'Grono fundatorów instytutu: bez limitu osób, z jawną granicą wpływu na agendę. Na zaproszenie.',
     'The institute''s founders: no limit on people, with a published boundary of influence over the agenda. By invitation.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "strategic_partner": true, "presidents_circle": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "included_event_tickets": 1}'::jsonb,
     false, 100, 'business', NULL, NULL, false,
     false, 'od 120 000 zł rocznie · na zaproszenie', 'from PLN 120,000 a year · by invitation · agreement in PLN, invoiced',
     'none', true, true)
  ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, features,
         is_default, sort_order, audience_key, badge_pl, badge_en, highlight,
         per_seat, price_note_pl, price_note_en, cta_mode, pricing_visible,
         apply_presentation);
$$;

REVOKE ALL ON FUNCTION public.pricing_catalog_v62_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_v62_rows() TO service_role;

COMMENT ON FUNCTION public.pricing_catalog_v62_rows() IS
  'Katalog progów v6.2 (docs/cennik-nes-v6.2.html) z decyzjami właściciela 2026-10-20 (Zespół: tracker i pula 3 zapytań; NGO: ranga 40 i zakres Partnera): struktura, prezentacja i pełne features seedu. Jedno źródło dla seed_membership_tiers i apply_pricing_catalog_v62.';


-- ============================================================================
-- CENNIK v6.2 (2/5): KANONICZNE WIERSZE PROGÓW
--
-- Jedno źródło katalogu v6.2 (docs/cennik-nes-v6.2.html) dla DWÓCH ścieżek:
--   * seed nowego najemcy (`seed_membership_tiers`, 20261018160300) - wstawia
--     próg razem z pełnymi `features`,
--   * apply u najemców istniejących (`apply_pricing_catalog_v62`) - nadpisuje
--     WYŁĄCZNIE prezentację (nazwy, opisy, segment, wyróżnienie, CTA, notę
--     ceny, widoczność). `features`, rangi, `active` i `is_default` u najemców
--     istniejących zostają nietknięte: v6.2 nie zmienia mechaniki, a ręczne
--     flagi admina z panelu nie mogą zniknąć przy zmianie cennika.
--
-- DLACZEGO PEŁNE `features` W SEEDZIE. Dotychczasowy seed (v3 + punktowe
-- łatki z 20260724090000) nie znał bramek v6.1: świeży najemca nie miał puli
-- biletów, reguły Chatham House ani przeniesienia wczesnego dostępu na Pro -
-- a próg Członek dostawał `early_access`, którego katalog od v6 mu nie
-- obiecuje. Wiersze niżej odtwarzają EFEKTYWNY stan po v3, v4, v5 i v6.1
-- (dowód: odczyt `membership_tiers` najemcy domyślnego), więc nowy najemca
-- startuje dokładnie w tym miejscu, w którym jest najemca istniejący.
--
-- PULA ZAPYTAŃ DO EKSPERTÓW: v6.2 - Członek 1, Pro 3 miesięcznie („flaga
-- chat_inmail_quota_2/5 obniżona do 1/3"). `my_expert_request_quota` liczy
-- GREATEST(expert_request_quota, dawne chat_inmail_quota_2 -> 2, _5 -> 5),
-- więc seed NIE wstawia już dawnych flag: nowy najemca dostaje dokładnie
-- 1 / 3. U najemców istniejących flagi zostają (apply nie rusza features -
-- obniżenie puli obecnym członkom to decyzja właściciela; rozjazd w raporcie).
--
-- Nazwy EN: dokument v6.2 jest wyłącznie po polsku; odpowiedniki angielskie
-- pochodzą z treści, którą v6.1 już wdrożyła w kartach (np. „All of Reader,
-- plus:", „The full Member Pro scope for every seat"). Uwaga na kolizję:
-- dawna angielska nazwa rangi 40 brzmiała „Strategic Partner" - w v6.2 to
-- nazwa rangi 50. CRM i bramki używają kluczy, nie nazw.
--
-- `apply_presentation = false`: progi poza prezentacją v6.2 (Partner
-- Biznesowy wycofany ze sprzedaży, Enterprise ukryty). Apply rusza w nich
-- tylko `pricing_visible` i wyróżnienie; treść zostaje taka, jaką widzą
-- obecni klienci w profilu.
--
-- `decision_lab` świadomie poza tą funkcją (jak w 20260822094000): to wpis
-- techniczny mostka plan -> warstwa, nie próg drabinki. Zakłada go
-- `seed_decision_lab_product`.
--
-- Strażnik `tierCatalogParity.test.ts` czyta tę funkcję z dysku: krotki
-- zaczynają się od `('key', rank, '`, a `features` są płaskimi literałami
-- `'{...}'::jsonb` - zagnieżdżony obiekt rozjechałby jego skan.
-- ============================================================================

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
    -- NGO: v6.2 wycenia organizacje pozarządowe jako Partnera Instytucjonalnego
    -- z rabatem 50% po weryfikacji KRS lub statutu. Mechanika progu (ranga 20,
    -- bez monitoringu regulacyjnego i kanału bezpośredniego) zostaje - decyzja
    -- właściciela: rabat to nota ceny i opis, bez zmiany mechaniki. Karta NIE
    -- obiecuje więc zakresu rangi 40, którego próg nie daje (rozjazd zgłoszony
    -- w raporcie); stawkę i zakres ustala umowa, karta prowadzi do rozmowy.
    ('ngo', 20, 'Organizacja Non-profit', 'Non-profit Organisation',
     'Stawka preferencyjna dla organizacji pozarządowych i think-tanków non-profit: -50% stawki Partnera Instytucjonalnego, po weryfikacji KRS lub statutu.',
     'A preferential rate for NGOs and non-profit think-tanks: 50% off the Institutional Partner rate, after registry (KRS) or statute verification.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "gift_links": true, "chat_enabled": true, "chatham_house_events": true, "early_access": true, "expert_request_quota": 3, "included_event_tickets": 1}'::jsonb,
     false, 50, 'academic', NULL, NULL, false,
     false, '-50% stawki Partnera Instytucjonalnego · po weryfikacji KRS lub statutu',
     '50% off the Institutional Partner rate · after KRS or statute verification', 'contact', true, true),
    -- ------------------------------------------------------------ Dla zespolow
    -- Zespół: v6.2 obiecuje „pełny zakres Pro dla każdego miejsca", ale próg
    -- nie ma flagi `regulatory_monitoring` (bramka trackera UE) - karta mówi
    -- więc, co daje bramka, a rozjazd idzie do raportu. Sprzedaż przez rozmowę
    -- (3-20 miejsc): plan `team` nie jest w sprzedaży samoobsługowej
    -- (`for_sale = false`, 20261018160300). Nota EN bez kwoty w PLN - karta
    -- w wersji EN pokazuje cenę w EUR (`formatDisplayMoney`).
    ('team', 25, 'Zespół', 'Team',
     'Zakres Członka Pro dla każdego miejsca (bez monitoringu regulacyjnego), jedna faktura, wspólne wejście do klubów.',
     'The Member Pro scope for every seat (without regulatory monitoring), one invoice and joint entry to clubs.',
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "gift_links": true, "chat_enabled": true, "chat_direct_gated": true, "chatham_house_events": true, "early_access": true, "included_event_tickets_org": 3}'::jsonb,
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

REVOKE EXECUTE ON FUNCTION public.pricing_catalog_v62_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_v62_rows() TO service_role;

COMMENT ON FUNCTION public.pricing_catalog_v62_rows() IS
  'Katalog progów v6.2 (docs/cennik-nes-v6.2.html): struktura, prezentacja i pełne features seedu. Jedno źródło dla seed_membership_tiers i apply_pricing_catalog_v62.';

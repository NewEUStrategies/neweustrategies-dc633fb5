-- ============================================================================
-- Katalog cennika v4: benefity progów indywidualnych wg macierzy NES.
--
-- Kontekst: audyt macierzy progów (NES_macierz_progow) wykazał, że plan Plus
-- na żywej platformie jest uboższy niż model z Confluence - brakowało narzędzi
-- cytowania, panelu „Analiza Tygodnia", cyklu „Learning Path" i jawnego pełnego
-- dostępu audio-wideo. Część świadczeń z Confluence (karta VIP, zgłoszenie
-- tematu badawczego, grupa robocza, mentoring Career Path, Zjazd VIP) nie miała
-- odzwierciedlenia na żadnym progu. Ta migracja domyka copy benefitów dla
-- progów indywidualnych + osadza świadczenia z Confluence na progach z kolumny
-- „Rekomendowany próg docelowy".
--
-- Zakres: WYŁĄCZNIE `membership_tiers.benefits` (copy marketingowy, jsonb
-- PL/EN + nagłówki grup FT). Świadomie NIE dotykamy `features` - bramki
-- maszynowe pozostają dokładnie te, które platforma realnie egzekwuje
-- (rejestr TIER_CAPABILITIES zostaje uczciwy: brak nowych flag bez bramki).
-- Nowe benefity to obietnice redakcyjne/relacyjne albo funkcje już istniejące
-- (boks cytowań Chicago/APA/BibTeX, podcast) - nie wymagają nowej bramki.
--
-- Objęte progi: reader, member, pro, vip, partner_general. Progi firmowe i
-- akademickie z sekcji 2-3 macierzy są już wiernie odwzorowane w katalogu v3,
-- więc ich nie ruszamy (poza dodaniem tematu badawczego do Partnera Generalnego).
--
-- Bezpieczeństwo/spójność: force-update copy (tak jak apply_pricing_catalog_v3);
-- admin może edytować benefity po migracji, a panel cennika i publiczny
-- /pricing czytają tę samą kolumnę. Idempotentne.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pricing_catalog_v4_benefits()
RETURNS TABLE (key text, benefits jsonb)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    -- ----------------------------------------------------------- Essential
    ('reader',
     '[{"pl":"Do 5 artykułów i analiz miesięcznie","en":"Up to 5 articles and analyses per month"},
       {"pl":"Policy papers we fragmentach z kluczowymi wnioskami","en":"Policy papers as excerpts with key takeaways"},
       {"pl":"Cotygodniowy przegląd geopolityczny na e-mail","en":"A weekly geopolitical review by e-mail"},
       {"pl":"Personalizacja kanału: zakładki i obserwowanie tematów","en":"A personalised feed: bookmarks and topic follows"},
       {"pl":"Udział w otwartych dyskusjach społeczności","en":"Take part in open community discussions"}]'::jsonb),
    -- ----------------------------------------------------------------- Plus
    ('member',
     '[{"pl":"Pełne archiwum analiz i policy papers, bez limitów","en":"The full archive of analyses and policy papers, no limits",
        "group_pl":"Wszystko z planu Essential, oraz:","group_en":"Everything in Essential, plus:"},
       {"pl":"Wczesny dostęp do raportów przed publikacją otwartą","en":"Early access to reports ahead of open publication"},
       {"pl":"Pogłębiony digest członkowski - analiza, nie nagłówki","en":"A members-only in-depth digest - analysis, not headlines"},
       {"pl":"Briefingi i wydarzenia członkowskie online wraz z nagraniami","en":"Online member briefings and events, with recordings"},
       {"pl":"Zniżka na konferencję „Geopolityczna Gra Mocarstw” i wydarzenia biletowane","en":"A discount on the „Geopolityczna Gra Mocarstw” conference and ticketed events"},
       {"pl":"Pełny dostęp do podcastu „Depesza Dyplomaty”, wywiadów i materiałów audio-wideo","en":"Full access to the „Depesza Dyplomaty” podcast, interviews and audio-video",
        "group_pl":"Narzędzia i materiały członkowskie:","group_en":"Member tools and materials:"},
       {"pl":"Panel „Analiza Tygodnia”: mapy, wykresy i dane w pigułce","en":"The „Analysis of the Week” panel: maps, charts and data at a glance"},
       {"pl":"Cykl „Learning Path”: kuratorowane listy lektur i ścieżki tematyczne","en":"„Learning Path”: curated reading lists and thematic tracks"},
       {"pl":"Narzędzia cytowania pełnych analiz (Chicago, APA, BibTeX)","en":"Citation tools for full analyses (Chicago, APA, BibTeX)"},
       {"pl":"Anulowanie w każdej chwili","en":"Cancel anytime"}]'::jsonb),
    -- ------------------------------------------------------------------ Pro
    ('pro',
     '[{"pl":"Monitoring regulacyjny (GRAS) z alertami o zmianach w wybranych obszarach","en":"Regulatory monitoring (GRAS) with alerts on changes in your chosen areas",
        "group_pl":"Wszystko z planu Plus, oraz:","group_en":"Everything in Plus, plus:"},
       {"pl":"Priorytet pytań w sesjach Q&A z ekspertami","en":"Priority questions in expert Q&A sessions"},
       {"pl":"Zamknięte briefingi Pro ze scenariuszami i foresightem","en":"Closed-door Pro briefings with scenarios and foresight"},
       {"pl":"Kwartalna nota foresightowa z rekomendacjami","en":"A quarterly foresight note with recommendations"},
       {"pl":"Fotele obserwatora na wybranych Decision Labs","en":"Observer seats at selected Decision Labs"},
       {"pl":"Zamknięta grupa robocza ekspertów (Slack/Teams)","en":"A closed expert working group (Slack/Teams)"}]'::jsonb),
    -- ------------------------------------------------------------------ VIP
    ('vip',
     '[{"pl":"Bezpośrednie konsultacje z ekspertami New European Strategies","en":"Direct consultations with New European Strategies experts",
        "group_pl":"Wszystko z planu Pro, oraz:","group_en":"Everything in Pro, plus:"},
       {"pl":"Osobisty opiekun i indywidualny onboarding","en":"A personal account manager and individual onboarding"},
       {"pl":"Karta członkowska VIP - fizyczna i cyfrowa","en":"A VIP membership card - physical and digital"},
       {"pl":"Prawo zgłoszenia własnego tematu badawczego","en":"The right to propose your own research topic"},
       {"pl":"Sesja mentoringowa „Career Path” i kuratorowane wprowadzenia do sieci","en":"A „Career Path” mentoring session and curated network introductions"},
       {"pl":"Zaproszenie na roczny Zjazd VIP i zamknięte kolacje eksperckie","en":"An invitation to the annual VIP Summit and closed expert dinners"},
       {"pl":"Pakiet materiałów drukowanych co pół roku","en":"A printed materials pack every six months"}]'::jsonb),
    -- ----------------------------------------------------- Partner Generalny
    ('partner_general',
     '[{"pl":"Pełny dostęp dla całej organizacji, bez limitu miejsc","en":"Full access for the whole organisation, with no seat limit",
        "group_pl":"Wszystko ze Strategic Partner, oraz:","group_en":"Everything in Strategic Partner, plus:"},
       {"pl":"Dedykowany analityk prowadzący","en":"A dedicated lead analyst"},
       {"pl":"Współsygnowane badania i publikacje","en":"Co-signed research and publications"},
       {"pl":"Prawo zgłoszenia tematu badawczego i miejsce w panelu recenzenckim publikacji","en":"The right to propose a research topic and a seat on the publication review panel"},
       {"pl":"Slot prelegencki na konferencji New European Strategies","en":"A speaking slot at the New European Strategies conference"},
       {"pl":"Kolacje eksperckie na poziomie zarządu","en":"Expert dinners at board level"}]'::jsonb)
  ) AS v(key, benefits);
$$;

REVOKE EXECUTE ON FUNCTION public.pricing_catalog_v4_benefits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_v4_benefits() TO service_role;

-- Force-update copy benefitów z katalogu v4 (tylko objęte progi; features
-- nietknięte). Admin edytuje po migracji; /pricing i panel czytają tę kolumnę.
CREATE OR REPLACE FUNCTION public.apply_pricing_catalog_v4(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.membership_tiers mt
     SET benefits = v.benefits
    FROM public.pricing_catalog_v4_benefits() v
   WHERE mt.tenant_id = p_tenant AND mt.key = v.key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_pricing_catalog_v4(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pricing_catalog_v4(uuid) TO service_role;

-- Nowe tenanty: seed_pricing_defaults dokłada v4 po zaseedowaniu katalogu v3
-- (pełne ciało z kroku regulatory_monitoring + krok v4 na końcu).
CREATE OR REPLACE FUNCTION public.seed_pricing_defaults(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_pricing_audiences(p_tenant);
  PERFORM public.seed_membership_tiers(p_tenant);

  UPDATE public.membership_tiers
     SET audience_key = CASE
       WHEN key IN ('reader', 'supporter', 'member', 'pro', 'vip') THEN 'individual'
       WHEN key IN ('corporate', 'partner', 'partner_general', 'presidents_circle')
         THEN 'business'
       WHEN key IN ('student', 'educator', 'ngo') THEN 'academic'
       WHEN key = 'team' THEN 'team'
       ELSE audience_key
     END
   WHERE tenant_id = p_tenant AND audience_key IS NULL;

  -- Monitoring regulacyjny (tracker) - benefit Pro i wyżej.
  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('regulatory_monitoring', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'regulatory_monitoring');

  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
  -- Benefity progów indywidualnych wg macierzy NES (v4).
  PERFORM public.apply_pricing_catalog_v4(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

-- Istniejące tenanty: force-update copy benefitów do v4.
DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.apply_pricing_catalog_v4(v_t);
  END LOOP;
END $$;

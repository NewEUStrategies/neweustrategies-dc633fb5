-- ============================================================================
-- CENNIK 3.0 + RETENCJA (PR #67).
-- ============================================================================

ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS per_seat boolean NOT NULL DEFAULT false;
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS price_note_pl text;
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS price_note_en text;
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS cta_mode text NOT NULL DEFAULT 'auto';
DO $$
BEGIN
  ALTER TABLE public.membership_tiers
    ADD CONSTRAINT membership_tiers_cta_mode_check
    CHECK (cta_mode IN ('auto', 'contact', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.pricing_audiences ADD COLUMN IF NOT EXISTS trust_pl text;
ALTER TABLE public.pricing_audiences ADD COLUMN IF NOT EXISTS trust_en text;

CREATE OR REPLACE FUNCTION public.pricing_catalog_v3_rows()
RETURNS TABLE (
  key text, rank integer, name_pl text, name_en text,
  desc_pl text, desc_en text, benefits jsonb, features jsonb,
  is_default boolean, sort_order integer, audience_key text,
  badge_pl text, badge_en text, highlight boolean,
  per_seat boolean, price_note_pl text, price_note_en text, cta_mode text
)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('reader', 0, 'Essential', 'Essential',
     'Start w ekosystemie New European Strategies - przegląd, wybrane analizy i personalizacja. 0 zł, bez karty.',
     'Your start in the New European Strategies ecosystem - the review, selected analyses and personalisation. Free, no card.',
     '[{"pl":"Cotygodniowy przegląd geopolityczny na e-mail","en":"A weekly geopolitical review by e-mail"},
       {"pl":"Dostęp do wybranych analiz otwartych i zapowiedzi wydarzeń","en":"Access to selected open analyses and event announcements"},
       {"pl":"Zakładki, obserwowanie tematów i personalizacja kanału treści","en":"Bookmarks, topic follows and a personalised content feed"},
       {"pl":"Udział w otwartych dyskusjach społeczności","en":"Take part in open community discussions"},
       {"pl":"Powiadomienia o nowych publikacjach w śledzonych obszarach","en":"Alerts about new publications in the areas you follow"}]'::jsonb,
     '{}'::jsonb,
     true, 0, 'individual', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('supporter', 5, 'Wspierający', 'Supporter',
     'Darowizna wspiera niezależność instytutu; wspierający otrzymują dedykowane aktualizacje.',
     'A donation supports the institute''s independence; supporters receive dedicated updates.',
     '[{"pl":"Wszystko z planu Essential","en":"Everything in Essential"},
       {"pl":"Aktualizacje i podsumowania dla wspierających","en":"Supporter updates and briefings"},
       {"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb,
     '{"supporter_updates": true}'::jsonb,
     false, 5, 'individual', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('member', 10, 'Plus', 'Plus',
     'Rdzeń członkostwa: pełne archiwum, wydarzenia członkowskie i pogłębiony digest.',
     'The core membership: the full archive, member events and the in-depth digest.',
     '[{"pl":"Pełne archiwum analiz i policy papers, bez limitów","en":"The full archive of analyses and policy papers, no limits",
        "group_pl":"Wszystko z Essential, oraz:","group_en":"All of Essential, plus:"},
       {"pl":"Briefingi i wydarzenia członkowskie online wraz z nagraniami na żądanie","en":"Online member briefings and events, with recordings on demand"},
       {"pl":"Pogłębiony digest tylko dla członków - analiza, nie nagłówki","en":"A members-only in-depth digest - analysis, not headlines"},
       {"pl":"Wczesny dostęp do raportów przed publikacją otwartą","en":"Early access to reports ahead of open publication"},
       {"pl":"Zniżka na konferencję „Geopolityczna Gra Mocarstw” i wydarzenia biletowane","en":"A discount on the „Geopolityczna Gra Mocarstw” conference and ticketed events"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "early_access": true}'::jsonb,
     false, 10, 'individual', 'Najpopularniejszy', 'Most popular', true, false, NULL, NULL, 'auto'),
    ('pro', 20, 'Pro', 'Pro',
     'Dla profesjonalistów: monitoring regulacyjny, foresight i zamknięte briefingi Pro.',
     'For professionals: regulatory monitoring, foresight and closed-door Pro briefings.',
     '[{"pl":"Monitoring regulacyjny z alertami o zmianach w wybranych obszarach","en":"Regulatory monitoring with alerts on changes in your chosen areas",
        "group_pl":"Wszystko z Plus, oraz:","group_en":"All of Plus, plus:"},
       {"pl":"Priorytet pytań w sesjach Q&A z ekspertami","en":"Priority questions in expert Q&A sessions"},
       {"pl":"Zamknięte briefingi Pro ze scenariuszami i foresightem","en":"Closed-door Pro briefings with scenarios and foresight"},
       {"pl":"Fotele obserwatora na wybranych Decision Labs","en":"Observer seats at selected Decision Labs"},
       {"pl":"Kwartalna nota foresightowa z rekomendacjami","en":"A quarterly foresight note with recommendations"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true}'::jsonb,
     false, 20, 'individual', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('vip', 25, 'VIP', 'VIP',
     'Relacja, nie tylko dostęp: konsultacje z ekspertami, wprowadzenia i wąskie grono.',
     'A relationship, not just access: expert consultations, introductions and a small circle.',
     '[{"pl":"Bezpośredni kontakt z ekspertami New European Strategies w trybie konsultacji","en":"Direct access to New European Strategies experts in a consultation format",
        "group_pl":"Wszystko z Pro, oraz:","group_en":"All of Pro, plus:"},
       {"pl":"Osobisty opiekun i indywidualny onboarding","en":"A personal account manager and individual onboarding"},
       {"pl":"Kuratorowane wprowadzenia do sieci kontaktów","en":"Curated introductions across the network"},
       {"pl":"Dostęp do ekosystemu profesjonalnej sieci - społeczności praktyków i decydentów","en":"Access to the professional network ecosystem - a community of practitioners and decision-makers"},
       {"pl":"Zaproszenia na zamknięte kolacje i spotkania w wąskim gronie","en":"Invitations to closed dinners and small-group meetings"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "vip_concierge": true}'::jsonb,
     false, 25, 'individual', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('corporate', 30, 'Enterprise', 'Enterprise',
     'Pula miejsc Pro dla organizacji, wspólna biblioteka i opiekun wdrożenia.',
     'A pool of Pro seats for your organisation, a shared library and guided onboarding.',
     '[{"pl":"Pula miejsc z pełnym zakresem Pro dla każdego użytkownika","en":"A seat pool with the full Pro scope for every user"},
       {"pl":"Wspólna biblioteka materiałów i archiwum dla organizacji","en":"A shared library of materials and an organisation archive"},
       {"pl":"Kwartalny briefing dla organizacji","en":"A quarterly briefing for your organisation"},
       {"pl":"Panel administracyjny do zarządzania miejscami i uprawnieniami","en":"An admin panel for managing seats and permissions"},
       {"pl":"Faktura i umowa roczna z opiekunem wdrożenia","en":"Invoicing and an annual agreement with an onboarding manager"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true}'::jsonb,
     false, 70, 'business', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('partner', 40, 'Strategic Partner', 'Strategic Partner',
     'Partnerstwo z dedykowanymi briefingami i bezpośrednim dostępem do analityków.',
     'A partnership with dedicated briefings and direct analyst access.',
     '[{"pl":"Większa pula miejsc dla organizacji","en":"A larger seat pool for the organisation",
        "group_pl":"Wszystko z Enterprise, oraz:","group_en":"All of Enterprise, plus:"},
       {"pl":"Dedykowane briefingi szyte na miarę","en":"Dedicated, tailor-made briefings"},
       {"pl":"Pula godzin bezpośredniego dostępu do analityka","en":"A pool of hours of direct analyst access"},
       {"pl":"Prywatny Decision Lab raz w roku","en":"A private Decision Lab once a year"},
       {"pl":"Wyróżnienie jako partner na stronie New European Strategies","en":"Recognition as a partner on the New European Strategies site"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "strategic_partner": true}'::jsonb,
     false, 80, 'business', 'Najpopularniejszy', 'Most popular', true, false, NULL, NULL, 'auto'),
    ('partner_general', 50, 'Partner Generalny', 'General Partner',
     'Najszersza współpraca instytucjonalna - bez limitu miejsc, z dedykowanym analitykiem.',
     'The broadest institutional partnership - unlimited seats and a dedicated analyst.',
     '[{"pl":"Pełny dostęp dla całej organizacji, bez limitu miejsc","en":"Full access for the whole organisation, with no seat limit",
        "group_pl":"Wszystko ze Strategic Partner, oraz:","group_en":"All of Strategic Partner, plus:"},
       {"pl":"Dedykowany analityk prowadzący","en":"A dedicated lead analyst"},
       {"pl":"Współsygnowane badania i publikacje","en":"Co-signed research and publications"},
       {"pl":"Slot prelegencki na konferencji New European Strategies","en":"A speaking slot at the New European Strategies conference"},
       {"pl":"Kolacje eksperckie na poziomie zarządu","en":"Expert dinners at board level"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "strategic_partner": true, "general_partner": true}'::jsonb,
     false, 90, 'business', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('presidents_circle', 60, 'President''s Circle', 'President''s Circle',
     'Apeks programu - grono fundatorów instytutu, wyłącznie na zaproszenie.',
     'The apex of the programme - the institute''s founders'' circle, by invitation only.',
     '[{"pl":"Najgłębszy dostęp i konwening w gronie fundatorów instytutu","en":"The deepest access and convening among the institute''s founders"},
       {"pl":"Wpływ na kierunki programowe New European Strategies","en":"Influence over the New European Strategies programme agenda"},
       {"pl":"Miejsce w gronie fundatorów z publicznym uznaniem","en":"A seat among the founders, publicly recognised"},
       {"pl":"Prywatne spotkania z ekspertami i gośćmi New European Strategies","en":"Private meetings with New European Strategies experts and guests"},
       {"pl":"Współtworzenie agendy strategicznej instytutu","en":"Co-creating the institute''s strategic agenda"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true, "strategic_partner": true, "presidents_circle": true}'::jsonb,
     false, 100, 'business', NULL, NULL, false, false, NULL, NULL, 'none'),
    ('student', 10, 'Student i Doktorant', 'Student & Doctoral Candidate',
     'Pełny zakres planu Plus w cenie studenckiej - z prostą weryfikacją raz w roku.',
     'The full Plus plan at a student price - with simple verification once a year.',
     '[{"pl":"Pełny zakres planu Plus, bez limitów, na komputerze i telefonie","en":"The full Plus plan, no limits, on desktop and mobile"},
       {"pl":"Wydarzenia i nagrania członkowskie","en":"Member events and recordings"},
       {"pl":"Cotygodniowy przegląd i pogłębiony digest","en":"The weekly review and the in-depth digest"},
       {"pl":"Dostęp do materiałów edukacyjnych New European Strategies, w tym EuroChallenge","en":"Access to New European Strategies educational materials, including EuroChallenge"},
       {"pl":"Weryfikacja e-mailem uczelni lub legitymacją, raz w roku","en":"Verification with a university e-mail or student ID, once a year"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true}'::jsonb,
     false, 30, 'academic', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('educator', 10, 'Kadra Akademicka', 'Academic Faculty',
     'Dla wykładowców i pracowników naukowych - z licencją dydaktyczną i prawem cytowania.',
     'For lecturers and researchers - with a teaching licence and citation rights.',
     '[{"pl":"Materiały dydaktyczne: kluczowe wnioski i słowniczek pojęć przy analizach","en":"Teaching materials: key takeaways and a glossary alongside analyses",
        "group_pl":"Wszystko z karty Student, oraz:","group_en":"All of the Student plan, plus:"},
       {"pl":"Licencja do wykorzystania treści na zajęciach","en":"A licence to use content in class"},
       {"pl":"Prawo cytowania analiz w publikacjach naukowych","en":"The right to cite analyses in academic publications"},
       {"pl":"Priorytetowe zaproszenia na seminaria akademickie New European Strategies","en":"Priority invitations to New European Strategies academic seminars"},
       {"pl":"Weryfikacja afiliacji akademickiej","en":"Academic affiliation verification"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "teaching_licence": true}'::jsonb,
     false, 40, 'academic', NULL, NULL, false, false, NULL, NULL, 'auto'),
    ('ngo', 20, 'Organizacja Non-profit', 'Non-profit Organisation',
     'Zakres planu Pro dla małego zespołu organizacji pozarządowej lub think-tanku non-profit.',
     'The Pro plan scope for a small team at an NGO or a non-profit think-tank.',
     '[{"pl":"Zakres planu Pro dla małego zespołu","en":"The Pro plan scope for a small team"},
       {"pl":"Wspólna biblioteka i archiwum dla organizacji","en":"A shared library and archive for the organisation"},
       {"pl":"Faktura wystawiana na organizację","en":"Invoices issued to the organisation"},
       {"pl":"Wyróżnienie jako partner misyjny New European Strategies","en":"Recognition as a New European Strategies mission partner"},
       {"pl":"Weryfikacja na podstawie KRS lub statutu","en":"Verification via registry entry or statute"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true}'::jsonb,
     false, 50, 'academic', NULL, NULL, false, false,
     'Preferencyjnie, na fakturę', 'Preferential terms, invoiced', 'auto'),
    ('team', 25, 'Zespół', 'Team',
     'Pełny zakres Pro dla 2-20 miejsc - z panelem miejsc i jedną fakturą.',
     'The full Pro scope for 2-20 seats - with a seat panel and one invoice.',
     '[{"pl":"Pełny zakres Pro dla każdego miejsca","en":"The full Pro scope for every seat"},
       {"pl":"Panel miejsc: zapraszanie i odbieranie dostępu","en":"A seat panel: invite and revoke access"},
       {"pl":"Przenoszenie miejsc między osobami w dowolnym momencie","en":"Reassign seats between people at any time"},
       {"pl":"Jedna zbiorcza faktura dla całego zespołu","en":"One consolidated invoice for the whole team"},
       {"pl":"Rabat wolumenowy w progu 11-20 miejsc","en":"A volume discount in the 11-20 seat range"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "corporate_seats": true}'::jsonb,
     false, 60, 'team', NULL, NULL, false, true, '2-20 miejsc', '2-20 seats', 'contact')
  ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features,
         is_default, sort_order, audience_key, badge_pl, badge_en, highlight,
         per_seat, price_note_pl, price_note_en, cta_mode);
$$;

REVOKE EXECUTE ON FUNCTION public.pricing_catalog_v3_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_v3_rows() TO service_role;

CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order, audience_key,
     badge_pl, badge_en, highlight, per_seat, price_note_pl, price_note_en, cta_mode)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order, v.audience_key,
         v.badge_pl, v.badge_en, v.highlight, v.per_seat,
         v.price_note_pl, v.price_note_en, v.cta_mode
    FROM public.pricing_catalog_v3_rows() v
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_pricing_audiences(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.pricing_audiences
    (tenant_id, key, name_pl, name_en, tagline_pl, tagline_en, trust_pl, trust_en,
     icon, sort_order)
  SELECT p_tenant, v.key, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en,
         v.trust_pl, v.trust_en, v.icon, v.sort_order
    FROM (VALUES
      ('individual', 'Dla Ciebie', 'For you',
       'Pełen dostęp do analiz, briefingów i społeczności ekspertów - w rytmie, który wybierasz.',
       'Full access to analysis, briefings and the expert community - at the pace you choose.',
       NULL, NULL, 'user', 0),
      ('business', 'Dla firm', 'For business',
       'Monitoring regulacyjny i wczesne ostrzeganie dla public affairs, strategii i zarządów - z licencją dla całej organizacji.',
       'Regulatory monitoring and early warning for public affairs, strategy and boards - with an organisation-wide licence.',
       'Faktura · Umowa roczna · Wdrożenie z opiekunem',
       'Invoice · Annual agreement · Guided onboarding',
       'building-2', 10),
      ('academic', 'Program Akademicki', 'Academic Programme',
       'Ta sama wiedza, niższy próg wejścia.',
       'The same insight, a lower barrier to entry.',
       NULL, NULL, 'graduation-cap', 20),
      ('team', 'Dla zespołów', 'For teams',
       'Jedna subskrypcja, wspólny dostęp - zarządzasz miejscami w jednym panelu.',
       'One subscription, shared access - manage seats in one panel.',
       NULL, NULL, 'users', 30)
    ) AS v(key, name_pl, name_en, tagline_pl, tagline_en, trust_pl, trust_en, icon, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.pricing_audiences pa
      WHERE pa.tenant_id = p_tenant AND pa.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_audiences(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_audiences(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_pricing_plans_v3(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.access_plans
    (tenant_id, name_pl, name_en, price_cents, currency, interval, active,
     sort_order, tier_key)
  SELECT p_tenant, v.name_pl, v.name_en, v.price_cents, 'PLN',
         v.plan_interval::public.plan_interval, true, v.sort_order, v.tier_key
    FROM (VALUES
      ('Plus - miesięcznie', 'Plus - monthly', 5900, 'month', 10, 'member'),
      ('Plus - rocznie', 'Plus - annual', 59000, 'year', 20, 'member'),
      ('Pro - miesięcznie', 'Pro - monthly', 12900, 'month', 30, 'pro'),
      ('Pro - rocznie', 'Pro - annual', 129000, 'year', 40, 'pro'),
      ('Student i Doktorant - miesięcznie', 'Student & Doctoral - monthly', 1900, 'month', 50, 'student'),
      ('Kadra Akademicka - miesięcznie', 'Academic Faculty - monthly', 2900, 'month', 60, 'educator'),
      ('Zespół - za miejsce, miesięcznie', 'Team - per seat, monthly', 9900, 'month', 70, 'team')
    ) AS v(name_pl, name_en, price_cents, plan_interval, sort_order, tier_key)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.access_plans ap
      WHERE ap.tenant_id = p_tenant
        AND ap.tier_key = v.tier_key
        AND ap.interval = v.plan_interval::public.plan_interval
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_plans_v3(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_plans_v3(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_pricing_catalog_v3(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_pricing_audiences(p_tenant);
  PERFORM public.seed_membership_tiers(p_tenant);

  UPDATE public.pricing_audiences pa
     SET name_pl = v.name_pl, name_en = v.name_en,
         tagline_pl = v.tagline_pl, tagline_en = v.tagline_en,
         trust_pl = v.trust_pl, trust_en = v.trust_en
    FROM (VALUES
      ('individual', 'Dla Ciebie', 'For you',
       'Pełen dostęp do analiz, briefingów i społeczności ekspertów - w rytmie, który wybierasz.',
       'Full access to analysis, briefings and the expert community - at the pace you choose.',
       NULL, NULL),
      ('business', 'Dla firm', 'For business',
       'Monitoring regulacyjny i wczesne ostrzeganie dla public affairs, strategii i zarządów - z licencją dla całej organizacji.',
       'Regulatory monitoring and early warning for public affairs, strategy and boards - with an organisation-wide licence.',
       'Faktura · Umowa roczna · Wdrożenie z opiekunem',
       'Invoice · Annual agreement · Guided onboarding'),
      ('academic', 'Program Akademicki', 'Academic Programme',
       'Ta sama wiedza, niższy próg wejścia.',
       'The same insight, a lower barrier to entry.',
       NULL, NULL),
      ('team', 'Dla zespołów', 'For teams',
       'Jedna subskrypcja, wspólny dostęp - zarządzasz miejscami w jednym panelu.',
       'One subscription, shared access - manage seats in one panel.',
       NULL, NULL)
    ) AS v(key, name_pl, name_en, tagline_pl, tagline_en, trust_pl, trust_en)
   WHERE pa.tenant_id = p_tenant AND pa.key = v.key;

  UPDATE public.membership_tiers mt
     SET rank = v.rank,
         name_pl = v.name_pl, name_en = v.name_en,
         description_pl = v.desc_pl, description_en = v.desc_en,
         benefits = v.benefits,
         features = mt.features || v.features,
         is_default = v.is_default,
         sort_order = v.sort_order,
         audience_key = v.audience_key,
         badge_pl = v.badge_pl, badge_en = v.badge_en,
         highlight = v.highlight,
         per_seat = v.per_seat,
         price_note_pl = v.price_note_pl, price_note_en = v.price_note_en,
         cta_mode = v.cta_mode
    FROM public.pricing_catalog_v3_rows() v
   WHERE mt.tenant_id = p_tenant AND mt.key = v.key;

  PERFORM public.seed_pricing_plans_v3(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_pricing_catalog_v3(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pricing_catalog_v3(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.retention_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  discount_pct integer NOT NULL DEFAULT 30 CHECK (discount_pct BETWEEN 1 AND 90),
  discount_periods integer NOT NULL DEFAULT 3 CHECK (discount_periods BETWEEN 1 AND 24),
  coupon_valid_days integer NOT NULL DEFAULT 14 CHECK (coupon_valid_days BETWEEN 1 AND 90),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS retention_settings_set_updated_at ON public.retention_settings;
CREATE TRIGGER retention_settings_set_updated_at
  BEFORE UPDATE ON public.retention_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.retention_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.retention_settings TO authenticated;
GRANT ALL ON public.retention_settings TO service_role;
ALTER TABLE public.retention_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retention settings member read" ON public.retention_settings;
CREATE POLICY "retention settings member read" ON public.retention_settings
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "retention settings admin write" ON public.retention_settings;
CREATE POLICY "retention settings admin write" ON public.retention_settings
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

CREATE TABLE IF NOT EXISTS public.retention_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(label_pl) <> '' AND btrim(label_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_retention_reasons_tenant_sort
  ON public.retention_reasons (tenant_id, sort_order) WHERE active;

DROP TRIGGER IF EXISTS retention_reasons_set_updated_at ON public.retention_reasons;
CREATE TRIGGER retention_reasons_set_updated_at
  BEFORE UPDATE ON public.retention_reasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.retention_reasons TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.retention_reasons TO authenticated;
GRANT ALL ON public.retention_reasons TO service_role;
ALTER TABLE public.retention_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retention reasons member read" ON public.retention_reasons;
CREATE POLICY "retention reasons member read" ON public.retention_reasons
  FOR SELECT TO authenticated
  USING (active AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "retention reasons staff read" ON public.retention_reasons;
CREATE POLICY "retention reasons staff read" ON public.retention_reasons
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "retention reasons admin write" ON public.retention_reasons;
CREATE POLICY "retention reasons admin write" ON public.retention_reasons
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

CREATE TABLE IF NOT EXISTS public.retention_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid,
  reason_id uuid REFERENCES public.retention_reasons(id) ON DELETE SET NULL,
  reason_label text NOT NULL,
  comment text,
  offer_shown boolean NOT NULL DEFAULT false,
  offer_accepted boolean NOT NULL DEFAULT false,
  coupon_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(reason_label) <> '')
);

CREATE INDEX IF NOT EXISTS idx_retention_feedback_tenant_created
  ON public.retention_feedback (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_feedback_user
  ON public.retention_feedback (user_id, created_at DESC);

GRANT SELECT ON public.retention_feedback TO authenticated;
GRANT ALL ON public.retention_feedback TO service_role;
ALTER TABLE public.retention_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retention feedback staff read" ON public.retention_feedback;
CREATE POLICY "retention feedback staff read" ON public.retention_feedback
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.seed_retention_defaults(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.retention_settings (tenant_id)
  VALUES (p_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.retention_reasons (tenant_id, label_pl, label_en, sort_order)
  SELECT p_tenant, v.label_pl, v.label_en, v.sort_order
    FROM (VALUES
      ('Za wysoka cena', 'The price is too high', 10),
      ('Za rzadko korzystam', 'I do not use it often enough', 20),
      ('Brakuje treści, których szukam', 'I cannot find the content I need', 30),
      ('Problemy techniczne lub z kontem', 'Technical or account issues', 40),
      ('Wybieram inne źródło analiz', 'I am switching to another source', 50),
      ('Inny powód', 'Another reason', 60)
    ) AS v(label_pl, label_en, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.retention_reasons r WHERE r.tenant_id = p_tenant
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_retention_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_retention_defaults(uuid) TO service_role;

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

  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_pricing_defaults(v_t);
    PERFORM public.apply_pricing_catalog_v3(v_t);
  END LOOP;
END $$;

-- ============================================================================
-- CENNIK 2.0: segmentacja oferty per odbiorca + FAQ cennika w bazie.
-- (migracja pliku 20260722200000_pricing_audiences_faq.sql, PR #66)
-- ============================================================================

ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS audience_key text;
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS badge_pl text;
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS badge_en text;
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS highlight boolean NOT NULL DEFAULT false;
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS contact_url text;

CREATE TABLE IF NOT EXISTS public.pricing_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  tagline_pl text,
  tagline_en text,
  icon text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  CHECK (key ~ '^[a-z0-9_-]{2,32}$'),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_pricing_audiences_tenant_sort
  ON public.pricing_audiences (tenant_id, sort_order) WHERE active;

DROP TRIGGER IF EXISTS pricing_audiences_set_updated_at ON public.pricing_audiences;
CREATE TRIGGER pricing_audiences_set_updated_at
  BEFORE UPDATE ON public.pricing_audiences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.pricing_audiences TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pricing_audiences TO authenticated;
GRANT ALL ON public.pricing_audiences TO service_role;
ALTER TABLE public.pricing_audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pricing audiences public read" ON public.pricing_audiences;
CREATE POLICY "pricing audiences public read" ON public.pricing_audiences
  FOR SELECT TO anon, authenticated
  USING (active AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "pricing audiences staff read" ON public.pricing_audiences;
CREATE POLICY "pricing audiences staff read" ON public.pricing_audiences
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "pricing audiences admin write" ON public.pricing_audiences;
CREATE POLICY "pricing audiences admin write" ON public.pricing_audiences
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

CREATE TABLE IF NOT EXISTS public.pricing_faq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  audience_key text,
  question_pl text NOT NULL,
  question_en text NOT NULL,
  answer_pl text NOT NULL,
  answer_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (audience_key IS NULL OR audience_key ~ '^[a-z0-9_-]{2,32}$'),
  CHECK (btrim(question_pl) <> '' AND btrim(question_en) <> ''),
  CHECK (btrim(answer_pl) <> '' AND btrim(answer_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_pricing_faq_items_tenant_sort
  ON public.pricing_faq_items (tenant_id, sort_order) WHERE active;

DROP TRIGGER IF EXISTS pricing_faq_items_set_updated_at ON public.pricing_faq_items;
CREATE TRIGGER pricing_faq_items_set_updated_at
  BEFORE UPDATE ON public.pricing_faq_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.pricing_faq_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pricing_faq_items TO authenticated;
GRANT ALL ON public.pricing_faq_items TO service_role;
ALTER TABLE public.pricing_faq_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pricing faq public read" ON public.pricing_faq_items;
CREATE POLICY "pricing faq public read" ON public.pricing_faq_items
  FOR SELECT TO anon, authenticated
  USING (active AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "pricing faq staff read" ON public.pricing_faq_items;
CREATE POLICY "pricing faq staff read" ON public.pricing_faq_items
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "pricing faq admin write" ON public.pricing_faq_items;
CREATE POLICY "pricing faq admin write" ON public.pricing_faq_items
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order, audience_key)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order, v.audience_key
    FROM (VALUES
      ('reader', 0,
       'Konto bezpłatne', 'Free account',
       'Zapisywanie i personalizacja: zakładki, obserwowanie tematów i udział w dyskusjach.',
       'Saving and personalisation: bookmarks, topic follows and joining the discussion.',
       '[{"pl":"Zapisywanie materiałów i lista do przeczytania","en":"Saved items and a reading list"},
         {"pl":"Personalizacja: zainteresowania i obserwowane tematy","en":"Personalisation: interests and followed topics"},
         {"pl":"Udział w dyskusjach i ankietach","en":"Join discussions and polls"}]'::jsonb,
       '{}'::jsonb, true, 0, 'individual'),
      ('supporter', 5,
       'Wspierający', 'Supporter',
       'Darowizna wspiera niezależność instytutu; wspierający otrzymują dedykowane aktualizacje.',
       'A donation supports the institute''s independence; supporters receive dedicated updates.',
       '[{"pl":"Wszystko z konta bezpłatnego","en":"Everything in the free account"},
         {"pl":"Aktualizacje i podsumowania dla wspierających","en":"Supporter updates and briefings"},
         {"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb,
       '{"supporter_updates": true}'::jsonb, false, 5, 'individual'),
      ('member', 10,
       'Członek indywidualny', 'Individual member',
       'Zamknięte treści i wydarzenia: pełny dostęp do analiz, briefingów i biblioteki materiałów.',
       'Closed content and events: full access to analyses, briefings and the members'' library.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},
         {"pl":"Wydarzenia i briefingi dla członków","en":"Member events and briefings"},
         {"pl":"Pierwszeństwo rejestracji na wydarzenia","en":"Priority event registration"},
         {"pl":"Biblioteka materiałów do pobrania","en":"Downloadable members'' library"},
         {"pl":"Nagrania z wydarzeń","en":"Event recordings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 10, 'individual'),
      ('pro', 20,
       'Członek ekspercki', 'Expert member',
       'Dla ekspertów i profesjonalistów public affairs: wszystko z członkostwa indywidualnego plus grupy robocze.',
       'For experts and public-affairs professionals: everything in individual membership plus working groups.',
       '[{"pl":"Wszystko z członkostwa indywidualnego","en":"Everything in individual membership"},
         {"pl":"Udział w grupach roboczych","en":"Participation in working groups"},
         {"pl":"Priorytet pytań w sesjach Q&A","en":"Priority in expert Q&A"},
         {"pl":"Zamknięte briefingi eksperckie","en":"Closed-door expert briefings"},
         {"pl":"Tracker legislacyjny z alertami","en":"Legislative tracker with alerts"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 20, 'individual'),
      ('corporate', 30,
       'Członek korporacyjny', 'Corporate member',
       'Dla instytucji i firm: wiele kont dla zespołu oraz briefingi i wydarzenia dla członków.',
       'For institutions and companies: multiple team seats plus member briefings and events.',
       '[{"pl":"Wiele kont dla zespołu (miejsca w organizacji)","en":"Multiple team accounts (organisation seats)"},
         {"pl":"Wszystko z członkostwa eksperckiego","en":"Everything in expert membership"},
         {"pl":"Briefingi i wydarzenia dla członków","en":"Member briefings and events"},
         {"pl":"Wspólna biblioteka materiałów","en":"Shared members'' library"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "premium_content": true}'::jsonb,
       false, 30, 'business'),
      ('partner', 40,
       'Partner strategiczny', 'Strategic partner',
       'Relacja instytucjonalna: partnerstwo programowe, dedykowane briefingi i wspólne projekty.',
       'An institutional relationship: programme partnership, dedicated briefings and joint projects.',
       '[{"pl":"Wszystko z członkostwa korporacyjnego","en":"Everything in corporate membership"},
         {"pl":"Relacja instytucjonalna i wspólne projekty","en":"Institutional relationship and joint projects"},
         {"pl":"Dedykowane briefingi dla partnera","en":"Dedicated partner briefings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "strategic_partner": true, "premium_content": true}'::jsonb,
       false, 40, 'business'),
      ('student', 10,
       'Student', 'Student',
       'Pełny dostęp członkowski dla studentów, uczniów i doktorantów - w cenie dopasowanej do studenckiego budżetu.',
       'Full member access for students and doctoral candidates - at a price that fits a student budget.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses",
          "detail_pl":"Bez limitów, na komputerze i telefonie.",
          "detail_en":"No limits, on desktop and mobile."},
         {"pl":"Wydarzenia i nagrania dla członków","en":"Member events and recordings"},
         {"pl":"Cotygodniowy digest e-mail","en":"Weekly e-mail digest"},
         {"pl":"Weryfikacja: e-mail uczelni lub legitymacja","en":"Verification: university e-mail or student ID",
          "detail_pl":"Status potwierdzamy raz w roku - zajmuje to chwilę.",
          "detail_en":"We confirm status once a year - it only takes a moment."}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 30, 'academic'),
      ('educator', 10,
       'Wykładowca', 'Educator',
       'Dla wykładowców, nauczycieli i pracowników naukowych - z materiałami gotowymi do wykorzystania na zajęciach.',
       'For lecturers, teachers and researchers - with materials ready for classroom use.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},
         {"pl":"Wydarzenia i nagrania dla członków","en":"Member events and recordings"},
         {"pl":"Materiały do dydaktyki","en":"Classroom-ready materials",
          "detail_pl":"Kluczowe wnioski i słowniczek pojęć przy analizach ułatwiają pracę ze studentami.",
          "detail_en":"Key takeaways and a glossary alongside analyses make teaching easier."},
         {"pl":"Weryfikacja afiliacji akademickiej","en":"Academic affiliation verification"}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 40, 'academic'),
      ('ngo', 10,
       'NGO i non-profit', 'NGO & non-profit',
       'Dla organizacji pozarządowych i think-tanków non-profit działających wokół spraw europejskich.',
       'For non-governmental organisations and non-profit think-tanks working on European affairs.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},
         {"pl":"Wydarzenia i nagrania dla członków","en":"Member events and recordings"},
         {"pl":"Faktura na organizację","en":"Invoice issued to your organisation"},
         {"pl":"Weryfikacja: KRS lub statut","en":"Verification: registry entry or statute"}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 50, 'academic'),
      ('team', 25,
       'Zespół', 'Team',
       'Wspólny dostęp dla całego zespołu - miejscami zarządzasz samodzielnie w panelu organizacji.',
       'Shared access for your whole team - manage seats yourself in the organisation panel.',
       '[{"pl":"Wszystko z członkostwa eksperckiego - dla każdego miejsca","en":"Everything in expert membership - for every seat"},
         {"pl":"Panel miejsc: zapraszanie i odbieranie dostępu","en":"Seat panel: invite and revoke access",
          "detail_pl":"Zaproszenia e-mail; miejsca przenosisz między osobami w dowolnym momencie.",
          "detail_en":"E-mail invitations; reassign seats between people at any time."},
         {"pl":"Licencja obejmuje artykuły premium","en":"Licence covers premium articles"},
         {"pl":"Jedna zbiorcza faktura","en":"One consolidated invoice"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "premium_content": true}'::jsonb,
       false, 60, 'team')
    ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features,
           is_default, sort_order, audience_key)
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
    (tenant_id, key, name_pl, name_en, tagline_pl, tagline_en, icon, sort_order)
  SELECT p_tenant, v.key, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en,
         v.icon, v.sort_order
    FROM (VALUES
      ('individual', 'Dla Ciebie', 'For you',
       'Pełen dostęp do analiz, briefingów i społeczności ekspertów - w rytmie, który wybierasz.',
       'Full access to analysis, briefings and the expert community - at the pace you choose.',
       'user', 0),
      ('business', 'Dla firm', 'For business',
       'Wywiad regulacyjny dla public affairs, strategii i zarządów - z licencją dla całej organizacji.',
       'Regulatory intelligence for public affairs, strategy and boards - with an organisation-wide licence.',
       'building-2', 10),
      ('academic', 'Edukacja i NGO', 'Education & NGOs',
       'Specjalne warunki dla studentów, wykładowców i organizacji non-profit. Ta sama wiedza, niższy próg wejścia.',
       'Special terms for students, educators and non-profits. The same insight, a lower barrier to entry.',
       'graduation-cap', 20),
      ('team', 'Dla zespołów', 'For teams',
       'Jedna subskrypcja, wspólny dostęp - zapraszasz zespół i zarządzasz miejscami w jednym panelu.',
       'One subscription, shared access - invite your team and manage seats in one panel.',
       'users', 30)
    ) AS v(key, name_pl, name_en, tagline_pl, tagline_en, icon, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.pricing_audiences pa
      WHERE pa.tenant_id = p_tenant AND pa.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_audiences(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_audiences(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_pricing_faq(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.pricing_faq_items
    (tenant_id, audience_key, question_pl, question_en, answer_pl, answer_en, sort_order)
  SELECT p_tenant, v.audience_key, v.q_pl, v.q_en, v.a_pl, v.a_en, v.sort_order
    FROM (VALUES
      (NULL,
       'Czy mogę anulować subskrypcję w każdej chwili?',
       'Can I cancel my subscription at any time?',
       'Tak. Subskrypcję anulujesz jednym kliknięciem w panelu profilu - bez okresów wypowiedzenia. Zachowujesz pełny dostęp do końca opłaconego okresu.',
       'Yes. Cancel with one click in your profile panel - no notice periods. You keep full access until the end of the paid period.',
       10),
      (NULL,
       'Jakie metody płatności akceptujecie?',
       'Which payment methods do you accept?',
       'Płatności obsługuje Stripe: karty Visa i Mastercard oraz popularne metody lokalne. Nie przechowujemy danych Twojej karty na naszych serwerach.',
       'Payments are handled by Stripe: Visa and Mastercard plus popular local methods. We never store your card details on our servers.',
       20),
      (NULL,
       'Czy otrzymam fakturę VAT?',
       'Will I receive a VAT invoice?',
       'Tak. Fakturę wystawiamy automatycznie na podstawie danych rozliczeniowych z Twojego profilu - NIP lub VAT ID podasz podczas płatności, a podatek naliczy się według Twojego adresu.',
       'Yes. Invoices are issued automatically from the billing details in your profile - add your tax ID at checkout and tax is calculated from your address.',
       30),
      (NULL,
       'Kiedy dostanę dostęp po zakupie?',
       'When do I get access after purchase?',
       'Natychmiast. Konto odblokowuje się automatycznie zaraz po potwierdzeniu płatności przez operatora.',
       'Immediately. Your account unlocks automatically as soon as the payment is confirmed.',
       40),
      (NULL,
       'Czym różni się rozliczenie miesięczne od rocznego?',
       'What is the difference between monthly and annual billing?',
       'Zakres dostępu jest identyczny - różni się tylko cykl płatności. Plan roczny to jedna płatność z góry i niższy koszt w przeliczeniu na miesiąc; dokładną oszczędność pokazujemy przy każdej cenie.',
       'The access is identical - only the billing cycle differs. Annual plans are a single upfront payment at a lower effective monthly cost; the exact saving is shown next to each price.',
       50),
      (NULL,
       'Czy mogę później zmienić plan?',
       'Can I change my plan later?',
       'Tak. Na wyższy plan przechodzisz w dowolnym momencie - poziom dostępu wyznacza najwyższy aktywny plan. Aby przejść niżej, wystarczy anulować obecny plan i wybrać nowy od kolejnego okresu.',
       'Yes. Upgrade at any time - your access level follows your highest active plan. To downgrade, simply cancel the current plan and pick a new one for the next period.',
       60),
      (NULL,
       'Co pozostaje bezpłatne?',
       'What stays free?',
       'Duża część serwisu jest otwarta dla wszystkich. Bezpłatne konto Czytelnika dodaje zakładki, obserwowanie tematów i udział w dyskusjach - bez podawania karty.',
       'A large part of the site is open to everyone. The free Reader account adds bookmarks, topic follows and discussions - no card required.',
       70),
      (NULL,
       'Jak działa okres próbny?',
       'How does the trial work?',
       'Jeśli plan oferuje okres próbny, informacja jest widoczna przy cenie. Pierwszą płatność pobieramy dopiero po jego zakończeniu, a wcześniejsze anulowanie nic nie kosztuje.',
       'If a plan offers a trial, it is shown next to the price. The first payment is taken only after the trial ends, and cancelling earlier costs nothing.',
       80),
      ('academic',
       'Kto może skorzystać z oferty akademickiej?',
       'Who qualifies for the academic offer?',
       'Studenci, uczniowie, doktoranci, wykładowcy i nauczyciele oraz organizacje non-profit. Status potwierdzamy prosto: e-mailem uczelni, legitymacją albo wpisem do rejestru - zwykle w ciągu jednego dnia roboczego.',
       'Students, pupils, doctoral candidates, lecturers, teachers and non-profit organisations. We confirm status simply: a university e-mail, a student ID or a registry entry - usually within one business day.',
       90),
      ('academic',
       'Czy oferta akademicka obejmuje całą grupę lub koło naukowe?',
       'Does the academic offer cover a whole group or student society?',
       'Tak - dla kół naukowych, katedr i programów studiów przygotowujemy dostęp grupowy na warunkach zbliżonych do planu Zespół. Napisz do nas, dopasujemy zakres i wycenę.',
       'Yes - for student societies, faculties and study programmes we arrange group access on terms similar to the Team plan. Write to us and we will tailor the scope and pricing.',
       100),
      ('team',
       'Jak działają miejsca (seats) w planie zespołowym?',
       'How do seats work in the team plan?',
       'Po zakupie zarządzasz miejscami w panelu organizacji: zapraszasz osoby e-mailem, a nieużywane miejsca przenosisz w dowolnym momencie. Każde miejsce to pełny, imienny dostęp.',
       'After purchase you manage seats in the organisation panel: invite people by e-mail and reassign unused seats at any time. Every seat is a full, named account.',
       110),
      ('team',
       'Czy mogę dokupić miejsca w trakcie trwania subskrypcji?',
       'Can I add seats mid-subscription?',
       'Tak. Liczbę miejsc zwiększysz w każdej chwili - napisz do nas, a rozliczenie proporcjonalnie dopasujemy do bieżącego okresu.',
       'Yes. You can increase the number of seats at any time - contact us and we will pro-rate the billing for the current period.',
       120),
      ('business',
       'Czy oferujecie licencje dla całej organizacji i płatność na fakturę?',
       'Do you offer organisation-wide licences and invoice payment?',
       'Tak. Licencja site-wide obejmuje artykuły premium dla wszystkich miejsc w organizacji, a rozliczenie prowadzimy fakturą - także w procedurze zakupowej (zamówienie/PO).',
       'Yes. A site-wide licence covers premium articles for every seat in your organisation, and we bill by invoice - purchase-order procurement included.',
       130),
      ('business',
       'Czym plan korporacyjny różni się od zespołowego?',
       'How does the corporate plan differ from the team plan?',
       'Plan Zespół to samoobsługowy wspólny dostęp do treści i wydarzeń. Oferta korporacyjna dodaje zamknięte briefingi, priorytetowy kontakt z ekspertami i warunki negocjowane pod organizację - w tym partnerstwo strategiczne.',
       'Team is self-serve shared access to content and events. The corporate offer adds closed-door briefings, priority access to our experts and terms negotiated for your organisation - including strategic partnership.',
       140)
    ) AS v(audience_key, q_pl, q_en, a_pl, a_en, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.pricing_faq_items f WHERE f.tenant_id = p_tenant
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_faq(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_faq(uuid) TO service_role;

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
       WHEN key IN ('reader', 'supporter', 'member', 'pro') THEN 'individual'
       WHEN key IN ('corporate', 'partner') THEN 'business'
       WHEN key IN ('student', 'educator', 'ngo') THEN 'academic'
       WHEN key = 'team' THEN 'team'
       ELSE audience_key
     END
   WHERE tenant_id = p_tenant AND audience_key IS NULL;

  UPDATE public.membership_tiers
     SET highlight = true,
         badge_pl = COALESCE(badge_pl, 'Najpopularniejszy'),
         badge_en = COALESCE(badge_en, 'Most popular')
   WHERE tenant_id = p_tenant
     AND key = 'member'
     AND NOT highlight
     AND badge_pl IS NULL
     AND badge_en IS NULL;

  PERFORM public.seed_pricing_faq(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_pricing_defaults(v_t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.tg_tenants_seed_pricing_defaults()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_pricing_defaults(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_seed_pricing_defaults ON public.tenants;
CREATE TRIGGER tenants_seed_pricing_defaults
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_tenants_seed_pricing_defaults();
-- Kariera: oferty pracy i sekcje strony /zatrudniamy zarzadzane z panelu admina.
CREATE TABLE IF NOT EXISTS public.career_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  department text NOT NULL,
  engagement text NOT NULL,
  seniority text NOT NULL,
  location text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  summary_pl text NOT NULL DEFAULT '',
  summary_en text NOT NULL DEFAULT '',
  responsibilities_pl text[] NOT NULL DEFAULT '{}',
  responsibilities_en text[] NOT NULL DEFAULT '{}',
  requirements_pl text[] NOT NULL DEFAULT '{}',
  requirements_en text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_roles_department_chk CHECK (department IN ('analysis','policy','marketing','advisory','editorial','operations')),
  CONSTRAINT career_roles_engagement_chk CHECK (engagement IN ('full_time','part_time','contract','internship')),
  CONSTRAINT career_roles_seniority_chk CHECK (seniority IN ('junior','mid','senior','lead')),
  CONSTRAINT career_roles_location_chk CHECK (location IN ('remote','hybrid','warsaw','brussels'))
);

CREATE TABLE IF NOT EXISTS public.career_page_sections (
  key text PRIMARY KEY,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  title_pl text,
  title_en text,
  subtitle_pl text,
  subtitle_en text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.career_roles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.career_roles TO authenticated;
GRANT ALL ON public.career_roles TO service_role;
GRANT SELECT ON public.career_page_sections TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.career_page_sections TO authenticated;
GRANT ALL ON public.career_page_sections TO service_role;

ALTER TABLE public.career_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_page_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS career_roles_public_read ON public.career_roles;
CREATE POLICY career_roles_public_read ON public.career_roles
  FOR SELECT TO anon, authenticated USING (is_published);

DROP POLICY IF EXISTS career_roles_staff_read ON public.career_roles;
CREATE POLICY career_roles_staff_read ON public.career_roles
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS career_roles_staff_write ON public.career_roles;
CREATE POLICY career_roles_staff_write ON public.career_roles
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_roles_staff_update ON public.career_roles;
CREATE POLICY career_roles_staff_update ON public.career_roles
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_roles_staff_delete ON public.career_roles;
CREATE POLICY career_roles_staff_delete ON public.career_roles
  FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS career_sections_public_read ON public.career_page_sections;
CREATE POLICY career_sections_public_read ON public.career_page_sections
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS career_sections_staff_write ON public.career_page_sections;
CREATE POLICY career_sections_staff_write ON public.career_page_sections
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_sections_staff_update ON public.career_page_sections;
CREATE POLICY career_sections_staff_update ON public.career_page_sections
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS career_sections_staff_delete ON public.career_page_sections;
CREATE POLICY career_sections_staff_delete ON public.career_page_sections
  FOR DELETE TO authenticated USING (public.is_staff());

DROP TRIGGER IF EXISTS trg_career_roles_touch ON public.career_roles;
CREATE TRIGGER trg_career_roles_touch BEFORE UPDATE ON public.career_roles
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();
DROP TRIGGER IF EXISTS trg_career_sections_touch ON public.career_page_sections;
CREATE TRIGGER trg_career_sections_touch BEFORE UPDATE ON public.career_page_sections
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE INDEX IF NOT EXISTS career_roles_sort_idx ON public.career_roles (sort_order, created_at);

INSERT INTO public.career_page_sections (key, is_visible, sort_order) VALUES
  ('hero', true, 10), ('values', true, 20), ('benefits', true, 30),
  ('roles', true, 40), ('process', true, 50), ('form', true, 60), ('closing', true, 70)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.career_roles
  (slug, department, engagement, seniority, location, sort_order, is_published,
   title_pl, title_en, summary_pl, summary_en,
   responsibilities_pl, responsibilities_en, requirements_pl, requirements_en)
VALUES
('senior_analyst_security', 'analysis', 'full_time', 'senior', 'hybrid', 0, true, 'Starszy analityk - bezpieczeństwo i obronność', 'Senior analyst - security and defence', 'Prowadzisz linię badawczą o bezpieczeństwie europejskim: analizy, policy papers i komentarze dla mediów.', 'You run our European security research line: analyses, policy papers and media commentary.', ARRAY['Projektowanie i realizacja analiz o zdolnościach obronnych i przemyśle zbrojeniowym.','Publikacje pod własnym nazwiskiem oraz briefy dla instytucji i biznesu.','Reprezentowanie think tanku w mediach i na panelach.','Współprowadzenie klubu dyskusyjnego w swojej specjalizacji.']::text[], ARRAY['Designing and delivering analyses on defence capabilities and the defence industry.','Publishing under your own name and writing briefs for institutions and business.','Representing the think tank in the media and on panels.','Co-hosting a discussion club in your specialisation.']::text[], ARRAY['5+ lat doświadczenia w analizie bezpieczeństwa, obronności lub stosunków międzynarodowych.','Udokumentowany dorobek publikacyjny (analizy, policy papers, komentarze).','Biegły polski i angielski - w mowie i piśmie, także przed kamerą.','Znajomość instytucji NATO/UE i realiów przemysłu zbrojeniowego.']::text[], ARRAY['5+ years in security, defence or international relations analysis.','A documented publication record (analyses, policy papers, commentary).','Fluent Polish and English - written, spoken and on camera.','Familiarity with NATO/EU institutions and the defence industry.']::text[]),
('analyst_economy', 'analysis', 'full_time', 'mid', 'hybrid', 10, true, 'Analityk - gospodarka i energetyka', 'Analyst - economy and energy', 'Łączysz dane makro z regulacją UE i tłumaczysz, co z tego wynika dla firm i administracji.', 'You connect macro data with EU regulation and explain what it means for companies and public bodies.', ARRAY['Analizy rynkowe i regulacyjne z jasną rekomendacją.','Praca z danymi Eurostatu, ENTSO-E i źródeł krajowych.','Współpraca z redakcją przy wizualizacjach i wykresach.']::text[], ARRAY['Market and regulatory analyses with a clear recommendation.','Working with Eurostat, ENTSO-E and national data sources.','Cooperating with the newsroom on charts and visualisations.']::text[], ARRAY['3+ lata pracy analitycznej w gospodarce, energetyce lub regulacji UE.','Swoboda w pracy z danymi ilościowymi (Excel/Python/R) i źródłami statystycznymi.','Umiejętność pisania zwięzłych rekomendacji dla decydentów.']::text[], ARRAY['3+ years of analytical work in economy, energy or EU regulation.','Comfort with quantitative data (Excel/Python/R) and statistical sources.','Ability to write concise recommendations for decision-makers.']::text[]),
('data_analyst', 'analysis', 'contract', 'mid', 'remote', 20, true, 'Analityk danych (współpraca projektowa)', 'Data analyst (project engagement)', 'Budujesz warstwę danych pod nasze raporty: modele, zestawy wskaźników i powtarzalne pipeline''y.', 'You build the data layer behind our reports: models, indicator sets and repeatable pipelines.', ARRAY['Przygotowanie i kontrola jakości zbiorów danych do raportów.','Automatyzacja aktualizacji wskaźników i wykresów.','Dokumentacja metodologii dla czytelników i recenzentów.']::text[], ARRAY['Preparing and quality-checking datasets for reports.','Automating indicator and chart updates.','Documenting methodology for readers and reviewers.']::text[], ARRAY['Praktyczna znajomość Pythona lub R oraz SQL.','Doświadczenie w budowie powtarzalnych pipeline''ów i kontroli jakości danych.','Dbałość o dokumentację metodologii i powtarzalność wyników.']::text[], ARRAY['Working knowledge of Python or R plus SQL.','Experience building repeatable pipelines and running data quality checks.','Discipline around methodology documentation and reproducibility.']::text[]),
('eu_policy_officer', 'policy', 'full_time', 'mid', 'brussels', 30, true, 'Specjalista ds. polityki UE', 'EU policy officer', 'Monitorujesz proces legislacyjny w Brukseli i przekładasz go na stanowiska oraz konsultacje.', 'You monitor the Brussels legislative process and turn it into positions and consultations.', ARRAY['Śledzenie prac Komisji, Rady i Parlamentu w wyznaczonych dossier.','Przygotowanie stanowisk konsultacyjnych i notatek decyzyjnych.','Kontakty z instytucjami, stowarzyszeniami i partnerami.','Wsparcie zespołu analitycznego w interpretacji przepisów.']::text[], ARRAY['Following Commission, Council and Parliament work on assigned dossiers.','Preparing consultation responses and decision memos.','Maintaining contact with institutions, associations and partners.','Supporting the research team with legal interpretation.']::text[], ARRAY['Doświadczenie w pracy z procesem legislacyjnym UE (instytucje, izby, kancelarie).','Umiejętność szybkiego streszczania dokumentów prawnych w język decyzji.','Angielski na poziomie roboczym C1, mile widziany francuski.','Gotowość do pracy w Brukseli i udziału w spotkaniach instytucjonalnych.']::text[], ARRAY['Experience with the EU legislative process (institutions, chambers, law firms).','Ability to summarise legal documents into decision-ready language.','English at C1 working level; French is a plus.','Readiness to work in Brussels and attend institutional meetings.']::text[]),
('policy_intern', 'policy', 'internship', 'junior', 'warsaw', 40, true, 'Staż - polityka publiczna', 'Internship - public policy', 'Sześciomiesięczny płatny staż z realnym zakresem: research, notatki, wsparcie publikacji.', 'A six-month paid internship with real scope: research, notes and publication support.', ARRAY['Research desk-owy i przeglądy literatury.','Notatki z posiedzeń i wydarzeń branżowych.','Wsparcie przy redakcji i korekcie materiałów.']::text[], ARRAY['Desk research and literature reviews.','Notes from sittings and industry events.','Support with editing and proofreading materials.']::text[], ARRAY['Student ostatnich lat lub absolwent kierunków społecznych, prawnych albo ekonomicznych.','Rzetelność w researchu i umiejętność pracy ze źródłami pierwotnymi.','Angielski umożliwiający swobodną lekturę dokumentów UE.']::text[], ARRAY['Final-year student or graduate in social sciences, law or economics.','Rigorous research skills and comfort with primary sources.','English sufficient to read EU documentation fluently.']::text[]),
('growth_marketing_lead', 'marketing', 'full_time', 'lead', 'hybrid', 50, true, 'Lead marketingu i wzrostu', 'Growth and marketing lead', 'Odpowiadasz za wzrost czytelnictwa i członkostw: newsletter, kampanie, lejek subskrypcyjny.', 'You own readership and membership growth: newsletter, campaigns and the subscription funnel.', ARRAY['Strategia pozyskania i utrzymania członków (SEO, newsletter, kampanie płatne).','Praca na danych: kohorty, retencja, konwersja planów.','Zarządzanie budżetem i współpraca z podwykonawcami.','Rozwój marki think tanku w PL i EN.']::text[], ARRAY['Acquisition and retention strategy (SEO, newsletter, paid campaigns).','Working on data: cohorts, retention, plan conversion.','Managing budget and external contractors.','Growing the think tank brand in Polish and English.']::text[], ARRAY['4+ lata w marketingu wzrostowym, najlepiej w mediach lub subskrypcjach.','Twarde doświadczenie z analityką: kohorty, retencja, atrybucja kampanii.','Praktyka w prowadzeniu newslettera i lejka subskrypcyjnego.','Umiejętność zarządzania budżetem i podwykonawcami.']::text[], ARRAY['4+ years in growth marketing, ideally in media or subscriptions.','Hands-on analytics experience: cohorts, retention, campaign attribution.','Practical newsletter and subscription funnel ownership.','Ability to manage budget and external contractors.']::text[]),
('content_marketing_specialist', 'marketing', 'part_time', 'mid', 'remote', 60, true, 'Specjalista ds. treści (część etatu)', 'Content specialist (part-time)', 'Przekładasz analizy na formaty społecznościowe, newsletterowe i wideo - bez utraty precyzji.', 'You turn analyses into social, newsletter and video formats without losing precision.', ARRAY['Prowadzenie kanałów LinkedIn i X w PL/EN.','Redakcja newslettera i zapowiedzi raportów.','Współpraca z autorami przy dystrybucji publikacji.']::text[], ARRAY['Running LinkedIn and X channels in Polish and English.','Editing the newsletter and report announcements.','Working with authors on publication distribution.']::text[], ARRAY['2+ lata w prowadzeniu kanałów społecznościowych marki eksperckiej.','Lekkie pióro w PL i EN oraz wyczucie tematów publicznych.','Podstawy pracy z grafiką i wideo w formatach społecznościowych.']::text[], ARRAY['2+ years running social channels for an expert brand.','A light touch in Polish and English plus a feel for public affairs.','Basic graphic and video skills for social formats.']::text[]),
('strategic_advisor', 'advisory', 'contract', 'lead', 'remote', 70, true, 'Doradca strategiczny (współpraca ekspercka)', 'Strategic advisor (expert engagement)', 'Wspierasz klientów instytucjonalnych w decyzjach o wysokiej stawce - regulacja, ryzyko, geopolityka.', 'You support institutional clients on high-stakes decisions: regulation, risk and geopolitics.', ARRAY['Warsztaty scenariuszowe i doradztwo dla zarządów.','Recenzja merytoryczna raportów i stanowisk.','Udział w projektach doradczych w formule projektowej.']::text[], ARRAY['Scenario workshops and board-level advisory.','Substantive review of reports and positions.','Taking part in advisory projects on a project basis.']::text[], ARRAY['Doświadczenie doradcze na poziomie zarządów lub administracji centralnej.','Ekspercka specjalizacja w regulacji, ryzyku lub geopolityce.','Umiejętność prowadzenia warsztatów scenariuszowych.']::text[], ARRAY['Advisory experience at board or central administration level.','Expert specialisation in regulation, risk or geopolitics.','Ability to run scenario workshops.']::text[]),
('managing_editor', 'editorial', 'full_time', 'senior', 'warsaw', 80, true, 'Redaktor prowadzący', 'Managing editor', 'Pilnujesz jakości, kalendarza i języka wszystkich publikacji - w dwóch wersjach językowych.', 'You guard quality, calendar and language across every publication, in both language versions.', ARRAY['Planowanie kalendarza wydawniczego i egzekwowanie deadline''ów.','Redakcja merytoryczna i językowa analiz w PL i EN.','Standardy cytowania, przypisów i weryfikacji faktów.','Współpraca z zespołem wizualnym przy layoutach raportów.']::text[], ARRAY['Planning the editorial calendar and enforcing deadlines.','Substantive and language editing in Polish and English.','Citation, footnote and fact-checking standards.','Working with the design team on report layouts.']::text[], ARRAY['5+ lat w redakcji tekstów analitycznych lub dziennikarskich.','Wzorowa polszczyzna i angielski na poziomie redakcyjnym.','Znajomość standardów cytowania, przypisów i weryfikacji faktów.','Umiejętność egzekwowania kalendarza wydawniczego bez konfliktów.']::text[], ARRAY['5+ years editing analytical or journalistic texts.','Impeccable Polish and editorial-level English.','Knowledge of citation, footnote and fact-checking standards.','Ability to enforce the publishing calendar without friction.']::text[]),
('events_coordinator', 'operations', 'full_time', 'mid', 'warsaw', 90, true, 'Koordynator wydarzeń i klubów', 'Events and clubs coordinator', 'Prowadzisz kalendarz debat, klubów dyskusyjnych i konferencji - od zaproszeń po podsumowania.', 'You run the calendar of debates, discussion clubs and conferences, from invitations to wrap-ups.', ARRAY['Organizacja spotkań offline i online (do 300 osób).','Kontakt z prelegentami, partnerami i lokalizacjami.','Podsumowania i raportowanie efektów wydarzeń.']::text[], ARRAY['Organising offline and online events for up to 300 people.','Managing speakers, partners and venues.','Reporting on event outcomes.']::text[], ARRAY['2+ lata w organizacji wydarzeń (konferencje, debaty, spotkania zamknięte).','Sprawna koordynacja prelegentów, partnerów i dostawców.','Angielski w kontakcie z gośćmi zagranicznymi.']::text[], ARRAY['2+ years organising events (conferences, debates, closed-door meetings).','Smooth coordination of speakers, partners and vendors.','English for working with international guests.']::text[])
ON CONFLICT (slug) DO NOTHING;

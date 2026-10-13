-- ============================================================================
-- PRYWATNOSC KONTAKTU AUTORA: PRODUKCJA DOGANIA 20260730120000.
--
-- DRYF (zmierzony na produkcji 2026-10-12, katalog + rejestr migracji):
--
--   D1  `supabase_migrations.schema_migrations` NIE MA wersji 20260730120000.
--       Najpewniej plik przyszedl z PR-em z wersja starsza niz glowa
--       rejestru i pipeline go pominal; na produkcji zostal widok z
--       20260730072101:
--         CASE WHEN auth.uid() IS NOT NULL THEN contact_email END AS contact_email
--       Kazdy zalogowany uzytkownik (takze zwykly czytelnik) czytal e-mail
--       kontaktowy KAZDEGO publicznego autora najemcy - widok jest DEFINER,
--       wiec omija kolumnowy REVOKE na author_profiles. Typy z produkcji
--       (src/integrations/supabase/types.ts) pokazuja to jako
--       `contact_email: string | null` z Insert/Update `never` (kolumna
--       wyliczana). Baza odtworzona z tego pasa tej kolumny nie ma, wiec
--       author_contact_privacy_test.sql dryfu nie widzial.
--
--   D2  `event_speaker_detail` na produkcji to wersja z drizzle 0150: galaz
--       ELSE e-maila czyta `ap.contact_email` z tego widoku - druga droga
--       tego samego wycieku (okno prelegenta z kontem autora, zalogowany
--       gosc). Bez podmiany funkcji usuniecie kolumny konczyloby kazde
--       wywolanie RPC bledem 42703. Podmienia ja 20261012123000 (e-mail
--       autora NULL), ktora w tym pasie wykonuje sie PRZED ta migracja; na
--       produkcji jej replika drizzle 0163 jest juz wgrana (sprawdzone
--       2026-10-12: cialo event_speaker_detail nie czyta contact_email),
--       wiec funkcja nie siega po usuwana kolumne w zadnej kolejnosci.
--
--   D3  Widok ma ACL `arwdDxtm` dla anon i authenticated (domyslne
--       uprawnienia schematu public przy CREATE VIEW; GRANT SELECT ich nie
--       zaweza). Widok jest prosty, wiec automatycznie aktualizowalny,
--       wlascicielem jest postgres (BYPASSRLS), a RLS na author_profiles nie
--       jest FORCE - INSERT/UPDATE/DELETE przez widok szlyby obok polityk
--       tabeli bazowej. Zaden klient nie pisze przez widok (src/** tylko
--       .select), wiec zostaje sam SELECT - grant, ktory 20260730120000
--       nadaje jawnie.
--
-- ZMIANA (stan docelowy 20260730120000, nic ponad):
--   1) author_profiles_public - DROP + CREATE (CREATE OR REPLACE nie usunie
--      kolumny), projekcja i predykat 1:1 z 20260730120000: is_public, tenant
--      hosta z sesji (public_tenant_id()), DEFINER + security_barrier,
--      media_contact_name zostaje (nazwa biura, nie kanal kontaktu).
--   2) Granty: REVOKE ALL od anon/authenticated, potem GRANT SELECT jak
--      w 20260730120000. service_role bez zmian (backend).
--
-- Kontakt autora czytaja dalej: wlasciciel (get_own_author_profile), admin
-- najemcy (admin_get_author_profile) i service_role. get_expert_hub na
-- produkcji juz nie czyta contact_email - bez zmian.
--
-- Pas drizzle: drizzle/migrations/0185_author_profiles_public_drop_contact_email.sql
-- (blizniak - ten sam SQL wykonywalny).
-- BEZ wpisu do supabase_migrations.schema_migrations z pasa drizzle (inaczej
-- niz 0149): rejestr produkcji nie notuje jeszcze 20261012095900..
-- 20261012123000 (ich SQL wykonaly repliki drizzle 0151-0163, wpisow brak),
-- a `supabase db push` bez `--include-all` (scripts/migrate-with-preflight.sh)
-- pomija wersje starsze od glowy rejestru - wpis z wyprzedzeniem przesunalby
-- glowe ponad nie, tak jak przesuniecie glowy zgubilo 20260730120000.
-- Wersje rejestru uzgadnia sie razem z tamta paczka; SQL jest idempotentny,
-- wiec ponowne wykonanie po blizniaku drizzle niczego nie zmienia.
-- IDEMPOTENTNA: DROP IF EXISTS + CREATE, REVOKE/GRANT, COMMENT.
-- DOWOD: supabase/tests/author_contact_privacy_test.sql,
-- public_definer_views_read_only_test.sql.
-- ============================================================================

-- ---------- 1) author_profiles_public: projekcja bez kanalow kontaktu --------
DROP VIEW IF EXISTS public.author_profiles_public;

CREATE VIEW public.author_profiles_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  ap.id,
  ap.user_id,
  ap.tenant_id,
  ap.is_public,
  ap.job_title,
  ap.company,
  ap.avatar_url,
  ap.bio_pl,
  ap.bio_en,
  ap.full_bio_pl,
  ap.full_bio_en,
  ap.linkedin_url,
  ap.x_url,
  ap.facebook_url,
  ap.instagram_url,
  ap.spotify_url,
  ap.website_url,
  ap.custom_socials,
  ap.brand_accent,
  ap.brand_accent_dark,
  ap.layout_template_id,
  ap.layout_preset,
  ap.layout_section_order,
  ap.layout_overrides,
  ap.org_functions,
  ap.counterpart_lang,
  ap.counterpart_user_id,
  ap.media_contact_name,
  ap.created_at,
  ap.updated_at
FROM public.author_profiles ap
WHERE ap.is_public = true
  AND ap.tenant_id = public_tenant_id();

-- ---------- 2) Granty: tylko odczyt dla rol klienckich -----------------------
REVOKE ALL ON public.author_profiles_public FROM anon, authenticated;
GRANT SELECT ON public.author_profiles_public TO anon, authenticated;

COMMENT ON VIEW public.author_profiles_public IS
  'Public author projection (is_public, host tenant). No contact channels: phone, contact_email, media_contact_email and media_contact_phone are readable only by the owner (get_own_author_profile), tenant admins (admin_get_author_profile) and service_role. Read-only for anon/authenticated.';
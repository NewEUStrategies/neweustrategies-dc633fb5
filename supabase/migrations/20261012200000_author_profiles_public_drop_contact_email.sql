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
--       gosc). Port 20261012123000 oddaje tam NULL, ale na produkcji jeszcze
--       go nie ma. Samo usuniecie kolumny bez podmiany funkcji konczyloby
--       kazde wywolanie RPC bledem 42703, wiec funkcja idzie tu PIERWSZA.
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
--   1) event_speaker_detail - cialo 1:1 z 20261012123000 (e-mail autora
--      NULL, kontakt tylko z event_people przy email_visible/phone_visible).
--   2) author_profiles_public - DROP + CREATE (CREATE OR REPLACE nie usunie
--      kolumny), projekcja i predykat 1:1 z 20260730120000: is_public, tenant
--      hosta z sesji (public_tenant_id()), DEFINER + security_barrier,
--      media_contact_name zostaje (nazwa biura, nie kanal kontaktu).
--   3) Granty: REVOKE ALL od anon/authenticated, potem GRANT SELECT jak
--      w 20260730120000. service_role bez zmian (backend).
--
-- Kontakt autora czytaja dalej: wlasciciel (get_own_author_profile), admin
-- najemcy (admin_get_author_profile) i service_role. get_expert_hub na
-- produkcji juz nie czyta contact_email - bez zmian.
--
-- Pas drizzle: drizzle/migrations/0151_author_profiles_public_drop_contact_email.sql
-- (to samo cialo + wpis rejestru tej wersji, wzorem 0149).
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP IF EXISTS + CREATE, REVOKE/GRANT.
-- DOWOD: supabase/tests/author_contact_privacy_test.sql,
-- event_speaker_detail_test.sql, plpgsql_check_gate_test.sql.
-- ============================================================================

-- ---------- 1) event_speaker_detail: bez odczytu ap.contact_email ------------
CREATE OR REPLACE FUNCTION public.event_speaker_detail(p_event_id uuid, p_speaker_profile_id uuid, p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tenant uuid; v_result jsonb;
BEGIN
  IF p_preview THEN
    v_tenant := public.assert_event_admin_tenant();
  ELSE
    v_tenant := public.public_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'bio_pl', COALESCE(NULLIF(btrim(sp.bio_pl), ''), NULLIF(btrim(pe.bio_pl), ''), ap.bio_pl),
    'bio_en', COALESCE(NULLIF(btrim(sp.bio_en), ''), NULLIF(btrim(pe.bio_en), ''), ap.bio_en),
    'social_links', jsonb_strip_nulls(COALESCE(pe.social_links, '{}'::jsonb) || jsonb_build_object(
      'linkedin', COALESCE(NULLIF(ap.linkedin_url, ''), pe.social_links->>'linkedin'),
      'x', COALESCE(NULLIF(ap.x_url, ''), pe.social_links->>'x'),
      'facebook', COALESCE(NULLIF(ap.facebook_url, ''), pe.social_links->>'facebook'),
      'instagram', COALESCE(NULLIF(ap.instagram_url, ''), pe.social_links->>'instagram'),
      'website', COALESCE(NULLIF(ap.website_url, ''), pe.social_links->>'website', NULLIF(pe.social_profile_url, ''))
    )),
    'email', CASE WHEN pe.email_visible THEN NULLIF(btrim(pe.email), '') ELSE NULL END,
    'phone', CASE WHEN pe.phone_visible THEN NULLIF(btrim(pe.phone), '') ELSE NULL END
  ) INTO v_result
  FROM public.speaker_profiles sp
  JOIN public.events e ON e.id = p_event_id AND e.tenant_id = sp.tenant_id
  LEFT JOIN public.event_people pe ON pe.id = sp.person_id AND pe.tenant_id = sp.tenant_id
  LEFT JOIN public.author_profiles_public ap ON ap.user_id = sp.user_id AND ap.tenant_id = sp.tenant_id
  WHERE sp.id = p_speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
    AND (p_preview OR e.status = 'published')
    AND (EXISTS (SELECT 1 FROM public.event_speaker_entries en WHERE en.event_id = e.id AND en.tenant_id = v_tenant AND en.speaker_profile_id = sp.id)
      OR EXISTS (SELECT 1 FROM public.event_speakers es WHERE es.event_id = e.id AND es.user_id = sp.user_id));
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_speaker_detail(uuid, uuid, boolean) IS
  'On-demand event speaker details: public tenant and published event; preview requires same-tenant event admin. Contact follows existing event_people.email_visible/phone_visible; author links come from the author_profiles_public projection, which carries no author contact e-mail (20260730120000). Never raw admin contact.';

-- ---------- 2) author_profiles_public: projekcja bez kanalow kontaktu --------
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

-- ---------- 3) Granty: tylko odczyt dla rol klienckich -----------------------
REVOKE ALL ON public.author_profiles_public FROM anon, authenticated;
GRANT SELECT ON public.author_profiles_public TO anon, authenticated;

COMMENT ON VIEW public.author_profiles_public IS
  'Public author projection (is_public, host tenant). No contact channels: phone, contact_email, media_contact_email and media_contact_phone are readable only by the owner (get_own_author_profile), tenant admins (admin_get_author_profile) and service_role. Read-only for anon/authenticated.';

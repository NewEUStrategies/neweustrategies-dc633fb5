-- ============================================================================
-- BILET W PORTFELU: APPLE WALLET I GOOGLE WALLET (dane przepustki + dziennik).
--
-- BLIZNIAK drizzle/migrations/0063_event_ticket_wallet.sql - ten sam SQL wykonywalny
-- (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
-- events-harness: include
--
-- PO CO
-- Uczestnik z przyjetym i rozliczonym zgloszeniem ma bilet z kodem QR na
-- stronie `/events/<slug>/ticket#t=<kod>`. Kod jest poswiadczeniem przy
-- bramce, a baza trzyma wylacznie jego SHA-256 (`qr_token_hash`). Zeby dodac
-- bilet do Apple Wallet albo Google Wallet, serwer musi zlozyc przepustke:
-- tytul i termin wydarzenia, imie posiadacza, rodzaj biletu, kolory marki.
-- Strona biletu wysyla wiec JAWNY kod (z fragmentu adresu, w ciele POST,
-- nigdy w adresie), a ta migracja daje dwie rzeczy:
--
--   1. `event_ticket_wallet_payload(p_payload jsonb)` - plaszczyzna TRESCI
--      (`public_tenant_id()`, BEZ has_role/is_staff): po skrocie kodu oddaje
--      dane JEDNEJ przepustki, tylko dla zgloszenia przyjetego albo obecnego
--      (`approved`/`attended`), oplaconego albo bezplatnego
--      (`paid`/`partially_refunded`/`not_required`), na wydarzeniu, ktore nie
--      zostalo odwolane. Zwrot CZESCIOWY to korekta ceny, nie rezygnacja:
--      uczestnik zachowuje miejsce i kod QR (20260926153200, skaner go
--      wpuszcza, bilet wysylany jest mailem), wiec przepustka tez mu sie
--      nalezy. Zwrot pelny kasuje `qr_token_hash`, wiec nie przejdzie.
--      Kazdy inny stan to `not_found` - nie rozrozniamy "anulowane" od
--      "nie istnieje", zeby odpowiedz nie byla wyrocznia stanu cudzego biletu.
--   2. `event_wallet_passes` + `_event_wallet_pass_note(...)` - dziennik
--      wydanych przepustek (platforma, identyfikator obiektu, pierwsze
--      i ostatnie wydanie, licznik). Zapisuje go WYLACZNIE service_role
--      (trasa serwerowa po udanym wydaniu). Dziennik jest pod przyszla
--      dezaktywacje obiektow Google (`state: INACTIVE`) po anulowaniu
--      zgloszenia i pod statystyke - nie jest sygnalem CRM.
--
-- CZEGO NIE ZMIENIA
--   * formatu kodu biletu (`_event_new_qr_token()`, 32 znaki base64url) ani
--     jego wydania (`_event_issue_ticket_codes`) - przepustka niesie ten sam
--     kod, ktory skaner juz rozpoznaje;
--   * zadnej istniejacej funkcji, polityki ani tabeli.
--
-- BEZPIECZENSTWO
--   * Najemca z hosta (`public_tenant_id()`); kod obcego najemcy daje
--     `not_found`. Zgadniecie kodu jest niewykonalne (192 bity entropii);
--     trasa i tak ogranicza tempo po adresie IP.
--   * Odpowiedz nie niesie adresu e-mail ani telefonu - tylko to, co i tak
--     widnieje na bilecie (imie i nazwisko posiadacza).
--   * `_event_wallet_pass_note` przyjmuje najemce jawnie, bo wola go serwer
--     kluczem service_role PO autoryzacji kodem; wiersz dziennika wiaze sie
--     kluczami zlozonymi z tym samym najemca co zgloszenie i wydarzenie.
--
-- IDEMPOTENCJA: CREATE TABLE IF NOT EXISTS (wiezy w definicji tabeli),
-- CREATE INDEX IF NOT EXISTS, DROP TRIGGER/POLICY IF EXISTS + CREATE,
-- CREATE OR REPLACE FUNCTION (obie funkcje sa nowe).
--
-- KOLEJNOSC WDROZENIA: po 20260926090000 (fundament organizatora); nie zalezy
-- od pozostalych funkcji organizatora.
--
-- Testy: scripts/events-harness/runtime_test.d/52_ticket_wallet.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_wallet_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  platform text NOT NULL,
  object_id text NOT NULL,
  first_issued_at timestamptz NOT NULL DEFAULT now(),
  last_issued_at timestamptz NOT NULL DEFAULT now(),
  issue_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_wallet_passes_platform_values CHECK (platform IN ('apple', 'google')),
  CONSTRAINT event_wallet_passes_object_id_len CHECK (char_length(object_id) BETWEEN 1 AND 200),
  CONSTRAINT event_wallet_passes_issue_count_positive CHECK (issue_count >= 1),
  CONSTRAINT event_wallet_passes_issued_order CHECK (last_issued_at >= first_issued_at),
  CONSTRAINT event_wallet_passes_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_wallet_passes_registration_platform_unique
    UNIQUE (tenant_id, registration_id, platform),
  CONSTRAINT event_wallet_passes_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_wallet_passes_registration_fk FOREIGN KEY (tenant_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_wallet_passes IS
  'Dziennik przepustek Apple Wallet / Google Wallet wydanych do zgloszen wydarzenia (jeden wiersz na zgloszenie i platforme). Zapis wylacznie przez _event_wallet_pass_note (service_role).';
COMMENT ON COLUMN public.event_wallet_passes.object_id IS
  'Identyfikator przepustki po stronie platformy: numer seryjny .pkpass (Apple) albo <issuer>.reg_<registration_id> (Google) - pod pozniejsza dezaktywacje.';

CREATE INDEX IF NOT EXISTS event_wallet_passes_event_platform_idx
  ON public.event_wallet_passes (tenant_id, event_id, platform);

DROP TRIGGER IF EXISTS event_wallet_passes_touch_updated_at ON public.event_wallet_passes;
CREATE TRIGGER event_wallet_passes_touch_updated_at
  BEFORE UPDATE ON public.event_wallet_passes
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

REVOKE ALL ON public.event_wallet_passes FROM anon, authenticated;
GRANT SELECT ON public.event_wallet_passes TO authenticated;
GRANT ALL ON public.event_wallet_passes TO service_role;
ALTER TABLE public.event_wallet_passes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_wallet_passes_staff_read" ON public.event_wallet_passes;
CREATE POLICY "event_wallet_passes_staff_read"
  ON public.event_wallet_passes FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );
-- Zapis: BRAK polityki klienckiej.

-- Plaszczyzna tresci: dane jednej przepustki po jawnym kodzie biletu.
CREATE OR REPLACE FUNCTION public.event_ticket_wallet_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_token text := btrim(COALESCE(p_payload->>'qr_token', ''));
  v_out jsonb;
BEGIN
  -- Ksztalt z `_event_new_qr_token()`: 24 bajty w base64url, 32 znaki.
  IF v_tenant IS NULL OR v_token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RAISE EXCEPTION 'invalid_token: qr_token must be 32 base64url characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'tenant_name', t.name,
    'status', r.status,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'lang', COALESCE(
      CASE
        WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'language')
        WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'lang')
        ELSE NULL
      END,
      (
        SELECT lower(ns.language)
        FROM public.newsletter_subscribers ns
        WHERE ns.tenant_id = r.tenant_id
          AND lower(ns.email) = lower(p.email)
          AND lower(ns.language) IN ('pl', 'en')
        LIMIT 1
      ),
      'pl'
    ),
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_ends_at', e.ends_at,
    'event_timezone', e.timezone,
    'event_location', e.location,
    'event_cover_url', e.cover_url,
    'event_branding', COALESCE(e.branding, '{}'::jsonb),
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en,
    'group_name_pl', g.name_pl,
    'group_name_en', g.name_en,
    'group_color', g.color
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  JOIN public.events e
    ON e.id = r.event_id AND e.tenant_id = r.tenant_id
  JOIN public.tenants t
    ON t.id = r.tenant_id
  LEFT JOIN public.profiles pr
    ON pr.id = p.user_id AND pr.tenant_id = r.tenant_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
  LEFT JOIN public.event_groups g
    ON g.id = r.group_id AND g.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND r.qr_token_hash IS NOT NULL
    AND r.qr_token_hash = encode(digest(v_token, 'sha256'), 'hex')
    AND r.status IN ('approved', 'attended')
    AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
    AND e.status <> 'cancelled';

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: no valid ticket for this code';
  END IF;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.event_ticket_wallet_payload(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_ticket_wallet_payload(jsonb)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.event_ticket_wallet_payload(jsonb) IS
  'Dane przepustki Apple/Google Wallet dla JAWNEGO kodu biletu (p_payload.qr_token). Najemca z hosta (public_tenant_id), bez has_role. Tylko zgloszenie approved/attended oplacone (takze po zwrocie czesciowym) albo bezplatne na nieodwolanym wydarzeniu; inaczej not_found.';

-- Dziennik wydania: wylacznie service_role, po autoryzacji kodem.
CREATE OR REPLACE FUNCTION public._event_wallet_pass_note(
  p_tenant uuid,
  p_registration_id uuid,
  p_platform text,
  p_object_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_object text := btrim(COALESCE(p_object_id, ''));
  v_event_id uuid;
  v_count integer;
BEGIN
  IF v_platform NOT IN ('apple', 'google') THEN
    RAISE EXCEPTION 'invalid_platform: %', v_platform USING ERRCODE = '22023';
  END IF;
  IF char_length(v_object) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_object_id: object id must have 1-200 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.event_id INTO v_event_id
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = p_tenant;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  INSERT INTO public.event_wallet_passes AS w
    (tenant_id, event_id, registration_id, platform, object_id)
  VALUES (p_tenant, v_event_id, p_registration_id, v_platform, v_object)
  ON CONFLICT (tenant_id, registration_id, platform) DO UPDATE
    SET object_id = EXCLUDED.object_id,
        last_issued_at = now(),
        issue_count = w.issue_count + 1
  RETURNING w.issue_count INTO v_count;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public._event_wallet_pass_note(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_note(uuid, uuid, text, text) TO service_role;
COMMENT ON FUNCTION public._event_wallet_pass_note(uuid, uuid, text, text) IS
  'Odnotowuje wydanie przepustki Wallet (upsert po najemcy, zgloszeniu i platformie; licznik i ostatnie wydanie). Wylacznie service_role: najemca przychodzi od serwera, ktory zautoryzowal kod biletu.';

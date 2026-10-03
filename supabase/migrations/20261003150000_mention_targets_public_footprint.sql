-- Cele @wzmianek: firma z kartoteki CRM jest celem TYLKO, gdy jest już publiczna.
--
-- DEFEKT (20260922080000_mention_targets_rpc.sql). `search_mention_targets`
-- (SECURITY DEFINER, EXECUTE dla `anon`) zwracała w CTE `companies` KAŻDY wiersz
-- `public.crm_companies` najemcy - nazwę, logo, stronę, branżę i UUID - gdy fraza
-- miała co najmniej dwa znaki. Brakowało jakiegokolwiek warunku publikacji, więc
-- anonimowy odwiedzający (kompozytor komentarza, formularz kontaktowy albo goły
-- POST na /rest/v1/rpc) przechodził pętlą po parach liter i zbierał całą
-- kartotekę: prospektów, firmy założone z leadów (`crm_upsert_from_form`), firmy
-- nabywców faktur. Dwie cechy robiły z tego zrzut deterministyczny, a nie
-- zgadywanie:
--   * fraza szła do `LIKE` bez ucieczki, więc `_q = '%%'` pasowało do każdej
--     nazwy i oddawało 20 firm na wywołanie, a `'a%'`, `'ab%'`... przechodziły
--     katalog w głąb;
--   * najemcę anonima wybiera `public_tenant_id()`, który honoruje
--     niepoświadczony nagłówek `x-tenant-host` - ten sam zrzut działał wobec
--     kartoteki KAŻDEGO najemcy o znanej domenie.
-- `get_mention_target` miała tę samą dziurę jako odczyt punktowy: UUID z wyniku
-- (albo z każdego innego wycieku) otwierał publiczną, cache'owaną i indeksowaną
-- stronę /organization/org-<uuid> z linkiem wychodzącym na stronę firmy.
--
-- To było sprzeczne z decyzją zapisaną wprost w
-- 20260817090000_post_organization_and_sponsored_disclosure.sql: kartoteka jest
-- czytelna wyłącznie dla stafu CRM (`crm_companies_staff_read`), a dopisanie
-- `anon` „wystawiłoby cały katalog firm (z leadami po FK) publicznie".
--
-- REGUŁA PO NAPRAWIE. Firma jest celem wzmianki (podpowiedź, dymek, strona
-- profilu) wyłącznie wtedy, gdy ma JUŻ PUBLICZNY ŚLAD w tym samym najemcy:
--   1. jest organizacją przypisaną do OPUBLIKOWANEGO wpisu - te same predykaty
--      co polityka „Public reads published posts": status = 'published' AND
--      deleted_at IS NULL (zaplanowane, robocze, archiwalne i usunięte nie
--      liczą się); wpis i tak pokazuje czytelnikowi migawkę tej firmy;
--   2. jest OPUBLIKOWANYM sponsorem OPUBLIKOWANEGO wydarzenia - te same
--      predykaty co polityka `event_sponsors_public_read`: s.is_published AND
--      e.status = 'published'.
-- Nic poza tym. Logo prelegenta z kartoteki (`event_speaker_logos_public`)
-- wypuszcza samo logo, bez nazwy, strony i UUID, więc śladem NIE jest. Firma
-- pracodawcy z profilu (`profiles.current_company_id`) jest kolumną świadomie
-- odciętą od `anon`, więc też nie.
--
-- DLACZEGO JEDNA REGUŁA DLA WSZYSTKICH, BEZ GAŁĘZI „STAFF WIDZI CAŁOŚĆ".
--   * Spójność odczytu: wszystko, co da się wzmiankować, musi się dać rozwiązać
--     u czytelnika. Wzmianka firmy bez śladu wstawiona przez redaktora i tak
--     byłaby dla gościa nierozwiązywalna (chip „Firma" prowadzący do 404), a dla
--     redaktora - rozwiązywalna, czyli dwa obrazy jednej treści.
--   * Doktryna najemcy: `check:sql-tenant-scope` odrzuca ciało SECURITY DEFINER,
--     które łączy `public_tenant_id()` z `has_role()`/`is_staff()`. Rola musi
--     być wiązana z najemcą domowym, a te funkcje rozstrzygają najemcę z hosta.
--   * Staff ma własne, zamknięte wejście do pełnej kartoteki:
--     `crm_company_inline_lookup` (20260924120000, bez EXECUTE dla `anon`).
--
-- OPTYMALIZACJA PRZY OKAZJI. Pomiar (PostgreSQL 16, najemca z 40 000 firm
-- w kartotece, 6000 odkrywalnych profili, 300 redakcyjnych, 20 000 wpisów;
-- najlepszy z pięciu przebiegów): wersja z 20260922080000 - 3,2-3,7 s na KAŻDE
-- wywołanie, także dla gołego `@`; ta wersja - 28-46 ms dla frazy od trzech
-- znaków, 70-90 ms dla frazy pustej, jedno- i dwuznakowej. Wyniki dla osób
-- identyczne co do wiersza i kolejności.
--   * Liczba publikacji osoby: `UNION` dwóch odczytów po indeksach częściowych
--     (`idx_posts_author_published`, `idx_post_authors_user`) zamiast
--     `LEFT JOIN post_authors ... WHERE author_id = osoba OR pa.user_id IS NOT
--     NULL`. Tamten `OR` nad złączeniem nie trafiał w żaden indeks i dla KAŻDEGO
--     profilu przechodził wszystkie opublikowane wpisy najemcy (~8 ms na profil,
--     ~3 s przy 300 profilach redakcyjnych). To był główny koszt, także przed
--     tą zmianą.
--   * Dopasowanie frazy w CTE `MATERIALIZED`: bez bariery planista wypychał
--     warunek `post_count > 0` PONIŻEJ filtra frazy, więc zliczanie szło dla
--     wszystkich profili redakcyjnych nawet przy zerze trafień.
--   * Firmy: zbiór kandydatów to ślad publiczny dociągany po PK, a nie skan
--     kartoteki z `unaccent` + `word_similarity` na każde naciśnięcie klawisza.
--     `ROWS 100` na pomocniku: domyślne oszacowanie funkcji zwracającej zbiór
--     (1000) kazało planiście haszować CAŁĄ kartotekę najemcy (~50 ms przy
--     40 000 firm) zamiast sięgać po klucz główny.
--   * Fraza nie jest już wzorcem: `starts_with()`/`strpos()` zamiast `LIKE`
--     (wzorzec z `crm_company_inline_lookup`), więc `%`, `_` i `\` znaczą
--     siebie. Punktacja jest ta sama: podobieństwo słów + 1.0 za prefiks + 0.5
--     za wystąpienie, próg 0.3.
--   * Martwy warunek `slug <> 'org-'` znika (`id` jest NOT NULL PK).
--
-- SYGNATURY I KSZTAŁT WYNIKU BEZ ZMIAN (`CREATE OR REPLACE`, te same parametry,
-- domyślne wartości i RETURNS TABLE), więc `src/integrations/supabase/types.ts`
-- i klient zostają nietknięte. Ukryta firma daje ZERO WIERSZY, nigdy błąd:
-- klient z błędu robi pustą listę także dla osób, a trasa organizacji -
-- stronę „spróbuj ponownie" zamiast 404.

-- ---------------------------------------------------------------------------
-- 1) Jedno źródło prawdy: identyfikatory firm z publicznym śladem
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER i brak EXECUTE dla `anon`/`authenticated`: funkcję wołają
-- wyłącznie dwie funkcje SECURITY DEFINER niżej (wtedy działa z prawami ich
-- właściciela). Wywołana wprost przez klienta nie istnieje, a gdyby ktoś kiedyś
-- nadał jej EXECUTE, nadal czytałaby przez RLS wołającego.
CREATE OR REPLACE FUNCTION public._mention_public_company_ids(_tenant uuid)
RETURNS TABLE (company_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
ROWS 100
SET search_path = public, pg_temp
AS $$
  SELECT p.organization_id
    FROM public.posts p
   WHERE p.tenant_id = _tenant
     AND p.organization_id IS NOT NULL
     AND p.status = 'published'
     AND p.deleted_at IS NULL
  UNION
  SELECT s.company_id
    FROM public.event_sponsors s
    JOIN public.events e
      ON e.id = s.event_id
     AND e.tenant_id = s.tenant_id
   WHERE s.tenant_id = _tenant
     AND s.is_published
     AND e.status = 'published';
$$;

REVOKE ALL ON FUNCTION public._mention_public_company_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mention_public_company_ids(uuid) TO service_role;

COMMENT ON FUNCTION public._mention_public_company_ids(uuid) IS
  'Ids of CRM companies that already have a public footprint in the tenant: attributed to a published, non-deleted post, or a published sponsor of a published event. The ONLY gate under which search_mention_targets / get_mention_target may return a crm_companies row. Internal helper - no EXECUTE for anon/authenticated.';

-- ---------------------------------------------------------------------------
-- 2) Podpowiedzi przy pisaniu
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_mention_targets(
  _q text DEFAULT NULL,
  _limit int DEFAULT 8
)
RETURNS TABLE (
  kind text,
  id uuid,
  slug text,
  label text,
  subtitle text,
  avatar_url text,
  logo_url text,
  website text,
  verified boolean,
  score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH ctx AS (
    SELECT COALESCE(public._caller_tenant(), public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  nq AS (SELECT unaccent(lower(btrim(COALESCE(_q, '')))) AS q),
  -- MATERIALIZED to bariera: dopasowanie frazy zawęża profile ZANIM policzy
  -- się liczba publikacji (patrz nagłówek - bez bariery planista odwracał
  -- tę kolejność).
  people_matched AS MATERIALIZED (
    SELECT
      pr.id,
      pr.slug,
      pr.display_name,
      pr.avatar_url,
      pr.verified_at,
      COALESCE(ap.job_title, pr.job_title) AS job_title,
      COALESCE(ap.company, pr.current_company) AS company,
      COALESCE(ap.is_public, false) AS is_public_expert,
      ctx.tid,
      sc.score
    FROM public.profiles pr
    CROSS JOIN ctx
    CROSS JOIN nq
    CROSS JOIN LATERAL (SELECT unaccent(lower(COALESCE(pr.display_name, ''))) AS norm) n
    CROSS JOIN LATERAL (
      SELECT CASE WHEN nq.q = '' THEN 0.0
                  ELSE word_similarity(nq.q, n.norm)
                       + CASE WHEN starts_with(n.norm, nq.q) THEN 1.0 ELSE 0.0 END
                       + CASE WHEN strpos(n.norm, nq.q) > 0 THEN 0.5 ELSE 0.0 END
             END AS score
    ) sc
    LEFT JOIN public.author_profiles ap ON ap.user_id = pr.id AND ap.tenant_id = pr.tenant_id
    WHERE pr.tenant_id = ctx.tid
      AND pr.slug IS NOT NULL
      AND pr.discoverable = true
      AND (nq.q = '' OR length(nq.q) < 2 OR sc.score > 0.3)
  ),
  people AS (
    SELECT
      'person'::text AS kind,
      s.id,
      s.slug,
      COALESCE(s.display_name, 'Autor') AS label,
      NULLIF(concat_ws(' - ', s.job_title, s.company), '') AS subtitle,
      s.avatar_url,
      NULL::text AS logo_url,
      NULL::text AS website,
      (s.verified_at IS NOT NULL) AS verified,
      s.score,
      -- Wpisy osoby jako autora albo współautora, każdy raz (UNION). Dwa
      -- odczyty po indeksach częściowych zamiast `OR` nad złączeniem.
      (SELECT count(*)
         FROM (
           SELECT p.id
             FROM public.posts p
            WHERE p.author_id = s.id
              AND p.tenant_id = s.tid
              AND p.status = 'published'
              AND p.deleted_at IS NULL
           UNION
           SELECT p.id
             FROM public.post_authors pa
             JOIN public.posts p ON p.id = pa.post_id
            WHERE pa.user_id = s.id
              AND p.tenant_id = s.tid
              AND p.status = 'published'
              AND p.deleted_at IS NULL
         ) authored) AS post_count,
      s.is_public_expert
    FROM people_matched s
    WHERE public.user_is_editorial(s.id)
  ),
  companies AS (
    SELECT
      'organization'::text AS kind,
      c.id,
      ('org-' || c.id::text) AS slug,
      c.name AS label,
      NULLIF(c.branch, '') AS subtitle,
      NULL::text AS avatar_url,
      c.logo_url,
      c.website,
      false AS verified,
      CASE WHEN nq.q = '' THEN 0.0
           ELSE word_similarity(nq.q, n.norm)
                + CASE WHEN starts_with(n.norm, nq.q) THEN 1.0 ELSE 0.0 END
                + CASE WHEN strpos(n.norm, nq.q) > 0 THEN 0.5 ELSE 0.0 END
      END AS score,
      0::bigint AS post_count,
      false AS is_public_expert
    FROM ctx
    CROSS JOIN nq
    -- Fraza krótsza niż 2 znaki nie szuka firm wcale: najemca NULL daje pusty
    -- zbiór śladu bez czytania wpisów i sponsorów.
    CROSS JOIN LATERAL public._mention_public_company_ids(
      CASE WHEN length(nq.q) >= 2 THEN ctx.tid END
    ) pub
    JOIN public.crm_companies c
      ON c.id = pub.company_id
     AND c.tenant_id = ctx.tid
    CROSS JOIN LATERAL (SELECT unaccent(lower(c.name)) AS norm) n
    WHERE btrim(c.name) <> ''
  ),
  cand AS (
    SELECT * FROM people WHERE post_count > 0 OR is_public_expert
    UNION ALL
    SELECT * FROM companies WHERE score > 0.3
  )
  SELECT kind, id, slug, label, subtitle, avatar_url, logo_url, website, verified, score::real
  FROM cand
  ORDER BY score DESC, post_count DESC, label
  LIMIT GREATEST(LEAST(COALESCE(_limit, 8), 20), 1);
$$;

REVOKE ALL ON FUNCTION public.search_mention_targets(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_mention_targets(text, int) TO anon;
GRANT EXECUTE ON FUNCTION public.search_mention_targets(text, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Odczyt pojedynczego celu (dymek, katalog wątku, /organization/org-<uuid>)
-- ---------------------------------------------------------------------------
-- Gałąź osoby bez zmian. Gałąź firmy dostaje TĘ SAMĄ bramkę śladu co
-- podpowiedzi: UUID nie jest do zgadnięcia, ale wycieka innymi drogami (stare
-- linki wzmianek, kolumna `event_sponsors.company_id`, RPC dla zalogowanych),
-- więc sam identyfikator nie może otwierać karty firmy bez publicznego śladu.
CREATE OR REPLACE FUNCTION public.get_mention_target(_slug text)
RETURNS TABLE (
  kind text,
  id uuid,
  slug text,
  label text,
  subtitle text,
  avatar_url text,
  logo_url text,
  website text,
  verified boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH ctx AS (
    SELECT COALESCE(public._caller_tenant(), public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  wanted AS (SELECT lower(btrim(COALESCE(_slug, ''))) AS slug),
  wanted_company AS (
    SELECT CASE
      WHEN wanted.slug ~ '^org-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN substring(wanted.slug FROM 5)::uuid
      ELSE NULL::uuid
    END AS id
    FROM wanted
  )
  SELECT 'person'::text AS kind,
         pr.id,
         pr.slug,
         COALESCE(pr.display_name, 'Autor') AS label,
         NULLIF(concat_ws(' - ', COALESCE(ap.job_title, pr.job_title), COALESCE(ap.company, pr.current_company)), '') AS subtitle,
         pr.avatar_url,
         NULL::text AS logo_url,
         NULL::text AS website,
         (pr.verified_at IS NOT NULL) AS verified
    FROM public.profiles pr
    CROSS JOIN ctx
    CROSS JOIN wanted
    LEFT JOIN public.author_profiles ap ON ap.user_id = pr.id AND ap.tenant_id = pr.tenant_id
   WHERE pr.tenant_id = ctx.tid
     AND pr.slug = wanted.slug
     AND pr.discoverable = true
     AND public.user_is_editorial(pr.id)
  UNION ALL
  SELECT 'organization'::text AS kind,
         c.id,
         ('org-' || c.id::text) AS slug,
         c.name AS label,
         NULLIF(c.branch, '') AS subtitle,
         NULL::text AS avatar_url,
         c.logo_url,
         c.website,
         false AS verified
    FROM public.crm_companies c
    CROSS JOIN ctx
    CROSS JOIN wanted_company wc
   WHERE c.tenant_id = ctx.tid
     AND c.id = wc.id
     AND EXISTS (
       SELECT 1
         FROM public._mention_public_company_ids(ctx.tid) pub
        WHERE pub.company_id = c.id
     )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_mention_target(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mention_target(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_mention_target(text) TO authenticated;

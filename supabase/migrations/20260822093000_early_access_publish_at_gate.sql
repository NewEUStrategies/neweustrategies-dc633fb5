-- ============================================================================
-- WCZESNY DOSTĘP: 72 GODZINY PRZED PUBLIKACJĄ OTWARTĄ, NA `posts.publish_at`
--
-- Katalog v6.1 sprzedaje w progu Członek Pro „wczesny dostęp do raportów:
-- 72 godziny przed publikacją otwartą" ze statusem [B?] i notatką „wymaga
-- bramki na posts.publish_at wobec rangi". Notatka jest trafna co do kolumny:
--
--   * `posts.published_at` oznacza FAKT publikacji,
--   * `posts.publish_at`  (20260702090100, editorial_workflow) oznacza jej
--     HARMONOGRAM - moment, w którym `publish_due_posts()` przestawi wpis ze
--     `scheduled` na `published`.
--
-- Wczesny dostęp to z definicji okno PRZED tym momentem, więc jedynym
-- poprawnym punktem zaczepienia jest `publish_at`. Do tej migracji flaga
-- `early_access` nie miała żadnej bramki (rejestr capabilities opisywał ją
-- wprost jako dekoracyjną), a polityka „Public reads published posts"
-- (20260625160054) wpuszczała wyłącznie `status = 'published'`. Obietnica
-- katalogu nie miała więc czego egzekwować.
--
-- ── CO SIĘ ZMIENIA ──────────────────────────────────────────────────────────
--
-- Dokładamy DRUGĄ politykę odczytu, nie ruszając pierwszej. Wpis zaplanowany
-- staje się widoczny dla konta z flagą `early_access` w oknie 72 godzin przed
-- terminem publikacji. Poza oknem nie widzi go nikt poza redakcją - polityka
-- „Staff reads own tenant posts" zostaje bez zmian.
--
-- ── DLACZEGO POLITYKA, A NIE has_content_access ─────────────────────────────
--
-- `has_content_access` rozstrzyga, czy oddać TREŚĆ wiersza, który czytelnik już
-- widzi. Tu problem jest o poziom niżej: wiersza nie ma w ogóle, bo RLS go nie
-- przepuszcza. Bramka w `has_content_access` byłaby martwa - nigdy by się nie
-- wykonała dla wpisu zaplanowanego.
--
-- ── PRZENIESIENIE FLAGI Z PROGU CZŁONEK NA PRO ──────────────────────────────
--
-- Seed katalogu v3 nadał `early_access` progowi `member` (Plus). Katalog v6
-- przeniósł wczesny dostęp do progu Pro i tam go opisuje; próg Członek go nie
-- wymienia. Dopóki flaga była dekoracyjna, rozjazd nic nie kosztował. Od tej
-- migracji flaga OTWIERA TREŚĆ, więc rozjazd trzeba zamknąć - inaczej wdrożenie
-- bramki rozdałoby benefit Pro wszystkim członkom za 39 zł.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Okno wczesnego dostępu w jednym miejscu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.early_access_window()
RETURNS interval
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT interval '72 hours';
$$;

REVOKE EXECUTE ON FUNCTION public.early_access_window() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.early_access_window() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.early_access_window() IS
  'Długość okna wczesnego dostępu do wpisów zaplanowanych (katalog v6.1: 72 godziny przed publikacją otwartą). Jedno źródło liczby dla polityki RLS i dla komunikacji w katalogu.';

-- ----------------------------------------------------------------------------
-- 2) Przeniesienie flagi na próg Pro i wyżej.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb)
                  || jsonb_build_object('early_access', true)
 WHERE key IN ('pro', 'vip', 'team', 'ngo', 'corporate',
               'partner', 'partner_general', 'presidents_circle')
   AND NOT COALESCE((features ->> 'early_access')::boolean, false);

-- Progi, którym katalog v6.1 wczesnego dostępu NIE obiecuje: flaga znika.
-- Usuwamy klucz zamiast ustawiać `false`, żeby panel nie pokazywał benefitu
-- „wyłączonego" tam, gdzie go po prostu nie ma w ofercie.
UPDATE public.membership_tiers
   SET features = features - 'early_access'
 WHERE key IN ('reader', 'supporter', 'member', 'student', 'educator')
   AND features ? 'early_access';

-- ----------------------------------------------------------------------------
-- 3) Bramka odczytu.
--
--    `(SELECT public.has_tier_feature(...))` w podzapytaniu skalarnym, nie
--    wywołanie per wiersz: Postgres liczy je RAZ na zapytanie (InitPlan),
--    a nie 200 razy na listę archiwum. Ten sam wzorzec co w polityce
--    „events member read" (20260817220000).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Early access reads scheduled posts" ON public.posts;
CREATE POLICY "Early access reads scheduled posts"
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (
    status = 'scheduled'::post_status
    AND deleted_at IS NULL
    AND tenant_id = public.public_tenant_id()
    AND publish_at IS NOT NULL
    AND publish_at > now()
    AND publish_at <= now() + (SELECT public.early_access_window())
    AND (SELECT public.has_tier_feature('early_access'))
  );

COMMENT ON COLUMN public.posts.publish_at IS
  'Termin publikacji wpisu zaplanowanego (UTC). Od 20260822093000 jest też punktem zaczepienia wczesnego dostępu: konto z flagą features early_access czyta wpis w oknie early_access_window() przed tym terminem. Nie mylić z published_at, który oznacza FAKT publikacji.';

-- ============================================================================
-- profiles.discoverable: KOREKTA SKUTKÓW HURTOWEGO UPDATE Z WPISU DZIENNIKA 0001.
-- Powrót do false WYŁĄCZNIE tam, gdzie baza dowodzi braku decyzji.
--
-- DEFEKT
--   Wpis dziennika drizzle `0001_profiles_discoverable_default_true` (when
--   2026-09-11 18:12:10.170 UTC) przestawił DEFAULT na true i wykonał
--   `UPDATE public.profiles SET discoverable = true WHERE discoverable = false`.
--   Zlał w jedno ludzi, którzy nigdy nie zdecydowali, i ludzi, którzy świadomie
--   się wypisali; do powrotu DEFAULT false (wpis 0013, when 2026-09-13
--   19:12:36.549 UTC; w tym pasie 20260913150000) każda rejestracja dostawała
--   true bez pytania. `discoverable` otwiera m.in. publiczny profil dla
--   anonima (`profile_is_public`), katalog i wyszukiwarkę osób, listy
--   uczestników, wiadomości prywatne i embeddingi profilu (37 funkcji i widok
--   `profiles_public`). RODO art. 25 ust. 2: domyślnie dane nie mogą być
--   udostępniane nieokreślonej liczbie osób bez działania tej osoby.
--   20260913150000 przywróciło DEFAULT, ale danych nie ruszało: nie było
--   sposobu odróżnić decyzji od skutku 0001.
--
-- DOWÓD W DANYCH (bez kopii sprzed 0001)
--   * `profiles_set_updated` (BEFORE UPDATE, `updated_at = now()`; w tym pasie
--     od 20260531180217, `set_updated_at()` bez zmian od 20260625112137) dał
--     KAŻDEMU wierszowi przestawionemu przez 0001 ten sam `updated_at`: czas
--     startu transakcji migratora (T0001). Wiersz, który do dziś go nosi, nie
--     był od tamtej chwili zmieniany, a 0001 dotknęło wyłącznie wierszy
--     z false - nikt go więc nie włączył.
--   * Konto założone w oknie DEFAULT true i nigdy niezmieniane ma
--     `updated_at = created_at`: true pochodzi z DEFAULT-u
--     (`handle_new_user()` nie wymienia kolumny), nie z decyzji.
--   * Prawdziwe decyzje tego nie spełniają: opt-in sprzed 0001 nie był przez
--     0001 dotknięty (`updated_at < T0001`), a każdy późniejszy przełącznik
--     przesunął `updated_at`.
--
-- POMIAR (funkcja mierzy na bazie, w której działa; zero literałów z produkcji)
--   T0001 = największy klaster identycznych `updated_at` (co najmniej dwa
--     wiersze) w oknie when(0001) ± 1 h. Narzędzie migracji Lovable zapisuje
--     wpis z `when` = chwila wywołania i w tym samym wywołaniu uruchamia
--     migrator; bot zacommitował 0001 o 18:12:21 UTC, 11 s po `when`. Godzina
--     w obie strony mieści rozjazd zegarów hosta i bazy oraz zwłokę
--     zatwierdzenia, a nie sięga żadnej innej hurtowej zmiany `profiles`
--     z historii repozytorium (najbliższe: 0021 z 2026-09-14, 0121/0123
--     z 2026-10-02).
--   T_RESTORE = najwcześniejsze `created_at` po T0001 konta niezmienianego od
--     założenia z false (dowód, że DEFAULT false już wrócił), przycięte do
--     when(0013) + 1 h. Bez takiego konta koniec okna nie jest ustalony
--     i kubeł B jest pomijany (raport to mówi).
--   Kubeł A (`flipped_by_0001_untouched`): true i `updated_at = T0001`.
--   Kubeł B (`default_true_window_signup`): true, `updated_at = created_at`
--     i `created_at` w [T0001, T_RESTORE).
--   Kubeł C (tylko liczony, do ponownego pytania w aplikacji): true, bez
--     znacznika decyzji (20261025090020), konto założone przed końcem okna
--     DEFAULT true, z `updated_at` po T0001, spoza kubła B. To głównie konta
--     zmieniane po 0001 - także przez późniejsze hurtowe UPDATE-y systemu
--     (0021: adresy awatarów i okładek, 0121/0123: puste slugi), które zatarły
--     ślad 0001.
--
-- BEZPIECZNIKI (każdy niespełniony = ZERO zmian i wiersz diagnostyczny)
--   * rejestr korekty niepusty -> `already_applied` (drugi przebieg nie mierzy
--     od nowa: po korekcie klaster T0001 znika i mniejszy klaster z tego
--     samego okna nie może zająć jego miejsca);
--   * brak klastra -> `no_cluster` (baza z tego pasa, CI: no-op);
--   * klaster < 10 wierszy -> `cluster_too_small`;
--   * klaster < 5 x następny klaster okna -> `cluster_not_dominant`;
--   * w klastrze wiersz z false albo założony nie wcześniej niż T0001 (to nie
--     jest podpis `SET discoverable = true` na istniejących kontach) ->
--     `cluster_signature_mismatch`;
--   * trwały błąd wykonania (np. 42501, 23514) -> `error`; podtransakcja
--     bloku wycofuje rejestr i przestawienia razem.
--   Bezpieczniki i trwałe błędy NIE rzucają: funkcja działa w JEDNEJ
--   transakcji migratora Lovable z całym wsadem wpisów, więc wyjątek wycofałby
--   także cudze wpisy, a ponowienie nie zmieni danych, które go wywołały.
--   Błędy PRZEJŚCIOWE (55P03 po `lock_timeout` 5 s, 40P01 zakleszczenie,
--   57014 anulowanie albo statement_timeout) funkcja rzuca dalej: wsad wycofuje
--   się w całości, wpis lustra zostaje oczekujący i runbook (§4.6) pozwala
--   ponowić wdrożenie. Połknięty, zapisałby się w rejestrze migratora jako
--   wykonany, choć korekta niczego nie zmieniła - i ponowienie nie byłoby już
--   możliwe. Anulowanie też nie jest połykane: to decyzja operatora.
--
-- ZMIANA
--   1. `profiles_discoverable_corrections` - rejestr korekty: profil, najemca,
--      kubeł, zmierzone T0001/T_RESTORE, chwila korekty, `notified_at` dla
--      powiadomień. RLS bez polityk; klient bez grantów; service_role: SELECT,
--      INSERT i UPDATE wyłącznie `notified_at` (wiersz jest dowodem korekty).
--   2. `_profiles_discoverable_0001_correction(p_apply)` - SECURITY INVOKER,
--      EXECUTE tylko service_role. Z p_apply = false liczy kubły samymi
--      SELECT-ami (działa też w transakcji tylko do odczytu); z p_apply = true
--      blokuje zmierzone wiersze i sprawdza, że od pomiaru się nie zmieniły
--      (decyzja zapisana w tej samej chwili wypada), zapisuje każdy w rejestrze
--      PRZED przestawieniem (ON CONFLICT DO NOTHING) i przestawia na false
--      dokładnie zapisane wiersze; potem, jeśli
--      `prune_profile_embeddings()` istnieje, usuwa embeddingi profili spoza
--      katalogu - we WŁASNYM bloku: błąd sprzątania (np. wiersz embeddingu
--      zablokowany przez zadanie embeddingów, 55P03 albo 40P01) daje
--      `embeddings_pruned` NULL i nie unieważnia korekty; to samo przycięcie
--      robi co godzinę zadanie embeddingów. Przestawienie przesuwa
--      `updated_at` (to prawdziwa zmiana wiersza) i zostawia
--      `discoverable_decided_at` = NULL (to nie jest decyzja właściciela).
--   3. Jedno wywołanie z p_apply = true i NOTICE z wynikiem.
--
-- CZEGO NIE ZMIENIA
--   * DEFAULT-u: false od 20260913150000 / 0011 / 0013.
--   * Kubła C ani nikogo z true sprzed 0001 - tylko liczy C.
--   * Wpisu 0001 w dzienniku (forward-only; nigdy go nie kopiujemy).
--
-- IDEMPOTENTNE: CREATE ... IF NOT EXISTS / OR REPLACE, a drugie wywołanie
-- kończy się `already_applied` bez zmian.
-- Nośnik w dzienniku drizzle generuje `bun run migrations:mirror`; nikt nie
-- pisze go ręcznie.
-- Test: supabase/tests/profiles_discoverable_0001_correction_test.sql.
-- Dla właściciela: docs/NAPRAWA_PROFILES_DISCOVERABLE_0001_2026-10-25.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Rejestr korekty
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles_discoverable_corrections (
  profile_id   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL,
  bucket       text NOT NULL
    CHECK (bucket IN ('flipped_by_0001_untouched', 'default_true_window_signup')),
  t0001        timestamptz NOT NULL,
  t_restore    timestamptz,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  notified_at  timestamptz,
  CONSTRAINT profiles_discoverable_corrections_window_known
    CHECK (bucket = 'flipped_by_0001_untouched' OR t_restore IS NOT NULL)
);

COMMENT ON TABLE public.profiles_discoverable_corrections IS
  'Rejestr korekty wpisu 0001 (profiles.discoverable przestawione hurtowo 2026-09-11): kto wrócił do false, z jakiego kubła, przy jakich zmierzonych T0001/T_RESTORE i czy dostał powiadomienie. Tylko service_role; pisze funkcja _profiles_discoverable_0001_correction.';

ALTER TABLE public.profiles_discoverable_corrections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles_discoverable_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.profiles_discoverable_corrections TO service_role;
GRANT UPDATE (notified_at) ON TABLE public.profiles_discoverable_corrections TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Funkcja korekty: pomiar, bezpieczniki, rejestr, przestawienie
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._profiles_discoverable_0001_correction(p_apply boolean)
RETURNS TABLE (
  status             text,
  measured_t0001     timestamptz,
  measured_t_restore timestamptz,
  cluster_rows       integer,
  next_cluster_rows  integer,
  bucket_a_rows      integer,
  bucket_b_rows      integer,
  bucket_c_rows      integer,
  embeddings_pruned  integer,
  detail             text
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  -- Kotwice z dziennika drizzle (fakty repozytorium, nie pomiar produkcji).
  c_0001_when   constant timestamptz := to_timestamp(1789150330.170);
  c_0013_when   constant timestamptz := to_timestamp(1789326756.549);
  c_slack       constant interval    := interval '1 hour';
  c_min_cluster constant integer     := 10;
  c_dominance   constant integer     := 5;
  c_bucket_a    constant text        := 'flipped_by_0001_untouched';
  c_bucket_b    constant text        := 'default_true_window_signup';
  v_status  text;
  v_detail  text;
  v_t0001   timestamptz;
  v_restore timestamptz;
  v_cluster integer;
  v_next    integer;
  v_a       integer := 0;
  v_b       integer := 0;
  v_c       integer;
  v_pruned  integer;
  v_foreign integer;
  v_ids     uuid[];
  v_seen_at timestamptz[];
  v_buckets text[];
BEGIN
  <<korekta>>
  BEGIN
    SELECT min(r.t0001), min(r.t_restore),
           count(*) FILTER (WHERE r.bucket = c_bucket_a)::integer,
           count(*) FILTER (WHERE r.bucket = c_bucket_b)::integer
      INTO v_t0001, v_restore, v_a, v_b
      FROM public.profiles_discoverable_corrections r;

    IF v_a + v_b > 0 THEN
      v_status := 'already_applied';
      v_detail := 'Korekta jest już w rejestrze profiles_discoverable_corrections; ten przebieg niczego nie zmienił.';
    ELSE
      SELECT (array_agg(k.ts ORDER BY k.n DESC, k.ts))[1],
             (array_agg(k.n ORDER BY k.n DESC, k.ts))[1],
             COALESCE((array_agg(k.n ORDER BY k.n DESC, k.ts))[2], 0)
        INTO v_t0001, v_cluster, v_next
        FROM (
          SELECT p.updated_at AS ts, count(*)::integer AS n
            FROM public.profiles p
           WHERE p.updated_at >= c_0001_when - c_slack
             AND p.updated_at <  c_0001_when + c_slack
           GROUP BY p.updated_at
          HAVING count(*) > 1
        ) k;

      IF v_t0001 IS NULL THEN
        v_status := 'no_cluster';
        v_detail := 'Brak klastra identycznych updated_at w oknie wpisu 0001 (when ± 1 h): baza nie niesie śladu 0001. Nic nie zmieniono.';
        EXIT korekta;
      END IF;
      IF v_cluster < c_min_cluster THEN
        v_status := 'cluster_too_small';
        v_detail := format('Liczebność największego klastra w oknie 0001: %s, minimum %s. Nic nie zmieniono.',
                           v_cluster, c_min_cluster);
        EXIT korekta;
      END IF;
      IF v_cluster < c_dominance * v_next THEN
        v_status := 'cluster_not_dominant';
        v_detail := format('Klaster nie dominuje: liczebność %s, następny klaster okna %s, wymagany co najmniej %s-krotny zapas. Nic nie zmieniono.',
                           v_cluster, v_next, c_dominance);
        EXIT korekta;
      END IF;

      SELECT count(*)::integer INTO v_foreign
        FROM public.profiles p
       WHERE p.updated_at = v_t0001
         AND (NOT p.discoverable OR p.created_at >= v_t0001);
      IF v_foreign > 0 THEN
        v_status := 'cluster_signature_mismatch';
        v_detail := format('Klaster %s nie jest podpisem 0001 (wiersze z false albo założone nie wcześniej niż T0001: %s). Nic nie zmieniono.',
                           v_t0001, v_foreign);
        EXIT korekta;
      END IF;

      SELECT min(p.created_at) INTO v_restore
        FROM public.profiles p
       WHERE p.created_at > v_t0001
         AND p.updated_at = p.created_at
         AND NOT p.discoverable;
      IF v_restore IS NOT NULL THEN
        v_restore := LEAST(v_restore, c_0013_when + c_slack);
      END IF;

      -- Kandydaci: JEDYNE miejsce predykatu kubłów A/B. Zwykły SELECT, więc
      -- podgląd (p_apply = false) działa także w transakcji tylko do odczytu.
      -- Przy v_restore NULL porównanie daje NULL, więc kubeł B wypada sam.
      SELECT array_agg(p.id ORDER BY p.id),
             array_agg(p.updated_at ORDER BY p.id),
             array_agg(CASE WHEN p.updated_at = v_t0001 THEN c_bucket_a ELSE c_bucket_b END
                       ORDER BY p.id),
             count(*) FILTER (WHERE p.updated_at = v_t0001)::integer,
             count(*) FILTER (WHERE p.updated_at <> v_t0001)::integer
        INTO v_ids, v_seen_at, v_buckets, v_a, v_b
        FROM public.profiles p
       WHERE p.discoverable
         AND (p.updated_at = v_t0001
              OR (p.updated_at = p.created_at
                  AND p.created_at >= v_t0001
                  AND p.created_at < v_restore));

      IF p_apply THEN
        -- Blokada wiersza ponownie sprawdza, że od pomiaru nikt go nie zmienił
        -- (każdy UPDATE przesuwa updated_at): decyzja zapisana w tej samej
        -- chwili wypada. Rejestr PRZED przestawieniem, przestawione dokładnie
        -- zapisane wiersze.
        WITH target AS (
          SELECT p.id, p.tenant_id, c.bucket
            FROM unnest(v_ids, v_seen_at, v_buckets) AS c(id, seen_at, bucket)
            JOIN public.profiles p ON p.id = c.id
           WHERE p.discoverable
             AND p.updated_at = c.seen_at
             FOR UPDATE OF p
        ), logged AS (
          INSERT INTO public.profiles_discoverable_corrections
                 (profile_id, tenant_id, bucket, t0001, t_restore)
          SELECT t.id, t.tenant_id, t.bucket, v_t0001, v_restore
            FROM target t
          ON CONFLICT (profile_id) DO NOTHING
          RETURNING profile_id, bucket
        ), flipped AS (
          UPDATE public.profiles p
             SET discoverable = false
            FROM logged l
           WHERE p.id = l.profile_id
          RETURNING l.bucket
        )
        SELECT count(*) FILTER (WHERE f.bucket = c_bucket_a)::integer,
               count(*) FILTER (WHERE f.bucket = c_bucket_b)::integer
          INTO v_a, v_b
          FROM flipped f;

        -- Sprzątanie we własnym bloku: jego błąd nie wycofuje korekty.
        IF to_regprocedure('public.prune_profile_embeddings()') IS NOT NULL THEN
          BEGIN
            v_pruned := public.prune_profile_embeddings();
          EXCEPTION WHEN others THEN
            v_pruned := NULL;
          END;
        END IF;
        v_status := 'applied';
        v_detail := format('Cofnięto do false: kubeł A %s, kubeł B %s.', v_a, v_b);
      ELSE
        v_status := 'dry_run';
        v_detail := format('Podgląd bez zmian: do cofnięcia kubeł A %s, kubeł B %s.', v_a, v_b);
      END IF;
      IF v_restore IS NULL THEN
        v_detail := v_detail || ' Kubeł B pominięty: brak niezmienianego konta z false założonego po T0001, więc koniec okna DEFAULT true nie jest ustalony.';
      END IF;
    END IF;

    SELECT count(*)::integer INTO v_c
      FROM public.profiles p
     WHERE p.discoverable
       AND p.discoverable_decided_at IS NULL
       AND p.updated_at > v_t0001
       AND p.created_at < COALESCE(v_restore, c_0013_when + c_slack)
       AND NOT COALESCE(p.updated_at = p.created_at
                        AND p.created_at >= v_t0001
                        AND p.created_at < v_restore, false);
  EXCEPTION
    -- Przejściowe: wsad ma się wycofać i dać ponowić (runbook §4.6).
    WHEN lock_not_available OR deadlock_detected OR query_canceled THEN
      RAISE;
    WHEN others THEN
      v_status := 'error';
      v_detail := format('%s: %s. Nic nie zmieniono.', SQLSTATE, SQLERRM);
      v_a := 0;
      v_b := 0;
      v_c := NULL;
      v_pruned := NULL;
  END korekta;

  RETURN QUERY SELECT v_status, v_t0001, v_restore, v_cluster, v_next,
                      v_a, v_b, v_c, v_pruned, v_detail;
END;
$fn$;

COMMENT ON FUNCTION public._profiles_discoverable_0001_correction(boolean) IS
  'Korekta wpisu 0001 (profiles.discoverable): mierzy T0001 (klaster updated_at w oknie when(0001) ± 1 h) i T_RESTORE na tej bazie, cofa do false kubły A i B z zapisem w profiles_discoverable_corrections (p_apply = true) albo tylko liczy (false). Niespełniony bezpiecznik albo trwały błąd = zero zmian i wiersz diagnostyczny bez wyjątku; błąd przejściowy (55P03, 40P01, 57014) rzuca dalej, żeby wsad migratora wycofał się i dał ponowić. Błąd przycięcia embeddingów nie unieważnia korekty. Tylko service_role.';

REVOKE ALL ON FUNCTION public._profiles_discoverable_0001_correction(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._profiles_discoverable_0001_correction(boolean) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Jedno wywołanie: na produkcji korekta, na bazie z tego pasa no-op
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public._profiles_discoverable_0001_correction(true);
  RAISE NOTICE 'profiles.discoverable, korekta 0001: % (T0001 %, T_RESTORE %, klaster % / następny %, A %, B %, C %, embeddingi %) - %',
    r.status, r.measured_t0001, r.measured_t_restore, r.cluster_rows, r.next_cluster_rows,
    r.bucket_a_rows, r.bucket_b_rows, r.bucket_c_rows, r.embeddings_pruned, r.detail;
END
$$;

-- ============================================================================
-- REKOMENDACJE PROFILOWE - naprawa kontraktu klient <-> baza (end-to-end).
--
-- Stan wyjsciowy: trzy rozbiezne slowniki miedzy `src/lib/network/*` i baza,
-- kazda z nich wywracala inny etap przeplywu:
--
--  1) SLOWNIK STATUSOW. Klient filtrowal `status === 'visible'`, baza zapisuje
--     'published' (CHECK: pending|published|declined|hidden). Zatwierdzona
--     rekomendacja NIGDY nie trafiala na profil - sekcja zawsze pokazywala
--     "brak publicznych rekomendacji".
--
--  2) SLOWNIK AKCJI (najgrozniejszy - cichy no-op z toastem sukcesu).
--     `respond_recommendation` rozpoznawalo publish|decline|hide, a klient
--     wysylal approve|hide|delete. Dla 'approve' i 'delete' galaz CASE spadala
--     do `ELSE status`, wiec UPDATE trafial we wiersz (FOUND = true, brak
--     wyjatku), status zostawal bez zmian, a UI pokazywal "Opublikowano" /
--     "Usunieto". Odbiorca dostawal FALSZYWE potwierdzenie operacji, ktora sie
--     nie wykonala - i nie mial zadnego sygnalu, ze cos poszlo nie tak.
--
--  3) RELACJA. Dialog zbieral `relationship` jako wolny tekst (2..120 znakow),
--     a kolumna ma domkniety CHECK IN (colleague|manager|report|client|mentor|
--     partner|other) - kazdy realny wpis konczyl sie naruszeniem CHECK
--     (surowy blad 23514 w toascie zamiast walidacji).
--
-- Kanonicznym slownikiem jest baza (dane sa juz zapisane w 'published'
-- /'hidden'), wiec migracja:
--   * przyjmuje oba warianty czasownika akcji (publish|approve, decline|reject,
--     delete|remove) i FAIL-CLOSED odrzuca kazdy nieznany czasownik zamiast po
--     cichu nic nie robic - cichy no-op przestaje byc mozliwy z definicji,
--   * realizuje 'delete' jako prawdziwy DELETE (dotad nieobslugiwany),
--   * waliduje `relationship` i dlugosc tresci z czytelnymi kodami bledow,
--   * domyka izolacje tenanta: autor i odbiorca musza byc w tym samym tenancie,
--     a lista jest skalowana tenantem WLASCICIELA profilu (dotad tenantem
--     wolajacego, wiec dla anonima `_caller_tenant()` = NULL => zero wierszy na
--     publicznym profilu, mimo ze sekcja jest publiczna),
--   * egzekwuje udokumentowana prywatnosc moderacji: autor nie widzi odmowy -
--     'hidden'/'declined' prezentuja mu sie jako 'pending'.
--
-- Regresje pilnuje supabase/tests/recommendations_contract_test.sql.
-- ============================================================================

-- Slownik relacji trzymamy w jednym miejscu, zeby CHECK kolumny, walidacja RPC
-- i lista opcji w UI nie mogly sie rozjechac po raz drugi.
CREATE OR REPLACE FUNCTION public.recommendation_relationships()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['colleague','manager','report','client','mentor','partner','other']::text[];
$$;

REVOKE ALL ON FUNCTION public.recommendation_relationships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recommendation_relationships() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.recommendation_relationships() IS
  'Kanoniczny slownik wartosci profile_recommendations.relationship (zrodlo dla RPC i UI).';

-- ---------------------------------------------------------------------------
-- write_recommendation: walidacja slownikowa + jeden tenant dla obu stron.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_recommendation(
  p_recipient UUID, p_relationship TEXT, p_body TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_author_tenant  UUID;
  v_owner_tenant   UUID;
  v_relationship   TEXT := lower(btrim(COALESCE(p_relationship, '')));
  v_body           TEXT := btrim(COALESCE(p_body, ''));
  v_id             UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_recipient IS NULL OR p_recipient = v_uid THEN
    RAISE EXCEPTION 'cannot_recommend_self' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_relationship = ANY (public.recommendation_relationships())) THEN
    RAISE EXCEPTION 'invalid_relationship' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) < 20 OR char_length(v_body) > 3000 THEN
    RAISE EXCEPTION 'invalid_body_length' USING ERRCODE = '22023';
  END IF;
  IF NOT public._are_connected(v_uid, p_recipient) THEN
    RAISE EXCEPTION 'must_be_connected' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_author_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_owner_tenant  FROM public.profiles WHERE id = p_recipient;
  IF v_author_tenant IS NULL OR v_owner_tenant IS NULL
     OR v_author_tenant <> v_owner_tenant THEN
    -- Rekomendacja miedzy tenantami bylaby niewidoczna (lista jest skalowana
    -- tenantem wlasciciela profilu), wiec odrzucamy ja jawnie.
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profile_recommendations
    (tenant_id, recipient_id, author_id, relationship, body)
  VALUES (v_owner_tenant, p_recipient, v_uid, v_relationship, v_body)
  ON CONFLICT (author_id, recipient_id) DO UPDATE
    SET body = EXCLUDED.body,
        relationship = EXCLUDED.relationship,
        -- Ponowny zapis wraca do moderacji odbiorcy (tresc sie zmienila).
        status = 'pending',
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

COMMENT ON FUNCTION public.write_recommendation(UUID, TEXT, TEXT) IS
  'Zapis/aktualizacja rekomendacji przez zaakceptowany kontakt. Relacja ze slownika recommendation_relationships(), tresc 20..3000 znakow, obie strony w jednym tenancie.';

-- ---------------------------------------------------------------------------
-- respond_recommendation: fail-closed slownik akcji + realny DELETE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_recommendation(p_id UUID, p_action TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_action TEXT := lower(btrim(COALESCE(p_action, '')));
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  -- Najpierw slownik, potem dane: nieznany czasownik NIE MOZE przejsc dalej
  -- jako no-op z sukcesem (to byl defekt "falszywego potwierdzenia").
  v_status := CASE v_action
                WHEN 'publish' THEN 'published'
                WHEN 'approve' THEN 'published'
                WHEN 'hide'    THEN 'hidden'
                WHEN 'decline' THEN 'declined'
                WHEN 'reject'  THEN 'declined'
                WHEN 'delete'  THEN NULL
                WHEN 'remove'  THEN NULL
                ELSE '?'
              END;
  IF v_status = '?' THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  IF v_status IS NULL THEN
    DELETE FROM public.profile_recommendations
     WHERE id = p_id AND recipient_id = v_uid;
  ELSE
    UPDATE public.profile_recommendations
       SET status = v_status, updated_at = now()
     WHERE id = p_id AND recipient_id = v_uid;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_your_recommendation' USING ERRCODE = '42501';
  END IF;
END; $$;

COMMENT ON FUNCTION public.respond_recommendation(UUID, TEXT) IS
  'Moderacja rekomendacji przez odbiorce: publish/approve, hide, decline/reject, delete/remove. Nieznana akcja podnosi invalid_action - brak cichego no-opa.';

-- ---------------------------------------------------------------------------
-- list_recommendations: tenant WLASCICIELA profilu + publiczny odczyt +
-- prywatnosc moderacji wobec autora.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recommendations(p_recipient UUID)
RETURNS TABLE (
  id UUID, author_id UUID, author_name TEXT, author_avatar TEXT,
  author_headline TEXT, relationship TEXT, body TEXT, status TEXT, created_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_owner_tenant  UUID;
  v_caller_tenant UUID;
BEGIN
  IF p_recipient IS NULL THEN RETURN; END IF;

  -- Skalowanie tenantem WLASCICIELA profilu: sekcja jest publiczna, wiec
  -- anonimowy czytelnik (bez wiersza w profiles) tez musi zobaczyc
  -- opublikowane rekomendacje.
  SELECT p.tenant_id INTO v_owner_tenant FROM public.profiles p WHERE p.id = p_recipient;
  IF v_owner_tenant IS NULL THEN RETURN; END IF;

  -- Zalogowany czytelnik widzi tylko profile ze swojego tenanta.
  IF v_uid IS NOT NULL THEN
    SELECT p.tenant_id INTO v_caller_tenant FROM public.profiles p WHERE p.id = v_uid;
    IF v_caller_tenant IS DISTINCT FROM v_owner_tenant THEN RETURN; END IF;
  END IF;

  RETURN QUERY
    SELECT r.id, r.author_id, p.display_name, p.avatar_url,
           p.job_title, r.relationship, r.body,
           -- Prywatnosc moderacji: autor nie dowiaduje sie o odmowie/ukryciu -
           -- w jego widoku rekomendacja zostaje "pending".
           CASE
             WHEN r.recipient_id = v_uid THEN r.status
             WHEN r.author_id = v_uid AND r.status IN ('hidden', 'declined') THEN 'pending'
             ELSE r.status
           END AS status,
           r.created_at
      FROM public.profile_recommendations r
      JOIN public.profiles p ON p.id = r.author_id
     WHERE r.recipient_id = p_recipient
       AND r.tenant_id = v_owner_tenant
       AND (r.status = 'published' OR r.recipient_id = v_uid OR r.author_id = v_uid)
     ORDER BY r.created_at DESC;
END; $$;

COMMENT ON FUNCTION public.list_recommendations(UUID) IS
  'Rekomendacje profilu skalowane tenantem wlasciciela profilu. Anonim/inny czytelnik: tylko published. Autor nie widzi hidden/declined (prezentowane jako pending).';

-- Sekcja rekomendacji jest czescia publicznego profilu (renderowana takze w
-- SSR dla niezalogowanych), wiec odczyt musi byc dostepny dla `anon`.
GRANT EXECUTE ON FUNCTION public.list_recommendations(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_recommendation(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_recommendation(UUID, TEXT) TO authenticated;

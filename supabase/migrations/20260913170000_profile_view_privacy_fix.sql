-- Tryb "prywatny" w "Kto oglądał Twój profil": naprawa warunku, który nigdy
-- nie trafiał, i licznika, który liczył to, czego lista nie pokazywała.
--
-- PRZYCZYNA ŹRÓDŁOWA. 20260718215718 zapisywało w trybie `private`
-- `viewer_id = NULL`, a zabezpieczenie przed powtórzeniem szukało wiersza po
-- `viewer_id = auth.uid()`. Warunek był NIEPRAWDZIWY Z ZAŁOŻENIA: dla widza
-- prywatnego nie mógł trafić w żaden istniejący wiersz, bo takiego wiersza z
-- jego identyfikatorem nigdy nie było. Skutki składały się w całość odwrotną
-- do etykiety ustawienia:
--   * debounce godzinny NIE OBOWIĄZYWAŁ prywatnych - każde wejście na profil
--     zakładało nowy wiersz, podczas gdy widz publiczny zostawiał jeden na
--     godzinę;
--   * `my_profile_viewers` filtruje wyłącznie `profile_id = auth.uid()`, więc
--     wiersz prywatnego widza WRACAŁ na listę, tyle że z wymaskowanymi polami
--     (wyglądał jak anonim);
--   * `profile_view_stats` liczy `COUNT(*)` bez filtra po `viewer_mode`, więc
--     każda z tych wizyt podbijała licznik 7/30/90 dni.
-- Dziesięć wejść widza publicznego dawało jeden wiersz i jeden punkt; dziesięć
-- wejść widza PRYWATNEGO dawało dziesięć wierszy i dziesięć punktów. Kto
-- świadomie wybrał prywatność, zostawiał na cudzym profilu WIĘCEJ śladu niż
-- ktokolwiek inny.
--
-- CO `private` ZNACZY OD TERAZ: NIE ZOSTAWIA ŚLADU. Wybrano wariant "brak
-- zapisu" zamiast "zapis niewidoczny przy odczycie", bo:
--   * dokładnie to obiecuje tekst kontraktowy komponentu
--     (`src/components/network/ProfileViewsCard.tsx`: "prywatni w ogóle nie
--     trafiają na listę") - a komentarz, który przestał być prawdziwy, jest
--     defektem, nie dokumentacją;
--   * minimalizacja danych jest tu regułą pierwszej wagi: tabela opisuje, kto
--     oglądał czyj profil. Wariant "zapisuj i odsiewaj przy odczycie" wymaga
--     dyscypliny przy KAŻDYM przyszłym czytelniku tej tabeli - jedno nowe RPC
--     bez `WHERE viewer_mode <> 'private'` i zgoda wyrażona przez wybór trybu
--     przestaje obowiązywać, bez żadnego sygnału.
-- Cena jest jawna: tracimy sygnał dla przyszłych agregatów zbiorczych
-- (np. "ile osób w ogóle zajrzało"). Ten sygnał nigdy nie był zbierany
-- rzetelnie (debounce go nie obejmował), więc nie ma czego stracić.
--
-- DEDUPLIKACJA PRZESTAJE ZALEŻEĆ OD TRYBU. Każdy wiersz, który POWSTAJE, ma
-- `viewer_id` zapisany zawsze, więc warunek `(profile_id, viewer_id)` z okna
-- godzinnego jest odtąd zdaniem prawdziwym dla obu pozostałych trybów
-- (`public`, `anonymous`). Maskowanie tożsamości anonima zostaje tam, gdzie
-- było od początku - przy ODCZYCIE (`my_profile_viewers`), nie przy zapisie.
--
-- DLACZEGO CZYTELNIKI DOSTAJĄ MIMO TO FILTR `viewer_mode <> 'private'`.
-- Nowych wierszy prywatnych nie będzie, ale WIERSZE JUŻ ZAPISANE zostają:
-- powstały od 20260718 przy każdym wejściu prywatnego widza. Bez filtra dalej
-- wyglądałyby na liście jak anonimowi i dalej podbijałyby licznik 7/30/90 dni,
-- czyli defekt żyłby na danych historycznych mimo naprawy zapisu.
--
-- CZEGO TA MIGRACJA ŚWIADOMIE NIE ROBI: NIE KASUJE wierszy historycznych.
-- Filtr przy odczycie zdejmuje cały objaw widoczny dla użytkownika (nie ma ich
-- na liście, nie liczą się do statystyk), więc `DELETE` byłby operacją
-- nieodwracalną bez zysku po stronie produktu. Te wiersze nie niosą przy tym
-- tożsamości widza (`viewer_id` jest w nich NULL), więc nie ma w nich danych
-- osoby, która się z nich wypisała. Usunięcie historii jest decyzją operacyjną,
-- nie migracyjną - tak samo jak w 20260913150000.

CREATE OR REPLACE FUNCTION public.record_profile_view(p_profile UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_mode TEXT; v_snapshot JSONB;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() = p_profile THEN RETURN; END IF;
  SELECT profile_view_mode INTO v_mode FROM public.profiles WHERE id = auth.uid();

  -- Jedyne miejsce, w którym tryb rozstrzyga o ZAPISIE. Wyjście przed
  -- `INSERT`, więc prywatny widz nie zakłada wiersza ani nie podbija licznika.
  IF v_mode = 'private' THEN RETURN; END IF;

  v_tenant := public._caller_tenant();
  IF v_mode = 'public' THEN
    SELECT jsonb_build_object(
      'display_name', display_name, 'job_title', job_title,
      'company', current_company, 'avatar_url', avatar_url
    ) INTO v_snapshot FROM public.profiles WHERE id = auth.uid();
  END IF;

  -- Okno godzinne na parze (profil, widz). `viewer_id` jest tu zawsze
  -- zapisany, więc ten warunek ma szansę trafić - czego wersja sprzed tej
  -- migracji nie miała dla jednego z trzech trybów.
  IF EXISTS (
    SELECT 1 FROM public.profile_view_events
     WHERE profile_id = p_profile AND viewer_id = auth.uid()
       AND viewed_at > now() - INTERVAL '1 hour'
  ) THEN RETURN; END IF;

  INSERT INTO public.profile_view_events
    (tenant_id, profile_id, viewer_id, viewer_mode, viewer_snapshot)
  VALUES (v_tenant, p_profile, auth.uid(), v_mode, v_snapshot);
END; $$;

CREATE OR REPLACE FUNCTION public.my_profile_viewers(p_limit INT DEFAULT 20)
RETURNS TABLE (
  viewed_at TIMESTAMPTZ, viewer_mode TEXT,
  viewer_id UUID, display_name TEXT, avatar_url TEXT, job_title TEXT, company TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT e.viewed_at, e.viewer_mode,
           CASE WHEN e.viewer_mode = 'public' THEN e.viewer_id END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'display_name') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'avatar_url') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'job_title') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'company') END
      FROM public.profile_view_events e
     WHERE e.profile_id = auth.uid()
       AND e.viewer_mode <> 'private'   -- wiersze historyczne, patrz nagłówek
     ORDER BY e.viewed_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 100);
END; $$;

CREATE OR REPLACE FUNCTION public.profile_view_stats()
RETURNS TABLE (last_7 INT, last_30 INT, last_90 INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '7 days')::int,
         COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '30 days')::int,
         COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '90 days')::int
    FROM public.profile_view_events
   WHERE profile_id = auth.uid()
     AND viewer_mode <> 'private';   -- ten sam zbiór, co lista wyżej
$$;

COMMENT ON COLUMN public.profile_view_events.viewer_mode IS
  'Tryb widza w chwili odsłony. Wiersze ''private'' NIE POWSTAJĄ od 20260913170000 (record_profile_view wychodzi przed INSERT); istniejące są odsiewane przy odczycie przez my_profile_viewers i profile_view_stats.';

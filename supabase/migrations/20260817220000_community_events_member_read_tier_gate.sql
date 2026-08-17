-- ============================================================================
-- KAŻDY ZALOGOWANY CZYTAŁ PEŁNY WIERSZ WYDARZEŃ BRAMKOWANYCH WARSTWĄ
--
-- Polityka "events member read" (20260803191905) pytała wyłącznie o
-- `status = 'published'` i tenanta - o `visibility` i `min_tier_rank` nie
-- pytała wcale, inaczej niż bliźniacza polityka anon. Darmowe konto (reader,
-- rank 0) omijało więc bramkę warstw jednym GET-em do Data API: wiersz
-- wydarzenia members / z progiem rangi schodził w całości - miejsce
-- spotkania, opis, prowadzący, limit miejsc, cena biletu (`location`,
-- `capacity`, `ticket_price_cents`, ...). Sekrety transmisji (`join_url`,
-- `recording_url`) chronił osobno grant kolumnowy z 20260803191905, ale
-- wszystko poza nimi - nic.
--
-- Anon dostał właściwą bramkę już w 20260803191905 i 20260812103500;
-- authenticated został wtedy celowo szeroki, żeby strona wydarzenia mogła
-- pokazać upsell zamiast 404. Tyle że upsell potrzebuje najwyżej tytułu
-- i terminu, a polityka oddawała też dane będące benefitem członkostwa
-- (gdzie, za ile, z kim) - benefit znów był sprzedawany i rozdawany naraz,
-- tym razem każdemu, kto założył bezpłatne konto.
--
-- Zalogowany czyta teraz tę samą definicję "kwalifikuje się", którą
-- egzekwują rsvp_event i get_event_access (20260721150000, 20260724100000):
--
--   * members + briefing  -> FLAGA features `pro_briefings` (sama ranga nie
--                            wystarcza, dokładnie jak w RPC),
--   * members (pozostałe) -> ranga >= GREATEST(COALESCE(min_tier_rank,0),1)
--                            (members z domyślną rangą 0 też jest bramkowane),
--   * public              -> ranga >= COALESCE(min_tier_rank,0)
--                            (niebramkowane widzi każdy zalogowany, rank 0
--                            spełnia próg 0),
--   * inna visibility     -> zamknięte (ELSE false: przyszłe np. 'invite'
--                            domyka się samo, jak w polityce anon).
--
-- `(SELECT public.current_tier_rank()) >= próg` zamiast
-- `public.has_tier_rank(próg)` per wiersz: definicja ta sama (has_tier_rank
-- to `current_tier_rank() >= COALESCE(_min,0)`, a próg nigdy nie jest NULL),
-- ale skalar w podzapytaniu Postgres liczy RAZ na zapytanie (InitPlan),
-- nie 200 razy na listę /events. Flaga briefingów tak samo. Wzorzec jak
-- `(SELECT public.public_tenant_id())` obok.
--
-- Konsekwencje:
--   * redakcja: nietknięta - "events staff read" (20260713093000) dalej daje
--     adminowi/edytorowi pełen odczyt w swoim tenancie, a panel i tak czyta
--     przez admin_list_events/admin_get_event (SECURITY DEFINER);
--   * kasa biletów: checkout czyta wiersz przez RLS użytkownika
--     (checkout.functions.ts), więc bilet na wydarzenie poza własną warstwą
--     kończy się `ticket_not_available` - spójnie z rsvp_event, które i tak
--     odmówiłoby zapisu;
--   * strona /events/$slug: konto bez warstwy nie zobaczy już wiersza
--     wydarzenia members (dotąd: karta z upsellem po `tier_required`
--     z get_event_access). To celowy koszt - upsell nie może stać na
--     wierszu, którego treść sama jest benefitem. Samo get_event_access
--     zwraca `tier_required` bez zmian, gdy ktoś zna id wydarzenia.
-- ============================================================================

DROP POLICY IF EXISTS "events member read" ON public.events;
CREATE POLICY "events member read" ON public.events
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
    AND CASE
      WHEN visibility = 'members' AND kind = 'briefing'
        THEN (SELECT public.has_tier_feature('pro_briefings'))
      WHEN visibility = 'members'
        THEN (SELECT public.current_tier_rank()) >= GREATEST(COALESCE(min_tier_rank, 0), 1)
      WHEN visibility = 'public'
        THEN (SELECT public.current_tier_rank()) >= COALESCE(min_tier_rank, 0)
      ELSE false
    END
  );

COMMENT ON POLICY "events member read" ON public.events IS
  'Zalogowany odczyt wydarzeń: opublikowane, w tenancie publicznym żądania i wyłącznie te, do których użytkownik się KWALIFIKUJE wg tej samej bramki co rsvp_event/get_event_access (members-briefing = flaga pro_briefings; members = ranga >= GREATEST(min_tier_rank,1); public = ranga >= min_tier_rank; inne visibility zamknięte). Redakcja czyta przez osobną politykę "events staff read".';

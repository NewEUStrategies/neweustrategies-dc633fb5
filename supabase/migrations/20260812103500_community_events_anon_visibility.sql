-- ============================================================================
-- WYDARZENIE "TYLKO DLA CZŁONKÓW" BYŁO CZYTELNE DLA KAŻDEGO NIEZALOGOWANEGO
--
-- Panel redakcji tworzy wydarzenie członkowskie JEDNYM przełącznikiem
-- (`visibility = 'members'`, admin.community.events.tsx:278-288) i nie ustawia
-- `min_tier_rank` - kolumna zostaje na wartości domyślnej 0
-- (20260713093000_events_module.sql:42). Reszta produktu czyta taki wiersz
-- jako bramkowany, bo wymaganą rangę liczy jako
-- `GREATEST(COALESCE(min_tier_rank, 0), 1)`: tak robi `rsvp_event`
-- (20260721150000:163), tak robi `get_event_access` (20260724091000:735-740)
-- i tak samo liczy klient (events.$slug.tsx: `membersOnly ? max(rank, 1)`).
-- Polityka anonimowego odczytu z 20260803191905 była jedynym miejscem, które
-- pytało WYŁĄCZNIE o `min_tier_rank = 0` i o `visibility` nie pytało wcale.
--
-- Skutek dla użytkownika: wydarzenie zamknięte w panelu dla członków - o ile
-- redakcja nie podniosła ręcznie progu rangi, czyli w ścieżce domyślnej -
-- trafiało na publiczną listę /events i na własną stronę dla dowolnego gościa
-- bez konta: tytuł, opis, termin, miejsce, prowadzący. Serwer w tej samej
-- chwili odmawiał mu zapisu ('events: membership required'), więc benefit
-- członkostwa był sprzedawany i jednocześnie rozdawany, a jedyną barierą
-- pozostawał przypadek: czy ktoś pamiętał o wypełnieniu drugiego pola.
--
-- Anonim czyta teraz tę samą definicję "niebramkowane", którą egzekwują RPC:
-- wydarzenie publiczne ORAZ bez progu rangi. Warstwa członkowska
-- (`events member read` dla roli `authenticated`) zostaje nietknięta, więc
-- zalogowany czytelnik bez wykupionej warstwy nadal widzi wiersz i dostaje
-- z `get_event_access` uczciwe `tier_required` razem z upsellem - bramka nie
-- zamienia się w 404 dla nikogo, kto ma konto.
--
-- `visibility = 'public'` zamiast `visibility <> 'members'`: CHECK dopuszcza
-- dziś dwie wartości, ale trzecia (np. 'invite') ma się domykać sama, bez
-- kolejnej migracji ratunkowej.
-- ============================================================================

DROP POLICY IF EXISTS "events public read" ON public.events;
CREATE POLICY "events public read" ON public.events
  FOR SELECT TO anon
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
    AND visibility = 'public'
    AND COALESCE(min_tier_rank, 0) = 0
  );

COMMENT ON POLICY "events public read" ON public.events IS
  'Anonimowy odczyt wydarzeń: opublikowane, w tenancie publicznym żądania i niebramkowane w OBU wymiarach (visibility = public ORAZ próg rangi 0). Ta sama definicja bramki, którą egzekwują rsvp_event i get_event_access - members z domyślną rangą 0 też jest bramkowane.';

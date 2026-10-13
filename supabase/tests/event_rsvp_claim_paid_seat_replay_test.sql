-- pgTAP: miejsce RSVP zakupu bez zgloszenia - POWTORKA po zajeciu miejsca
-- (migracja 20261012130001_event_ticket_seat_ledger_part2, funkcja
-- `_event_rsvp_claim_paid_seat`; audyt TIX-08, scalenie #498).
--
-- DEFEKT, KTOREGO PILNUJEMY. Realizacja platnosci (`oneTimeFulfilment`) pyta
-- baze o miejsce RSVP przy KAZDEJ dostawie zdarzenia - takze przy powtorce
-- zamowienia juz oplaconego. Gdyby funkcja liczyla pojemnosc PRZED
-- sprawdzeniem RSVP 'going' tego kupujacego, powtorka po zapelnieniu sali
-- (pierwsza dostawa zajela miejsce i padla przed domknieciem dziennika,
-- reszte sali wykupili inni) dostalaby `event_full` i zwrocila pieniadze za
-- bilet z zajetym miejscem. Test TS (oneTimeFulfilment.server.test.ts,
-- „powtorka OPLACONEGO zakupu bez zgloszenia...") opiera sie na odpowiedzi
-- `already: true` - jej zrodlem musi byc baza, nie atrapa.
--
-- CO PRZYPINA:
--   * pierwsze wywolanie zajmuje ostatnie miejsce (`already: false`, RSVP going),
--   * cudze zamowienie przy pelnej sali - `event_full`, bez RSVP (kontrola),
--   * POWTORKA zamowienia z miejscem przy pelnej sali - `ok`, `already: true`,
--     bez drugiego wiersza RSVP i bez zmiany obsadzenia.
BEGIN;
SELECT plan(6);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('c1a00000-0000-0000-0000-0000000000aa', 'rcs-a', 'Rsvp Claim Seat A', 'rcs-a.example');

INSERT INTO auth.users (id, email) VALUES
  ('c1a00000-0000-0000-0000-0000000000a1', 'rcs-buyer@example.org'),
  ('c1a00000-0000-0000-0000-0000000000a2', 'rcs-late@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c1a00000-0000-0000-0000-0000000000a1', 'rcs-buyer@example.org', 'RCS Buyer', 'c1a00000-0000-0000-0000-0000000000aa'),
  ('c1a00000-0000-0000-0000-0000000000a2', 'rcs-late@example.org', 'RCS Late', 'c1a00000-0000-0000-0000-0000000000aa');

-- Sala na JEDNO miejsce: zajecie go przez kupujacego wyczerpuje pojemnosc.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, capacity) VALUES
  ('c1a10000-0000-0000-0000-0000000000e1', 'c1a00000-0000-0000-0000-0000000000aa',
   'rcs-event', 'RCS', 'RCS', '2030-06-10 08:00+00', 'published', 1);

-- Zamowienia jak po webhooku: zakup bez zgloszenia z formularza (sam
-- `event_id` w metadanych). Rola serwisowa pisze je bez straznika.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders
  (id, tenant_id, user_id, kind, status, amount_cents, currency, metadata, provider_intent_id)
VALUES
  ('c1a60000-0000-0000-0000-000000000001', 'c1a00000-0000-0000-0000-0000000000aa',
   'c1a00000-0000-0000-0000-0000000000a1', 'one_time', 'paid', 4900, 'PLN',
   jsonb_build_object('event_id', 'c1a10000-0000-0000-0000-0000000000e1'), 'cs_rcs_buyer'),
  ('c1a60000-0000-0000-0000-000000000002', 'c1a00000-0000-0000-0000-0000000000aa',
   'c1a00000-0000-0000-0000-0000000000a2', 'one_time', 'paid', 4900, 'PLN',
   jsonb_build_object('event_id', 'c1a10000-0000-0000-0000-0000000000e1'), 'cs_rcs_late');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.role', '', true);

-- ── 1-3. Pierwsza dostawa zajmuje ostatnie miejsce ──────────────────────────
-- Osobne instrukcje: podzapytanie w tej samej instrukcji co wywolanie widzi
-- migawke SPRZED zapisu funkcji.
SELECT is(
  public._event_rsvp_claim_paid_seat('c1a60000-0000-0000-0000-000000000001') - 'event_id',
  '{"ok": true, "seated": true, "already": false}'::jsonb,
  'pierwsza dostawa: wolne miejsce zajete pod blokada (already = false)');
SELECT ok(
  (SELECT status = 'going' FROM public.event_rsvps
    WHERE event_id = 'c1a10000-0000-0000-0000-0000000000e1'
      AND user_id = 'c1a00000-0000-0000-0000-0000000000a1'),
  'RSVP going kupujacego zapisane przez funkcje bazy');
SELECT is(
  public._event_page_seats_left('c1a00000-0000-0000-0000-0000000000aa',
                                'c1a10000-0000-0000-0000-0000000000e1'),
  0,
  'sala pelna po zajeciu jedynego miejsca');

-- ── 4. Kontrola: cudzy zakup przy pelnej sali ───────────────────────────────
SELECT is(
  public._event_rsvp_claim_paid_seat('c1a60000-0000-0000-0000-000000000002') ->> 'reason',
  'event_full',
  'cudze zamowienie przy pelnej sali: event_full (zwrot po stronie realizacji)');

-- ── 5-6. Powtorka zamowienia, ktore miejsce juz ma ──────────────────────────
SELECT is(
  public._event_rsvp_claim_paid_seat('c1a60000-0000-0000-0000-000000000001') - 'event_id',
  '{"ok": true, "seated": true, "already": true}'::jsonb,
  'POWTORKA zamowienia z miejscem przy pelnej sali: ok + already - bez zwrotu');
SELECT ok(
  (SELECT count(*) = 1 FROM public.event_rsvps
    WHERE event_id = 'c1a10000-0000-0000-0000-0000000000e1' AND status = 'going')
  AND NOT EXISTS (SELECT 1 FROM public.event_rsvps
                   WHERE event_id = 'c1a10000-0000-0000-0000-0000000000e1'
                     AND user_id = 'c1a00000-0000-0000-0000-0000000000a2'),
  'powtorka nie dokleja miejsca, a cudzy zakup nie dostal RSVP');

SELECT * FROM finish();
ROLLBACK;

-- ============================================================================
-- 98. SZYNA ZDARZEN: NAZWY TRZYCZLONOWE MUSZA SIE ZAPISYWAC.
--
-- PO CO TEN PLIK ISTNIEJE. `domain_events.event_type` mial ograniczenie
-- dopuszczajace DOKLADNIE dwa czlony przed `.vN`, a modul Wydarzen emituje szesc
-- zdarzen o nazwach trzyczlonowych (`event.registration.created.v1` i piec
-- siostrzanych). Kazdy taki INSERT naruszal CHECK, a `emit_domain_event` konczy
-- sie `EXCEPTION WHEN OTHERS THEN RETURN NULL` - wiec zdarzenia ginely bez
-- jednego sladu w logu. Nie widziala tego ZADNA bramka: ta w CI porownuje nazwy
-- emitowane z zadeklarowanymi w katalogu frontu, a nie sprawdza, czy wiersz
-- faktycznie powstal.
--
-- DLATEGO ASERCJA JEST O WIERSZU, NIE O NAZWIE. Jedyny sposob, zeby zobaczyc
-- polkniety blad szyny, to zapytac bazy, czy zapis sie udal. Kazdy inny test
-- bedzie zielony przy calkowitym braku tych zdarzen.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_tenant uuid := '00000000-0000-4000-8000-0000000000aa';
  v_id uuid;
  v_count integer;
BEGIN
  RAISE NOTICE '== 98 szyna zdarzen: nazwy wieloczlonowe ==';

  -- ── 1. Nazwa DWUCZLONOWA nadal dziala (nie zepsulismy tego, co bylo) ──────
  v_id := public.emit_domain_event(
    v_tenant, 'event', gen_random_uuid()::text, 'event.published.v1',
    jsonb_build_object('probe', 'dwa czlony')
  );
  PERFORM pg_temp.assert(v_id IS NOT NULL, '98 dwuczlonowa nazwa zapisuje sie (regresja wsteczna)');

  -- ── 2. Nazwa TRZYCZLONOWA - to jest cala usterka ─────────────────────────
  v_id := public.emit_domain_event(
    v_tenant, 'event_registration', gen_random_uuid()::text,
    'event.registration.created.v1',
    jsonb_build_object('probe', 'trzy czlony')
  );
  PERFORM pg_temp.assert(
    v_id IS NOT NULL,
    '98 trzyczlonowa nazwa zapisuje sie - emit_domain_event NIE zwrocil NULL'
  );

  SELECT count(*) INTO v_count
  FROM public.domain_events
  WHERE tenant_id = v_tenant AND event_type = 'event.registration.created.v1';
  PERFORM pg_temp.assert(
    v_count = 1,
    '98 wiersz FAKTYCZNIE jest w domain_events (polkniety wyjatek by go nie zostawil)'
  );

  -- ── 3. Komplet szesciu zdarzen rejestracji ───────────────────────────────
  FOR v_id IN
    SELECT public.emit_domain_event(
      v_tenant, 'event_registration', gen_random_uuid()::text, t,
      '{}'::jsonb
    )
    FROM unnest(ARRAY[
      'event.registration.updated.v1',
      'event.registration.decided.v1',
      'event.registration.cancelled.v1',
      'event.registration.promoted.v1',
      'event.registration.payment.v1'
    ]) AS t
  LOOP
    PERFORM pg_temp.assert(v_id IS NOT NULL, '98 kazde zdarzenie rejestracji sie zapisuje');
  END LOOP;

  SELECT count(*) INTO v_count
  FROM public.domain_events
  WHERE tenant_id = v_tenant AND event_type LIKE 'event.registration.%';
  PERFORM pg_temp.assert(
    v_count = 6,
    '98 komplet szesciu zdarzen rejestracji jest na szynie (dostano: ' || v_count || ')'
  );

  -- ── 4. Ograniczenie NADAL cos wyklucza - rozluznienie to nie zniesienie ──
  v_id := public.emit_domain_event(
    v_tenant, 'event', gen_random_uuid()::text, 'BezWersji', '{}'::jsonb
  );
  PERFORM pg_temp.assert(v_id IS NULL, '98 nazwa bez wersji nadal odrzucona');

  v_id := public.emit_domain_event(
    v_tenant, 'event', gen_random_uuid()::text, 'jedenczlon.v1', '{}'::jsonb
  );
  PERFORM pg_temp.assert(v_id IS NULL, '98 nazwa jednoczlonowa nadal odrzucona');

  v_id := public.emit_domain_event(
    v_tenant, 'event', gen_random_uuid()::text, 'WIELKIE.LITERY.v1', '{}'::jsonb
  );
  PERFORM pg_temp.assert(v_id IS NULL, '98 wielkie litery nadal odrzucone');

  -- ── 5. Cztery czlony tez przechodza - wzorzec jest otwarty w gore ────────
  v_id := public.emit_domain_event(
    v_tenant, 'event', gen_random_uuid()::text, 'event.registration.seat.assigned.v1', '{}'::jsonb
  );
  PERFORM pg_temp.assert(v_id IS NOT NULL, '98 cztery czlony przechodza (wzorzec nie ma sufitu)');

  RAISE NOTICE '== 98 szyna zdarzen: koniec ==';
END
$$;

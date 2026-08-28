-- ============================================================================
-- `domain_events.event_type`: OGRANICZENIE ZNALO DWA CZLONY, MODUL WYDARZEN
-- UZYWA TRZECH - I SZESC ZDARZEN GINELO PO CICHU.
--
-- events-harness: include
--
-- CO BYLO ZLE (P1, CICHA AWARIA - nie estetyka)
--
-- Tabela szyny zdarzen powstala z ograniczeniem
--     CHECK (event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$')
-- czyli DOKLADNIE dwa czlony przed `.vN` (`20260711200000_domain_event_bus.sql`,
-- linia 34). Modul Wydarzen emituje szesc zdarzen o nazwach TRZYCZLONOWYCH:
--     event.registration.created.v1     event.registration.updated.v1
--     event.registration.decided.v1     event.registration.cancelled.v1
--     event.registration.promoted.v1    event.registration.payment.v1
-- Kazdy taki `INSERT` narusza ograniczenie. A `emit_domain_event` konczy sie
--     EXCEPTION WHEN OTHERS THEN RETURN NULL;
-- wiec wyjatek jest POLYKANY: funkcja wolajaca dostaje NULL, transakcja idzie
-- dalej, nikt sie o niczym nie dowiaduje. Komentarz przy samym emiterze nazywa
-- ten mechanizm wprost: „wlasny EXCEPTION emiterow zamienia to w cisze".
--
-- Skutkiem jest brak CALEGO cyklu zycia zgloszenia na szynie: nie ma sladu
-- audytowego, nie ma odswiezania na zywo, nie ma czego podpiac pod
-- „zgloszenie rozstrzygniete". Wszystko to milczy od momentu, w ktorym te
-- zdarzenia zaczely byc emitowane.
--
-- DLACZEGO TO SAMO ZALOZENIE BYLO W TRZECH MIEJSCACH. „Nazwa ma dwa czlony"
-- siedzialo rownolegle w tym CHECK-u, w katalogu frontu (`DOMAIN_EVENT_TYPES`)
-- i w wyrazeniu bramki `domainEventCatalog.test.ts`. Bramka porownuje nazwy
-- emitowane z zadeklarowanymi, wiec dopoki jej wlasny regex nie widzial nazw
-- trzyczlonowych, byla zielona przy kompletnym braku tych zdarzen. Dwa z tych
-- trzech miejsc juz poprawiono na `main` (regex bramki i katalog frontu) - przez
-- co bramka jest zielona NADAL, tyle ze teraz przy poprawnym katalogu i wciaz
-- odrzucanym zapisie. Ta migracja domyka trzecie.
--
-- CO ROBI TA MIGRACJA
--
-- Rozluznia ograniczenie do DOWOLNEJ liczby czlonow (minimum dwa), zachowujac
-- reszte ksztaltu bez zmian: male litery, cyfry i podkreslenie w czlonach,
-- wersja `.vN` na koncu.
--
--     '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$'
--
-- DLACZEGO ROZLUZNIENIE, A NIE PRZEMIANOWANIE ZDARZEN. Alternatywa byloby
-- zwezenie nazw do `event_registration.created.v1`. Odpada z dwoch powodow:
-- (1) `main` juz wpisal nazwy TRZYCZLONOWE do katalogu frontu i regul
-- inwalidacji, wiec przemianowanie znaczyloby cofniecie tamtej pracy;
-- (2) trzyczlonowa nazwa niesie prawdziwa hierarchie (`event` -> `registration`
-- -> `created`), a splaszczanie jej do `event_registration` gubi informacje,
-- ktora inne moduly moga chciec filtrowac.
--
-- CZEGO TA MIGRACJA NIE ROBI. Nie odtwarza zdarzen, ktore juz przepadly -
-- nie ma ich skad wziac. Nie rusza tez `EXCEPTION WHEN OTHERS` w emiterze:
-- polykanie bledow szyny jest tam DECYZJA (zdarzenie nie moze wywrocic
-- transakcji, ktora je wywolala), a nie przeoczeniem. Cena tej decyzji jest
-- taka, ze bledy zapisu na szyne widac wylacznie testem, ktory sprawdza, czy
-- wiersz FAKTYCZNIE powstal - i taki test dokladamy w harnessie.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.domain_events'::regclass
      AND conname = 'domain_events_event_type_check'
  ) THEN
    ALTER TABLE public.domain_events DROP CONSTRAINT domain_events_event_type_check;
  END IF;
END
$$;

ALTER TABLE public.domain_events
  ADD CONSTRAINT domain_events_event_type_check
  CHECK (event_type ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$');

COMMENT ON CONSTRAINT domain_events_event_type_check ON public.domain_events IS
  'Nazwa zdarzenia: co najmniej dwa czlony rozdzielone kropka i wersja .vN na koncu. Wczesniej dopuszczala DOKLADNIE dwa czlony, przez co szesc zdarzen event.registration.* modulu Wydarzen bylo odrzucanych przy INSERT, a emit_domain_event polykal wyjatek - ginely bez sladu.';

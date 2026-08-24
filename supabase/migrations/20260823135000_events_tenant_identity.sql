-- ============================================================================
-- Event Builder, etap 2b: TOZSAMOSC WYDARZENIA W GRANICACH NAJEMCY
--
-- PROBLEM. Modul Wydarzen dostanie kilkanascie tabel potomnych (sesje, zapisy,
-- bilety, sponsorzy, spotkania, odprawa na miejscu). Kazda z nich niesie WLASNA
-- kolumne `tenant_id` - bo bez niej polityka RLS musialaby dolaczac `events`
-- przy kazdym wierszu, a to zabija plan zapytania na liscie zapisow.
--
-- Kolumna wlasna otwiera jednak dziure, ktorej nie zamknie zadna polityka:
-- wiersz potomny moze wskazywac wydarzenie NAJEMCY A, majac w `tenant_id`
-- najemce B. Zapis przechodzi (oba klucze obce sa spelnione osobno), a potem
-- kazde zapytanie skalowane po `tenant_id` widzi wiersz przypisany do obcego
-- wydarzenia. Trigger tego nie zalatwia: da sie go wylaczyc, da sie go pominac
-- przy `COPY`, i nie obowiazuje w migracji danych.
--
-- ROZWIAZANIE. Jedno ograniczenie unikalnosci `(tenant_id, id)` na `events`
-- zamienia ten warunek w KLUCZ OBCY ZLOZONY, ktory kazda tabela potomna
-- deklaruje jednym wierszem:
--
--   FOREIGN KEY (tenant_id, event_id)
--     REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
--
-- Od tej chwili para (najemca, wydarzenie) MUSI istniec razem. Baza odrzuca
-- wiersz-podmiane na poziomie silnika, nie na poziomie aplikacji, i robi to
-- rowniez dla importow, migracji i `COPY`.
--
-- KOSZT. Jeden dodatkowy indeks unikalny na tabeli, ktora i tak jest czytana
-- po `tenant_id`. Indeks jest przy okazji pokrywajacy dla list w module, wiec
-- jego koszt zwraca sie na zapytaniach, ktore i tak wykonujemy.
--
-- IZOLACJA NAJEMCOW. Sama migracja nie czyta danych - dodaje ograniczenie.
-- Skutkiem jest WZMOCNIENIE izolacji: identyfikator wydarzenia przestaje byc
-- globalny i zaczyna byc identyfikatorem W GRANICACH NAJEMCY.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_tenant_id_key'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT events_tenant_id_key ON public.events IS
  'Tozsamosc wydarzenia w granicach najemcy. Cel kluczy obcych zlozonych (tenant_id, event_id) we wszystkich tabelach potomnych modulu Wydarzen - uniemozliwia wiersz potomny wskazujacy wydarzenie innego najemcy.';

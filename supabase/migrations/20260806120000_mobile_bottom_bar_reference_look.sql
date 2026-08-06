-- Mobilny pasek dolny: przejście na wygląd referencyjnego "animated tab bar".
--
-- KONTEKST: poprzednia migracja (20260806090000) ustawiła zestaw pozycji i
-- zaokrąglenie 6 px. Wygląd docelowy to teraz odwzorowanie komponentu
-- referencyjnego: pigułka (2em = 20 px), bez podpisów pod ikonami (aktywna
-- pozycja unosi się w garb i dostaje wypełnione koło, a etykieta zostaje
-- nazwą dostępną). Kontrakt kształtu żyje w src/lib/mobileBottomBar/config.ts
-- (MOBILE_BOTTOM_BAR_DEFAULTS) i te dwa miejsca muszą pozostać zgodne.
--
-- ZAKRES: wyłącznie dwa pola prezentacji - `radius` i `show_labels`. Pozycje,
-- kolory i pozostałe ustawienia zostają nietknięte, więc tenant, który sobie
-- pasek dostosował, nic nie traci.
--
-- IDEMPOTENCJA: dotykamy tylko wierszy, które nadal niosą poprzedni kontrakt
-- (promień 6 px i/lub włączone podpisy). Świadome ustawienie administratora
-- inne niż 6 px zostaje - dlatego warunek jest na konkretnej starej wartości,
-- a nie na "cokolwiek innego niż 20".
UPDATE public.site_settings
SET value = value || jsonb_build_object('radius', 20, 'show_labels', false)
WHERE key = 'mobile_bottom_bar'
  AND (value ->> 'radius') = '6'
  AND (value ->> 'show_labels') = 'true';

-- Wiersze, które mają już własny promień, ale wciąż podpisy z pierwszego
-- wydania - sam wygląd ikon bez zmiany zaokrąglenia administratora.
UPDATE public.site_settings
SET value = value || jsonb_build_object('show_labels', false)
WHERE key = 'mobile_bottom_bar'
  AND (value ->> 'radius') <> '6'
  AND (value ->> 'show_labels') = 'true'
  AND value -> 'items' @> '[{"label_key": "mobileBottomBar.itemLabels.home"}]'::jsonb;

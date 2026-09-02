# Roadmap

## Moduł powiadomień

- [x] Klik w belce powiadomień prowadzi do właściwego miejsca (w tym `/messages?c=<id>`)
- [x] Zalogowanie powiadomienia w bazie (weryfikacja end-to-end)
- [x] Test realtime w preview
- [x] Pokrycie testami >= 95% (linie 98,2% / instrukcje 97,4%)

## Moduł czatu

- [x] Wysyłanie wiadomości realtime
- [x] Przekierowanie z belki powiadomień na kanał rozmowy
- [x] Test w preview
- [x] Pokrycie testami >= 95% (linie 98,2% / instrukcje 97,4%)

## Sprzątanie

- [x] Usunięto testowe dane z rozmowy z Maxem (wiadomości i powiadomienie testowe)

## i18n - tłumaczenia widgetów (/admin/i18n)

- [x] Warstwa czysta `widgetTranslationFill.ts` + testy
- [x] Skrypt `i18n:translate-widgets` (bramka AI, cache, dry-run/--write)
- [x] Uzupełnione tłumaczenia EN w treści widgetów (472 pola, 33 strony)
- [x] Doprecyzowana heurystyka `looksPolish` (adresy/nazwy własne nie są błędem)

## Błędy runtime (/admin/performance?tab=errors)

- [x] `signal is aborted without reason` - jawny powód przerwania sondy + filtr szumu (klient i ingest)
- [x] `[boot] undefined` - sonda bootu milknie po `__nesAppReady` i odrzuca puste komunikaty

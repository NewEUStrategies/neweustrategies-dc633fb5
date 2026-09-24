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

- [x] Przebudować hierarchię wątku klubowego: większy tytuł, etykiety nad nim, autor z avatarem oraz data i godzina pod tytułem.

## Mobilny widok całej platformy

- [ ] Ujednolicić układ mobilny stron publicznych i zalogowanej platformy: bez przycinania, z czytelną typografią, poprawnymi karuzelami, tabelami, nagłówkiem, panelami i dolnym paskiem.
- [x] Dostosować mobilne widoki „Osoby” i „Moja sieć” oraz równomiernie rozmieścić ikony w dolnym pasku.

## Wykresy GSC

- [x] Uczytelnić mapę aktywności w jasnym i ciemnym motywie oraz zmniejszyć granice treemapy stron.

## Spójny wygląd wykresów

- [x] Ujednolicić jasne wnętrze i ciemniejszy obrys wszystkich słupków oraz wykresów kołowych.
- [x] Usunąć widoczną ramkę całego wykresu po kliknięciu, zachowując dostępny fokus klawiatury.

## Archiwum GGM 2021

- [x] Utworzyć wydarzenie z trzema dniami, 12 debatami, moderatorami i panelistami.
- [x] Przygotować i przypisać spójne miniaturki z materiałów źródłowych konferencji.
- [x] Zweryfikować publiczny program i listę prelegentów.

## Profile People vs Author (2026-09-24)
- [x] /people/$slug dla każdego użytkownika, /author tylko z roli/zaproszenia autora, redirect 301
- [x] Linki klub/wzmianki/wyszukiwarka/organizacje -> /people
- [x] Sitemap aktualizacja + widok/plik w Admin > SEO

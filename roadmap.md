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

## Karta prelegenta i ścieżki z obsady sesji

- [x] Karta prelegenta rozwijana kliknięciem w zdjęcie (domyślnie widać zdjęcie; pełny kadr z podpisem i przyciskiem akcji), 6 px, bez nowej zależności.
- [x] Pola karty w panelu: zdjęcie rozwiniętej karty, napis PL/EN, adres i kolor przycisku - dla prelegenta z kontem i bez konta.
- [x] Ścieżki prelegenta wyprowadzane automatycznie z obsady sesji (karta, zapowiedź, program, podgląd studia).
- [x] Program: prelegenci sesji w prawej kolumnie obok stanu sesji, po rozwinięciu szczegółów ścieżki każdej osoby.
- [x] Edytor obsady sesji w formularzu sesji (rola, kolejność, zapis z odmową nachodzenia godzin).

## Profile People vs Author (2026-09-24)

- [x] /people/$slug dla każdego użytkownika, /author tylko z roli/zaproszenia autora, redirect 301
- [x] Linki klub/wzmianki/wyszukiwarka/organizacje -> /people
- [x] Sitemap aktualizacja + widok/plik w Admin > SEO

## Etykieta sekcji: wariant „Kinetic Signal Notch"

- [x] 23. wariant etykiety sekcji: trzy równe kreski sygnału i tytuł (ciasny tracking) inline; akcja „więcej" nad wierszem, mała, minuskulowa, szaro-pastelowa, z cienkim chevronem bez obudowy; paski rozsuwane na hoverze, podkreślenie rysowane od lewej, tłumaczenie EN, kontrolki edytora i testy.
- [x] „więcej" wyrownane do lewej, nisko nad wierszem (3 px), w neutralnej szarości z tokenu `--nes-kinetic-action`; wlasny rozmiar (10 px, w wezkiej kolumnie 8 px) chroniony selektorem `[data-w-id]x3 .nes-kinetic-shell .nes-kinetic-action` z `!important`, bo Theme Design widzetu narzucał rozmiar opisu (12 px).
- [x] „więcej" powiększone o 1 px (11 px, w wezkiej kolumnie 9 px) i odgrobione (waga 400): ten sam selektor kinetic pilnuje teraz rowniez wagi, a `data-typography-exempt` na akcji i jej wnetrzu wyjmuje je z globalnej typografii Theme Designu (gaiaz `:is(p, span, a, ...)` wkladala wage 800 bezposrednio w kazdy span); chevron „>" w em (wysokosc = wysokosc czcionki), ~1 px od slowa, w kolorze tekstu (currentColor), bez podkreslenia, z akcentem dopiero po najechaniu.
- [x] Chevron „>" ma teraz dokladnie taka sama grubosc kreski jak trzy paski sygnału (3 px, w pigułce 2 px): `strokeWidth` = grubosc paska + `vector-effect="non-scaling-stroke"`, wiec grubosc nie zalezy od skalowania viewBoxa; pole znka jest szersze (1,1 em) i punkty sa cofniete o pol kreski od krawedzi, dzieki czemu gruby znak sie nie uciql i nie zbija w plame; odstep od slowa zmniejszony do 0,08 em, zeby „>" zostalo blisko.

## Firmowy kolor akcentu

- [x] Usunąć bursztynowe akcenty z interfejsu i zapisanych ustawień motywu; domyślnie używać #FA9346 w jasnym i ciemnym motywie.

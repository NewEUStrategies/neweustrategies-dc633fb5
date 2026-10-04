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

- [x] Etykieta „więcej" bez podkreślenia w żadnym stanie: `.nes-kinetic-action` ma `text-decoration: none` (odcina też podkreślenie nadane całemu widżetowi przez Theme Design), a linia pod rzędem nie jest rysowana, dopóki opcja „Pokaż linię" nie zostanie włączona - `showRule` ma wyłączoną wartość domyślną tylko dla tego wariantu, pozostałe warianty bez zmian.

- [x] Znak „>" to subtelny ptaszek: kreska ma 0,85 px (0,7 px w wezkiej kolumnie), nie jest pogrubiona i jest tak samo cienka jak litery oraz wyraźnie cieńsza od trzech kresek sygnału.
- [x] Ptaszek zmniejszony o 1 px (wysokosc `calc(1em - 1px)`, szerokosc `calc(1.1em - 1px)`) i wyrownany do liter „wiecej": gora strzalki 0,25 px pod gora x-height, dol dokladnie na linii bazowej (pomiar zrzutu 4x w podgladzie).
- [x] Kinetic Signal Notch bez obszaru bezpiecznego z gory: shell ma tylko dolny padding (`pb-2`, w pigulce `pb-1`), wiec akcja zaczyna sie dokladnie na gornym brzegu widgetu (pomiar w podgladzie: paddingTop 0 px, odstep akcji od gory 0).
- [x] Chevrony po jednej i drugiej stronie akcji: lustrzana para "< oraz >" (czyste katy bez ogonkow) otacza „wiecej"; hover rozpycha znaki na zewnatrz, glif tekstowy (›/⟶) zostaje tylko po prawej, a ustawienie "none" zdejmuje oba. Testy 19/19, paczka buildera 2144 zielone.

## Firmowy kolor akcentu

- [x] Usunąć bursztynowe akcenty z interfejsu i zapisanych ustawień motywu; domyślnie używać #FA9346 w jasnym i ciemnym motywie.
- [2026-10-04] Strzałka akcji w etykietach sekcji: domyślny glif tekstowy "→" zastąpiony cienkim kątem SVG ">" bez ogonka (wspólny `AngleChevron`, ten sam znak co para chevronów w Kinetic Signal Notch); opcje "chevron" (›) i "long" (⟶) zachowują tekstowe glify, "none" zdejmuje znak; etykieta edytora "Strzałka >", tłumaczenia EN + kolekcja SECTION_LABEL_ARROWS w labelsEn.test; nowe testy sectionLabelArrow.test.tsx (4) - cała paczka buildera zielona.

## Styl Kinetic Signal Notch na wszystkich stronach CMS Builder

- [x] Zinwentaryzować wszystkie strony i etykiety sekcji w Builderze
- [x] Podmienić wariant wszystkich etykiet sekcji na `kinetic-signal-notch` z zachowaniem treści PL/EN i ustawień
- [x] Zweryfikować zapis, renderowanie mobilne i desktopowe oraz testy

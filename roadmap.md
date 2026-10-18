# Roadmap

## Weryfikacja PR #523

- [ ] Potwierdzić wszystkie commity i zakres scalenia PR #523.
- [ ] Sprawdzić rzeczywiste tabele, widoki, RPC oraz zgodność rejestrów migracji; uzupełnić potwierdzone braki.
- [ ] Uruchomić testy zmian i zweryfikować działanie wyszukiwarki.
- [ ] Opublikować i potwierdzić nową wersję na stronie publicznej.

## Weryfikacja PR #518

- [x] Potwierdzić integrację wszystkich 24 commitów PR #518: merge 346012635, 192 pliki; drzewo scalenia identyczne z końcem gałęzi PR.
- [x] Zweryfikować bazę i zastosować cztery brakujące migracje: 343 tabele z RLS, 15 widoków, 1585 funkcji; 1660 obiektów bez braków, 751 kolumn bez nowych braków (7 znanych rozbieżności). Końcowe ciała sześciu RPC i granty potwierdzone; rejestr uzupełniony dopiero po wdrożeniu, 368 migracji zgodnych. Dane użytkowników bez zmian.
- [x] Testy PR: 82 pliki, 2589 przechodzi, 10 oczekiwanych błędów. Naprawiona hydratacja /club po wcześniejszym rozstrzygnięciu sesji: 60 testów katalogu, zalogowane /, /en i /club HTTP 200 bez błędów przeglądarki; build OK. Baza nie zawiera klubów, więc produkcyjne stronicowanie z realnymi kartami pozostaje niesprawdzone. Testy SQL nieuruchomione: brak lokalnego serwera PostgreSQL.
- [x] Opublikować PR #518 po migracjach: identyfikator produkcji zmienił się z tmvcgxelv na tmvcwj3l3.
- [x] Zakończyć publikację i sprawdzić katalog oraz podstrony po odświeżeniu: produkcja tmvcxlrny; zalogowany katalog, rzeczywisty klub i 11 podstron przeszły 26 wejść/odświeżeń HTTP 200 z treścią, bez 404 i błędów przeglądarki. Rozjazd hydratacji wspólnej karty i minisite poprawiony; 193 testy poprawki przechodzą, dodatkowo 160 testów tras przechodzi (1 oczekiwany błąd); build OK. Dane bez zmian.

## Podpisy autorów względem tytułów

- [x] Pomiar tytułu tylko w obrębie karty: `data-author-title-scope` (karta, slajd, wiersz) albo `[data-w-id]`, bez wychodzenia do `<body>`; brak tytułu = rozmiar z panelu CMS, nazwisko w karcie autora z `data-author-title-ignore`. Jeden wspólny harmonogram rAF (jeden MutationObserver, ResizeObserver i nasłuch `resize` zamiast ~40 kompletów, wynik w jednym commicie przed malowaniem), pierwszy pomiar w efekcie layoutowym, arkusze Theme Design w `<head>` i `<body>` przeliczają podpisy. Pełny przebieg testów (4 shardy): 85 109 testów przechodzi; przełączenie urządzenia renderera w Chromium (390/700 px): 0 klatek z rozjazdem podpisu i tytułu.
- [x] HTML z serwera = strona po hydracji: przed pomiarem rozmiar szacuje CSS z tych samych tokenów co tytuł (`.cms-post-title`, H3 motywu, `tfs`, stałe tytuły tickera i slidera), miejsca bez tytułu (cytat, metadane wpisu, karta autora, karta z ukrytym tytułem) mają rozmiar z panelu od SSR, nagłówek wpisu wraca do własnej typografii. Chromium bez JS, 1440/390 px: podpis = tytuł − 2 px w 12 konfiguracjach renderowanych na serwerze (post-lista z H3 motywu i z `tfs`, boxed-list, ticker, trending-now, wszystkie warianty slidera z bylinem, z rozmiarem i bez).
- [x] `PostListView` rysuje podpis zwykłą funkcją (bez ponownego montowania przy re-renderze); ticker, trending-now, pasek „Na czasie” i cytat nie zostawiają pustej ramki ani kreski przy ukrytym autorze.
- [x] Podgląd w builderze pokazuje wpisane wartości: tytuł slidera 26 px ma 26 px także w kanwie i w obu podglądach (zwarta typografia panelu nie wchodzi do `[data-w-id]` ani `.cms-post-title`), rozmiar autora wpisany w panelu jest dosłowny (11 px w kanwie desktop/mobile, w podglądzie i na stronie), podgląd slidera w „Treści” bierze typografię ze „Stylu”, scena „Podgląd na żywo” ma typografię motywu.
- [x] Naprawić cofanie rozmiaru po opóźnionym wczytaniu autora, zmianie motywu i podmianie tytułu: stabilny ref reaguje na pojawienie się podpisu, obserwatory śledzą aktualny tytuł i Theme Design. 137 testów przechodzi; zalogowane /, /en i /analizy w 1280/393 px po odczekaniu i późnej zmianie CSS: wszystkie 36/36/18 podpisów mają różnicę 2 px i wspólny środek z awatarem, brak błędów przeglądarki.
- [x] Wdrożyć wspólną, domyślną opcję CMS tytuł minus 2 px we wszystkich widżetach PL/EN i wyrównanie do środka awatara; zapis ustawień strony głównej potwierdzony przez CMS.
- [x] Sprawdzić ustawienia edytora, testy i rzeczywiste podpisy na stronie: 88 testów, pomiary PL/EN oraz /analizy w 1280 i 393 px - różnica 2 px, wspólny środek awatara i tekstu, brak błędów przeglądarki.

## Weryfikacja PR #515

- [x] Potwierdzić wszystkie commity i zakres zmian PR #515: 46 commitów, 331 ścieżek, brak zmian schematu bazy.
- [x] Sprawdzić rzeczywisty katalog tabel, widoków, RPC i kolumn: 343 tabele z RLS, 15 widoków, 1585 funkcji; kontrakt 1660 obiektów bez braków, 751 kolumn i 7 wcześniej znanych rozbieżności; rejestr zgodny. Nie zmieniono bazy ani rejestru.
- [x] Uruchomić testy zmian i sprawdzić podgląd bez aktualizacji zależności: 728/728 testów zakresowych, build OK; /, /blog i /en HTTP 200 bez błędów przeglądarki. Pełna seria testów przerwana limitem 600 s, bez końcowego werdyktu.
- [ ] Potwierdzić zakończenie zleconej publikacji PR #515: ostatni odczyt produkcji nadal zwraca starszy identyfikator tmvb6lfhz (podgląd tmvc1bpt0); blokada: zewnętrzny proces publikacji. Strona publiczna / i /blog HTTP 200 bez błędów przeglądarki, lecz nie jest to dowód wdrożenia PR #515.

## Pola formularzy platformy

- [x] Ujednolicić listy wyboru, kalendarze i wysokości etykiet/pól w obu motywach.
- [x] Sprawdzić wybór daty i filtrów w zalogowanym raporcie sponsorów: 151 testów; pola i etykiety na wspólnej osi, kalendarze i listy sprawdzone w light/dark.

## Szczegóły prelegenta

- [x] Zmniejszyć odstęp nazwisko/stanowisko oraz pokazać uzupełniony biogram, social media i dozwolony kontakt w oknie profilu.
- [x] Zweryfikować przepływ danych: 152 testy, sześć kontroli projekcji kontaktu, okno Macieja H. Grabowskiego z biogramem w zalogowanym podglądzie studia; build OK.

## Jednolity pomarańczowy akcent

- [x] Ujednolicić akcenty marki i zamienniki złota w obu motywach.
- [x] Poprawić stary pomarańcz ścieżek programu i prelegentów bez zmiany danych.
- [x] Zweryfikować testy i program wydarzenia w obu motywach: 242 testy przechodzą; ścieżka i sesje mają rgb(250,147,70), podgląd buduje się bez błędów.

## Subtelne nagłówki wszystkich stron wydarzenia

- [x] Ujednolicić Stronę główną, Uczestników, Prelegentów, Partnerów, Agendę, Dyskusje i Mój profil.
- [x] Sprawdzić strony w obu motywach oraz testy wydarzeń: siedem stron HTTP 200, bez cienia, identyczna geometria light/dark; 82 testy przechodzą.

## Banery archiwów - Wspólny horyzont

- [x] Dopracować rysunek i wdrożyć tło domyślnych banerów.
- [x] Zweryfikować czytelność i identyczną geometrię obu motywów; 71 testów archiwów przechodzi.
- [x] Light mode: kontury ciemnoszare #44403C na jasnym tle platformy (bez ciemnoszarego pasa); dark mode bez zmian (#FDB078).

## Kompaktowy nagłówek Kinetic

- [x] Usunąć rozciąganie liter przy najechaniu i ustawić dolny odstęp na 2 px w obu skalach i motywach.

## Nowoczesna nawigacja slidera

- [x] Ujednolicić strzałki przy zdjęciach i wskaźnikach według pierwszego zrzutu; 12 przycisków ma identyczne parametry w obu motywach, przełączanie działa, testy zakresowe przechodzą.
- [x] Dopasować wskaźniki do stylu popupu rejestracji: kreski 40/16 px, stała wysokość 4 px i neutralny kolor w obu motywach; testy sterowania sliderem przechodzą.
- [x] Odświeżyć zaznaczone strzałki i wskaźniki: subtelny obrys, aktywna kapsułka marki, płynne przejścia bez zmiany układu.
- [x] Zweryfikować przełączanie materiałów testami zakresowymi.
- [x] Kąty < > są łagodniejsze: wierzchołek rozwarty do ok. 77° (wcześniej ostry szpic ok. 58°), kreska hairline 0,85 px bez zmian; ta sama geometria przy zdjęciach i przy wskaźnikach w obu motywach, zmierzona w podglądzie i pilnowana testem kąta (2217 testów buildera zielonych).

## Pełne wiadomości i limity formularzy

- [x] Usunąć obcinanie treści w CRM i zachować pełne wiadomości przy zbieraniu.
- [x] Pokazać liczniki i rzeczywiste limity w formularzach PL/EN, zweryfikować testami.

## Kafelki typów treści w klubie

- [x] Umieścić kafelki typów treści pod Ludzie i nad Praca w lewym panelu klubu.
- [x] Usunąć skrót Dynamika z Praca i sprawdzić działanie filtrów oraz testy.

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
- [x] Słupki i wycinki wykresów kołowych pełne według specyfikacji 2026-10 - zastępuje jasne wnętrze z obrysem (decyzja właściciela, PR #488 i #489); akcent ma drugi nośnik w postaci obrysu.

## Wykresy i mapy danych w blokach i widgetach

- [x] Wszystkie 17 rodzajów wykresu i mapa danych rysowane tak samo w bloku CMS i w widgecie buildera, z paletą ról jako domyślną.
- [x] Wklejanie danych z Excela, Google Sheets, LibreOffice i Numbers do arkusza wykresu i mapy, z podglądem przed zastąpieniem tabeli.
- [x] Import plików arkuszy (xlsx, xlsm, xlsb, xltx, xltm, xls, ods, fods, csv, tsv, txt, html, htm) z listą problemów odczytu.
- [x] Mapa danych według specyfikacji: schematy barw, klasy, legenda, kreskowanie braku danych, tooltip, eksport PNG/SVG, przypisy.
- [x] Wybór koloru serii i serii wyróżnionej; wybór schematu barw mapy z próbkami rampy.
- [ ] Kolor własny pojedynczego wycinka wykresu kołowego.
- [ ] Przekształcenie tabeli w mapę danych.
- [ ] Widgety „feature" (sankey, porównanie, matryca ryzyka, sieć, oś czasu, wskaźnik) i pozostałe mapy według specyfikacji wykresów.

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
- [x] Rozsuniecie kresek kinetic = subtelne: przyrost 3/5/2 px (wezska kolumna 2/3/1), najdluzszy pasek 19 px; krzywa `cubic-bezier(0.22,0.61,0.36,1)` bez wyskoku (wczesniej y=1.56 wypychalo szerokosc poza cel). Pomiar w podgladzie: spoczynek 15 px, hover 19/21/18 px, brak poziomego przelania; testy 24/24.

## Firmowy kolor akcentu

- [x] Usunąć bursztynowe akcenty z interfejsu i zapisanych ustawień motywu; domyślnie używać #FA9346 w jasnym i ciemnym motywie.
- [2026-10-04] Strzałka akcji w etykietach sekcji: domyślny glif tekstowy "→" zastąpiony cienkim kątem SVG ">" bez ogonka (wspólny `AngleChevron`, ten sam znak co para chevronów w Kinetic Signal Notch); opcje "chevron" (›) i "long" (⟶) zachowują tekstowe glify, "none" zdejmuje znak; etykieta edytora "Strzałka >", tłumaczenia EN + kolekcja SECTION_LABEL_ARROWS w labelsEn.test; nowe testy sectionLabelArrow.test.tsx (4) - cała paczka buildera zielona.

## Styl Kinetic Signal Notch na wszystkich stronach CMS Builder

- [x] Zinwentaryzować wszystkie strony i etykiety sekcji w Builderze
- [x] Podmienić wariant wszystkich etykiet sekcji na `kinetic-signal-notch` z zachowaniem treści PL/EN i ustawień
- [x] Zweryfikować zapis, renderowanie mobilne i desktopowe oraz testy

## Spójność geometrii light/dark

- [x] Ujednolicić typografię, rozmiary, odstępy i geometrię widgetów między jasnym i ciemnym trybem.
- [x] Zsynchronizować istniejące zapisane wartości oraz zablokować ponowne tworzenie rozbieżności w edytorze.
- [x] Dodać testy kontraktowe i zweryfikować reprezentatywne strony w obu trybach.

## Tło zgodne z kartą autora

- [x] Ustawić domyślne i zapisane jasne tło #F8F7F3, zachowując ciemny motyw.
- [x] Zweryfikować kolor strony w podglądzie i testy kolorów globalnych (34/34); jasny rgb(248,247,243), ciemny bez zmian rgb(35,31,32).

## Zapisy na wydarzenia - audyt REG-01..REG-17 (2026-10-12)

- [x] REG-01: konto wiąże się z kartoteką tylko przez potwierdzony adres (`_event_bind_uid_for_email`), profil i nabór nie przestawiają adresu na cudzy, naprawa historii odwiązuje niezweryfikowane dowiązania z dziennikiem; pgTAP „konto X zapisuje adres Y -> user_id osoby Y zostaje NULL” i „audyt zwraca 0 wierszy” (21, 44 i 46 asercji).
- [x] REG-02: niezweryfikowany zapis nie zmienia cudzej kartoteki ani zgód (dane w `submitted_profile`, marketing i partnerzy dopiero po potwierdzeniu z maila); pgTAP „anonimowy zapis istniejacego adresu nie zmienia consent_* ani nazwiska”, bramka pisarzy zgód 7/7.
- [x] REG-03: każde zamknięcie opłaconego zgłoszenia (rezygnacja, organizator, odrzucenie, odwołanie wydarzenia) zostawia zlecenie zwrotu albo `needs_review`, a skutek finansowy jest widoczny i potwierdzany przed rezygnacją; pgTAP 69 i 52 asercje, harness 24 (28 i 14).
- [x] REG-04: zapis przez funkcję serwerową z kubełkiem adresu (12 / 10 min) i konta, jedna odpowiedź `check_email` i mail do właściciela adresu; pgTAP „13. proba z jednego IP odrzucona” i „odpowiedzi nierozroznialne” (70, 29 i 40 asercji), e2e bez bezpośredniego RPC `event_register` z przeglądarki, formularz kończy zapis grupowy na `check_email`.
- [x] REG-05: bilet ukryty bez kodu poza formularzem, zapisem i kasą; pgTAP „ukryty bilet bez kodu -> odmowa”, odsłanianie tylko z serwera (82 i 27 asercji).
- [x] REG-06: `participant_reason` oddzielone od notatki wewnętrznej, granty kolumnowe; pgTAP 37/37, harness „REG-06 KRYTERIUM”.
- [x] REG-07: awans z kolejki i kod QR tylko dla rozliczonych, bramka i lista offline bez nierozliczonych; pgTAP 36/36, harness „29/KRYTERIUM REG-07”.
- [x] REG-08: wydarzenie -> bilet -> zgłoszenie u wszystkich zapisujących miejsca; harness dblink 29 (A-E) i 24-R45 (A, B) bez przepełnienia i bez 40P01.
- [x] REG-09: `notify_email` i `notify_sms` obowiązują przypomnienia, `remind_*` mają pisarza; pgTAP „notify_email=false -> brak kandydata e-mail” (16/16), harness 16 (37).
- [x] REG-10: każdy SMS przez `sendParticipantSms` i tylko za zgodą na zgłoszeniu (`notify_sms` domyślnie false); vitest „wyłączony EVENT_SMS_ENABLED -> brak SMS”, pgTAP 44/44.
- [x] REG-11: dziennik `sms_send_log` - „wysłane” dopiero po przyjęciu przez operatora, retencja 30 dni; vitest „błąd HTTP -> ponowienie faktycznie wysyła”, pgTAP 37/37.
- [x] REG-12: karta na stronie wydarzenia bez QR z numeru potwierdzenia, skaner odrzuca numer przed siecią i kolejką offline; vitest bez `ticketQrPayload` i skan kodu z karty (93 testy czerwone na kodzie sprzed zmiany).
- [x] REG-13: `event_ended` w zapisie, gościach grupy, zaproszeniu z pakietu i rezygnacji, bez awansu po końcu i na odwołanym wydarzeniu; pgTAP zapis i rezygnacja po `ends_at`.
- [x] REG-14: rejestr zgód (teksty wersjonowane, księga append-only, double opt-in), wycofanie kluczem, kontem i linkiem wypisu aż do CRM; pgTAP „test odwolania, ktore przechodzi do CRM” (53 i 95 asercji).
- [x] REG-15: przyjęcie zaproszenia z pakietu z wiązaniem przez adres zaproszenia, regulaminem, polami wymaganymi i stanem wydarzenia; podgląd w pamięci podręcznej per montowanie, nieudane wczytanie formularza blokuje wysyłkę; harness 25 (21), pgTAP 40/40.
- [x] REG-16: oferta ceny na 72 h (nie dłużej niż do startu) we wszystkich konsumentach, przypięta do biletu; pgTAP „granica early birda”.
- [x] REG-17: klucz samoobsługi we fragmencie `#token=`, wygasa z końcem wydarzenia, DLQ poczty bez treści i z retencją 30 dni; pgTAP 43 i 21 asercji, harness 78 (25), skan `credentialTransport`.
- [x] Weryfikacja lokalna na `ea489157` (po scaleniu z `main` i FIX-R67): pełny replay 1201 migracji, pgTAP 192 z 195 plików (3 czerwone wyłącznie przez lokalną atrapę Supabase, te same co na samym `main` `81254644`), 22 nowe pliki 957/957, events-harness 4412 asercji (245 migracji), bramki statyczne rc=0, `tsgo` 0 błędów, bramki vitest 789/789.
- [x] Dowód mutacyjny końcowy: 29 mutantów SQL i TS na najnowszych ciałach, wszystkie zabite; ostatni, M17 (`check_email` z gośćmi grupy), zabija test jednostki M17 (`9de678dc`), a w kształcie produkcyjnym także `tsgo` (TS2339). Szczegóły w `docs/NAPRAWA_ZAPISY_WYDARZEN_REG_2026-10-12.md` § 4.
- [x] Po `ea489157`: `email_dlq_redaction_test` na prawdziwym pgmq (`pgmq.send` zwraca SETOF) i wierna atrapa w `scripts/pgtap-local/stub.sql` (`5558af53`), e2e płatnego zapisu przez funkcję serwerową (`bc512788`), poprawki P1 i P2 z przeglądu Codex dla zaproszenia z pakietu (`d51ee5c3`), `routeTree.gen.ts` w kolejności generatora (`494cc8c4`). Na `494cc8c4` wszystkie joby CI są zielone (build, test-shards 1-4, pgtap, pg-harness, verify, e2e, e2e-seeded, Required release checks).
- [x] `scripts/deploy-order/weryfikacja-po-wdrozeniu.sql` wygenerowana na nowo dla drzewa PR (`b76fceaf`): stan oczekiwany z pełnego replayu, pliki spoza selektora w `weryfikacja.zakres.txt`, 452 funkcje, 39 tabel, 61 kolumn, 54 wyzwalacze; 0 wierszy na replayu, a sprawdzone podmiany ciała i usunięcia obiektów dają dokładnie swoje wiersze.
- [x] Scalenie z `main` (`81254644`): 13 migracji serii przenumerowanych na `20261012130500`-`133200`, migracje uzgadniające `20261013900000`-`900900` (unia obu stron dla kolejki i decyzji zwrotów, wyniku płatności biletu, księgi miejsc, odsłaniania, gości grupy, zaproszenia z pakietu, źródła faktury i grantów kolumnowych; każda nośna w `reg_main_merge_test` 24/24), naprawa historii powtórzona w `900900`, identyczny odcisk schematu w kolejności produkcyjnej i w replayu.
- [x] FIX-R67 (`20261012182000`-`182200`): wycofanie zgody SMS i e-mail kluczem zamkniętym albo wygasłym, `not_entry_code` skanera po stronie serwera bez blokady urządzenia, `ticket.server` tylko z własnego zgłoszenia, zgoda zdejmowana przy zmianie adresata SMS, `unsubscribe_url` poza DLQ, bramka jedynego wyjścia SMS na drzewie składni, `phone_hint` -> `phone_changed`, numer z kartoteki w SMS o awansie; pgTAP 53/53, harness `16_`, `17_`, `79_`.
- [ ] Uzgodnienie z `origin/main` `6733f8ef`: 28 migracji `20261013110000`-`112700` redefiniuje 11 funkcji serii (m.in. `event_register`, `event_package_invite_accept`, `event_registration_manage_view`, RPC skanera); potem nowy dowód kolejności produkcyjnej i ponowna generacja `weryfikacja-po-wdrozeniu.sql`.
- [ ] Wdrożenie: ustawienia Supabase Auth, liczby z audytu dowiązań przed naprawą, audyt = 0 po `20261012190100` i `20261013900900`, `EVENT_SMS_ENABLED`, ponowne `_event_unsettled_qr_repair()`, powody `review_reason` na danych produkcji przed `170000`/`900000`, pusty wynik `weryfikacja-po-wdrozeniu.sql` z ręczną kontrolą tego, czego kwerenda nie widzi (granty, stare przeciążenia, zadania pg_cron), `check:migration-ledger` i `check:db-contract` po publikacji.

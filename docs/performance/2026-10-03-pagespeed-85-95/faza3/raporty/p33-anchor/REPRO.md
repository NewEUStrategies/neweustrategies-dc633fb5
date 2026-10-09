# P3.3 - kotwica `#id` przy content-visibility: reprodukcja i przyczyna (REPRO)

- artefakt: `scratchpad/base-w3f` (dokładnie `4d1e2791`, `.output` z integracji; nic nie przebudowane)
- narzędzia (scratch): `phase3/p33-anchor/repro/` - `pw.config.ts` (serwer artefaktu z fixture, port 4291),
  `anchor-throttle.spec.ts` (reprodukcja + oś czasu + prototypy poprawek), `anchor-cost.spec.ts`
  (koszt poprawek, trace), `anchor-probe.spec.ts` / `anchor-chain.spec.ts` / `anchor-synth.spec.ts`
  (sondy), `playwright-*.sh`; wyniki JSONL w `repro/out/`, dwa trace porażek w `repro/out/keep/`,
  log i trace z CI w `repro/ci/`, źródła Chromium 141 w `repro/chromium-src/`.
- przeglądarka: Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium-1194`, a dla porównania z CI także
  `chromium_headless_shell-1194` - tej używa CI), telefon 412x823, `locale pl-PL`.

## TL;DR

1. **To nie jest efekt wolnego CPU.** Dławienie CDP x1/x4/x6/x8 (`location.hash`, prawdziwy klik
   w `<a href="#id">`) daje 100% trafień (32/32 i 32/32), także w headless shell, przy wolnej sieci,
   wczytaniu przy x20, po obrocie ekranu i po ponownym przewinięciu strony. Oś czasu porażki z CI
   (`trace.zip` z artefaktu `playwright-report-artifact-boot`) jest wręcz **szybsza** niż lokalna x1:
   skok 3780 po ~85 ms, korekta do 3987 po ~240 ms, stan końcowy 3958 po ~700 ms - lokalnie w porażce
   te same liczby po 18 / 241 / 700 ms.
2. **Mechanizm (potwierdzony trace `blink.debug` z `ScrollAnchor::FindAnchor/Adjust`):** po skoku do
   fragmentu zakotwiczenie przewijania Chromium wybiera kotwicę **wewnątrz pominiętej sekcji nad
   celem** (w5: rząd kropek karuzeli `div.flex.items-center.justify-center.gap-3.mt-3`, y = 125 px).
   Gdy sekcje w marginesie widoku się odsłaniają, w4 rośnie o +207 px (nad kotwicą - skompensowane),
   a w5 o +995 px **pod kotwicą, ale nad celem** - nieskompensowane. Cel ląduje 995 px niżej:
   `top = 244,9 + 995 = 1239,9` - dokładnie liczba z CI.
3. Do tego potrzebne są dwa warunki naraz:
   - **W1 - geometria skoku:** sekcja nad celem wchodzi w obszar wyboru kotwicy, czyli
     `T - scroll-padding-top > odstęp celu od góry jego sekcji` (T = top celu po skoku). Obszar wyboru
     kotwicy w Chromium 141 to widok **pomniejszony o `scroll-padding-top`** (122 px). W CI cel
     wylądował z `T = 244,9` (= scroll-padding 122 + **pełny** scroll-margin 122) - w5 wystawała 82 px
     w obszar. Lokalnie `T = 146,6`, bo wewnętrzny kontener `overflow:hidden` (`.text-foreground`)
     przycina scroll-margin celu do 24,6 px (Chromium 141 `ScrollRectToVisible`: prostokąt z marginesem
     jest przecinany z obszarem każdego wewnętrznego scrollera, a potem margines jest zerowany), więc
     w5 kończy się na 106 px < 122 - poza obszarem. Dla celu na samej górze sekcji (nagłówek
     na początku rich-textu, `section` z `id`) W1 zachodzi zawsze (`T = 244`, odstęp 0).
   - **W2 - pominięta sekcja nad celem ma ułożonych potomków:** sekcja, której nigdy nie ułożono, nie
     jest kandydatem (`FindAnchorRecursive`: `if (!candidate->EverHadLayout()) return kSkip`), więc
     kotwica trafia do sekcji celu (aktywowanej przez nawigację) i kompensacja jest pełna. W CI
     poddrzewa pominiętych sekcji są układane **wymuszenie przez snapshotter trace Playwrighta**
     (`trace: "retain-on-failure"` nagrywa każdy krok; `snapshotterInjected` czyta `element.scrollTop`
     i `scrollLeft` KAŻDEGO elementu, a odczyt geometrii w pominiętym poddrzewie wymusza jego układ).
     W realnej przeglądarce to samo robi każdy skrypt czytający geometrię w pominiętej sekcji
     (pomiar widgetów, rozszerzenia, automaty, narzędzia) oraz sekcja wyrenderowana wcześniej, której
     treść zmieniła się w czasie pominięcia.
4. **Jedyny „ratunek” to wyścig:** `scrollIntoView` z `onRendered` TanStacka (popstate -> `router.load`
   -> render). Gdy przyjdzie PO odsłonięciu sekcji (~170-250 ms po skoku przy x1; 1,7-3,6 s przy x4),
   przestawia cel - ale użytkownik widzi przez ten czas złą sekcję i potem skok. Gdy przyjdzie PRZED
   (CI, lokalnie x1 w ~2/3 prób), stan 1239,9 zostaje na stałe.
5. **Odtworzenie lokalne, liczby identyczne z CI (`top 1239,875`, `scrollY 3958`, `headerBottom 66`):**
   - naturalnie, bez żadnej emulacji CSS: cel na górze sekcji w6 (`#ax-sectop`) + trace Playwrighta -
     przeglądarka kompensuje tylko +207 we **wszystkich 12/12** próbach; TanStack ratuje 11/12 po
     0,3-3,6 s, 1/12 (x4) zostaje 1239,9 na stałe;
   - test z CI (nagłówek H3) w geometrii z CI (W1 wymuszone `overflow:clip` na kontenerach
     `overflow:hidden` w sekcjach z cv - skok trafia dokładnie w 3780, jak w CI) + trace: 3/4, 4/6,
     4/6 i 6/6 porażek przy x1 (`hash` i klik).
6. **Safari (WebKit 18+) nie ma zakotwiczenia przewijania wcale** - tam każdy wzrost sekcji nad celem po
   skoku przesuwa cel (bez W1/W2). Na telefonie szacunki są 2-3x za niskie (w5: 532 vs 1527 px), więc
   na iOS błąd jest deterministyczny (nie zweryfikowane - brak WebKita w piaskownicy).
7. **Rekomendacja: opcja (a)** - przy pierwszej nawigacji do fragmentu w tym samym dokumencie ustawić
   `html[data-cv-off]` ZANIM przeglądarka policzy przewinięcie (klik w fazie capture, `popstate`
   - zmierzone: przychodzi synchronicznie przed przewinięciem; `hashchange` + ponowne `scrollIntoView`
     jako siatka dla innych silników), w istniejącym strażniku `CV_GUARD_SCRIPT` (tylko serwer, zero JS
     bootu, parzystość SSR bez zmian). W warunkach z CI: 12/12 i 6/6 dla celu na górze sekcji. Koszt:
     jednorazowe odsłonięcie wszystkich sekcji = styl+układ 78 ms (x4) / 182 ms (x6) w jednym zadaniu;
     INP kliku 456 -> 776 ms (x4), 704 -> 1288 ms (x6), czyli tyle, ile ten klik kosztował przed P3.3
     (752 / 1096 ms) plus jednorazowe odsłonięcie; oszczędność P3.3 przy wczytaniu zostaje. Opcja (e)
     `overflow-anchor:none` na pominiętych opakowaniach jest prawie darmowa i też naprawia Chromium
     (12/12 + 6/6), ale nie pomaga Safari.

## 1. Reprodukcja przez dławienie CPU (krok 1 testu, `location.hash = id`)

Spec: `repro/anchor-throttle.spec.ts` (setup skopiowany z `e2e/content-visibility.boot-home.spec.ts`:
`openHome`, wybór celu „najdalszy `[id]` w sekcji od indeksu 2”, `settle`, `where`, `expectLanded`),
`Emulation.setCPUThrottlingRate` ustawiane przed `goto`, świeży kontekst na próbę, artefakt na fixture.
Kryterium jak w teście: `scrollY > 823`, `headerBottom - 1 <= top < headerBottom + 274,3`.

| warunki                                                                                | tryb                                                     |        x1 |        x4 |   x6 |   x8 |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------: | --------: | ---: | ---: |
| pełny Chromium, bez trace                                                              | `location.hash`                                          |       8/8 |       8/8 |  8/8 |  8/8 |
|                                                                                        | klik w `<a href="#id">` (wstrzyknięty, `position:fixed`) |       8/8 |       8/8 |  8/8 |  8/8 |
|                                                                                        | `router.navigate({hash})` (= `<Link hash>`)              |      0/8* |      0/8* | 0/8* | 0/8* |
| headless shell (jak CI)                                                                | `location.hash` / klik                                   | 6/6 / 6/6 | 6/6 / 6/6 |      |      |
| obrót 823x412 -> 412x823 po przewinięciu całej strony (zapamiętane rozmiary z poziomu) | hash                                                     |       4/4 |       4/4 |      |      |
| przewinięcie całej strony i powrót                                                     | hash                                                     |       4/4 |       4/4 |      |      |
| wolna sieć (96 KB/s, HTML strumieniowany ~30 s)                                        | hash                                                     |       4/4 |       4/4 |      |      |
| wczytanie przy x20, skok przy x1/x4                                                    | hash                                                     |       4/4 |       4/4 |      |      |
| trace Playwrighta (snapshoty, jak CI)                                                  | hash                                                     |       4/4 |       4/4 |      |      |

\* `router.navigate({ hash })` nie przewija **wcale** (`scrollY = 0`): `src/router.tsx` ma
`defaultHashScrollIntoView: false` (kotwice w artykułach obsługuje własny scroller). To zachowanie
sprzed P3.3 i od cv niezależne; na stronie buildera `<Link hash>` nie trafi w cel nigdy.

W każdym przebiegu bez W1 skok liczony jest na pasach (`y = 3877`, `T = 147`), po ~170-250 ms sekcje
w4/w5/w7 odsłaniają się (w4 632->839, w5 532->1527, w7 280->187), a zakotwiczenie przesuwa `scrollY`
o +1203 (= wzrost w4+w5) w jednej klatce - trace `blink.debug`: kotwica = `div.flex.flex-col...`
widgetu w sekcji celu, `Adjust [0 1203]`.

## 2. Dowody z CI (`repro/ci/`)

Pobrane: `gh run view 37873997491 --log-failed` i artefakt `playwright-report-artifact-boot` (trace
porażki). Wyniki kolejnych akcji testu (czas od `newPage`):

|        t (ms) | akcja                                        | wynik                                                                                |
| ------------: | -------------------------------------------- | ------------------------------------------------------------------------------------ |
|          1223 | `__nesAppReady`                              | `true` (3. odpytanie)                                                                |
|     1337-1448 | `location.hash = "_R_1rqtf6pdb8iq_-heading"` | snapshot po: `scrollTop 3780`                                                        |
|          +243 | snapshot                                     | `scrollTop 3987` (+207 = wzrost w4 632->839)                                         |
| +296 ... +701 | snapshoty                                    | 3986, 3983, 3980, 3967, 3966, 3963, 3962, **3958** (kurczenie nagłówka 107->66, -29) |
|     1629-2937 | `settle`                                     | `3985                                                                                | 103.8`, `3964 | 74.97`, `3958 | 66` x6 - stabilne |
|          2958 | `where`                                      | `top 1239.875`, `headerBottom 66`, `scrollY 3958`                                    |

- Klatka ekranu tuż po skoku (`ci/frame-21627-top.png`): nagłówek „Zapisz się do newslettera” na ~244 px
  (lokalnie 147 px) - **T z CI = 244,9 = scroll-padding 122 + pełny scroll-margin 122**.
- Ostatnia klatka: w widoku karuzela „Analiza 1 …” i „TREŚĆ PRZYKŁADOWA” (treść w5), formularza brak.
- Rachunek: dokument końcowy identyczny jak lokalnie (cel na `5051 + 146,9 = 3958 + 1239,9 = 5197,9`);
  `3780 + 207 - 29 = 3958`, a `244,9 + 995 = 1239,9`. Z sumy 1202 px wzrostu skompensowano 207 (w4),
  nie skompensowano 995 (w5).
- W CI testy jechały na 2 workerach równolegle (numeracja się przeplata: test 17 `legal-links` kończy się po 18), `trace: retain-on-failure`
  (snapshot DOM-u przed i po każdej akcji), headless shell.

## 3. Mechanizm

### 3.1 Co mówi kod Chromium 141 (`repro/chromium-src/`, tag 141.0.7390.37)

- `scroll_into_view_util.cc` (`siv141.cc`): prostokąt celu jest powiększany o `scroll-margin`, każdy
  wewnętrzny scroller (`overflow:hidden` to też scroller) zwraca go przecięty ze swoim obszarem
  (`PaintLayerScrollableArea::ScrollIntoView`, `Intersection(scrollport_rect, local_expose_rect)`),
  a po pierwszym scrollerze margines jest zerowany („Once we've taken the scroll-margin into account,
  don't apply it to ancestor scrollers”). Sonda (`anchor-probe.spec.ts`, strona w pełni wyrenderowana):
  `T = 146,6`; przy `scroll-padding-top: 0` -> 24,6; przy `scroll-margin-top: 0` -> 121,6; po zamianie
  `overflow:hidden` -> `overflow:clip` w sekcjach z cv (`clip` przycina tak samo, ale nie jest
  scrollerem) -> `T = 244,4` i **`scrollY = 3780` - co do piksela jak w CI**.
- `scroll_anchor.cc` (`sa141.cc`): `GetVisibleRect` = obszar widoku **pomniejszony o scroll-padding**
  (tu [122, 823]); wybór kotwicy przechodzi drzewo układu w kolejności dokumentu i bierze pierwszy
  przecinający obszar element (głębiej, jeśli się da); `FindAnchorRecursive` pomija obiekty bez
  układu (`EverHadLayout`). Syntetyk (`anchor-synth.spec.ts`): nigdy nieułożone opakowanie cv
  przecinające obszar NIE zostaje kotwicą (kotwica = opakowanie celu), kompensacja +2000 = pełna.
- `ScrollAnchor::Adjust` kompensuje tylko przesunięcie kotwicy; wzrost poniżej kotwicy zostaje.

### 3.2 Łańcuch zdarzeń (porażka lokalna `tlfail2` #0 - trace Playwrighta + geometria z CI, x1)

Czasy od `location.hash = id`; opakowania `indeks:szacunek/wysokość@top` (px w widoku).

|  t (ms) | zdarzenie                                                      |    scrollY | stan                                                                                                              |
| ------: | -------------------------------------------------------------- | ---------: | ----------------------------------------------------------------------------------------------------------------- |
|       0 | `location.hash = id`                                           |          0 |                                                                                                                   |
|    12,5 | `popstate` (synchronicznie, **przed** przewinięciem)           |          0 |                                                                                                                   |
|    17,9 | przewinięcie do fragmentu (w środku przypisania)               |       3780 | cel T=244; w5 `532/532@-329` (pas, kończy się na 203 > 122), w6 `720@203` (ułożona wymuszenie), w4 `632/632@-961` |
|      42 | w6 odsłonięta (aktywacja celu), RO 720                         |       3780 | kotwica wybrana: **rząd kropek karuzeli w w5 @125** (potomkowie w5 ułożeni przez snapshotter)                     |
|     135 | `scrollIntoView` TanStacka (onRendered po popstate)            | 3780->3780 | nic jeszcze nie urosło - ratunek zmarnowany                                                                       |
|     187 | IO content-visibility odsłania w4/w5/w7 (RO: 839 / 1527 / 187) |            |                                                                                                                   |
|     241 | `Adjust [0 207]` (trace)                                       |   **3987** | w4 +207 nad kotwicą skompensowane; w5 +995 pod kotwicą: w6 `@1199`, cel **1240**                                  |
| 318-705 | kurczenie nagłówka 107->66, korekty zakotwiczenia              | 3987->3958 | cel 1239,9                                                                                                        |
|    705+ | nic                                                            |   **3958** | stan końcowy = CI (fragment anchor Chromium nie jest ponawiany po `load`, TanStack już strzelił)                  |

W przebiegach „zaliczonych” w tych samych warunkach (`tlfail2` #1) różni się tylko jedno: `scrollIntoView`
TanStacka przychodzi po wzroście (t=311 ms: 3987->4982) i przestawia cel. Ze śladem `blink.debug`
(`tlfail`, 5/5) widać to samo: `FindAnchor` -> `div.flex.items-center.justify-center.gap-3.mt-3`
@ (32,125), `Adjust [0 207]`, potem `scrollIntoView` TanStacka 3958->4954 po 0,8-1,2 s.

### 3.3 Macierz warunków (x1, `location.hash`, cel z testu, 6 prób)

| W1 (T=244)                                    | W2 (ułożone potomstwo w5)                                | wynik                                                                                     | kotwica (trace)                            |
| --------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| nie                                           | nie                                                      | 8/8 (+1203)                                                                               | w sekcji celu                              |
| nie                                           | tak (trace PW / odczyt `scrollTop` wszystkich elementów) | 4/4, 3/3 (+1203)                                                                          | w sekcji celu (w5 kończy się na 106 < 122) |
| tak (`overflow:clip`)                         | nie                                                      | 5/5 x3 dławienia (+1203)                                                                  | rodzic H3 w w6                             |
| tak                                           | tak (odczyt `scrollTop`)                                 | 1/2 (+207)                                                                                | kropki karuzeli w w5                       |
| tak                                           | tak (trace PW)                                           | 1/4, 2/6, 2/6 hash; 0/6 klik (+207, reszta „uratowana” przez TanStacka)                   | kropki karuzeli w w5                       |
| tak, naturalnie (cel = `section` na górze w6) | nie                                                      | 8/8 (+1203)                                                                               |                                            |
| tak, naturalnie                               | tak (trace PW)                                           | 12/12 przeglądarka kompensuje tylko +207; po ratunku TanStacka 11/12, 1/12 zostaje 1239,9 |                                            |

Przy x4 w geometrii z CI + trace wynik to 4/4 „zaliczone” - wyłącznie dlatego, że przy wolniejszym JS
`scrollIntoView` TanStacka przychodzi po odsłonięciu sekcji (1,7-3,6 s po skoku, z widocznym skokiem).
Wolniejsze CPU błąd **maskuje**, nie wywołuje.

### 3.4 Dlaczego w CI `T = 244,9`, a lokalnie 146,6 - niezamknięte

Ten sam Chromium 141, ten sam DOM i CSS (snapshot DOM-u z CI: łańcuch przodków H3 z tymi samymi
`overflow:hidden`), identyczny układ końcowy, ta sama zmienna `--sticky-header-h: 107px`. W CI
wewnętrzne kontenery `overflow:hidden` sekcji celu NIE wzięły udziału w `ScrollRectToVisible`
(zachowanie identyczne z emulacją `overflow:clip`). Wykluczone lokalnie: dławienie x1-x8, headless
shell vs pełny Chromium, trace Playwrighta, odstęp 0 / 3 s od gotowości, wolna sieć, wczytanie x20,
zapamiętane rozmiary po obrocie. Hipoteza: stan `PaintLayerScrollableArea` w nigdy nierenderowanym,
zablokowanym poddrzewie w chwili wymuszonego układu (zależny od kolejności zadań). Dla poprawki bez
znaczenia - W1 zachodzi naturalnie dla każdego celu bliżej niż ~122 px od góry sekcji (np. nagłówek
z `id` na początku rich-textu), a test przechodzi lokalnie tylko dlatego, że jego cel siedzi 41 px
w sekcji pod przycinającym kontenerem.

### 3.5 Zasięg UX

- Chromium/Firefox (zakotwiczenie jest): błąd wymaga W1 + W2. W1 - częste (cele przy górze sekcji).
  W2 u realnego użytkownika rzadsze: skrypt czytający geometrię w pominiętej sekcji albo sekcja
  odsłonięta wcześniej, której treść zmieniła się w czasie pominięcia (obrazy, hydratacja wysp).
- Safari/WebKit (cv od 18.0, **brak `overflow-anchor`**): każdy wzrost sekcji w marginesie nad celem
  po skoku przesuwa cel; szacunki na telefonie są 1,3-3x za niskie (w3 532/1005, w4 632/839, w5 532/1527,
  w6 280/720). Najpoważniejszy wariant - do weryfikacji na urządzeniu.
- Wejście z `/#id` (strażnik) i przeładowanie - bez zmian, działają.
- `<Link hash>` routera - nie przewija w ogóle (sprzed P3.3).

## 4. Opcje poprawki

Walidacja prototypów (wstrzykiwane skryptem, źródła nietknięte) w warunkach odtwarzających CI (W1 przez
`overflow:clip` + trace Playwrighta, x1, 6 prób na tryb) i na naturalnym celu `sectop` + trace.
Koszt: `anchor-cost.spec.ts`, telefon 412x823, klik w link `#id` z góry strony po 2,5 s spoczynku,
mediana z 5 prób; INP = `duration` wpisu Event Timing `click`; „odsłonięcie” = synchroniczne
`data-cv-off` + wymuszony styl/układ (bez kliku).

| wariant                                                              | CI-like hash / klik |                `sectop` + trace |       INP kliku x4 (min-max) | INP kliku x6 (min-max) |
| -------------------------------------------------------------------- | ------------------: | ------------------------------: | ---------------------------: | ---------------------: |
| stan `4d1e2791` (cur)                                                |           2/6 / 0/6 | 5/6 (12/12 źle przed ratunkiem) |            **456** (432-504) |      **704** (648-728) |
| baza bez cv (`/#__ax_none` - strażnik przy wczytaniu, = sprzed P3.3) |                   - |                               - |                752 (656-872) |       1096 (1088-1256) |
| (a) `data-cv-off` przed przewinięciem                                |       **6/6 / 6/6** |                         **6/6** |                776 (736-816) |       1288 (1072-1464) |
| (b) wyrównanie celu co klatkę 0,8-2,5 s                              |           6/6 / 6/6 |                               - |          ~cur (nie mierzone) |                        |
| (c) odsłonięcie sekcji celu + ~1,5 ekranu nad nim + 1 pod            |           6/6 / 6/6 |                             6/6 |                792 (760-856) |       1232 (1176-1304) |
| (e) `overflow-anchor:none` na pominiętych opakowaniach               |           6/6 / 6/6 |                             6/6 |                480 (480-560) |          800 (616-832) |
| samo odsłonięcie wszystkich sekcji (koszt (a) bez routera)           |                   - |                               - | styl+układ **78 ms** (70-94) |   **182 ms** (133-205) |

Koszt tych sekcji przy wczytaniu (trace od nawigacji do kliku, mediany): baza bez cv / cur - styl
573 / 356 ms, układ 170 / 88 ms, najdłuższy styl 146 / 64 ms, najdłuższy układ 89 / 21 ms (x4);
x6: 887 / 607, 276 / 145, 240 / 101, 116 / 25. P3.3 oszczędza przy wczytaniu ~300 ms (x4) / ~410 ms
(x6) stylu+układu w wielu przebiegach; (a) oddaje jednorazowo 78 / 182 ms w jednym zadaniu, dopiero
przy pierwszym skoku do kotwicy.

Uwaga do INP: nawet bez cv (baza) klik w kotwicę kosztuje 752 ms przy x4. Dominuje nie przewinięcie,
a obsługa `popstate` przez TanStacka (pełne `router.load` i render trasy na samą zmianę `#`,
`defaultViewTransition: true`). P3.3 dziś ten koszt obniża (pominięte sekcje nie liczą stylu przy
renderze trasy); (a) i (c) przywracają poziom sprzed P3.3.

### (a) Rozszerzenie strażnika: `html[data-cv-off]` przy nawigacji do fragmentu

- Jak: w `CV_GUARD_SCRIPT` (inline, tylko serwer): `addEventListener("click", …, true)` - link
  `a[href*="#"]` (i `area`) do tego samego dokumentu z istniejącym celem -> `data-cv-off` przed
  domyślną akcją; `addEventListener("popstate", …)` - `location.hash` z istniejącym celem ->
  `data-cv-off` (zmierzone w Chromium: `popstate` przychodzi synchronicznie PRZED przewinięciem,
  `t=12,5` vs `17,9` ms); `hashchange` - jeśli cv było jeszcze włączone, wyłączyć i
  `getElementById(id).scrollIntoView()` (siatka dla silników z inną kolejnością). Raz wyłączone
  zostaje wyłączone do końca życia strony.
- Plusy: deterministyczne w każdym silniku (także Safari bez zakotwiczenia); pasuje do istniejącego
  wyłącznika (ta sama reguła `CV_CSS`, ten sam atrybut, `suppressHydrationWarning` na `<html>` już jest);
  zero bajtów w JS bootu (strażnik jest w HTML-u, klient renderuje pusty blok), parzystość SSR bez
  zmian; szacunkowo ~250-350 B w `inlineScriptBytes` (zapas ~11 KB), bez komentarzy CSS; zysk P3.3 przy wczytaniu
  i w zwykłym przewijaniu zostaje; test e2e staje się deterministyczny (bez wyścigu z TanStackiem).
- Minusy: pierwszy klik w kotwicę płaci odsłonięcie wszystkich sekcji (78 / 182 ms stylu+układu
  w jednym zadaniu, x4 / x6) i INP tego kliku wraca do poziomu sprzed P3.3 (+320 / +584 ms vs dziś);
  przechwytuje tylko nawigacje przeglądarki - przewijanie skryptem (`scrollIntoView`, własny scroller)
  wymaga wywołania tego samego wyłącznika.

### (b) Wyrównywanie celu przez kolejne klatki

- Jak: po `popstate`/`hashchange` pętla rAF: `scrollIntoView` celu przy każdej zmianie wysokości
  opakowań, min. 0,8 s (odsłonięcie przychodzi po ~170-250 ms przy x1, później przy wolnym CPU),
  koniec po 10 stabilnych klatkach / 2,5 s; anulowanie na `wheel`/`touchstart`/`keydown`.
- Plusy: tanie (brak dużego zadania), cv zostaje.
- Minusy: widoczny skok po 0,2-3 s (to samo, co dziś robi przypadkiem TanStack); okno, w którym
  skrypt walczy z użytkownikiem; czas zależny od CPU (prototyp z 3 stabilnymi klatkami kończył się
  przed odsłonięciem i nie działał: 3/6 i 0/6); trudne do udowodnienia testem.

### (c) Odsłonięcie tylko sekcji wokół celu

- Jak: przy tej samej nawigacji co (a): `content-visibility:visible` (styl inline albo atrybut + reguła)
  na opakowaniu celu, poprzednich aż do ~1,5 ekranu szacunku nad nim i jednym za nim.
- Plusy: poprawne w Chromium (12/12 + 6/6); na długich stronach tańsze niż (a) (tu ogon ma 6 sekcji
  i odsłania się 4-5, więc koszt jak (a): 792 / 1232 ms).
- Minusy: więcej logiki w strażniku; dalsze sekcje nad celem zostają pasami - w Safari (bez
  zakotwiczenia) ich odsłonięcie przy przewijaniu w górę i tak przesunie treść, a margines renderu
  WebKitu nie jest znany; ten sam koszt INP na krótkich ogonach.

### (d) Lepsze szacunki `contain-intrinsic-size`

- Jak: `estimateSectionHeight(section, "mobile")` (kolumny jedna pod drugą = suma, nie maksimum)
  i para wartości w HTML-u (np. `--cv-m` w stylu + reguła `@media` w `CV_CSS`), bo HTML jest wspólny dla
  urządzeń.
- Plusy: mniejsze skoki paska przewijania i mniejszy błąd w Safari; zero kosztu w kliencie.
- Minusy: nie usuwa mechanizmu (każda reszta błędu nad kotwicą zostaje); obrazy, zawijanie tekstu
  i hydratacja wysp nie są do przewidzenia z konfiguracji; więcej bajtów HTML.

### (e) `overflow-anchor:none` na pominiętych opakowaniach

- Jak: w strażniku nasłuch `contentvisibilityautostatechange` (capture na `document`, zdarzenie
  przychodzi też na starcie dla każdego opakowania) przełączający atrybut `data-cv-skip`, w `CV_CSS`
  `[data-cv][data-cv-skip]{overflow-anchor:none}`. Pominięte opakowanie i jego potomkowie nigdy nie są
  kotwicą, więc kotwica zawsze siedzi w wyrenderowanej treści (przy skoku - w sekcji celu), a wzrost
  sekcji nad nią jest kompensowany w całości. Zdarzenie o odsłonięciu przychodzi PO klatce wzrostu,
  więc w tej klatce opakowanie jest jeszcze wyłączone - dokładnie to, czego trzeba.
- Plusy: naprawia Chromium w warunkach z CI (12/12 + 6/6); koszt INP w granicach szumu (480 vs 456 ms
  x4, 800 vs 704 x6); cv zostaje włączone; ~150 B strażnika + ~45 B CSS.
- Minusy: **nic nie daje w Safari** (brak zakotwiczenia); atrybut na opakowaniu dopisywany przed
  hydratacją (React w produkcji go nie rusza, ale to nowy stan DOM-u spoza Reacta); zależy od
  `contentvisibilityautostatechange` (Chromium 123+; w Firefoksie i Safari razem ze wsparciem cv - nie sprawdzone tutaj).

### (f) Poza P3.3, warte osobnych pozycji

- Zmiana samego `#` w tym samym dokumencie uruchamia w TanStacku pełne `router.load` + render
  (+ view transition): 752 ms INP przy x4 nawet bez cv - to największy koszt kliku w kotwicę.
- `defaultHashScrollIntoView: false` - `<Link hash>` na stronach buildera nie przewija w ogóle.
- Testy geometrii cv w CI jadą z `trace: retain-on-failure`: snapshotter wymusza układ każdego
  pominiętego poddrzewa przy każdej akcji, więc CI mierzy inną przeglądarkę niż użytkownik ma.

## 5. Rekomendacja

**(a) jako poprawka właściwa** w `CV_GUARD_SCRIPT`: `data-cv-off` na pierwszą nawigację do fragmentu
w tym samym dokumencie, ustawiane przed przewinięciem (klik capture + `popstate`), `hashchange` z
ponownym `scrollIntoView` jako siatka. Jedyna opcja deterministyczna niezależnie od silnika i od
stanu zakotwiczenia (Safari), bez JS bootu i bez zmiany parzystości SSR; koszt to jednorazowy powrót
INP tego jednego kliku do poziomu sprzed P3.3 (styl+układ 78 / 182 ms przy x4 / x6). Opcjonalnie
dołożyć **(e)** (prawie darmowe) dla przypadków bez nawigacji w Chromium/Firefox (sekcja odsłonięta
wcześniej i zmieniona w czasie pominięcia). Jeżeli budżet INP kliku w kotwicę okaże się twardy -
**(c)** daje tę samą poprawność w Chromium, ale na tym fixture kosztuje tyle samo.

Test e2e po poprawce: krok 1 przez prawdziwy klik w `<a href="#…">` i drugi cel na samej górze sekcji
(`T - scroll-padding > odstęp`), oba z asercją `cvOff === true`; dziś krok 1 zależy od wyścigu
`scrollIntoView` TanStacka z IO content-visibility, a lokalnie przechodzi tylko dzięki przycinającemu
kontenerowi nad celem.

## 6. Jak odtworzyć

```
cd scratchpad/phase3/p33-anchor/repro && ../../../heavy-bg.sh logs/x.log \
  env AX_PWTRACE=1 AX_RATES=1 AX_MODES=sectop AX_N=6 ./playwright-run.sh x anchor-throttle
# test z CI w geometrii z CI:     AX_PWTRACE=1 AX_FIX=clipfree AX_MODES=hash,click
# z prototypem poprawki:          AX_FIX=clipfree+cvoff | clipfree+anchor | clipfree+near | clipfree+realign
# ślad kotwicy (blink.debug):     AX_TRACE=1   oś czasu co klatkę: AX_TL=1   dławienie: AX_RATES=1,4,6,8
# koszt:                          AX_RATES=4,6 AX_N=5 ./playwright-run.sh cost anchor-cost
```

Wyniki: `out/<tag>.jsonl` (`landed`, `after` = zdarzenia od nawigacji: `scroll`, `siv` z wywołującym,
`ro` = ResizeObserver opakowań, `cv` = `contentvisibilityautostatechange`, `NAVsync` = geometria
w chwili skoku; `anchorTrace` = `FindAnchor`/`Adjust`; `frames` = oś czasu). Trace Playwrighta porażek:
`out/keep/pwtrace-sectop-4-5-none.zip` (naturalny cel, x4, 1239,9 na stałe),
`out/keep/pwtrace-hash-1-0-clipfree.zip`.

Skutek uboczny: runner Playwrighta (cwd = `base-w3f`) zapisał `base-w3f/test-results/.last-run.json`
(katalog ignorowany przez git); `.output` i pliki śledzone nietknięte, serwer na 4291 zatrzymany.

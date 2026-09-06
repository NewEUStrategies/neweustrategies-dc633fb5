# ZADANIE: powłoka panelu admin - 2 305 niepokrytych linii, 900 funkcji, 1 240 testów i 58,4%

Wejście: audyt pokrycia testami, wydanie 9
(`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`).

**PRZEKROJOWE: powłoka panelu admin + atomy/molekuły (`X-shell`). 221 plików:
linie 3 234/5 539 = 58,39%, funkcje 1 023/1 923 = 53,20%, gałęzie 52,13%, instrukcje 57,06%.
Plików na zerze 27. Niepokrytych linii 2 305, niewywołanych funkcji 900.**

**To jest najsłabsza powierzchnia całego zestawienia** - jedyna poniżej 60% linii i jedyna
poniżej 55% funkcji. I ma **1 240 testów** przy współczynniku test/produkcja **0,33**, czyli
trzecim od końca z dwudziestu wartości w tabeli (niżej są tylko 0,04 i 0,05). Zdanie, od
którego trzeba zacząć, brzmi więc: **to nie jest powierzchnia bez testów. To powierzchnia
z tysiącem testów, które omijają jej największe pliki.**

---

# 0. Co jest ustalone. Przeczytaj, zanim cokolwiek zmienisz

## 0.1 Podstawa pomiaru

Procenty z `coverage-ed9/coverage-summary.json` (PIERWSZY przebieg wydania 9 - ten, w którym
zakotwiczony jest cały dokument audytu). Nazwy niewywołanych funkcji
z `coverage-ed9-final/coverage-final.json` (przebieg 2 - jedyny z reporterem `json`).
**Nie używaj `coverage-ed8/` jako stanu dzisiejszego.** Zanim ruszysz jakąkolwiek liczbę -
odtwórz ją u siebie; przy rozbieżności **zatrzymaj się i zgłoś**, nie „popraw pod nią kodu".

## 0.2 Nazwa powierzchni myli: atomy i molekuły są ZDROWE

Nazwa mówi „powłoka panelu admin **+ atomy/molekuły**". Zmierzone po katalogach, luka
rozkłada się tak:

| niepokrytych linii | plików | katalog                                                |
| -----------------: | -----: | ------------------------------------------------------ |
|          **1 381** |     31 | `src/components/admin` (pliki bezpośrednio w katalogu) |
|            **637** |     30 | `src/components` (pliki bezpośrednio w katalogu)       |
|                 84 |     24 | `src/components/atoms`                                 |
|                 39 |      1 | `src/components/cart/organisms`                        |
|                 36 |      8 | `src/hooks`                                            |
|                 34 |     15 | `src/components/molecules`                             |
|                 27 |     15 | `src/components/admin/molecules`                       |
|                 24 |     10 | `src/components/features`                              |
|                 14 |      7 | `src/components/admin/atoms`                           |
|                 12 |      4 | `src/components/admin/ads/organisms`                   |
|                 10 |      1 | `src/components/cart/atoms`                            |
|                  4 |      4 | `src/components/admin/membership/organisms`            |
|                  2 |      6 | `src/components/admin/membership/molecules`            |
|                  1 |      1 | `src/components/cart/molecules`                        |

**Sześćdziesiąt jeden plików warstwy atomów i molekuł (`atoms`, `molecules`, `admin/atoms`,
`admin/molecules`) niesie razem 159 niepokrytych linii** - czyli 6,9% luki przy 27,6% plików.
Ta warstwa jest w porządku i **nie należy jej ruszać**.

**Cała robota jest w 61 plikach leżących BEZPOŚREDNIO w `src/components/admin` i
`src/components`: 2 018 z 2 305 niepokrytych linii = 87,5%.**

## 0.3 Dwadzieścia plików niesie 71,8% luki

| brak linii |     linie | funkcje | gałęzie | plik                                             |
| ---------: | --------: | ------: | ------: | ------------------------------------------------ |
|    **277** |     2,12% |  **0%** |  **0%** | `src/components/admin/GlobalColorsEditor.tsx`    |
|    **195** |    **0%** |  **0%** |      0% | `src/components/admin/TrendingTickerPane.tsx`    |
|    **178** |     1,65% |  **0%** |  **0%** | `src/components/Header.tsx`                      |
|    **125** |    34,89% |  14,28% |  35,14% | `src/components/admin/ThemeOptionsPane.tsx`      |
|         92 |     4,16% |  **0%** |      0% | `src/components/admin/AudioPicker.tsx`           |
|         87 |     4,39% |   5,40% |  18,99% | `src/components/admin/AdminShell.tsx`            |
|         84 |     5,61% |  **0%** |      0% | `src/components/admin/PostSettingsMetabox.tsx`   |
|     **82** | **1,20%** |  **0%** |  **0%** | `src/components/ConsentScriptInjector.tsx`       |
|         67 |    **0%** |  **0%** |      0% | `src/components/admin/AccessSettingsPane.tsx`    |
|         66 |     1,49% |  **0%** |      0% | `src/components/admin/ThemeFontSizesPane.tsx`    |
|         47 |     2,08% |  **0%** |      0% | `src/components/admin/CoverImagePicker.tsx`      |
|         47 |    **0%** |  **0%** |      0% | `src/components/admin/ExpertLayoutPreview.tsx`   |
|         45 |    67,62% |  56,41% |  63,26% | `src/components/SearchOverlay.tsx`               |
|         44 |    71,79% |  37,50% |  57,94% | `src/components/NewsletterForm.tsx`              |
|         40 |    **0%** |  **0%** |      0% | `src/components/admin/ThemeBackgroundsPane.tsx`  |
|         39 |    **0%** |  **0%** |      0% | `src/components/cart/organisms/CartPanel.tsx`    |
|         38 |     5,00% |  **0%** |      0% | `src/components/Footer.tsx`                      |
|         36 |    34,54% |  45,45% |  19,23% | `src/components/TtsPlayer.tsx`                   |
|         33 |    23,25% |   8,33% |  12,50% | `src/components/RouteProgress.tsx`               |
|         33 |    **0%** |  **0%** |      0% | `src/components/admin/AppearanceBuilderPane.tsx` |

**Razem 1 655 z 2 305 = 71,8%.** **Czternaście** z tych dwudziestu plików ma **0% funkcji** - czyli
nie zostały wyrenderowane ani razu.

## 0.4 Dziewięćset martwych funkcji, z czego 798 anonimowych

Rozkład jest sam w sobie diagnozą: **102 nazwane + 798 anonimowych = 900**. Osiemdziesiąt
dziewięć procent to funkcje anonimowe, czyli **inline'owe handlery i callbacki w niewy-
renderowanych komponentach React**. To znaczy, że luki nie domkniesz testem jednostkowym
pomocnika - trzeba **wyrenderować komponent i kliknąć**.

Cztery pliki z sześcioma i więcej martwymi funkcjami NAZWANYMI:

| plik                            | martwych nazwanych | które                                                                                                                                                                                                                                                |
| ------------------------------- | -----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin/GlobalColorsEditor.tsx`  |                 12 | `useLocalStorageState` `:60`, `isHexColor` `:80`, `SidebarStylePicker` `:110`, `GlobalColorsEditor` `:221`, `ColorRow` `:572`, `bumpFontSize` `:691`, `TypographyRow` `:701`, `FormatRow` `:791`, `BrandPaletteEditor` `:882`, `getColor` `:997` + 2 |
| `admin/PostSettingsMetabox.tsx` |                  8 | `PostSettingsMetabox` `:89`, `TocTab` `:219`, `HeadingCounter` `:424`, `TakeawaysTab` `:497`, `TakeawaysPreviewCard` `:693`, `TakeawayRow` `:752`, `PanelHead` `:821`, `RowOverride` `:848`                                                          |
| `ConsentScriptInjector.tsx`     |                  7 | `removeMarked` `:24`, `injectExternalScript` `:31`, `injectInlineScript` `:45`, `injectCustomHtml` `:58`, `loadAnalytics` `:76`, `loadMarketing` `:120`, `ConsentScriptInjector` `:158`                                                              |
| `admin/AdminShell.tsx`          |                  6 | `SidebarTooltip` `:168`, `groupContainsPath` `:192`, `AdminNavRow` `:210`, `AdminShell` `:269`, `AdminShellInner` `:283`, `SidebarBrand` `:620`                                                                                                      |

## 0.5 Dwadzieścia siedem zer

Razem **729 linii i 290 funkcji** - czyli 31,6% luki w liniach i 32,2% w funkcjach na
12,2% plików. Najwięksi:

|                     linii |     fn | plik                              |
| ------------------------: | -----: | --------------------------------- |
|                       195 | **96** | `admin/TrendingTickerPane.tsx`    |
|                        67 |     23 | `admin/AccessSettingsPane.tsx`    |
|                        47 |     19 | `admin/ExpertLayoutPreview.tsx`   |
|                        40 |     17 | `admin/ThemeBackgroundsPane.tsx`  |
|                        39 |     10 | `cart/organisms/CartPanel.tsx`    |
|                        33 |      9 | `admin/AppearanceBuilderPane.tsx` |
|                        30 |     10 | `admin/CustomFontUploader.tsx`    |
|                        30 |     15 | `admin/FooterChromePane.tsx`      |
|                        27 |     11 | `admin/RelatedLayoutPreview.tsx`  |
|                        25 |     10 | `AppDialogHost.tsx`               |
|                        25 |      6 | `admin/PageParentSelect.tsx`      |
| + 16 plików po 1-21 linii |        |                                   |

**Cały koszyk jest na zerze**: `cart/organisms/CartPanel.tsx` (39 linii, 10 fn),
`cart/atoms/AddToCartButton.tsx` (10, 2), `cart/molecules/CartLine.tsx` (1, 1). To jedyne
trzy pliki koszyka w tej powierzchni i **żaden nie został wyrenderowany**.

## 0.6 Czego NIE ma sensu ruszać

- **Warstwy atomów i molekuł** (§0.2) - 61 plików, 159 linii luki. Nie tam jest problem.
- **`__root.tsx`** - jest w powierzchni `Routing` modułu 20 i ma własne zlecenie
  (`docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md`, punkty A1 i B1: bezwarunkowe `describe.skip`
  na `RootComponent`). Ale **wiedz, że dopóki tam stoi, część tej powierzchni jest
  nieosiągalna** - `ConsentScriptInjector` jest montowany właśnie w `__root.tsx:717`.
- **Ogona 650 linii** rozłożonego po dwustu plikach po kilka linii.

---

# CZĘŚĆ A - DEFEKTY (P1)

## A1. Egzekucja zgody na skrypty: 1,20% linii, 0% funkcji, 0% GAŁĘZI i zero testów

**Pozycja blokująca.**

`src/components/ConsentScriptInjector.tsx` (198 linii) to **techniczna egzekucja zgody
RODO**: czyta `site_settings["analytics"]` i `["marketing"]`, wstrzykuje skrypty **wyłącznie
gdy `useEffectiveConsent()` daje zgodę**, i - to jest druga połowa kontraktu - **usuwa je po
cofnięciu zgody** (nagłówek `:1-7`).

Pomiar: **1,20% linii (82 niepokryte), 0/7 funkcji, 0% gałęzi.** Martwe wszystkie siedem:
`removeMarked` (`:24`), `injectExternalScript` (`:31`), `injectInlineScript` (`:45`),
`injectCustomHtml` (`:58`), `loadAnalytics` (`:76`), `loadMarketing` (`:120`),
`ConsentScriptInjector` (`:158`).

**Nie ma na to ani jednego testu.** Dwa pliki testowe wymieniają tę nazwę
(`src/lib/analytics/__tests__/footerTracking.test.ts`,
`src/routes/__tests__/adminSettingsAnalyticsRoute.test.tsx:3`, `:819`, `:971`) - **wyłącznie
w komentarzach**. Żaden go nie importuje ani nie renderuje. Komponent jest montowany
w `src/routes/__root.tsx:717`, czyli w pliku, który sam ma 14,58% funkcji i jedyne
w repozytorium bezwarunkowe `describe.skip`.

Cztery kontrakty do przypięcia:

**1. Brak zgody = brak skryptu.** `useEffect` (`:166-179`) wstrzykuje analitykę tylko przy
`categories.analytics`, marketing (`:181-194`) tylko przy `categories.marketing`, i **oba
wychodzą wcześniej przy `!mounted`** - to jest zabezpieczenie SSR: nic nie ładuje się przed
zamontowaniem klienta. Test: `mounted: false` → **zero węzłów** w `document.head`;
`categories.analytics: false` → zero, mimo poprawnej konfiguracji w `site_settings`.

**2. Cofnięcie zgody usuwa to, co wstrzyknięto.** Sprzątanie idzie po atrybucie
`data-consent-owner` (`MARK_ATTR`, `:22`) przez `removeMarked` (`:24-29`). Test: zgoda →
skrypty są; cofnięcie zgody → **`document.querySelectorAll('[data-consent-owner]')` jest
puste**. To jest ta połowa, której naruszenie jest naruszeniem RODO, a nie usterką UI.

**3. `injectCustomHtml` wykonuje dowolny HTML administratora, łącznie ze skryptami.**
Funkcja (`:58-70`) wkleja HTML do ukrytego kontenera i **odtwarza węzły `<script>`, żeby
przeglądarka je wykonała**, bo inaczej wklejone piksele nie działają. Komentarz `:52-56`
mówi wprost: _„Do NOT expose to untrusted users - only admins can edit site_settings."_
Test ma **przypiąć oba brzegi**: skrypt z wklejki faktycznie się wykonuje ORAZ każdy
wstrzyknięty węzeł ma `data-consent-owner`, czyli **da się go posprzątać**. Węzeł bez
znacznika to węzeł, który przeżyje cofnięcie zgody.

**4. Zmiana konfiguracji przeładowuje skrypty.** Zależności obu efektów to
`[mounted, categories.X, JSON.stringify(config)]` (`:179`, `:194`) - z wyłączonym
`react-hooks/exhaustive-deps`. Test: zmiana identyfikatora w konfiguracji → stary węzeł
znika, nowy się pojawia (a nie: dwa naraz).

**Kryterium odbioru:** `ConsentScriptInjector.tsx` z **1,20% na ≥ 85% linii i z 0% na ≥ 80%
gałęzi**, wszystkie siedem funkcji wywołanych, cztery kontrakty wyżej z osobnymi asercjami,
**próg per-ścieżka** z pomiarem i datą. **W teście żadnego prawdziwego identyfikatora
analitycznego ani prawdziwego skryptu z sieci** - atrapy `src` i wyłącznie `example.com`.

---

## A2. Trzy pliki bez ani jednego renderu, po sto kilkadziesiąt linii każdy

| plik                           | brak linii |  linie |  funkcje | co to jest                                                       |
| ------------------------------ | ---------: | -----: | -------: | ---------------------------------------------------------------- |
| `admin/GlobalColorsEditor.tsx` |    **277** |  2,12% | **0/12** | edytor kolorów globalnych całego serwisu                         |
| `admin/TrendingTickerPane.tsx` |    **195** | **0%** | **0/96** | pasek „na czasie" na stronie głównej                             |
| `Header.tsx`                   |    **178** |  1,65% |   **0%** | **nagłówek publiczny, 558 linii, renderowany na KAŻDEJ stronie** |

**650 niepokrytych linii w trzech plikach = 28,2% całej luki.**

`Header.tsx` jest najgroźniejszy z tej trójki nie dlatego, że jest największy, tylko dlatego,
że jest **wszędzie**: 558 linii, 1,65% pokrycia linii i **zero pokrytych funkcji**. Dwa pliki
testowe go dotykają (`components/__tests__/siteChromePersistence.test.tsx`,
`admin/builder/__tests__/builderShell.test.tsx`), ale żaden nie renderuje jego drzewa -
stąd zero funkcji.

`TrendingTickerPane.tsx` ma **96 funkcji i ani jednego wywołania** - to najgęstszy pojedynczy
plik zerowy w całej powierzchni.

`GlobalColorsEditor.tsx` ma 12 martwych funkcji nazwanych, w tym dwie **czyste i trywialne
do przetestowania od ręki**: `isHexColor` (`:80`) i `bumpFontSize` (`:691`). Zacznij od nich -
to jest pięć minut i natychmiast zdejmuje zero z licznika funkcji.

Zadanie: po jednym teście renderu na plik, ze **stanem pustym, stanem z danymi i stanem
błędu** - te trzy gałęzie są w każdym z nich i żadna nie jest dziś wykonana. Dla `Header.tsx`
dołóż wariant **zalogowany / niezalogowany** i **PL / EN**, bo to są dwa najczęściej
przełączane stany powłoki publicznej.

**Kryterium odbioru:** trzy pliki z ≥ 60% linii każdy; `Header.tsx` z **0% na ≥ 70% funkcji**;
`isHexColor` i `bumpFontSize` pokryte testem jednostkowym.

---

## A3. Cały koszyk jest na zerze - trzy pliki, dziesięć funkcji, zero renderów

`cart/organisms/CartPanel.tsx` (39 linii, **0/10 funkcji**), `cart/atoms/AddToCartButton.tsx`
(10 linii, **0/2**), `cart/molecules/CartLine.tsx` (1 linia, **0/1**). To wszystkie pliki
koszyka w tej powierzchni i **żaden nie został wyrenderowany ani razu**.

Jedyny test, który wymienia te nazwy, to
`src/components/community/__tests__/EventTicketPurchase.test.tsx` - testuje zakup biletu,
nie koszyk.

To jest **ścieżka pieniędzy w warstwie prezentacji**: dodanie do koszyka, wiersz pozycji,
panel podsumowania. Test: dodanie pozycji → wiersz się pojawia; zmiana ilości → suma się
przelicza; **pusty koszyk** → stan pusty, nie awaria; usunięcie ostatniej pozycji → powrót
do stanu pustego.

**Kryterium odbioru:** trzy pliki powyżej zera, `CartPanel.tsx` z ≥ 70% linii, suma koszyka
przypięta asercją na wartość, nie na obecność węzła.

---

## A4. Powłoka panelu: `AdminShell` na 4,39% linii i 5,40% funkcji

`src/components/admin/AdminShell.tsx` - **87 niepokrytych linii, 4,39% linii, 5,40% funkcji,
18,99% gałęzi**. Sześć martwych nazwanych: `SidebarTooltip` (`:168`), `groupContainsPath`
(`:192`), `AdminNavRow` (`:210`), `AdminShell` (`:269`), `AdminShellInner` (`:283`),
`SidebarBrand` (`:620`).

To jest rama, w której renderuje się **cały panel administracyjny**. `groupContainsPath`
(`:192`) jest funkcją **czystą** i decyduje, która grupa nawigacji jest rozwinięta dla
bieżącej ścieżki - najtańszy test w tym pliku i jednocześnie ten, którego awaria jest
najbardziej widoczna dla redakcji (menu składa się na złej pozycji).

Zadanie: `groupContainsPath` tabelarycznie (ścieżka dokładna, ścieżka zagnieżdżona, ścieżka
sąsiednia z tym samym prefiksem - klasyczny błąd `startsWith`), potem render `AdminShellInner`
w trzech stanach: sidebar rozwinięty, zwinięty, mobilny.

**Kryterium odbioru:** `AdminShell.tsx` z 5,40% na **≥ 60% funkcji**; `groupContainsPath`
z testem tabelarycznym obejmującym przypadek prefiksu.

---

## A5. Osiem paneli wyglądu i ustawień - jeden wzorzec, osiem plików

| plik                             | brak |  linie | funkcje |
| -------------------------------- | ---: | -----: | ------: |
| `admin/ThemeOptionsPane.tsx`     |  125 | 34,89% |  14,28% |
| `admin/AudioPicker.tsx`          |   92 |  4,16% |  **0%** |
| `admin/PostSettingsMetabox.tsx`  |   84 |  5,61% |  **0%** |
| `admin/AccessSettingsPane.tsx`   |   67 | **0%** |  **0%** |
| `admin/ThemeFontSizesPane.tsx`   |   66 |  1,49% |  **0%** |
| `admin/CoverImagePicker.tsx`     |   47 |  2,08% |  **0%** |
| `admin/ExpertLayoutPreview.tsx`  |   47 | **0%** |  **0%** |
| `admin/ThemeBackgroundsPane.tsx` |   40 | **0%** |  **0%** |

**568 niepokrytych linii = 24,6% luki**, a wszystkie osiem to ten sam kształt: panel czyta
`site_settings`, pokazuje formularz, zapisuje. **Siedem z ośmiu ma 0% funkcji.**

Nie pisz ośmiu niezależnych suit. Zrób **jeden wspólny harness** („zamontuj panel z atrapą
`useSiteSetting` i atrapą zapisu") i przepuść przez niego wszystkie osiem, z trzema
przypadkami na każdy: **wartości domyślne**, **wartości zapisane**, **błąd zapisu**.
`PostSettingsMetabox.tsx` ma dodatkowo osiem martwych funkcji nazwanych (`TocTab` `:219`,
`HeadingCounter` `:424`, `TakeawaysTab` `:497`, …) i zasługuje na osobne przypadki na
zakładki.

**Kryterium odbioru:** osiem paneli razem z ≥ 55% linii; **żaden z 0% funkcji**; harness
w jednym pliku pomocniczym, nie skopiowany osiem razy.

---

# CZĘŚĆ B - PROGI

## B1. Sto pięćdziesiąt cztery pliki bez żadnego progu - i nie ma globa, który by je łapał

Sprawdzone dla wszystkich 221 plików powierzchni:

- **próg jawny per plik: 1** (`src/components/LoginPopup.tsx`)
- **złapany globem: 66**
- **BEZ ŻADNEGO PROGU: 154**

Przyczyna jest strukturalna i warto ją nazwać wprost: **w `vitest.config.ts` nie ma ani globa
`"src/components/**"`, ani `"src/components/admin/**"`** (sprawdzone: zero wystąpień). Każdy
istniejący glob celuje w **podkatalog** - `admin/builder/**` (95/93), `admin/clubs/**`
(99/99), `admin/events/**` (88/86), `admin/billing/**` (97/96), `admin/seo/**` (98/98)
i dwadzieścia kilka innych. Pliki leżące **bezpośrednio** w `src/components/admin/` i
`src/components/` nie należą do żadnego z nich.

A to są dokładnie te pliki, które niosą **87,5% luki** (§0.2). Czyli: zapadka pilnuje
podkatalogów, które i tak stoją na 85-100%, i nie pilnuje niczego tam, gdzie pokrycie wynosi
zero.

Zadanie:

1. **Próg jawny per plik** na każdy plik, który w tym zleceniu ruszasz - „zmierzone minus
   ~2 pp", z komentarzem podającym pomiar i datę, tak jak istniejące wpisy.
2. **Rozstrzygnij i podaj wynik**: czy dołożyć glob `"src/components/admin/**"` na poziomie
   zmierzonym dziś (czyli nisko, jako podłogę anty-regresyjną), czy zostawić progi jawne na
   plikach. Podaj liczbę: ile plików objąłby taki glob i jaka byłaby jego dzisiejsza wartość.
   **Nie dodawaj go bez tej liczby** - glob z podłogą wziętą z sufitu jest gorszy niż jego brak.
3. Zwróć uwagę, że repozytorium **ma już wzorzec uczciwego progu na słabym obszarze**:
   `admin/versions/**` stoi na `lines: 7`, `admin/workflows/**` na `45`,
   `admin/post-editor/molecules/**` na `23`. Niska podłoga zapisana świadomie jest lepsza niż
   brak podłogi - i to jest argument za punktem 2.

---

# JAK MIERZYĆ

**Pomiar wyjściowy jest w repozytorium:** `coverage-ed9/coverage-summary.json` (pokrycie per
plik) i `coverage-ed9-final/coverage-final.json` (`fnMap` + licznik `f` = nazwy funkcji bez
wywołania).

Mierz na katalogach, nie na całej suicie (pełny przebieg ~36 minut). Reporter `json` nie jest
w konfiguracji:

```bash
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=json-summary \
  src/components/__tests__ src/components/admin/__tests__ src/components/cart
```

**Licz LUKĘ, nie procent.** Kryterium sukcesu to `2 305 → poniżej 1 100` niepokrytych linii
i `900 → poniżej 450` niewywołanych funkcji. Podaj obie liczby przed i po.

**Stan wyjściowy CI:** `check:ci-gates` jest **czerwona** (ratchet tekstu jednojęzycznego,
`src/routes/admin.analytics.index.tsx:387`) - **to nie jest twoja czerwień**. Suita jest
czerwona w **ośmiu plikach (272 testy)**, przyczyny w rozdz. 12.2 i w
`docs/PROMPT_OSIEM_CZERWIENI.md`. **Jeden z tych ośmiu -
`src/routes/__tests__/adminSettingsRoutes.test.tsx` - dotyka tej powierzchni**, więc przed
startem odróżnij jego czerwień od swojej.

---

# ZASADY

**Pomiar przed i po**, tą samą metodą; przy rozbieżności zatrzymaj się i zgłoś.

**Testy.** Progi wolno **wyłącznie podnosić** („zmierzone minus ~2 pp" per plik, „minus ~4 pp"
per glob, z komentarzem: pomiar + data). **Nie wykluczaj plików z pomiaru** - żadnego
`exclude`, `all: true` zostaje. **Nie zmieniaj zachowania produkcyjnego, żeby test przeszedł** -
defekt → `it.fails` z opisem. **Nie regenerujesz snapshotu autoryzacji.** I reguła, która
w tej powierzchni decyduje o wyniku: **900 martwych funkcji to w 89% anonimowe handlery -
nie domkniesz ich testem jednostkowym pomocnika, tylko renderem i interakcją.** Test, który
montuje komponent i nic nie klika, podnosi linie i zostawia funkcje na zerze.

**Dane i bezpieczeństwo.** Żaden test nie wychodzi do sieci i nie zawiera prawdziwego
sekretu - w A1 dotyczy to również **identyfikatorów analitycznych i adresów skryptów**
(atrapy, `example.com`). RODO: żadnych prawdziwych danych osobowych w fixture'ach.

**Kod.** Bez `any` i `as any`. Zamiast „—" stosuj „-". i18n PL i EN - w tej powierzchni
dotyczy to zwłaszcza `Header.tsx` i `Footer.tsx` (wariant językowy jest osobnym przypadkiem
testowym, nie ozdobą). Atomic design: nowe komponenty w istniejącą hierarchię.

---

# CZEGO NIE ROBIĆ - pięć pułapek

1. **Nie ruszaj atomów i molekuł.** 61 plików, 159 linii luki (§0.2). Nazwa powierzchni myli.
2. **Nie odpinaj `describe.skip` w `rootShellRender.test.tsx`** - to punkt A1 zlecenia SSR
   i wymaga własnego pomiaru. Tutaj tylko wiedz, że przez niego `ConsentScriptInjector`
   jest nieosiągalny ze ścieżki korzenia.
3. **Nie pisz ośmiu osobnych suit na osiem paneli ustawień** (A5). Jeden harness, osiem
   wywołań.
4. **Nie dodawaj globa `src/components/admin/**` bez zmierzonej podłogi** (B1 punkt 2).
   Glob z liczbą wziętą z sufitu jest gorszy niż jego brak.
5. **Nie licz sukcesu procentem.** 58,4% → 62% brzmi jak postęp, a może oznaczać, że
   dołożyłeś testy do plików, które już były zielone. Liczy się **2 305 niepokrytych linii
   w dół**.

---

# DEFINICJA UKOŃCZENIA

1. **Niepokrytych linii z 2 305 na poniżej 1 100**, niewywołanych funkcji z 900 na poniżej
   450 - obie liczby podane przed i po, tą samą metodą.
2. **`ConsentScriptInjector.tsx` z 1,20% na ≥ 85% linii i z 0% na ≥ 80% gałęzi**, siedem
   funkcji wywołanych, cztery kontrakty zgody z osobnymi asercjami - w tym **cofnięcie zgody
   usuwa każdy wstrzyknięty węzeł** (A1).
3. **`GlobalColorsEditor.tsx`, `TrendingTickerPane.tsx` i `Header.tsx` z ≥ 60% linii każdy**,
   a `Header.tsx` z **0% na ≥ 70% funkcji** (A2).
4. **Trzy pliki koszyka powyżej zera**, suma przypięta asercją na wartość (A3).
5. **`AdminShell.tsx` z 5,40% na ≥ 60% funkcji**, `groupContainsPath` z testem tabelarycznym
   obejmującym przypadek wspólnego prefiksu (A4).
6. **Osiem paneli ustawień razem z ≥ 55% linii, żaden z 0% funkcji**, wspólny harness
   w jednym pliku (A5).
7. **Próg jawny per plik na każdy ruszany plik**; podana liczba plików i dzisiejsza wartość
   dla ewentualnego globa `src/components/admin/**` (B1).
8. **Cała powierzchnia z 58,39% na ≥ 75% linii i z 53,20% na ≥ 70% funkcji**, plików na
   zerze z 27 na **poniżej 10**.
9. **`bun run check:*` w komplecie zielone poza `check:ci-gates`**; suita czerwona
   w dokładnie ośmiu plikach, tych samych co przed startem.

**Na koniec zdaj raport:** co zmierzyłeś przed i po (liczba za liczbą, tą samą metodą), które
defekty zarejestrowałeś jako `it.fails` i dlaczego, czego świadomie nie zrobiłeś, oraz -
osobno - **które liczby z tego zlecenia okazały się nieaktualne**. Ta ostatnia lista jest dla
audytu najcenniejsza: wydanie 9 znalazło osiem własnych pomyłek i wszystkie przez sprawdzenie
liczby, nie przez jej przepisanie.

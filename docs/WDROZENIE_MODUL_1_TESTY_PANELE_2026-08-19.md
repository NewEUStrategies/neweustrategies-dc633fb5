# Moduł 1 „Wpisy: doświadczenie czytelnika": testy, atomic design i cztery panele (2026-08-19)

Zamknięcie pozycji **MODUŁ 1 — 31,81% linii · 26,93% funkcji** z audytu
`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`. Zlecenie właściciela produktu
podniosło przy tym trzy rzeczy do rangi wymagania: panel administracyjny JEST w zakresie
i ma dobić 90-95%, każde rozbicie idzie zgodnie z atomic design, a i18n jest częścią
definicji ukończenia, nie dodatkiem.

Stan wyjściowy: **74 pliki produkcyjne, 43 bez ani jednej wykonanej linii**, 19 plików
testowych, 321 przypadków. Cztery panele modułu stały na **zerze co do jednej funkcji**.

---

## 1. Dlaczego pokrycie tu nie ruszało

Nie z braku chęci - z kosztu wejścia, i był on policzalny w czterech miejscach.

1. **Panelami są PLIKI TRAS.** `admin.toc.tsx` (409 linii), `admin.key-takeaways.tsx` (547),
   `admin.post-layouts.tsx` (502), `admin.related-posts.tsx` (444). Panel wpisany w plik
   trasy nie ma jak dostać testu komponentowego bez postawienia routera, więc 1 902 linie
   formularzy stały nietknięte - łącznie z zapisem do wierszy współdzielonych przez cały
   obszar roboczy.
2. **Reguły mieszkały w JSX.** Przycięcie pól liczbowych, zakres poziomów nagłówka, dobór
   presetu układu, wagi silnika rekomendacji, kształt podglądu - żadnej z tych decyzji nie
   dało się sprawdzić bez wyrenderowania całego panelu razem z Supabase, react-query i i18n.
   W panelu układów wpisu siatka mieszkała dodatkowo w komponencie zadeklarowanym WEWNĄTRZ
   funkcji trasy: taki komponent powstaje od nowa przy każdym renderze, nie da się go
   zaimportować, a React gubi jego stan przy każdej zmianie nadrzędnej.
3. **Powtórzony JSX zamiast komponentów.** Piętnaście kopii nagłówka sekcji, dziesięć kopii
   pola liczbowego w trzech różnych zachowaniach, siedem list rozwijanych bez powiązanej
   etykiety, jedenaście przełączników zbudowanych z surowego `<button>`.
4. **Tekst dla czytelnika stał w mapach `COPY = { pl, en }`** wpisanych w komponenty. Żadna
   bramka tego nie widziała: to nie ternary po języku (którego szuka `check:i18n-hardcoded`)
   ani klucz (którego szuka `check:i18n-parity`), tylko obiekt.

---

## 2. Pomiar: przed i po, per funkcjonalność

Liczby „przed" pochodzą z audytu 2026-08-18. Liczby „po" - z pomiaru wykonanego na końcu tej
pracy: `vitest run --coverage`, provider v8, **mianownik zawężony do plików modułu 1**
(`--coverage.include` z reguł ścieżkowych audytu plus trzy katalogi dołożone tą pracą, patrz
rozdział 11), numerator z **83 plików testowych** dotykających modułu (1 617 przypadków,
wszystkie zielone).

DLACZEGO NIE PEŁNA SUITA: 39 plików testowych zawiesza się w tym sandboksie (audyt, rozdział
9.2) i pełny przebieg z pokryciem nie kończy się tutaj. Numerator jest więc DOLNYM
ograniczeniem - testy spoza tej listy też wykonują pliki modułu, ale nie mogą go zmniejszyć.

### 2.1 Agregat modułu

| Metryka    |  Przed |         Po | Próg z definicji ukończenia |
| ---------- | -----: | ---------: | --------------------------: |
| linie      | 31,81% | **81,43%** |                     ≥ 65% ✔ |
| instrukcje | 31,81% | **79,89%** |                           — |
| funkcje    | 26,93% | **80,94%** |                     ≥ 60% ✔ |
| gałęzie    | 32,90% | **71,47%** |                           — |

Plików: **74 → 122** (48 nowych z wyprowadzenia reguł, atomów i paneli).
Plików bez ani jednej wykonanej linii: **43 → 16**, a te 16 to:

- **4 pliki tras panelowych** - BY DESIGN: zostały w nich wyłącznie `createFileRoute`
  i kompozycja organizmu, a organizm ma własny test na 100%;
- **2 publiczne trasy wpisu** (`post.$slug`, `preview.$token`) - jawnie poza zakresem;
- `api/tts`, `api/stt`, `api/public/related-click` - trasy redakcyjne i beacon, poza
  definicją ukończenia;
- `author/AuthorCvSections`, `author/CvPrintSheet`, `hooks/usePasswordUnlock`,
  `hooks/useUnlockedContent`, `hooks/useRecommendedPosts`, `lib/audio/ttsRenditions`,
  `lib/relatedInsights.functions` - powierzchnie nieobjęte tym zleceniem.

**Żaden plik `components/post/**` ani `components/audio/**` nie stoi na zerze.**

### 2.2 Per funkcjonalność

| Funkcjonalność                     | Linie przed |    Linie po |     Próg |
| ---------------------------------- | ----------: | ----------: | -------: |
| Audio wpisu (TTS)                  |       11,4% |   **78,2%** |  ≥ 60% ✔ |
| Układy wpisu + render              |       19,0% |   **89,0%** |  ≥ 55% ✔ |
| Licznik odsłon / zapisane artykuły |       25,7% |  **100,0%** |        — |
| Powiązane wpisy / rekomendacje     |       50,3% |   **87,7%** |        — |
| Paywall / bramka dostępu           |       71,7% |   **79,4%** |        — |
| Spis treści (TOC) + przypisy       |       87,3% | **83,1%**\* |        — |
| Key takeaways + cytowania          |       88,8% |   **99,4%** |        — |
| PANELE (`admin/postExperience`)    | nie istniał |  **100,0%** | 90-95% ✔ |

\* TOC „spadł" wyłącznie przez zmianę mianownika: doszedł `lib/toc/panelRules.ts` (100%),
ale też `lib/toc/manualItems.ts`, którego audyt nie liczył w tej grupie. Sam
`lib/toc/settings.ts` poszedł z 51,2% na 100%.

### 2.3 Per plik

| Powierzchnia                                             |               Przed |                                         Po |
| -------------------------------------------------------- | ------------------: | -----------------------------------------: |
| `lib/post/glossaryHighlight.ts`                          |       nie istniał\* |                        **100% linii i fn** |
| `lib/toc/settings.ts`                                    |        51,2% · 1/10 |                        **100% linii i fn** |
| `lib/keyTakeaways/settings.ts`                           |          0,0% · 0/5 |                        **100% linii i fn** |
| `lib/relatedPosts/adminConfig.ts`                        |          0,0% · 0/8 |                        **100% linii i fn** |
| `hooks/usePostLayoutSettings.ts`                         |          0,0% · 0/8 |                        **100% linii i fn** |
| `lib/relatedPosts.ts` (`buildIdf`)                       |               60,6% |                             **100% linii** |
| `hooks/useBookmarks.ts`                                  |          0,0% · 0/2 |                             **100% linii** |
| `hooks/useSaveArticle.ts`                                |              częśc. |                             **100% linii** |
| `lib/relatedClickBeacon.ts`                              |                0,0% |                             **100% linii** |
| `routes/api/public/post-tts.ts`                          |         0,0% · 0 fn |                            **95,4% linii** |
| `lib/audio/global-player.tsx`                            | 4,8% · 12/247 linii |                             **100% linii** |
| `components/post/**`                                     |    21 z 26 na ZERZE | **84,5% linii · 72,3% fn · ZERO na zerze** |
| `components/audio/**`                                    |      4 z 4 na ZERZE | **64,5% linii · 48,8% fn · ZERO na zerze** |
| `components/admin/postExperience/**`                     |         nie istniał |           **100% we wszystkich metrykach** |
| `lib/{toc,keyTakeaways,relatedPosts,post}/panelRules.ts` |        nie istniały |           **100% we wszystkich metrykach** |
| `lib/admin/panelDraft.ts`                                |         nie istniał |           **100% we wszystkich metrykach** |

\* Reguła podświetlania glosariusza stała wcześniej w `components/post/GlossaryHighlighter.tsx`
(91 linii, **0%**) - to ona chodzi po węzłach tekstowych opublikowanego artykułu.

Pliki tras zeszły do samej rejestracji:

| Trasa                     | Przed |  Po |
| ------------------------- | ----: | --: |
| `admin.toc.tsx`           |   409 |  13 |
| `admin.key-takeaways.tsx` |   547 |  11 |
| `admin.post-layouts.tsx`  |   502 |  11 |
| `admin.related-posts.tsx` |   444 |  17 |

**Testy:** 34 pliki testowe (nowe i rozszerzone), **1 037 przypadków, 2 187 asercji**,
gęstość **2,11 asercji na przypadek** (wymagane ≥ 2). Cały zestaw 83 plików dotykających
modułu: **1 617 przypadków, wszystkie zielone**.

---

## 3. Atomic design: co scaliły atomy

Podział istnieje teraz w trzech miejscach: `components/post/{atoms}`,
`components/audio/{atoms}` i `components/admin/postExperience/{atoms,molecules,organisms}`.
Kolumna „scalił" jest tu ważniejsza od nazwy: atom, który nie usuwa kopii, nie zarabia na
swoje istnienie.

### 3.1 Atomy paneli administracyjnych

| Atom                   | Scalił                                                                       | Co NAPRAWIŁ                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PanelSectionHeading`  | 15 kopii nagłówka sekcji w trzech odmianach wizualnych                       | część kopii renderowała `<Label>`, czyli `<label>` BEZ kontrolki - taki nagłówek nie istnieje w spisie nagłówków strony                            |
| `SelectableOptionCard` | 4 kopie przycisku wyboru opcji (kolumny ToC, warianty sekcji, ikony, układy) | tylko DWIE ogłaszały `aria-pressed`; siatka dwunastu ikon i trzy karty wariantu nie miały go wcale                                                 |
| `PanelNumberField`     | 10 kopii pola liczbowego                                                     | trzy różne zachowania: z przycięciem, BEZ przycięcia (`parseInt(v \|\| "0")` - dało się wpisać 999 w pole z `max=20`) i ręczne `Math.min/Math.max` |
| `PanelRangeField`      | 15 suwaków z 4 kopii kodu                                                    | jedna kopia wpisywała WARTOŚĆ w tekst etykiety, więc nazwa kontrolki zmieniała się przy każdym ruchu suwaka                                        |
| `PanelSelectField`     | 7 list rozwijanych                                                           | etykieta stała OBOK kontrolki; Radix daje `role="combobox"`, więc czytnik ekranu ogłaszał samą wartość („H3")                                      |
| `PanelTextField`       | 6 kopii pary etykieta+pole                                                   | ŻADNA nie wiązała ich przez `htmlFor`                                                                                                              |
| `PanelColorField`      | 3 kopie pary podpis+selektor barwy                                           | każda inaczej radziła sobie z brakiem wartości z selektora                                                                                         |

Do tego **`SettingToggle`** (atom, który już istniał) przejął 7 ręcznie budowanych
przełączników, w tym jedenaście z panelu układów wpisu zbudowanych z surowego `<button>`
bez `role="switch"`, bez `aria-checked` i bez nazwy.

### 3.2 Molekuły współdzielone

| Molekuła          | Scaliła                               | Co ujednoliciła                                                                                                                                                                                                              |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PanelSaveBar`    | 4 różne umowy na ten sam pasek zapisu | ToC wyłączał oba przyciski bez zmian; sekcja „dowiesz się" miała reset CZYNNY zawsze; rekomendacje nie sprawdzały zmian wcale; układy wpisu miały surowy `<button>` bez stanu wyłączonego (podwójne kliknięcie = dwa zapisy) |
| `PreviewLangTabs` | 2 kopie przełącznika języka podglądu  | emoji flag usunięte (flaga państwa nie jest nazwą języka), lista zakładek dostała nazwę grupy                                                                                                                                |

`PanelSaveBar` dostał DWIE osobne flagi (`canSave`, `canReset`), bo „zapisz" pyta o różnicę
wobec bazy, a „przywróć domyślne" - wobec wartości domyślnych. To dwa różne pytania i panele
odpowiadały na nie na trzy różne sposoby.

### 3.3 Atomy ścieżki czytelnika

| Atom                  | Scalił                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- |
| `ArticleActionButton` | 2 identyczne łańcuchy klas przycisku akcji artykułu (odzyskany `disabled:opacity-60`) |
| `PostIconButton`      | 3 kopie przycisku ikonowego paska cytatu                                              |
| `CategoryPill`        | odznakę kategorii z kontrastem etykiety liczonym regułą                               |
| `MetaValueItem`       | 2 warianty pozycji metadanych o ROZJECHANYCH kontraktach a11y                         |
| `SectionEyebrow`      | 3 kopie nadtytułu sekcji (`as` decyduje o semantyce)                                  |
| `AudioIconButton`     | 8 kopii przycisku ikonowego odtwarzacza                                               |

---

## 4. Reguły wyprowadzone z JSX

Zasada z refaktoru czatu, zastosowana bez wyjątku: **funkcja pomocnicza zwraca deskryptor
albo KLUCZ i18n, nigdy gotowy tekst**, a w organizmie nie zostaje żadna reguła.

| Moduł                                              | Co wyniósł                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `lib/post/glossaryHighlight.ts`                    | chodzenie po węzłach tekstowych artykułu: `markFirstOccurrences`, `unmarkAll`, katalog pomijanych rodziców                   |
| `lib/admin/panelDraft.ts`                          | `draftDirty`, `clampNumber` (jedno przycięcie zamiast trzech), `toggleIndex`                                                 |
| `lib/toc/panelRules.ts`                            | deskryptory kolumn, zakres poziomów nagłówka, pola koloru, styl i klasy podglądu                                             |
| `lib/keyTakeaways/panelRules.ts`                   | warianty wizualne, siatka ikon z regułą dopasowania zapisu (`Search` / `search` / `bookopen`), słowa etykiety, 11 pól koloru |
| `lib/relatedPosts/panelRules.ts`                   | listy pozycji, układów, kolumn i źródeł doboru, 7 wag z JEDNEJ listy deskryptorów, mapa przyczyn nieudanego zapisu na klucze |
| `lib/post/layoutPanelRules.ts`                     | 4 grupy formatów, wybór presetu, ŁATA wariantu z sidebarem, 12 wierszy typografii, podsumowanie presetu                      |
| `lib/post/badgeContrast.ts`                        | `pickTextColor` - kontrast etykiety kategorii (WCAG)                                                                         |
| `lib/post/quoteSelection.ts`                       | normalizacja zaznaczenia, limity długości, treść udostępnienia i pozycja paska                                               |
| `lib/post/autoLoadChain.ts`                        | warunki doładowania kolejnego wpisu, kursor, limit łańcucha                                                                  |
| `lib/audio/{positionMemory,blobCache,ttsStage}.ts` | pamięć pozycji per wpis i język, cache blobów z wstrzykiwalnym zwalniaczem, etykiety etapów syntezy                          |

---

## 5. Defekty wykryte testami

Każdy naprawiony OSOBNYM commitem, po uprzednim przypięciu stanu faktycznego testem.

| #   | Defekt                                                                                                                      | Skutek dla użytkownika                                                                         | Commit    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------- |
| 1   | `useSaveArticle`: `writeStoredValue` sam łyka wyjątek, więc `catch` wokół niego był KODEM MARTWYM i wykonanie leciało dalej | w trybie prywatnym przycisk ogłaszał zapis, którego nie było                                   | `381dbba` |
| 2   | `sanitizeFilename` gubił „ł": `normalize("NFKD")` nie rozkłada U+0142                                                       | „Małe firmy" → `Mae-firmy`, „Łódź" → `odz` w nazwie pobranego MP3                              | `396c424` |
| 3   | `WeightSlider`: `aria-labelledby` na KORZENIU Radiksa, a `role="slider"` na uchwycie                                        | czytnik ekranu ogłaszał „suwak, 4" bez nazwy sygnału                                           | `d387443` |
| 4   | „Przywróć domyślne" wyłączane warunkiem zapisu                                                                              | przy zapisanym wierszu różnym od domyślnych przycisk był MARTWY                                | `d387443` |
| 5   | Cztery identyczne nazwy dostępne opcji układu na jednej stronie                                                             | nie było słychać, którego formatu wpisu dotyczy wybór                                          | `d387443` |
| 6   | `clampNumber` liczył miejsca po przecinku ze znaków po kropce, a `String(1e-7)` to `"1e-7"`                                 | krok w zapisie wykładniczym zaokrąglałby się do całych                                         | `d387443` |
| 7   | Panel układów porównywał szkic z ŻYWYM wynikiem react-query                                                                 | odświeżenie w tle gasiło „niezapisane zmiany" w trakcie edycji                                 | `c516054` |
| 8   | Komunikat nieudanej syntezy sklejał OBA języki w jedno zdanie                                                               | każdy czytelnik dostawał połowę zdania w obcym języku                                          | `c1600ef` |
| 9   | Warstwy zapisu ToC i sekcji „dowiesz się" miały polskie toasty w kodzie                                                     | administrator z interfejsem EN dostawał po zapisie zdanie po polsku                            | `c1600ef` |
| 10  | Odmowa autoplay przy PIERWSZYM załadowaniu wpadała do tego samego `catch` co padnięta sieć                                  | na iOS/Safari pierwszy dotyk „odsłuchaj" kończył się komunikatem o błędzie przy SPRAWNYM audio | `9db3c5d` |

**PRZYPIĘTE, NIENAPRAWIONE** (opisane testem, świadomie poza zakresem tej zmiany):
`PostOverlayMeta` z niepoprawną datą publikacji rysuje etykietę „Opublikowano:" BEZ wartości -
`formatDate` zwraca pusty łańcuch zamiast rzucić, więc gałąź `catch` z surową datą jest kodem
martwym.

---

## 6. i18n

Nowe słowniki i rozszerzenia, wszystkie z parytetem PL/EN:

| Słownik                                | Co przyjął                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `i18n-admin-extras.ts` (`admin.toc.*`) | 24 klucze panelu spisu treści - nazwy układów, kolumn, 7 kolorów, przykładowe nagłówki |
| `i18n-admin-post-panes.ts`             | 55 kluczy panelu sekcji „dowiesz się" (panel miał 31 rozgałęzień `isPL ? … : …`)       |
| `i18n-admin-layouts.ts`                | 19 kluczy panelu układów - nagłówki grup, punkty przełamania, proporcja obrazu         |
| `i18n-tts-player.ts`                   | 45 kluczy odtwarzacza z trzech map `COPY`                                              |
| `i18n-post-experience.ts` (nowy)       | 21 kluczy paska cytatu, cytowania, dossier, opinii i akcji pobrania                    |

Dwie rzeczy warte zapamiętania:

- **Słownik etapów syntezy stał w DWÓCH kopiach** (dolny pasek i karta w sidebarze), a osiem
  napisów transportu w kolejnych dwóch. Kopie mogły się rozejść bez żadnego sygnału - teraz
  jest jedna sekcja `ttsPlayer.stage.*` i jedna `ttsPlayer.transport.*`.
- **Napisy idą w języku ARTYKUŁU, nie interfejsu** (jawne `{ lng: lang }`): audio jest
  w języku treści, a cytowanie dotyczy TEJ analizy. Atrapa i18n w testach echuje parametry,
  więc asercje pokazują to wymuszenie wprost (`…download(lng=en)`).

Bramki `check:i18n-parity`, `check:i18n-hardcoded`, `check:i18n-default-value`
i `check:i18n-overlay-imports` zielone. Główny licznik `untranslated` bez zmian (**130**).
Licznik `repoWide.untranslated` podniósł się o JEDEN (460 → 461): „Dossier" brzmi identycznie
w PL i EN i tak samo stało w obu gałęziach mapy `COPY` - dopiero jako klucz w słowniku jest
dla bramki widoczne. To widoczność, nie regresja.

**LUKA W BRAMCE, znaleziona przy okazji:** `check:i18n-hardcoded` nie widzi zmiennej `isPL`
(wielka druga litera) - jej wzorzec zna `isPl`. Przez tę lukę panel sekcji „dowiesz się"
przewiózł 31 dwujęzycznych literałów. Panel jest już czysty; rozszerzenie wzorca dotknęłoby
6 plików spoza tego modułu (76 wystąpień) i należy do osobnej zmiany.

---

## 7. Pułapki narzędziowe, udokumentowane w testach

Każda kosztowała czas i każda jest opisana w pliku, w którym może wrócić.

1. **Fabryka `vi.mock("react-i18next")` NIE MOŻE importować fixture'ów obszaru.** Fixture'y
   sięgały warstwy ustawień, ta wspólnych toastów panelu, a te `lib/i18n` - czyli wracamy do
   mockowanego modułu i cykl inicjalizacji się domyka. Vitest nie zgłasza wtedy błędu, tylko
   **stoi do timeoutu**. Atrapa mieszka w `src/test/i18nStub.ts` - module BEZ ANI JEDNEGO
   importu z produkcji.
2. **Radix Select nie otwiera listy w happy-dom** (brak `hasPointerCapture` i pomiarów
   układu). Prymityw schodzi do natywnego `<select>` atrapą na granicy modułu; nowa atrapa
   PRZENOSI `disabled` na `<option>`, inaczej reguła granic poziomu nagłówka nie miałaby jak
   być sprawdzona przez interfejs.
3. **Radix Tabs przełącza na `mousedown`, nie na `click`.**
4. **`fireEvent.change` wchodzi wprost do Reacta**, omijając blokadę wyłączonego pola - nie
   da się nim DOWIEŚĆ, że wpis nie przechodzi. Dowodem jest sam atrybut `disabled`.
5. **`setQueryData` nie znaczy „świeże"** - react-query i tak odpala odświeżenie, więc test
   zapisu musi odsiać łańcuch odczytu od łańcucha `upsert`.
6. **Atrapa `IntersectionObserver` musi pomijać obserwatory po `disconnect`**, inaczej
   odtwarza stare domknięcia.
7. **`localStorage` nie da się przechwycić pod happy-dom** (Proxy); wstrzykuj magazyn na
   granicy modułu albo podmień go przez `Object.defineProperty`.

---

## 8. Bundle: zmierzony koszt

Pomiar na dwóch buildach tego samego drzewa (`bun run build` + `bun run check:bundle`):

| Pomiar                      | Przed pracą (`39a9efd`) |         Po |
| --------------------------- | ----------------------: | ---------: |
| public (ścieżka czytelnika) |              2 534,2 KB | 2 537,6 KB |
| admin-only                  |              1 331,0 KB | 1 332,7 KB |
| overall                     |              3 865,2 KB | 3 870,4 KB |

Budżet `overall` to 3 870 KB, więc **przed tą pracą zapas wynosił 4,8 KB (0,12%)** i bramka
sama to zgłaszała ostrzeżeniem („ZAPAS BUDŻETU PONIŻEJ 2%"). Moja zmiana dołożyła 5,2 KB
i ten zapas domknęła. Rozkład, zmierzony przez porównanie chunków obu buildów:

- **+2,0 KB** panel rekomendacji jako własny chunk (`+9,8` nowy chunk, `−7,8` chunk trasy) -
  koszt granicy chunku przy wyniesieniu panelu z pliku trasy;
- **+3,7 KB** siedem mikro-chunków atomów: Vite wydziela współdzielony moduł aplikacji do
  własnego chunku, a narzut opakowania każdego z nich jest większy niż jego własny kod;
- resztę zjadło przetasowanie chunków niezwiązane z tą pracą (`i18n +13,4` / `SeoPanel −12,2`
  to jedna zawartość przenosząca się między chunkami).

**Redukcje wykonane po pomiarze:** baryłka `postExperience/atoms/index.ts` (siedem
mikro-chunków w jeden) i scalenie ośmiu zduplikowanych napisów transportu audio w jedną
sekcję słownika.

Bramki `check:chunks` (graf acykliczny) i `check:entry-purity` (ścieżka bootowania czysta)
zielone. Budżet `public` - ten, który dotyczy czytelnika - **nie jest przekroczony**.

---

## 9. Czego ta praca NIE robi

- **Nie goni pokrycia na publicznych trasach wpisu** (`post.$slug.tsx`, `preview.$token.tsx`) -
  ich sens dowodzą e2e i bramki SSR.
- **Nie duplikuje tego, co ma bramkę:** `gating.ts`, `metering.ts`, `Paywall.tsx`,
  `MeterBanner`, `QuotaMeter`, `PostLayoutRenderer`, citations, `keyTakeaways/resolve`,
  `audio/playbackRate`, `ttsCanonical`, `audioSource`.
- **Nie testuje w vitest reguł egzekwowanych w bazie** (dostęp do treści, licznik meteringu,
  logowanie pobrań) - to pgTAP.
- **Nie mockuje sanitizera** - test glosariusza chodzi po PRAWDZIWYM wyjściu `sanitizeHtml`,
  inaczej nie dowodziłby bezpieczeństwa.
- **Nie dobija `RelatedPosts.tsx`** do 100%: sześć układów rekomendacji z autoplayem
  i gestami, pokryte cztery ścieżki. Reszta to kolejny krok, nie regresja tego.
- **Nie rusza 4 czerwonych testów w module 3** (`lazyWidgets`, `accordionEditor`) - padają
  identycznie na `39a9efd`, czyli przed pierwszym commitem tej pracy. Zmierzone, nie założone.

---

## 10. Progi per ścieżka dodane w tej pracy

Wszystkie floorowane tuż pod pomiarem, PER METRYKA:

| Ścieżka                                  | instr. | gał. |  fn | linie |
| ---------------------------------------- | -----: | ---: | --: | ----: |
| `src/components/admin/postExperience/**` |    100 |   95 | 100 |   100 |
| `src/lib/admin/panelDraft.ts`            |    100 |  100 | 100 |   100 |
| `src/lib/toc/panelRules.ts`              |    100 |  100 | 100 |   100 |
| `src/lib/keyTakeaways/panelRules.ts`     |    100 |  100 | 100 |   100 |
| `src/lib/relatedPosts/panelRules.ts`     |    100 |  100 | 100 |   100 |
| `src/lib/post/layoutPanelRules.ts`       |    100 |  100 | 100 |   100 |
| `src/components/post/**`                 |     80 |   66 |  72 |    84 |
| `src/components/audio/**`                |     62 |   77 |  48 |    64 |
| `src/lib/audio/global-player.tsx`        |     97 |   87 |  79 |   100 |
| `src/components/post/atoms/**`           |    100 |  100 | 100 |   100 |
| `src/components/audio/atoms/**`          |    100 |  100 | 100 |   100 |

Do tego progi z wcześniejszych kroków: `lib/post/glossaryHighlight.ts`, `lib/toc/settings.ts`,
`lib/keyTakeaways/settings.ts`, `lib/relatedPosts/adminConfig.ts`,
`hooks/usePostLayoutSettings.ts`, `lib/relatedPosts.ts`, `hooks/useBookmarks.ts`,
`hooks/useSaveArticle.ts`, `lib/relatedClickBeacon.ts`, `lib/audio/positionMemory.ts`,
`lib/audio/blobCache.ts`, `lib/audio/ttsStage.ts`, `routes/api/public/post-tts.ts`.

W `components/post/**` i `components/audio/**` próg instrukcji stoi NIŻEJ niż próg wierszy -
w JSX jeden wiersz nosi kilka instrukcji (skróty `&&`, wartości domyślne propsów), więc
mianownik instrukcji jest większy niż mianownik wierszy.

---

## 11. Mapowanie plik → moduł: wymagana poprawka w audycie

Kod modułu 1, który wyszedł z plików tras i komponentów, wylądował w katalogach, których
reguły audytu (rozdział 9.1) NIE przypisują do modułu 1:

| Nowa ścieżka                             | Co tam jest                   | Bez poprawki wpada do |
| ---------------------------------------- | ----------------------------- | --------------------- |
| `src/components/admin/postExperience/**` | cztery panele modułu          | PRZEKROJOWE: panel    |
| `src/lib/post/**`                        | reguły renderu i paneli wpisu | MODUŁ 20 (`src/lib/`) |
| `src/lib/admin/panelDraft.ts`            | reguły wspólne paneli modułu  | MODUŁ 19              |

Bez dopisania tych trzech wzorców do reguł modułu 1 kolejny pomiar pokaże spadek liczby
plików modułu i **przeniesie pokrycie do innych modułów**, choć kod jest ten sam. Wzorce
zostały dopisane w dokumencie audytu razem z liczbami.

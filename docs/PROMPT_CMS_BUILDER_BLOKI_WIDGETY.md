# ZADANIE: domknąć cztery najsłabsze powierzchnie CMS-a buildera i naprawić trzy defekty, które w nich siedzą

Wejście: audyt pokrycia testami, wydanie 9
(`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`). Obszar: **moduł 03 - CMS builder,
bloki (typ Gutenberg) i widgety (typ Elementor)**, plus jedna powierzchnia z modułu 04
(`Ikony / marka`), która z buildera jest wołana i z nim się psuje.

**Zlecenie jest WĄSKIE i to jest jego najważniejsza cecha.** Moduł stoi na **96,93% linii
(14 038 z 14 483) i 95,55% funkcji (4 398 z 4 603)** - to jest jeden z najlepiej przetestowanych
obszarów tej platformy. Dziewięć z trzynastu powierzchni ma **każdą funkcję wywołaną w teście**.
Nie ruszaj tych dziewięciu. Robota jest w czterech i mieści się w trzech defektach oraz dwóch
progach.

---

# 0. Co jest ustalone. Przeczytaj to, zanim cokolwiek zmienisz

## 0.1 SPROSTOWANIE POMIARU - dwie liczby ze zlecenia są z WYDANIA 8, nie 9

Tabela funkcjonalności w wydaniu 9 audytu (i w artefakcie) została zbudowana z raportu
**wydania 8**, choć opisuje wydanie 9. Sprawdzone plik po pliku: **wszystkie 141 wierszy** tej
tabeli zgadza się z `coverage-ed8/coverage-summary.json` co do cyfry (procent, licznik funkcji
i mianownik LOC), a nie z pomiarem wydania 9. Dla większości wierszy nie ma to znaczenia
(114 mieści się w 1 pp, bo te powierzchnie się nie ruszyły), ale **trzynaście wierszy jest
przesuniętych o ≥10 pp, najgorszy o 71,20 pp**. Konsekwencje dla TEGO obszaru:

| powierzchnia                    | w tabeli (ed8)               | prawda (ed9)                     | różnica      |
| ------------------------------- | ---------------------------- | -------------------------------- | ------------ |
| CMS: zapytania danych widgetów  | 83,22% · F 123/140 · LOC 459 | **90,57% · F 125/140 · LOC 488** | **+7,35 pp** |
| CMS: silnik treści publicznej   | 80,95% · F 100/121           | 81,14% · F 100/121               | +0,19 pp     |
| CMS: design tokens / typografia | 87,94% · F 34/40             | 87,94% · F 35/40                 | 0,00 pp      |
| Ikony / marka                   | 80,54% · F 27/37             | 80,54% · F 27/37                 | 0,00 pp      |
| **moduł 03 (nagłówek)**         | 96,7% · 14 048/14 527        | **96,93% · 14 038/14 483**       | +0,23 pp     |

**I dwie z ośmiu „martwych" funkcji podanych w zleceniu ŻYJĄ:**

- `clubWidgetSlug @ src/lib/builder/prefetch.ts:119` → **żywa, 2 wywołania**, i jest dziś
  w linii **123** (numer 119 to numer z wydania 8, plik urósł o 4 linie);
- `clubThreadsInput @ src/lib/builder/prefetch.ts:125` → **żywa, 2 wywołania**, dziś linia **129**.

Nie pisz dla nich testów „bo są martwe". Pozostałe sześć nazwanych funkcji jest martwych
realnie i to sprawdziłem w `coverage-ed9-final/coverage-final.json`, licznik `f` równy zero.

## 0.1a Pełny stan czterech powierzchni, którymi zajmuje się to zlecenie

Wszystkie liczby z `coverage-ed9-final`, plik po pliku zsumowane po liście plików danej
powierzchni. To jest podstawa każdego kryterium odbioru niżej:

| powierzchnia                                      | plików | linie                | funkcje              | gałęzie          |
| ------------------------------------------------- | -----: | -------------------- | -------------------- | ---------------- |
| CMS: silnik treści publicznej (contentEngine)     |     20 | 426/525 = **81,14%** | 100/121 = **82,64%** | 394/506 = 77,87% |
| CMS: zapytania danych widgetów                    |      8 | 442/488 = **90,57%** | 125/140 = **89,29%** | 349/464 = 75,22% |
| CMS: design tokens / kolory globalne / typografia |      6 | 226/257 = **87,94%** | 35/40 = **87,50%**   | 218/267 = 81,65% |
| Ikony / marka                                     |      7 | 120/149 = **80,54%** | 27/37 = **72,97%**   | 116/157 = 73,89% |

**Zanim ruszysz jakąkolwiek liczbę z tego zlecenia - odtwórz ją u siebie.** Jeśli się nie
zgadza, zatrzymaj się i zgłoś rozbieżność. To zlecenie powstało po tym, jak audyt pomylił dwa
raporty; nie powtarzaj tego błędu w drugą stronę.

## 0.2 i18n paneli właściwości jest ZROBIONE - nie dotykaj

`src/lib/builder/schemas.ts` ma **3 904 linie i 513 polskich literałów** w `label` / `hint` /
`placeholder`, i **ani jednego wywołania `t()`**. To NIE jest dług i18n. To świadoma
architektura: **polski napis JEST kluczem tłumaczenia**, a stronę angielską trzyma
`src/lib/builder/labelsEn.ts` (`BUILDER_LABELS_EN` + `builderLabel()` z fallbackiem na polski
źródłowy). Konsumpcja idzie przez `useBuilderLabel()` w
`src/components/admin/builder/ui/molecules/SchemaFieldControl.tsx:79-81`.

**I jest na to bramka** - `src/lib/builder/__tests__/labelsEn.test.ts` (137 linii) zbiera
`label`, `hint`, `placeholder`, `group` oraz etykiety opcji z `WIDGET_SCHEMAS`, do tego
`WIDGETS`, wszystkie katalogi wariantów, styl sidebara, grupy tagów dynamicznych i kategorie
kolorów globalnych, i **oblewa build, gdy polsko wyglądająca etykieta nie ma wpisu angielskiego**
(asercja: zebranych etykiet > 500). Nie przepisuj tych 513 literałów na `t()` - zepsujesz
mechanizm, który już działa, i wywalisz bramkę.

## 0.3 Co w tym obszarze jest zamknięte i czego nie ma sensu ruszać

Dziewięć powierzchni modułu ma **każdą funkcję wywołaną w teście**: edycja bloków (100,0%),
warstwa content-model (99,3%), builder sidebara + wzorce (99,2%), silnik bloków - rdzeń (98,9%),
render bloków publiczny (98,1%), sanityzacja HTML (97,5%), panele właściwości widgetów (97,3%),
page builder - schemat i operacje (96,9%), import z Gutenberga/WordPressa (99,8%). Import ma
1 309 LOC i jedną niewywołaną funkcję. **Nie ma tam roboty.**

---

# CZĘŚĆ A - DEFEKTY (P1). Trzy naprawy, każda z dowodem w kodzie

## A1. `readableOn()` daje BIEL NA BIELI dla dziesięciu z trzynastu zapisów koloru, które panel przepuszcza - i podpowiedź w panelu obiecuje odwrotnie

**To jest pozycja blokująca tej listy.** Defekt jest w a11y, ma trzy niezależne dowody i zero
testów, bo funkcja, która go zawiera, ma **zero wywołań**.

Łańcuch:

1. `src/components/builder/organisms/widget-view/SimpleWidgets.tsx:576` -
   `rowColor: safeWidgetColor(c.rowHoverColor)`;
2. `safeWidgetColor()` (`src/lib/builder/cssColor.ts:31-40`) **celowo przepuszcza**:
   `transparent`, `currentcolor`, hex 3/4/**6**/**8** znaków, `var(--…)` oraz
   `rgb/rgba/hsl/hsla/hwb/oklab/oklch/lab/lch/color(...)`. Nagłówek tego pliku (`:3-8`) mówi
   wprost, po co: poprzednia walidacja wzorcem `/^#([0-9a-f]{3}|[0-9a-f]{6})$/` gubiła po cichu
   wszystko, co commituje `AdminColorPicker` - _„użytkownik ustawiał kolor, zapisywał i nic się
   nie zmieniało"_;
3. `luminance()` (`src/components/builder/organisms/widget-view/socialHover.ts:146-147`) parsuje
   wyrażeniem **`/^#([0-9a-f]{3}|[0-9a-f]{6})$/i`** - czyli **dokładnie tym wzorcem, który
   `cssColor.ts` został napisany, żeby zastąpić**. Wszystko inne → `null`;
4. `readableOn()` (`:162-165`): `return l !== null && l > 0.42 ? "#141414" : "#ffffff"` -
   `null` idzie w gałąź `#ffffff`, czyli **biel**;
5. `socialHoverForeground()` (`:174`): `plan.rowColor ? readableOn(plan.rowColor) : "#ffffff"`.

Zmierzone na trzynastu zapisach (whitelist vs `luminance`):

| zapis                        | whitelist       | `luminance()` | `readableOn()`    |
| ---------------------------- | --------------- | ------------- | ----------------- |
| `#ffffff`, `#fff`, `#f5f5f0` | przepuszcza     | parsuje       | policzy poprawnie |
| `#ffffffff` (hex 8 znaków)   | **przepuszcza** | `null`        | **biel**          |
| `#ffff` (hex 4 znaki)        | **przepuszcza** | `null`        | **biel**          |
| `rgb(255,255,255)`           | **przepuszcza** | `null`        | **biel**          |
| `rgba(255,255,255,1)`        | **przepuszcza** | `null`        | **biel**          |
| `hsl(0 0% 100%)`             | **przepuszcza** | `null`        | **biel**          |
| `oklch(1 0 0)`               | **przepuszcza** | `null`        | **biel**          |
| `var(--background)`          | **przepuszcza** | `null`        | **biel**          |
| `transparent`                | **przepuszcza** | `null`        | **biel**          |
| `currentcolor`               | **przepuszcza** | `null`        | **biel**          |

**Dziesięć z trzynastu.** Ustaw jasne tło wiersza którymkolwiek z nich → napis wiersza jest
biały na jasnym, czyli niewidoczny.

Trzeci dowód i najgorszy: **panel to obiecuje w obu językach.** Pole `rowHoverColor`
(`src/lib/builder/schemas.ts:2499-2506`) ma `placeholder: "#B85410 lub var(--brand)"` -
czyli **sam podpowiada `var(--brand)`**, którego `luminance` nie umie - i `hint`:
_„Z koloru budowany jest gradient; kolor tekstu dobiera się automatycznie do jego jasności."_
Ta obietnica jest nieprawdziwa dla dziesięciu z trzynastu przypadków, a przez `labelsEn.ts`
jest nieprawdziwa również po angielsku.

Zadanie:

1. **Rozszerzyć `luminance()` na zapisy, które whitelist przepuszcza**, w kolejności taniości:
   hex 4- i 8-znakowy (trywialne - obetnij kanał alfa), `rgb()`/`rgba()`, `hsl()`/`hsla()`.
   Dla `var(--…)`, `currentcolor`, `transparent` i przestrzeni percepcyjnych
   (`oklch`/`oklab`/`lab`/`lch`/`color()`) **nie zgaduj** - wartości nie da się policzyć bez
   layoutu. Zwróć wtedy `null`, ale **zmień domyślną gałąź**: dziś `null` daje biel, a musi dawać
   wartość, która jest czytelna na tle NIEZNANYM. Kanoniczny zapis w tym repozytorium to
   `var(--foreground)` (tak robi gałąź `soft` w `socialHoverForeground`, `:176`) - i to jest
   właściwe domknięcie, bo `--foreground` jest z definicji czytelne na `--background`.
2. **Uzasadnić progiem, nie okiem.** Dziś próg to `l > 0.42` i nie ma testu, że po którejkolwiek
   stronie wychodzi kontrast ≥ 4,5:1. Test ma liczyć **rzeczywisty współczynnik kontrastu**
   (`(L1+0,05)/(L2+0,05)`), nie sprawdzać, którą gałąź wybrano. Jeśli 0,42 nie utrzymuje 4,5:1
   po obu stronach - podaj wartość, która utrzymuje, i zmień ją wraz z pomiarem w komentarzu.
3. **Poprawić `hint` i `placeholder`**, żeby nie obiecywały czegoś, czego kod nie robi - albo
   (lepiej) zostawić obietnicę i dowieźć ją punktem 1. Jeśli zmienisz napis, dopisz wpis do
   `BUILDER_LABELS_EN`, inaczej oblejesz `labelsEn.test.ts`.

**Kryterium odbioru:** `luminance` i `readableOn` mają **niezerową liczbę wywołań** w pomiarze;
test tabelaryczny po WSZYSTKICH trzynastu zapisach z tabeli wyżej, każdy z asercją na
współczynnik kontrastu, nie na nazwę koloru; zapis nieparsowalny **nie zwraca bieli**; pokrycie
`socialHover.ts` z 75,00% funkcji na ≥ 94% (wartość progu globa, patrz B2).

---

## A2. `fetchPreviewPost` czyta szkice BEZ FILTRA NAJEMCY, przez rolę serwisową, która omija RLS niosącą tę regułę

`src/lib/content/previewTokens.functions.ts:106-147` to jedyna **publiczna** (bez
`requireStaff`) funkcja serwerowa tego pliku: przyjmuje token z URL-a i zwraca **pełną treść
nieopublikowanego wpisu** do renderu w `/preview/$token` (`src/routes/preview.$token.tsx:36`).

Dwa zapytania, oba przez `supabaseAdmin`:

```ts
.from("post_preview_tokens").select("post_id, expires_at")
  .eq("token", data.token).gt("expires_at", …).maybeSingle()   // :116-120
.from("posts").select("title_pl, …, builder_data, blocks_data, …")
  .eq("id", tokenRow.post_id).is("deleted_at", null).maybeSingle()  // :122-129
```

**Ani jednego `.eq("tenant_id", …)`.** A kolumna istnieje i jest wypełniana:
`supabase/migrations/20260720131000_post_preview_tokens.sql:14` -
`tenant_id uuid NOT NULL DEFAULT current_tenant_id()`. Regułę najemcy niesie **polityka RLS**
(`:31-34`: `USING (tenant_id = public.current_tenant_id() AND public.is_staff())`) - a ta
polityka dotyczy roli `authenticated`. Rola serwisowa ma `GRANT ALL` (`:26`) i **RLS ją omija**,
więc na tej jednej ścieżce reguła nie obowiązuje w ogóle.

Skutek: token wystawiony na domenie najemcy A **rozwiązuje się na domenie najemcy B** i wydaje
tam szkic najemcy A. Token jest nieodgadywalny (24 losowe bajty, `generateToken` `:14-20`), więc
to nie są otwarte drzwi - ale to jest złamanie doktryny, którą platforma egzekwuje wszędzie
indziej, i **plik obok robi to poprawnie**: `src/lib/content/feedback.functions.ts:22-26, 45-53`
rozwiązuje najemcę z hosta (`currentTenantHost()` → `resolveTenantIdForHost()`) i dokłada
`.eq("tenant_id", tenantId)` do zapytania o wpis. Ten sam wzorzec, ta sama rola, ten sam katalog

- jeden plik go stosuje, drugi nie.

Zadanie: przenieść wzorzec z `feedback.functions.ts` do `fetchPreviewPost`: rozwiązać najemcę
z hosta żądania i dołożyć `.eq("tenant_id", tenantId)` do **oba** zapytań. Nieznany najemca
(`null`) = odmowa, nie „domyślny najemca" - to ścieżka do treści nieopublikowanej, więc
domknięcie musi być **fail-closed**.

**Czego NIE robić:** nie przenoś tego na klienta użytkownika, żeby „RLS załatwiła sprawę" -
funkcja jest publiczna z definicji (czytelnik podglądu nie ma sesji). Rola serwisowa jest tu
poprawna; brakuje warunku w SQL, nie zmiany klienta.

**Kryterium odbioru:** test dowodzący, że token najemcy A **nie** zwraca treści, gdy host
wskazuje najemcę B (asercja na `null`, nie na rzut); test na `null` przy nierozwiązanym
najemcy; oba testy oblewają po zdjęciu warunku (pokaż oba przebiegi).

---

## A3. Hasz IP i user-agenta nie ma ANI JEDNEGO testu - a to jest ścieżka RODO

`src/lib/content/feedback.functions.ts` ma **1 z 27 linii (3,70%) i 0 z 4 funkcji (0%)**, czyli
jest najsłabszym plikiem całego modułu, i to jest plik, który **hashuje dane osobowe**:

```ts
const voterHash = await sha256Hex(`${tenantId}:${data.postId}:${clientIp}:${userAgent}`); // :57
```

`sha256Hex` (`:9-13`) jest martwa w pomiarze, bo **plik nie ma żadnego pliku testowego** -
katalog `src/lib/content/__tests__/` ma dziesięć plików i żadnego dla `feedback`. Jedyne
wystąpienie `submitPostFeedback` w testach to `src/components/post/__tests__/postPresentational.test.tsx`,
gdzie funkcja jest podmieniona na atrapę.

Stała zasada tej serii jest tu wprost: _jeśli kod hashuje IP, test sprawdza, że wynik **nie**
zawiera oryginału_. Dziś nie sprawdza tego nic.

Zadanie - test na `sha256Hex` i na kompozycję klucza, cztery asercje:

1. wynik **nie zawiera** ani IP, ani user-agenta w żadnej postaci (podstring, hex, base64);
2. hasz jest **stabilny** dla tego samego wejścia (dedup ma działać przez 30 dni, `:57`);
3. hasz **różni się między najemcami** dla identycznego IP i wpisu - `tenantId` jest pierwszym
   segmentem klucza właśnie po to;
4. IP zastępcze `"unknown-ip"` (`:31`, gałąź bez kontekstu HTTP) daje **wspólny kubełek** i to
   jest świadome (`:40-43` mówi „fail-closed na nieznanym IP jak contact.submit") - test ma to
   przypiąć, żeby nikt nie „naprawił" tego na losowy identyfikator.

W fixture'ach **żadnych prawdziwych danych osobowych**: adresy z `example.com`, IP z bloków
dokumentacyjnych (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).

**Kryterium odbioru:** `sha256Hex` z niezerową liczbą wywołań; cztery asercje wyżej; plik
z 3,70% na ≥ 60% linii; nowy próg per-ścieżka z pomiarem i datą w komentarzu.

---

# CZĘŚĆ B - POKRYCIE I PROGI

## B1. Cztery pliki `*.functions.ts` stoją na 0% funkcji, a powierzchnia raportuje 81%

„CMS: silnik treści publicznej (contentEngine) - 81,0%" **nie opisuje żadnego z dwóch
zbiorów**, z których się składa. Rozbite na dwie populacje (20 plików, pomiar wydania 9):

| populacja                            | plików | linie              | funkcje          |
| ------------------------------------ | -----: | ------------------ | ---------------- |
| `*.functions.ts` (funkcje serwerowe) |      4 | **11/92 = 11,96%** | **0/17 = 0,00%** |
| pozostałe (moduły czyste)            |     16 | 415/433 = 95,84%   | 100/104 = 96,15% |

Czternaście z tych szesnastu stoi na **dokładnie 100%**. Plik po pliku, cztery najsłabsze:

| plik                         | linie             | funkcje      | co robi                             |
| ---------------------------- | ----------------- | ------------ | ----------------------------------- |
| `feedback.functions.ts`      | 1/27 = **3,70%**  | 0/4 = **0%** | głos „czy przydatne" + hasz IP (A3) |
| `translate.functions.ts`     | 2/17 = **11,76%** | 0/2 = **0%** | tłumaczenie treści                  |
| `linkMonitor.functions.ts`   | 1/7 = **14,28%**  | 0/2 = **0%** | monitor martwych linków             |
| `previewTokens.functions.ts` | 7/41 = **17,07%** | 0/9 = **0%** | linki podglądu szkiców (A2)         |

**Ani jedna funkcja serwerowa tej powierzchni nie została nigdy wywołana przez test.** Wszystkie
cztery pliki idą przez `createServerFn`, wszystkie cztery przez rolę serwisową albo
`requireStaff`, i wszystkie cztery dotykają danych, których publiczność nie powinna zobaczyć.
A2 i A3 domykają dwa z nich; zostają `translate.functions.ts` i `linkMonitor.functions.ts`.

Zadanie: dowieźć wywołanie każdej z siedemnastu funkcji, zaczynając od walidatorów
(`.validator()` to czysty Zod - najtaniej) i od gałęzi odmowy. Wzorzec testowania
`createServerFn` w tym repozytorium jest już użyty w kilkudziesięciu plikach - **znajdź go
i zastosuj, nie wymyślaj własnego**; podaj w PR, z którego pliku go wziąłeś.

**Kryterium odbioru:** `*.functions.ts` tej powierzchni z 0,00% na ≥ 70% funkcji; próg
per-ścieżka na każdy z czterech plików; **żaden test nie wychodzi do sieci i nie zawiera
prawdziwego sekretu**.

---

## B2. Osiemnaście z dziewiętnastu plików tego obszaru nie ma ŻADNEGO progu, a jedyny glob kryje trzynaście plików pod swoją podłogą

Sprawdzone w `vitest.config.ts` dla wszystkich plików czterech powierzchni:

- **próg jawny per-plik: 0 z 19**;
- **złapany globem: 1 z 19** (`socialHover.ts` przez `src/components/builder/organisms/widget-view/**`);
- **bez żadnego progu: 18 z 19**, w tym każdy plik z defektów A2 i A3 oraz **wszystkie cztery
  pliki `*.functions.ts`** i `src/components/icons/BrandIcon.tsx` na 0%.

A ten jeden glob nie broni tego, na co wygląda. `thresholds.perFile` **nie jest ustawione**,
więc glob jest **agregatem katalogu**: podłoga funkcji to 94, agregat katalogu to **95,01%
(647/681)** - i pod tą podłogą siedzi **trzynaście plików**, najgorszy na 72,72%:

| plik                                     |            funkcje |  linie |
| ---------------------------------------- | -----------------: | -----: |
| `TeamMemberWidget.tsx`                   |  **72,72%** (8/11) | 92,50% |
| `ProgressCarouselView.tsx`               |       75,00% (3/4) | 94,44% |
| **`socialHover.ts`** (plik z defektu A1) | **75,00%** (12/16) | 88,04% |
| `TrendingNowView.tsx`                    |             80,00% | 93,02% |
| `resizeWrappers.tsx`                     |             80,00% | 96,82% |
| `AccountMenuWidget.tsx`                  |     83,33% (25/30) | 93,40% |
| + 7 dalszych między 83,33% i 89,58%      |                    |        |

Zadanie: dołożyć progi per-ścieżka na pliki, które w tym zleceniu ruszasz, w kanonicznej postaci
tej serii - **„zmierzone minus ~2 pp" dla progu na jeden plik**, z komentarzem podającym pomiar
i datę, tak jak istniejące wpisy. Osobno **rozstrzygnij i podaj wynik**: czy `perFile: true` na
globie `widget-view/**` przechodzi dziś na zielono (odpowiedź brzmi nie - trzynaście plików) i co
kosztowałoby jego włączenie. Nie włączaj go w tym PR; podaj liczbę.

---

## B3. Trzy funkcje są martwe, bo JEDYNY test, który dociera do ich wywołania, podmienia je na atrapę

To nie są trzy niezależne braki. To jeden wzorzec, ten sam, który w warstwie SSR dotyczy
`requestHost` (podmieniany na atrapę w 26 plikach testowych, rozdz. 8.7 audytu):

| funkcja                                                                    | dlaczego martwa                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clearAllLiveWidgetTypography @ src/lib/builder/liveTypography.ts:95`      | wołana z `Builder.tsx:108` i `:115` (undo/redo), a `builderShell.test.tsx:69` **podmienia ją na atrapę**                                                                                 |
| `BrandIcon @ src/components/icons/BrandIcon.tsx:31` + `useColorMode @ :14` | jedyny konsument to `src/routes/admin.users.$id.tsx:3`, a `adminUsersRoutes.test.tsx:282` **podmienia moduł na atrapę**                                                                  |
| `useBrandLogoUrl @ src/lib/brand/useBrandLogoUrl.ts:41`                    | podmieniana na atrapę w **czterech** plikach testowych (`SignupPopupEditor`, `signupPopupTabs`, `SignupPopupPanel`, `SignupPopupPanelLayout`) - wszystkie zwracają `null` albo stały URL |

Wszystkie trzy są **czyste albo prawie czyste** i testowalne bez montowania powierzchni:

1. **`clearAllLiveWidgetTypography`** (`:95-118`) czyści `sessionStorage` po prefiksie, usuwa
   węzły `<style>` po prefiksie ID i emituje `CustomEvent` z `typography: undefined` dla każdego
   widgetu. Test w `happy-dom` bez atrapy: zasiej dwa wpisy i dwa `<style>`, wywołaj, sprawdź
   że jedno i drugie zniknęło **i że subskrybent dostał `undefined`** - bo to jest sens tej
   funkcji przy undo (docblock `:92-93`: bez tego „kanwa widocznie ignoruje undo").
2. **`useBrandLogoUrl`** (`:41-67`) to **kaskada trzynastu kandydatów** w czterech wariantach
   (`surface` × `shape`), zwracająca pierwszy niepusty URL. Trzynaście kandydatów, cztery
   kolejności, zero testów - a pomyłka w kolejności daje ciemny znak na ciemnym tle i nikt tego
   nie zauważy w CI. Test tabelaryczny na cztery kombinacje plus przypadek „wszystko puste →
   `null`". Plik ma dziś **47,05% linii, 50% funkcji, 29,62% gałęzi**.
3. **`BrandIcon` z `src/components/icons/` - najpierw ROZSTRZYGNIJ, potem testuj.** Istnieją
   **dwie niezależne implementacje** o tej samej nazwie:
   - `src/components/atoms/BrandIcon.tsx` (4 126 B) - używana przez **wszystkie** powierzchnie
     publiczne i profilowe (`QuoteShareBar`, `AuthorBusinessCard`, `SocialIdentityPanel`, …),
     czyta motyw przez `useTheme()` z `ThemeProvider`, szuka we **wszystkich** rodzajach ikon
     z priorytetem `brand > custom > flag`;
   - `src/components/icons/BrandIcon.tsx` (1 727 B, **0% linii, 0% funkcji, 0% gałęzi**) - jeden
     konsument, `src/routes/admin.users.$id.tsx`, i **dwie rozbieżności behawioralne**:
     (a) woła `listIcons("brand")`, czyli ikony zaimportowane hurtowo jako `custom` **nie
     rozwiążą się** na `/admin/users/$id`, choć rozwiązują się wszędzie indziej - a wariant
     `atoms` komentuje to wprost jako powód swojego istnienia; (b) ma własny `useColorMode()`
     czytający `document.documentElement.classList.contains("dark")` przez `MutationObserver`,
     **omijając `ThemeProvider`**, więc może się z nim rozjechać.

   Zadanie: **rozstrzygnij, czy ta druga implementacja ma prawo istnieć.** Jeśli nie - przełącz
   `admin.users.$id.tsx` na wariant `atoms` i **usuń plik** (katalog `src/components/icons/`
   zostaje wtedy pusty). Jeśli tak - uzasadnij, czym się różni celowo, i dowieź test. Nie
   dopisuj testu do duplikatu, zanim odpowiesz na to pytanie: **test na kodzie, który powinien
   zniknąć, jest gorszy niż jego brak**.

**Kryterium odbioru:** trzy funkcje z niezerową liczbą wywołań **bez podmieniania ich na atrapę
w nowym teście**; jednoznaczna odpowiedź w PR o duplikacie `BrandIcon` (plik i linia); powierzchnia
`Ikony / marka` z 72,97% funkcji na ≥ 90%.

---

## B4. `postListQuery.ts`: 464 linie kodu, 37 linii testu, 54,62% gałęzi - najgorsze gałęzie całego obszaru

Plik ma **79/107 linii (73,83%), 71,42% funkcji i 54,62% gałęzi**. Jego test
(`src/lib/builder/__tests__/postListQuery.test.ts`, **37 linii, 5 przypadków**) pokrywa
**wyłącznie** czysty pomocnik `rankAndSlicePopular`. Cała ścieżka danych jest nietestowana:
`fetchPopularPostIds` (`:282`, martwa), `fetchPostListRows` (`:381`), `fetchPostIdsBySlugs`,
algebra zbiorów include/exclude (`:381-400`) i degradacja rankingu.

Priorytet w tym pliku ma **degradacja**, bo to klasa defektu numer jeden całego audytu („awaria
odczytu udaje pustkę albo stan domyślny", 12 wystąpień w module 19). Tutaj obsłużono ją
**poprawnie** i właśnie dlatego trzeba to przypiąć testem, zanim ktoś to zepsuje - trzy różne
wyniki, trzy różne zachowania (`:346-356`):

| wynik RPC                 | `effectiveOrderBy` | co zwraca widget                                 |
| ------------------------- | ------------------ | ------------------------------------------------ |
| `null` (RPC niedostępny)  | `"published_at"`   | **lista po świeżości**, nie pustka               |
| `[]` (nikt nie popularny) | `"popular"`        | `[]` - poprawnie, bo pusto to pusto              |
| niepusta lista            | `"popular"`        | ranking, `includeSet` zawężony do 200 kandydatów |

Do tego dwie rzeczy warte przypięcia, bo są nieoczywiste i nieudokumentowane:
`if (effectiveOrderBy !== "popular") q = q.range(...)` (`:382-384`) - dla rankingu **nie ma
`range`**, okno wycina dopiero `rankAndSlicePopular`; a dla `"random"` `range` **jest**, więc
losowanie tasuje tylko okno, nie cały zbiór (`:388`).

**Kryterium odbioru:** `fetchPopularPostIds` z niezerową liczbą wywołań; trzy przypadki z tabeli
wyżej, każdy z asercją na zwrócone identyfikatory; gałęzie pliku z 54,62% na ≥ 75%; próg
per-ścieżka z pomiarem i datą.

---

## B5. Cztery pliki z podejrzanym profilem: 100% funkcji przy niskich gałęziach

Nie każdy z nich jest defektem, ale każdy jest sygnałem, że test wchodzi w funkcję i wychodzi
jedną ścieżką. Rozstrzygnij każdy i podaj wynik:

| plik                                 |    linie |  funkcje |    gałęzie | co to znaczy                                                                                  |
| ------------------------------------ | -------: | -------: | ---------: | --------------------------------------------------------------------------------------------- |
| `src/lib/builder/autoInvertColor.ts` |   71,15% | **100%** |     61,53% | każda funkcja wołana, **29% linii nigdy nie wykonane** - duże nieprzetestowane ciała warunków |
| `src/lib/builder/clubsQuery.ts`      | **100%** | **100%** | **58,33%** | wszystkie linie wykonane, **41% gałęzi nie** - klasyczny „test przechodzi środkiem"           |
| `src/lib/builder/taxonomyQuery.ts`   |   71,42% |  **50%** |          - | połowa funkcji martwa                                                                         |
| `src/lib/iconPack.ts`                | **100%** | **100%** |     70,00% | jak `clubsQuery`                                                                              |
| `src/lib/builder/liveTypography.ts`  |   78,87% |   73,33% |     57,14% | B3 punkt 1 domyka część tego                                                                  |

---

# JAK MIERZYĆ - bez tego żadne kryterium odbioru nie jest sprawdzalne

**Pomiar wyjściowy jest już w repozytorium i nie trzeba go powtarzać** - to on jest źródłem
każdej liczby w tym zleceniu:

- `coverage-ed9-final/coverage-summary.json` - pokrycie per plik;
- `coverage-ed9-final/coverage-final.json` - `fnMap` + licznik `f`, czyli **nazwy funkcji bez
  wywołania**;
- `coverage-ed8/` - poprzednie wydanie, **NIE używaj go jako stanu dzisiejszego** (to jest
  dokładnie pomyłka opisana w §0.1).

**Pokrycie mierz na pojedynczych plikach, nie na całej suicie.** Pełny przebieg trwa ~36 minut.
Reporter `json` **nie jest** w konfiguracji, więc nazwy niewywołanych funkcji wymagają dołożenia
go z wiersza poleceń:

```bash
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=json-summary \
  src/lib/content/__tests__ src/lib/builder/__tests__ \
  src/components/builder/organisms/widget-view/__tests__
```

**Stan wyjściowy CI, który MUSISZ znać przed startem.** Na tym HEAD:

- bramka `check:ci-gates` jest **czerwona** - jedno padnięcie na ratchecie tekstu
  jednojęzycznego (`src/routes/admin.analytics.index.tsx:387`). **To nie jest twoja czerwień
  i nie masz jej naprawiać**, ale musisz ją odróżnić od własnej;
- suita jest czerwona w **ośmiu plikach (272 testy)** z przyczyn opisanych w rozdz. 12.2 audytu
  i w `docs/PROMPT_OSIEM_CZERWIENI.md`. **Żaden z tych ośmiu plików nie należy do tego
  obszaru** - jeśli po twojej zmianie czerwony jest dziewiąty, jest twój.

---

# ZASADY - obowiązują w całości i nie podlegają negocjacji

**Pomiar przed zmianą i po zmianie**

- Każdy punkt ma w nagłówku DZISIEJSZĄ liczbę. Zanim ruszysz punkt, odtwórz ją u siebie. Jeśli
  się nie zgadza - **zatrzymaj się i zgłoś rozbieżność**, nie „popraw pod nią kodu". Liczba
  z audytu może być nieaktualna - to zlecenie ma na to własny dowód (§0.1).
- Po zmianie podaj tę samą liczbę tą samą metodą. „Powinno być lepiej" nie jest wynikiem odbioru.

**Testy**

- Progi w `vitest.config.ts` wolno **wyłącznie podnosić**: „zmierzone minus ~2 pp" dla progu na
  jeden plik, „zmierzone minus ~4 pp" dla globa, z komentarzem podającym pomiar i datę.
- **Nie wykluczaj plików z pomiaru.** Nie dodawaj `exclude`, nie zmieniaj `all: true`.
- **Nie zmieniaj zachowania produkcyjnego, żeby test przeszedł.** Defekt → `it.fails` z opisem,
  co jest złe i dlaczego. W repozytorium jest dziś 327 takich wpisów w 186 plikach i to jest
  rejestr, nie wstyd.
- **Nie regenerujesz snapshotu autoryzacji, żeby zgasić czerwień.**
- **Nowy test NIE MOŻE podmieniać na atrapę funkcji, którą ma pokryć** - to jest dokładnie
  przyczyna trzech z sześciu martwych funkcji tego obszaru (B3).

**Dane i bezpieczeństwo**

- **RODO w testach**: żadnych prawdziwych danych osobowych w fixture'ach. Jeśli kod hashuje IP,
  test sprawdza, że wynik **nie** zawiera oryginału. Adresy e-mail wyłącznie w domenach
  `example.com` / `example.org`, adresy IP z bloków dokumentacyjnych.
- **Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.**
- **`tenant_id` jest warunkiem, nie ozdobą**: obszar roboczy jednej firmy nie może zaczytać
  danych z obszaru innej. A2 jest tego naruszeniem i to jest jego jedyne uzasadnienie jako P1.

**Kod**

- Bez `any` i bez `as any`. W tym obszarze jest jeden `as unknown as`
  (`postListQuery.ts:292-295`) i ma **udokumentowany powód** (wygenerowane typy nie znają jeszcze
  RPC `popular_post_ids`) - zostaw go, ale jeśli typy są już świeże, usuń i podaj to w PR.
- Zamiast „—" stosuj „-".
- i18n: PL i EN. W tym obszarze to znaczy `BUILDER_LABELS_EN`, nie `t()` - patrz §0.2.
- Atomic design: nowe komponenty trafiają w istniejącą hierarchię (`atoms` / `molecules` /
  `organisms`), a nie obok niej. B3 punkt 3 jest przykładem, co się dzieje, gdy trafią obok.

---

# CZEGO NIE ROBIĆ - pięć pułapek, każda już raz kosztowała

1. **Nie przepisuj 513 literałów `schemas.ts` na `t()`.** Wyglądają na dług i18n, są kluczami
   tłumaczenia. Bramka `labelsEn.test.ts` oblałaby build, a mechanizm działa (§0.2).
2. **Nie pisz testów dla `clubWidgetSlug` i `clubThreadsInput` „bo są martwe".** Żyją, po
   2 wywołania, i są dziś w liniach 123 i 129 (§0.1).
3. **Nie „napraw" `luminance()` przez rozszerzenie wzorca o wszystko.** `oklch`/`lab`/`var(--…)`
   nie da się policzyć bez layoutu; poprawne domknięcie to zmiana domyślnej gałęzi, nie zgadywanie
   jasności (A1 punkt 1).
4. **Nie przenoś `fetchPreviewPost` na klienta użytkownika.** Funkcja jest publiczna z definicji;
   brakuje warunku w SQL, nie zmiany klienta (A2).
5. **Nie włączaj `perFile: true` globalnie, żeby „domknąć progi".** Trzynaście plików w jednym
   tylko katalogu jest dziś pod podłogą swojego globa (B2) - to zamieniłoby jedno zlecenie
   w tydzień gaszenia czerwieni w kodzie, którego nie dotykasz. Podaj liczbę, nie włączaj.

---

# DEFINICJA UKOŃCZENIA

1. **`readableOn` nie zwraca bieli dla zapisu nieparsowalnego**, a test tabelaryczny po
   trzynastu zapisach mierzy **współczynnik kontrastu**, nie nazwę koloru (A1).
2. **`fetchPreviewPost` filtruje po `tenant_id` w obu zapytaniach**, a test dowodzi, że token
   najemcy A nie działa na hoście najemcy B - i oblewa po zdjęciu warunku (A2).
3. **`sha256Hex` ma test dowodzący, że wynik nie zawiera IP ani user-agenta**, jest stabilny
   i różni się między najemcami (A3).
4. **Cztery pliki `*.functions.ts` powierzchni contentEngine z 0,00% na ≥ 70% funkcji** (B1).
5. **Trzy funkcje z B3 mają niezerową liczbę wywołań**, żadna nie jest podmieniona na atrapę
   w teście, który ma ją pokryć.
6. **Rozstrzygnięty duplikat `BrandIcon`** - jednoznaczna odpowiedź w PR z plikiem i linią, a przy
   decyzji o usunięciu: `admin.users.$id.tsx` przełączony i plik usunięty.
7. **`postListQuery.ts` z 54,62% gałęzi na ≥ 75%**, z trzema przypadkami degradacji rankingu (B4).
8. **Progi per-ścieżka na każdy plik, który ruszasz**, z komentarzem podającym pomiar i datę;
   podana liczba kosztu `perFile: true` na globie `widget-view/**` (B2).
9. **Powierzchnia `Ikony / marka` z 72,97% funkcji na ≥ 90%**, `contentEngine` z 82,64% na ≥ 90%.
10. **`bun run check:*` w komplecie zielone poza `check:ci-gates`**, która była czerwona przed
    twoją pracą i nie należy do tego zlecenia; suita czerwona w dokładnie ośmiu plikach, tych
    samych co przed startem.

**Na koniec zdaj raport:** co zmierzyłeś przed i po (liczba za liczbą, tą samą metodą), które
defekty zarejestrowałeś jako `it.fails` i dlaczego, czego świadomie nie zrobiłeś, oraz - osobno -
**które liczby z tego zlecenia okazały się nieaktualne**. Ta ostatnia lista jest dla audytu
najcenniejsza: to zlecenie samo powstało z wykrycia, że tabela funkcjonalności wydania 9
pokazywała liczby wydania 8, a wykryło to **sprawdzenie liczby, nie jej przepisanie**.

# Pełne pokrycie modułu 21 (Rekrutacja / kariera): dwie dziury w mapie, jedna bramka i 477 nowych dowodów (2026-09-03)

Zlecenie: **pokryć testami w pełni moduł „Rekrutacja / kariera"** — wejście
`linie 55,1%`, `funkcje 47,1%`, z wierszem funkcjonalności „Kariera: ogłoszenia
i zgłoszenia" (26 plików, 576 LOC, linie 81,3%, funkcje 164/224).

**Wynik: linie 100,00% (883/883), funkcje 100,00% (359/359), 0 plików na zerze
(było 12), 669 przypadków w 23 plikach (było 192).**

| Metryka         | Baseline (audyt 2026-08-18) |           Po kampanii |
| --------------- | --------------------------: | --------------------: |
| Linie           |            55,12% (468/849) | **100,00%** (883/883) |
| Funkcje         |            47,13% (164/348) | **100,00%** (359/359) |
| Instrukcje      |            54,96% (548/997) |    99,80% (1033/1035) |
| Gałęzie         |            53,52% (410/766) |      97,72% (770/788) |
| Plików na zerze |                     12 / 29 |            **0 / 30** |
| Przypadków      |                         192 |               **669** |

Mianownik **urósł** (849 → 883 linii, 348 → 359 funkcji), bo do modułu weszła
publiczna strona kariery, która z niego wypadała. To nie jest ten sam,
łatwiejszy pomiar — jest trudniejszy.

Cała gałąź nie zmienia **ani jednej linii kodu produkcyjnego**. Zmienione pliki:
13 plików testowych + `scripts/taxonomy/features.mjs` i `moduleMap.mjs`.

---

## 1. Punkt wyjścia był zaniżony, i to dwa razy

### 1.1 Wiersz funkcjonalności nie dawał się przeliczyć z kodu

`FEATURES` w `scripts/taxonomy/features.mjs` miał wpis **tylko dla modułu 16**,
więc `featureForPath` zwracał dla plików modułu 21 `null`, a `report.mjs`
pomijał moduł w tabeli funkcjonalności (`if (!FEATURES.has(module)) continue;`).
Wiersz z audytu nie powstał więc z kodu — i wycinał z siebie trzy największe
zera modułu:

```
moduł 21 . . . linie 468/849, funkcje 164/348
wiersz audytu  LOC 576,       funkcje 164/224
849 - 576 = 273 = 148 (admin.hiring) + 109 (admin.careers) + 16 (jobs-tick)
348 - 224 = 124 =  81 (admin.hiring) +  42 (admin.careers) +   1 (jobs-tick)
```

Licznik funkcji jest w obu wierszach **identyczny** (164), bo wykluczona trójka
miała zero pokrytych funkcji. Wiersz obiecywał „ogłoszenia i zgłoszenia"
i wycinał oba panele, w których ogłoszenia się redaguje, a zgłoszenia czyta.
To ta sama choroba, przeciw której napisano niezmiennik 1 bramki
`check:feature-taxonomy` — bramka jej nie widziała, bo sprawdza wyłącznie
moduły, które **już** mają taksonomię. Moduł 21 ma dziś siedem wierszy.

### 1.2 Moduł rekrutacji nie zawierał strony rekrutacyjnej

Moduł 21 łapał `^src/routes/.*(career|job)` oraz `^src/routes/admin\.hiring`.
Trasa, na którą wchodzi **kandydat**, nazywa się po polsku
(`src/routes/zatrudniamy.tsx`) i nie ma w nazwie żadnego z tych członów — więc
nie należała do modułów 1–19, a jako ostatni brał ją łapacz `^src/routes/`
modułu 20 („Platforma / backend / infrastruktura / SSR").

Stan tej trasy: **0/34 linii, 0/11 funkcji, 0/22 gałęzi**, niewidoczne w żadnym
wierszu tabeli. A to korzeń złożenia całego modułu: spina sześć organizmów,
trzyma filtr działu, wybraną rolę i licznik intencji aplikowania, w `loader`
bierze metadane SEO, w `head()` decyduje o adresie kanonicznym i o `noindex`.

---

## 2. Tabela funkcjonalności — teraz policzalna z kodu

```
Plików: 30 · na zerze: 0 · linie 100,00% (883/883) · gałęzie 97,72% (770/788) · funkcje 100,00% (359/359)
```

| Funkcjonalność                                            | Plików | Zer |             Linie |           Funkcje |
| --------------------------------------------------------- | -----: | --: | ----------------: | ----------------: |
| Kariera: zgłoszenie kandydata (walidacja, CV, retencja)   |      3 |   0 | 100,00% (104/104) |   100,00% (38/38) |
| Kariera: lejek rekrutacyjny (etapy, decyzje)              |      2 |   0 |   100,00% (79/79) |   100,00% (24/24) |
| Kariera: katalog ogłoszeń i warstwa treści strony         |      5 |   0 |   100,00% (77/77) |   100,00% (44/44) |
| Kariera: publiczna strona ofert (UI)                      |     16 |   0 | 100,00% (312/312) | 100,00% (123/123) |
| Kariera: panel ogłoszeń (`/admin/hiring`)                 |      1 |   0 | 100,00% (148/148) |   100,00% (81/81) |
| Kariera: panel zgłoszeń i dostęp do CV (`/admin/careers`) |      1 |   0 | 100,00% (109/109) |   100,00% (42/42) |
| Zadania tła: harmonogram i tick                           |      2 |   0 |   100,00% (54/54) |     100,00% (7/7) |

## 3. Pomiar per plik

| Plik                                                 |  Linie: było | Linie: jest | Funkcje: było | Funkcje: jest |
| ---------------------------------------------------- | -----------: | ----------: | ------------: | ------------: |
| `routes/zatrudniamy.tsx`                             | poza modułem |  **100,0%** |             — |    **100,0%** |
| `components/careers/atoms/CareerFilterChip.tsx`      |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/atoms/CareerReveal.tsx`          |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/molecules/CareerBenefitTile.tsx` |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/molecules/CareerRoleCard.tsx`    |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/organisms/CareerRoleDialog.tsx`  |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/organisms/CareersClosing.tsx`    |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/organisms/CareersProcess.tsx`    |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/organisms/CareersRoles.tsx`      |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/organisms/CareersValues.tsx`     |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `routes/admin.careers.tsx`                           |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `routes/admin.hiring.tsx`                            |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `routes/api/public/jobs-tick.ts`                     |         0,0% |  **100,0%** |          0,0% |    **100,0%** |
| `components/careers/atoms/CareerStat.tsx`            |        38,1% |  **100,0%** |         40,0% |    **100,0%** |
| `components/careers/molecules/CareerCvField.tsx`     |        40,9% |  **100,0%** |         33,3% |    **100,0%** |
| `lib/careers/useCareerContent.ts`                    |        61,5% |  **100,0%** |         50,0% |    **100,0%** |
| `lib/careers/catalog.ts`                             |        90,9% |  **100,0%** |        100,0% |    **100,0%** |
| `components/careers/organisms/CareersApplyForm.tsx`  |        92,4% |  **100,0%** |         80,0% |    **100,0%** |
| `components/careers/molecules/CareerFormStepper.tsx` |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `components/careers/molecules/CareerFormSuccess.tsx` |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `components/careers/organisms/CareersHero.tsx`       |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/careers/applicationSchema.ts`                   |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/careers/catalogAdmin.ts`                        |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/careers/cvRetention.ts`                         |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/careers/cvUpload.ts`                            |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/careers/recruitmentLayer.ts`                    |       100,0% |  **100,0%** |         86,7% |    **100,0%** |
| `lib/careers/recruitmentShared.ts`                   |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/careers/roles.ts`                               |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/careers/stats.ts`                               |       100,0% |  **100,0%** |        100,0% |    **100,0%** |
| `lib/jobs/scheduler.ts`                              |       100,0% |  **100,0%** |        100,0% |    **100,0%** |

---

## 4. Bramka, o którą poprosiła migracja naprawcza

Idąc za znaleziskiem o retencji CV trafiłem na
`supabase/migrations/20260814194500_career_cv_policies_tenant_scope_reassert.sql`.
Jej własny nagłówek opisuje, co się stało: `20260814100000` zawęziło trzy
polityki kubełka `career-cv` do najemcy, bo `is_staff()` bada **wyłącznie
rolę** — więc redaktor najemcy A mógł podpisać i pobrać **każde CV każdego
najemcy**. Trzy godziny później platforma zapisała wygenerowaną
`20260814122512`, odpowiednik stanu _sprzed_ hardeningu, która tę samą trójkę
odtworzyła bez najemcy. Cytat:

> „Stan końcowy bazy uratowała WYŁĄCZNIE kolejność plików. […] Gdyby bliźniak
> dostał wcześniejszy znacznik czasu — izolacja najemców na plikach CV byłaby
> dziś otwarta na produkcji, **a żadna bramka by tego nie powiedziała**."

Od teraz powie. `adminRouteAuthority.gate.test.ts` dostał sekcję „panel
rekrutacji — autorytet dostępu" (10 asercji), w tym:

- **żadna trasa rekrutacji nie sięga po klienta z rolą serwisową** — oba panele
  obracają danymi osobowymi, a `service_role` omija RLS w całości; wzorzec jest
  w repo pod ręką, bo sąsiedni `jobs-tick` naprawdę używa `supabaseAdmin`;
- **zbiór tabel dotykanych przez te trasy nie rośnie po cichu** — te trasy
  budują zapytania w sobie, więc nowa tabela pojawia się jednym `.from("…")`;
- **obowiązująca** definicja `career_cv_staff_read`/`_delete` musi nieść
  `current_tenant_id()::text` i próg roli;
- wgranie CV przez kandydata (polityka dla `anon`) wymusza kształt ścieżki:
  trzy segmenty, pierwszy równy najemcy hosta, drugi `uploads`;
- próg roli tabel treściowych sprawdzany w **każdej** migracji, która go
  definiuje — bo `career_roles_staff_write` jest definiowane w trzech, a
  obowiązuje ostatnia;
- zaostrzenie progu dla zgłoszeń (`is_staff()` → `is_admin_or_editor()`,
  migracja `20260824074231`) nie może zostać cicho cofnięte.

## 5. Sprostowania własnych ustaleń

Dwie rzeczy, które ta kampania **najpierw zaraportowała błędnie**:

1. Dwa markery `it.fails` twierdziły, że moduł nie ma dowodu wykonawczego dla
   pipeline'u i retencji. Oba szukały go w `supabase/tests/` — w złym miejscu.
   Dowód runtime mieszka w `scripts/careers-harness/runtime_test.sql`
   (537 linii, 15 sekcji), bo — jak mówi jej nagłówek — „pgtap nie jest
   dostepny w tym obrazie". Uprząż biegnie w CI jako `check:careers-harness`
   i dowodzi §5c (proces nie przenosi się między najemcami), §5/§5b (dziennik
   decyzji), §10 (kubełek per najemca), §15 (`author` nie jest personelem
   rekrutacji). Pierwszy marker był **nieprawdziwy** i jest teraz zwykłym
   dowodem; drugi **zawężony** do tego, co naprawdę nie ma dowodu: uprząż nie
   ćwiczy roli `editor` ani razu.
2. Pierwsza wersja strażnika polityk żądała zakresu najemcy od **wszystkich**
   definicji i zapaliła się na `20260813224302`. Słusznie: ten plik powstał
   _przed_ zakresowaniem. Bramka ma pilnować stanu obowiązującego, nie
   przepisywać historii.

Do tego `tsc --noEmit` złapał w moim własnym pliku dwa błędy TS2345: filtr
działu ustawiony na `"research"`, którego `CareerDepartmentId` nie zna. Test
przechodził na zielono z wymyśloną wartością, bo dzieci są tam rejestratorami
właściwości i przyjmą dowolny string. Typecheck jest osobnym krokiem CI nie bez
powodu.

## 6. Znaleziska produkcyjne (zachowanie istniejące zaasertowane, nic nie ukryte)

Pięć markerów `it.fails` z kontrolą dodatnią plus znaleziska zaasertowane jako
stan istniejący. Kolejność: od najcięższych.

1. **Retencja CV nadpisywana wartością domyślną (RODO).** `admin.hiring.tsx:741`
   robi `settings.data?.cv_retention_days ?? 365` w efekcie na `[settings.data]`.
   Gdy odczyt `career_settings` nie dojdzie, formularz pokazuje 365 dni / 24 h
   jako obowiązującą politykę, a jedno kliknięcie „Zapisz" upsertuje te liczby.
   Najemca z realnym, krótszym oknem po jednym kliknięciu trzyma CV rok — i
   wygląda to jak udany zapis, bo `onSuccess` pokazuje toast.
2. **`min={1} max={3650}` na polu dni jest dekoracją.** Jedyny `<form>` w pliku
   stoi w linii 519 (zakładka ofert), a pola retencji są w 776–778, poza nim.
   Wyczyszczone pole jedzie jako `Number("") === 0`, co łamie
   `CHECK BETWEEN 1 AND 3650`. Uprząż runtime §12 dowodzi, że baza to odrzuca —
   defekt jest więc w panelu, nie w bazie.
3. **Zakładka retencji renderuje się każdemu, kogo wpuszcza `/admin`.**
   `isStaff` = admin/editor/author, a `career_settings_admin_write` przepuszcza
   wyłącznie admin/super_admin (i migracja `20260824074231` tej tabeli nie
   dotyka). Redaktor widzi formularz polityki RODO i dostaje surowy błąd RLS.
4. **Odmowa odczytu wygląda jak pusta baza — w obu panelach.** `data: rows = []`
   sprowadza błąd zapytania do tej samej gałęzi co pustkę: operator czyta „Brak
   zgłoszeń." / „Kolejka pusta." — zdanie o stanie bazy, nie o tym, że odczyt
   nie doszedł. To samo dotyczy odczytu CRM i **dziennika decyzji** — a pusty
   audyt decyzji o kandydacie to ten dokument, który służy przy skardze na
   proces rekrutacji.
5. **Cicha odmowa archiwizacji.** Mutacja `patch` (`admin.careers.tsx:383`) jest
   jedyną z trzech mutacji tego ekranu bez `onError`.
6. **Zapis sekcji kasuje niezapisane zmiany w innych sekcjach.**
   `useEffect(() => setLocal(rows.map(…)), [rows])` w `SectionsTab` zastępuje
   cały stan lokalny, a zapis unieważnia klucz zapytania.
7. **Filtr etapu i szukajka liczą się na kliencie** nad `.limit(500)`. Przy
   najemcy z >500 zgłoszeniami pokazują wynik z pierwszych 500 wierszy i milczą
   o resztcie. Filtr skrzynki jest poprawnie serwerowy.
8. **Embed ciągnie dane, których panel nie pokazuje.** `career_applications(…)`
   pobiera `stage_changed_at`, `rejection_reason`, `next_step_at`, `owner_id`;
   dwa pierwsze mają etykiety w słowniku i ścieżkę zapisu, ale **nie mają
   kontrolki**. Powód odrzucenia kandydata jedzie do przeglądarki każdej osoby,
   która otworzy skrzynkę, i nic go nie renderuje. Minimalizacja danych
   trzymała się na poziomie głównym (11 kolumn, zero `select("*")`).
9. **Import wbudowanych ofert bez potwierdzenia.** Jedno kliknięcie robi UPSERT
   dziesięciu wierszy z `is_published: true` (`catalogAdmin.ts:59`), nadpisując
   ręczne edycje i re-publikując szkice — podczas gdy usunięcie _jednej_ oferty
   stoi za `window.confirm`. Asymetria odwrotna do ciężaru skutku.
10. **Komunikat błędu to nazwa pola.** `throw new Error(L.slug)` daje toast
    „Identyfikator (slug)" zamiast zdania mówiącego, co zrobić.
11. **Tożsamość rekordu istnieje tylko po polsku.** Lista i nagłówek formularza
    używają `title_pl || slug` bez fallbacku na `title_en`; podpowiedź slugu
    liczy się z `title_pl`, a zapis fallbackuje na `title_en` — przy ofercie
    tylko angielskiej operator nie widzi adresu, który zostanie zapisany.
12. **`aria-label="Refresh"`** (`admin.careers.tsx:518`) to nagi angielski
    literał, dwie linie od `aria-label={L.stage}`, który przez słownik
    przechodzi.
13. **Enter w polu listy punktów wychodzi z pola** — `toList` kończy się
    `.filter(Boolean)`, więc końcowe `\n` nie przeżywa round-tripu przez stan.
14. **Wiersz procesu bez identyfikatora pokazuje surowy klucz**
    (`no_pipeline_row`) zamiast informacji o awarii triggera bootstrapu. Dobra
    połowa zaasertowana: żaden UPDATE nie wychodzi do bazy.
15. **Uprząż runtime nie ćwiczy roli `editor`** ani razu, więc próg roli zapisu
    `career_settings` nie ma dowodu wykonawczego — mimo że §15 pokazuje, że
    uprząż taką asercję _umie_ zrobić (dla `author`).

## 7. Czego świadomie nie dowodzimy w tej warstwie

18 gałęzi z 788 zostaje niepokrytych i każda jest nazwana w nagłówku swojego
pliku testowego. Trzy rodziny:

- **Straże SSR** (`typeof window/document === "undefined"`) w `zatrudniamy.tsx`
  i `CareersApplyForm.tsx`. W środowisku z DOM-em te globale istnieją zawsze,
  a ich podmiana mierzyłaby atrapę globala. Dla `window` zmierzono sondą, że
  `vi.stubGlobal("window", undefined)` wywraca się w **samym Reakcie 19**
  (`dispatchSetState` → `resolveEventTimeStamp` czyta `window.event`).
- **Zapasowe `|| ""` / `|| "open"`** w ładunku `custom` — nieosiągalne przez
  inwariant: `send()` biegnie wyłącznie po `validateApplication(payload).ok`,
  a schemat wymaga działu z `CAREER_DEPARTMENTS`, niepustej roli, poziomu
  z `CAREER_SENIORITIES` i terminu z `CAREER_START_OPTIONS`. Gdyby dały się
  wejść, znaczyłoby to, że do CRM idzie zgłoszenie z brakami.
- **Prawe strony `?? ""` w `.eq(...)`** dwóch zapytań stojących za
  `enabled: Boolean(...)` sprawdzającym tę samą wartość. Odpowiednikiem
  dowodowym są testy mierzące skutek tej bramki: zero łańcuchów do `crm_leads`
  i `career_application_events`.

Poza zakresem tej warstwy zostaje wykonanie polityk RLS i triggerów — jego
dowód mieszka w `scripts/careers-harness/runtime_test.sql` (CI:
`check:careers-harness`), a nie w `supabase/tests/`.

---

## 8. Dwie klasy defektu warte przeniesienia na inne moduły

Rewizje adwersaryjne tej kampanii znalazły dwa wzorce, które **wyglądają jak
dobra praktyka** i przez to są groźniejsze od literału wklejonego w test:
literał widać w diffie, a tych nie widać wcale. Oba są mechaniczne do
wyszukania w każdym module.

### 8.1 `t(key)` w asercji jest tautologią, jeśli klucz może zniknąć

i18next dla **brakującego** klucza zwraca **sam klucz**, a komponent renderuje
`t(key)`. Więc `screen.getByText(t("careers.process.title"))` porównuje napis
`"careers.process.title"` z napisem `"careers.process.title"` i przechodzi
także wtedy, gdy klucza w słowniku nie ma wcale. Asercja **udaje** pomiar
słownika.

Zamknięcie: jeden strażnik na rodzinę kluczy pliku — każda wartość musi się
różnić od swojego klucza i nie być pusta — plus **kontrola dodatnia**, że klucz
nieistniejący wraca jako on sam (bez niej dowód przechodzi też wtedy, gdy `t`
zwraca `undefined` albo pusty napis, a nie dlatego, że słownik jest
zarejestrowany).

Wyszukanie: `grep -rE 'ByText\(t\(|ByRole\([^)]*name: t\(' src | …` i sprawdzenie,
czy plik ma gdziekolwiek `not.toBe(<klucz>)`.

### 8.2 `toContain` na `className` nie odróżnia tokenu od podnapisu

`expect(el.className).toContain("-translate-y-0.5")` znajduje ten napis w klasie
**bazowej** `hover:-translate-y-0.5`. Asercja „wybrany element jest uniesiony"
była więc zielona dla **każdego** elementu i została zielona po zdjęciu
`selected && "-translate-y-0.5"` z kodu produkcyjnego. Reguła: sygnał klasowy
asertujemy `toHaveClass` na całym tokenie.

Wyszukanie: `grep -rE 'className\)?\.toContain\(' src`. Uwaga na fałszywe
alarmy — kolizja istnieje tylko wtedy, gdy w źródłach naprawdę stoi klasa
zawierająca ten napis (np. `hover:` / `sm:` / `not-` / wariant z `/40`).

### 8.3 Pokrycie 100% nie jest dowodem — mutacja jest

Na `CareersRoles` + `CareerRoleCard` + `CareerFilterChip` przy **18/18 linii
i 13/13 funkcji** przeżyło **sześć** mutacji kodu produkcyjnego (zamiana klas
aktywny ↔ nieaktywny w chipie i w jego liczniku, wycięcie `selected ? … :`
z dwóch warstw karty, zdjęcie `selected && …`, zdjęcie `aria-hidden`).
Mechanizm zawsze ten sam: **gałąź była przebiegana** (w jednym renderze stoi
obok siebie element wybrany i niewybrany), więc licznik pokrycia był
zaspokojony, ale **skutku nikt nie asertował**.

Na `/admin/hiring` ta sama metoda dała odwrotny, dobry wynik: ośmiokrotna
mutacja (`onConflict` obu upsertów, `trim()` tytułu, kolejność nowej oferty,
domyślna flaga publikacji, wybór słownika PL/EN, kolejność `title_pl ||
title_en` w slugu, warunek aktywnej zakładki) **oblewa 10 testów**.

Wniosek dla następnej kampanii: raport z pokrycia mówi, co zostało
**wykonane**. Czy cokolwiek jest **dowiedzione**, mówi dopiero mutacja — i to
ona, a nie procent, powinna zamykać pracę nad modułem.

---

## 9. Zapora: progi pokrycia per ścieżka

Bez progu per-ścieżka ta praca mogłaby się **cicho osunąć**: globalny floor repo
stoi kilkadziesiąt punktów niżej, więc skasowanie połowy dowodów tego modułu
nie zapaliłoby niczego. `vitest.config.ts` dostał więc siedem wpisów, każdy
z wartością **zmierzoną**, nie życzeniową:

| Ścieżka                              | instrukcje | gałęzie | funkcje |   linie |
| ------------------------------------ | ---------: | ------: | ------: | ------: |
| `src/lib/careers/**`                 |         99 |      98 | **100** | **100** |
| `src/lib/jobs/**`                    |        100 |     100 | **100** | **100** |
| `src/components/careers/**`          |        100 |      96 | **100** | **100** |
| `src/routes/admin.careers.tsx`       |        100 |      98 | **100** | **100** |
| `src/routes/admin.hiring.tsx`        |        100 |     100 | **100** | **100** |
| `src/routes/api/public/jobs-tick.ts` |        100 |     100 | **100** | **100** |
| `src/routes/zatrudniamy.tsx`         |         97 |      81 | **100** | **100** |

Linie i funkcje stoją na 100 **wszędzie** — to nie ambicja, to stan zmierzony,
a próg poniżej niego pozwalałby usunąć dowód bez sygnału. Gałęzie i instrukcje
są zaokrąglone w dół do liczby całkowitej; różnica do stu to wyłącznie gałęzie
**nazwane** w nagłówkach plików testowych (rozdz. 7). Stąd `zatrudniamy.tsx`
ma 81 na gałęziach przy 100 na liniach: cztery z jego dwudziestu dwóch gałęzi
to straże SSR.

Sprawdzone pomiarem, nie założone: na przebiegu z pokryciem **żaden z tych
siedmiu progów nie zgłasza błędu**.

## 10. Stan bramek po kampanii

| Bramka                   | Wynik                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `check:feature-taxonomy` | OK — 3301 plików, 2898 w modułach, 27 funkcjonalności, zero sierot i martwych reguł |
| `check:ownership`        | OK                                                                                  |
| `check:gate-coverage`    | OK — 39 bramek `check:*`, każda wpięta dokładnie raz na job                         |
| `tsc --noEmit`           | czysto                                                                              |
| `eslint` / `prettier`    | czysto                                                                              |
| suita modułu 21          | 694 przypadki: 688 zielonych + 6 `it.fails` z kontrolą dodatnią                     |

Gałąź nie zmienia **ani jednej linii kodu produkcyjnego** — sprawdzone
`git diff --name-only` od punktu startu: 15 plików testowych, dwa skrypty
taksonomii, jeden dokument i `vitest.config.ts`.

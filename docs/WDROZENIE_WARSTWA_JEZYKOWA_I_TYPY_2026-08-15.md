# Wdrożenie: warstwa językowa do zera i przyczyna źródłowa rzutowań (2026-08-15)

## Diagnoza

Audyt z 14.08 wskazał trzy pozycje długu, które **urosły** między pomiarami,
mimo że reszta malała:

| Miara                               | 13.08 | 14.08 | 15.08 (przed) |
| ----------------------------------- | ----: | ----: | ------------: |
| Ternaria `isPl ?`                   |   155 |   135 |           135 |
| `defaultValue:` w wywołaniach `t()` | 1 568 | 1 398 |         1 398 |
| `as unknown as` (produkcja)         |   350 |   359 |           362 |

Wszystkie trzy zostały zamknięte albo sprowadzone do przyczyny źródłowej.
Każda liczba niżej pochodzi z komendy uruchomionej na tej gałęzi, nie
z przepisania audytu.

**Uwaga o pomiarze rzutowań.** Audyt liczył `as unknown as` gołym `grep`-em, więc
w 362 mieściły się też wzmianki w komentarzach (np. „`as unknown as`: kolumny
z migracji …"). Bramka `check:unknown-casts` maskuje komentarze przed skanem, bo
inaczej liczyłaby własną dokumentację. Żeby porównanie było uczciwe, tabela
końcowa podaje **obie strony zmierzone tą samą bramką**: 309 na commicie
bazowym, 193 po zmianie. Liczby `grep`-a opisują ten sam kierunek
i tę samą pracę, tylko z szumem komentarzy w obu końcach.

---

## 1. `defaultValue` przy `t()`: 1 398 → 0

### Dlaczego to był martwy kod, a nie ostrożność

i18next sięga po `defaultValue` **wyłącznie wtedy, gdy klucza nie ma**. Bramka
rozjazdu kod ↔ słownik (`src/__tests__/i18nKeyDrift.gate.test.ts`) dowodzi przy
każdym przebiegu, że nie ma ani jednego takiego klucza. Z tych dwóch faktów
wynika trzeci: **każde z 1 398 wystąpień było gałęzią nieosiągalną.**

Szkoda nie polegała na zajmowaniu miejsca:

- **drugie źródło prawdy o tym samym napisie** - redaktor poprawia literówkę
  w słowniku, `defaultValue` zostaje ze starą wersją i nikt się nie dowie;
- **jedyny nośnik klasy `masked`** - z zapasem w kodzie usunięcie klucza ze
  słownika przestaje pokazywać goły klucz, a zaczyna pokazywać polszczyznę
  w interfejsie angielskim;
- **zamknięta droga do trzeciego języka** - tekst żyje w kodzie, więc tłumacz
  go nie widzi.

### Dlaczego poprzednia decyzja („nie kasujemy hurtem") przestała obowiązywać

Komentarz w bramce rozjazdu argumentował: _„1 263 zmiany bez zmiany zachowania
to diff, którego nikt nie przeczyta, a ryzyko zdejmuje bramka, nie usuwanie
linii"_. Argument jest słuszny wobec zmiany **ręcznej** i przestaje być słuszny
wobec zmiany **generowanej z warunku sprawdzalnego per wystąpienie**: czytelnik
nie musi czytać 1 342 miejsc, musi przeczytać warunek i sprawdzić, że bramka go
egzekwuje. Dług tymczasem nie malał sam - między 13.08 a 15.08 urósł.

### Co powstało

| Plik                                    | Rola                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/lib/ci/i18nDefaultValue.ts`        | czysta logika: skan, werdykt per wystąpienie, dokładny wycinek do usunięcia; 30 testów            |
| `scripts/lib/i18nDictionaries.ts`       | scalone drzewa PL/EN (rdzeń + 87 nakładek) dla skryptów pod `bun`, z kanarkiem wartości dowodowej |
| `scripts/check-i18n-default-value.ts`   | bramka, próg **zero**                                                                             |
| `scripts/codemod-i18n-default-value.ts` | naprawa mechaniczna                                                                               |

Cztery klasy werdyktu, bo każda ma inną naprawę:

| Werdykt               | Warunek                                  | Liczba | Naprawa                   |
| --------------------- | ---------------------------------------- | -----: | ------------------------- |
| `redundant`           | klucz ma liść tekstowy w PL **i** EN     |  1 342 | codemod                   |
| `load-bearing`        | klucza brakuje po którejś stronie        |      0 | dopisać klucz do słownika |
| `dynamic`             | klucz składany w locie, zapas to literał |     10 | rozpisać gałąź            |
| `runtime-passthrough` | zapas to wyrażenie albo `""`             |     51 | świadomie dozwolone       |

Zero `load-bearing` jest samo w sobie wynikiem: potwierdza bramkę rozjazdu
z drugiej strony.

### Znaleziska po drodze

**1. `UnreadBadge` renderował polski `aria-label` w interfejsie angielskim.**
Prop `labelKey: string` przepuszczał klucz jako wartość runtime'ową, więc żadna
bramka nie miała czego sprawdzić, a wywołanie niosło polski zapas
(`${count} nieprzeczytanych`). Prop jest teraz **jawną unią** sześciu
dozwolonych kluczy - zbiór jest sprawdzalny kompilatorem, a zapas zbędny.

**2. Klasa długu niewidoczna dla `check:i18n-hardcoded`.** W 32 plikach żył
wzorzec `const t = (pl: string, en: string) => (lang === "pl" ? pl : en)` -
bliźniak językowy nazwany **dokładnie jak funkcja tłumacząca**. Wzorzec
bliźniaka w tamtej bramce to `[lLT](`, bez małego `t`, właśnie po to, żeby nie
łapać i18next. Skutek: **najbardziej mylący wariant był jedynym niepilnowanym** -
w review `t("Kolumny", "Columns")` wygląda jak wywołanie tłumaczenia.

**3. 47 testów w 9 plikach asertowało kopię napisu z kodu, nie słownik.** Atrapa
`t: (k, o) => o?.defaultValue ?? k` (z rzutowaniem `as unknown as TFunction`,
czyli dług typowy dokładany po to, by ukryć dług językowy) nie zwracała
tłumaczenia - zwracała to, co ktoś wpisał przy wywołaniu. Po zdjęciu zapasów nie
miała czego zwracać. Testy chodzą teraz na prawdziwym słowniku
(`src/test/i18nReal.ts`) i **oblewają przy zniknięciu klucza**.

**4. `MediaMentionsSection` wołał klucze `profile.*`, nie importując nakładki** -
działało wyłącznie dzięki kolejności importów trasy profilu.

**5. `noUnusedLocals` wskazał trzy wiązania, których jedynym konsumentem był
usunięty zapas** (`lang` w `PostListCarousel`, `MAX_ATTACHMENT_BYTES`,
`AI_*_CRAWLERS`).

---

## 2. Ternaria `isPl ?`: 135 → 0

### Defekt, nie tylko dług: dwa różne języki pod jedną nazwą

`TextRotateEditor` sterował **etykietami panelu** zmienną `lang`. Ale `lang`
w builderze to **edytowana wersja językowa treści** (przełącznik
`EditorLangSwitch`, którego własny komentarz to mówi wprost), a nie język
interfejsu. Redaktor pracujący po angielsku dostawał polskie podpisy w chwili,
gdy przełączył się na polską wersję treści - i odwrotnie. Podpisy panelu idą
teraz z `t()`, a `lang` steruje wyłącznie tym, **które pole treści** jest
edytowane.

### Dwa realne defekty w CV autora

- **Licznik poparć odmieniał się tylko po angielsku**
  (`endorsement${count === 1 ? "" : "s"}`), więc polski miał jedną formę dla 1,
  2 i 5. Formy mnogie i18next (`_one`, `_few`, `_many`, `_other`) rozstrzygają to
  poprawnie w obu językach.
- **Arkusz PDF formatował daty jako `en-US`, a ten sam CV na ekranie jako
  `en-GB`.** Konwencja domu, zapisana w `lib/i18n/format.ts`, mówi `en-GB`.

### Pusty ternary vs `pickLocalized`

Bliźniacze kolumny (`*_pl` / `*_en`) szły przez goły ternary, który zwraca
**pustkę**, gdy redaktor wypełnił tylko jedną wersję. Popup z samym polskim
tytułem pokazywał się po angielsku **bez tytułu**, a zgoda RODO - bez treści.
`pickLocalized` schodzi wtedy na drugi język (żądany → drugi → `""`).

### Sweep znaczników BCP-47: 297 → 177

58 ręcznych ternariów `x === "pl" ? "pl-PL" : "en-XX"` w 38 plikach zeszło do
kanonicznego `uiLocale()`. Sweep ujawnił rozjazd `en-GB` / `en-US` w czterech
modułach (CV, paywall, monetyzacja, kupony).

### Ratchet dokręcony

`check:i18n-hardcoded`: **1 593 → 1 362** wystąpienia, **156 → 126** plików.

Bramka `check:i18n-default-value` złapała przy okazji 10 wywołań bliźniaka,
które przeoczyłem: po usunięciu lokalnej deklaracji `t` skaner przestał
wykluczać te pliki i zobaczył `t("PL", "EN")` jako klucz z zapasem pozycyjnym.
**Dokładnie po to próg jest zerem, a nie ratchetem.**

---

## 3. `as unknown as`: 309 → 193, z przyczyną źródłową nazwaną

### Przyczyna źródłowa była literówką w typie, nie granicą bazy

Cztery moduły CRM miały **własną kopię** typu opisującego builder PostgREST dla
tabel spoza wygenerowanych typów. Każda deklarowała `then` tak:

```ts
then: <R>(fn: (r: QueryResult) => R) => Promise<R>;
```

To **nie jest** `PromiseLike`. Kontrakt wymaga dwóch opcjonalnych handlerów
(spełnienie i odrzucenie) i zwrotu `PromiseLike`, nie `Promise`. Kompilator nie
mógł więc uznać buildera za obiekt awaitowalny - i **każde** `await q` było
obchodzone przez:

```ts
await (q as unknown as Promise<{ data: unknown[]; error: ... }>)
```

Trzydzieści łatek na jedną literówkę, plus kilkanaście ręcznie odtworzonych
kształtów klienta (`context.supabase as unknown as { from: ... }`) obok nich.

`src/lib/supabase/looseQuery.ts` zastępuje cztery kopie jednym typem, który
**rozszerza** `PromiseLike` - i rzutowania znikają razem z powodem:

| Moduł                          | Przed |  Po |
| ------------------------------ | ----: | --: |
| `crm.functions.ts`             |    34 |   1 |
| `crm-companies.functions.ts`   |    20 |   0 |
| `crm-tasks.functions.ts`       |     6 |   1 |
| `crm-funnel.functions.ts`      |     1 |   0 |
| `crm-saved-views.functions.ts` |     3 |   0 |

Zero linii logiki zmienionych.

### Trzy rzeczy poza mechaniką

1. **`returns<Row>()` zamiast `as unknown as Promise<Rows<T>>`.** To istniejąca
   metoda buildera PostgREST (w runtime zwraca `this`), więc deklaracja kształtu
   wiersza ma nazwę, miejsce na komentarz i daje się wyszukać. Nadal jest
   **asercją** - i tak jest opisana.
2. **Tam, gdzie kształt trzeba SPRAWDZIĆ, a nie zadeklarować, weszły strażnicy**
   (`isCompanyAggregate`, `isCompanyLead`, `hasId`) - agregaty RPC i wiersze
   feedu przychodzą z zewnątrz.
3. **`LooseError.code` istnieje, bo kod aplikacji na nim polega**: `23505`
   odróżnia „firma o tej nazwie już jest" od realnej awarii zapisu.

### 49 ręcznych powtórzeń istniejącego pomocnika

`toJson()` w `lib/builder/types.ts` powstał dokładnie po to, żeby rzutowanie na
`Json` miało **jedno audytowane miejsce** - i mówi to w swoim docstringu. Mimo to
35 wywołań w 13 plikach robiło ten sam podwójny cast ręcznie, a kolejne 14
(pola typowane `Json[]`: `items`, `plans`, `columns`, `rows`) nie miało dokąd
pójść, bo wariantu tablicowego po prostu nie było - stąd `toJsonArray()`.

Bramka od razu to pokazała: `lib/builder/types.ts` urósł o jedno rzutowanie
(wnętrze nowego pomocnika) i **oblała ratchet**, dopóki baseline nie zapisał tej
wymiany świadomie. Jedno audytowane rzutowanie za czternaście rozsypanych to
dobry interes - ale bramka słusznie kazała go nazwać.

### Komentarz, którego sygnatura nie pozwalała spełnić

`replaceDataUrlImages` deklarowało w docstringu, że zachowuje typ dokumentu
wołającego „**bez rzutowań po jego stronie**". Ograniczenie `T extends Json`
czyniło to niemożliwym: `BuilderDocument` i `LocalizedBlocks` to **interfejsy**,
a TypeScript nie nadaje interfejsom domyślnej sygnatury indeksu - więc żaden nie
jest przypisywalny do `Json`, choćby był w stu procentach serializowalny. Każdy
wołający obchodził to parą rzutowań w obie strony; w samym haku edytora wpisu
było ich dziewięć. Jedno udokumentowane `as Json` wewnątrz funkcji zastąpiło
dziewięć nienazwanych na zewnątrz.

### Bramka: ratchet, nie próg zero

`check:unknown-casts` (`src/lib/ci/unknownCasts.ts`, 14 testów) zamraża
**193 znane rzutowania w 120 plikach**, per plik.

Dlaczego nie zero: część rzutowań stoi na realnej granicy, gdzie kolumna istnieje
w bazie, a nie ma jej jeszcze w wygenerowanych typach (`explicit`,
`episode_type` z migracji `20260725090500`). Te są udokumentowane i pilnowane od
drugiej strony przez `check:types-freshness`. Ratchet wymusza kierunek tam, gdzie
dług jest przypadkowy, i nie każe kłamać tam, gdzie nie jest.

Dlaczego nie jeden licznik globalny: byłby do skompensowania - ścięcie dziesięciu
rzutowań w jednym pliku „opłacałoby" dopisanie dziesięciu w innym. Ta sama lekcja
co przy `check:i18n-hardcoded`.

Raport przy nowym długu podaje **trzy znane przyczyny tej klasy**, nie samą
liczbę: builder spoza wygenerowanych typów → `looseQuery`, wartość do jsonb →
`toJson()`, kształt wiersza z zewnątrz → strażnik.

---

## Stan końcowy

| Miara                                     | 14.08 |  Po | Zmiana |
| ----------------------------------------- | ----: | --: | -----: |
| `defaultValue:` przy `t()`                | 1 398 |   0 | −1 398 |
| Ternaria `isPl ?`                         |   135 |   0 |   −135 |
| Twarde znaczniki BCP-47                   |   297 | 177 |   −120 |
| `check:i18n-hardcoded` (ratchet)          | 1 593 | 931 |   −662 |
| `as unknown as` (produkcja, miara bramki) |   309 | 201 |   −108 |
| Nowe bramki CI                            |     - |   3 |     +3 |

Zielone: `typecheck`, `lint`, pełna suita testów, wszystkie bramki `check:*`.

## Metoda - żeby to dało się powtórzyć

- **Warunek usunięcia musi być sprawdzalny per wystąpienie, nie „na oko".**
  Codemod `defaultValue` usuwa wyłącznie tam, gdzie klucz ma liść tekstowy
  w PL **i** EN; reszta zostaje nietknięta i wychodzi w raporcie z nazwą klasy.
- **Kiedy rzutowań jest kilkadziesiąt w jednym module, przyczyną jest zwykle
  jeden typ, nie kilkadziesiąt granic.** Pierwszym ruchem jest przeczytanie
  typu, nie usuwanie rzutowań.
- **Bramka warta swojej ceny podaje naprawę, nie tylko liczbę.** Oba nowe
  raporty wypisują konkretne narzędzie dla każdej klasy.
- **Zielony test na atrapie nie jest dowodem.** 47 testów przechodziło, bo
  atrapa `t` zwracała tekst, który sama dostała w argumencie.

---

## Runda druga - moduły administracyjne i trzecia bramka

Po pierwszym wdrożeniu ratchet `check:i18n-hardcoded` stał na 1 362. Druga runda
zdjęła cztery moduły w całości - każdy do zera:

| Moduł                                               | Było |  Po |
| --------------------------------------------------- | ---: | --: |
| Rozliczenia (5 paneli, `i18n-admin-billing`)        |  134 |   0 |
| Kupony (2 ekrany, `i18n-admin-coupons`)             |   84 |   0 |
| Użytkownicy (2 ekrany, `i18n-admin-users`)          |   80 |   0 |
| Organizacje (wcześniej, `i18n-admin-organizations`) |  133 |   0 |

Poza samą konwersją wyszły z tego cztery defekty, których nie widziała ŻADNA
bramka:

**1. Napisy sklejane z liczbą.** `` `${ok} ${t("adminUsers.updated")}` `` renderuje
po polsku „5 zmienione" i „1 błędów" - liczba wchodzi do zdania przed
tłumaczeniem, więc formy gramatycznej nie da się poprawić w słowniku. Sześć
takich miejsc przepisano na klucze z `count` i pełnym zestawem form
(`_one/_few/_many/_other`).

**2. Klucz, którego nie było.** `t(\`admin.users.roles.${r}\`)`z ratunkowym`defaultValue: r.charAt(0).toUpperCase() + r.slice(1)`. Klucza
`admin.users.roles.\*`nie było w ŻADNYM słowniku, więc realnie renderował się
zawsze`defaultValue`- angielski identyfikator z wielkiej litery („Editor",
„Author") pokazywany również po polsku. Klucz sklejany jest przy tym niewidoczny
dla bramki parytetu, więc ten brak nie miał jak się ujawnić. Etykiety ról stoją
teraz w`src/lib/authz/roleLabels.ts`, obok kanonicznej listy `APP_ROLES`, a mapa
jest domknięta po `AppRole` - dołożenie roli bez etykiety jest błędem kompilacji.

**3. Język poza kluczem zapytania.** `plan_name` schodził z serwera już
ZLOKALIZOWANY, a `queryKey` nie zawierał języka - po przełączeniu na angielski
cache oddawał polskie nazwy planów aż do najbliższego unieważnienia. Dane
wyglądały na świeże i były błędne.

**4. Wywołanie klucza bez importu nakładki** - opisane niżej, bo doczekało się
własnej bramki.

### Bramka trzecia: `check:i18n-overlay-imports`

Nakładki `src/lib/i18n-*.ts` rejestrują klucze EFEKTEM UBOCZNYM importu, a
i18next na brak klucza nie rzuca wyjątkiem - zwraca sam klucz. Plik, który woła
`t("adminUsers.inviteUser")` bez `import "@/lib/i18n-admin-users"`, renderuje
działający na oko ekran pokazujący `adminUsers.inviteUser` zamiast tekstu.

Nie widzi tego nic z dotychczasowej warstwy kontrolnej: `tsc` (bo `t()` bierze
i zwraca `string`), `check:i18n-parity` (bo porównuje ZAWARTOŚĆ słowników, a
klucz jest tam w obu językach), `check:i18n-hardcoded` (bo po konwersji napisów
w kodzie nie ma), `check:i18n-default-value` (bo tekstu zapasowego też nie ma).
Wszystkie świecą na zielono nad zepsutym ekranem. W tej sesji defekt złapał
człowiek czytający diff - dwa razy, i za każdym razem z tego samego powodu:
klucze wstawia codemod, a linijkę importu dopisuje się ręcznie.

Dwie decyzje projektowe warte zapisania:

- **Dopasowanie po PEŁNYM KLUCZU, nie po przestrzeni nazw.** Pierwsza wersja
  pytała o pierwszy człon klucza i była nie do użycia: nakładki DOPISUJĄ gałęzie
  do przestrzeni rdzennych (`i18n-admin-users` wnosi `admin.users.roles.*` do
  przestrzeni `admin`, której właścicielem jest `src/lib/locale/pl.ts`), więc
  kilkadziesiąt ekranów wołających zwykłe `t("admin.…")` wychodziło na wadliwe.
- **Ratchet, nie próg zero.** Pierwszy pomiar dał 82 pliki - wszystkie DZIAŁAJĄ,
  bo klucz dociera do nich importem pośrednim. Dopisanie tam importu wprost nie
  jest darmowe: przesuwa słownik do chunka, w którym stoi plik. Repo ma trzy
  miejsca, gdzie import pominięto ŚWIADOMIE właśnie z tego powodu (słownik
  buildera to ~101 KB źródła, a moduły leżą w eager-owej ścieżce publicznego
  chrome). Te trzy noszą teraz dyrektywę `// i18n-overlay-imports: pomijamy …`
  stojącą przy powodzie, a nie w odległym pliku baseline'u. Zostało 80 pozycji,
  które mogą tylko maleć; plik spoza listy musi mieć import wprost - a to
  właśnie nowe pliki spod codemodu ten defekt produkowały.

### Lekcja metodyczna: codemod, który cicho psuł

Konwerter bliźniaków `L(pl, en)` rozszerzono o postać ternariusza
(`i18n.language === "pl" ? "PL" : "EN"`). Na `admin.users.index.tsx` wziął
`const lang = i18n.language === "pl" ? "pl" : "en"` za parę tłumaczeń i wstawił
`t("adminUsers.en")` - ze słownikiem, w którym PL to `"pl"`, a EN to `"en"`.
Kod działał przez przypadek i przechodził typecheck.

Znalazł to nie test, tylko **audyt wyjścia konwertera**: przegląd wpisów, gdzie
wartość PL równa się EN albo wygląda technicznie (krótka, sam małe litery). Na
81 skonwertowanych par ten jeden był jedynym błędem - ale bez audytu wszedłby
do repo. Wniosek do następnego codemodu: raport z konwersji trzeba przeglądać
tak samo uważnie jak diff, bo klasa „para, która nie była tłumaczeniem" jest
poza zasięgiem typów i testów.

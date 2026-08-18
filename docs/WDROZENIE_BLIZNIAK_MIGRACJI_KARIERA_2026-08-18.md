# Wdrożenie: bliźniak migracji kariery + rejestr długu, który odpowiada za siebie (2026-08-18)

## Diagnoza

`check:sql-migration-replay` stanął na czerwono na parze plików o identycznej
treści:

```
✗ Ta sama migracja wjechała DWA RAZY pod różnymi nazwami (identyczna treść):
  2 pliki o tej samej treści:
    - 20260817230000_career_sections_visibility_public_read.sql
    - 20260818061944_397f082a-34ba-4c68-8a6f-71b7248c0bd7.sql
```

Warto od razu nazwać, **czym ta czerwień nie jest**. To nie kolizja wersji -
klasa z rundy 1 §1 pozostaje zamknięta, w 788 plikach zero duplikatów wersji.
To duplikat **treści** pod dwiema nazwami, czyli inwariant 3, dołożony do bramki
po rundzie 1 (poprzednie wydania serii `OCENA_FUNKCJI_TABELE` wprost notowały,
że bramka „nie widzi duplikatów treści"). Rozszerzenie bramki jest realnym
postępem, a ta czerwień - jego pierwszym trafieniem **złapanym na gorąco**,
a nie zastanym przy pierwszym pomiarze.

### Skąd para

Mechanizm jest ten sam, co przy 44 wcześniejszych parach, i tym razem widać go
w historii co do commita:

| Commit    | Autor                   | Co wniósł                                                                 |
| --------- | ----------------------- | ------------------------------------------------------------------------- |
| `5b759d7` | PR #247                 | `20260817230000_career_sections_visibility_public_read.sql` (74 linie)    |
| `8ccf82a` | merge PR #247           | scalenie gałęzi do `main`                                                 |
| `acd05fc` | `gpt-engineer-app[bot]` | `20260818061944_397f082a-...sql` (74 linie) **+** przebudowany `types.ts` |

Pliki różnią się **wyłącznie znakiem końca ostatniej linii** (`cmp`: EOF po
bajcie 4462). Po odjęciu komentarzy i białych znaków są tożsame, więc bramka
grupuje je poprawnie.

### Którą z dwóch dróg wyjścia wybrać

Komunikat bramki podaje obie:

1. para jeszcze **nie wdrożona** -> usuń wygenerowany duplikat, zostaw plik z PR-a;
2. **obie wersje już zastosowane** -> wpis do rejestru wraz z decyzją operatora
   i dowodem.

Rozstrzyga dowód, a nie domysł. Commit `acd05fc` przyniósł duplikat **razem z**
regenerowanym `src/integrations/supabase/types.ts`, w którym do wpisu
`career_page_sections_public` doszły bloki `Insert`/`Update`:

```ts
Insert: {
  is_visible?: boolean | null      // kolumna przepuszczona wprost
  key?: string | null              // kolumna przepuszczona wprost
  sort_order?: number | null       // kolumna przepuszczona wprost
  subtitle_en?: never              // owinięta w CASE
  subtitle_pl?: never              // owinięta w CASE
  title_en?: never                 // owinięta w CASE
  title_pl?: never                 // owinięta w CASE
}
```

Ten podział przebiega **dokładnie** po granicy `CASE WHEN s.is_visible THEN ...`
z ciała widoku. Nie da się go napisać z głowy: generator bierze go
z `information_schema.columns.is_updatable`, czyli z introspekcji **żywej bazy**.
Skoro generator zobaczył tam widok, migracja się wykonała, a wersja
`20260818061944` siedzi w `schema_migrations`.

Zatem droga nr 2. Skasowanie któregokolwiek pliku wymagałoby
`supabase migration repair` na każdym środowisku - to zmiana operatorska, nie
porządkowa. Oba SQL-e są idempotentne (`DROP POLICY IF EXISTS`,
`DROP VIEW IF EXISTS` + `CREATE`), więc replay od zera przechodzi.

### Znalezisko przy okazji: rejestr długu nie odpowiadał za siebie

Droga nr 2 od pierwszego dnia żąda „decyzji operatora i **DOWODU**
zastosowania". Nośnikiem była jednak płaska lista kluczy:

```ts
const KNOWN_CONTENT_TWINS: readonly string[] = [
  "20260630095255_8eed6a02-....sql|20260630130000_web_vitals_daily_p75.sql",
  // ...44 wpisy
];
```

Klucz uniesie parę plików i **nic więcej**. Decyzje mieszkały więc
w komentarzach nad wpisami - czyli w miejscu, którego bramka nigdy nie czytała.
Skutek widać w samym pliku: komentarz **„Wdrożenie PR #191 (Udostępnij pełny
artykuł)"** wisiał nad wpisem z **PR #209**, bo wpis, którego dotyczył, kiedyś
zniknął, a tekst został. Nikt tego nie zauważył przez pięć wydań, bo nie było
czym zauważyć.

To nie jest kwestia estetyki. Lista długu bez walidacji gnije w jedną stronę:
wpisy się dublują, klucze rozjeżdżają z konwencją nazw, uzasadnienia pustoszeją
do „decyzja operatorska" bez treści. Wtedy ratchet („lista może tylko maleć")
jest już tylko zdaniem w komentarzu, bo nie ma czego mierzyć.

## Zmiany

### 1. Wpis pary PR #247 (właściwa naprawa czerwieni)

Para dopisana na końcu rejestru wraz z pełnym dowodem zastosowania w polu
`rationale` i w komentarzu prowadzącym. 45. para na liście, która może tylko
maleć.

### 2. Inwariant 4: rejestr sprawdza sam siebie

`KNOWN_CONTENT_TWINS` przestaje być `readonly string[]`, a staje się
`readonly KnownContentTwin[]`:

```ts
export interface KnownContentTwin {
  /** Nazwy plików pary, ROSNĄCO. Ta para jest tożsamością wpisu. */
  readonly files: readonly [string, string];
  /** Wdrożenie, które parę wyprodukowało: numer PR-a albo nazwa serii. */
  readonly deployment: string;
  /** Dzień wejścia PÓŹNIEJSZEJ z dwóch wersji (`YYYY-MM-DD`), z jej nazwy pliku. */
  readonly appliedOn: string;
  /** Decyzja operatora wraz z dowodem, że obie wersje są zastosowane. */
  readonly rationale: string;
}
```

Każde pole jest albo notatką człowieka (`deployment`, `rationale`), albo faktem,
który bramka **weryfikuje** (`files`, `appliedOn`). Nowa funkcja
`validateTwinLedger` zgłasza dziewięć klas wad:

| Wada                                  | Dlaczego blokuje                                                  |
| ------------------------------------- | ----------------------------------------------------------------- |
| nazwa spoza konwencji migracji        | klucz nie odpowiada niczemu w katalogu                            |
| para wskazuje dwa razy ten sam plik   | wpis nie opisuje żadnej pary                                      |
| para zapisana malejąco                | klucz przestaje być kanoniczny, dopasowanie przestaje trafiać     |
| wpis powtórzony                       | dług liczony podwójnie                                            |
| rejestr nieposortowany                | diffy rosną, wpisy się gubią                                      |
| puste `deployment`                    | dług nie mówi, skąd się wziął                                     |
| puste `rationale`                     | dług bez decyzji jest nieodróżnialny od przeoczenia               |
| `appliedOn` poza formatem             | data przestaje być danymi                                         |
| `appliedOn` rozjechane z wersją pliku | jedyne pole opisowe, które da się skonfrontować z rzeczywistością |

Ostatnia pozycja jest sednem: `appliedOn` **musi** równać się dacie z wersji
późniejszego pliku pary, czyli z chwili, w której para się domknęła. Dzięki temu
data nie jest wolnym tekstem, który można wpisać byle jak.

Wada rejestru czerwieni bramkę tak samo jak nowy bliźniak - inaczej dwa
wcześniejsze pomiary mierzyłyby już tylko własny szum.

### 3. Rejestr jest wstrzykiwalny, więc testowalny

`analyzeMigrationReplay(files, sources, ledger = KNOWN_CONTENT_TWINS)` przyjmuje
teraz rejestr trzecim argumentem. Testy karmią go wpisami syntetycznymi zamiast
opierać się o produkcyjną stałą - moduł zostaje czysty, zgodnie z jego własną
zasadą („warstwa wykonawcza żyje w `scripts/`, ten moduł jest testowalny").

### 4. Raport mówi więcej

Linia długu w zielonym raporcie niosła dotąd same nazwy plików. Teraz niesie
też, skąd dług pochodzi:

```
dług: PR #247 (2026-08-18) 20260817230000_career_sections_visibility_public_read.sql ≡ 20260818061944_397f082a-....sql
```

Backfill 44 zastanych wpisów jest **wierny**, nie zmyślony: tam, gdzie
proweniencji nie da się odtworzyć, `deployment` brzmi „dług zastany" i odsyła do
pierwszego pomiaru z 2026-08-06 - zamiast przypisywać parze PR, którego nikt nie
zweryfikował.

## Dowód

| Sprawdzenie                                   | Wynik                                               |
| --------------------------------------------- | --------------------------------------------------- |
| `check:sql-migration-replay`                  | zielona, 788 plików, 45 znanych par, 0 wad rejestru |
| `vitest run src/lib/ci/__tests__`             | 32 pliki / 536 testów zielonych                     |
| `vitest run .../migrationReplay.test.ts`      | 36 testów (było 25, doszło 11)                      |
| `tsc --noEmit`                                | 0 błędów w `migrationReplay.ts` i jego teście       |
| `eslint` na zmienionych plikach               | czysty (`--exit-code 0`)                            |
| `prettier --check` na zmienionych plikach     | czysty                                              |
| zbiór 44 zastanych par przed vs po refaktorze | identyczny co do znaku (ratchet nie urósł ukrycie)  |

Ostatni wiersz był warunkiem wejścia refaktoru: pary wyekstrahowano z wersji
sprzed zmiany, porównano z parami odczytanymi z nowej struktury i różnicą jest
dokładnie jeden wpis - ten z PR #247.

## Czego to NIE naprawia

Bramka łapie bliźniaka **po fakcie**, w CI, już po tym, jak platforma zapisała
duplikat. Źródła zjawiska - generowania nowego pliku dla treści, która leży już
w repo - repo nie kontroluje. Rejestr rośnie więc dalej o jedną parę na
wdrożenie migracji przez dashboard i to pozostaje otwarte; nowe jest wyłącznie
to, że każda kolejna para musi przynieść ze sobą dowód, a nie tylko wiersz na
liście.

Moduł `careers` jako taki pozostaje poza zakresem tego wdrożenia - dotknięty
został wyłącznie rejestr bramki, ani jeden plik migracji nie zmienił treści.

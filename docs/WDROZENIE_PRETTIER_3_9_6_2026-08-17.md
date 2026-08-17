# Wdrożenie: Prettier 3.9.6 na całej platformie + domknięcie bramki formatu (2026-08-17)

## Diagnoza

Podniesienie `prettier` z `^3.7.3` na `^3.9.6` przeformatowało kod źródłowy, ale
zostawiło trzy rzeczy, przez które „cała platforma na 3.9.6" nie było prawdą.

### 1. Manifest i lock mówiły co innego

| Plik           | Zapis                  | Skutek                                              |
| -------------- | ---------------------- | --------------------------------------------------- |
| `package.json` | `"prettier": "^3.9.6"` | zakres - dopuszcza każde przyszłe 3.x               |
| `bun.lock`     | `"prettier": "3.9.6"`  | wersja dokładna, zapisana w kopii manifestu w locku |

Bun porównuje zakresy z `package.json` z ich kopią w `bun.lock`; rozjazd
wymusza ponowne rozwiązanie zależności. Krok CI instaluje przez **`bun install`
bez `--frozen-lockfile`** (`.github/workflows/ci.yml`), więc to ponowne
rozwiązanie wykonałoby się na PR - i wciągnęło najnowsze 3.x spełniające
`^3.9.6`. Formater zmienia wynik między wydaniami minor (ta zmiana to dowód:
przejście 3.7 -> 3.9 przeformatowało kilkadziesiąt plików), więc pierwszy krok
jobu - `Format (prettier)` - stanąłby na czerwono na zmianie, która formatu nie
dotyka. Repo pinuje dokładnie każdą inną zależność wrażliwą na wynik
(`axe-core 4.10.2`, `dompurify 3.4.7`, `stripe 22.0.2`, `entities 4.5.0`).

### 2. `format` i `format:check` mierzyły różne zbiory plików

```
"format":       "prettier --write .",
"format:check": "prettier --check \"**/*.{ts,tsx,js,mjs,cjs,css,json,yml,yaml}\"",
```

Bramka sprawdzała kod, `bun run format` - polecany w komentarzu przy kroku CI
jako lekarstwo - przepisywał **wszystko**, w tym Markdown. 54 pliki `.md`
czekały więc na pierwszego, kto uruchomi u siebie dokładnie tę komendę, którą
CI każe uruchomić: dostałby 54 pliki w diffie, żadnego z nich nie dotykając.
Asymetria była już raz opisana w `.prettierignore` (przy `types.ts`) jako powód,
dla którego `prettier --check .` „nie dawał się wpiąć w CI jako bramka".

### 3. Dziesięć miejsc w Markdownie, gdzie przeformatowanie NIE jest kosmetyczne

Wyszło dopiero przy porównaniu treści znak po znaku, po odjęciu samych
znaczników formatu - w zwykłym przeglądzie diffa te wiersze wyglądają jak
wyrównanie tabel:

- **`docs/AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-08-05.md`** - blok kodu cytuje
  **dosłowny bajt NUL** jako materiał dowodowy znaleziska (separator wpisany
  bajtowo na offsecie 4440, opisany w tekście jako „realny bajt NUL, nie
  `<0x00>`"). Parser Prettiera nie przepuszcza NUL i zapisuje w jego miejsce
  U+FFFD, czyli kasuje dokładnie tę jedną rzecz, dla której ten fragment
  istnieje. Git widzi ten plik jako binarny - dlatego zwykły przegląd diffa by
  tego nie pokazał.
- **`docs/WDROZENIE_CROSS_BLOCK_SELECTION_2026-08-03.md:90`** - zawinięty punkt
  listy zaczynał wiersz od `>= 2 zaznaczonych bloków`. Dla CommonMark `>` na
  początku wiersza to cytat blokowy, więc Prettier - formalnie poprawnie -
  przepisał dwa wiersze punktu na cytat i rozdzielił operator na `> = 2`.
  Źródło było wieloznaczne; wynik zmieniał i renderowanie, i sens zdania.
- **Osiem wierszy w siedmiu plikach zaczynało się od `+` w roli spójnika**
  („pg_cron co 5 min **+** scheduler repo", "`toJsonArray` **+** generyk",
  "5+ bloków **+** EN one/other"). Dla CommonMark `+` na początku wiersza to
  punktor listy - i to on wygrywa nawet w środku akapitu, bo lista **może**
  przerwać akapit. Te fragmenty renderowały się jako punkt listy **już przed tą
  zmianą** (usterka zastana, niewidoczna w źródle), a Prettier ujednolicił
  punktor do `-`, przez co w źródle „plus" zmienił się w myślnik i zdanie
  przestawało się zgadzać także dla czytającego surowy plik.

Pierwszy przypadek jest nieodwracalny i został wyłączony z formatowania.
Pozostałe dziewięć naprawiono u źródła - żeby znaczyły to samo w źródle i po
wyrenderowaniu, i żeby były stabilne pod formaterem.

Skanu nie da się zrobić okiem: wykrył to skrypt porównujący strumienie znaków
po odjęciu znaczników formatu, plik po pliku, plus skan wierszy zaczynających
się od `+`, `*` i `>` w treści akapitu. Sześć trafień `*` w
`PROJEKT_DISCUSSION_CLUB_V3_UKLAD_2026-08-09.md` sprawdzono i odrzucono jako
prawdziwe punktory (`*` -> `-` to czysta normalizacja).

## Zmiana

| Plik                                            | Zmiana                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `package.json`                                  | `"prettier": "3.9.6"` - pin dokładny, zgodny z kopią manifestu w locku |
| `package.json`                                  | `format:check` -> `prettier --check .`, ten sam zbiór co `format`      |
| `.prettierignore`                               | wyłączony audyt z 05.08 (bajt NUL) wraz z powodem                      |
| `docs/WDROZENIE_CROSS_BLOCK_SELECTION_...md:90` | `>= 2` w span kodu - wiersz nie zaczyna się już od `>`                 |
| 7 plików `docs/**.md` (8 wierszy)               | spójnik `+` przeniesiony na koniec poprzedniego wiersza                |
| 53 pliki `docs/**.md`, `scripts/**/README.md`   | sformatowane 3.9.6                                                     |

Formatowanie Markdown to wyrównanie tabel, ujednolicenie punktorów (`+`, `*` ->
`-`), emfaza `*x*` -> `_x_` i przeliczenie bloków kodu pod konfigurację repo
(`trailingComma: "all"`). Poza dziesięcioma miejscami wyżej treść jest
nietknięta - sprawdzone porównaniem strumienia znaków po odjęciu znaczników
formatu, plik po pliku.

## Dowód

Uruchomione realnym binarium 3.9.6 (`prettier --version` -> `3.9.6`):

| Sprawdzenie                                    | Wynik                                                         |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `prettier --check .` (nowa bramka)             | `All matched files use Prettier code style!`                  |
| `prettier --check "**/*.{ts,tsx,...}"` (stara) | zielone - stary zbiór jest podzbiorem nowego                  |
| drugi przebieg `prettier --write .`            | zero zmian - wynik jest stabilny (idempotentny)               |
| bajt NUL w audycie z 05.08                     | obecny po zmianie                                             |
| porównanie treści 54 plików `.md`              | zero utraty treści; 10 miejsc opisanych wyżej naprawione      |
| skan wierszy zaczynających się od `+`/`*`/`>`  | 8 spójników naprawionych, 6 prawdziwych punktorów odrzuconych |

Żaden plik `.ts`/`.tsx`/`.css`/`.json` nie zmienił się w tej zmianie -
formatowanie kodu pod 3.9.6 było już kompletne, co potwierdza, że pin nie
przesuwa niczego w kodzie źródłowym.

## Kompatybilność wsteczna

- **Wersja jest teraz jedna i dokładna.** `package.json` = `bun.lock` = `3.9.6`,
  więc `bun install` w CI nie ma czego rozwiązywać ponownie, a lokalna instalacja
  daje ten sam formater co job.
- **Peer dependencies bez zmian.** `eslint-plugin-prettier@5.5.5` wymaga
  `prettier >= 3.0.0`, `eslint-config-prettier@10.1.8` dotyczy tylko ESLinta -
  oba spełnione. `.prettierrc` (`printWidth 100`, `semi`, `singleQuote: false`,
  `trailingComma: "all"`) nie wymagał zmian; 3.9.6 nie usunęło żadnej z tych opcji.
- **Silnik.** `prettier@3.9.6` deklaruje `node >= 14`; CI stoi na
  `oven-sh/setup-bun@v2` (bun 1.2.23), lokalnie Node 22 - z zapasem.
- **Bramki bez zmian w liczbie.** Nie doszedł ani nie zniknął żaden skrypt
  `check:*`, więc `check:gate-coverage` widzi ten sam zbiór. `format:check` jedzie
  dalej jako pierwszy zarówno w `ci.yml`, jak i w `verify:static`
  (`scripts/verify-static.ts`, tablica `FIRST`).

## Świadomie NIE zrobione

`@react-email/render` i `@tanstack/router-generator` ciągną **własne** kopie
`prettier@3.8.3` jako zależność przechodnią (formatują odpowiednio HTML maili
i `routeTree.gen.ts` - oba są w `.prettierignore`, więc nie dotykają bramki).
Ujednolicenie ich przez `overrides` wymaga przeliczenia `bun.lock`, a locka nie
da się tu odtworzyć: pinuje tarballe do prywatnego cache GAR
(`europe-west4-npm.pkg.dev`), nieosiągalnego poza platformą budującą - CI
przestawia go na publiczne npm `sed`-em w kroku, który jawnie NIE jest
commitowany. Wymuszenie override'u bez przeliczonego locka rozjechałoby manifest
z lockiem, czyli odtworzyłoby dokładnie usterkę #1 z diagnozy powyżej. Zostaje
do zrobienia na platformie budującej, jednym `bun install`.

Historyczne wpisy w `docs/WDROZENIE_WEBPUSH_VAPID_2026-07-25.md` i
`docs/WDROZENIE_HOME_LATEST_POSTS_2026-08-01.md` mówiące o `prettier@3.8.3`
zostały nietknięte - to datowany zapis stanu z tamtych wydań, nie konfiguracja.

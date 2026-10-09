# P3.3 kotwica: recenzja r1, parzystość SSR/hydratacji i jakość testów

- Zakres: `4d1e2791..bd3f8188` (`wt3/p33-anchor`, commity `470e2a52` i `bd3f8188`). Nacisk na
  rundę poprawek 1: sprawdzenie dyrektywy fragmentu tekstowego w strażniku i nowy test e2e.
- Soczewka:
  - HTML serwera a hydratacja;
  - strażnik tylko w markupie serwera;
  - testy behawioralne i deterministyczne;
  - e2e pada na `base-w3f` i przechodzi na poprawce.
- Recenzja była tylko do odczytu. `git status` jest czysty w worktree i w `base-w3f`.
- Porty 4181, 4293 i 4294 są po przebiegach wolne.
- Artefakty: `phase3/p33-anchor/rv-parity-r1/`.

**Werdykt: approve.** Defektu blokującego nie ma. Uwagi niżej są drobne: odporność testów i jedna luka
w czułości nowego testu na telefonie.

## 1. Parzystość SSR/hydratacji: potwierdzona pomiarem

| sprawdzenie                                                                                    | wynik                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.output/public` `base-w3f` vs poprawka (`diff -rq`)                                           | **identyczne**. Bundel klienta się nie zmienił, więc hydratacja też nie                                                                                                                                                    |
| build poprawki = commit                                                                        | stała `CV_GUARD_SCRIPT` z `bd3f8188` (1112 B) jest dosłownie w `.output/server/_ssr/router-B6OWt1R5.mjs` (`rv-parity-r1/guard.mjs`). Żaden plik `public` nie zawiera `data-cv-off`                                         |
| HTML `/` z serwera (fixture, po 2 pobrania z każdej strony, `html-diff.sh`, `html-compare.py`) | stabilny między pobraniami. Po normalizacji portu i znaczników czasu oraz po podmianie treści strażnika poprawka jest **identyczna z bazą**. Różnica surowa +871 B to dokładnie różnica długości strażnika (1112 vs 241 B) |
| treść skryptu w HTML                                                                           | strażnik stoi w HTML **dosłownie** (`<script>${guard}</script>`, bez encji). Parsuje się jako skrypt. Nie ma w nim `</`, `<!--` ani `<script`                                                                              |
| ścieżka klienta                                                                                | `CvBlock` bez zmian: `memo`, `suppressHydrationWarning`, `__html: isServerRender() ? CV_BLOCK_HTML : ""`. `<html>` ma `suppressHydrationWarning` (`__root.tsx:1258`), a strażnik zmienia tylko atrybut `<html>`            |
| hydratacja w vitest                                                                            | testy „hydratacja: te same opakowania…” i „hydratacja czyta plan z HTML-u serwera…” przechodzą, z `recoverable`/`mismatches` pustymi                                                                                       |

## 2. vitest `builderRenderer.contentVisibility.test.tsx`

| przebieg                                  | wynik                                                                                                                                            | log                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| poprawka `bd3f8188`                       | **58/58**                                                                                                                                        | `rv-parity-r1/vitest.log`  |
| kopia scratch ze strażnikiem z `470e2a52` | **2 porażki / 58**: oba pozytywne przypadki fragmentu tekstowego. Negatywne (`:~:` w zapytaniu, brak wpisu nawigacji) przechodzą, zgodnie z IMPL | `vitest-oldguard-470e.log` |
| kopia scratch ze strażnikiem z `4d1e2791` | **9 porażek / 58**: 2 tekstowe, 3 kliku, 2 `popstate`, `hashchange` i „cv wyłączone wcześniej”                                                   | `vitest-oldguard-base.log` |

Kopię `src` usunąłem po przebiegach.

Jakość testów jednostkowych:

- Wykonują prawdziwy skrypt z HTML-u serwera, bez reimplementacji.
- `performance.getEntriesByType` jest podstawiony wąsko (`wpisNawigacji`) i sprzątany przez globalne
  `vi.restoreAllMocks()`.
- Adres przywraca `afterEach` (`replaceState(null,"","/")`), a nasłuchy strażnika zdejmuje osobny
  `afterEach`.
- Nie ma czasu rzeczywistego.
- Przypadek „uszkodzony `sessionStorage` + fragment tekstowy” rzeczywiście pilnuje osobnego `try`.

## 3. e2e `content-visibility.boot-home.spec.ts -g kotwica --repeat-each 2`

Uruchomione przez `heavy-bg.sh`, z env CI (fixture), `trace: retain-on-failure` z konfiguracji i
`--output` poza worktree.

| build                                          | wynik               | log                         |
| ---------------------------------------------- | ------------------- | --------------------------- |
| `base-w3f` (`4d1e2791`)                        | **6 failed / 28**   | `rv-parity-r1/e2e-base.log` |
| poprawka `bd3f8188` (`wt3/p33-anchor/.output`) | **28/28** (3,3 min) | `rv-parity-r1/e2e-fix.log`  |

Porażki na bazie:

- telefon, `location.hash`, góra dalszej sekcji: 2/2, na przykład „cel poza miejscem pod nagłówkiem w
  49 z 131 klatek od 588 ms (render routera: 5265 ms)”;
- telefon, fragment tekstowy: 2/2, „cel poza widokiem w 54 z 55 klatek”, na koniec `scrollY 0`,
  `cvOff:false`;
- desktop, fragment tekstowy: 2/2, na asercji „żadna klatka z cv bez wyłącznika”.

Klik w górę sekcji tym razem przeszedł na bazie 2/2, a w r0 padał 3/3. Wykrywanie regresji kliku jest
więc probabilistyczne, ale `location.hash` + `sectionTop` padł deterministycznie w obu recenzjach
(5/5).

Dławienie i synchronizacja w nowym teście:

- `throttleCpu(deep)` jest wywołane przed `addInitScript` i `goto`, więc działa od początku wczytania.
  Nowa strona dostaje własną sesję CDP.
- Próbnik rAF → `setTimeout(0)` czyta geometrię celu dopiero przy `scrollY > 0`. Nie wymusza to
  układu pominiętych sekcji przed skokiem, więc nie fałszuje warunku W2.
- Przewinięcie do tekstu jest czekane przez `expect.poll`, potem `settle`.
- Kolejność asercji (lądowanie, potem wyłącznik) daje porażki diagnostyczne.

## 4. Uwagi

1. **minor: nowy test na telefonie może stracić czułość, a nie ma na to asercji.**
   - Na obu buildach TanStack po hydratacji resetuje stronę do `scrollY 0` (IMPL §5: 5/5 na telefonie
     x6).
   - Asercja „cel w widoku” obejmuje więc tylko okno klatek między przewinięciem do tekstu a resetem.
     Na bazie było ich 55-57, a pierwsza z nich była jeszcze w widoku („54 z 55”).
   - Gdyby reset przyszedł wcześniej, bo zmieni się kolejność hydratacji albo szybkość bootu, okno
     skurczy się do 1-2 klatek. Test przeszedłby wtedy także na buildzie bez poprawki.
   - Ten wariant nie ma zabezpieczenia: na telefonie desktopowa asercja wyłącznika co prawda pada na
     bazie, ale tylko dzięki temu, że strażnik bazy nie ma sprawdzenia dyrektywy.
   - Sugestia: dodać `expect(scrolled.length).toBeGreaterThanOrEqual(N)` (np. 10) albo minimalny czas
     okna, żeby skurczenie okna dawało czytelną porażkę zamiast cichego zielonego wyniku.
2. **minor: klatka przewinięta bez znalezionego celu jest liczona jak „góra strony”.**
   - `sample()` daje `top: null` także wtedy, gdy `scrollY > 0`, ale `find()` nic nie znalazł. Filtr
     `s.top !== null` pomija taką klatkę po cichu.
   - Na koniec `where(far)` używa `getElementById(id)!`, więc przy przerenderowanej wyspie z innym
     `useId` rzuci `TypeError` zamiast dać czytelną asercję. To uwaga 3 z r0, nadal otwarta, teraz
     także w 4. teście na viewport.
   - Sugestia: rozróżnić `null` (góra strony) od „brak celu” i zrobić `expect(missing).toEqual([])`.
3. **minor (przeniesiona z r0, nadal otwarta): `settleAfterNavigation` nie ma komunikatu ani
   fallbacku.**
   - Opiera się na `onRendered` routera po każdej zmianie `#`.
   - Usunięcie pełnego `router.load` przy zmianie samego `#` (pozycja z REPRO) da 60-sekundowe
     porażki bez wyjaśnienia.
4. **nit: stały czas obserwacji.** `deep.waitForTimeout(4_000 / 2_000)` między dwoma `settle` to okno
   obserwacji spóźnionych odsłonięć, a nie synchronizacja. Jest akceptowalne. Można by je zastąpić
   oczekiwaniem na stan „żadne opakowanie nie jest pominięte” (`checkVisibility` w pętli `poll`) i
   potem `settle`.
5. **nit: komentarze o CI.**
   - Komentarz przy `ANCHOR_TIMEOUT` mówi, że „runner CI jest wolniejszy, x6 mnoży jego CPU”.
   - REPRO i `repro/ci/failed.log` pokazują jednak czasy CI zbliżone do lokalnych. Wolniejszy CPU
     maskuje błąd, a nie go wywołuje.
   - Zapas 240 s jest nieszkodliwy (test trwa 45-46 s), ale uzasadnienie warto poprawić razem z
     komentarzem `PHONE_CPU_THROTTLE` (nit 4 z r0).
6. **nit: na desktopie regresję fragmentu tekstowego łapie tylko asercja stanu (`cvOff`), a nie
   geometria.** Na bazie lądowanie na desktopie było w widoku. Zgadza się to z rekomendacją REPRO
   („assert cvOff === true”), więc to tylko odnotowanie.

## 5. Artefakty

- `rv-parity-r1/html-diff.sh`, `html-compare.py`, `home-{base,fix}-{1,2}.html`, `html-diff-result.txt`;
- `guard.mjs` (strażnik w bundlu serwera), `guard-in-html.mjs` (strażnik dosłownie w HTML);
- `vitest.log`, `vitest-oldguard-470e.log`, `vitest-oldguard-base.log`;
- `e2e.sh`, `e2e-base.log`, `e2e-fix.log`, `tr-base/` (trace porażek bazy).

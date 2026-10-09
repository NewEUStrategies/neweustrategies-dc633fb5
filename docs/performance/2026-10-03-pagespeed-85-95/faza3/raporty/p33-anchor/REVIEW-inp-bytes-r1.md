# P3.3 kotwica, runda 1: recenzja kosztu interakcji (INP) i bajtów

- **Zmiana:** `4d1e2791..bd3f8188`, czyli `470e2a52` i `bd3f8188` (fragment tekstowy w strażniku). Worktree `scratchpad/wt3/p33-anchor`.
- **Tryb:** recenzja tylko do odczytu. Niczego nie edytowałem ani nie budowałem w worktree ani w `base-w3f`. Oba drzewa mają czysty `git status`.
- **Moje pomiary:** `phase3/p33-anchor/rv1/`.
  - Harness to kopia `rv-cost/anchor-cost.spec.ts` z nowym wariantem `tf`, czyli wejściem z `/#:~:text=Zapisz%20się%20do%20newslettera`, i z pomiarem kosztu samego sprawdzenia dyrektywy.
  - Pozostałe pliki: `run-all.sh`, `run-tfbase.sh`, `out/*.jsonl`, logi `rv1-cost.log` i `rv1-tfbase.log`.
- **Warunki:** wszystko szło przez `heavy-bg.sh` na porcie 4298. Serwery zgasły razem z runnerem.

## Werdykt: approve, bez uwag blokujących

- **Bajty.**
  - Bundle klienta się nie zmienia. Chunk wejściowy i domknięcie bootu są bajt w bajt identyczne z `base-w3f`.
  - Inline'owy strażnik ma +86 B względem r0, a względem `4d1e2791` łącznie +871 B surowo i +473 B gzip w HTML-u.
  - Wszystko mieści się w progach, a progi nie zostały podniesione.
- **INP kliku w kotwicę** to ścieżka kodu z r0, w tej rundzie bez zmian. Pomiar na `bd3f8188` potwierdza wynik recenzji r0:
  - klik kosztuje tyle co przed P3.3 plus jednorazowe odsłonięcie sekcji: ok. 115 ms przy x4 i ok. 175 ms przy x6;
  - względem `4d1e2791` daje to +420 do +540 ms na tym jednym kliku;
  - jest to cena za poprawność (cel naprawdę ląduje pod nagłówkiem).
- **Nowe w tej rundzie: koszt wejścia z fragmentem tekstowym.**
  - Takie wejście traci teraz oszczędność P3.3 przy wczytaniu. Styl i układ w fazie wczytania rosną o ok. +150 ms (x4) i +830 ms (x6), a najdłuższe zadanie wczytania przy x6 o ok. +130 ms.
  - To dokładnie poziom sprzed P3.3, więc to nie jest regresja.
  - Zysk jest jednak dziś na telefonie w większości zjadany przez reset TanStacka. Szczegóły w uwadze m1.

## 1. Bajty i bundle (zweryfikowane niezależnie)

| sprawdzenie                                                                    | wynik                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CV_GUARD_SCRIPT` wyliczony ze źródła (`rv-guard-len.mjs`)                     | 1112 B surowo i 646 B gzip -9 osobno. Było 1026/599 w r0 i 241/214 w `4d1e2791`                                                                                                                                                                                                                      |
| źródło == build                                                                | `BuilderRenderer.tsx` ma mtime 09:13, czyli **później** niż `.output` (09:11). Sprawdziłem więc treść: `.output/server/_ssr/router-*.mjs` zawiera skrypt **identyczny** ze źródłem (`grep -F` dosłownego literału daje 1 trafienie). Późniejszy mtime to formatowanie albo zapis bez zmiany literału |
| klient                                                                         | md5 wszystkich 901 plików `.js`/`.css` w `.output/public` jest **identyczne** z `base-w3f` (`rv1/base-assets.txt` vs `rv1/fix1-assets.txt`, `diff` pusty). `data-cv-off` nie występuje w `.output/public`. Chunk wejściowy, domknięcie bootu i seria bootu się nie zmieniają                         |
| `document-weight` (`document-weight-{base,r2,fix1}.json`, 5 próbek, min = max) | Zmieniają się tylko `htmlRawBytes`, `htmlGzipBytes`, `inlineScriptBytes`, `inlineExecutableScriptBytes` i `preLcpTransferBytes`. Wartości poniżej                                                                                                                                                    |
| zapasy                                                                         | `inlineScriptBytes` 9 681 B, `inlineExecutableScriptBytes` 10 550 B, `htmlGzipBytes` 7 397 B, `preLcpTransferBytes` 6 106 B. `bootClosureGzipBytes` ma nadal 1 525 B, Δ 0                                                                                                                            |
| CSS                                                                            | `inlineCssCommentBytes` 517, Δ 0. Runda nie dodaje CSS                                                                                                                                                                                                                                               |
| parzystość SSR/hydratacji                                                      | Zmienia się tylko literał w bloku serwera. Klient nadal renderuje `CvBlock` z pustym `__html`                                                                                                                                                                                                        |

Zmiany w `document-weight`:

| metryka                       |    baza |      r2 |    fix1 |
| ----------------------------- | ------: | ------: | ------: |
| `htmlRawBytes`                | 328 452 | 329 237 | 329 323 |
| `htmlGzipBytes`               |  49 840 |  50 259 |  50 313 |
| `inlineScriptBytes`           |  87 551 |  88 336 |  88 422 |
| `inlineExecutableScriptBytes` |  80 304 |  81 089 |  81 175 |
| `preLcpTransferBytes`         | 175 015 | 175 434 | 175 488 |

Różnice r2 → fix1: +86 surowo, +54 gzip, +86 inline'owego skryptu, +54 przed LCP. Liczby implementera z §4 IMPL-fix1 zgadzają się z JSON-em co do bajtu.

Odrzucenie przebiegu przez `bun run` uważam za słuszne. Skrypt pakietu i baza liczą gzip zlibem Node'a, a przy identycznych bajtach surowych różnica `bootClosureGzipBytes` pochodzi z innego kompresora, nie z kodu.

**Koszt samego sprawdzenia dyrektywy** (`/#.*:~:/.test(performance.getEntriesByType("navigation")[0].name)`, 1000 powtórzeń w stronie, telefon):

- x4: 2–7 µs na wywołanie;
- x6: 1–11 µs na wywołanie.

Wykonuje się raz, przy parsowaniu, i nie dokłada żadnego nasłuchu. Koszt jest pomijalny.

## 2. INP kliku w `#id` na `bd3f8188`

Warunki: telefon 412x823, mediana z 5, klik po 2,5 s spoczynku.

Warianty:

- `cur`: cv włączone, klik przez strażnik;
- `base`: wejście z `/#__ax_none`, czyli strona sprzed P3.3;
- `sync`: czysty koszt odsłonięcia.

| seria                                                      |                INP (zakres) | processing | presentation | styl w oknie kliku | układ | najdłuższe zadanie |
| ---------------------------------------------------------- | --------------------------: | ---------: | -----------: | -----------------: | ----: | -----------------: |
| x4 `cur`                                                   |             1072 (848–1096) |        444 |          540 |               1134 |    85 |                500 |
| x4 `base` (sprzed P3.3)                                    |              888 (856–1040) |        356 |          506 |               1076 |     8 |                553 |
| x4 `sync`                                                  |  115 ms styl+układ (89–126) |            |              |                    |       |                    |
| x6 `cur`                                                   |            1640 (1560–1816) |        858 |          707 |                890 |   144 |                926 |
| x6 `base` (sprzed P3.3)                                    |            1448 (1336–1600) |        646 |          731 |               1093 |     7 |                758 |
| x6 `sync`                                                  | 173 ms styl+układ (145–250) |            |              |                    |       |                    |
| r0, `4d1e2791` `cur` (`rv-cost/out/base-x*.jsonl`)         |             x4 648, x6 1104 |            |              |                    |       |                    |
| `4d1e2791` `cur` (`rv1/out/base-tf-x*.jsonl`, druga seria) |              x4 632, x6 872 |            |              |                    |       |                    |

Wnioski:

- **Poprawka względem strony sprzed P3.3:** +184 ms przy x4 i +192 ms przy x6. To zgodne z czystym odsłonięciem (115 / 173 ms) plus szum. Wynik jest powtarzalny z r0, gdzie średnie wynosiły ok. +20 i +220 ms.
- **Poprawka względem `4d1e2791`:** +420 do +540 ms przy x4 i +540 do +770 ms przy x6.
  - Najdłuższe zadanie kliku przy x6 wynosi 926 ms, wobec 598–818 ms na `4d1e2791`.
  - Większość zadania, także przed P3.3, to pełny render TanStacka po zmianie `#` (`router.load` i render), a nie strażnik.
- **Lądowanie:** wszystkie przebiegi `cur` lądują poprawnie (`y` 5051–5092, cel pod nagłówkiem).
- **Ocena:** koszt jest akceptowalny z tych samych powodów co w r0.
  - Płaci się go raz na dokument, w rzadkiej interakcji.
  - Naprawia realny błąd: na `4d1e2791` cel stał 1240 px pod widokiem.
  - Lighthouse, TBT i LCP pierwszego wejścia nie zmieniają się, bo przy zwykłym wejściu cv zostaje włączone, a sprawdzenie kosztuje mikrosekundy.

## 3. Wejście z fragmentem tekstowym: nowy koszt tej rundy

Warunki: telefon, mediana z 5. Faza wczytania to okres od nawigacji do znacznika kliku, z 2,5 s spoczynku. Kolumny to suma `UpdateLayoutTree` i `Layout` z trace'u oraz najdłuższe `RunTask`.

| przypadek                                                 | x4 styl+układ | x4 najdłuższe zadanie | x6 styl+układ | x6 najdłuższe zadanie | `cvOff` na starcie |
| --------------------------------------------------------- | ------------: | --------------------: | ------------: | --------------------: | ------------------ |
| `/` na `bd3f8188` (cv włączone)                           |           552 |               133–155 |           821 |               197–269 | nie                |
| `/#__ax_none` na `bd3f8188` (wyłącznik = sprzed P3.3)     |           951 |               246–331 |          1324 |               344–467 | tak                |
| `/#:~:text=` na `4d1e2791` (cv włączone, bez sprawdzenia) |          1337 |               209–376 |          1870 |               356–417 | nie                |
| `/#:~:text=` na `bd3f8188`                                |          1489 |               235–423 |          2701 |               464–607 | **tak**            |

- Na buildzie bez sprawdzenia wyszukiwanie tekstu przez Chromium już wcześniej wymuszało sporo stylu: 1337 ms przy x4, czyli ponad dwa razy więcej niż zwykłe wejście.
- Poprawka dokłada do tego ok. +150 ms (x4) i ok. +830 ms (x6) stylu i układu przy wczytaniu. Najdłuższe zadanie przy x6 rośnie o ok. +130 ms (mediana 494 wobec 360 ms).
- Jeden przebieg x6 (#0) ma uszkodzony punkt startu w trace'ie (`navigationStart` poza procesem). Mediana go pomija.
- Czy moja dyrektywa trafiła w tekst, nie zapisywałem. Różnica kosztu wynika jednak z samego wyłączenia cv przy parsowaniu, niezależnie od trafienia.

## 4. Uwagi

### m1 (minor): wejście z `#:~:text=` traci oszczędność P3.3, a na telefonie zysk dziś zjada reset TanStacka

**Co się zmienia.** Linki z wyszukiwarki z wyróżnieniem tekstu, czyli fragmenty polecane w Google, to realna część ruchu mobilnego z wyszukiwania. Te wejścia płacą teraz przy wczytaniu pełny styl i układ ogona: +150 ms (x4) i +830 ms (x6) względem cv włączonego, a najdłuższe zadanie wczytania przy x6 rośnie o +130 ms. To poziom sprzed P3.3, więc to nie jest regresja względem produkcji sprzed fali 3. Oszczędność P3.3 znika jednak dokładnie dla tej klasy wejść.

**Co z tego zostaje użytkownikowi.** Sam implementer zmierzył (IMPL-fix1 §3 i §5), że na telefonie x6 TanStack w 5/5 przebiegów przewija potem na górę (`scrollTo(0,0)` przy pierwszym `onRendered` bez `#`). Desktop robi to w 3/5. Ta sama klasa wejść kończy więc zwykle na `scrollY 0`:

- z poprawką cel przez chwilę stoi poprawnie w widoku, a potem strona i tak skacze na górę;
- bez poprawki stał ekran za nisko, a potem też skakał na górę.

**Ocena.** Korektę poprawności uważam za słuszną i nie blokuję. Pełna wartość (cel w widoku na stałe) pojawi się jednak dopiero po naprawie resetu z §5. Dwie prośby:

- W IMPL i w komunikacie commita brakuje zdania o koszcie wczytania. Komunikat podaje tylko „+86 B” i „zero JS-a w bundlu”. Należy dopisać, że wejścia z `:~:` wracają do kosztu wczytania sprzed P3.3.
- Pozycję „reset TanStacka po fragmencie tekstowym” warto zaplanować razem z tą zmianą, a nie „kiedyś”. Bez niej koszt wczytania kupuje na telefonie tylko krótkie mignięcie celu.

### n1 (nit): komentarz w kodzie nadal podaje koszt kliku za optymistycznie

**Gdzie.** `BuilderRenderer.tsx`, blok KOTWICA PO WCZYTANIU: „Koszt: jednorazowe odsłonięcie sekcji w zadaniu tej nawigacji, więc INP tego jednego kliku wraca do poziomu sprzed P3.3”.

**Pomiar tej rundy.** Klik kosztuje poziom sprzed P3.3 plus samo odsłonięcie. To +184 ms (x4) i +192 ms (x6) względem `/#__ax_none`, a względem `4d1e2791` +420 do +770 ms. Uwaga M1 z r0 nie trafiła do tej rundy, bo przekazano tylko ustalenie major.

**Propozycja.** Zmienić na „…wraca do poziomu sprzed P3.3 plus jednorazowy styl i układ odsłonięcia (ok. 0,1–0,25 s przy CPU x4–x6 na telefonie)”. Sam kod jest bez zmian.

### n2 (nit): czas e2e w CI

**Wzrost.** Nowy test dodaje ok. 27 s na przebieg: telefon x6 śr. 19,3 s, desktop śr. 8,0 s.

- Suma czasów testów specu cv to ok. 265 s na przebieg (`e2e-cv-repeat5-fix1.json`).
- Najdłuższy test (wstecz/dalej, x6) trwa 46,8 s średnio, a maksymalnie 50,3 s.

**Limit.** `ANCHOR_TIMEOUT` 240 s daje zapas 4,8x, więc wolniejszy runner CI się mieści.

**Ocena.** Bez zmian. Warto obserwować łączny czas zadania `test:e2e:artifact`.

### Bez uwag

- Sprawdzenie dyrektywy stoi w osobnym `try` i nie rejestruje nasłuchów, więc nie zmienia kosztu żadnej interakcji.
- Nasłuchy `click`, `popstate` i `hashchange` są identyczne jak w r0. Klik w zwykły link robi tylko `closest` i porównanie stringów, czyli mikrosekundy.
- Przy zwykłym wejściu (Lighthouse, pierwsza wizyta) cv zostaje włączone. Faza wczytania `/` jest taka sama jak na `4d1e2791`: 552 wobec 572 ms przy x4 i 821 wobec 851 ms przy x6, w szumie.
- Żaden nowy kod nie trafia do chunka wejściowego ani do jakiegokolwiek pliku klienta.

# Platforma, backend, infrastruktura i SSR — naprawy po audycie

Baza zmian: `c239ab891c22b72fb329af9596394f28b9bfa85e` (`main`, 6 września 2026).
Zakres pomiaru zachowuje wszystkie **208 plików** przypisanych do modułu 20
w audycie. Korekta klasyfikatora nie usuwa z niego plików: dołączane są również
wykonywalne pliki aktualnie przypisane do platformy. Wyłączenia kodu generowanego
i testów pozostają takie jak w istniejącej konfiguracji V8.

## Zmiany i dowody

| Obszar                          | Stan bazy i zmiana w tym PR                                                                                                                                                                                                                                   | Dowód                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Druga fala korzenia             | Baza miała ograniczenie 500 ms, ale nadal czekała na całą falę. Teraz loader rozpoczyna pracę bez `await`; nagłówek i stopka korzystają ze wspólnej bramki danych we własnych granicach `Suspense`. Treść trasy może opuścić serwer wcześniej.                | `platformChromeWarmup.test.tsx`: rzeczywisty `renderToPipeableStream`, treść przed rozstrzygnięciem chrome, ponowienie po czyszczeniu zapytań przez SSR, niezależność żądań. |
| Prefetch strony głównej         | `stream` w `HomeBuilderContent`, prefetch pierwszych sekcji i wspólny budżet były już wdrożone. Zachowane; druga fala nie dodaje osobnego oczekiwania do loadera.                                                                                             | Istniejące testy `homeRoute`, budżetu strony głównej i renderera; boot PL/EN na artefakcie.                                                                                  |
| Cache renderów zdegradowanych   | Zapis sprawdza finalny `Response`, a nie wyłącznie wcześniejsze nagłówki h3. Rejestruje żądanie i ponownie sprawdza jego sygnał degradacji po zakończeniu strumienia. Zimna granica chrome oznacza dokument jako `private, no-store` przed wysłaniem powłoki. | `platformDeferredCache.test.ts`: L1/L2, późna degradacja strumienia, 500, no-store, zachowanie Link przy HIT.                                                                |
| Loadery publicznych powierzchni | W aktualnej bazie wskazane loadery i `useSuspenseQuery` już istnieją; powłoka wydarzenia ma head z danych i SSR JSON-LD. PR zachowuje te kontrakty.                                                                                                           | Istniejące testy tras; dodatkowe testy renderu publicznego obejmujące blokady dostępu, układy, typy treści i szablony stron.                                                 |
| CSS                             | Panel otrzymuje osobny arkusz. Skaner Tailwind emituje w nim klasy nieobecne w części wspólnej. Publiczny renderer buildera pozostaje we wspólnym arkuszu.                                                                                                    | Test prawdziwego skanera, kontrola właściciela importu CSS oraz asercje braku arkusza panelu w publicznym HTML i po hydratacji.                                              |
| Słownik aktywnego języka        | Mechanizm preloadu PL/EN istniał w bazie. Rozdzielono ponadto słowniki formularza logowania, wyszukiwarki i ustawień panelu, aby nie obciążały korzenia bez potrzeby.                                                                                         | Testy parytetu i18n i asercje rzeczywistego nagłówka `Link` w boot-teście PL/EN.                                                                                             |
| Czas i język                    | Dwie pozostałe decyzje o czasie w przeglądzie wydarzenia używają `useNowMs`; początkowy SSR i hydratacja korzystają z tego samego stanu. Zapisany HTML nie zmienia decyzji wskutek upływu czasu między renderami.                                             | `renderToString` w dwóch językach, po przekroczeniu daty wydarzenia i ze zmianą strefy hosta. Pozostałe wzorce deterministycznego czasu z bazy zachowane.                    |
| Startowy JS i raport bundla     | Próg domknięcia startowego 579 KiB istniał. Usunięto importy słowników panelu z korzenia. Raport rozróżnia publiczny CSS od sumy CSS, a aktualizacja baseline nie może ominąć czerwonej bramki.                                                               | Kontrole negatywne: wzrost wyłącznie startowego JS, nieznany arkusz publiczny, próba rozluźnienia limitu przez zmienną CI, osobne wiadra vendorów.                           |
| Opcje `handler.fetch`           | Drugi argument otrzymuje opcje frameworka. `onEarlyHints` zbiera modulepreloady, które są scalane z Link po nałożeniu nagłówków h3 i przed odroczonym zapisem dokumentu. Tożsamość strumienia body jest zachowana.                                            | `platformPreloads.test.ts`, test wejścia serwera i odpowiedzi z uruchomionego builda Node.                                                                                   |
| Boot na buildzie                | Oddzielny build smoke i workflow boot-testów istniały. Poprawiono negocjację języka w teście home. Każdy build czyści własne katalogi wyjściowe, żeby stare chunki nie fałszowały pomiaru.                                                                    | Boot testy produkcyjnego artefaktu; bramki grafu, rozmiaru i czystości wejścia wykonują się przed nadpisaniem `.output` buildem smoke.                                       |
| Pomiar czasu                    | Zachowane testy czasu artefaktu, w tym osobne kryteria dla MISS/HIT. Lighthouse rozpoznawany jako bot mierzy render buforowany; wyniku nie utożsamiamy ze ścieżką strumieniową zwykłej przeglądarki.                                                          | Raport Playwright z joba build. Lokalne odczyty HTTP są diagnostyką, a nie pomiarem wydajności wdrożenia produkcyjnego.                                                      |

## Pokrycie i jakość pomiaru

`bun run test:platform` uruchamia pełną suitę z instrumentacją ograniczoną do
zachowanego zakresu modułu. Każda z czterech miar ma próg **95%**: linie,
instrukcje, funkcje i gałęzie. `bun run check:platform-coverage` liczy sumę
liczników, a nie średnią procentów plików. Nie zaokrągla wyniku przed porównaniem
z progiem. Brak pliku, błędny licznik lub niepełny rachunek wykonania testów
powoduje odrzucenie pomiaru.

CI publikuje HTML, JSON, JSON summary, LCOV oraz rachunek wykonania testów.
`reports/platform-coverage.json` zawiera dla każdego pliku także numery
niepokrytych linii, identyfikatory gałęzi i nazwy niewykonanych funkcji.
`expectedFailed`, `failed`, `skipped` i przypadki bez wyniku są raportowane
oddzielnie. Istniejące globalne i szczegółowe progi repozytorium pozostają
obowiązujące.

## Dodatkowe naprawy wynikające z testów

- Pipeline błędów uwzględnia zarówno `status`, jak i `statusCode`.
- Błąd chunka zapisany jako zwykły obiekt z `message` uruchamia właściwe odzyskanie.
- Gateway AI zachowuje nagłówki `Request`, przestrzega ograniczenia odczytu
  strumienia przez konsumenta i zwalnia reader przy anulowaniu oraz błędzie.
- Watchdog preview obsługuje przeglądarkę blokującą sam odczyt `sessionStorage`.
- Autorzy reagują na zmiany profilu i ról bez zmiany liczby użytkowników;
  błędy pobrania liczników nie są prezentowane jako zero publikacji.
- Dashboard monetyzacji odróżnia błędy i ładowanie od rzeczywistych danych;
  pusty lub odwrócony zakres dat nie uruchamia błędnego RPC.
- Utrata połączenia podczas zapisu czasu czytania odblokowuje formularz
  i pokazuje błąd zamiast pozostawiać go w stanie zapisywania.
- Testy księgi darowizn mają jawny zegar; CI używa UTC.
- Kontrakt pgTAP weryfikacji profilu uwzględnia aktualne uprawnienia kolumnowe
  i oficjalne RPC weryfikacji; nie oczekuje dostępu usuniętego migracją.
- Snapshot autoryzacji jest wygenerowany z aktualnego zestawu migracji.

## Pozostałe decyzje administracyjne

Odczyt GitHub API z 6 września 2026 potwierdza `main.protected = false` i pustą
listę rulesetów. Sam PR nie aktywuje ochrony gałęzi. W ustawieniach repozytorium
trzeba wymagać PR, udanego `verify`, `test`, `build` i `pgtap`, aktualnej gałęzi,
rozwiązanych dyskusji i co najmniej jednego zatwierdzenia; zablokować force push
oraz usunięcie gałęzi głównej.

W rejestrze nadal brakuje właścicieli technicznych i zastępców dziewięciu domen.
Wynik zielonej bramki pokrycia nie jest dowodem obsadzenia tych ról. Przypisanie
konkretnych osób, dostępów i dyżurów wymaga rzeczywistej decyzji organizacyjnej;
nie zastępujemy jej fikcyjnymi kontami ani zmianą flagi `obsadzone`.

Pełny cykl płatności u rzeczywistego operatora wymaga środowiska testowego
operatora i jego poświadczeń. Testy jednostkowe oraz pgTAP nie stanowią dowodu
takiego przebiegu. Nie wykonujemy rzeczywistych obciążeń ani zmian produkcyjnej
bazy w ramach weryfikacji tego PR.

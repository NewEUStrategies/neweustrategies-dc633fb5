# Moduł 19 (ustawienia / integracje / users / multi-tenant / RODO): defekt krytyczny zamknięty, 16 napraw, 6 najsłabszych funkcjonalności pokrytych (2026-10-02)

Zlecenie: „optymalizuj, napraw i wdróż" dla sześciu najsłabiej pokrytych
funkcjonalności modułu 19 z tabeli wydania 12 audytu pokrycia
(`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 16.6):

| Funkcjonalność (wyd. 12)                                  | Linie | Gałęzie | Funkcje | Martwe fn. |
| --------------------------------------------------------- | ----: | ------: | ------: | ---------: |
| Katalog członków, warstwy i monetyzacja                   | 64,2% |   55,5% |   73,3% |          3 |
| Nawigacja, wyszukiwarka i pulpit panelu                   | 72,2% |   74,8% |   65,8% |         16 |
| Automatyzacje i harmonogram zadań tła                     | 84,7% |   63,8% |   84,2% |          0 |
| Panele ustawień witryny z historią rewizji                | 86,5% |   81,6% |   82,8% |          3 |
| Macierz uprawnień wyprowadzona z migracji                 | 86,8% |   84,0% |   79,8% |          6 |
| Rejestr zgód RODO, cookie banner i Global Privacy Control | 91,7% |   75,7% |   87,2% |          4 |

Przy okazji zamknięty jest **jedyny defekt krytyczny wydania 12** (zaproszenie
przenosiło konto z obcego najemcy) i jego defekt średni-bliźniak - oba w module
19, choć w funkcjonalności spoza szóstki.

---

## 1. Jak mierzone

Pomiar własny na `45404b0`, provider `istanbul`, zakres = 162 pliki
produkcyjne modułu 19 według `scripts/taxonomy/moduleMap.mjs`. Mianownik
(**5 371 linii**) zgadza się co do linii z tabelą audytu, więc liczby są
porównywalne.

Testy: każdy plik testowy, który importuje plik modułu 19 WPROST (243), plus
testy sięgające podejrzanych zer PRZECHODNIO przez graf importów (404 -
liczone skryptem po `import`/`from`, nie przez `vitest related`, które w tej
wersji nie wypisuje listy). Pomiar przechodni rozstrzygnął, które zera są
prawdziwe: `badges.ts`, `library.ts`, `ConsentAuditSummary.tsx`, dwie sekcje
cookie-bannera, sekcja Google Source i pasek filtrów macierzy nie są
wykonywane przez ŻADEN test - konsumenci mockują je w całości.

Stan wyjściowy (bezpośredni przebieg): 243 pliki, 9 354 testy zielone,
91 `it.fails`; **linie 90,00% (4 834/5 371), gałęzie 84,90%, funkcje 87,03%**.

Środowisko: host `cdn.sheetjs.com` jest zablokowany polityką sieci, więc
`xlsx` zainstalowano lokalnie z rejestru npm (0.18.5) z przywróceniem
`package.json`/`bun.lock` - repozytorium nie jest dotknięte. Żaden test
modułu 19 nie importuje `xlsx`.

---

## 2. Naprawy (produkcja)

Każda naprawa ma test, który oblewa na kodzie sprzed poprawki.

### 2.1 Krytyczne i wysokie

| #   | miejsce                              | defekt                                                                                                                                                                                                                                                                            | naprawa                                                                                                                                                                                        |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | `lib/admin/invitations.functions.ts` | **KRYTYCZNY (wyd. 12, 16.8).** `performSend` szuka adresata po CAŁYM katalogu kont, a potem kluczem serwisowym pisze `profiles.tenant_id`, profil autora i rolę w najemcy zapraszającego. Administrator obszaru A, zapraszając adres osoby z obszaru B, przenosił jej konto do A. | Przed hydracją odczyt `slug, tenant_id` profilu; konto z INNEGO najemcy = `account_in_other_tenant`, zero zapisów, zero maili, zaproszenie `failed`. Awaria tego odczytu też przerywa wysyłkę. |
| N2  | `lib/admin/invitations.functions.ts` | (średni, wyd. 12) Wynik trzech `upsert` hydracji nie był czytany - odmowa bazy kończyła się mailem z linkiem do konta bez profilu/roli i statusem „wysłane".                                                                                                                      | `profile_write_failed` / `author_write_failed` / `role_write_failed` przerywają wysyłkę przed mailem.                                                                                          |
| N3  | `lib/admin/impersonation.ts`         | `stopImpersonation` nie czytał wyniku `setSession` (który NIE rzuca, tylko oddaje `{ error }`). Wygasły refresh token super admina = stan i baner wyczyszczone, a przeglądarka ZOSTAWAŁA zalogowana jako podszywana osoba, bez żadnego oznaczenia.                                | Fail-closed: nieudany powrót kończy się `signOut({ scope: "local" })` (tylko ta karta - globalne unieważniłoby sesje podszywanej osoby). Audyt zamykany wyłącznie po udanym powrocie.          |
| N4  | `lib/authz/permissionMatrix.ts`      | (było `it.fails`) Kafel „Bramki bez current_tenant_id()" liczył WIERSZE, nie bramki: wiersz flagi skleja wszystkie jej bramki, więc na żywym snapshocie 23 zamiast 25.                                                                                                            | Liczenie po `ref` bramki z per-bramkowym odniesieniem do tenanta; bramka czytająca dwie flagi liczy się raz. Etykieta PL/EN już mówiła „bramki" - poprawione zostało wyrażenie.                |

### 2.2 Katalog członków (`lib/admin/membersDirectory.functions.ts`, plik z 0% na pokryty)

| #   | defekt                                                                                                                                                                               | naprawa                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| N5  | Awaria odczytu udawała pustkę: padnięty odczyt `payment_orders` rysował „0,00 zł / nigdy", nadań - plan domyślny, profili - „brak członków". Dotyczyło 8 zapytań listy i 2 historii. | Każdy odczyt przez `must()` - błąd z nazwą tabeli zamiast pustego wyniku.                                                           |
| N6  | Kwoty w różnych walutach były DODAWANE: 100 PLN + 50 EUR = „150,00 zł".                                                                                                              | Suma per waluta; waluta główna = waluta ostatniej wpłaty, pozostałe w nowym polu `paidOther`, panel pokazuje „70,00 € + 100,00 zł". |
| N7  | Odmowa wygaszenia poprzednich nadań była pomijana - przy błędzie powstawało DRUGIE aktywne nadanie, a rozstrzygnięcie brało wyższą rangę („obniżenie planu" nie obniżało).           | Błąd wygaszenia przerywa nadanie.                                                                                                   |
| N8  | Cofnięcie już cofniętego/cudzego nadania zapisywało w audycie „cofnięto" i oddawało sukces.                                                                                          | Brak cofniętego wiersza = błąd, bez wpisu audytu.                                                                                   |
| N9  | Termin „N miesięcy" przelewał koniec miesiąca: nadanie na 1 miesiąc z 31 stycznia wygasało 3 marca.                                                                                  | `addCalendarMonthsUtc` przycina dzień do ostatniego dnia miesiąca docelowego.                                                       |
| -   | Pusta strona oddawała katalog warstw w kolejności z bazy, pełna - po randze (droplista filtra przeskakiwała).                                                                        | Jedna kolejność (`tierCatalog`) dla obu wyjść.                                                                                      |

### 2.3 RODO, cookie banner, panele ustawień, biblioteka

| #   | miejsce                                             | defekt                                                                                                                                                                                                                                                            | naprawa                                                                                                                                                                                                               |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N10 | `lib/cookieBanner/registry.ts`                      | Kategoria klucza spoza rejestru zgadywana PODCIĄGIEM: `nes.preferences` (p-REF-erences) i `theme_header` (he-AD-er) szły do marketingu, `account`, `country`, `preview`, `preventScroll`, `sidebar-state` - do analityki. To informacja z art. 13 RODO w banerze. | `guessUnknownCategory`: długie jednoznaczne rdzenie jako podciąg (`__utmz`, `visitorId` nadal rozpoznane - zaniżenie byłoby gorsze), krótkie dwuznaczne (`ad`, `ref`, `stat`, `view`, `count`) tylko jako cały człon. |
| N11 | `lib/cookieBanner/config.ts`, `ConsentBanner`       | Zakres kafla logo 24-72 px był tylko atrybutem pola - „500" zapisywało się i baner rysował 500 px na każdej stronie.                                                                                                                                              | `clampCookieBannerLogoSize` w renderze banera i przy opuszczeniu pola w panelu (nie przy każdym znaku - „48" przechodzi przez „4").                                                                                   |
| N12 | `components/admin/settings/ConsentAuditSummary.tsx` | „Pokaż więcej" przy sufitcie 200 zostawał widoczny i nie robił nic; doczytanie czyściło dziennik na czas zapytania.                                                                                                                                               | Przycisk znika przy sufitcie; `placeholderData: keepPreviousData`.                                                                                                                                                    |
| N13 | `components/admin/SiteSettingsHistoryDialog.tsx`    | (było `it.fails`) Odrzucone przywrócenie rewizji kończyło się NIEOBSŁUŻONYM odrzuceniem obietnicy - telemetria dostawała fałszywy „nieobsłużony błąd JS".                                                                                                         | `catch` w `handleRestore`; błąd zgłasza mutacja wołającego, okno zostaje otwarte.                                                                                                                                     |
| -   | `components/admin/settings/FontPicker.tsx`          | Wartość spoza listy podpisywała się „Red Hat Display (domyślny)", choć podgląd rysował inny krój; dwa własne fonty o tej samej nazwie dawały zdublowany klucz Reacta.                                                                                             | Etykieta = pierwsza rodzina stosu; klucz po stosie.                                                                                                                                                                   |
| -   | `lib/admin/library.ts`                              | `deleteResource` usuwał PLIK przed WIERSZEM - odmowa usunięcia wiersza zostawiała w bibliotece materiał z martwym plikiem.                                                                                                                                        | Najpierw wiersz (źródło prawdy), potem plik best-effort.                                                                                                                                                              |

### 2.4 Optymalizacja: martwy kod

`refetchIntervalFor` (`lib/admin/dashboard/period.ts`) nie miał żadnego
wywołania w produkcji, a jego reguła („odświeżaj tylko na zakładce na żywo")
rozjechała się z faktycznym zachowaniem: puls na żywo jest odpytywany
NIEZALEŻNIE od zakładki (`useRealtimeQuery`). Usunięty - funkcja, której nikt nie
woła, a która opisuje inną regułę niż kod, jest dokumentacją fałszywą.

### 2.5 Panel cookie bannera w języku interfejsu i lokalizowane odnośniki banera

Dopisane w tym samym PR po pierwszym wdrożeniu (commity `8aa1a04`, `cc63dbf`).

**Panel `/admin/settings/cookie-banner` idzie za językiem interfejsu.** Cała
trasa i obie jej sekcje (marka/odnośniki, „Wykryte elementy") miały 47 napisów
po polsku wprost w JSX, zamrożonych w ratchecie `check:i18n-hardcoded`, więc
administrator z interfejsem angielskim czytał polszczyznę. Teraz:

- nowa nakładka `lib/i18n-admin-cookie-banner.ts` (przestrzeń
  `adminCookieBanner`), polskie brzmienia znak w znak jak wcześniej w kodzie;
  przestrzeń dopisana do bramki parytetu PL/EN (`i18nParity.gate.test.ts`),
  liczba mnoga PL (`_one/_few/_many`) w podsumowaniu skanu;
- trzy pliki zdjęte z bazy ratchetu (`monolingualUserText.ts`, 164 -> 161);
- **dwa języki na jednym ekranie są rozdzielone świadomie**: etykiety panelu
  idą za językiem INTERFEJSU, a przykłady w polach treści i atrybut `lang` pól
  idą za edytowaną WERSJĄ banera (zakładka PL/EN) - administrator z interfejsem
  po polsku edytujący wersję angielską widzi angielskie przykłady;
- tytuł karty w `head()` bierze język z ŻĄDANIA (`activeLang`), nie
  z singletonu i18next, który na serwerze jest wspólny dla równoległych żądań;
- cel elementu w „Wykrytych elementach" czytany w języku interfejsu
  (`pickLocalized`) - wcześniej zawsze `purpose_pl`;
- przy okazji (ten sam ekran): toasty zapisu wspólnego hooka `useSettings`
  (`adminToast.saved` / `saveFailed`) oraz etykiety urządzeń i błąd wgrywania
  w `CoverImagePicker` (`uploadArea.devices.*`, `uploadArea.uploadError`).

**Odnośniki banera prowadzą do właściwej wersji językowej.** Dodatkowe
odnośniki banera (`banner.links`) renderowały adres surowo, więc „/cookies"
wpisane raz prowadziło odwiedzającego wersji angielskiej na stronę polską,
a `javascript:` trafiało do `href`. `bannerLinkHref(url, lang)`
(`lib/cookieBanner/config.ts`):

- ścieżka wewnętrzna dostaje prefiks języka odwiedzającego (`localizedPath`),
  po rozwiązaniu tak jak przeglądarka (`\` -> `/`, sklejanie `..`), więc
  `/en/../cookies` nie ucieka na stronę polską, a `/\host` prowadzi w to samo
  miejsce w obu wersjach; pusty człon ścieżki (`/en//cookies`, `..//x`) jest
  sklejany - wcześniej wersja PL dostawała `//cookies`, czyli adres bez
  schematu prowadzący poza serwis;
- dozwolone schematy: `http`, `https`, `mailto`, `tel`; każdy inny (w tym
  `javascript:` z tabulatorem w środku) - odnośnik nie jest pokazywany;
- etykieta w języku banera (`pickLocalized`), pusty odnośnik pomijany;
- panel pokazuje przy każdym odnośniku, DOKĄD poprowadzi w wersji PL i EN,
  a adres niedozwolony oznacza `aria-invalid` z wyjaśnieniem; pusty stan
  linkuje do `/admin/settings/privacy` (strona polityki prywatności);
- `resolveBannerCopy`: puste pole treści wraca do brzmienia domyślnego -
  podpowiedzi w panelu przestały obiecywać coś, czego baner nie robił; ta sama
  reguła w podglądzie historii wersji (`CookieVersionsPane`, „tak zobaczy to
  odwiedzający"), przywrócenie zapisuje migawkę bez zmian.

---

## 3. Testy dopisane

| plik testowy                                                                       | co domyka                                                                              | testów |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -----: |
| `lib/admin/__tests__/membersDirectoryFunctions.test.ts`                            | katalog członków: rozstrzygnięcie warstwy, wpłaty, CRM, strony, granica najemcy, N5-N9 |     56 |
| `lib/admin/__tests__/invitationsFunctions.test.ts` (rozszerzony)                   | N1, N2                                                                                 |     +9 |
| `lib/admin/dashboard/__tests__/dashboardFunctions.test.ts`                         | server fn pulpitu (0% -> pokryty): okno, parametry RPC, „źródła nie ma" vs błąd        |     23 |
| `lib/admin/dashboard/__tests__/dashboardShapes.test.ts`                            | parsery w pełnym kształcie, kwant „teraz", formatowanie, odwrót nazw krajów            |     20 |
| `lib/admin/__tests__/schedulerFunctions.test.ts`                                   | harmonogram zadań tła (0% -> pokryty)                                                  |      9 |
| `routes/__tests__/adminPermissionsRoute.test.tsx`                                  | trasa `/admin/permissions` + pasek filtrów, legenda, karty, nota źródła                |     11 |
| `lib/authz/__tests__/permissionMatrixBranches.test.ts` (przepisana sekcja)         | N4                                                                                     |      4 |
| `components/admin/settings/__tests__/ConsentAuditSummary.test.tsx`                 | rejestr zgód w panelu (0% -> pokryty), N12                                             |     13 |
| `lib/cookieBanner/__tests__/registryScan.test.ts`                                  | skaner deklaracji cookie, N10                                                          |     40 |
| `components/admin/cookie-banner/__tests__/cookieBannerPanels.test.tsx`             | branding banera i „Wykryte elementy" (0% -> pokryte), N11, PL/EN, rozwiązane adresy    |     29 |
| `lib/cookieBanner/__tests__/bannerLinkHref.test.ts`                                | lokalizacja i walidacja odnośników banera, `resolveBannerCopy` (rozdz. 2.5)            |     41 |
| `routes/__tests__/adminCookieBannerI18n.test.tsx`                                  | trasa z PRAWDZIWYM słownikiem: PL/EN, przykłady wg wersji, tytuł karty z żądania       |      6 |
| `components/__tests__/ConsentBanner.test.tsx` (rozszerzony)                        | odnośniki banera wg języka, odrzucony `javascript:`, puste pole treści                 |     +3 |
| `components/admin/versions/__tests__/CookieVersionsPane.test.tsx` (rozszerzony)    | podgląd historii: puste pole treści = brzmienie domyślne, przywrócenie bez zmian       |     +1 |
| `components/admin/google-source/__tests__/GoogleSourceBadgeDeviceSection.test.tsx` | sekcja urządzenia Google Source (0% -> pokryta)                                        |      4 |
| `components/admin/settings/__tests__/FontPicker.test.tsx`                          | wybór kroju                                                                            |     10 |
| `lib/admin/__tests__/useSiteSettingsRevisions.test.tsx`                            | historia rewizji ustawień                                                              |      5 |
| `lib/admin/__tests__/adminClientData.test.ts`                                      | biblioteka, odznaki, klient podszywania, toasty (0% -> pokryte), N3                    |     26 |

Dwa przypięcia `it.fails` zdjęte (N4, N13), jedno dopisane (niżej).

---

## 4. Czego NIE naprawiono - jawnie

- **Filtr warstwy w katalogu członków działa tylko na bieżącej stronie**
  (przypięte `it.fails` w `membersDirectoryFunctions.test.ts`). `ListSchema`
  przyjmuje `tierKey`, ale handler go nie czyta, a panel filtruje 25 wierszy
  po stronie klienta, przy `total` liczonym ze wszystkich profili. Warstwa nie
  jest kolumną, tylko wynikiem rozstrzygnięcia z trzech tabel, więc poprawny
  filtr ze stronicowaniem wymaga funkcji SQL (zbiór `user_id` per warstwa) -
  `.in()` z listą identyfikatorów rozsadza długość adresu przy setkach członków.
- Pozostałe przypięcia `it.fails` w testach tras modułu 19 (odbiorcy,
  integracje, użytkownicy, organizacje, słownik imion) - poza zakresem sześciu
  funkcjonalności.

---

## 5. Bramki uruchomione na tym drzewie

- 32 bramki `check:*` z zestawu `verify:static` - zielone.
- `format:check` oblewał na `src/styles.css` (ten sam stan na `main`,
  `45404b0`); wielkość liter jednego koloru poprawiona w `1e433ab` - zmiana
  staje się no-opem, gdy baza ją dostanie. Wszystkie pliki zmienione tutaj
  przechodzą `prettier --check` i `eslint` bez uwag.
- `tsc --noEmit` - czysto.
- Dotychczasowe testy modułu (243 pliki importujące moduł 19 wprost + trzy
  nowe + `ConsentBanner`, `ImpersonationBanner`, `adminLibraryRoute`):
  **246 plików, 9 409 testów zielonych, 89 `it.fails`, zero czerwonych**
  (przed: 9 354 / 91 - dwa przypięcia zdjęte naprawą).
- Pliki testowe dopisane lub zmienione tą pracą (14): **565 testów, 565
  zielonych**; w tym jedno nowe `it.fails` (filtr warstwy, rozdz. 4).
- Część 2 (rozdz. 2.5): 74 pliki testowe importujące zmienione moduły wprost
  (**2 573 zielone, 16 `it.fails`**) i 366 kolejnych sięgających ich
  przechodnio przez graf importów (**15 231 zielonych, 66 `it.fails`**), zero
  czerwonych. Jedyne dwa czerwone w pierwszym przebiegu to testy ramek
  urządzeń w `CoverImagePicker.test.tsx`, które sprawdzały dawne literały
  „Desktop/Tablet/Mobile" - poprawione na klucze `uploadArea.devices.*`, jak
  reszta tego pliku (atrapa `t` oddaje klucz). `tsc --noEmit` czysto.
- Przegląd adwersaryjny części 2 (trzy soczewki: odnośniki i bezpieczeństwo,
  i18n/SSR, regresje w kodzie wspólnym; każde znalezisko weryfikowane osobno):
  dwa potwierdzone i naprawione (pusty człon ścieżki, podgląd historii wersji);
  odrzucone: podwójny prefiks `/en/en/...` (adres i tak 404, zmiana poprawia
  stan), tytuł karty po przełączeniu języka bez nawigacji (wcześniej tytuł nie
  szedł za językiem wcale). Nowe testy obu napraw oblewają na kodzie sprzed
  poprawki (8 czerwonych), z poprawką zielone.

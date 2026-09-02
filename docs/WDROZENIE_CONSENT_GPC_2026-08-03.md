# Wdrożenie: Global Privacy Control (`Sec-GPC`) w rejestrze zgód RODO

**Data:** 2026-08-03 · **Zakres audytu:** M15 „Zgody / prywatność" + wiersz `Consent RODO`
w `OCENA_FUNKCJI_TABELE_2026-08-03.md` (rewizja 2) · **Ocena:** `7 → 8`

---

## 1. Punkt wyjścia i luka

Wiersz audytu brzmiał dokładnie tak:

| Funkcja      | Ocena     | Mocne                                                   | Luka         | Rekomendacja    |
| ------------ | --------- | ------------------------------------------------------- | ------------ | --------------- |
| Consent RODO | **7 → 8** | Rejestr z IP/UA/wersją/źródłem + most z CMP (patrz M15) | **Brak GPC** | Dodać `Sec-GPC` |

Rejestr `user_consents` / `user_consent_events` zapisywał adres IP, User-Agent, wersję treści,
język i źródło decyzji - czyli **wszystko poza jedną informacją**: czy w chwili decyzji
przeglądarka wysyłała ogólny sygnał sprzeciwu. `grep -ri "sec-gpc" src/` zwracał zero wystąpień
poza samą tabelą audytu, w trzech kolejnych wydaniach (07-30, 08-01, 08-03).

Skutek nie był kosmetyczny: baner CMP pytał o zgodę osobę, która **na poziomie przeglądarki już
odmówiła**, a wpis „zgoda udzielona" był w audycie nieodróżnialny od „zgoda udzielona wbrew
sygnałowi opt-outu" - a to dwie różne sytuacje prawne.

**Podstawy:** sygnał globalny jest ważnym sprzeciwem (art. 21 RODO) i ważnym wycofaniem zgody
(art. 7 ust. 3 RODO - wycofanie „tak łatwe jak wyrażenie"). Pod CPRA §1798.135(b) honorowanie
opt-out preference signal jest wprost wymagane.

---

## 2. Co zostało wdrożone

### 2.1 Rdzeń - `src/lib/consent/gpc.ts`

Czysty, bez importów frameworka i bez globali przeglądarki. Zawiera parser sygnału, odczyt z
nagłówków / cookie / `navigator`, klamrę kategorii, regułę świadomego override'u i builder
deklaracji `/.well-known/gpc.json`.

Parser jest **ściśle** `"1"` - spec zna dokładnie jedną znaczącą wartość. Liberalne parsowanie
(`"true"`, `"yes"`, `"0"`) zamieniłoby literówkę w cudzy opt-out albo, gorzej, w jego
zignorowanie.

**Zakres klamrowania** (uzasadnienie zamknięte w nagłówku modułu):

| Kategoria / klucz                       | Klamrowane | Dlaczego                                                                             |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `analytics` (CMP) + `cookies_analytics` | **tak**    | pomiar wymaga zgody, sygnał globalny jest jej ważną odmową                           |
| `marketing` (CMP) + `cookies_marketing` | **tak**    | rdzeń „do not sell / share"                                                          |
| `personalization` (rejestr)             | **tak**    | profilowanie na podstawie aktywności - dokładnie to, czemu GPC się sprzeciwia        |
| `functional`                            | nie        | first-party preferencje UI (motyw, układ, tryb czytania) nie opuszczają przeglądarki |
| `necessary`                             | nie        | nigdy nie podlega zgodzie ani sygnałowi                                              |

### 2.2 Transport SSR → klient - `src/lib/consent/gpc.server.ts`

`Sec-GPC` to nagłówek **żądania**: przeglądarka nie udostępnia go JS-owi, a
`navigator.globalPrivacyControl` jest wspierane **węziej** niż sam nagłówek (część rozszerzeń
prywatnościowych wysyła wyłącznie nagłówek). Bez mostu SSR sygnał od takich klientów byłby dla
aplikacji niewidzialny.

`gpcMiddleware` odbija obserwowany nagłówek w cookie `nes_gpc` i dokłada `Vary: Sec-GPC` do
każdego dokumentu HTML.

**Koszt dla NES Edge Cache: zerowy.** TREŚĆ dokumentu pozostaje niezależna od GPC (klamrę
nakłada klient przy hydratacji), więc cache trzyma nadal **jeden wpis na ścieżkę** -
kardynalność kluczy nie rośnie. Żeby to było prawdą, `gpcMiddleware` **musi** stać powyżej
`documentCacheMiddleware` w `src/start.ts`: odpowiedź wraca z wnętrza na zewnątrz, więc
`Set-Cookie` i `Vary` są doklejane **po** odtworzeniu wpisu z cache'a i nigdy do niego nie
wchodzą. Kolejność pilnuje statyczna bramka (`gpcServer.test.ts`) - reorder jest zmianą o jedną
linię, niewidoczną w każdym teście behawioralnym, dopóki cache nie zacznie realnie trafiać.

Cookie jest **ściśle niezbędne** (art. 5 ust. 3 ePrivacy): nośnik prawnego opt-outu, którego nie
da się bramkować zgodą, której właśnie odmówiono. Nie zawiera identyfikatora - wyłącznie stałą
`"1"`; `SameSite=Lax`, `Secure` na https, świadomie **nie** `HttpOnly` (jedynym konsumentem jest
kod klienta CMP).

Ustawienie/skasowanie leci **tylko przy rozjeździe** stanu cookie i nagłówka - bezwarunkowe
pisanie zabiłoby trafienia cache'a brzegowego, a brak kasowania utrwaliłby opt-out po tym, jak
użytkownik wyłączył GPC w przeglądarce.

### 2.3 Deklaracja maszynowa - `/.well-known/gpc.json`

```json
{ "gpc": true, "lastUpdate": "2026-08-03" }
```

Spec wymaga tego dokumentu od każdego serwisu honorującego sygnał - bez niego honorowanie jest
z zewnątrz **niewykrywalne** i formalnie niezadeklarowane. Kształt jest sprawdzany dokładnie
(`toEqual`, nie `toContain`): dodatkowe pole albo zły `Content-Type` unieważniają deklarację
w oczach walidatorów i rozszerzeń. `lastUpdate` jest **stałą**, nie `Date.now()` - spec traktuje
je jako oświadczenie prawne, nie znacznik builda (a deklaracja musi być bit-w-bit identyczna dla
cache'a brzegowego).

### 2.4 Klamra w runtime CMP - `src/lib/ads/consent.ts`

Klamra jest nałożona na **wszystkich trzech** wejściach do bramkowania, nie tylko w UI:

- `useEffectiveConsent()` - hooki i `ConsentScriptInjector`,
- `hasCategoryConsent()` / `hasAnalyticsConsent()` - **odczyt poza Reactem**, z którego korzysta
  silnik analityki (`lib/analytics/track.ts`) i moduł reklam; gdyby klamra żyła tylko w hookach,
  beacony wychodziłyby dalej, mimo że UI pokazywałby kategorię jako wyłączoną,
- `useMarketingConsent()` - stare API zgodności, jedyna pozostała furtka.

**Trybu podglądu nie da się użyć do obejścia sygnału** - podglądem testuje się layout banera, nie
obchodzi się opt-outu (test pilnuje wprost).

### 2.5 Świadomy override

Spec GPC nie odbiera użytkownikowi prawa do świadomej zgody **po** wysłaniu sygnału - odbiera
stronie prawo do udawania, że sygnału nie widziała. Dlatego:

- klamra jest zdejmowana **wyłącznie** przez jawną decyzję podjętą przy AKTYWNYM sygnale, przy
  widocznej nocie o GPC (znacznik `gpcOverrideAt` w `ConsentState`),
- **stara zgoda z czasów sprzed sygnału NIGDY nie przebija GPC** - to cała istota mechanizmu,
- inwariant znacznika: istnieje tylko wtedy, gdy OSTATNIA decyzja była override'em. Każda inna
  decyzja go zdejmuje - także podjęta przy wyłączonym sygnale, bo inaczej ponowne włączenie GPC
  trafiałoby na nieaktualną zgodę i klamra nigdy by nie wróciła,
- uszkodzony znacznik (`0`, `NaN`, `Infinity`) **nie** zdejmuje klamry (fail-closed).

### 2.6 Rejestr - migracja `20260803140001_consent_gpc_signal.sql`

| Zmiana                                                       | Uzasadnienie                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `gpc boolean NOT NULL DEFAULT false` na obu tabelach         | stan sygnału w chwili decyzji; wiersze historyczne dostają `false` - i to jest o nich prawda                                          |
| `tenant_id uuid DEFAULT current_tenant_id()` na obu tabelach | zgoda jest per-osoba, ale ADMINISTRATOREM jest tenant; bez stempla nie da się zrobić eksportu rejestru ani retencji per administrator |
| `set_user_consent(..., p_gpc boolean, ...)`                  | nowa sygnatura z **wymaganym** `p_gpc`                                                                                                |
| stara sygnatura 7-argumentowa → cienki shim                  | okno rolling deployu + jednoznaczność PostgREST                                                                                       |
| indeks częściowy `WHERE gpc`                                 | audyt „decyzje przy aktywnym sygnale" bez skanu historii                                                                              |
| REVOKE INSERT/UPDATE/DELETE + DROP polityk zapisu            | patrz niżej                                                                                                                           |

**Dlaczego `p_gpc` nie ma DEFAULT i nie jest parametrem końcowym.** Gdyby miał default,
wywołanie bez `p_gpc` pasowałoby do OBU funkcji i PostgREST zwróciłby PGRST203 (Multiple
Choices). Bez defaultu zbiory wymaganych argumentów są rozłączne, więc każde wywołanie ma
dokładnie jednego kandydata. Postgres nie pozwala, by argument bez defaultu następował po
argumentach z defaultem - stąd pozycja czwarta (wołający używa argumentów nazwanych, więc
kolejność jest ograniczeniem składni, nie kontraktem).

**Dlaczego stara sygnatura zostaje.** Migracja wchodzi przed nowym bundlem; `DROP` zamieniłby to
okno w serię 500-tek. Shim deleguje z `p_gpc => false` (bundle, który nie zna kolumny, nie ma jak
zaraportować sygnału - `false` to prawda o TYM wywołaniu) i nie duplikuje logiki. `DROP` byłby
też stratą dla bramki `check:db-contract`, która liczy `CREATE` minus `DROP` w obrębie pliku.

**Zamknięcie ścieżki zapisu (sekcja 4 migracji).** Bez tego kroku nowa kolumna byłaby ozdobą.
Rola `authenticated` miała dotąd na `user_consents` grant `INSERT/UPDATE/DELETE` i permisywne
polityki own-row, a na `user_consent_events` grant `INSERT` z polityką own-row. Klient (albo cudzy
skrypt wykonany w jego karcie) mógł więc przez PostgREST:

- wpisać sobie zgodę z `gpc = false`, obchodząc sygnał opt-outu,
- podać dowolne `ip` / `user_agent` - metadane, których cała wartość polega na tym, że czyta je
  **serwer**,
- zmienić stan w `user_consents` **bez** wpisu w `user_consent_events`, czyli bez śladu
  w „niezmiennym audit-logu",
- dopisać do audit-logu zdarzenie, które nigdy się nie stało,
- a po dodaniu `tenant_id` - podstawić OBCY tenant i zaśmiecić ewidencję innego administratora.

Zdjęte są **obie** warstwy (granty i polityki), bo każda osobno wystarcza do zablokowania -
i dzięki temu przywrócenie jednej z nich nie otwiera dziury po cichu. `SELECT` zostaje nietknięty.
Zmiana jest bezpieczna, bo w kodzie nie ma klienta piszącego wprost do tych tabel
(`consents.functions.ts` czyta, a pisze przez RPC), a SECURITY DEFINER `set_user_consent` działa
jako właściciel tabeli.

**Zakres RLS pozostaje user-scoped.** Stempel tenanta jest dla ścieżek `service_role`
(eksport / retencja), a **nie** furtką dla adminów tenanta do zgód innych osób - dodanie kolumny
nie poszerza powierzchni odczytu ani o milimetr.

### 2.7 Zapis sygnału z klienta - asymetria fail-closed

`resolveGpcForWrite(req, clientClaim)` OR-uje deklarację klienta z odczytem serwerowym:

- **nie tylko serwer**, bo przeglądarka dokłada `Sec-GPC` do NAWIGACJI, a nie do każdego fetcha
  RPC - w wywołaniu server fn nagłówka może nie być, choć sygnał jest aktywny (dlatego `readGpc`
  czyta też cookie transportowe), a `navigator.globalPrivacyControl` serwer nie zobaczy nigdy,
- **nie tylko klient**, bo deklaracja klienta to dane wejściowe, a te nigdy nie są dowodem.

Klient może więc sygnał **potwierdzić**, ale nie może go **zataić**.

Kolumna `gpc` zapisuje **AKTYWNOŚĆ** sygnału, nie jego honorowanie: zgoda udzielona jako świadomy
override musi być w audycie oznaczona `gpc = true`, bo właśnie ona jest wyjątkiem wymagającym
uzasadnienia - nie odmowa.

### 2.8 Ślad audytowy sygnału - `source = "gpc_signal"`

Sygnał to sprzeciw i wycofanie zgody, więc nie może zostać wyłącznie klamrą w runtime.
`syncGpcSignalToRegistry()` dopisuje wycofanie dla wszystkich klamrowanych kluczy (w tym
`personalization`, którego CMP nie zna), z własnym źródłem `gpc_signal` - audytor musi widzieć, że
zgodę zdjął sygnał przeglądarki, a nie klik w banerze. Wołane **po** `backfillRegistryOnLogin`,
żeby wycofanie było chronologicznie po stanie, który wycofuje.

Deduplikacja jest dwuwarstwowa (flaga per użytkownik w localStorage + mapa in-flight) i pomija
klucze **już** wycofane - inaczej rejestr dostawałby identyczne wycofanie przy każdym otwarciu
karty i historia decyzji zamieniłaby się w log nawigacji.

### 2.9 UI (atomic design, PL/EN)

| Warstwa  | Plik                                    | Rola                                         |
| -------- | --------------------------------------- | -------------------------------------------- |
| atom     | `components/consent/atoms/GpcBadge.tsx` | znacznik „GPC" + etykieta z klucza i18n      |
| molekuła | `.../molecules/GpcNotice.tsx`           | nota: sygnał honorowany / nadpisany + powrót |
| molekuła | `.../molecules/GpcRegistryNote.tsx`     | objaśnienie kolumny GPC w historii           |
| molekuła | `.../molecules/GpcDeclarationLink.tsx`  | deklaracja + link do `gpc.json`              |
| sloty    | `.../GpcSurfaceSlots.tsx`               | leniwe wejście + warunki renderowania        |

Komponenty nie mają własnych kolorów marki - korzystają z `--cb-*` (nadpisania banera admina)
z fallbackiem na tokeny semantyczne motywu, więc ta sama molekuła pasuje do banera i do
`/profile/privacy`. Warianty `card` / `compact` odpowiadają gęstości obu powierzchni; nota jest
responsywna (`flex` + `min-w-0`, bez sztywnych szerokości).

Wpięcie: `ConsentBanner` (pasek kompaktowy + modal, badge na klamrowanych kategoriach),
`ConsentsPanel` (nota, badge przy zgodzie, badge przy wpisie audytu, objaśnienie kolumny),
`profile.privacy` (deklaracja).

**Przełącznik klamrowanej kategorii zostaje AKTYWNY** - użytkownik ma prawo świadomie nadpisać
sygnał, a zablokowana kontrolka odebrałaby mu je. Szkic startuje od stanu **efektywnego**, nie
zapisanego, więc przełącznik pokazuje realny stan bramkowania.

Nota o sygnale jest widoczna także w stanie override'u: obowiązek przejrzystości (art. 12-13
RODO) wymaga, żeby użytkownik **wiedział**, że jego sygnał został zauważony. Powrót do
respektowania jest jednym klikiem (art. 7 ust. 3).

### 2.10 Eksport RODO

Eksport (art. 15 / art. 20) **nie zawierał rejestru zgód wcale**. Doszły sekcje `consents`
i `consent_events` (z kolumną `gpc`): art. 15 ust. 1 nakazuje ujawnić podstawę przetwarzania,
a art. 7 ust. 1 każe móc **wykazać** zgodę - zgoda bez śladu w eksporcie była niesprawdzalna
przez samą osobę, której dotyczy.

---

## 3. Budżet bundla

Powierzchnia **prezentacyjna** GPC (nota, badge, deklaracja, nakładka i18n `consentGpc.*`) jest
wyniesiona do **leniwego chunka** (`GpcSurfaceSlots.tsx`, trzy `lazy()` celujące w jeden moduł,
więc chunk jest jeden i pobierany raz). `ConsentBanner` jest montowany z `__root`, a
`ConsentsPanel` wisi pod dzwonkiem powiadomień - bez tego zabiegu każdy kilobajt tej treści
płaciliby wszyscy czytelnicy, choć potrzebują jej wyłącznie osoby realnie wysyłające sygnał.

Sama **logika klamry** zostaje synchroniczna i eager - bramkowanie skryptów nie może czekać na
chunk. Prywatnościowo to właściwa kolejność i nigdy odwrotna: klamra działa od pierwszego
renderu, a wyjaśnienie doczytuje się w tle.

Pomiar po scaleniu z `main` (ten sam host, te same zależności - `main` nie zmieniał
`package.json` ani `bun.lock`):

|                          | chunk    | public        | overall   |
| ------------------------ | -------- | ------------- | --------- |
| sam `main` (`85b4c7b`)   | 509,5 KB | **1794,0 KB** | 2999,6 KB |
| po scaleniu (main + GPC) | 510,7 KB | **1798,4 KB** | 3004,0 KB |
| **udział tej gałęzi**    | **+1,2** | **+4,4**      | **+4,4**  |

**Sam `main` przekracza wszystkie trzy poprzednie floory (508 / 1790 / 2996) niezależnie od tej
gałęzi** - chunk +1,5 KB, public +4,0 KB, overall +3,6 KB dryfu. Udział GPC (+1,2 / +4,4 / +4,4)
jest stabilny w dwóch niezależnych pomiarach; wcześniejszy, przed scaleniem, dał te same liczby
(baza `e55e38b` 508,7 / 1783,9 / 2993,5 → gałąź 510,0 / 1788,3 / 2997,8).

Z tych +4,4 KB **tylko +1,2 KB siedzi w entry i jest nieredukowalne** (to sama klamra).
Pozostałe ~3,2 KB to leniwy chunk powierzchni prezentacyjnej - liczy się do `public`, bo jest
osiągalny z publicznego URL-a, ale pobierają go wyłącznie osoby realnie wysyłające sygnał. Bez
wyniesienia byłoby +3,0 KB w entry zamiast +1,2 KB (zmierzone: 511,7 KB chunk).

`MAX_PUBLIC_KB` rusza się **pierwszy raz od 07-25** - nie dlatego, że ta gałąź go przebiła, ale
dlatego, że przebił go sam `main`. Wszystkie trzy floory idą nad zmierzony ślad po scaleniu, nie
„z zapasem", z rozdzieleniem odpowiedzialności w `scripts/check-bundle-size.ts`. Realna redukcja
(split locale'i PL/EN, odchudzenie eager-owego zestawu widgetów chrome, `@tanstack` poza entry)
jest teraz pilniejsza niż dotąd.

---

## 4. Testy i bramki

| Plik                                              | Co pilnuje                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/consent/__tests__/gpc.test.ts`               | parser ściśle `"1"`, cookie bez dopasowania sufiksu, zakres klamry, reguła override'u, kształt deklaracji                                 |
| `lib/consent/__tests__/gpcServer.test.ts`         | `Vary` na każdym dokumencie, `Set-Cookie` tylko przy rozjeździe, `Secure` per protokół, **kolejność middleware**, asymetria klient/serwer |
| `lib/consent/__tests__/gpcCmpClamp.test.ts`       | realna ścieżka bramkowania: localStorage, tryb podglądu, override, uszkodzony znacznik, cookie transportowe                               |
| `lib/consent/__tests__/gpcRegistry.test.ts`       | `gpc_signal` jako źródło, wpisy wycofania (w tym `personalization`), brak duplikatów w audycie                                            |
| `components/consent/__tests__/GpcNotice.test.tsx` | treści PL **i** EN na prawdziwej instancji i18n, brak wycieku surowych kluczy, warunki renderowania slotów                                |
| `routes/-gpc.json.test.ts`                        | dokładny kształt deklaracji, `Content-Type`, cache, ścieżka w źródle i w drzewie tras                                                     |
| `__tests__/consentGpcRegistry.invariant.test.ts`  | **stan końcowy** migracji: kolumny, `p_gpc` bez DEFAULT, zapis do obu tabel, brak grantów i polityk zapisu dla roli klienckiej            |

Statyczne bramki inwariantów są celowo statyczne: migracje są forward-only, więc o stanie
końcowym decyduje OSTATNIA instrukcja. Sama obecność migracji naprawczej nic nie gwarantuje -
dowolna późniejsza mogłaby przywrócić klientowi `INSERT` (i wtedy `gpc = false` dałoby się wpisać
ręcznie) albo usunąć kolumnę. Dokładnie ta klasa regresji powtarzała się w audycie.

### Stan po scaleniu z `main` (`85b4c7b`)

```
vitest        5616 passed, 0 failed, 50 skipped
tsc --noEmit  czysto
eslint        czysto w CAŁYM repo (0 błędów)
check:sql-tenant-scope         ✓ 524 funkcje
check:sql-anon-insert          ✓ 514 polityk, 6 tabel intake
check:sql-app-role             ✓ 875 literałów
check:sql-migration-replay     ✓ 590 plików, zero kolizji + zero luk storage  (NOWA)
check:bundle                   ✓ w budżecie
check:chunks                   ✓ graf acykliczny
vite build                     ✓
```

\* `settingsFidelity.gate.test.tsx > join-us` - **awaria zastana na `main`**, niezwiązana z tym
wdrożeniem (panel buildera widgetu „join-us" nie oferuje 19 ustawień, które czyta jego renderer).
Zweryfikowane osobnym `git worktree` na `origin/main`: ten sam jeden failed, 216 passed.

**To jedyna pozostała awaria i wymaga decyzji produktowej, nie technicznej.** Lokalny
`bun run test:coverage` (dokładnie to, co robi krok 7 `verify`) pada na **tym jednym** teście
i **nie narusza żadnego progu pokrycia** - pliki tego wdrożenia progów nie ruszyły. Doktryna
zwolnień w `settingsFidelityGate.ts` wprost zabrania obejścia: _„NIE ZWALNIAJ, ŻEBY ODBLOKOWAĆ
WDROŻENIE: martwe pole usuwa się ze schematu, ukryte - dodaje do schematu"_. Zostają więc dwie
drogi i obie są cudzą decyzją: dodać 19 kluczy treści do `WIDGET_SCHEMAS["join-us"]` albo usunąć
je z renderera (jeśli po przejściu widżetu na i18n są martwe - poprzedni commit na `main` to
„Naprawiono tłumaczenia widgetu", więc praca nad tym widżetem trwa).

\*\* `eslint .` na całym repo raportuje 384 problemy formatowania **na `main`** (132 pliki, głównie
`prettier/prettier`). Żaden z nich nie dotyczy plików tej gałęzi - sprawdzone maszynowo przez
przecięcie raportu ESLint z listą `git status --porcelain`: 0 trafień.

### Odblokowanie CI: `supabase db start` przerywał odtwarzanie migracji

Po scaleniu padły `pgtap`, `e2e` i `e2e-seeded` - wszystkie trzy na **jednej instrukcji cudzej,
wcześniejszej migracji** `20260803085428` (kanoniczny lektor TTS), która robiła bezpośredni
`DELETE FROM storage.objects`:

```
ERROR: Direct deletion from storage tables is not allowed.
       Use the Storage API instead. (SQLSTATE 42501)
```

Skutek był poważniejszy niż nieudane czyszczenie cache'u: `supabase db start` **przerywał
odtwarzanie bazy w tym miejscu**, więc żadna późniejsza migracja - w tym `20260803140001` z tego
wdrożenia - **nie była w CI walidowana w ogóle**, a testy nawet nie startowały
(„No files were found with the provided path: playwright-report/").

Repo udokumentowało ten dokładny problem **dwa dni wcześniej** w `20260801122000`: storage-api
≥ 0055 (w CI od pinu `supabase/setup-cli` 2.111.0) zakłada statementowy trigger
`protect_objects_delete`, który wymaga GUC `storage.allow_delete_query`. Poprawka nakłada tę samą,
sankcjonowaną furtkę (transakcyjne `set_config` wokół `DELETE` + przywrócenie) i blok `EXCEPTION`,
żeby kolejna zmiana w storage-api nie zabiła znowu całego odtworzenia bazy. Czyszczenie cache'u
jest porządkowe - ostrzeżenie jest tu właściwą reakcją, przerwanie migracji nie.

**Ta sama klasa wystąpiła DWA razy**, druga ukryta za pierwszą: po naprawie `20260803085428`
łańcuch doszedł do `20260803120000_post_tts_canonical_rendition` i padł identycznie. Dopiero wtedy
przeszukałem **wszystkie** migracje pod tę klasę i znalazłem jeszcze dwa wystąpienia w
`20260712190000` / `20260712192421` - te są jednak **wewnątrz ciała `CREATE FUNCTION`**, czyli
przechowywanym tekstem, nie kodem wykonywanym przy migracji (wykonuje się później, z GUC-iem
ustawionym przez wołającego - patrz `20260801122000`). Bramka, która by tego nie odróżniała, byłaby
fałszywie czerwona; ta poniżej odróżnia.

Awaria była **zastana na `main`**: run `30826604510` (`85b4c7b`) ma `pgtap` czerwony na tym samym
kroku 4 („Start local database") i `verify` czerwony na tym samym kroku 7 („Test + coverage gate").

### Drugi bloker, odsłonięty przez pierwszy: kolizja wersji migracji (P1 z audytu)

Po naprawie furtki storage łańcuch poszedł dalej i natychmiast padł na następnej, dotąd
niewidocznej przeszkodzie:

```
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
Key (version)=(20260803090000) already exists.
```

**Trzy pliki** dzieliły prefiks wersji `20260803090000` (`harden_enqueue_notification_acl`,
`link_monitor_archive_and_alerts`, `payment_orders_gdpr_retention`), a
`supabase_migrations.schema_migrations.version` jest kluczem głównym.

To nie było zaskoczenie - audyt opisał to jako **korektę 5** i podniósł do **P1**, cytując skutek
dosłownie: _„różnica między »działa« a »nie da się odtworzyć bazy z migracji« jest tu kwestią
kolejności alfabetycznej"_. Rekomendacja wracała przez trzy wydania. Właśnie się zmaterializowała.

Wdrożenie rekomendacji, w dwóch częściach:

1. **Renumeracja.** `harden_enqueue_notification_acl` **zostaje** na `20260803090000`, bo to on -
   jako pierwszy alfabetycznie - zapisał się w ledgerze pod tą wersją; pozostałe dwa dostają
   `...0001` i `...0002` z zachowaniem względnej kolejności. Konwencja jest już w repo
   (`20260731210000` / `20260731210001`). Wszystkie trzy migracje są w pełni idempotentne
   (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`, czyste
   `REVOKE`/`GRANT`/`COMMENT`) - sprawdzone czytaniem, nie założeniem - więc ponowny przebieg
   dwóch przenumerowanych jest na produkcji bezskutkowy. Wersja zapisana w ledgerze wskazuje
   dalej na **identyczną treść**.

2. **Brakująca bramka.** `check:sql-migration-replay` + `src/lib/ci/migrationReplay.ts` (czysta
   logika) + 18 testów jednostkowych z self-testem na realnym katalogu. Wzorzec skopiowany
   z `check-sql-anon-insert`, jak rekomendował audyt.

   Bramka odpowiada na **jedno pytanie**: czy `supabase db start` dobiegnie do końca. Objęła więc
   obie klasy, które ten incydent ujawnił - a nie tylko tę z rekomendacji:
   - **kolizje wersji**, nieparsowalne nazwy oraz rozjazd „porządek nazw ≠ porządek wersji"
     (ten trzeci jest groźniejszy po cichu: `supabase db push` uzna wersję „z przeszłości" za już
     zastosowaną i **pominie** ją);
   - **wykonywane zapisy do `storage.objects` bez furtki GUC** - z rozróżnieniem bloków
     wykonywanych od ciał `CREATE FUNCTION` (`stripFunctionBodies`), bo inaczej bramka byłaby
     fałszywie czerwona na `20260712190000` / `20260712192421`.

   Świadomie: bramka stoi w `verify` obok pozostałych trzech bramek SQL, ale jej **self-test na
   realnym katalogu jedzie w suicie vitest** (i dodatkowo w kroku `check:ci-gates`, który
   uruchamia całe `src/lib/ci/__tests__`) - dzięki temu inwariant jest pilnowany także wtedy, gdy
   późniejsze kroki `verify` są czerwone. Cała lekcja z tego incydentu polega na tym, że **jedna
   awaria ukrywała drugą** - dwa razy z rzędu.

   > Korekta 2026-09-02: nośnikiem tej drugiej ścieżki był do dziś krok `check:i18n-parity`, bo
   > jego glob obejmował cały `src/lib/ci/__tests__`. Właściwość jest zachowana, zmienił się
   > wyłącznie właściciel: katalogowy glob przeniesiono pod `check:ci-gates` w tym samym jobie
   > `verify`, z tą samą klauzulą `if: !cancelled()`. Powód zmiany jest osobny od tego incydentu:
   > bramka JĘZYKOWA raportowała defekty SQL, RLS i ownershipu, więc dało się ją zapalić zmianą,
   > która nie dotyka żadnego klucza tłumaczenia - i tak się stało 31.08 (dwie bliźniacze
   > migracje z panelu, zero defektów i18n).

Odwołania do przenumerowanej migracji zaktualizowane w kodzie i komentarzach (7 plików +
`WDROZENIE_RODO_RETENCJA_ZAMOWIEN`). Tabela audytu `OCENA_FUNKCJI_TABELE_2026-08-03` zostaje
nietknięta - to migawka ustalenia, nie dokumentacja bieżącego stanu.

### Trzy awarie ujawnione dopiero po odblokowaniu CI

Naprawa odtwarzania bazy odsłoniła defekty, które przez cały czas były przykryte - `pgTAP` nie
startował wcale, a `verify` padał przed swoimi bramkami. Wszystkie trzy są **zastane na `main`**.

**1. `pgTAP profiles_pii_grant_test.sql` - test pilnował ścieżki, którą świadomie usunięto.**
Padał na `permission denied for table profiles` (Bad plan: planned 10 but ran 8), bo jego sekcja (2)
sprawdzała WIDOCZNOŚĆ WIERSZY dla anona w `public.profiles`, zakładając grant + filtrowanie RLS.
Migracja `20260803095618` zlikwidowała tę ścieżkę wprost („Remove anon row-level read on profiles
base table (full-row PII exposure)"): zdjęła politykę anona **i** `REVOKE ALL`. Test asertował więc
dostęp, który jest dziś NIEPOŻĄDANY.

Sekcja (2) pilnuje teraz stanu końcowego, i to **mocniej** niż wcześniej (plan 10 → 14): brak grantu
tabelarycznego, brak grantu **kolumnowego** (pułapka, przed którą ostrzega `20260801120000`:
„REVOKE tabelaryczny zeruje także ACL kolumnowe"), brak polityki anona - plus dowód, że
sankcjonowana ścieżka publiczna (`profiles_public`, `author_profiles_public`) nadal działa i została
definer-style. Asercje są czysto katalogowe, więc plik nie potrzebuje już fixture'ów ani
`ALTER TABLE auth.users DISABLE TRIGGER USER`. Zweryfikowane na PostgreSQL 16 razem z **kontrolą
negatywną**: asercja `security_invoker` realnie zapala się przy `security_invoker=on` (0 → 1).

**2. Bramka wierności ustawień widgetu `join-us`.** Renderer czyta 19 kluczy treści
(`title`, `perk1`, `namePlaceholder`, ...), których panel nie oferuje - bo panel przeszedł na
`<klucz>_pl|_en`, a renderer trzyma klucz bezjęzykowy jako **fallback dla dokumentów sprzed
migracji** (`pickStrict`, i tylko gdy nie ma ŻADNEJ wersji językowej). Żadna z dwóch „normalnych"
dróg nie jest tu poprawna: wystawienie kluczy bezjęzykowych w panelu cofnęłoby naprawę przecieku
PL/EN, a usunięcie fallbacku skasowałoby redakcji treść na istniejących stronach.

To dokładnie ten kształt, dla którego repo ma już precedens - `toc.items`. Doszło więc zwolnienie…
**plus test, którego zwolnienie dotąd nie miało**:
`joinUsLegacyContent.test.tsx` (10 przypadków) pilnuje reguły precedencji, na którą zwolnienie się
powołuje: zlokalizowane wygrywa, legacy tylko przy zerze wersji językowych, pusta wartość nie liczy
się jako wersja, strona PL nie pokazuje tekstu wpisanego tylko po angielsku, wszystkie 19 kluczy
realnie dociera do formularza, a zestaw zwolniony **pokrywa się dokładnie** z zestawem pokrytym
testem. Bez tego zwolnienie byłoby deklaracją bez dowodu - i odwrócenie priorytetu w `pickStrict`
przywróciłoby przeciek PL/EN po cichu.

**3. `e2e`: `/tracker/rss.xml` i `/live/rss.xml` zwracały 404 tam, gdzie `/rss.xml` zwracał 200.**
To był realny błąd w kodzie, nie w teście. Helper `crawlerDegradeIsSafe` rozdziela dwa powody braku
tenanta i jego docstring mówi wprost: _„utrzymywane razem z resolveCrawlerTenantForHost, żeby
predykat bezpieczeństwa był jeden"_ -

- nieznany host przy **zasiedlonym** katalogu domen → 404 (nie wolno reklamować treści domyślnego
  tenanta na cudzej domenie),
- host podglądu/lokalny albo **pusty** katalog domen → nie ma czego wyciekać, więc kanał podaje
  poprawny, PUSTY feed.

`/rss.xml` miał oba człony; dwa nowsze kanały - tylko pierwszy. Stąd rozjazd `e2e` (bez seeda:
katalog pusty → `/rss.xml` 200, tracker/live 404) vs `e2e-seeded` (katalog zasiedlony → wszystko
200). Test kodował intencję poprawnie („404 jest akceptowalny tylko gdy redakcja wyłączyła RSS").

Przegląd wszystkich powierzchni crawlerowych wykazał **trzecią** z tym samym brakiem:
`news-sitemap.xml`, którego własny komentarz obiecywał tolerancję hosta podglądu („and that is not
a preview host"), ale kod jej nie implementował. Naprawione wszystkie trzy; fail-closed dla realnych
obcych domen nietknięty. Pozostałe powierzchnie (`robots.txt` - celowo „disallow all", strony
treści per-slug, kanały podcastów) zostawiam bez zmian: żaden kontrakt nie wymaga tam degradacji,
a zmiana zachowania izolacji tenantów bez testu, który by to walidował, to droga do regresji.

Weryfikacja end-to-end na zbudowanym workerze, przy hoście podglądu (dokładnie warunek awarii
`e2e`):

| Ścieżka             | Przed               | Po                     |
| ------------------- | ------------------- | ---------------------- |
| `/rss.xml`          | 200 `<rss`          | 200 `<rss` (bez zmian) |
| `/tracker/rss.xml`  | **404**             | **200 `<rss`**         |
| `/live/rss.xml`     | **404**             | **200 `<rss`**         |
| `/news-sitemap.xml` | **404** (latentnie) | **200 `<urlset`**      |

### Zaległość lintu (blokujący krok CI, dotąd nieosiągalny)

`bun run lint` (`eslint .`) jest krokiem **blokującym**, ale `verify` nigdy do niego nie dochodził -
padał na kroku 7. Pod spodem czekało 86 auto-naprawialnych błędów `prettier/prettier` w 13 cudzych
plikach. Naprawione `eslint --fix`; diff jest w 100% formatujący (przełamania atrybutów JSX,
usunięcie pustych linii - sprawdzone `git diff -w`). `eslint .` zwraca teraz **0 błędów**
(134 ostrzeżenia nie wpływają na kod wyjścia).

`prettier --check .` zgłasza jeszcze 24 pliki, ale to **nie jest krok CI** - wśród nich generowany
`src/integrations/supabase/types.ts`, którego formatowanie odpłynęłoby przy następnej regeneracji.
Świadomie nietknięte.

### Walidacja migracji na prawdziwym PostgreSQL 16

Skoro CI nie dochodziło do tej migracji, walidacja poszła lokalnie: PostgreSQL 16.13, wierny
szkielet (`auth.users`, `tenants`, `profiles`, `auth.uid()` sterowane GUC,
`current_tenant_id()`, role `anon`/`authenticated`/`service_role`), na nim **oryginalne** migracje
rejestru (`20260717095322`, `20260802155237`), a dopiero na nich `20260803140001`.

| Sprawdzenie                                                              | Wynik |
| ------------------------------------------------------------------------ | ----- |
| migracja stosuje się bez błędu                                           | ✓     |
| drugi przebieg też przechodzi (idempotencja)                             | ✓     |
| nowa sygnatura 8-arg, argumenty NAZWANE, `p_gpc => true`                 | ✓     |
| dokładnie DWA przeciążenia, `p_gpc` BEZ defaultu (4 defaulty na 8 argów) | ✓     |
| stary shim 7-arg deleguje z `gpc = false` (bez rekurencji)               | ✓     |
| `gpc`, `source` i `tenant_id` lądują w audit-logu                        | ✓     |
| wycofanie `gpc_signal` ustawia `withdrawn_at`                            | ✓     |
| stempel tenanta NIE jest przepisywany decyzją w innym obszarze           | ✓     |
| brak sesji → `not_authenticated` (fail-closed)                           | ✓     |
| `authenticated` ma na rejestrze **wyłącznie** `SELECT`                   | ✓     |
| zostały **tylko** polityki `SELECT`                                      | ✓     |
| bezpośredni `INSERT` do stanu → `permission denied for table`            | ✓     |
| podrobienie wpisu audit-logu → `permission denied for table`             | ✓     |
| podstawienie OBCEGO `tenant_id` → `permission denied for table`          | ✓     |
| `DELETE` własnej zgody (obejście audytu) → `permission denied for table` | ✓     |
| RPC nadal działa dla tego samego użytkownika                             | ✓     |

To domyka jedyną lukę w weryfikacji: cztery wektory podrabiania rejestru z sekcji 4 migracji są
teraz sprawdzone wykonaniem, nie tylko rozumowaniem.

### Rozwiązanie konfliktu scalania

PR zapalił „Unable to merge". Jedynym konfliktem był `src/routeTree.gen.ts` - plik GENEROWANY,
który `main` przegenerował innym narzędziem (odwrotna kolejność importów: 2593 wstawek / 2593
usunięć wobec bazy tej gałęzi). Pełna regeneracja u siebie dałaby ten sam szum w drugą stronę,
więc konflikt rozwiązany **wersją z `main` + wstawieniem samej trasy GPC** (11 kotwic na sąsiedniej
trasie `[.well-known]/oauth-protected-resource`). Diff `routeTree.gen.ts` wobec `main`: **23
wstawki, 0 usunięć.** `main` nie dotknął żadnego pliku zgód ani żadnej migracji, więc reszta
scalenia była bezkonfliktowa.

### Weryfikacja end-to-end na zbudowanym workerze

`vite preview` w tym repo jest niesprawny (szuka `dist/server/server.js` przy preseecie
`cloudflare-module`), więc handler `fetch` zbudowanego workera był wołany bezpośrednio:

| Żądanie                          | Wynik                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/gpc.json`      | `200`, `application/json; charset=utf-8`, `{"gpc":true,"lastUpdate":"2026-08-03"}`, `public, max-age=3600, s-maxage=86400, swr=604800` |
| dokument, brak sygnału           | `Vary: Sec-GPC`, zero `Set-Cookie`                                                                                                     |
| dokument, `Sec-GPC: 1`           | `Set-Cookie: nes_gpc=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure`                                                                |
| dokument, cookie bez sygnału     | `Set-Cookie: nes_gpc=; Max-Age=0` (kasowanie)                                                                                          |
| dokument, sygnał + cookie zgodne | zero `Set-Cookie` (cache-friendly)                                                                                                     |

Trafienia NES Edge Cache nie dało się wymusić bez bazy (bez niej trasy degradują do
`private, no-store`, więc nic nie wchodzi do magazynu) - dlatego kolejność middleware jest zamknięta
**bramką statyczną**, a nie tylko obserwacją.

---

## 5. Świadomie poza zakresem

- **Anonimowy rejestr sygnału.** GPC osoby niezalogowanej jest honorowane w pełni (klamra działa),
  ale nie zostawia wpisu w `user_consents` - tabela jest per-`auth.users`. Zapis anonimowy
  wymagałby nowej tabeli intake i identyfikatora urządzenia, czyli **przetwarzania większej ilości
  danych osoby, która właśnie poprosiła o mniej**. Świadoma decyzja, nie brak.
- **`personalization` jako bramka dla rekomendacji.** Klucz jest teraz klamrowany sygnałem
  i `useIsConsentGiven("personalization")` zwraca `false` pod GPC, ale wpięcie tej zgody
  w `relatedPosts` (`weight_personalization`) to osobna zmiana w silniku rekomendacji - drugi
  punkt tego samego wiersza audytu.
- **Bump `lastUpdate`.** Tylko przy realnej zmianie zakresu honorowania sygnału, nie przy każdym
  buildzie.

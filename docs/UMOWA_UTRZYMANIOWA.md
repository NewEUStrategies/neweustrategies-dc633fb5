# Umowa utrzymaniowa - specyfikacja poziomu usługi (SLA/OLA)

Załącznik techniczny do umowy utrzymaniowej platformy New European Strategies.
Opisuje **zobowiązania operacyjne mierzalne w tym repozytorium**: co jest
utrzymywane, kto za to odpowiada, w jakim czasie reaguje i czym się to sprawdza.
**TO NIE JEST DOKUMENT PRAWNY.** Warunki handlowe - wynagrodzenie, kary umowne,
waloryzacja, wypowiedzenie, poufność, przetwarzanie danych osobowych,
właściwość sądu - są **POZA ZAKRESEM** tego pliku i trafiają do właściwej umowy
podpisanej przez strony (pola `kontraktUtrzymaniowy.zamawiajacy` i `.wykonawca`
w `governance/ownership.json` to etykiety techniczne, nie oświadczenia woli).
Rejestr przywołuje ten plik jako `kontraktUtrzymaniowy.dokument`, więc jego
**brak przewraca bramkę CI** - patrz sekcja 10.

## 1. Po co ten dokument

Audyt z 2026-08-29 stwierdził, że **193 trasy administracyjne**
(`src/routes/admin*.tsx`) i **918 migracji bazy** (`supabase/migrations/*.sql`)
działają bez wskazanego właściciela technicznego, bez umowy utrzymaniowej i bez
procedury na wypadek niedostępności wykonawcy. Naprawa ma dwie części: rejestr
zakresu i specyfikację poziomu usługi. To jest ta druga część.

### 1.1 Podział ról między dokumentami

| Artefakt                             | Odpowiada na pytanie                        | Egzekwowany przez             |
| ------------------------------------ | ------------------------------------------- | ----------------------------- |
| `governance/ownership.json`          | CO jest utrzymywane i KTO jest właścicielem | `bun run check:ownership`     |
| `governance/README.md`               | JAK edytować rejestr                        | `check:ownership` (istnienie) |
| `docs/UMOWA_UTRZYMANIOWA.md` (ten)   | NA JAKIM POZIOMIE jest utrzymywane          | `check:ownership` (istnienie) |
| `docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md` | CO ZROBIĆ, gdy wykonawca zniknie            | `check:ownership` (istnienie) |
| `docs/RUNBOOK_COMMUNITY.md`          | JAK diagnozować doręczenia i harmonogram    | -                             |

**Rejestr `governance/ownership.json` jest JEDYNYM źródłem prawdy o zakresie.**
Ten dokument nie powiela listy tras ani migracji - powielona lista
zdezaktualizowałaby się przy pierwszej nowej trasie
(`src/lib/ci/ownership.ts:20-24`). Liczby w sekcji 3 to zrzut z
`bun run check:ownership` z 2026-08-29; wiążący jest przebieg bramki.

### 1.2 Czego ten dokument NIE obejmuje

Warunków handlowych (umowa główna); przetwarzania danych osobowych - odrębna
umowa powierzenia, bo domena `zgodnosc-i-prywatnosc` opisuje POWIERZCHNIĘ
techniczną, nie podstawę prawną; odzyskania dostępów do kont zewnętrznych
(`docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md`, sekcja 11); rozwoju nowych funkcji
(sekcja 6.2).

## 2. Strony i role

### 2.1 Strony

| Strona      | Podmiot                           | Kontakt zmierzony w repo                                                   |
| ----------- | --------------------------------- | -------------------------------------------------------------------------- |
| Zamawiający | New European Strategies           | `office@neweuropeanstrategies.com` (autor commitów, `git shortlog`)        |
| Zamawiający | kontakt redakcyjny / marketingowy | `marketing@neweuropeanstrategies.com` (`.env.example:90`, `VAPID_SUBJECT`) |
| Wykonawca   | **DO UZUPEŁNIENIA**               | **DO UZUPEŁNIENIA**                                                        |

W repozytorium **NIE MA ANI JEDNEGO indywidualnego uchwytu GitHub ani osobowego
adresu e-mail** - powyższe dwa adresy to jedyne, jakie da się wskazać z
materiału dowodowego. Wszystkie osoby fizyczne są tu **DO UZUPEŁNIENIA**
(sekcja 12).

### 2.2 Role techniczne

| Rola                         | Klucz w rejestrze       | Zakres odpowiedzialności                                                                                                                                            |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Właściciel techniczny domeny | `domeny[].wlasciciel`   | Przyjmuje zgłoszenia domeny, decyduje o obejściu i naprawie, zatwierdza PR-y domeny                                                                                 |
| Zastępca                     | `domeny[].zastepca`     | Przejmuje przy nieobecności właściciela. **Nie może być tą samą osobą** - bramka odrzuca `właściciel = zastępca` jako zerowy bus factor (`src/lib/ci/ownership.ts`) |
| Eskalacja                    | `domeny[].eskalacja`    | `organizacja-nes` - Zamawiający; wchodzi przy przekroczeniu czasu naprawy albo sporze o priorytet                                                                   |
| Zespół GitHub                | `domeny[].zespolGithub` | `@NewEUStrategies/utrzymanie-<slug>` - adresat CODEOWNERS, dziś **nieistniejący**                                                                                   |

### 2.3 STAN NA DZIŚ: 9 Z 9 DOMEN BEZ WŁAŚCICIELA

`bun run check:ownership` (2026-08-29) ostrzega: „9 z 9 domen nadal bez
obsadzonego właściciela technicznego (w progu, więc bramka przechodzi)". Każda
wskazuje na `wt-nieobsadzony` / `zastepca-nieobsadzony` (`obsadzone: false`,
`kontakt: null`). **TO JEST PIERWSZY PUNKT DO ZAMKNIĘCIA i warunek, żeby czasy
z sekcji 4 znaczyły cokolwiek** - dziś ten dokument opisuje poziom usługi,
którego nikt nie jest zobowiązany świadczyć.

Próg `progi.domenyBezWlasciciela = 9` jest **zapadką**: wolno go WYŁĄCZNIE
obniżać, a spada przy każdym realnym obsadzeniu roli. Generator
`bun run generate:codeowners` celowo wypisuje reguły **ZAKOMENTOWANE**, dopóki
właściciele nie są obsadzeni - `CODEOWNERS` wskazujący na nieistniejący zespół
GitHub jest gorszy niż jego brak, bo wygląda jak działający mechanizm.

## 3. Przedmiot utrzymania - 9 domen

Zrzut z `bun run check:ownership`, 2026-08-29: **193** trasy, **918** migracji.
Nakładki rozstrzyga pierwsza pasująca domena w rejestrze (dziś 2 takie trasy).

| #   | Domena                    | Zakres (skrót z rejestru)                                                                                | Trasy | Migracje | SLA     |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------- | ----: | -------: | ------- |
| 1   | `spolecznosc-i-kluby`     | Kluby dyskusyjne, czat, wiadomości prywatne, sieć kontaktów, ankiety, Q&A, odznaki, moderacja komentarzy |    17 |      229 | `sla-1` |
| 2   | `wydarzenia`              | Katalog wydarzeń, studio wydarzenia, rejestracje, bilety, obsługa na miejscu, live blog                  |    51 |      128 | `sla-1` |
| 3   | `monetyzacja-i-platnosci` | Paywall, cenniki, warstwy członkostwa, kupony, prezenty, reklamy, Stripe, rekoncyliacja, audyt księgowy  |    19 |      107 | `sla-1` |
| 4   | `crm-i-marketing`         | Kontakty, firmy, lejek, automatyzacje, integracje wychodzące, newsletter, popupy, SEO, analityka         |    35 |       84 | `sla-2` |
| 5   | `kariera-i-programy`      | Ogłoszenia i zgłoszenia rekrutacyjne, CV, wnioski ekspertów, programy badawcze                           |     5 |       13 | `sla-3` |
| 6   | `tresc-i-edytory`         | Wpisy, strony, media, taksonomie, oba silniki edycji (bloki i builder), warstwa wyglądu i motywu         |    40 |      240 | `sla-1` |
| 7   | `zgodnosc-i-prywatnosc`   | Zgody, banner cookie, dokumenty prawne, retencja i usuwanie danych, dziennik audytowy, wypisy            |     2 |        8 | `sla-1` |
| 8   | `tozsamosc-i-uprawnienia` | Konta, role, macierz uprawnień, zaproszenia, weryfikacja domen, izolacja tenanta, ustawienia instancji   |    20 |       40 | `sla-1` |
| 9   | `platforma-i-baza`        | Powłoka panelu, harmonogram zadań, kolejki i powiadomienia, storage, wyszukiwarka, i18n, telemetria      |     4 |       69 | `sla-1` |

**Jakość atrybucji (jawna, nie ukryta za zieloną bramką):** 893 migracje po
identyfikatorach SQL, 3 po literałach, 17 po identyfikatorach przekrojowych,
**5 bez trafienia** (wymienione z nazwy w `migracjeBezAtrybucjiDozwolone`, 0,5% korpusu) i **221
atrybucji słabych** (rozstrzygniętych jednym identyfikatorem). Bramka
gwarantuje POKRYCIE, nie TRAFNOŚĆ - przegląd tych 221 wpisów należy do
pierwszego przeglądu kwartalnego (sekcja 9).

## 4. Klasy zgłoszeń

### 4.1 Definicje wpływu - przykłady Z TEGO systemu

| Klasa  | Definicja wpływu                                                                                         | Przykłady zmierzone w tym repozytorium                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | Utrata przychodu, utrata danych, niedostępność produkcji albo naruszenie granicy tenanta. Brak obejścia. | Checkout / płatności nie działają (`src/lib/stripe.server.ts:14` - gateway Stripe); panel `/admin` zwraca 5xx albo nie da się zalogować; wyciek danych między tenantami (klasa błędu, którą pilnuje `check:sql-tenant-scope`, `ci.yml:131`); baza produkcyjna niedostępna                                                                                                                                   |
| **P2** | Kluczowa funkcja nie działa, obejście istnieje lub jest kosztowne.                                       | Newsletter nie wychodzi - `LOVABLE_API_KEY`/`RESEND_API_KEY` nieważne, cała poczta spada na dostawcę zapasowego bez identyfikatora wiadomości (`.env.example:45-51`); `GET /api/public/community-cron` zwraca **503** (zastój harmonogramu, `docs/RUNBOOK_COMMUNITY.md:40`); kolejka `notification_push_queue` rośnie w `pending`; nocna sonda rozliczeń czerwona (`.github/workflows/billing-nightly.yml`) |
| **P3** | Funkcja działa błędnie na wąskiej powierzchni, obejście proste.                                          | Pojedynczy ekran admina rzuca błąd; wskaźnik otwarć newslettera > 100% przy dwóch źródłach zaangażowania naraz (`.env.example:67-79`, `NEWSLETTER_ENGAGEMENT_SOURCE`); brak `RESEND_WEBHOOK_SECRET` - lista wykluczeń nie rośnie (`.env.example:57-64`)                                                                                                                                                     |
| **P4** | Kosmetyka, dług techniczny, pytanie, wniosek o dane.                                                     | Literówka w tłumaczeniu; przegląd 221 słabych atrybucji migracji; uzupełnienie `.env.example` o 14 nieudokumentowanych zmiennych produkcyjnych                                                                                                                                                                                                                                                              |

### 4.2 Klasy SLA z rejestru (`kontraktUtrzymaniowy.klasySla`)

| Klasa   | Nazwa       | Reakcja | Obejście | Naprawa | Okno serwisowe   |
| ------- | ----------- | ------- | -------- | ------- | ---------------- |
| `sla-1` | Krytyczna   | 60 min  | 4 h      | 24 h    | 24/7             |
| `sla-2` | Wysoka      | 240 min | 24 h     | 72 h    | dni robocze 9-17 |
| `sla-3` | Standardowa | 480 min | 72 h     | 240 h   | dni robocze 9-17 |

Liczniki: **reakcja** = potwierdzenie przyjęcia i wskazanie osoby prowadzącej;
**obejście** = przywrócenie funkcji dowolną drogą (feature flag, rollback,
ręczny tick z panelu); **naprawa** = trwałe usunięcie przyczyny z zielonym CI na
`main`. `sla-2`/`sla-3` liczą się wyłącznie w oknie roboczym, `sla-1` stale.

### 4.3 Jak klasa domeny mapuje się na priorytet zgłoszenia

**KOLEJNOŚĆ KROKÓW JEST CZĘŚCIĄ USTALENIA - nie wolno jej odwracać.**

1. **Ustal domenę** po pliku trasy (`src/routes/admin*.tsx`) albo migracji
   (`supabase/migrations/*.sql`). Przy sporze rozstrzyga wydruk bramki.
2. **Ustal wpływ** P1-P4 z tabeli 4.1 - wpływ opisuje zgłoszenie, nie domenę.
3. **Odczytaj czasy** z tabeli 4.4 dla pary (klasa domeny, wpływ).

| Wpływ  | Domena `sla-1`                    | Domena `sla-2`                    | Domena `sla-3`                    |
| ------ | --------------------------------- | --------------------------------- | --------------------------------- |
| **P1** | 60 min / 4 h / 24 h, **24/7**     | 60 min / 4 h / 24 h, **24/7**     | 60 min / 4 h / 24 h, **24/7**     |
| **P2** | 60 min / 4 h / 24 h, 24/7         | 240 min / 24 h / 72 h, 9-17       | 480 min / 72 h / 240 h, 9-17      |
| **P3** | 240 min / 24 h / 72 h, 9-17       | 480 min / 72 h / 240 h, 9-17      | 480 min / 72 h / 240 h, 9-17      |
| **P4** | bez licznika - przegląd kwartalny | bez licznika - przegląd kwartalny | bez licznika - przegląd kwartalny |

W jednym zdaniu: **P1 PODNOSI KAŻDĄ DOMENĘ DO `sla-1` I DO OKNA 24/7** (utrata
przychodu i niedostępność panelu nie mają domeny „mniej ważnej"), P2 bierze
czasy klasy domeny, P3 obniża klasę o stopień, P4 nie ma licznika. Zgłoszenie
dotykające kilku domen dostaje **najostrzejszą** parę; awarie harmonogramu,
kolejek i storage należą do `platforma-i-baza` (`sla-1`), nawet gdy objaw widać
w domenie `sla-3`.

## 5. Kanały zgłoszeń i dyżur

### 5.1 Co realnie istnieje DZIŚ

| Kanał                                                      | Stan             | Dowód                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Issues w `NewEUStrategies/neweustrategies-dc633fb5` | działa           | repozytorium organizacji; **bez szablonu zgłoszenia** - `.github/` zawiera wyłącznie 5 plików workflow                                                                           |
| `office@neweuropeanstrategies.com`                         | działa           | `git shortlog` - autor commitów                                                                                                                                                  |
| `marketing@neweuropeanstrategies.com`                      | działa           | `.env.example:90` (`VAPID_SUBJECT`)                                                                                                                                              |
| `GET /api/public/community-cron`                           | działa           | `docs/RUNBOOK_COMMUNITY.md:40` - `200` = OK, **`503` = zastój**; nagłówek `x-community-cron-secret`                                                                              |
| Panel `/admin/community/notifications`                     | działa           | RPC `job_scheduler_health()`, `docs/RUNBOOK_COMMUNITY.md:107-114` - świeżość, stan ścieżek, głębokość kolejki push, brakujące env                                                |
| `.github/workflows/billing-nightly.yml`                    | działa           | nocna sonda odnowienia/dunningu; wyłącznik jawny `vars.BILLING_PROBE_DISABLED`                                                                                                   |
| `.github/workflows/scheduler.yml`                          | działa warunkowo | siatka bezpieczeństwa co 5 min; **GitHub wyłącza zaplanowane workflow po 60 dniach bez aktywności w repo** (`scheduler.yml:25-27`) - dokładnie w scenariuszu przestoju wykonawcy |

### 5.2 Czego NIE MA i co trzeba uruchomić

| Brak                                            | Skutek                                                                                                     | Kto uruchamia                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Odbiorca sondy `GET /api/public/community-cron` | Sonda zwraca `503`, ale **nikt tego nie czyta** - zastój harmonogramu jest niewidoczny                     | Zamawiający + Wykonawca       |
| Zewnętrzne raportowanie błędów                  | Zero trafień `@sentry` / `sentry.io`; raportowanie własne (`src/lib/observability/report.ts`) bez adresata | Wykonawca                     |
| Dedykowany adres/kolejka zgłoszeń               | Zgłoszenia trafiają na adresy ogólne organizacji                                                           | Zamawiający                   |
| Szablon zgłoszenia i `CODEOWNERS`               | Zgłoszenie nie ma pola „domena", PR nie ma automatycznego recenzenta                                       | Wykonawca (po obsadzeniu ról) |
| Zdefiniowany dyżur poza godzinami pracy         | Okno `24/7` klasy `sla-1` **nie jest dziś przez nikogo obsadzone**                                         | Zamawiający + Wykonawca       |

**NIE USTALA SIĘ TU ŻADNEGO NUMERU TELEFONU ANI KANAŁU GŁOSOWEGO** - w repo nie
ma po temu żadnej podstawy. Kanał alarmowy dla P1 jest polem
**DO UZUPEŁNIENIA** w sekcji 12.

### 5.3 Zasada zgłoszenia

Zgłoszenie zawiera domenę z rejestru, klasę wpływu wg 4.1, ścieżkę pliku lub
endpoint, znacznik czasu i - o ile dotyczy - wydruk `job_scheduler_health()`
albo odpowiedź sondy (gotowe polecenie: `docs/RUNBOOK_COMMUNITY.md:147-148`).
Zgłoszenie bez domeny jest przyjmowane, ale licznik reakcji rusza po jej
ustaleniu przez Wykonawcę (maks. 60 min).

## 6. Zakres prac utrzymaniowych

### 6.1 W ramach utrzymania

1. **Naprawa błędów** w powierzchni objętej rejestrem (193 trasy, 918 migracji).
2. **Aktualizacje bezpieczeństwa** zależności i reakcja na CVE - sekcja 7.
3. **Utrzymanie zielonego CI na `main`** - definicja mierzalna w 6.3.
4. **Migracje bazy** przy zachowaniu odtwarzalności
   (`check:sql-migration-replay`) i rejestru `supabase/migration-ledger.json`
   (9 wpisów `reconciled`, baseline `20260825230232`).
5. **Odtwarzanie po awarii** wg sekcji 8 - po ustanowieniu procedury, której NIE MA.
6. **Utrzymanie rejestru własnicielstwa** - każda nowa trasa i migracja dostaje
   domenę w tym samym PR-ze, w którym powstaje.

### 6.2 POZA utrzymaniem (osobne zlecenie)

Nowe funkcje i moduły; przeprojektowania; migracja z platformy Lovable (wymiana
gatewaya poczty/Stripe/AI, przepięcie `bun.lock`, napisanie od zera pipeline'u
wdrożenia - w repo jest **0 kroków wdrożenia**); zmiana projektu Supabase (ref
`unnltowbgszpdzwpawdu` zahardkodowany w kodzie i danych migracji, m.in.
`src/lib/seo/rootHead.ts:30`); nowe integracje; szkolenia.

### 6.3 Mierzalna definicja „sprawnego repozytorium"

Sprawne = **wszystkie poniższe komendy kończą się kodem 0 na gałęzi `main`** -
definicja wykonywalna, nie opisowa.

| Komenda                               | `package.json` | Co gwarantuje                                                                                        |
| ------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `bun run verify:static`               | l. 21          | Wszystkie bramki `check:*` z `package.json` - lista wyprowadzana z manifestu, więc nie rozjeżdża się |
| `bun run verify:blocking`             | l. 22          | `verify:static` + `typecheck` + `lint` + `test`                                                      |
| `bun run check:gate-coverage`         | l. 53          | Każda bramka `check:*` JEST wpięta w workflow i nie jedzie dwa razy (`ci.yml:106`)                   |
| `bun run check:sql-migration-replay`  | l. 48          | `supabase db start` na świeżej bazie dobiegnie do końca przez wszystkie 918 migracji (`ci.yml:123`)  |
| `bun run check:ownership`             | l. 54          | 100% pokrycia tras i migracji rejestrem; dokumenty utrzymaniowe istnieją; umowa nie wygasła          |
| `bun run check:workflow-env-contract` | l. 47          | Każda zmienna eksportowana w `env:` workflow ma odbiorcę w kodzie                                    |

`check:gate-coverage` jest **bramką meta**: gdy `check:ownership` nie jest
wpięty w `.github/workflows/ci.yml`, świeci na czerwono i wypisuje jego nazwę.
Repo ma udokumentowaną historię bramek istniejących i nieuruchamianych
(`ci.yml:95-104`) oraz zielonych przebiegów bez ani jednego żądania - nocna
sonda rozliczeń eksportowała inną nazwę sekretu, niż czytała, i spała 40 minut
na zielono (`billing-nightly.yml:9-29`). **ZIELONA BRAMKA, KTÓREJ NIKT NIE
URUCHAMIA, JEST DOKUMENTACJĄ INTENCJI, NIE BRAMKĄ.**

## 7. Utrzymanie zależności i bezpieczeństwo

### 7.1 Blokada supply-chain (24 h)

`bunfig.toml:3` ustawia `minimumReleaseAge = 86400`: instalacja pomija wersje
opublikowane mniej niż dobę temu. `bunfig.toml:6` zwalnia z tej blokady **dwa
pakiety zewnętrznego dostawcy platformy** - `@lovable.dev/vite-tanstack-config`
i `@lovable.dev/mcp-js` - a pierwszy z nich definiuje CAŁĄ konfigurację
Vite/TanStack Start/Nitro (`vite.config.ts:10`).

**Zobowiązanie Wykonawcy:** przy każdym przeglądzie kwartalnym (sekcja 9)
przegląd listy `minimumReleaseAgeExcludes` i pisemne potwierdzenie, że wyjątek
nadal jest świadomie akceptowany. `bunfig.toml:4-5` wymaga potwierdzenia przed
dodaniem KAŻDEGO nowego wpisu - **dodanie pozycji do tej listy bez zgody
Zamawiającego jest naruszeniem tego załącznika.**

### 7.2 BRAK DEPENDABOTA

`.github/` zawiera wyłącznie 5 plików workflow. **NIE MA `dependabot.yml`, NIE
MA `CODEOWNERS`, NIE MA szablonu PR** - nie działa żaden automatyczny mechanizm
zgłaszania podatności ani aktualizacji zależności. Do czasu uruchomienia
automatu obowiązuje przegląd ręczny raz na kwartał (`bun outdated` + zalecenia
bezpieczeństwa GitHub, decyzja w raporcie). Uruchomienie `dependabot.yml` jest
pozycją **DO UZUPEŁNIENIA** - Wykonawca, po obsadzeniu ról.

### 7.3 Reguła rotacji sekretów

Do przejęcia i rotacji jest **7 unikalnych nazw sekretów** i **4 zmienne**
GitHub Actions. Część sekretów produkcyjnych **nie jest ani w env, ani w
GitHubie, tylko w Supabase Vault** (18 wywołań `vault.create_secret`) - utrata
dostępu do projektu Supabase to utrata tych sekretów bez kopii gdziekolwiek
indziej. Lista: `docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md`.

## 8. Ciągłość danych: RPO i RTO

### 8.1 RYZYKO OTWARTE - W REPOZYTORIUM NIE MA ŻADNEJ PROCEDURY BACKUPU

Zmierzone grepem po całym repozytorium (bez `node_modules` i `.git`): `pg_dump`

- **0 trafień**, `pg_restore` - **0**, `supabase db dump` - **0**,
  `supabase link` - **0**. W 124 plikach `docs/` słowo „backup" pada raz
  (`ARCHITECTURE.md:778`) - jako nazwa tabeli `suppressed_emails_legacy_backup`,
  **nie jako procedura**.

**JEDYNE KOPIE, JAKIE ISTNIEJĄ, TO SNAPSHOTY/PITR PO STRONIE DOSTAWCY BAZY:
poza repozytorium, poza kontrolą Zamawiającego, NIEPOTWIERDZONE i BEZ ANI
JEDNEGO TESTU ODTWORZENIA.** Nie ma w repo nawet sprawdzenia, czy backup jest
w ogóle włączony.

### 8.2 Co repozytorium odtwarza, a czego nie

| Odtwarza                                                                              | NIE odtwarza                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **SCHEMAT** - `supabase db start` przez wszystkie **918 migracji** (`ci.yml:526-527`) | Dane produkcyjne: treści, użytkownicy, zamówienia, CRM, darowizny                                                            |
| Dane deweloperskie z `supabase/seed.sql` (440 linii)                                  | Zawartość 7 bucketów Storage (`media`, `cv`, `career-cv`, `chat-attachments`, `club-media`, `member-resources`, `tts-cache`) |
| 99 plików testów pgTAP (`supabase test db`)                                           | Sekrety z Supabase Vault (18 × `vault.create_secret`)                                                                        |

`ci.yml:120` dodaje: przy spłaszczonej historii commitów (275 commitów w 3 dniach
kalendarzowych) rejestr migracji jest **jedynym narzędziem datowania regresji**.

### 8.3 Zobowiązanie do ustanowienia - PROPOZYCJA DO ZATWIERDZENIA

Poniższe wartości są **PROPOZYCJĄ**, nie pomiarem - dziś nie ma czego zmierzyć.
Zatwierdza Zamawiający; zatwierdzone trafiają do sekcji 12 i do procedury w
`docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md`.

| Parametr                      | Propozycja                                                                                  | Weryfikowalny przez                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Zrzut logiczny bazy           | codziennie, `pg_dump --format=custom` całego schematu `public` + `auth`                     | plik zrzutu z datą w magazynie Zamawiającego                       |
| Zrzut Storage                 | codziennie, wszystkie 7 bucketów                                                            | manifest z liczbą obiektów i sumą rozmiarów                        |
| Eksport sekretów Vault        | przy każdej zmianie, do sejfu haseł Zamawiającego                                           | data ostatniego eksportu                                           |
| Miejsce przechowywania        | **zasób należący do ZAMAWIAJĄCEGO**, poza kontem Wykonawcy i poza kontem dostawcy bazy      | dostęp Zamawiającego niezależny od Wykonawcy                       |
| Retencja                      | 30 zrzutów dziennych + 12 miesięcznych                                                      | listing magazynu                                                   |
| **Test odtworzenia**          | **OBOWIĄZKOWO raz na kwartał**: odtworzenie zrzutu na czystą instancję + `supabase test db` | wpis w raporcie kwartalnym: data, czas trwania, wynik, kto wykonał |
| **RPO** (dopuszczalna utrata) | 24 h dla bazy, 24 h dla Storage                                                             | odstęp między zrzutami                                             |
| **RTO** (czas przywrócenia)   | 8 h dla P1, liczone od decyzji o odtworzeniu                                                | zmierzony czas testu kwartalnego                                   |

**BACKUP, KTÓRY NIGDY NIE ZOSTAŁ ODTWORZONY, NIE JEST BACKUPEM.** Test bez
zapisanego wyniku (data, czas, wynik, wykonawca) liczy się jako niewykonany;
wynik jest obowiązkowym załącznikiem raportu z sekcji 9. Do dnia ustanowienia
tej procedury **RPO i RTO platformy są NIEZNANE**, a punkt pozostaje otwartym
ryzykiem po stronie Zamawiającego.

## 9. Raportowanie i przegląd

Przegląd **raz na kwartał**: prowadzi Wykonawca, uczestniczy eskalacja
(`organizacja-nes`), raport pisemny na 5 dni roboczych przed spotkaniem.

| Pozycja raportu                                                                          | Źródło liczby                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Liczba zgłoszeń w kwartale w podziale na P1-P4 i domeny                                  | rejestr zgłoszeń Wykonawcy                         |
| Dotrzymanie czasów: reakcja / obejście / naprawa, % i przekroczenia                      | rejestr zgłoszeń + tabela 4.4                      |
| Liczba tras i migracji objętych rejestrem                                                | `bun run check:ownership` (dziś 193 / 918)         |
| Rozkład tras i migracji per domena                                                       | `bun run check:ownership`                          |
| **Liczba domen bez obsadzonego właściciela**                                             | `bun run check:ownership` (dziś **9 z 9**)         |
| Stan progów: `domenyBezWlasciciela`, `migracjeBezAtrybucjiDozwolone`, `martweWzorceTras` | `bun run check:ownership` (dziś 9 / 5 pozycji / 0) |
| Jakość atrybucji: migracje bez trafienia, atrybucje słabe                                | `bun run check:ownership` (dziś 5 / 221)           |
| Wynik kwartalnego testu odtworzenia backupu                                              | sekcja 8.3 - **obowiązkowy**                       |
| Przegląd `minimumReleaseAgeExcludes`                                                     | `bunfig.toml:6`                                    |
| Liczba dni do wygaśnięcia umowy                                                          | `bun run check:ownership` (sekcja 10)              |

**Wydruk `bun run check:ownership` drukuje większość tych liczb i jest
obowiązkowym ZAŁĄCZNIKIEM raportu** - załącznikiem, nie przepisaniem: liczba
przepisana ręcznie przestaje być pomiarem. Progi wolno WYŁĄCZNIE obniżać;
podniesienie wymaga pisemnej decyzji Zamawiającego, przywołanej w raporcie.

## 10. Zmiana i wygaśnięcie

| Pole w `governance/ownership.json`    | Wartość      | Znaczenie                         |
| ------------------------------------- | ------------ | --------------------------------- |
| `kontraktUtrzymaniowy.obowiazujeOd`   | `2026-08-29` | początek obowiązywania            |
| `kontraktUtrzymaniowy.obowiazujeDo`   | `2027-08-31` | **koniec - EGZEKWOWANY PRZEZ CI** |
| `kontraktUtrzymaniowy.ostrzegajOdDni` | `60`         | ostrzeżenie od **2027-07-02**     |

Bramka `check:ownership` porównuje datę bieżącą z `obowiazujeDo`: przy 0-60
dniach do końca wypisuje ostrzeżenie NIEBLOKUJĄCE („Umowa utrzymaniowa wygasa
za N dni - uruchom przedłużenie"), a po terminie **ŚWIECI NA CZERWONO** i CI
stoi, dopóki umowa nie zostanie przedłużona: „UMOWA UTRZYMANIOWA WYGASŁA N dni
temu. (…) To jest cel tego pola: umowa, o której nikt nie pamięta, nie jest
umową utrzymaniową."

**TO JEST CELOWE.** Ten sam mechanizm blokuje CI przy braku któregokolwiek z
trzech dokumentów (`docs/UMOWA_UTRZYMANIOWA.md`,
`docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md`, `governance/README.md`).

**Przedłużenie:** zmiana JEDNEGO pola `kontraktUtrzymaniowy.obowiazujeDo` +
commit. Zmiana daty **bez** podpisanego aneksu do umowy głównej jest obejściem
bramki, nie przedłużeniem umowy - decyduje Zamawiający, nie osoba edytująca
plik. Zmiana klas SLA, progów albo składu domen: PR na rejestrze, recenzja
eskalacji (`organizacja-nes`), odnotowanie w raporcie kwartalnym.

## 11. Wyjście i przekazanie

**NIE POWIELAMY TU PLANU WYJŚCIA.** Procedura na wypadek niedostępności
wykonawcy, lista kont do odzyskania, sekrety Actions i Vaulta, zależności od
platformy budującej oraz kolejność kroków przejęcia są w
`docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md` (`kontraktUtrzymaniowy.runbookCiaglosci`).

Z tego dokumentu wynikają trzy zobowiązania: (1) Wykonawca utrzymuje runbook
ciągłości **aktualny** - każda zmiana dostawcy, sekretu albo ścieżki wdrożenia
trafia tam w tym samym PR-ze; (2) nie wprowadza nowej zależności zewnętrznej
bez dopisania jej do runbooka i zgody Zamawiającego; (3) na koniec
obowiązywania umowy przeprowadza przekazanie wg runbooka i **przekazuje komplet
dostępów ZAMAWIAJĄCEMU**, nie następcy.

## 12. DO UZUPEŁNIENIA przez Zamawiającego

Poniższe pola są puste, bo **W REPOZYTORIUM NIE MA PO NIE ŻADNEJ PODSTAWY
DOWODOWEJ** - nie ma ani jednego indywidualnego uchwytu GitHub ani osobowego
adresu e-mail, a dane wymyślone byłyby fikcją. Uzupełnia **Zamawiający**, po
czym przenosi je do `governance/ownership.json` (`osoby`) i obniża próg
`progi.domenyBezWlasciciela`.

| #   | Pole                                                       | Wartość | Kto uzupełnia | Konsekwencja braku                                     |
| --- | ---------------------------------------------------------- | ------- | ------------- | ------------------------------------------------------ |
| 1   | Nazwa Wykonawcy (`kontraktUtrzymaniowy.wykonawca`)         |         | Zamawiający   | Dziś `NIEOBSADZONE` - nikt nie jest zobowiązany do SLA |
| 2   | Adres i NIP/KRS Wykonawcy                                  |         | Zamawiający   | Brak strony umowy                                      |
| 3   | Właściciel techniczny - `wydarzenia` (51 tras / 128 migr.) |         | Zamawiający   | Największa powierzchnia tras bez właściciela           |
| 4   | Właściciel techniczny - `tresc-i-edytory` (40/240)         |         | Zamawiający   | Największa powierzchnia migracji bez właściciela       |
| 5   | Właściciel techniczny - `spolecznosc-i-kluby` (17/229)     |         | Zamawiający   | 229 migracji bez właściciela                           |
| 6   | Właściciel techniczny - `monetyzacja-i-platnosci` (19/107) |         | Zamawiający   | Ścieżka przychodowa bez właściciela                    |
| 7   | Właściciel techniczny - `tozsamosc-i-uprawnienia` (20/40)  |         | Zamawiający   | Uprawnienia i izolacja tenanta bez właściciela         |
| 8   | Właściciel techniczny - `crm-i-marketing` (35/84)          |         | Zamawiający   | Poczta i newsletter bez właściciela                    |
| 9   | Właściciel techniczny - `platforma-i-baza` (4/69)          |         | Zamawiający   | Harmonogram i kolejki bez właściciela                  |
| 10  | Właściciel techniczny - `zgodnosc-i-prywatnosc` (2/8)      |         | Zamawiający   | Powierzchnia RODO bez właściciela                      |
| 11  | Właściciel techniczny - `kariera-i-programy` (5/13)        |         | Zamawiający   | 5 tras bez właściciela                                 |
| 12  | Zastępca dla każdej z 9 domen (9 pozycji)                  |         | Zamawiający   | Bramka odrzuca `właściciel = zastępca`                 |
| 13  | Uchwyty GitHub właścicieli i zastępców                     |         | Zamawiający   | `CODEOWNERS` pozostaje zakomentowany                   |
| 14  | Zespoły GitHub `@NewEUStrategies/utrzymanie-<slug>` (9)    |         | Zamawiający   | Zespoły dziś nie istnieją                              |
| 15  | Kanał zgłoszeń podstawowy (adres / kolejka)                |         | Zamawiający   | Zgłoszenia trafiają na adresy ogólne                   |
| 16  | Kanał alarmowy dla P1 (poza godzinami) + godziny dyżuru    |         | Zamawiający   | Okno `24/7` klasy `sla-1` nieobsadzone                 |
| 17  | Odbiorca alertu z sondy `GET /api/public/community-cron`   |         | Zamawiający   | `503` nikogo nie budzi                                 |
| 18  | Magazyn backupu po stronie Zamawiającego (sekcja 8.3)      |         | Zamawiający   | **RPO/RTO pozostają NIEZNANE**                         |
| 19  | Zatwierdzone wartości RPO i RTO + data pierwszego testu    |         | Zamawiający   | Backup nigdy nieodtworzony                             |

Po każdym uzupełnieniu uruchom `bun run check:ownership` i dołącz wydruk do
najbliższego raportu kwartalnego - liczba domen bez właściciela POWINNA SPAŚĆ.

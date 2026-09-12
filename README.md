# New European Strategies

**Strategiczne myślenie, nowe perspektywy · Strategic thinking, new perspectives**

Platforma analiz, danych i doradztwa strategicznego.
A platform for analysis, data and strategic advisory.

[Wersja polska](#wersja-polska) · [English version](#english-version)

---

<a id="wersja-polska"></a>

# Wersja polska

## O New European Strategies

New European Strategies to **niezależny think-tank zajmujący się bezpieczeństwem Europy
i geopolityką**: analizy, raporty, wywiady i policy papers na temat gry mocarstw. Obok pracy
analitycznej organizacja prowadzi format zamkniętych spotkań eksperckich oraz doradztwo
strategiczne dla instytucji publicznych i sektora prywatnego w Europie Środkowo-Wschodniej.

## Czym jest ta platforma

To **własna platforma wydawnicza i operacyjna** NES - nie serwis oparty na gotowym CMS-ie.
W jednym repozytorium mieszczą się warstwy, które na rynku zwykle kupuje się jako pięć albo sześć
osobnych produktów: system zarządzania treścią z dwoma silnikami redakcyjnymi, własny page builder,
silnik wydarzeń z obsługą na miejscu, członkostwo i monetyzacja, newsletter, CRM, kluby dyskusyjne,
komunikator, wyszukiwarka, analityka oraz warstwa wielonajemcy.

Platforma jest zbudowana jako aplikacja renderowana na serwerze, działająca na brzegu sieci,
z dwujęzycznym interfejsem (polski i angielski) i pełną izolacją danych między obszarami roboczymi.

| Wymiar                                 | Stan                                   |
| -------------------------------------- | -------------------------------------- |
| Moduły domenowe                        | **22** oraz 3 powierzchnie przekrojowe |
| Udokumentowane funkcjonalności         | **146**                                |
| Pliki kodu produkcyjnego               | **3 534** (747 034 linii)              |
| Pliki testowe                          | **2 545**                              |
| Testy warstwy danych (pgTAP)           | 104 pliki, 1 973 asercje               |
| Testy ścieżek użytkownika (Playwright) | 13 plików, 108 testów                  |
| Bramki jakości w CI (`check:*`)        | **44**                                 |
| Progi pokrycia per ścieżka             | **694**                                |
| Migracje bazy danych                   | 958                                    |
| Polityki RLS w stanie końcowym         | 634 na 261 tabelach                    |

Liczniki plików, testów, migracji i polityk odzwierciedlają stan repozytorium na 2026-09-12.
Podział na moduły i funkcjonalności oraz wskaźniki pokrycia pochodzą z pomiaru audytowego
z 2026-09-05.

## Moduły

### Treść i doświadczenie czytelnika

| #   | Moduł                                | Zakres                                                                                                                                                                |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Wpisy: doświadczenie czytelnika      | paywall i metering, audio wpisu (TTS), układy wpisu, spis treści i przypisy, kluczowe wnioski, wpisy powiązane, lista lektur                                          |
| 2   | Edytor wpisów i workflow redakcyjny  | panele edytora, obieg szkic → recenzja → publikacja, rewizje i przywracanie, autozapis, obecność edytorska                                                            |
| 3   | Silniki treści: bloki + page builder | silnik bloków typu Gutenberg dla wpisów, page builder typu Elementor dla stron, panele właściwości widgetów, tokeny projektowe, sanityzacja HTML, import z WordPressa |
| 4   | Strony, wygląd, motyw, media, import | szablony stron i archiwów, motyw i kolory globalne, biblioteka mediów z przycinaniem, ikony i marka                                                                   |
| 5   | Strona główna, archiwa, chrome       | sekcje strony głównej, archiwa kategorii i tagów, nagłówek, stopka, mega menu, chrome mobilny                                                                         |
| 7   | Typy treści specjalne                | podcast jako sieć programów, tracker legislacyjny, huby ekspertów, programy badawcze, web stories, biblioteka plików, quizy i mapy                                    |
| 8   | SEO, feedy, dane strukturalne        | meta i JSON-LD, hreflang, mapy witryny, kanały RSS, udostępnianie i Open Graph, monitor linków                                                                        |

### Społeczność, komunikacja i relacje

| #   | Moduł                                     | Zakres                                                                                                                                                                        |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Wyszukiwarka                              | indeks i zapytania, nakładka wyszukiwania, filtry fasetowe, zapisane wyszukiwania                                                                                             |
| 9   | Czat / komunikator                        | rozmowy i wiadomości, kompozytor ze wzmiankami, załączniki, obecność, motywy rozmowy                                                                                          |
| 10  | Sieć / networking                         | zaproszenia, obserwowanie, katalog osób i organizacji                                                                                                                         |
| 11  | Newsletter i e-mail                       | zapis z podwójnym potwierdzeniem, kampanie i wysyłka, kreator treści maila, telemetria otwarć i klików, dostarczalność (SPF/DKIM, odbicia), popup zapisu, poczta transakcyjna |
| 12  | Realtime / powiadomienia / web-push       | kanały czasu rzeczywistego, centrum powiadomień, web-push, zgody komunikacyjne, dzienny skrót                                                                                 |
| 16  | Społeczność: kluby, komentarze, moderacja | kluby dyskusyjne z macierzą dostępu, wątki, zgłoszenia członkowskie, odznaki, ankiety, Q&A, komentarze i kolejka moderacji                                                    |
| 18  | CRM                                       | kontakty, firmy, lejek, zadania, import i eksport CSV, behawioralny scoring leadów                                                                                            |

### Monetyzacja i konta

| #   | Moduł                                                | Zakres                                                                                                                                                                |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | Monetyzacja: checkout / subskrypcje / billing        | checkout Stripe, plany i cennik, dołączenie do członkostwa, uzgadnianie płatności, panel rozliczeń                                                                    |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy | kupony, darowizny, podarowane wpisy w modelu „udostępnij pełny artykuł", reklamy i sponsoring z ramką w piaskownicy                                                   |
| 15  | Profil i konto                                       | profil publiczny, portal logowania z magic link, MFA, reset hasła, ochrona przed brute force, dane konta i eksport RODO, zainteresowania i personalizacja, onboarding |
| 21  | Rekrutacja / kariera                                 | ogłoszenia, formularz zgłoszenia z załącznikiem CV, retencja dokumentów, panel rekrutacyjny                                                                           |

### Wydarzenia

| #   | Moduł                                          | Zakres                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22  | Wydarzenia: event builder, rejestracja, onsite | katalog i typy wydarzeń, studio wydarzenia, agenda z sesjami i ścieżkami, rejestracja z polami i zgodami, bilety i pakiety, sponsorzy i partnerzy, giełda spotkań 1-1, odprawa na miejscu ze skanowaniem i identyfikatorami, publiczny portal wydarzenia, widgety wydarzeń w builderze stron |

### Platforma i operacje

| #   | Moduł                                                 | Zakres                                                                                                                                   |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | Analityka i BI                                        | zbieranie zdarzeń, warstwa semantyczna metryk, panele BI z wykresami, integracje GA4 i Search Console, Core Web Vitals, błędy klienta    |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO | ustawienia serwisu, użytkownicy i role, macierz uprawnień, izolacja najemcy, feature flags, zgody i banner cookie, integracje zewnętrzne |
| 20  | Platforma / backend / infrastruktura / SSR            | routing i trasy publiczne, warstwa funkcji serwerowych, klient bazy danych, SSR i cache brzegowy, obsługa błędów, bramki CI              |

### Powierzchnie przekrojowe

| Powierzchnia                     | Zakres                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| Powłoka panelu administracyjnego | wspólna rama panelu, atomy i molekuły interfejsu administracyjnego |
| Design system                    | 45 komponentów bazowych w `components/ui`                          |
| Słowniki i18n                    | 132 pliki słownikowe, parytet polskiego i angielskiego             |

## Architektura

**Dwa silniki treści, jeden model danych.** Wpisy redakcyjne powstają w silniku bloków
(model zbliżony do Gutenberga), strony w page builderze (model zbliżony do Elementora). Wybór
silnika jest rozstrzygany w jednym punkcie dyspozycji, a warstwa content-model utrzymuje rozdział
między nimi. Konwencja i uzasadnienie tej hybrydy są opisane w `docs/ARCHITECTURE.md`.

**Wielonajemca od strony hosta.** Adres hosta jest rozwiązywany na najemcę przed routerem, w oparciu
o kontrakt zaufanego hosta na granicy brzegowej. Izolacja danych jest wymuszana w bazie politykami
RLS wiążącymi `tenant_id`, a nie wyłącznie w kodzie aplikacji, więc obszar roboczy jednej
organizacji nie może odczytać danych innej.

**Szyna zdarzeń domenowych.** Moduły komunikują się przez tabelę `domain_events`, co daje spójność
między modułami, korelację zmian, optymistyczne mutacje w interfejsie i unieważnianie cache
w oparciu o mapę zdarzeń.

**SSR z dwupoziomowym cache dokumentów.** Pierwszy poziom to pamięć izolatu, drugi to cache brzegowy
z kluczem wersjonowanym przy czyszczeniu. Odświeżanie biegnie za odpowiedzią, więc czytelnik nie
czeka na ponowny render. Klucz cache jest prefiksowany hostem najemcy, a nagłówki serwowane
z trafienia są budowane od zera z białej listy.

**Organizacja komponentów.** Komponenty mieszkają w katalogach nazwanych od funkcji lub roli
i są importowane bezpośrednio ze pliku. Katalogi `atoms/` i `molecules/` na najwyższym poziomie są
grupami tematycznymi wspólnych primitywów; panel buildera utrzymuje własny, konsekwentny podział
`ui/{atoms,molecules,organisms}`.

## Stos technologiczny

| Warstwa                 | Technologia                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Framework               | TanStack Start 1.168, TanStack Router 1.170                                         |
| Interfejs               | React 19.2, TypeScript 5.8, Tailwind CSS 4.2                                        |
| Dane po stronie klienta | TanStack Query 5.101 - jedna dyscyplina pobierania danych w 490 plikach             |
| Granica serwera         | funkcje serwerowe (`createServerFn`) w 103 plikach                                  |
| Baza danych             | PostgreSQL przez Supabase (`@supabase/supabase-js` 2.106), RLS jako granica najemcy |
| Płatności               | Stripe 22                                                                           |
| Internacjonalizacja     | i18next 26, react-i18next 17                                                        |
| Walidacja               | Zod 3                                                                               |
| Wykresy                 | Własny silnik SVG (`src/components/charts` + `src/lib/charts`), bez zależności      |
| Build                   | Vite 7.3                                                                            |
| Testy                   | Vitest 4.1, Playwright 1.61, pgTAP                                                  |

## Jakość jako infrastruktura

Repozytorium traktuje kontrakty jakości jako kod wykonywalny, nie jako zalecenia w dokumentacji.

- **44 bramki `check:*` w potoku CI** pilnują reguł domenowych, nie stylu: zakresu najemcy
  w politykach RLS, zgodności snapshotu uprawnień z migracjami, jednokrotności migracji, budżetów
  rozmiaru paczek, parytetu językowego, czystości wejść i grafu chunków.
- **694 progi pokrycia per ścieżka** działają jako zapadka jednokierunkowa: wartości wolno
  wyłącznie podnosić.
- **104 pliki pgTAP z 1 973 asercjami** dowodzą zachowania warstwy danych: izolacji najemcy,
  polityk RLS, kontraktów RPC i triggerów.
- **Pięć uprzęży postgresowych** wykonuje migracje swoich modułów na świeżym klastrze i dowodzi
  zachowania schematu asercjami w czasie wykonania - tego, czego bramki czytające SQL jako tekst
  zobaczyć nie mogą. Pełną historię **958 migracji** odtwarza zadanie `pgtap` w CI (`supabase db start`)
  oraz lokalny `bun run test:pgtap-local`.
- **Parytet polskiego i angielskiego jest bramką**, nie konwencją: kompletność obu słowników jest
  warunkiem przejścia potoku CI.
- Pokrycie testami mierzone providerem `istanbul` (`vitest.config.ts:47`) na całym `src/`,
  z plikami bez testów w mianowniku: **96,21% linii i 94,65% funkcji** w pomiarze z 2026-09-12,
  w którym wykonano 70 542 przypadki testowe na 3 424 plikach.

Pełna metodologia i wyniki kolejnych pomiarów: `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`.

## Struktura repozytorium

```
src/
  routes/          trasy publiczne i panelu (routing plikowy)
  components/      komponenty w katalogach funkcjonalnych
  lib/             logika domenowa, silniki treści, klienci, i18n
  integrations/    klient bazy danych i typy generowane
  test/            fixture'y i harnessy współdzielone przez testy
supabase/
  migrations/      958 migracji SQL
  tests/           104 pliki pgTAP
e2e/               ścieżki użytkownika (Playwright)
scripts/           bramki CI, uprzęże, taksonomia modułów
docs/              architektura, audyty, zapisy wdrożeń
```

## Uruchomienie lokalne

```bash
bun install                  # instalacja zależności
cp .env.example .env         # konfiguracja środowiska
bun run dev                  # serwer deweloperski
```

Praca z jakością:

```bash
bun run test                 # suita jednostkowa i komponentowa (Vitest)
bun run test:coverage        # pomiar pokrycia z progami per ścieżka
bun run test:e2e             # ścieżki użytkownika (Playwright)
bun run typecheck            # kontrola typów
bun run lint                 # ESLint
bun run format               # Prettier
```

Build produkcyjny: `bun run build`, podgląd artefaktu: `bun run preview`.

## Dokumentacja

| Dokument                                                   | Zawartość                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/ARCHITECTURE.md`                                     | konwencje, silniki treści, warstwa wielonajemcy, szyna zdarzeń, bramki jakości |
| `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` | pomiar pokrycia moduł po module i funkcja po funkcji                           |
| `docs/OCENA_ARCHITEKTURA_BEZPIECZENSTWO.md`                | ocena architektury i bezpieczeństwa                                            |
| `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md`                  | taksonomia modułów i funkcji                                                   |

---

<a id="english-version"></a>

# English version

## About New European Strategies

New European Strategies is an **independent think-tank on European security and geopolitics**:
analyses, reports, interviews and policy papers on great-power rivalry. Alongside its analytical
work, the organisation runs a closed-format expert convening programme and provides strategic
advisory services to public institutions and the private sector across Central and Eastern Europe.

## What this platform is

This is the **in-house publishing and operations platform** of NES, not a site built on an
off-the-shelf CMS. A single repository carries layers that the market usually sells as five or six
separate products: a content management system with two editorial engines, an in-house page builder,
an events engine with onsite operations, membership and monetisation, a newsletter suite, a CRM,
discussion clubs, messaging, search, analytics and a multi-tenant layer.

The platform is a server-rendered application running at the network edge, with a fully bilingual
interface (Polish and English) and data isolation enforced between workspaces.

| Dimension                       | State                                |
| ------------------------------- | ------------------------------------ |
| Domain modules                  | **22** plus 3 cross-cutting surfaces |
| Documented functionalities      | **146**                              |
| Production source files         | **3,534** (747,034 lines)            |
| Test files                      | **2,545**                            |
| Data-layer tests (pgTAP)        | 104 files, 1,973 assertions          |
| User-journey tests (Playwright) | 13 files, 108 tests                  |
| Quality gates in CI (`check:*`) | **44**                               |
| Per-path coverage thresholds    | **694**                              |
| Database migrations             | 958                                  |
| RLS policies in final state     | 634 across 261 tables                |

File, test, migration and policy counts reflect the state of the repository as of 2026-09-12.
The module and functionality breakdown and the coverage figures come from the audit measurement
of 2026-09-05.

## Modules

### Content and reader experience

| #   | Module                                  | Scope                                                                                                                                                      |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Posts: reader experience                | paywall and metering, article audio (TTS), post layouts, table of contents and footnotes, key takeaways, related posts, reading list                       |
| 2   | Post editor and editorial workflow      | editor panels, draft → review → published flow, revisions and restore, autosave, editorial presence                                                        |
| 3   | Content engines: blocks + page builder  | Gutenberg-style block engine for posts, Elementor-style page builder for pages, widget property panels, design tokens, HTML sanitisation, WordPress import |
| 4   | Pages, appearance, theme, media, import | page and archive templates, theme and global colours, media library with cropping, icons and brand                                                         |
| 5   | Homepage, archives, site chrome         | homepage sections, category and tag archives, header, footer, mega menu, mobile chrome                                                                     |
| 7   | Special content types                   | podcast as a network of shows, legislative tracker, expert hubs, research programmes, web stories, file library, quizzes and maps                          |
| 8   | SEO, feeds, structured data             | meta and JSON-LD, hreflang, sitemaps, RSS feeds, sharing and Open Graph, link monitor                                                                      |

### Community, communication and relationships

| #   | Module                                 | Scope                                                                                                                                                               |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Search                                 | index and queries, search overlay, faceted filters, saved searches                                                                                                  |
| 9   | Chat / messaging                       | conversations and messages, composer with mentions, attachments, presence, conversation themes                                                                      |
| 10  | Network / networking                   | invitations, following, directory of people and organisations                                                                                                       |
| 11  | Newsletter and email                   | double opt-in signup, campaigns and delivery, email content builder, open and click telemetry, deliverability (SPF/DKIM, bounces), signup popup, transactional mail |
| 12  | Realtime / notifications / web push    | realtime channels, notification centre, web push, communication consents, daily digest                                                                              |
| 16  | Community: clubs, comments, moderation | discussion clubs with an access matrix, threads, membership applications, badges, polls, Q&A, comments and moderation queue                                         |
| 18  | CRM                                    | contacts, companies, funnel, tasks, CSV import and export, behavioural lead scoring                                                                                 |

### Monetisation and accounts

| #   | Module                                            | Scope                                                                                                                                                              |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 13  | Monetisation: checkout / subscriptions / billing  | Stripe checkout, plans and pricing, membership join, payment reconciliation, billing panel                                                                         |
| 14  | Monetisation: coupons / donations / gifting / ads | coupons, donations, gifted articles in the „share full article" model, advertising and sponsorship with a sandboxed creative frame                                 |
| 15  | Profile and account                               | public profile, login portal with magic link, MFA, password reset, brute-force protection, account data and GDPR export, interests and personalisation, onboarding |
| 21  | Recruitment / careers                             | job postings, application form with CV upload, document retention, recruitment panel                                                                               |

### Events

| #   | Module                                      | Scope                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22  | Events: event builder, registration, onsite | event catalogue and types, event studio, agenda with sessions and tracks, registration with custom fields and consents, tickets and packages, sponsors and partners, 1-1 meeting exchange, onsite check-in with scanning and badges, public event portal, event widgets inside the page builder |

### Platform and operations

| #   | Module                                                | Scope                                                                                                                                    |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | Analytics and BI                                      | event collection, semantic metrics layer, BI dashboards with charts, GA4 and Search Console integrations, Core Web Vitals, client errors |
| 19  | Settings / integrations / users / multi-tenant / GDPR | site settings, users and roles, permission matrix, tenant isolation, feature flags, consents and cookie banner, external integrations    |
| 20  | Platform / backend / infrastructure / SSR             | routing and public routes, server function layer, database client, SSR and edge cache, error boundaries, CI gates                        |

### Cross-cutting surfaces

| Surface           | Scope                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Admin shell       | shared admin frame, administrative interface atoms and molecules |
| Design system     | 45 base components in `components/ui`                            |
| i18n dictionaries | 132 dictionary files, parity between Polish and English          |

## Architecture

**Two content engines, one data model.** Editorial posts are authored in the block engine
(a Gutenberg-like model), pages in the page builder (an Elementor-like model). The engine choice is
resolved at a single dispatch point, and a content-model layer maintains the separation between them.
The convention and its rationale are documented in `docs/ARCHITECTURE.md`.

**Host-driven multi-tenancy.** The request host is resolved to a tenant ahead of the router, based on
a trusted-host contract at the edge boundary. Data isolation is enforced in the database by RLS
policies bound to `tenant_id` rather than in application code alone, so one organisation's workspace
cannot read another's data.

**Domain event bus.** Modules communicate through a `domain_events` table, which provides
cross-module consistency, change correlation, optimistic UI mutations and cache invalidation driven
by an event map.

**SSR with a two-level document cache.** The first level lives in isolate memory, the second at the
edge with a key versioned on purge. Revalidation runs behind the response, so the reader never waits
for a re-render. The cache key is prefixed with the tenant host, and headers served from a hit are
rebuilt from an allow-list.

**Component organisation.** Components live in folders named after their feature or role and are
imported directly from the file. The top-level `atoms/` and `molecules/` folders are topical
groupings of shared primitives; the builder admin UI maintains its own consistent
`ui/{atoms,molecules,organisms}` split.

## Technology stack

| Layer                | Technology                                                                          |
| -------------------- | ----------------------------------------------------------------------------------- |
| Framework            | TanStack Start 1.168, TanStack Router 1.170                                         |
| Interface            | React 19.2, TypeScript 5.8, Tailwind CSS 4.2                                        |
| Client-side data     | TanStack Query 5.101 - one data-fetching discipline across 490 files                |
| Server boundary      | server functions (`createServerFn`) across 103 files                                |
| Database             | PostgreSQL via Supabase (`@supabase/supabase-js` 2.106), RLS as the tenant boundary |
| Payments             | Stripe 22                                                                           |
| Internationalisation | i18next 26, react-i18next 17                                                        |
| Validation           | Zod 3                                                                               |
| Charts               | In-house SVG engine (`src/components/charts` + `src/lib/charts`), no dependency     |
| Build                | Vite 7.3                                                                            |
| Testing              | Vitest 4.1, Playwright 1.61, pgTAP                                                  |

## Quality as infrastructure

The repository treats quality contracts as executable code rather than documented recommendations.

- **44 `check:*` gates in the CI pipeline** enforce domain rules rather than style: tenant scope in
  RLS policies, agreement between the permissions snapshot and migrations, migration idempotence,
  bundle size budgets, language parity, entry purity and the chunk graph.
- **694 per-path coverage thresholds** act as a one-way ratchet: values may only be raised.
- **104 pgTAP files with 1,973 assertions** prove data-layer behaviour: tenant isolation, RLS
  policies, RPC contracts and triggers.
- **Five PostgreSQL harnesses** apply their module's migrations to a fresh cluster and prove schema
  behaviour with runtime assertions - what text-level SQL gates structurally cannot see. The full
  history of **958 migrations** is replayed by the CI `pgtap` job (`supabase db start`) and by the
  local `bun run test:pgtap-local` runner.
- **Polish and English parity is a gate**, not a convention: completeness of both dictionaries is
  a condition for the pipeline to pass.
- Test coverage is measured with the `istanbul` provider (`vitest.config.ts:47`) across all of `src/`,
  with untested files included in the denominator: **96.21% of lines and 94.65% of functions**
  as measured on 2026-09-12, in a run that executed 70,542 test cases across 3,424 files.

Full methodology and the results of successive measurements:
`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`.

## Repository layout

```
src/
  routes/          public and admin routes (file-based routing)
  components/      components grouped in feature folders
  lib/             domain logic, content engines, clients, i18n
  integrations/    database client and generated types
  test/            fixtures and harnesses shared across tests
supabase/
  migrations/      958 SQL migrations
  tests/           104 pgTAP files
e2e/               user journeys (Playwright)
scripts/           CI gates, harnesses, module taxonomy
docs/              architecture, audits, implementation records
```

## Running locally

```bash
bun install                  # install dependencies
cp .env.example .env         # configure the environment
bun run dev                  # development server
```

Working with quality:

```bash
bun run test                 # unit and component suite (Vitest)
bun run test:coverage        # coverage measurement with per-path thresholds
bun run test:e2e             # user journeys (Playwright)
bun run typecheck            # type checking
bun run lint                 # ESLint
bun run format               # Prettier
```

Production build: `bun run build`, artefact preview: `bun run preview`.

## Documentation

| Document                                                   | Contents                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md`                                     | conventions, content engines, multi-tenant layer, event bus, quality gates |
| `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` | coverage measured module by module and function by function                |
| `docs/OCENA_ARCHITEKTURA_BEZPIECZENSTWO.md`                | architecture and security assessment                                       |
| `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md`                  | module and function taxonomy                                               |

---

© New European Strategies. Repozytorium prywatne. · Private repository.

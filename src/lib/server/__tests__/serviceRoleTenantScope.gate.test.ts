// Bramka: czytnik spod service-role nie może wypuścić treści cudzego najemcy
// do publicznej sitemapy, RSS-a ani llms.txt.
//
// CO TO ZA RYZYKO. Nagłówek `publishedContent.server.ts` mówi to sam:
// „TENANT SCOPE: these readers use the service role, which bypasses RLS - so
// every query filters by the tenant that owns the request host. Without the
// explicit filter a second tenant's content would leak into another site's
// sitemap/RSS/llms.txt." Czyli: RLS - jedyna zapora, która działa bez pamięci
// programisty - jest dla tych zapytań WYŁĄCZONA, a to, co zostaje, to filtr
// wpisany ręcznie. Powierzchnia skutku jest najgorsza z możliwych: sitemapa
// i kanały RSS są czytane i cache'owane przez wyszukiwarki, więc wyciek
// przeżywa własną naprawę o tyle, ile trwa cykl indeksowania.
//
// DLACZEGO ASERCJA JEST STATYCZNA, A NIE INTEGRACYJNA. Dowód integracyjny
// wymagałby dwóch najemców z treścią w kilkunastu tabelach, dwóch hostów
// i prawdziwej bazy. Ta bramka czyta KOD i wymaga, żeby każde zapytanie samo
// mówiło, po czyim najemcy idzie - przenosi dowód z czasu wykonania do czasu
// review. Ten sam wybór i to samo uzasadnienie co w
// `src/lib/profile/__tests__/exportOwnerScope.gate.test.ts`.
//
// CZEGO NIE DUBLUJE. `check:sql-tenant-scope` i `check:sql-owner-tenant-scope`
// czytają wyłącznie SQL - ciała `SECURITY DEFINER` i predykaty polityk RLS.
// Siedemnaście plików pgTAP o izolacji najemcy dowodzi, że polityki działają.
// Dla zapytania spod service-role oba dowody są bez znaczenia, bo service role
// omija dokładnie tę warstwę, którą one badają. Ta bramka pokrywa jedyną
// warstwę, której nie pokrywa nic innego: zapytania TypeScriptu wykonywane
// z pominięciem RLS.
//
// TRZY GRANICE, NIE JEDNA. Filtr w zapytaniu to tylko pierwsza z nich, i sama
// nie wystarcza:
//   1. FILTR - każde zapytanie ma jawne `.eq("tenant_id", tenantId)`;
//   2. KLUCZ CACHE - `edgeTtlCache` trzyma wynik 60 s; klucz bez `tenantId`
//      podałby treść najemcy A na domenie najemcy B przy IDEALNYCH filtrach.
//      `lib/ssrCache.ts` skopuje wpisy hostem, ale żądania bez rozwiązywalnego
//      hosta dzielą zakres „no-host" - tam `tenantId` w kluczu jest JEDYNYM
//      separatorem;
//   3. PŁASZCZYZNA ROZWIĄZANIA HOSTA - `tenant.server.ts` ma dwa kontrakty:
//      treściowy (`resolveTenantForHost`: nieznany host -> tenant DOMYŚLNY)
//      i crawlerowy (`resolveCrawlerTenantForHost`: fail-closed -> null).
//      Powierzchnia crawlera na kontrakcie treściowym publikuje treść tenanta
//      domyślnego na cudzej, niezajętej domenie - z idealnymi filtrami
//      i idealnym kluczem cache. Nagłówek `publishedContent.server.ts` wskazuje
//      tu `resolveTenantForHost`, czyli dokładnie tę gorszą z dwóch funkcji;
//      dlatego to KOD, nie komentarz, jest przypięty niżej.
//
// WYJĄTKI SĄ DECYZJĄ. Lista `EXEMPTIONS` niżej jest kluczowana parą
// plik+tabela, nie samą tabelą: zgoda na brak filtru dotyczy jednego miejsca,
// nie tabeli w całym repozytorium. Każdy wpis nosi uzasadnienie, a dwa testy
// pilnują higieny listy - wpis bez trafienia i wpis dla zapytania, które MA
// filtr, są błędem, bo martwy wyjątek to przyszła furtka.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { extractLatestDefinitions, stripSqlComments } from "../../../../scripts/lib/sqlMigrations";
import { maskComments } from "@/lib/ci/i18nKeyUsage";
import {
  auditServiceRoleTenantScope,
  exemptionKey,
  renderTenantScopeReport,
  tableQueries,
  usesServiceRole,
  type ScannedSource,
} from "@/lib/ci/serviceRoleTenantScope";

const SERVER_DIR = "src/lib/server";
const PUBLISHED = "src/lib/server/publishedContent.server.ts";

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Zakres skanu: `src/lib/server/**` oraz `src/lib/*.server.ts`. To powierzchnia
 * serwerowa modułu platformy - katalog `lib/billing/**` ma własną bramkę
 * właścicielską i własne pgTAP-y, więc nie jest tu dublowany.
 */
function serverSources(): ScannedSource[] {
  const out: ScannedSource[] = [];
  for (const name of readdirSync(SERVER_DIR).sort()) {
    if (!name.endsWith(".server.ts")) continue;
    out.push({ file: `${SERVER_DIR}/${name}`, source: read(`${SERVER_DIR}/${name}`) });
  }
  for (const name of readdirSync("src/lib").sort()) {
    if (!name.endsWith(".server.ts")) continue;
    out.push({ file: `src/lib/${name}`, source: read(`src/lib/${name}`) });
  }
  return out;
}

/**
 * REJESTR CZYTNIKÓW SERVICE-ROLE. Przypięty, bo dopisanie nowego czytnika jest
 * momentem, w którym trzeba świadomie zdecydować o zakresie najemcy - a bez
 * tej listy nowy plik wchodzi do repozytorium bez ani jednej decyzji.
 * Rozjazd w OBIE strony jest błędem: plik zniknięty z listy znaczy, że ktoś
 * przestał używać service-role (wtedy wpis do usunięcia) albo że skan go już
 * nie widzi (wtedy bramka oślepła).
 */
const SERVICE_ROLE_READERS = [
  "src/lib/server/careerCvRetention.server.ts",
  "src/lib/server/email.server.ts",
  "src/lib/server/jobScheduler.server.ts",
  "src/lib/server/publishedContent.server.ts",
  "src/lib/server/rate-limit.server.ts",
  "src/lib/server/tenant.server.ts",
  "src/lib/server/tts.server.ts",
  "src/lib/server/wp-media.server.ts",
] as const;

/**
 * Zapytania świadomie bez filtru najemcy. Trzy kategorie, każda z innym
 * powodem - i żadna z nich nie jest „nie zdążyliśmy".
 *
 * TABELA BEZ KOLUMNY NAJEMCY (zakres przechodni). `post_categories` ma
 * dokładnie `{post_id, category_id}`, `post_tags` - `{post_id, tag_id}`
 * (sprawdzone w `src/integrations/supabase/types.ts`). Nie ma czego filtrować.
 * Zakres stawiają dwa ogniwa wokół: klucz łączący pochodzi z zapytania
 * filtrowanego po najemcy (`categories`/`tags`/`research_programs`
 * z `.eq("tenant_id", tenantId)`), a zebrane `post_id` wracają do tabeli
 * `posts` przez `.in("id", postIds)` - też z filtrem najemcy. Nawet gdyby
 * tabela łącząca zawierała parę z innego najemcy, ten drugi filtr ją odrzuci.
 *
 * KATALOG NAJEMCÓW. `tenants` w `tenant.server.ts` to tabela, KTÓRA
 * ROZSTRZYGA najemcę. Filtr po najemcy byłby tu błędem logicznym: trzeba
 * przeczytać katalog, żeby wiedzieć, po czym filtrować.
 *
 * SONDA GLOBALNA BEZ TREŚCI. Trzy zapytania zwracają liczbę albo wiersz
 * konfiguracji instancji, nigdy treść najemcy: `job_runner_settings`
 * (singleton `.eq("id", 1)`), `notification_push_queue` (`count`, head-only)
 * i `career_cv_gc_queue` (`count`, head-only). Odpowiedź to skalar - nie ma
 * ładunku, który mógłby przeciec na cudzą domenę. Gdyby którekolwiek z nich
 * zaczęło zwracać wiersze, wpis trzeba usunąć, a nie rozszerzyć.
 */
const EXEMPTIONS = {
  [exemptionKey(PUBLISHED, "post_categories")]:
    'tabela łącząca bez kolumny tenant_id; zakres przechodni przez category_id z zapytania filtrowanego i przez .in("id", postIds) na posts',
  [exemptionKey(PUBLISHED, "post_tags")]:
    'tabela łącząca bez kolumny tenant_id; zakres przechodni przez tag_id z zapytania filtrowanego i przez .in("id", postIds) na posts',
  [exemptionKey("src/lib/server/tenant.server.ts", "tenants")]:
    "katalog najemców - tabela rozstrzygająca najemcę; filtr po najemcy byłby błędem logicznym",
  [exemptionKey("src/lib/server/jobScheduler.server.ts", "job_runner_settings")]:
    'singleton konfiguracji instancji (.eq("id", 1)), nie treść najemcy',
  [exemptionKey("src/lib/server/jobScheduler.server.ts", "notification_push_queue")]:
    "sonda zdrowia: count head-only, odpowiedź jest skalarem bez ładunku",
  [exemptionKey("src/lib/server/careerCvRetention.server.ts", "career_cv_gc_queue")]:
    "sonda zdrowia GC: count head-only, odpowiedź jest skalarem bez ładunku",
} as const;

describe("zakres najemcy dla czytników service-role", () => {
  const sources = serverSources();
  const report = auditServiceRoleTenantScope(sources, EXEMPTIONS);

  it("skan realnie widzi zapytania - kanarek zasięgu", () => {
    // Bez tego bramka po refaktorze na inny klient bazy (albo po zmianie
    // nazwy `supabaseAdmin`) robi się pusta i zielona.
    expect(report.analyzed).toBeGreaterThanOrEqual(30);
    expect(report.scoped).toBeGreaterThanOrEqual(25);
  });

  it("rejestr czytników service-role zgadza się z kodem", () => {
    // Nowy czytnik bez wpisu = decyzja o zakresie najemnicy, której nikt nie
    // podjął. Wpis bez czytnika = bramka, która przestała cokolwiek widzieć.
    expect(report.serviceRoleFiles).toEqual([...SERVICE_ROLE_READERS]);
  });

  it("każde zapytanie spod service-role ma granicę najemcy albo jawny wyjątek", () => {
    expect(renderTenantScopeReport(report)).toBe("");
    expect(report.gaps).toEqual([]);
  });

  it("lista wyjątków nie zawiera wpisów bez trafienia", () => {
    // Martwy wyjątek to przyszła furtka: nazwa zostaje, a wraz z nią zgoda na
    // brak filtru dla miejsca, którego już nikt nie pamięta.
    expect(report.staleExemptions).toEqual([]);
  });

  it("lista wyjątków nie zwalnia zapytań, które MAJĄ filtr", () => {
    // Wyjątek, który przestał być potrzebny, osłabia bramkę na przyszłość:
    // kolejne zapytanie na tej samej tabeli w tym pliku przejdzie bez filtru.
    expect(report.redundantExemptions).toEqual([]);
  });
});

describe("publishedContent.server.ts - najemca nie da się pominąć", () => {
  const src = read(PUBLISHED);

  /** Publiczne czytniki tego pliku - wszystkie `export async function fetch*`. */
  const readers = [...src.matchAll(/export async function (fetch\w+)\(([^)]*)\)/gs)];

  it("plik ma czytniki do sprawdzenia - kanarek zasięgu", () => {
    expect(readers.length).toBeGreaterThanOrEqual(14);
  });

  it("każdy czytnik bierze `tenantId` jako PIERWSZY parametr", () => {
    // To jest granica, której nie da się zapomnieć w miejscu wywołania: brak
    // argumentu jest błędem typów. Najemca podany jako parametr opcjonalny
    // albo dalej w kolejności przestaje być wymuszony przez `tsc`.
    const offenders = readers
      .filter((m) => !/^\s*tenantId\s*:\s*string\s*(,|$)/.test(m[2]))
      .map((m) => `${PUBLISHED} ${m[1]} - pierwszy parametr to nie tenantId: string`);
    expect(offenders).toEqual([]);
  });

  it("każdy klucz cache brzegowego zawiera `tenantId`", () => {
    // Druga granica, niezależna od filtrów. `edgeTtlCache` trzyma wynik 60 s;
    // klucz `seo:published-posts:${limit}` bez najemcy podałby wpisy najemcy A
    // na domenie najemcy B przy KAŻDYM poprawnym filtrze w zapytaniu.
    const keys = [...src.matchAll(/edgeTtlCache\(\s*`([^`]*)`/g)];
    expect(keys.length).toBeGreaterThanOrEqual(14);
    const offenders = keys
      .filter((m) => !m[1].includes("${tenantId}"))
      .map((m) => `${PUBLISHED} klucz cache bez najemcy: ${m[1]}`);
    expect(offenders).toEqual([]);
  });

  it("plik nie sięga po klient użytkownika - jedyną granicą jest filtr", () => {
    // Gdyby część zapytań szła klientem anonimowym, część zakresu robiłby RLS
    // i asercje wyżej przestałyby opisywać całość pliku.
    expect(usesServiceRole(src)).toBe(true);
    expect(src).not.toMatch(/from "@\/integrations\/supabase\/client"/);
  });

  it("wszystkie zapytania celują w tabele, nie w kubełki storage", () => {
    // Kanarek analizatora: gdyby `tableQueries` zaczęło liczyć
    // `.storage.from(...)`, liczby wyżej przestałyby znaczyć to, co znaczą.
    const queries = tableQueries({ file: PUBLISHED, source: src });
    expect(queries.length).toBeGreaterThanOrEqual(25);
    expect(queries.every((q) => q.table !== "media" || /\.eq\(/.test(q.body))).toBe(true);
  });
});

describe("powierzchnie crawlera rozwiązują hosta płaszczyzną fail-closed", () => {
  /**
   * Kontrakt treściowy (`resolveTenantForHost`, `resolveTenantIdForHost`)
   * oddaje na nieznanym hoście tenanta DOMYŚLNEGO - dla strony HTML jest to
   * pożądane (podglądy i niezajęte domeny nadal się renderują), dla sitemapy
   * i RSS-a jest to publikacja treści tenanta domyślnego na cudzej domenie.
   * Kontrakt crawlerowy zwraca `null` i powierzchnia odpowiada 404.
   */
  const CRAWLER_PLANE = [
    "resolveCrawlerTenantIdForHost",
    "resolveCrawlerTenantForHost",
    // Cienkie opakowanie na płaszczyznę crawlera (sitemapRequest.server.ts:75-83):
    // woła resolveCrawlerTenantIdForHost i dokłada rozróżnienie 404 vs degradacja.
    "resolveSitemapTenant",
  ] as const;
  const CONTENT_PLANE = ["resolveTenantIdForHost", "resolveTenantForHost"] as const;

  /**
   * Pliki, które IMPORTUJĄ czytnik z `publishedContent.server` - lista
   * samokalibrująca się, więc nowa trasa feedu nie wchodzi w ciszy.
   *
   * Wykrywanie po składni importu (statycznego albo dynamicznego), nie po samej
   * nazwie w tekście: nazwa pliku pada też w komentarzach - m.in. w module
   * analizatora tej bramki - a komentarz nie jest powierzchnią crawlera.
   */
  const IMPORTS_READER = /(?:from|import\()\s*"@\/lib\/server\/publishedContent\.server"/;

  function crawlerSurfaces(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        if (path === PUBLISHED) continue;
        if (IMPORTS_READER.test(maskComments(read(path)))) out.push(path);
      }
    };
    walk("src");
    return out.sort();
  }

  const surfaces = crawlerSurfaces();

  it("bramka widzi powierzchnie crawlera - kanarek zasięgu", () => {
    // Alternatywą byłaby lista ręczna, która milczy o nowej trasie feedu.
    expect(surfaces.length).toBeGreaterThanOrEqual(10);
  });

  it("żadna powierzchnia crawlera nie rozwiązuje hosta kontraktem treściowym", () => {
    const offenders: string[] = [];
    for (const file of surfaces) {
      const source = read(file);
      for (const fn of CONTENT_PLANE) {
        // `resolveTenantForHost` jest prefiksem `resolveTenantForHostX`? nie -
        // ale JEST podciągiem `resolveCrawlerTenantForHost`, więc granica słowa
        // od lewej jest konieczna, inaczej każda powierzchnia byłaby winna.
        if (new RegExp(`(?<![A-Za-z])${fn}\\b`).test(source)) {
          offenders.push(`${file} - używa ${fn} (kontrakt treściowy) na powierzchni crawlera`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("każda powierzchnia crawlera rozwiązuje najemcę płaszczyzną crawlera", () => {
    // Powierzchnia, która nie rozwiązuje najemcy WCALE, dostaje `tenantId`
    // od wołającego - i wtedy dowód przenosi się na tamten plik, który sam
    // jest na tej liście. Dlatego wymagamy, żeby łańcuch gdzieś się domknął:
    // każdy plik albo rozwiązuje hosta, albo tylko re-eksportuje czytnik.
    const offenders: string[] = [];
    for (const file of surfaces) {
      const source = read(file);
      const resolves = CRAWLER_PLANE.some((fn) => source.includes(fn));
      const forwardsOnly = /export\s+\{[^}]*\}\s+from|export \* from/.test(source);
      if (!resolves && !forwardsOnly) {
        offenders.push(`${file} - nie rozwiązuje najemcy żadną funkcją płaszczyzny crawlera`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("adres kanoniczny strony - ścieżka rodzica nie przekracza granicy najemcy", () => {
  /**
   * DEFEKT NAPRAWIONY 31.08.2026. TO JEST DZIŚ RATCHET, NIE ZGŁOSZENIE.
   *
   * Do 31.08 `fetchPagePaths` (`publishedContent.server.ts:59`) filtrował `pages`
   * po najemcy poprawnie, ale pełną ścieżkę składał RPC
   * `public.page_full_path(_page_id uuid)` (migracja 20260531223436): rekurencyjne
   * CTE idące w GÓRĘ po `pages.parent_id`, BEZ predykatu najemcy, `LANGUAGE sql
   * STABLE` (czyli SECURITY INVOKER - wołane spod service-role nie ma nad sobą
   * RLS). Strona z `parent_id` wskazującym stronę innego najemcy wnosiła JEGO
   * slug do ścieżki kanonicznej publikowanej w sitemapie i RSS-ie.
   *
   * ZAMKNĘŁA TO migracja `20260831160000_page_full_path_tenant_scope.sql` dwiema
   * niezależnymi warstwami:
   *   A. predykat `AND p.tenant_id = c.tenant_id` w rekurencji OBU funkcji
   *      ścieżki (linie 76 i 114 migracji) - chroni ODCZYT danych, które już są;
   *   B. złożony klucz obcy `pages_parent_same_tenant_fkey`
   *      `(parent_id, tenant_id) -> pages(id, tenant_id)` (linia 201, w bloku
   *      `DO $$ … EXCEPTION`) - nie pozwala takich danych WYTWORZYĆ.
   *
   * DLACZEGO `it.fails` ZNIKA. Asercja przechodzi od 31.08, więc vitest zgłaszał
   * `Error: Expect test to fail` - i to TEN wpis czerwienił job `test` na `main`
   * przez pięć dni. Znacznik defektu przeżył defekt: dokładnie ta klasa długu,
   * przed którą broni reszta tego pliku, tylko obrócona przeciw niemu samemu.
   *
   * DLACZEGO ASERCJA MUSIAŁA UROSNĄĆ, A NIE TYLKO STRACIĆ ZNACZNIK. Poprzednia
   * flaga `parentSameTenantConstraint` szukała po SUROWEJ treści migracji
   * wyłącznie `/(CHECK…parent_id…tenant_id)|(TRIGGER…pages…parent…tenant)/`.
   * Ma to trzy niezależne wady i każda osobno wystarcza, żeby ją unieważnić:
   *
   *   1. SZUKAŁA NIE TEGO OGRANICZENIA. Migracja świadomie odrzuciła obie te
   *      drogi (jej linie 126-147: CHECK czytający inny wiersz nie jest
   *      immutable i nie przelicza się przy zmianie `tenant_id` RODZICA,
   *      a trigger da się wyłączyć `ALTER TABLE … DISABLE TRIGGER`) i założyła
   *      ZŁOŻONY KLUCZ OBCY. Słowo `FOREIGN` nie padało w tamtym wzorcu ani raz.
   *
   *   2. BYŁA PRAWDZIWA SIEDEM TYGODNI PRZED NAPRAWĄ. Zmierzone na katalogu 935
   *      migracji: stary wzorzec trafiał w cztery pliki, z czego trzy bez związku
   *      ze sprawą - `20260713173411` i `20260714130000` przez `CHECK (parent_id
   *      IS NULL OR parent_id <> id)` na tabeli `categories`, oraz `20260826114616`
   *      przez `DROP TRIGGER … ON public.event_pages`, gdzie „pages" jest ogonem
   *      nazwy `event_pages`. Czwarte trafienie, w samej migracji naprawiającej,
   *      padało na POLSKI KOMENTARZ, a nie na DDL. Flaga stała więc na cudzych
   *      migracjach od 13.07 - była zielona długo przed naprawą i nigdy nie
   *      mierzyła tego, co obiecywała jej nazwa.
   *      Dlatego cały ten blok czyta treść przepuszczoną przez `stripSqlComments`:
   *      w repozytorium, które pisze w migracjach kroniki decyzji, proza
   *      o ograniczeniu nie ma prawa spełniać asercji o ograniczeniu.
   *
   *   3. `.some()` PO CAŁEJ HISTORII TO FLAGA MONOTONICZNA - raz zapalona, nie
   *      umie zgasnąć. Gdyby jutro ktoś zdjął ograniczenie, migracja z 31.08
   *      nadal leży w katalogu i nadal pasuje, więc bramka świeciłaby zielono nad
   *      otwartą dziurą. Reszta repo liczy to inaczej i mówi to wprost:
   *      `rpcContract.ts` i `policyTenantRegression.ts` oceniają STAN KOŃCOWY.
   *
   * DLACZEGO STAN KOŃCOWY FUNKCJI BIERZEMY Z `scripts/lib/sqlMigrations`, A NIE
   * WŁASNYM REGEXEM. `extractLatestDefinitions()` jest w tym repozytorium
   * kanoniczną rachubą „ostatnia definicja wygrywa" - używają jej
   * `check-sql-rpc-contract`, `check-sql-app-role-literals` i `tenantHostTrust
   * .invariant.test.ts`. Domknięcie listy parametrów po zbalansowanych nawiasach
   * i złapanie znacznika dollar-quote (`$$` albo `$function$`) ma tam zrobione
   * poprawnie; wersja pisana tu od nowa zaszywałaby `$$;` na sztywno i na ciele
   * z innym znacznikiem pobiegłaby aż do `$$;` z NIEZWIĄZANEGO bloku `DO`
   * w tym samym pliku. Klucz stanu końcowego to `nazwa/arność`, więc
   * `page_full_path/1` i `page_full_paths/1` liczą się OSOBNO.
   *
   * PREDYKAT, A NIE SAMA OBECNOŚĆ KOLUMNY. Stara flaga pytała `/tenant_id/`
   * o całą treść - a ciało SELECT-uje `tenant_id` jako kolumnę łańcucha, więc
   * przechodziła też wersja BEZ złączenia po najemcy. Wymagamy równości dwóch
   * `tenant_id` pod RÓŻNYMI aliasami: to jedyny kształt, który realnie urywa
   * łańcuch na granicy najemcy, i jest odporny na przemianowanie aliasów.
   *
   * KSZTAŁT I NAZWA W OSOBNYCH TESTACH, bo to dwa różne ryzyka:
   *   * KSZTAŁT - para `(parent_id, tenant_id)` wskazująca `pages(id, tenant_id)`,
   *     sparowana POZYCYJNIE - jest jedyną treścią, która cokolwiek egzekwuje.
   *     Pozycyjnie, bo `REFERENCES pages(tenant_id, id)` to poprawna składnia,
   *     ten sam ZBIÓR kolumn i zupełnie bezużyteczne ograniczenie. Kształtu
   *     szukamy dla DOWOLNEJ nazwy, żeby przemianowanie dawało komunikat „jest,
   *     ale pod inną nazwą", a nie kłamliwe „nie ma ograniczenia".
   *   * NAZWA jest napisem i sama nie chroni danych. Sprawdzamy ją z innego
   *     powodu niż bezpieczeństwo: pod TĄ nazwą pytają `pg_constraint` dowody
   *     wykonaniowe (`scripts/tenant-isolation-harness/runtime_test.sql`,
   *     `supabase/tests/page_full_path_tenant_scope_test.sql`), więc ciche
   *     przemianowanie zamieniłoby je w testy o niczym.
   *
   * CZEGO TEN BLOK NIE MIERZY - i to jest ograniczenie, nie przeoczenie.
   * Wszystkie cztery asercje czytają PLIKI migracji, więc dowodzą DEKLARACJI,
   * nie wykonania na wdrożonej bazie. Dowód wykonaniowy stoi osobno, w pgTAP-ach
   * i w uprzęży izolacji najemcy wymienionych wyżej. Rozważaliśmy piątą asercję
   * czytającą `src/integrations/supabase/types.ts` (plik generowany Z BAZY), ale
   * odrzuciliśmy ją świadomie: `src/lib/ci/generatedTypesFreshness.ts` sam
   * dokumentuje, że ten plik BYWA nieświeży, więc bramka postawiona na nim
   * potrafi zaświecić czerwono z powodu niezwiązanego z izolacją najemcy -
   * a to jest dokładnie ta choroba, którą ten commit leczy.
   */
  const LATEST_FNS = extractLatestDefinitions();

  /** Klucze stanu końcowego w formacie `nazwa/arność` (patrz `FnDef.key`). */
  const PATH_FUNCTIONS = ["public.page_full_path/1", "public.page_full_paths/1"] as const;
  const PARENT_TENANT_FK = "pages_parent_same_tenant_fkey";
  const PAGES_MIGRATIONS_DIR = "supabase/migrations";

  /** Równość `tenant_id` pod DWOMA RÓŻNYMI aliasami - czyli złączenie, nie kolumna. */
  function bindsTenant(body: string): boolean {
    return [...body.matchAll(/([A-Za-z_]\w*)\.tenant_id\s*=\s*([A-Za-z_]\w*)\.tenant_id/g)].some(
      (m) => m[1] !== m[2],
    );
  }

  /**
   * JEDEN wzorzec na `ADD` i `DROP`, bo liczy się KOLEJNOŚĆ W PLIKU. Dwie osobne
   * pętle (najpierw wszystkie `ADD`, potem wszystkie `DROP`) dawały wynik zależny
   * od kolejności pętli, a nie od treści migracji: dominujący idiom tego repo
   * `DROP CONSTRAINT IF EXISTS x; ADD CONSTRAINT x …` - wymuszony tym, że Postgres
   * nie zna `ADD CONSTRAINT IF NOT EXISTS` - zostałby policzony jako ZDJĘCIE
   * ograniczenia i wywrócił bramkę przy zerowej regresji.
   */
  const PAGES_CONSTRAINT_OP = new RegExp(
    "ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?pages\\s+(?:" +
      "ADD\\s+CONSTRAINT\\s+([A-Za-z_]\\w*)\\s+FOREIGN\\s+KEY\\s*\\(([^)]*)\\)" +
      "\\s*REFERENCES\\s+(?:public\\.)?pages\\s*\\(([^)]*)\\)" +
      "|DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?([A-Za-z_]\\w*)" +
      ")",
    "gi",
  );

  const columnList = (raw: string): string[] =>
    raw.split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());

  /**
   * Ograniczenia „ten sam najemca" ŻYWE w stanie końcowym: nazwa -> migracja,
   * która je dziś niesie.
   *
   * Wstępny filtr po SUROWEJ treści jest poprawnościowo bezpieczny, nie tylko
   * szybki: `stripSqlComments` wyłącznie USUWA tekst, więc plik bez słowa `pages`
   * przed odjęciem komentarzy tym bardziej nie ma go po. Odsiewa 834 z 935 plików.
   */
  function liveSameTenantFks(): Map<string, string> {
    const live = new Map<string, string>();
    const files = readdirSync(PAGES_MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const raw = read(`${PAGES_MIGRATIONS_DIR}/${file}`);
      if (!/\bpages\b/i.test(raw)) continue;
      for (const m of stripSqlComments(raw).matchAll(PAGES_CONSTRAINT_OP)) {
        const [, addName, localRaw, referencedRaw, dropName] = m;
        if (dropName !== undefined) {
          live.delete(dropName.toLowerCase());
          continue;
        }
        const local = columnList(localRaw);
        const referenced = columnList(referencedRaw);
        // Jednokolumnowe `parent_id -> pages(id)` z migracji założycielskiej
        // odpada tutaj - i ma odpaść, bo to właśnie ono dopuszczało wyciek.
        if (local.length !== 2 || referenced.length !== 2) continue;
        const pairs = local.map((c, i) => `${c}->${referenced[i]}`).sort();
        if (pairs.join("|") !== "parent_id->id|tenant_id->tenant_id") continue;
        live.set(addName.toLowerCase(), file);
      }
    }
    return live;
  }

  const LIVE_FKS = liveSameTenantFks();

  /**
   * Funkcje ZDJĘTE po swojej ostatniej definicji.
   *
   * `extractLatestDefinitions()` rejestruje wyłącznie `CREATE [OR REPLACE]
   * FUNCTION` - słowo `DROP` nie pada w `scripts/lib/sqlMigrations.ts` ani razu.
   * Sam kanarek istnienia byłby więc ślepy na `DROP FUNCTION`: wpis zostaje
   * w mapie, `missing` jest puste, a asercja o predykacie ogląda ciało SPRZED
   * zdjęcia. Bramka świeciłaby zielono nad funkcją, której już nie ma - czyli
   * dokładnie ta sama wada monotoniczności, którą wpis nr 3 wyżej zarzuca
   * staremu `.some()`, tylko przeniesiona o poziom niżej.
   *
   * Liczymy to TUTAJ, a nie w `sqlMigrations.ts`: ten helper karmi cztery inne
   * bramki, a zmiana jego semantyki jest osobną decyzją z własnym pomiarem.
   *
   * Dopasowanie po SAMEJ NAZWIE, bez listy typów, jest świadomie ZACHOWAWCZE:
   * `DROP FUNCTION` z inną arnością zgłosi się tu jako zdjęcie i bramka zaświeci
   * czerwono. Fałszywy alarm na bramce izolacji najemcy kosztuje jedno
   * spojrzenie człowieka; przeoczone zdjęcie kosztuje wyciek.
   */
  function droppedAfterDefinition(): string[] {
    const files = readdirSync(PAGES_MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const lastDrop = new Map<string, string>();
    for (const file of files) {
      const raw = read(`${PAGES_MIGRATIONS_DIR}/${file}`);
      if (!/page_full_path/i.test(raw)) continue;
      for (const m of stripSqlComments(raw).matchAll(
        /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(page_full_paths?)\b/gi,
      )) {
        lastDrop.set(`public.${m[1].toLowerCase()}`, file);
      }
    }
    return PATH_FUNCTIONS.flatMap((key) => {
      const def = LATEST_FNS.get(key);
      const dropped = lastDrop.get(key.split("/")[0]);
      if (def === undefined || dropped === undefined || dropped <= def.file) return [];
      return [`${key} - zdjęta w ${dropped}, po ostatniej definicji w ${def.file}`];
    });
  }

  it("obie funkcje ścieżki istnieją w stanie końcowym migracji - kanarek zasięgu", () => {
    // Bez tego przemianowanie funkcji (albo zmiana arności) robi z asercji niżej
    // pustą pętlę, która przechodzi, bo nie ma czego sprawdzić.
    const missing = PATH_FUNCTIONS.filter((key) => LATEST_FNS.get(key) === undefined);
    expect(missing).toEqual([]);
    // ...a bez tego kanarek byłby ślepy na `DROP FUNCTION` - patrz komentarz
    // nad `droppedAfterDefinition`.
    expect(droppedAfterDefinition()).toEqual([]);
  });

  it("obie funkcje ścieżki wiążą najemcę w rekurencji", () => {
    const offenders = PATH_FUNCTIONS.flatMap((key) => {
      const def = LATEST_FNS.get(key);
      if (def === undefined || bindsTenant(def.body)) return [];
      return [`${key} (${def.file}) - rekurencja bez predykatu najemcy`];
    });
    expect(offenders).toEqual([]);
  });

  it("pages.parent_id ma w stanie końcowym złożony klucz obcy tego samego najemcy", () => {
    // Lista wchodzi do KOMUNIKATU, nie do asercji: gdy test oblewa, `LIVE_FKS`
    // jest pusta, więc porównanie samej listy nie miałoby czego pokazać.
    // Komunikat mówi wtedy „BRAK" i to jest cała informacja, jakiej szuka
    // czytelnik - plus nazwy tych ograniczeń, które JEDNAK są.
    const declared = [...LIVE_FKS].map(([name, file]) => `${name} <- ${file}`);
    expect(
      declared.length,
      `żywe ograniczenia tego kształtu na pages.parent_id: ${declared.join(", ") || "BRAK"}`,
    ).toBeGreaterThan(0);
  });

  it("ograniczenie nosi nazwę, pod którą pytają o nie dowody wykonaniowe", () => {
    // `toContain`, nie `toEqual`: drugie, nadmiarowe ograniczenie tego kształtu
    // to bałagan schematu, a nie dziura izolacji - bramka od bezpieczeństwa nie
    // powinna z tego powodu oblewać.
    expect([...LIVE_FKS.keys()]).toContain(PARENT_TENANT_FK);
  });
});

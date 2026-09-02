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
// CZTERY GRANICE, NIE JEDNA. Filtr w zapytaniu to tylko pierwsza z nich, i sama
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
//      dlatego to KOD, nie komentarz, jest przypięty niżej;
//   4. ŚCIEŻKA KANONICZNA - adres wpisu składa RPC `page_full_path`
//      rekurencją w górę po `pages.parent_id`, czyli po wierszach, których
//      filtr z punktu 1 nie dotyka. Rodzic u obcego najemcy wnosi JEGO slug do
//      adresu przy idealnym filtrze, idealnym kluczu cache i właściwej
//      płaszczyźnie hosta. Granicę stawia tu SQL funkcji i ograniczenie
//      schematu - oba pilnowane w ostatnim bloku tego pliku.
//
// WYJĄTKI SĄ DECYZJĄ. Lista `EXEMPTIONS` niżej jest kluczowana parą
// plik+tabela, nie samą tabelą: zgoda na brak filtru dotyczy jednego miejsca,
// nie tabeli w całym repozytorium. Każdy wpis nosi uzasadnienie, a dwa testy
// pilnują higieny listy - wpis bez trafienia i wpis dla zapytania, które MA
// filtr, są błędem, bo martwy wyjątek to przyszła furtka.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

describe("adres kanoniczny wpisu - ścieżka rodzica sprawdza najemcę", () => {
  /**
   * CZWARTA GRANICA: ŚCIEŻKĘ KANONICZNĄ SKŁADA SQL, NIE TYPESCRIPT.
   * `fetchPagePaths` (publishedContent.server.ts:59) i `buildPagePaths`
   * (sitemapEntries.server.ts:60) filtrują `pages` po najemcy poprawnie - ale
   * pełną ścieżkę składa RPC `public.page_full_path(_page_id uuid)`:
   * rekurencyjne CTE idące w GÓRĘ po `pages.parent_id`. Filtr z zapytania
   * obejmuje więc wiersz STARTOWY, a nie łańcuch rodziców, który dokłada do
   * adresu kolejne slugi. Granicą jest tu treść funkcji, nie łańcuch `.eq()`.
   *
   * DLACZEGO RLS TEGO NIE DOMYKA. Funkcja jest `LANGUAGE sql STABLE`, czyli
   * SECURITY INVOKER - ale wołający to service_role z BYPASSRLS
   * (`sitemapEntries.server.ts:75`, `publishedContent.server.ts:73`), więc nad
   * rekurencją nie stoi ŻADNA polityka. To ta sama luka w rozumowaniu, którą
   * opisuje nagłówek tego pliku, o jedną warstwę niżej.
   *
   * ZASIĘG - UCZCIWIE, BO PIERWSZA WERSJA TEGO OPISU MYLIŁA SIĘ. Polityka
   * „Public reads published pages” NIE jest dziś tenant-ślepa: brzmi
   * `status = 'published' AND deleted_at IS NULL AND tenant_id = public_tenant_id()`,
   * więc pod JWT `anon`/`authenticated` rekurencja nie zobaczy wiersza rodzica
   * z obcego najemcy i łańcuch urwie się sam. Wyciek był realny na ścieżce
   * SERVICE-ROLE, a nie „wszędzie” - i dlatego pilnuje go TA bramka, która całą
   * tę płaszczyznę już opisuje. Zabezpieczenie oparte WYŁĄCZNIE na tym, że RLS
   * przypadkiem ukryje wiersz rodzica, jest zabezpieczeniem przez skutek
   * uboczny: funkcje mają `GRANT EXECUTE` dla `anon, authenticated,
   * service_role` i muszą bronić się same.
   *
   * CO BYŁO NA SZALI. Strona z `parent_id` wskazującym stronę innego najemcy
   * wnosiła JEGO slug do ścieżki kanonicznej publikowanej w sitemapie
   * (`sitemapEntries.server.ts`), w podglądzie SEO (`SeoPanel.tsx:131`) i na
   * liście zapisanych stron (`SavedSection.tsx:79`). Przecieka segment adresu,
   * nie wiersz - ale to ta sama klasa i ta sama powierzchnia, czytana
   * i cache'owana przez wyszukiwarki.
   *
   * CO GWARANTUJE NAPRAWA - migracja
   * `20260831160000_page_full_path_tenant_scope.sql` (bliźniak treści:
   * `20260831214637`, ten sam SQL bez komentarza). Zamyka dziurę DWOMA
   * niezależnymi warstwami, bo żadna osobno nie wystarcza:
   *   A. PREDYKAT NAJEMCY W CZŁONIE REKURENCYJNYM - `AND p.tenant_id =
   *      c.tenant_id`, SAMO-ZAKOTWICZONY w wierszu startowym (kotwica wnosi
   *      `tenant_id` do CTE), a NIE w sesji: `current_tenant_id()` byłoby tu
   *      błędem, bo spod service-role kontekst najemcy jest NULL i wtedy każda
   *      ścieżka wychodzi NULL-em - to zamiana cichego naruszenia izolacji na
   *      cichą awarię produkcyjną. Przy naruszeniu łańcuch urywa się na granicy
   *      najemcy, więc strona dostaje ścieżkę złożoną WYŁĄCZNIE z własnych
   *      segmentów. Ta warstwa chroni ODCZYT danych, które w bazie już są.
   *      Ten sam predykat dostał wariant WSADOWY `page_full_paths(uuid[])` -
   *      osobne znalezisko tamtej migracji, bo audyt nazywał tylko funkcję
   *      pojedynczą, a wsadowa stoi pod archiwami i wyszukiwarką, czyli pod
   *      WIĘKSZYM ruchem.
   *   B. OGRANICZENIE SCHEMATU: złożony klucz obcy
   *      `(parent_id, tenant_id) -> (id, tenant_id)`
   *      (`pages_parent_same_tenant_fkey`, poprzedzony
   *      `pages_id_tenant_id_key UNIQUE (id, tenant_id)`, bo FK potrzebuje
   *      UNIQUE po stronie referencowanej). Migracja założycielska
   *      (20260531223436) dawała `parent_id` wyłącznie
   *      `REFERENCES public.pages(id) ON DELETE RESTRICT` - nic nie
   *      przeszkadzało WYTWORZYĆ wiersza powodującego wyciek. Złożony FK
   *      pilnuje obu kierunków jedną deklaracją (zapis dziecka ORAZ zmiana
   *      `tenant_id` rodzica), robi to pod właściwą blokadą, nie da się go
   *      pominąć spod service-role i przeżywa dump/restore.
   *
   * DLACZEGO OSOBNE PRZYPADKI, A NIE ALTERNATYWA. Poprzednia wersja tej bramki
   * sprawdzała `rpcBindsTenant || parentSameTenantConstraint` jednym `expect`.
   * Alternatywa przechodzi, gdy JEDNA z warstw zniknie - czyli milczy dokładnie
   * w chwili regresu, na który jest postawiona. Każda warstwa ma tu więc własny
   * przypadek i pada osobno.
   *
   * CZEGO NIE DUBLUJE. `supabase/tests/page_full_path_tenant_scope_test.sql`
   * (14 asercji, w tym odczyt po `DROP CONSTRAINT`) dowodzi ZACHOWANIA obu
   * warstw na prawdziwej bazie - ale wymaga `supabase test db` i nie biegnie
   * w suicie vitesta. Ta bramka czyta KATALOG MIGRACJI i pilnuje, że mechanizm
   * jest wciąż ZADEKLAROWANY: definicja funkcji bez predykatu albo migracja
   * zdejmująca klucz obcy zapala czerwone bez żadnej bazy.
   */
  const MIGRATIONS_DIR = "supabase/migrations";

  /**
   * Wersja migracji naprawczej. Definicji ZAŁOŻYCIELSKIEJ (20260531223436) nie
   * wolno wymagać predykatu - historii migracji się nie przepisuje. Znaczenie
   * dla stanu bazy po odtworzeniu katalogu ma to, co jest OD naprawy w górę:
   * żadna z tych migracji nie może wytworzyć funkcji bez granicy najemcy,
   * a ostatnia definicja - ta, która wygrywa po replayu - jest w tym zbiorze.
   */
  const FIX_VERSION = "20260831160000";

  const SITEMAP_ENTRIES = "src/lib/server/sitemapEntries.server.ts";

  /** Definicja funkcji ścieżki, rozłożona na członów rekurencji. */
  interface PathFunctionDef {
    readonly file: string;
    readonly fn: string;
    /** Człon kotwiczący: wiersz startowy rekurencji (przed `UNION ALL`). */
    readonly anchor: string;
    /** Człon rekurencyjny: skok do rodzica (od `UNION ALL`). */
    readonly recursive: string;
    readonly body: string;
  }

  /**
   * Ciała `public.page_full_path(...)` i `public.page_full_paths(...)`
   * z migracji od naprawczej w górę. Ciałem jest tekst między `AS $$` i `$$;`,
   * więc bloki `DO $$ ... $$;` tej samej migracji nie wchodzą w dopasowanie.
   */
  function pathFunctionDefs(): PathFunctionDef[] {
    const out: PathFunctionDef[] = [];
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= FIX_VERSION)
      .sort();
    for (const name of files) {
      const sql = read(`${MIGRATIONS_DIR}/${name}`);
      const re =
        /CREATE OR REPLACE FUNCTION public\.(page_full_paths?)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g;
      for (const m of sql.matchAll(re)) {
        const body = m[2];
        const cut = body.indexOf("UNION ALL");
        out.push({
          file: `${MIGRATIONS_DIR}/${name}`,
          fn: m[1],
          anchor: cut === -1 ? body : body.slice(0, cut),
          recursive: cut === -1 ? "" : body.slice(cut),
          body,
        });
      }
    }
    return out;
  }

  /** Migracje od naprawczej w górę - surowy SQL, do skanu ograniczeń. */
  function migrationsSinceFix(): Array<{ file: string; sql: string }> {
    return readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= FIX_VERSION)
      .sort()
      .map((f) => ({ file: `${MIGRATIONS_DIR}/${f}`, sql: read(`${MIGRATIONS_DIR}/${f}`) }));
  }

  const defs = pathFunctionDefs();

  /**
   * Granica najemcy w rekurencji: rodzic musi siedzieć w tym samym najemcy co
   * dziecko. Aliasy jak w migracji - `p` to wiersz rodzica, `c` to CTE `chain`,
   * czyli wiersz, z którego skaczemy.
   */
  const SELF_ANCHORED_PREDICATE = /\bp\.tenant_id\s*=\s*c\.tenant_id\b/;

  function predicateOffenders(fn: string): string[] {
    return defs
      .filter((d) => d.fn === fn && !SELF_ANCHORED_PREDICATE.test(d.recursive))
      .map(
        (d) =>
          `${d.file} - public.${d.fn}: człon rekurencyjny bez predykatu p.tenant_id = c.tenant_id`,
      );
  }

  it("kanarek zasięgu: obie funkcje ścieżki mają definicję po migracji naprawczej", () => {
    // Bez tego cały blok przechodzi PUSTY: dość zmienić `AS $$` na
    // `AS $function$`, żeby `defs` wyszło zerowe - a filtr po pustym zbiorze
    // nie ma czego złapać. Sygnał jest POZYTYWNY (definicja znaleziona
    // i rozłożona na członów), nie negatywny („brak zgłoszeń”).
    expect(defs.filter((d) => d.fn === "page_full_path").length).toBeGreaterThanOrEqual(1);
    expect(defs.filter((d) => d.fn === "page_full_paths").length).toBeGreaterThanOrEqual(1);
    // Rozbiór na członów musi się udać, inaczej predykatu szukalibyśmy w całym
    // ciele - a `tenant_id` stoi tam też w kotwicy i w liście SELECT.
    expect(defs.filter((d) => d.recursive === "").map((d) => `${d.fn} @ ${d.file}`)).toEqual([]);
  });

  it("page_full_path wiąże najemcę w członie rekurencyjnym", () => {
    // WARSTWA A dla wariantu pojedynczego - tego, który woła sitemapa
    // (`sitemapEntries.server.ts:75`) i czytnik feedów
    // (`publishedContent.server.ts:73`). Bez tego predykatu skok do rodzica
    // przechodzi granicę najemcy i wnosi obcy slug do adresu kanonicznego.
    expect(predicateOffenders("page_full_path")).toEqual([]);
  });

  it("page_full_paths - wariant wsadowy ma ten sam predykat, nie słabszy", () => {
    // Osobny przypadek, bo to osobna funkcja i osobne znalezisko: audyt nazywał
    // tylko wariant pojedynczy, a wsadowy powtarzał tę samą rekurencję i stoi
    // pod archiwami oraz wyszukiwarką. Naprawa jednej bez drugiej zostawia
    // dziurę na ścieżce o WIĘKSZYM ruchu.
    expect(predicateOffenders("page_full_paths")).toEqual([]);
  });

  it("predykat jest zakotwiczony w wierszu startowym, nie w sesji", () => {
    // Zakotwiczenie decyduje, czy naprawa w ogóle działa spod service-role.
    // `current_tenant_id()` jest tam NULL-em, więc filtr po sesji wywróciłby
    // KAŻDĄ ścieżkę do NULL-a - to nie wariant tej samej naprawy, tylko zamiana
    // cichego naruszenia izolacji na cichą awarię produkcyjną. Warunkiem
    // samo-zakotwiczenia jest `tenant_id` wniesiony do CTE przez kotwicę: bez
    // niego nie istnieje `c.tenant_id`, z którym porównuje się rodzica.
    const offenders: string[] = [];
    for (const d of defs) {
      if (!/\btenant_id\b/.test(d.anchor)) {
        offenders.push(
          `${d.file} - public.${d.fn}: kotwica rekurencji nie wnosi tenant_id do CTE`,
        );
      }
      if (/\bcurrent_tenant_id\s*\(/.test(d.body)) {
        offenders.push(
          `${d.file} - public.${d.fn}: najemca z sesji (current_tenant_id) zamiast z wiersza startowego`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pages.parent_id ma ograniczenie tego samego najemcy i nikt go nie zdejmuje", () => {
    // WARSTWA B, niezależna od A: A chroni ODCZYT danych, które już są,
    // B nie pozwala ich WYTWORZYĆ. Ten przypadek pada osobno właśnie po to,
    // żeby zniknięcie jednej warstwy nie schowało się za drugą.
    const migrations = migrationsSinceFix();

    // Para kolumn po OBU stronach - to jest cała różnica wobec założycielskiego
    // `parent_id -> pages(id)`, który o najemcy nie mówi nic.
    const COMPOSITE_FK =
      /ADD CONSTRAINT\s+pages_parent_same_tenant_fkey\s+FOREIGN KEY\s*\(\s*parent_id\s*,\s*tenant_id\s*\)\s*REFERENCES\s+public\.pages\s*\(\s*id\s*,\s*tenant_id\s*\)/i;
    // Warunek wstępny złożonego FK: UNIQUE po stronie referencowanej. Bez niego
    // Postgres odrzuca `ADD CONSTRAINT`, czyli migracja przestaje się odtwarzać.
    const UNIQUE_SIDE =
      /ADD CONSTRAINT\s+pages_id_tenant_id_key\s+UNIQUE\s*\(\s*id\s*,\s*tenant_id\s*\)/i;

    expect(migrations.filter((m) => COMPOSITE_FK.test(m.sql)).length).toBeGreaterThanOrEqual(1);
    expect(migrations.filter((m) => UNIQUE_SIDE.test(m.sql)).length).toBeGreaterThanOrEqual(1);

    const offenders: string[] = [];
    for (const { file, sql } of migrations) {
      // `NOT VALID` pilnuje wyłącznie NOWYCH zapisów, a istniejące naruszenia
      // zostawia w bazie - czyli dokładnie te wiersze, które już wnoszą obcy
      // slug do sitemapy. Migracja świadomie ich nie zostawia (odczepia stronę
      // od obcego rodzica), więc `NOT VALID` byłoby cofnięciem połowy naprawy.
      const statement = /ADD CONSTRAINT\s+pages_parent_same_tenant_fkey[^;]*/i.exec(sql);
      if (statement !== null && /NOT VALID/i.test(statement[0])) {
        offenders.push(
          `${file} - pages_parent_same_tenant_fkey jako NOT VALID: istniejące naruszenia zostają w bazie`,
        );
      }
      if (/DROP CONSTRAINT[^;]*pages_parent_same_tenant_fkey/i.test(sql)) {
        offenders.push(`${file} - migracja zdejmuje pages_parent_same_tenant_fkey`);
      }
      if (/DROP CONSTRAINT[^;]*pages_id_tenant_id_key/i.test(sql)) {
        offenders.push(
          `${file} - migracja zdejmuje pages_id_tenant_id_key, czyli stronę referencowaną złożonego FK`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("kanoniczną ścieżkę woła sitemapa spod klienta service-role - kanarek zakresu", () => {
    // PO CO TEN PRZYPADEK. Oba dowody wyżej mają wartość tylko o tyle, o ile
    // ta funkcja jest naprawdę wołana spod service-role z powierzchni crawlera.
    // Gdyby wołanie przeniosło się gdzie indziej albo doszła DRUGA taka
    // powierzchnia, uzasadnienie tego bloku przestałoby opisywać kod, a bramka
    // pilnowałaby migracji „na wszelki wypadek”. Lista jest samokalibrująca:
    // skanujemy tę samą płaszczyznę co reszta pliku i wymagamy zgodności.
    const RPC_CALL = /\.rpc\(\s*"(?:page_full_paths?)"/;
    const callers = serverSources()
      .filter((s) => RPC_CALL.test(maskComments(s.source)))
      .map((s) => s.file);
    expect(callers).toEqual([PUBLISHED, SITEMAP_ENTRIES]);

    // Sygnał POZYTYWNY: wołanie stoi tam, gdzie mówi opis, i idzie przez
    // wstrzyknięty klient `admin`, a nie przez klient przeglądarki.
    const sitemap = read(SITEMAP_ENTRIES);
    expect(sitemap).toMatch(/admin\.rpc\(\s*"page_full_path"/);
    expect(sitemap).not.toMatch(/from "@\/integrations\/supabase\/client"/);

    // PROWENIENCJA UPRAWNIEŃ JEST W TRASACH, nie w kolektorze:
    // `sitemapEntries.server.ts` przyjmuje klient parametrem (`admin: DbClient`),
    // więc sam z siebie nie mówi, jakimi uprawnieniami idzie zapytanie - i tym
    // samym nie trafia do SERVICE_ROLE_READERS wyżej (skan szuka `supabaseAdmin`).
    // Dowód domyka się dopiero na trasach: to one wstrzykują klient service-role.
    const offenders: string[] = [];
    for (const file of ["src/routes/sitemap[.]xml.ts", "src/routes/sitemaps.$section.ts"]) {
      const source = maskComments(read(file));
      if (
        !/supabaseAdmin\s*\}\s*=\s*await import\("@\/integrations\/supabase\/client\.server"\)/.test(
          source,
        )
      ) {
        offenders.push(`${file} - nie bierze klienta service-role z client.server`);
      }
      if (!/collect(?:All)?Sitemap\w*\(\s*supabaseAdmin\b/.test(source)) {
        offenders.push(`${file} - nie podaje supabaseAdmin kolektorowi sitemapy`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

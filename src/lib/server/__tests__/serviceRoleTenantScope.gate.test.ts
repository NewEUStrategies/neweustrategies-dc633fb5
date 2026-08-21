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

describe("adres kanoniczny wpisu - ścieżka rodzica nie sprawdza najemcy", () => {
  /**
   * DEFEKT ZGŁOSZONY, NIE NAPRAWIONY. `fetchPagePaths` (publishedContent
   * .server.ts:59) filtruje `pages` po najemcy poprawnie, ale pełną ścieżkę
   * składa RPC `public.page_full_path(_page_id uuid)`
   * (migracja 20260531223436, linie 52-66): rekurencyjne CTE idące w GÓRĘ po
   * `pages.parent_id`, BEZ predykatu najemcy, `LANGUAGE sql STABLE` (czyli
   * SECURITY INVOKER - wołane spod service-role nie ma nad sobą RLS).
   *
   * Schemat tego nie domyka: `pages.parent_id` ma wyłącznie
   * `REFERENCES public.pages(id) ON DELETE RESTRICT` - żadnego CHECK-a ani
   * triggera „ten sam najemca", a `uniq_pages_tenant_parent_slug` pilnuje
   * unikalności slugu, nie zgodności najemcy. Żaden plik pgTAP nie wspomina
   * `page_full_path`.
   *
   * KONSEKWENCJA: strona z `parent_id` wskazującym stronę innego najemcy
   * wnosi JEGO slug do ścieżki kanonicznej publikowanej w sitemapie i RSS-ie -
   * na tej samej powierzchni, którą chroni cała reszta tego pliku.
   * Skala mniejsza niż wyciek treści (przecieka segment adresu, nie wiersz),
   * ale to ta sama klasa i ta sama powierzchnia.
   *
   * Naprawa to migracja schematu - decyzja dla człowieka, nie dla testu,
   * dlatego `it.fails` z opisem zamiast zmiany zachowania produkcyjnego.
   */
  it.fails(
    "page_full_path wiąże najemcę albo pages.parent_id ma ograniczenie tego samego najemcy",
    () => {
      const migrations = readdirSync("supabase/migrations")
        .filter((f) => f.endsWith(".sql"))
        .map((f) => read(`supabase/migrations/${f}`));

      const rpcBindsTenant = migrations.some((sql) => {
        const m = /CREATE OR REPLACE FUNCTION public\.page_full_path\(([\s\S]*?)\$\$;/.exec(sql);
        return m !== null && /tenant_id/.test(m[1]);
      });

      const parentSameTenantConstraint = migrations.some((sql) =>
        /(CHECK[\s\S]{0,200}parent_id[\s\S]{0,200}tenant_id)|(TRIGGER[\s\S]{0,200}pages[\s\S]{0,300}parent[\s\S]{0,200}tenant)/i.test(
          sql,
        ),
      );

      expect({ rpcBindsTenant, parentSameTenantConstraint }).toEqual({
        rpcBindsTenant: true,
        parentSameTenantConstraint: true,
      });
    },
  );
});

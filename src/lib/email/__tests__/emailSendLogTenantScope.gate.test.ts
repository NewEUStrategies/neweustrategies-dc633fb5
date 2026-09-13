// Bramka: DZIENNIK WYSYŁEK NIE WYCHODZI POZA GRANICĘ NAJEMCY.
//
// ── CO TO ZA RYZYKO ────────────────────────────────────────────────────────
// `public.email_send_log` jest jedynym zapisem tego, co platforma faktycznie
// wysłała, i niesie ADRESY ODBIORCÓW oraz dosłowną treść błędów dostawcy. Jego
// RLS (20260728154925) dopuszcza wyłącznie `service_role`, czyli dla każdego
// realnego czytnika polityka nie stawia ŻADNEJ granicy - oba panele idą
// klientem serwisowym, który RLS omija z definicji. Bramka przed handlerem
// sprawdzała rolę, a rola nie jest granicą danych: administrator serwisu A
// czytał korespondencję serwisu B. Jedyną zaporą jest filtr wpisany ręcznie
// w zapytaniu - i dlatego to jest bramka, a nie ostrzeżenie.
//
// ── DLACZEGO SZEROKA BRAMKA TEGO NIE ZŁAPAŁA ───────────────────────────────
// `email_send_log` NIE JEST NA ŻADNEJ LIŚCIE WYJĄTKÓW. Mapa EXEMPTIONS
// w `src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` ma sześć
// wpisów i żaden nie dotyczy poczty. To było pudło ZASIĘGU SKANU, nie udzielona
// zgoda: `serverSources()` (tamże, ~:83) robi dwa NIEREKURENCYJNE `readdirSync`
// - `src/lib/server/*.server.ts` i `src/lib/*.server.ts`. `src/lib/email/**`,
// `src/lib/admin/**` i `src/routes/**` leżą poza nim w całości.
//
// Rozszerzenie tamtego skanu wciągnęłoby naraz setki zapytań i wymusiło rozrost
// przypiętej listy `SERVICE_ROLE_READERS` o dziesiątki pozycji - to migracja
// całej powierzchni admina, nie naprawa tego wycieku. Ta bramka jest wąska:
// bierze TEN SAM analizator (`@/lib/ci/serviceRoleTenantScope`) i kieruje go na
// sześć plików, które dotykają tej jednej tabeli.
//
// ── DLACZEGO ASERCJA JEST STATYCZNA, A NIE INTEGRACYJNA ────────────────────
// Dowód integracyjny wymagałby dwóch najemców i prawdziwego Postgresa; w vitest
// jest nieosiągalny, a w pgTAP nie ma czego sprawdzać, bo tabela nie ma
// polityki użytkownika - defekt leży w tym, czego TypeScript NIE dopisał do
// zapytania. Migracja nie dostaje więc pliku pgTAP; zamiast tego ostatni blok
// niżej czyta jej DDL, bo to jedyna połowa, której skaner TypeScriptu nie widzi.
// (Runtime'owy dowód triggera należałby do `scripts/tenant-isolation-harness`.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { tableQueries, type TableQuery } from "@/lib/ci/serviceRoleTenantScope";
import { MIGRATIONS_DIR, stripSqlComments } from "../../../../scripts/lib/sqlMigrations";

const TABLE = "email_send_log";

/**
 * REJESTR PLIKÓW DOTYKAJĄCYCH DZIENNIKA. Przypięty W OBIE STRONY: plik, który
 * przestał czytać tabelę, ma zniknąć z listy, a plik, który zaczyna ją czytać,
 * ma być dopisany ŚWIADOMIE - i to dopisanie jest momentem, w którym ktoś
 * decyduje o zakresie najemcy dla nowego zapytania.
 */
const TOUCHING_FILES = [
  "src/lib/admin/emailOutbox.functions.ts",
  "src/lib/email/queueDrain.server.ts",
  "src/lib/email/system-log.server.ts",
  "src/lib/email/transactional.server.ts",
  "src/routes/platform/email/auth/webhook.ts",
  "src/routes/platform/email/transactional/send.ts",
] as const;

/**
 * Zapytania świadomie bez filtru najemcy - trzy, wszystkie tej samej klasy.
 *
 * Kluczem jest `plik::funkcja`, nie `plik::tabela`: w jednym pliku sąsiadują
 * zapytania z filtrem i bez niego, więc zgoda musi dotyczyć JEDNEJ funkcji.
 * Nie numer linii - ten przesuwa każdy dopisany komentarz, a wpis, który
 * odpada od cudzej edycji, uczy obchodzić bramkę zamiast jej słuchać.
 *
 * UZASADNIENIE, wspólne dla całej trójki: wszystkie trzy kluczują po
 * `message_id`, czyli deterministycznym UUID-zie wyliczonym z SHA-256 klucza
 * idempotencji - globalnie unikatowym. Są wewnętrzne dla workera i nie oddają
 * człowiekowi żadnej treści (zwracają `id` albo licznik). Predykat po najemcy
 * dałby CHWILOWEMU rozjazdowi rozstrzygnięcia tenanta moc obejścia
 * zabezpieczenia przed podwójną wysyłką - a za nim stoi unikalny indeks
 * `idx_email_send_log_message_sent_unique`. Byłby więc ściśle gorszy niż brak.
 */
const EXEMPTIONS: Readonly<Record<string, string>> = {
  "src/lib/email/transactional.server.ts::alreadyHandled":
    "klucz message_id (deterministyczny, globalnie unikatowy); sprawdzenie duplikatu przed wysyłką, zwraca samo id",
  "src/lib/email/queueDrain.server.ts::loadFailedAttempts":
    "klucz message_id; licznik nieudanych prób dla budżetu ponowień, nie treść dla człowieka",
  "src/lib/email/queueDrain.server.ts::alreadySent":
    "klucz message_id; zabezpieczenie przed podwójną wysyłką wsparte unikalnym indeksem - filtr najemcy by je osłabił",
};

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Nazwa funkcji otaczającej zapytanie - najbliższa deklaracja `function` nad
 * jego linią. Zapytania w handlerach tras (funkcje strzałkowe) nie mają takiej
 * deklaracji i dostają pusty klucz; żadne z nich nie jest zwolnione, więc to
 * nie osłabia listy wyjątków.
 */
function enclosingFunction(source: string, line: number): string {
  const lines = source.split("\n").slice(0, line);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/.exec(lines[i]);
    if (match) return match[1];
  }
  return "";
}

function exemptionKey(query: TableQuery, source: string): string {
  return `${query.file}::${enclosingFunction(source, query.line)}`;
}

interface Scanned {
  readonly query: TableQuery;
  readonly key: string;
}

/** Wszystkie zapytania do dziennika z przypiętych plików, z kluczem wyjątku. */
function logQueries(): Scanned[] {
  const out: Scanned[] = [];
  for (const file of TOUCHING_FILES) {
    const source = read(file);
    for (const query of tableQueries({ file, source })) {
      if (query.table !== TABLE) continue;
      out.push({ query, key: exemptionKey(query, source) });
    }
  }
  return out;
}

/** Pliki źródłowe repo (bez testów) - do sprawdzenia, czy rejestr jest pełny. */
function sourceFilesTouchingLog(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(name) || /\.(test|spec)\.tsx?$/.test(name) || name.startsWith("-"))
        continue;
      if (read(path).includes(`from("${TABLE}")`)) found.push(path);
    }
  };
  walk("src");
  return found.sort();
}

describe("dziennik wysyłek - granica najemcy w kodzie", () => {
  const scanned = logQueries();

  it("skan realnie widzi zapytania - kanarek zasięgu", () => {
    // Zmierzone dziś: 20 zapytań do dziennika, 17 z granicą najemcy. Bez tego
    // przypadku zmiana nazwy tabeli albo refaktor łańcucha zostawia bramkę
    // pustą i ZIELONĄ - czyli w najgorszym możliwym stanie.
    expect(scanned.length).toBeGreaterThanOrEqual(20);
    expect(scanned.filter((s) => s.query.verdict === "SCOPED").length).toBeGreaterThanOrEqual(15);
  });

  it("rejestr plików dotykających dziennika zgadza się z kodem", () => {
    const found = sourceFilesTouchingLog();
    // Kanarek PRZED porównaniem: pusty skan zrównałby się z pustym rejestrem
    // i bramka byłaby zielona dokładnie wtedy, gdy przestała cokolwiek widzieć.
    expect(found.length).toBeGreaterThan(0);
    expect(found).toEqual([...TOUCHING_FILES]);
  });

  it("każde zapytanie do dziennika ma granicę najemcy albo jawny wyjątek", () => {
    const gaps = scanned
      .filter((s) => s.query.verdict === "UNSCOPED" && !(s.key in EXEMPTIONS))
      .map((s) => `${s.query.file}:${s.query.line} from("${TABLE}") - brak granicy najemcy`);

    expect(gaps).toEqual([]);
    // Pusta lista luk znaczy coś TYLKO wtedy, gdy klasyfikator w ogóle działa:
    // skaner, który nie rozpoznaje już żadnego filtru, też oddaje zero luk.
    expect(scanned.some((s) => s.query.verdict === "SCOPED")).toBe(true);
  });

  it("lista wyjątków nie zawiera wpisów bez trafienia", () => {
    // Martwy wyjątek to przyszła furtka: nazwa zostaje, a wraz z nią zgoda na
    // brak filtru dla miejsca, którego już nikt nie pamięta.
    const seen = new Set(scanned.map((s) => s.key));
    expect(Object.keys(EXEMPTIONS).filter((key) => !seen.has(key))).toEqual([]);
  });

  it("lista wyjątków nie zwalnia zapytań, które MAJĄ filtr", () => {
    const redundant = scanned
      .filter((s) => s.query.verdict === "SCOPED" && s.key in EXEMPTIONS)
      .map((s) => s.key);

    expect([...new Set(redundant)]).toEqual([]);
    // Rejestr wyjątków ma być MAŁY - rozrost jest sygnałem, że bramkę obchodzi
    // się wpisem zamiast filtrem.
    expect(Object.keys(EXEMPTIONS).length).toBeLessThanOrEqual(5);
  });

  it("KAŻDY zapis do dziennika wnosi najemcę ładunkiem", () => {
    // Dwie z sześciu tras budują klient BEZ typów schematu
    // (`createClient` bez `<Database>`), więc brak klucza `tenant_id` nigdy nie
    // zapali się w kompilacji. Ta asercja jest jedyną rzeczą, która trzyma tam
    // linię - i celowo patrzy na literał przekazany do `.insert(`, a nie na
    // cały łańcuch.
    const unstamped: string[] = [];
    for (const { query } of scanned) {
      const payload = /\.insert\(\s*\{([\s\S]*?)\n\s*\}\)/.exec(query.body);
      if (!payload) continue;
      if (!/\btenant_id\s*:/.test(payload[1])) {
        unstamped.push(`${query.file}:${query.line} insert bez tenant_id`);
      }
    }

    expect(unstamped).toEqual([]);
  });
});

describe("dziennik wysyłek - granica najemcy w schemacie", () => {
  /** Migracje w kolejności stosowania - o stanie końcowym decyduje ostatnia. */
  function migrations(): { file: string; sql: string }[] {
    return readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => ({
        file: name,
        sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, name), "utf8")),
      }));
  }

  const all = migrations();

  it("tabela ma kolumnę tenant_id dodaną migracją", () => {
    // Połowa dowodu, której skaner TypeScriptu nie widzi: filtr `.eq` bez
    // kolumny to błąd wykonania, nie kompilacji.
    const adds = all.filter((m) =>
      /ALTER TABLE\s+(?:IF EXISTS\s+)?public\.email_send_log[\s\S]*?ADD COLUMN\s+(?:IF NOT EXISTS\s+)?tenant_id/i.test(
        m.sql,
      ),
    );

    expect(adds.length).toBeGreaterThanOrEqual(1);
    // Przypięte do KONKRETNEJ migracji: gdyby kolumnę dołożyła kiedyś inna,
    // rozejście się obu pasów byłoby widać tutaj, a nie dopiero na produkcji.
    expect(adds.some((m) => m.file.includes("email_send_log_tenant_scope"))).toBe(true);
  });

  it("kolumna jest NOT NULL - wiersz bez najemcy nie ma prawa powstać", () => {
    const notNull = all.filter((m) =>
      /ALTER TABLE\s+public\.email_send_log\s+ALTER COLUMN\s+tenant_id\s+SET NOT NULL/i.test(m.sql),
    );

    expect(notNull.length).toBeGreaterThanOrEqual(1);
    // NOT NULL musi stać W TEJ SAMEJ migracji co backfill - inaczej wdrożenie
    // przewraca się na istniejących wierszach bez najemcy.
    expect(notNull.some((m) => /UPDATE\s+public\.email_send_log/i.test(m.sql))).toBe(true);
  });

  it("trigger dopina najemcę, bo sam DEFAULT by nie wystarczył", () => {
    // DEFAULT odpala się WYŁĄCZNIE przy POMINIĘTEJ kolumnie, a PostgREST wysyła
    // jawny `null` dla każdego klucza obecnego w ładunku. Bez triggera nadawca,
    // któremu rozstrzygnięcie tenanta się nie powiodło, wywracałby INSERT na
    // ograniczeniu NOT NULL - już PO tym, jak mail wyszedł.
    const withTrigger = all.filter((m) =>
      /CREATE TRIGGER\s+trg_email_send_log_bind_tenant[\s\S]*?ON\s+public\.email_send_log/i.test(
        m.sql,
      ),
    );

    expect(withTrigger.length).toBeGreaterThanOrEqual(1);
    expect(
      all.some((m) =>
        /CREATE OR REPLACE FUNCTION\s+public\.tg_email_send_log_bind_tenant/i.test(m.sql),
      ),
    ).toBe(true);
  });

  it("odczyt po najemcy ma indeks, a nie skan całego dziennika", () => {
    expect(
      all.some((m) =>
        /CREATE INDEX[\s\S]*?ON\s+public\.email_send_log\s*\(\s*tenant_id\s*,/i.test(m.sql),
      ),
    ).toBe(true);
    // Indeks musi zaczynać się od `tenant_id`, bo KAŻDY odczyt panelu filtruje
    // najpierw po najemcy, a dopiero potem po czasie. Odwrotna kolejność kolumn
    // daje indeks, którego ten filtr nie użyje.
    expect(
      all.some((m) => /ON\s+public\.email_send_log\s*\(\s*tenant_id\s*,\s*created_at/i.test(m.sql)),
    ).toBe(true);
  });
});

// Inwariant CI: ZAPYTANIE SERVICE-ROLE MUSI SAMO POWIEDZIEĆ, PO CZYIM NAJEMCY IDZIE.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// Klient `supabaseAdmin` (`src/integrations/supabase/client.server.ts`) jest
// tworzony kluczem service-role i - jak mówi jego własny nagłówek - „bypasses
// RLS". Dla zapytania spod tego klienta RLS NIE ISTNIEJE: polityka tenanta,
// która chroni każdy odczyt z przeglądarki, jest tu wyłączona. Jedyną zaporą
// zostaje jawny filtr napisany ręcznie w łańcuchu wywołań.
//
// Cena pomyłki nie jest funkcjonalna. Nagłówek `publishedContent.server.ts`
// stawia ją wprost: „Without the explicit filter a second tenant's content
// would leak into another site's sitemap/RSS/llms.txt." Czyli powierzchnie,
// które czyta Google - i które cache'uje po swojej stronie na długo po tym,
// jak defekt zostanie naprawiony.
//
// Dopisanie 28. zapytania do tego pliku to jedna linia. Brak w niej
// `.eq("tenant_id", tenantId)` NIE daje ani błędu typów (kolumna jest
// opcjonalna w filtrze), ani czerwonego testu (żaden test nie ma dwóch
// najemców z treścią), ani ostrzeżenia lintera. Daje sitemapę, w której obok
// adresów jednego serwisu stoją adresy drugiego.
//
// ── DLACZEGO ASERCJA JEST STATYCZNA, A NIE INTEGRACYJNA ────────────────────
// Dowód integracyjny wymagałby dwóch najemców z treścią w kilkunastu tabelach,
// dwóch hostów i prawdziwej bazy - w vitest niewykonalny, a w pgTAP nie ma
// czego sprawdzać, bo defekt nie leży w SQL-u ani w politykach, tylko w tym,
// czego kod TypeScriptu NIE dopisał do zapytania. Ta bramka czyta KOD i wymaga,
// żeby każde zapytanie samo mówiło, po czyich danych chodzi - czyli przenosi
// dowód z czasu wykonania do czasu review.
//
// ── CZEGO NIE DUBLUJE ──────────────────────────────────────────────────────
// `check:sql-tenant-scope` i `check:sql-owner-tenant-scope` czytają WYŁĄCZNIE
// SQL: ciała funkcji `SECURITY DEFINER` i predykaty polityk RLS. Żaden z nich
// nie widzi ani jednej linii TypeScriptu, a service role omija dokładnie tę
// warstwę, którą one badają. pgTAP (17 plików o izolacji najemcy) dowodzi, że
// polityki działają - co dla zapytania spod service-role jest bez znaczenia.
// Ta bramka pokrywa jedyną warstwę, której nie pokrywa nic innego: zapytania
// TypeScriptu wykonywane z pominięciem RLS.
//
// ── ANALIZA SCHODZI DO POJEDYNCZEGO ŁAŃCUCHA ───────────────────────────────
// Granicą najemcy jest ogniwo w łańcuchu, nie plik i nie funkcja. Plik,
// w którym 26 zapytań filtruje po najemcy, a 27. nie, wygląda przy przeglądzie
// jak plik poprawny - dlatego jednostką analizy jest jedno `.from(...)` wraz
// z tekstem do następnego zapytania.
//
// Moduł jest CZYSTY: I/O (odczyt plików) dokłada bramka
// `src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts`.
import { maskComments } from "./i18nKeyUsage";

/** Plik źródłowy podany do analizy. */
export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

/**
 * Jedyna kanoniczna kolumna najemcy w tym schemacie. Skan migracji
 * (2026-08-21) pokazuje `tenant_id` w 218 z 249 tabel `public` i WSZYSTKIE 276
 * wystąpień `REFERENCES public.tenants(id)` wiszą na tej nazwie - nie ma
 * drugiego wariantu (`site_id`, `organization_id` znaczą co innego).
 */
export const TENANT_COLUMN = "tenant_id";

/** Werdykt dla jednego zapytania. */
export type TenantScopeVerdict = "SCOPED" | "UNSCOPED";

/** Jedno zapytanie do tabeli, wraz z ogniwami do następnego zapytania. */
export interface TableQuery {
  readonly file: string;
  readonly table: string;
  /** Numer linii wywołania `.from("...")` - raport ma prowadzić wprost do miejsca. */
  readonly line: number;
  /** Tekst łańcucha od `.from(...)` do następnego zapytania w pliku. */
  readonly body: string;
  readonly verdict: TenantScopeVerdict;
  /** Dosłowny fragment filtru, który zdecydował o werdykcie SCOPED. */
  readonly evidence: string | null;
}

/** Wywołanie RPC - funkcja SQL wołana spod service-role. */
export interface RpcCall {
  readonly file: string;
  readonly fn: string;
  readonly line: number;
  /** Czy w argumentach RPC przekazano najemcę (`p_tenant_id`, `_tenant_id`, …). */
  readonly passesTenant: boolean;
}

/**
 * Sposób, w jaki plik zdobywa klienta service-role. W tym repo zawsze przez
 * dynamiczny import - statyczna krawędź wciągnęłaby klucz service-role do
 * grafu modułów przeglądarki.
 */
const SERVICE_ROLE_RE = /\bsupabaseAdmin\b/;

/**
 * `.from(` liczone razem z poprzedzającym ogniwem, żeby dało się odsiać
 * `admin.storage.from("media")` - to jest KUBEŁEK STORAGE, nie tabela: nie ma
 * kolumn, nie przyjmuje `.eq()` i nie podlega temu inwariantowi (zakres
 * najemcy realizuje tam prefiks ścieżki obiektu). Bez tego odsiewu bramka
 * zgłaszałaby trzy nieistniejące luki w `wp-media.server.ts`.
 */
const FROM_CALL_SRC = '(\\.storage)?\\s*\\.from\\(\\s*"([a-z0-9_]+)"\\s*\\)';

/** `.rpc("nazwa"` - druga droga do danych spod service-role. */
const RPC_CALL_SRC = '\\.rpc\\(\\s*"([a-z0-9_]+)"';

/** Argument RPC nazwany po najemcy: `p_tenant_id`, `_tenant_id`, `tenant_id`. */
const RPC_TENANT_ARG_RE = /\b_?p?_?tenant_id\s*:/;

/**
 * Wyrażenie, które wolno uznać za „wartość najemcy". Sama obecność kolumny nie
 * wystarcza: `.eq("tenant_id", row.tenant_id)` porównuje wiersz z samym sobą
 * i nie jest granicą, więc wymagamy identyfikatora, który MÓWI o najemcy
 * (`tenantId`, `opts.tenantId`, `input.tenantId`, `report.tenantId ?? …`).
 */
const TENANT_VALUE_RE = /\btenantId\b/;

/**
 * Filtry uznawane za jawną granicę najemcy. `update`/`delete` używają `.eq`,
 * `insert`/`upsert` wnoszą najemcę ŁADUNKIEM (`tenant_id: opts.tenantId`) -
 * dla nich `.eq` nie istnieje, więc obie formy muszą być zaakceptowane, inaczej
 * bramka wymagałaby filtru tam, gdzie nie ma czego filtrować.
 */
function tenantEvidence(body: string): string | null {
  const patterns: readonly RegExp[] = [
    // .eq("tenant_id", tenantId) — najczęstsza forma odczytu.
    new RegExp(`\\.eq\\(\\s*"${TENANT_COLUMN}"\\s*,\\s*([^)]+)\\)`),
    // .in("tenant_id", [tenantId]) — odczyt wielu najemców naraz (raporty).
    new RegExp(`\\.in\\(\\s*"${TENANT_COLUMN}"\\s*,\\s*([^)]+)\\)`),
    // .match({ tenant_id: tenantId }) / .insert({ tenant_id: opts.tenantId }).
    new RegExp(`${TENANT_COLUMN}\\s*:\\s*([^,\\n}]+)`),
    // .filter("tenant_id", "eq", tenantId) — forma dynamiczna.
    new RegExp(`\\.filter\\(\\s*"${TENANT_COLUMN}"\\s*,\\s*"[a-z]+"\\s*,\\s*([^)]+)\\)`),
  ];
  for (const re of patterns) {
    const m = re.exec(body);
    if (m && TENANT_VALUE_RE.test(m[1])) return m[0].trim();
  }
  return null;
}

/**
 * Pozycje wszystkich trafień wzorca. Świadomie `exec` w pętli, nie `matchAll`:
 * `RegExpExecArray.index` jest typu `number`, a `RegExpMatchArray.index` -
 * `number | undefined`, co wymuszałoby cztery gałęzie `?? 0` niemożliwe do
 * pokrycia testem (globalny `exec` zawsze ustawia `index`). Regex budowany
 * lokalnie, żeby `lastIndex` nie przeciekał między wywołaniami.
 */
function scan(
  source: string,
  pattern: string,
): Array<{ at: number; end: number; groups: RegExpExecArray }> {
  const re = new RegExp(pattern, "g");
  const out: Array<{ at: number; end: number; groups: RegExpExecArray }> = [];
  let m: RegExpExecArray | null = re.exec(source);
  while (m !== null) {
    out.push({ at: m.index, end: m.index + m[0].length, groups: m });
    m = re.exec(source);
  }
  return out;
}

/** Czy plik sięga po klienta service-role (czyli czy RLS go NIE chroni). */
export function usesServiceRole(source: string): boolean {
  return SERVICE_ROLE_RE.test(maskComments(source));
}

/**
 * Zapytania do tabel w jednym pliku.
 *
 * Ciało zapytania kończy się na NASTĘPNYM `.from(` w pliku - także wtedy, gdy
 * tym następnym jest kubełek storage. Inaczej łańcuch storage wpadłby do ciała
 * poprzedniego zapytania i jego `remove([...])` mógłby przypadkiem dostarczyć
 * dowodu tam, gdzie go nie ma.
 *
 * Komentarze są maskowane (`maskComments` zachowuje offsety i numerację linii),
 * więc zakomentowane zapytanie nie liczy się jako zapytanie, a przykład filtru
 * w komentarzu nie liczy się jako dowód.
 */
export function tableQueries(input: ScannedSource): TableQuery[] {
  const code = maskComments(input.source);
  const calls = scan(code, FROM_CALL_SRC);
  const out: TableQuery[] = [];
  calls.forEach((call, i) => {
    const isStorage = call.groups[1] !== undefined;
    if (isStorage) return;
    const end = i + 1 < calls.length ? calls[i + 1].at : code.length;
    const body = code.slice(call.end, end);
    const evidence = tenantEvidence(body);
    out.push({
      file: input.file,
      table: call.groups[2],
      line: code.slice(0, call.at).split("\n").length,
      body,
      verdict: evidence ? "SCOPED" : "UNSCOPED",
      evidence,
    });
  });
  return out;
}

/** Wywołania RPC w jednym pliku. */
export function rpcCalls(input: ScannedSource): RpcCall[] {
  const code = maskComments(input.source);
  const calls = scan(code, RPC_CALL_SRC);
  return calls.map((call, i) => {
    const end = i + 1 < calls.length ? calls[i + 1].at : code.length;
    return {
      file: input.file,
      fn: call.groups[1],
      line: code.slice(0, call.at).split("\n").length,
      passesTenant: RPC_TENANT_ARG_RE.test(code.slice(call.end, end)),
    };
  });
}

/**
 * Wyjątek: `plik::tabela` -> uzasadnienie widoczne w raporcie.
 *
 * Lista bez uzasadnień zamienia się z czasem w listę wymówek, dlatego kluczem
 * jest para plik+tabela (nie sama tabela): zgoda na brak filtru dotyczy JEDNEGO
 * miejsca, a nie tabeli w całym repozytorium.
 */
export type TenantScopeExemptions = Readonly<Record<string, string>>;

/** Luka: zapytanie spod service-role bez granicy najemcy i bez wyjątku. */
export interface TenantScopeGap {
  readonly file: string;
  readonly table: string;
  readonly line: number;
}

export interface TenantScopeReport {
  /** Pliki, które faktycznie sięgają po service role. */
  readonly serviceRoleFiles: readonly string[];
  /** Liczba przeskanowanych zapytań do tabel - podstawa kanarka zasięgu. */
  readonly analyzed: number;
  readonly scoped: number;
  /** Zapytania bez granicy najemcy i bez wpisu na liście wyjątków. */
  readonly gaps: readonly TenantScopeGap[];
  /** Wpisy wyjątków, które kogoś realnie przykryły. */
  readonly usedExemptions: readonly string[];
  /** Wpisy wyjątków bez trafienia - luka zamknięta, wpis do usunięcia. */
  readonly staleExemptions: readonly string[];
  /**
   * Wpisy wyjątków dla zapytań, które MAJĄ filtr - wyjątek zbędny, a groźny:
   * następne zapytanie na tej tabeli w tym pliku przejdzie bez filtru.
   */
  readonly redundantExemptions: readonly string[];
}

/** Klucz wyjątku dla zapytania. */
export function exemptionKey(file: string, table: string): string {
  return `${file}::${table}`;
}

/**
 * Audyt zakresu najemcy dla zapytań spod service-role.
 *
 * Skanowane są WYŁĄCZNIE pliki, które sięgają po `supabaseAdmin`: w pliku
 * używającym klienta użytkownika granicę stawia RLS i wymaganie tam filtru
 * byłoby szumem.
 */
export function auditServiceRoleTenantScope(
  sources: readonly ScannedSource[],
  exemptions: TenantScopeExemptions,
): TenantScopeReport {
  const admin = sources.filter((s) => usesServiceRole(s.source));
  const queries = admin.flatMap((s) => tableQueries(s));

  const gaps: TenantScopeGap[] = [];
  const used = new Set<string>();
  const redundant = new Set<string>();

  for (const q of queries) {
    const key = exemptionKey(q.file, q.table);
    const exempt = key in exemptions;
    if (q.verdict === "SCOPED") {
      if (exempt) redundant.add(key);
      continue;
    }
    if (exempt) {
      used.add(key);
      continue;
    }
    gaps.push({ file: q.file, table: q.table, line: q.line });
  }

  const seen = new Set(queries.map((q) => exemptionKey(q.file, q.table)));
  return {
    serviceRoleFiles: admin.map((s) => s.file).sort(),
    analyzed: queries.length,
    scoped: queries.filter((q) => q.verdict === "SCOPED").length,
    gaps,
    usedExemptions: [...used].sort(),
    staleExemptions: Object.keys(exemptions)
      .filter((k) => !seen.has(k))
      .sort(),
    redundantExemptions: [...redundant].sort(),
  };
}

/** Raport czytelny w logu CI - jedna linia na lukę, z plikiem i numerem linii. */
export function renderTenantScopeReport(report: TenantScopeReport): string {
  if (report.gaps.length === 0) return "";
  return report.gaps
    .map((g) => `${g.file}:${g.line} from("${g.table}") - brak granicy najemcy`)
    .join("\n");
}

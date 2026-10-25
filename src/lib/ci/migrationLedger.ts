/**
 * Bramka po-wdrożeniowa, warstwa czysta: czy KAŻDA migracja z gałęzi jest
 * zapisana w rejestrze wykonanych migracji bazy.
 *
 * Kontrakt obiektowy (`src/lib/ci/dbContract.ts`) sprawdza, czy tabele, widoki
 * i RPC istnieją. Nie widzi jednak migracji, które nie tworzą nowego obiektu -
 * ALTER kolumny, nowa polityka RLS, GRANT, `CREATE OR REPLACE` istniejącej
 * funkcji, seed. Taka migracja może nigdy się nie wykonać, a bramka obiektowa
 * i tak świeci na zielono (dokładnie ten scenariusz zdarzył się przy PR #286).
 * Ten moduł zamyka lukę po stronie rejestru: porównuje wersje plików
 * `supabase/migrations/<version>_<nazwa>.sql` z odpowiedzią bazy.
 *
 * Trzy świadome ustępstwa wobec realiów tego repo:
 *
 *  1. BAZOWA LINIA (`baseline`). Rejestr bazy zaczął być kompletny dopiero od
 *     pewnego momentu; wcześniejsze migracje pilnuje bramka obiektowa. Bramka
 *     rejestru egzekwuje więc wersje NOWSZE niż baseline - linia może tylko
 *     rosnąć i tylko wtedy, gdy wszystko powyżej jest zielone.
 *  2. UZGODNIENIA (`reconciled`). Migracja przyniesiona w PR-ze bywa wykonywana
 *     przez pipeline pod własną wersją, więc wersja pliku nigdy nie trafi do
 *     rejestru. Wpis uzgodnienia nie zwalnia z kontroli: wskazuje wersję, pod
 *     którą SQL faktycznie poszedł, i bramka sprawdza właśnie ją.
 *  3. LUSTRO DRIZZLE (`drizzleProven`). Plik niesiony przez wpis dziennika
 *     drizzle od MIRROR_LANE_START_IDX (0399; lustro z `bun run migrations:mirror`
 *     albo wpis bota Lovable, którego SQL adoptował plik supabase - runbook
 *     §5.4 pkt 1) trafia na produkcję migratorem Drizzle, który zapisuje go
 *     w `drizzle.__drizzle_migrations` (hash = sha256 pliku wpisu), a nie
 *     w `schema_migrations`. Wierszy w `supabase_migrations.schema_migrations`
 *     nikt już nie dopisuje ręcznie (taki wiersz nie dowodzi, że SQL się
 *     wykonał), więc o te pliki bramka pyta REJESTR MIGRATORA: parę (`when`
 *     wpisu, sha256 pliku wpisu), który niesie plik (`drizzleCarriers`), przez
 *     RPC `missing_drizzle_migration_hashes` (DRIZZLE_REGISTRY_PROBE_MIGRATION) -
 *     to samo dopasowanie `created_at` + `hash` co `--verify`, więc ponowna
 *     dostawa tych samych bajtów (hash już w rejestrze pod `when` innego wpisu)
 *     nie potwierdza pominiętego wpisu. Brak pary albo brak samej funkcji sondy
 *     (partia z nią niewdrożona) to
 *     czerwień - przydział pliku do wpisu liczy się z dziennika w repozytorium,
 *     więc sam w sobie niczego o produkcji nie dowodzi (uwaga przeglądu Codex P1:
 *     pominięte albo nieudane wdrożenie dawało zieloną bramkę). Który wpis niesie
 *     który plik, rozstrzyga kierunek odwrotny bramki pasów
 *     (`analyzeSupabaseCoverage`, ta sama definicja co w `check:migration-lanes`)
 *     - `drizzleProvenFiles`. Granica jest stała, nie JOURNAL_FREEZE_IDX:
 *     podniesienie zamrożenia (runbook §5.4 pkt 2) nie wraca wcześniejszych luster
 *     do `schema_migrations`. Ręcznie to samo (i dodatkowo odróżnia brak od
 *     innego hasha pod tym `when`) sprawdza
 *     `bun run migrations:deploy-sql -- --verify` (docs/RUNBOOK_MIGRACJE_LOVABLE.md
 *     §4.4, §4.5).
 *
 * Cała logika jest czysta i testowalna - IO (fetch, fs) siedzi w
 * `scripts/check-migration-ledger.ts`.
 */
import { drizzleFileHash } from "./migrationDeploySql";
import { DRIZZLE_DIR, MIRROR_LANE_START_IDX, type ReadFile } from "./migrationLaneParity";

/**
 * Plik `supabase/migrations/` z funkcją `missing_drizzle_migration_hashes` - sondą
 * rejestru migratora. Jedzie lustrem od 0399 jak każdy inny plik, więc brak samej
 * funkcji na bazie znaczy, że partia z tym plikiem nie jest wdrożona.
 */
export const DRIZZLE_REGISTRY_PROBE_MIGRATION =
  "20261025090040_missing_drizzle_migration_hashes.sql";

/**
 * Werdykt dla pliku z lustrem, którego pary (`when`, hash) wpisu nie ma w rejestrze
 * migratora; runbook §4.4 cytuje go dosłownie.
 */
export const DRIZZLE_MISSING_VERDICT =
  "brak pary (when, hash) w drizzle.__drizzle_migrations - partia niewdrożona albo wdrożona inną drogą";

/** Gdzie szukać przyczyny braku w rejestrze migratora (weryfikacja i błąd wdrożenia). */
const RUNBOOK_HINT = "runbook §4.4/§4.6";

/** Nazwa pliku migracji rozłożona na wersję (prefiks) i etykietę. */
export interface MigrationFile {
  readonly file: string;
  readonly version: string;
  readonly label: string;
}

/** Migracja wymagana od bazy wraz z wersją, której faktycznie szukamy w rejestrze. */
export interface LedgerRequirement {
  readonly file: string;
  /** Wersja z nazwy pliku. */
  readonly version: string;
  /** Wersja pilnowana w rejestrze (różna od `version` tylko przy uzgodnieniu). */
  readonly ledgerVersion: string;
  readonly reconciled: boolean;
}

export interface LedgerConfig {
  /** Migracje o wersji <= baseline są poza zakresem bramki rejestru. */
  readonly baseline: string;
  /** `nazwa pliku` → `wersja w rejestrze, pod którą SQL został wykonany`. */
  readonly reconciled: Readonly<Record<string, string>>;
  /**
   * Pliki niesione przez wpisy dziennika od MIRROR_LANE_START_IDX
   * (`drizzleCarriers`) - poza `schema_migrations`, bo ich dowodem jest wiersz
   * rejestru migratora Drizzle z `when` wpisu i hashem pliku wpisu.
   */
  readonly drizzleProven?: readonly DrizzleCarrier[];
}

/** Plik supabase niesiony przez wpis dziennika od MIRROR_LANE_START_IDX. */
export interface DrizzleCarrier {
  /** Plik `supabase/migrations/`. */
  readonly file: string;
  /** Tag wpisu dziennika, który go niesie (lustro albo adoptowany wpis bota). */
  readonly tag: string;
  /**
   * `when` tego wpisu z `meta/_journal.json` - migrator zapisuje go
   * w `drizzle.__drizzle_migrations.created_at`.
   */
  readonly when: number;
  /**
   * sha256 hex pliku `drizzle/migrations/<tag>.sql` - dokładnie to, co migrator
   * zapisuje w `drizzle.__drizzle_migrations.hash`.
   */
  readonly hash: string;
}

/**
 * Klucz pytania sondy rejestru migratora: `<when>:<sha256>` - para `created_at`
 * i `hash` wiersza `drizzle.__drizzle_migrations`, którą zapisze migrator.
 */
export function drizzleRegistryKey(carrier: Pick<DrizzleCarrier, "when" | "hash">): string {
  return `${carrier.when}:${carrier.hash}`;
}

/**
 * Odpowiedź rejestru migratora: klucze (`drizzleRegistryKey`), których pary w nim
 * brak, albo brak samej funkcji sondy na bazie (`detail` - komunikat sondy). Każda
 * inna porażka sondy to wyjątek.
 */
export type DrizzleRegistryAnswer =
  | { readonly kind: "answered"; readonly missingEntries: readonly string[] }
  | { readonly kind: "probe-missing"; readonly detail: string };

/**
 * Pliki, których dowodem wdrożenia jest rejestr migratora Drizzle: niesione
 * (`copies`: plik -> tag z przydziału `analyzeSupabaseCoverage`) przez wpis
 * dziennika o idx większym niż `historyEndIdx` - domyślnie ostatni wpis przed
 * MIRROR_LANE_START_IDX, granicą stałą (nie JOURNAL_FREEZE_IDX, które runbook
 * §5.4 pkt 2 każe podnosić). Historia sprzed luster - bliźniaki i kopie panelu -
 * zostaje w bramce rejestru jak dotąd.
 */
export function drizzleProvenFiles(
  copies: ReadonlyMap<string, string>,
  historyEndIdx: number = MIRROR_LANE_START_IDX - 1,
): Set<string> {
  const idxOf = (tag: string): number =>
    Number(/^(\d+)_/.exec(tag)?.[1] ?? Number.POSITIVE_INFINITY);
  return new Set([...copies].filter(([, tag]) => idxOf(tag) > historyEndIdx).map(([file]) => file));
}

/**
 * Pliki `drizzleProvenFiles` z wpisem, który je niesie, jego `when` (`whenByTag`:
 * tag -> `when` z dziennika) i hashem pliku tego wpisu liczonym jak w drizzle-orm
 * (`readMigrationFiles`): lustro - plik lustra z nagłówkiem, adopcja - plik wpisu
 * bota. Kolejność plików. Brak pliku wpisu albo jego `when` (spoza liczb
 * całkowitych >= 0) to błąd: bez pary nie ma o co zapytać rejestru, a ciche
 * zwolnienie przepuściłoby niewdrożony plik.
 */
export function drizzleCarriers(
  copies: ReadonlyMap<string, string>,
  read: ReadFile,
  whenByTag: ReadonlyMap<string, number>,
  historyEndIdx: number = MIRROR_LANE_START_IDX - 1,
): DrizzleCarrier[] {
  const proven = drizzleProvenFiles(copies, historyEndIdx);
  return [...copies]
    .filter(([file]) => proven.has(file))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, tag]) => {
      const when = whenByTag.get(tag);
      if (when === undefined || !Number.isSafeInteger(when) || when < 0) {
        throw new Error(
          `Wpis ${tag} niosący ${file}: brak \`when\` w dzienniku albo nie jest liczbą całkowitą >= 0 (${String(when)}).`,
        );
      }
      const content = read(`${DRIZZLE_DIR}/${tag}.sql`);
      if (content === null) {
        throw new Error(`Brak pliku ${DRIZZLE_DIR}/${tag}.sql wpisu niosącego ${file}.`);
      }
      return { file, tag, when, hash: drizzleFileHash(content) };
    });
}

export interface LedgerReport {
  /** Migracje faktycznie egzekwowane (po odcięciu baseline). */
  readonly required: readonly LedgerRequirement[];
  /** Migracje sprzed baseline - pilnuje ich bramka obiektowa. */
  readonly baselined: number;
  /** Migracje powyżej baseline z lustrem drizzle - dowodem rejestr migratora Drizzle. */
  readonly drizzleProven: number;
  /** Pliki z lustrem, których pary (`when`, hash) wpisu nie ma w `drizzle.__drizzle_migrations`. */
  readonly drizzleMissing: readonly DrizzleCarrier[];
  /**
   * Komunikat sondy, gdy na bazie nie ma samej funkcji
   * `missing_drizzle_migration_hashes` (partia z nią niewdrożona); `null`, gdy
   * rejestr odpowiedział.
   */
  readonly drizzleProbeMissing: string | null;
  /** Wymagania, których baza nie potwierdza - wdrożenie jest niepełne. */
  readonly missing: readonly LedgerRequirement[];
  /** Uzgodnienia wskazujące pliki, których w gałęzi już nie ma (martwy wpis). */
  readonly staleReconciliations: readonly string[];
  /** Pliki o nazwie spoza konwencji `<wersja>_<etykieta>.sql`. */
  readonly malformed: readonly string[];
}

const VERSION_RE = /^(\d{14})_(.+)\.sql$/;

/**
 * Wersja migracji to 14-cyfrowy prefiks nazwy pliku - dokładnie to, co Supabase
 * zapisuje w `supabase_migrations.schema_migrations.version`.
 */
export function parseMigrationFile(file: string): MigrationFile | null {
  const match = VERSION_RE.exec(file);
  if (!match) return null;
  return { file, version: match[1], label: match[2] };
}

export function parseMigrationFiles(files: readonly string[]): {
  parsed: MigrationFile[];
  malformed: string[];
} {
  const parsed: MigrationFile[] = [];
  const malformed: string[] = [];
  for (const file of [...files].filter((f) => f.endsWith(".sql")).sort()) {
    const entry = parseMigrationFile(file);
    if (entry) parsed.push(entry);
    else malformed.push(file);
  }
  return { parsed, malformed };
}

/** Migracja w zakresie bramki rejestru: nowsza niż baseline (lustro drizzle jeszcze nie odjęte). */
function aboveBaseline(m: MigrationFile, config: LedgerConfig): boolean {
  return m.version > config.baseline;
}

/** Pliki z lustrem, indeks po nazwie pliku. */
function carriersByFile(config: LedgerConfig): ReadonlyMap<string, DrizzleCarrier> {
  return new Map((config.drizzleProven ?? []).map((c) => [c.file, c]));
}

/** Zbiór wersji, o które trzeba zapytać bazę (już po odcięciu baseline i plików z lustrem). */
export function ledgerRequirements(
  parsed: readonly MigrationFile[],
  config: LedgerConfig,
): LedgerRequirement[] {
  const carried = carriersByFile(config);
  return parsed
    .filter((m) => aboveBaseline(m, config) && !carried.has(m.file))
    .map((m) => {
      const reconciledVersion = config.reconciled[m.file];
      return {
        file: m.file,
        version: m.version,
        ledgerVersion: reconciledVersion ?? m.version,
        reconciled: typeof reconciledVersion === "string",
      };
    });
}

/**
 * Pliki z lustrem w zakresie bramki (powyżej baseline, obecne w gałęzi), o których
 * parę (`when`, hash) bramka pyta rejestr migratora - w kolejności plików.
 */
export function drizzleRequirements(
  parsed: readonly MigrationFile[],
  config: LedgerConfig,
): DrizzleCarrier[] {
  const carried = carriersByFile(config);
  return parsed.flatMap((m) => {
    const carrier = aboveBaseline(m, config) ? carried.get(m.file) : undefined;
    return carrier === undefined ? [] : [carrier];
  });
}

/**
 * Zestawia wymagania z listami braków zwróconymi przez bazę: wersje
 * `schema_migrations` i pary (`when`, hash) `drizzle.__drizzle_migrations`
 * (klucze `drizzleRegistryKey`). Baza nigdy nie wylicza swoich rejestrów -
 * odpowiada wyłącznie na pytanie o podane wersje i pary; wpis spoza pytania to
 * błąd sondy (wyjątek), nie werdykt.
 */
export function buildLedgerReport(
  parsed: readonly MigrationFile[],
  malformed: readonly string[],
  missingVersions: readonly string[],
  config: LedgerConfig,
  drizzleRegistry: DrizzleRegistryAnswer,
): LedgerReport {
  const required = ledgerRequirements(parsed, config);
  const drizzleRequired = drizzleRequirements(parsed, config);
  const inScope = parsed.filter((m) => aboveBaseline(m, config)).length;
  const missingSet = new Set(missingVersions);
  const branchFiles = new Set(parsed.map((m) => m.file));
  const missingEntries = new Set(
    drizzleRegistry.kind === "answered" ? drizzleRegistry.missingEntries : [],
  );
  const askedEntries = new Set(drizzleRequired.map(drizzleRegistryKey));
  const unasked = [...missingEntries].filter((key) => !askedEntries.has(key));
  if (unasked.length > 0) {
    throw new Error(
      `Sonda rejestru migratora zwróciła wpis, o który bramka nie pytała: ${unasked.join(", ")}.`,
    );
  }
  return {
    required,
    baselined: parsed.length - inScope,
    drizzleProven: drizzleRequired.length,
    drizzleMissing: drizzleRequired.filter((c) => missingEntries.has(drizzleRegistryKey(c))),
    drizzleProbeMissing: drizzleRegistry.kind === "probe-missing" ? drizzleRegistry.detail : null,
    missing: required.filter((r) => missingSet.has(r.ledgerVersion)),
    staleReconciliations: Object.keys(config.reconciled)
      .filter((file) => !branchFiles.has(file))
      .sort(),
    malformed: [...malformed],
  };
}

export function ledgerFailed(report: LedgerReport): boolean {
  return (
    report.missing.length > 0 ||
    report.drizzleMissing.length > 0 ||
    report.drizzleProbeMissing !== null ||
    report.malformed.length > 0 ||
    report.staleReconciliations.length > 0
  );
}

export function renderLedgerReport(report: LedgerReport): string {
  const lines: string[] = ["## Rejestr migracji (gałąź ⇄ baza)", ""];
  lines.push(`- Egzekwowanych migracji: **${report.required.length}**`);
  lines.push(`- Poniżej bazowej linii (pilnuje bramka obiektowa): **${report.baselined}**`);
  lines.push(
    `- Z lustrem drizzle (dowód: \`when\` wpisu i hash jego pliku w rejestrze migratora \`drizzle.__drizzle_migrations\`, sonda \`missing_drizzle_migration_hashes\`; ręcznie \`bun run migrations:deploy-sql -- --verify\`): **${report.drizzleProven}**`,
  );
  lines.push(
    report.drizzleProbeMissing === null
      ? `- Niepotwierdzonych w rejestrze migratora: **${report.drizzleMissing.length}**`
      : "- Niepotwierdzonych w rejestrze migratora: **sonda niedostępna**",
  );
  lines.push(`- Niewykonanych w bazie: **${report.missing.length}**`);
  if (report.malformed.length > 0) {
    lines.push(`- Plików o złej nazwie: **${report.malformed.length}**`);
  }
  if (report.staleReconciliations.length > 0) {
    lines.push(`- Martwych uzgodnień: **${report.staleReconciliations.length}**`);
  }
  lines.push("");

  if (report.missing.length > 0) {
    lines.push("### Migracje, które nie wykonały się na bazie", "");
    for (const m of report.missing) {
      lines.push(
        m.reconciled
          ? `- \`${m.file}\` (uzgodniona wersja \`${m.ledgerVersion}\` też nie istnieje w rejestrze)`
          : `- \`${m.file}\``,
      );
    }
    lines.push("");
  }
  if (report.drizzleProbeMissing !== null) {
    lines.push("### Sonda rejestru migratora niedostępna", "");
    lines.push(
      `- Na bazie nie ma funkcji \`public.missing_drizzle_migration_hashes\` (${report.drizzleProbeMissing}): partia z lustrem \`${DRIZZLE_REGISTRY_PROBE_MIGRATION}\` nie jest wdrożona, więc wdrożenia ${report.drizzleProven} plików z lustrem nie da się potwierdzić; ${RUNBOOK_HINT}.`,
      "",
    );
  }
  if (report.drizzleMissing.length > 0) {
    lines.push("### Pliki z lustrem drizzle bez zapisu w rejestrze migratora", "");
    for (const c of report.drizzleMissing) {
      lines.push(
        `- \`${c.tag}\` (\`${c.file}\`, when \`${c.when}\`, hash \`${c.hash.slice(0, 12)}\`): ${DRIZZLE_MISSING_VERDICT}; ${RUNBOOK_HINT}`,
      );
    }
    lines.push("");
  }
  if (report.malformed.length > 0) {
    lines.push("### Pliki spoza konwencji `<wersja>_<etykieta>.sql`", "");
    for (const f of report.malformed) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (report.staleReconciliations.length > 0) {
    lines.push("### Uzgodnienia wskazujące nieistniejące pliki - usuń wpisy", "");
    for (const f of report.staleReconciliations) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (!ledgerFailed(report)) {
    lines.push("Wszystkie migracje z gałęzi są wykonane na bazie.", "");
  }
  return lines.join("\n");
}

/** Treść `reports/migration-ledger.json` (artefakt joba `post-deploy`). */
export function ledgerReportJson(report: LedgerReport, baseline: string): Record<string, unknown> {
  return {
    status: ledgerFailed(report) ? "failed" : "passed",
    baseline,
    required: report.required.length,
    baselined: report.baselined,
    drizzleProven: report.drizzleProven,
    drizzleRegistry: report.drizzleProbeMissing === null ? "answered" : "probe-missing",
    drizzleProbeError: report.drizzleProbeMissing,
    drizzleMissing: report.drizzleMissing.map(({ file, tag, when, hash }) => ({
      file,
      tag,
      when,
      hash,
    })),
    missing: report.missing.map((m) => ({
      file: m.file,
      version: m.version,
      ledgerVersion: m.ledgerVersion,
    })),
    staleReconciliations: report.staleReconciliations,
    malformed: report.malformed,
  };
}

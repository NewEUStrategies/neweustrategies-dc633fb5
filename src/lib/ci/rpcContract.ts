// Inwariant CI: KAŻDE RPC WOŁANE PRZEZ KLIENTA MUSI ISTNIEĆ I CELOWAĆ
// W ISTNIEJĄCĄ RELACJĘ.
//
// PRZYCZYNA ŹRÓDŁOWA (2026-08-06, „Zapytanie do eksperta"). Migracja
// 20260723180000 przemianowała `expert_inmails` -> `expert_requests` i usunęła
// pięć funkcji generacji „inmail". Dwie PÓŹNIEJSZE migracje odtworzyły
// `send_expert_inmail` pod STARĄ nazwą tabeli, a klient nadal wołał całą piątkę.
// Na produkcji nic nie bolało, bo blok z RENAME siedział w pliku o zdublowanej
// wersji i nigdy się nie wykonał. Na ŚWIEŻEJ bazie (CI e2e, staging, każde nowe
// środowisko) ta sama historia migracji dawała funkcję rzucającą 42P01
// („relation public.expert_inmails does not exist") i cztery RPC, których nie
// było wcale - czyli funkcję martwą w każdym nowym środowisku.
//
// Dlaczego to klasa błędu, a nie wpadka: ciała funkcji plpgsql/sql NIE są
// walidowane przy `CREATE FUNCTION` (nazwa relacji rozwiązuje się przy
// WYWOŁANIU), a `supabase db push` na produkcję nigdy nie odtwarza bazy od zera.
// Rozjazd „funkcja mówi o tabeli, której już nie ma" jest więc niewidoczny dla
// kompilatora, dla migracji i dla produkcji - widzi go dopiero użytkownik.
//
// DWA SPRAWDZENIA (oba na STANIE KOŃCOWYM historii migracji):
//   1. `missingFunctions` - nazwa wołana przez `supabase.rpc("…")` bez funkcji
//      w stanie końcowym (PGRST202 „function not found" w przeglądarce).
//   2. `orphanedRelationRefs` - ciało (albo zwrotka) funkcji ze stanu końcowego
//      wskazuje relację, która BYŁA tabelą w historii migracji, ale została
//      przemianowana albo usunięta (42P01 przy wywołaniu). Zbiór „relacji
//      osieroconych" wynika z samych migracji, więc bramka nie ma ręcznej listy
//      i nie zgłasza tabel, których nigdy nie było (literały, typy, kolumny).
//
// Moduł jest CZYSTY - warstwa I/O (odczyt migracji i źródeł klienta) żyje
// w scripts/check-sql-rpc-contract.ts, dzięki czemu logika jest testowalna.
import { extractExpectedContract, type MigrationFile } from "./dbContract";

/** Definicja funkcji ze stanu końcowego migracji (patrz scripts/lib/sqlMigrations). */
export interface RpcDefinition {
  /** `schema.nazwa/arność` - klucz stanu końcowego. */
  readonly key: string;
  /** Nazwa bez schematu, lowercase. */
  readonly name: string;
  readonly file: string;
  /** Ciało między znacznikami dollar-quote. */
  readonly body: string;
  /** Nagłówek + postambuła (RETURNS, LANGUAGE, SECURITY …) - bez ciała. */
  readonly attrs?: string;
}

/** Plik źródłowy klienta (SQL komentarze/TS komentarze usunięte przez wywołującego). */
export interface ClientSource {
  readonly file: string;
  readonly code: string;
}

/** Wywołanie RPC znalezione w kodzie klienta. */
export interface CalledRpc {
  readonly name: string;
  /** Pliki, w których nazwa jest wołana (posortowane, bez duplikatów). */
  readonly callers: readonly string[];
}

/** Funkcja stanu końcowego wskazująca relację, której w tym stanie nie ma. */
export interface OrphanedRelationRef {
  /** `nazwa/arność` funkcji. */
  readonly fn: string;
  /** Migracja z OSTATNIĄ definicją tej funkcji. */
  readonly file: string;
  /** Osierocona relacja (bez schematu). */
  readonly relation: string;
  /** Migracja, w której relacja została przemianowana/usunięta. */
  readonly retiredIn: string | null;
}

export interface RpcContractReport {
  /** Liczba unikalnych nazw RPC wołanych z kodu klienta. */
  readonly calledRpcs: number;
  /** Liczba funkcji w stanie końcowym migracji. */
  readonly definedFunctions: number;
  /** RPC wołane przez klienta, których nie ma w stanie końcowym. */
  readonly missingFunctions: readonly CalledRpc[];
  /** Funkcje celujące w relację wycofaną z schematu. */
  readonly orphanedRelationRefs: readonly OrphanedRelationRef[];
  /** Relacje wycofane w historii migracji (kontekst raportu). */
  readonly retiredRelations: readonly string[];
}

/**
 * Nazwy RPC wołane z kodu klienta: `supabase.rpc("x")`, `.rpc<T>("x")`,
 * `client.rpc('x', …)`. Świadomie NIE próbujemy rozwiązywać nazw dynamicznych
 * (`rpc(fnName)`) - takich w repo nie ma, a zgadywanie dałoby fałszywe alarmy.
 */
export function extractCalledRpcs(sources: readonly ClientSource[]): CalledRpc[] {
  const byName = new Map<string, Set<string>>();
  const callRe = /\.rpc\s*(?:<[^>(]*>)?\s*\(\s*(["'`])([A-Za-z0-9_]+)\1/g;

  for (const { file, code } of sources) {
    callRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = callRe.exec(code)) !== null) {
      const name = match[2].toLowerCase();
      const bucket = byName.get(name);
      if (bucket) bucket.add(file);
      else byName.set(name, new Set([file]));
    }
  }

  return [...byName.entries()]
    .map(([name, files]) => ({ name, callers: [...files].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Relacje, które BYŁY tabelą w historii migracji, a w stanie końcowym ich nie ma
 * (przemianowane albo usunięte). Wartość mapy to plik, w którym zniknęły -
 * dokładnie ta informacja, której potrzebuje ktoś naprawiający ciało funkcji.
 */
export function retiredRelations(files: readonly MigrationFile[]): Map<string, string> {
  const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  // `ALTER PUBLICATION supabase_realtime DROP TABLE public.x` NIE wycofuje
  // tabeli - wypisuje ją tylko z publikacji Realtime. Bez tego wykluczenia
  // bramka uznawała pół schematu CRM za relacje osierocone.
  const dropTable =
    /(?<!PUBLICATION\s+[A-Za-z0-9_"]{1,64}\s)DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const renameTable =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s+RENAME\s+TO\s+([A-Za-z0-9_."]+)/gi;

  const retired = new Map<string, string>();
  const live = new Set<string>();

  const publicName = (raw: string): string | null => {
    const cleaned = raw.replace(/"/g, "").trim().toLowerCase();
    if (cleaned.includes(".") && !cleaned.startsWith("public.")) return null;
    const name = cleaned.replace(/^public\./, "");
    return /^[a-z0-9_]+$/.test(name) ? name : null;
  };

  for (const { file, sql } of files) {
    for (const re of [createTable]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        const name = publicName(m[1]);
        if (name === null) continue;
        live.add(name);
        retired.delete(name);
      }
    }
    dropTable.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = dropTable.exec(sql)) !== null) {
      const name = publicName(m[1]);
      if (name !== null && live.delete(name)) retired.set(name, file);
    }
    renameTable.lastIndex = 0;
    while ((m = renameTable.exec(sql)) !== null) {
      const from = publicName(m[1]);
      const to = publicName(m[2]);
      if (from !== null && live.delete(from)) retired.set(from, file);
      if (to !== null) {
        live.add(to);
        retired.delete(to);
      }
    }
  }

  return retired;
}

/**
 * Ostatni `DROP FUNCTION` dla każdej nazwy funkcji (bez schematu).
 *
 * Potrzebne, bo „stan końcowy definicji" (ostatnie `CREATE OR REPLACE`) nie wie
 * nic o usunięciach: funkcja skasowana RAZEM z tabelą (jak `claim_push_outbox`
 * i `push_outbox` w 20260713210000) nadal ma swoją ostatnią definicję w historii
 * i bez tego filtra wyglądałaby na wiszącą referencję.
 */
export function droppedFunctions(files: readonly MigrationFile[]): Map<string, string> {
  const dropFn = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const dropped = new Map<string, string>();

  for (const { file, sql } of files) {
    dropFn.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = dropFn.exec(sql)) !== null) {
      const cleaned = match[1].replace(/"/g, "").trim().toLowerCase();
      if (cleaned.includes(".") && !cleaned.startsWith("public.")) continue;
      dropped.set(cleaned.replace(/^public\./, ""), file);
    }
  }
  return dropped;
}

/** Czy tekst (ciało/zwrotka funkcji) wskazuje relację o tej nazwie. */
export function referencesRelation(sql: string, relation: string): boolean {
  const qualified = new RegExp(`\\bpublic\\.${relation}\\b`, "i");
  if (qualified.test(sql)) return true;
  // Bez schematu liczą się wyłącznie pozycje składniowo relacyjne - inaczej
  // kolumna albo literal o tej samej nazwie dawałby fałszywy alarm.
  const positional = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE|TABLE|USING)\\s+(?:ONLY\\s+)?${relation}\\b`,
    "i",
  );
  return positional.test(sql);
}

export interface RpcContractInput {
  /** Migracje POSORTOWANE chronologicznie, SQL bez komentarzy. */
  readonly migrations: readonly MigrationFile[];
  /** Stan końcowy definicji funkcji (ostatnie CREATE OR REPLACE każdej z nich). */
  readonly definitions: readonly RpcDefinition[];
  /** Źródła klienta (TS/TSX) bez komentarzy. */
  readonly clients: readonly ClientSource[];
  /**
   * Nazwy RPC świadomie dostarczane poza migracjami (np. rozszerzenia Supabase,
   * funkcje schematu `graphql_public`). Wartość to uzasadnienie widoczne w logu.
   */
  readonly externalRpcs?: Readonly<Record<string, string>>;
}

/** Pełna analiza kontraktu RPC klient ⇄ migracje. */
export function analyzeRpcContract({
  migrations,
  definitions,
  clients,
  externalRpcs = {},
}: RpcContractInput): RpcContractReport {
  const contract = extractExpectedContract(migrations);
  const dropped = droppedFunctions(migrations);

  // Definicje ŻYWE: ostatnie `CREATE OR REPLACE`, z którego nie zdjął już
  // później `DROP FUNCTION`. Porównanie po nazwie pliku = porządek
  // chronologiczny; przy DROP i CREATE w TYM SAMYM pliku wygrywa CREATE, bo
  // taki jest wzorzec repo („DROP IF EXISTS + CREATE" dla podmiany sygnatury).
  const live = definitions.filter((def) => {
    const droppedIn = dropped.get(def.name.replace(/^public\./, ""));
    return droppedIn === undefined || droppedIn <= def.file;
  });

  // Kontrakt Data API pomija funkcje wyzwalaczy, a stan końcowy definicji -
  // funkcje tworzone dynamicznie; suma obu zbiorów to „co naprawdę zostaje".
  const definedByName = new Set<string>(contract.functions.map((fn) => fn.name));
  for (const def of live) definedByName.add(def.name.replace(/^public\./, ""));

  const called = extractCalledRpcs(clients);
  const missingFunctions = called.filter(
    (rpc) => !definedByName.has(rpc.name) && externalRpcs[rpc.name] === undefined,
  );

  const retired = retiredRelations(migrations);
  const orphanedRelationRefs: OrphanedRelationRef[] = [];
  for (const def of live) {
    const haystack = `${def.attrs ?? ""}\n${def.body}`;
    for (const [relation, retiredIn] of retired) {
      if (referencesRelation(haystack, relation)) {
        orphanedRelationRefs.push({
          fn: def.key,
          file: def.file,
          relation,
          retiredIn,
        });
      }
    }
  }
  orphanedRelationRefs.sort(
    (a, b) => a.fn.localeCompare(b.fn) || a.relation.localeCompare(b.relation),
  );

  return {
    calledRpcs: called.length,
    definedFunctions: live.length,
    missingFunctions,
    orphanedRelationRefs,
    retiredRelations: [...retired.keys()].sort(),
  };
}

/** Czy raport powinien zablokować CI. */
export function rpcContractFailed(report: RpcContractReport): boolean {
  return report.missingFunctions.length > 0 || report.orphanedRelationRefs.length > 0;
}

/** Raport dla logu CI / GitHub Step Summary. */
export function renderRpcContractReport(report: RpcContractReport): string {
  const lines: string[] = [];

  if (report.missingFunctions.length > 0) {
    lines.push("✗ Klient woła RPC, których nie ma w stanie końcowym migracji:");
    for (const rpc of report.missingFunctions) {
      lines.push(`    • ${rpc.name}  (woła: ${rpc.callers.join(", ")})`);
    }
    lines.push(
      '  W przeglądarce to PGRST202 „function not found" - funkcja jest martwa',
      "  w każdym środowisku odtworzonym z migracji. Dopisz brakującą definicję",
      "  albo popraw nazwę w wywołaniu klienta.",
    );
  }

  if (report.orphanedRelationRefs.length > 0) {
    lines.push("✗ Funkcje celują w relację wycofaną ze schematu (42P01 przy wywołaniu):");
    for (const ref of report.orphanedRelationRefs) {
      lines.push(
        `    • ${ref.fn} → public.${ref.relation}` +
          `  (definicja: ${ref.file}; relacja wycofana w: ${ref.retiredIn ?? "?"})`,
      );
    }
    lines.push(
      "  Ciała plpgsql/sql NIE są walidowane przy CREATE FUNCTION, a `db push`",
      "  na produkcję nigdy nie odtwarza bazy od zera - taki rozjazd widzi dopiero",
      "  użytkownik na świeżej bazie. Przepisz ciało na relację ze stanu końcowego.",
    );
  }

  if (lines.length === 0) {
    lines.push(
      `✓ Kontrakt RPC OK (${report.calledRpcs} nazw wołanych przez klienta, ` +
        `${report.definedFunctions} funkcji w stanie końcowym, ` +
        `${report.retiredRelations.length} relacji wycofanych w historii migracji).`,
    );
  }
  return lines.join("\n");
}

// Inwariant CI: KAŻDY CEL `onConflict` W `.upsert(...)` MA ARBITRA - KLUCZ
// UNIKALNY O DOKŁADNIE TYM ZBIORZE KOLUMN W SCHEMACIE ODTWORZONYM Z MIGRACJI.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// KAŻDA wysyłka zaproszenia kończyła się błędem. `performSend`
// (src/lib/admin/invitations.functions.ts) zapisywał rolę przez
// `upsert(..., { onConflict: "user_id,role", ignoreDuplicates: true })` do
// `user_roles`, a od 5d515581e przerywa wysyłkę, gdy ten zapis się nie uda
// (`role_write_failed`). Tymczasem historia migracji wygląda tak:
//   * 20260531180217 (linia 29) zakłada `UNIQUE (user_id, role)`;
//   * 20260531181120 (linia 49) zdejmuje go (`DROP CONSTRAINT IF EXISTS
//     user_roles_user_id_role_key`), a linia 50 stawia w jego miejsce
//     `UNIQUE INDEX user_roles_unique_per_tenant (tenant_id, user_id, role)`.
// Postgres rozwiązuje `ON CONFLICT (kolumny)` WYŁĄCZNIE indeksem unikalnym
// o dokładnie tym zbiorze kolumn - nadzbiór się nie liczy. Na każdej bazie
// odtworzonej z migracji `ON CONFLICT (user_id, role)` kończy się więc 42P10
// („there is no unique or exclusion constraint matching the ON CONFLICT
// specification"). Ten sam cel w `provisionTeamMembers` nie miał nawet
// odczytu `error`, więc zakładane konta po cichu zostawały bez roli.
//
// DLACZEGO NIKT TEGO NIE WIDZIAŁ. Test jednostkowy
// (`src/lib/admin/__tests__/invitationsFunctions.test.ts`) jedzie na ATRAPIE
// bazy, która przyjmuje każdy cel konfliktu - a jego asercja ZAMROZIŁA zły
// cel jako oczekiwany. Kompilator nie wie nic o indeksach, PostgREST przekazuje
// `on_conflict` do SQL bez walidacji, a typy wygenerowane z bazy nie opisują
// kluczy unikalnych. Rozjazd „kod celuje w klucz, którego schemat nie ma"
// widać dopiero w Postgresie, na żądaniu użytkownika - albo w tej bramce.
//
// ── CO BRAMKA SPRAWDZA ──────────────────────────────────────────────────────
//   A. Model stanu końcowego kluczy unikalnych schematu `public`, liczony
//      odtworzeniem migracji w kolejności nazw plików: CREATE TABLE (PK/UNIQUE
//      kolumnowe i tabelowe, domyślne nazwy Postgresa z przycięciem do 63
//      bajtów), ALTER TABLE (ADD/DROP CONSTRAINT, ADD/DROP COLUMN, USING INDEX,
//      RENAME tabeli/kolumny/ograniczenia, SET SCHEMA), CREATE [UNIQUE] INDEX,
//      DROP INDEX, ALTER INDEX RENAME, DROP TABLE.
//   B. Cele `onConflict` z kodu produkcyjnego `src/**` (bez testów): opcje
//      `.upsert(...)` z literałem albo ze stałą `const X = "…"` z tego samego
//      pliku; tabela z najbliższego `.from("…")` w łańcuchu odbiorcy, a gdy
//      go nie ma - z literału nazywającego znaną tabelę w wywołaniu pomocnika
//      (`write(context, "crm_leads").upsert(...)`).
//   C. Cel musi mieć ARBITRA: PK, UNIQUE albo UNIQUE INDEX bez `WHERE`, bez
//      wyrażeń i bez `DEFERRABLE`, o identycznym zbiorze kolumn. PostgREST
//      wysyła `ON CONFLICT (kolumny)` bez predykatu, więc indeks częściowy nie
//      jest arbitrem (wnioskowanie wymaga `WHERE`), indeks na wyrażeniu nie
//      pasuje do listy kolumn, a ograniczenie odraczalne Postgres odrzuca
//      w executorze.
//
// ── ZASADA: ZAMKNIĘTE NA NIEPEWNOŚĆ ─────────────────────────────────────────
// Każde wystąpienie `onConflict: …` w kodzie produkcyjnym musi zostać
// rozstrzygnięte do pary (tabela, kolumny). Wartość nieliteralna (import,
// wyrażenie, szablon z `${}`), tabela nie do ustalenia albo `onConflict` poza
// opcjami `.upsert(...)` to osobna kategoria raportu i ZAPALA bramkę - cicha
// pominięta pozycja wyglądałaby identycznie jak spełniony inwariant. Ten sam
// powód stoi za oblaniem przy zerowym skanie: bramka, która po refaktorze
// przestaje cokolwiek widzieć, nie może być zielona.
//
// ── POLITYKA BLOKÓW `DO $$ … $$` ────────────────────────────────────────────
// Bloki DO WYKONUJĄ się przy migracji, więc ich DDL należy do modelu. Bramka
// wchodzi do ciała, dzieli je na instrukcje i stosuje DDL tak, JAKBY KAŻDA
// GAŁĄŹ SIĘ WYKONAŁA. Strażniki w repo są idempotentne („dodaj, jeśli nie ma
// ograniczenia o tej nazwie", `EXCEPTION WHEN duplicate_object`), a model
// trzyma klucze po nazwie, więc zastosowanie strażnika „na ślepo" daje ten sam
// stan co wykonanie warunkowe. `EXECUTE '…'` z JEDNYM literałem jest
// rozwijany i stosowany jak zwykła instrukcja. `EXECUTE format(…)` i sklejanie
// tekstu są poza zasięgiem analizy statycznej: trafiają do raportu jako
// „dynamiczne DDL" (informacyjnie, bez blokowania). Lekarstwo na fałszywy
// alarm z takiego miejsca to statyczny DDL w nowej, idempotentnej migracji
// (`CREATE UNIQUE INDEX IF NOT EXISTS …`) - model zobaczy go od razu.
// Ciała `CREATE FUNCTION` NIE są wykonywane przy migracji i model ich nie czyta.
// Granica tej polityki, nazwana wprost: gałąź, która w realnym przebiegu się
// NIE wykonuje, a DODAJE klucz, dałaby w modelu klucz, którego baza nie ma.
// Pomiar różnicowy niżej znalazł zero takich miejsc; każde nowe wyjdzie przy
// następnym porównaniu z katalogiem.
//
// Poza modelem, bo w repo ich nie ma: `CREATE TABLE … (LIKE … INCLUDING
// INDEXES)` i `PARTITION OF` (kopiują indeksy rodzica). Skutkiem pojawienia się
// byłby brakujący klucz, czyli GŁOŚNY fałszywy alarm - nigdy cicha zieleń.
//
// ── DOWÓD WIERNOŚCI MODELU ──────────────────────────────────────────────────
// Zmierzone 2026-10-04 porównaniem różnicowym z katalogiem (`pg_index`)
// PostgreSQL 16 odtworzonego ze wszystkich 1082 migracji: 328/328 tabel
// `public` zgodnych dokładnie, 616/616 kluczy (328 PK, 185 UNIQUE, 103 UNIQUE
// INDEX - w tym 60 częściowych i 18 na wyrażeniach) zgodnych co do nazwy,
// rodzaju, kolumn i flag; zero kluczy tylko w modelu, zero tylko w katalogu.
// Każdy z 46 różnych celów (tabela, kolumny) z kodu dostał na tej bazie
// `Conflict Arbiter Indexes` w `EXPLAIN INSERT … ON CONFLICT`, a stary cel
// `user_roles (user_id, role)` - 42P10. Nazwy domyślne (przycięcie do 63
// bajtów, `_key1` przy kolizji, scalenie UNIQUE z PK) sprawdzone tak samo.
//
// Moduł jest CZYSTY - odczyt migracji i źródeł żyje w
// `scripts/check-on-conflict-arbiters.ts`, test w
// `src/lib/ci/__tests__/onConflictArbiters.test.ts`.
import { bezKomentarzy } from "./sourceScan";

// ═══════════════════════════════════════════════════════════════════════════
// Typy publiczne
// ═══════════════════════════════════════════════════════════════════════════

/** Plik migracji. Komentarze SQL mogą zostać - parser je pomija. */
export interface MigrationFile {
  readonly file: string;
  readonly sql: string;
}

/** Plik źródłowy TS/TSX w postaci SUROWEJ - komentarze maskuje sam moduł. */
export interface SourceFile {
  readonly file: string;
  readonly code: string;
}

/** Skąd klucz pochodzi - to rozróżnienie widać w raporcie i w katalogu. */
export type UniqueKeyOrigin = "primary" | "unique" | "index";

/** Klucz unikalny w stanie końcowym (ograniczenie PK/UNIQUE albo UNIQUE INDEX). */
export interface UniqueKey {
  /** Nazwa indeksu (= nazwa ograniczenia, gdy klucz jest ograniczeniem). */
  readonly name: string;
  readonly origin: UniqueKeyOrigin;
  /** Elementy klucza w kolejności deklaracji: kolumna albo `(wyrażenie)`. */
  readonly columns: readonly string[];
  /** Indeks częściowy (`WHERE …`) - bez predykatu w `ON CONFLICT` nie jest arbitrem. */
  readonly partial: boolean;
  /** Choć jeden element jest wyrażeniem - nie pasuje do listy kolumn PostgREST. */
  readonly expression: boolean;
  /** `DEFERRABLE` - executor odrzuca takie ograniczenie jako arbitra. */
  readonly deferrable: boolean;
  /** Migracja, która nadała kluczowi obecny kształt. */
  readonly file: string;
}

/** `EXECUTE` z tekstem składanym w czasie wykonania - poza modelem. */
export interface DynamicDdl {
  readonly file: string;
  readonly text: string;
}

/** Stan końcowy schematu `public` w zakresie, którego potrzebuje bramka. */
export interface UniqueKeyModel {
  /** Tabela -> jej klucze unikalne (posortowane po nazwie; pusta lista = brak kluczy). */
  readonly tables: ReadonlyMap<string, readonly UniqueKey[]>;
  /** Widoki żywe w stanie końcowym (cel upsertu, który okazuje się widokiem). */
  readonly views: ReadonlySet<string>;
  readonly dynamicDdl: readonly DynamicDdl[];
  /** Liczba instrukcji przejrzanych na najwyższym poziomie - kontrola, że model coś widział. */
  readonly statements: number;
}

/** Rozstrzygnięty cel konfliktu w kodzie. */
export interface OnConflictSite {
  readonly file: string;
  /** Linia literału (albo nazwy stałej) w opcjach `.upsert(...)`. */
  readonly line: number;
  readonly table: string;
  /** Cel dokładnie tak, jak trafia do PostgREST. */
  readonly target: string;
  /** Kolumny celu: przycięte, bez cudzysłowów, w kolejności zapisu. */
  readonly columns: readonly string[];
  /** Nazwa stałej, gdy cel nie był literałem w miejscu wywołania. */
  readonly viaConstant: string | null;
}

/** Wystąpienie `onConflict`, którego nie da się sprawdzić statycznie. */
export interface UnresolvedOnConflict {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  /** Linia kodu, żeby raport dało się przeczytać bez otwierania pliku. */
  readonly excerpt: string;
}

export interface ArbiterViolation {
  readonly site: OnConflictSite;
  /**
   * `missing-table` - relacji nie ma w stanie końcowym; `view` - relacja jest
   * widokiem (model nie mapuje go na tabelę bazową); `no-arbiter` - tabela
   * jest, ale żaden jej klucz nie rozstrzyga tego celu.
   */
  readonly problem: "missing-table" | "view" | "no-arbiter";
  /** Klucze unikalne, które tabela NAPRAWDĘ ma. */
  readonly existingKeys: readonly UniqueKey[];
  /** Cele, które przejdą: arbitrzy zawierający wszystkie kolumny celu (albo wszyscy arbitrzy). */
  readonly suggestions: readonly string[];
}

export interface OnConflictArbitersReport {
  readonly scannedFiles: number;
  /** Wszystkie wywołania `.upsert(` w skanowanym kodzie (także bez `onConflict`). */
  readonly upsertCalls: number;
  readonly sites: readonly OnConflictSite[];
  readonly tablesInModel: number;
  readonly migrationStatements: number;
  readonly violations: readonly ArbiterViolation[];
  readonly unresolved: readonly UnresolvedOnConflict[];
  readonly dynamicDdl: readonly DynamicDdl[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Leksyka SQL
// ═══════════════════════════════════════════════════════════════════════════

/** NAMEDATALEN - 1: dłuższe identyfikatory Postgres przycina (z NOTICE). */
const MAX_IDENT_BYTES = 63;
const NAMEDATALEN = 64;

/** Identyfikator: `"Cytowany"""` albo zwykły. */
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
/** Nazwa z opcjonalnym schematem. */
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

/** Najdłuższy prefiks mieszczący się w `maxBytes` bajtach, cięty na granicy znaku. */
function clipBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = "";
  for (const ch of text) {
    const size = byteLength(ch);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += ch;
  }
  return out;
}

/** Identyfikator po normalizacji Postgresa: cudzysłów zachowuje wielkość liter. */
function normalizeIdent(raw: string): string {
  const trimmed = raw.trim();
  const name =
    trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
      ? trimmed.slice(1, -1).replace(/""/g, '"')
      : trimmed.toLowerCase();
  return clipBytes(name, MAX_IDENT_BYTES);
}

/** Dzieli `schemat.nazwa` po kropce leżącej poza cudzysłowem. */
function splitQualified(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of raw.trim()) {
    if (ch === '"') quoted = !quoted;
    if (ch === "." && !quoted) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

/**
 * Nazwa relacji w schemacie `public` albo `null` dla innego schematu.
 * Nazwa bez schematu trafia do `public` - tak rozwiązuje ją `search_path`
 * migracji Supabase.
 */
function publicName(raw: string): string | null {
  const parts = splitQualified(raw);
  if (parts.length === 1) return normalizeIdent(parts[0]);
  if (parts.length === 2 && normalizeIdent(parts[0]) === "public") return normalizeIdent(parts[1]);
  return null;
}

/** Koniec literału `'…'` (z `''`, a dla `E'…'` także z `\'`) - indeks ZA apostrofem. */
function endOfQuoted(sql: string, open: number, backslashEscapes: boolean): number {
  let j = open + 1;
  while (j < sql.length) {
    const ch = sql[j];
    if (backslashEscapes && ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "'") {
      if (sql[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return sql.length;
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

const DOLLAR_TAG_RE = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

/**
 * Jeden przebieg leksera SQL. `onToken` dostaje każdy fragment z rodzajem;
 * komentarze (także zagnieżdżone bloki) wypadają jako `comment`.
 */
type SqlChunk = "code" | "literal" | "ident" | "comment";

function lexSql(sql: string, onChunk: (kind: SqlChunk, start: number, end: number) => void): void {
  let i = 0;
  let codeStart = 0;
  const flush = (end: number) => {
    if (end > codeStart) onChunk("code", codeStart, end);
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    let end = -1;
    let kind: SqlChunk = "code";

    if (ch === "-" && next === "-") {
      end = sql.indexOf("\n", i);
      if (end < 0) end = sql.length;
      kind = "comment";
    } else if (ch === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      end = j;
      kind = "comment";
    } else if (ch === "'") {
      const eString = (sql[i - 1] === "E" || sql[i - 1] === "e") && !isIdentChar(sql[i - 2]);
      end = endOfQuoted(sql, i, eString);
      kind = "literal";
    } else if (ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      end = Math.min(j + 1, sql.length);
      kind = "ident";
    } else if (ch === "$" && !isIdentChar(sql[i - 1])) {
      DOLLAR_TAG_RE.lastIndex = i;
      const tag = DOLLAR_TAG_RE.exec(sql);
      if (tag !== null) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        end = close < 0 ? sql.length : close + tag[0].length;
        kind = "literal";
      }
    }

    if (end < 0) {
      i += 1;
      continue;
    }
    flush(i);
    onChunk(kind, i, end);
    i = end;
    codeStart = end;
  }
  flush(sql.length);
}

/** Instrukcje rozdzielone `;` najwyższego poziomu, z komentarzami zamienionymi na spację. */
export function splitSqlStatementsDeep(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  lexSql(sql, (kind, start, end) => {
    if (kind === "comment") {
      current += " ";
      return;
    }
    if (kind !== "code") {
      current += sql.slice(start, end);
      return;
    }
    let segment = start;
    for (let i = start; i < end; i += 1) {
      if (sql[i] !== ";") continue;
      current += sql.slice(segment, i);
      if (current.trim() !== "") out.push(current.trim());
      current = "";
      segment = i + 1;
    }
    current += sql.slice(segment, end);
  });
  if (current.trim() !== "") out.push(current.trim());
  return out;
}

/**
 * Ten sam tekst (ta sama długość), w którym treść literałów i komentarzy jest
 * spacjami, a przy `blankParens` - także wszystko wewnątrz nawiasów. Służy do
 * szukania słów kluczowych na właściwym poziomie, bez trafień w literały.
 */
function sqlView(text: string, blankParens: boolean): string {
  const chars = text.split("");
  lexSql(text, (kind, start, end) => {
    if (kind === "literal" || kind === "comment") {
      for (let i = start + 1; i < end - 1; i += 1) if (chars[i] !== "\n") chars[i] = " ";
      if (kind === "comment") {
        chars[start] = " ";
        if (end - 1 > start) chars[end - 1] = chars[end - 1] === "\n" ? "\n" : " ";
      }
    }
  });
  if (!blankParens) return chars.join("");
  let depth = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === "(") {
      depth += 1;
      if (depth > 1) chars[i] = " ";
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      if (depth > 0) chars[i] = " ";
    } else if (depth > 0 && ch !== "\n") chars[i] = " ";
  }
  return chars.join("");
}

/** Indeks nawiasu zamykającego dla `(` na pozycji `open` (literały pominięte). */
function matchParenSql(text: string, open: number): number {
  const view = sqlView(text, false);
  let depth = 0;
  for (let i = open; i < view.length; i += 1) {
    if (view[i] === "(") depth += 1;
    else if (view[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Podział po przecinkach najwyższego poziomu (nawiasy i literały respektowane). */
function splitTopLevelSql(text: string): string[] {
  const view = sqlView(text, false);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < view.length; i += 1) {
    const ch = view[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((part) => part.trim()).filter((part) => part !== "");
}

// ═══════════════════════════════════════════════════════════════════════════
// Model stanu końcowego
// ═══════════════════════════════════════════════════════════════════════════

interface KeyElement {
  /** Kolumna (znormalizowana) albo `(wyrażenie)`. */
  readonly text: string;
  readonly expression: boolean;
  /** Nazwa elementu do domyślnej nazwy indeksu (kolumna, nazwa funkcji, `expr`). */
  readonly nameHint: string;
}

interface StateKey {
  name: string;
  table: string;
  origin: UniqueKeyOrigin;
  columns: string[];
  partial: boolean;
  expression: boolean;
  deferrable: boolean;
  file: string;
  /** Tekst wyrażeń i predykatu - do `DROP COLUMN` / `RENAME COLUMN`. */
  extra: string;
}

interface StateTable {
  /** `null` - kolumny nieznane (CTAS, tabela spoza modelu). */
  columns: Set<string> | null;
}

class SchemaState {
  readonly tables = new Map<string, StateTable>();
  readonly keys = new Map<string, StateKey>();
  /** Nieunikalne indeksy: zajmują przestrzeń nazw relacji tak samo jak klucze. */
  readonly plainIndexes = new Map<string, string>();
  readonly views = new Set<string>();
  readonly dynamicDdl: DynamicDdl[] = [];
  statements = 0;

  nameTaken(name: string): boolean {
    return (
      this.tables.has(name) ||
      this.keys.has(name) ||
      this.plainIndexes.has(name) ||
      this.views.has(name)
    );
  }

  ensureTable(name: string): StateTable {
    let table = this.tables.get(name);
    if (table === undefined) {
      table = { columns: null };
      this.tables.set(name, table);
    }
    return table;
  }

  dropTable(name: string): void {
    this.tables.delete(name);
    for (const [keyName, key] of this.keys) if (key.table === name) this.keys.delete(keyName);
    for (const [idx, table] of this.plainIndexes) if (table === name) this.plainIndexes.delete(idx);
  }

  renameTable(from: string, to: string): void {
    const table = this.tables.get(from);
    if (table === undefined) return;
    this.tables.delete(from);
    this.tables.set(to, table);
    // Nazwy indeksów i ograniczeń NIE idą za tabelą (`x_pkey` zostaje `x_pkey`).
    for (const key of this.keys.values()) if (key.table === from) key.table = to;
    for (const [idx, owner] of this.plainIndexes)
      if (owner === from) this.plainIndexes.set(idx, to);
  }

  /** Nazwa indeksu: jawna albo wybrana tak jak `ChooseRelationName` w Postgresie. */
  chooseName(table: string, addition: string | null, label: string): string {
    let pass = 0;
    let modLabel = label;
    for (;;) {
      const candidate = makeObjectName(table, addition, modLabel);
      if (!this.nameTaken(candidate)) return candidate;
      pass += 1;
      modLabel = `${label}${pass}`;
    }
  }

  addKey(key: StateKey): void {
    // Ta sama nazwa nadpisuje: model odpowiada stanowi, nie historii błędów.
    this.plainIndexes.delete(key.name);
    this.keys.set(key.name, key);
  }
}

/** `makeObjectName` z Postgresa: przycina człony tak, by całość miała ≤ 63 bajty. */
function makeObjectName(name1: string, name2: string | null, label: string): string {
  const overhead = byteLength(label) + 1 + (name2 !== null ? 1 : 0);
  const available = MAX_IDENT_BYTES - overhead;
  let n1 = byteLength(name1);
  let n2 = name2 === null ? 0 : byteLength(name2);
  while (n1 + n2 > available) {
    if (n1 > n2) n1 -= 1;
    else n2 -= 1;
  }
  const head = clipBytes(name1, n1);
  return name2 === null ? `${head}_${label}` : `${head}_${clipBytes(name2, n2)}_${label}`;
}

/** `ChooseIndexNameAddition`: nazwy kolumn sklejone `_` aż do NAMEDATALEN bajtów. */
function indexNameAddition(names: readonly string[]): string {
  let buffer = "";
  for (const name of names) {
    if (buffer.length > 0) buffer += "_";
    buffer += name;
    if (byteLength(buffer) >= NAMEDATALEN) break;
  }
  return buffer;
}

/** `ChooseIndexColumnNames`: powtórzona nazwa elementu dostaje numer (`expr`, `expr1`). */
function uniqueElementNames(elements: readonly KeyElement[]): string[] {
  const used = new Set<string>();
  return elements.map((element) => {
    let candidate = element.nameHint;
    for (let n = 1; used.has(candidate); n += 1) candidate = `${element.nameHint}${n}`;
    used.add(candidate);
    return candidate;
  });
}

const COLUMN_ELEMENT_TAIL_RE = new RegExp(
  String.raw`^(?:\s*(?:COLLATE\s+${QNAME}|ASC|DESC|NULLS\s+(?:FIRST|LAST)|${QNAME}(?:\s*\([^)]*\))?))*\s*$`,
  "i",
);

/** Element indeksu: kolumna (z opcjonalnym COLLATE/opclass/ASC) albo wyrażenie. */
function parseIndexElement(raw: string): KeyElement {
  const text = raw.trim();
  const head = new RegExp(String.raw`^(${IDENT})([\s\S]*)$`).exec(text);
  if (head === null || text.startsWith("(")) {
    return {
      text: `(${text.replace(/^\(([\s\S]*)\)$/, "$1").trim()})`,
      expression: true,
      nameHint: "expr",
    };
  }
  const rest = head[2].trim();
  if (rest.startsWith("(")) {
    // Wywołanie funkcji: `lower(email)` - Postgres nazywa element nazwą funkcji.
    return { text: `(${text})`, expression: true, nameHint: normalizeIdent(head[1]) };
  }
  if (rest === "" || COLUMN_ELEMENT_TAIL_RE.test(rest)) {
    const column = normalizeIdent(head[1]);
    return { text: column, expression: false, nameHint: column };
  }
  return { text: `(${text})`, expression: true, nameHint: "expr" };
}

/** Lista kolumn ograniczenia `(a, "B", c)` - tu składnia dopuszcza wyłącznie kolumny. */
function parseColumnList(inner: string): string[] {
  return splitTopLevelSql(inner).map((part) => normalizeIdent(part));
}

interface KeyBody {
  readonly columns: readonly string[] | null;
  readonly usingIndex: string | null;
  readonly deferrable: boolean;
}

/** `DEFERRABLE`, ale nie `NOT DEFERRABLE`; `INITIALLY DEFERRED` implikuje odraczalność. */
function isDeferrable(view: string): boolean {
  return /(?<!\bNOT\s+)\bDEFERRABLE\b/i.test(view) || /\bINITIALLY\s+DEFERRED\b/i.test(view);
}

/** Reszta po `PRIMARY KEY` / `UNIQUE`: lista kolumn albo `USING INDEX nazwa`. */
function parseKeyBody(rest: string): KeyBody | null {
  const trimmed = rest.replace(/^\s*NULLS\s+(?:NOT\s+)?DISTINCT\s*/i, "");
  const using = new RegExp(String.raw`^\s*USING\s+INDEX\s+(${IDENT})(?!\s+TABLESPACE)`, "i").exec(
    trimmed,
  );
  if (using !== null && !/^\s*USING\s+INDEX\s+TABLESPACE\b/i.test(trimmed)) {
    return {
      columns: null,
      usingIndex: normalizeIdent(using[1]),
      deferrable: isDeferrable(trimmed),
    };
  }
  const open = trimmed.indexOf("(");
  if (open < 0 || trimmed.slice(0, open).trim() !== "") return null;
  const close = matchParenSql(trimmed, open);
  if (close < 0) return null;
  const tail = sqlView(trimmed.slice(close + 1), true);
  return {
    columns: parseColumnList(trimmed.slice(open + 1, close)),
    usingIndex: null,
    deferrable: isDeferrable(tail),
  };
}

interface PendingKey {
  readonly explicitName: string | null;
  readonly primary: boolean;
  readonly columns: readonly string[];
  readonly deferrable: boolean;
}

/** Ograniczenia PK/UNIQUE zadeklarowane PRZY KOLUMNIE (`email text UNIQUE`). */
function columnConstraintKeys(column: string, definition: string): PendingKey[] {
  const view = sqlView(definition, true);
  const re = new RegExp(
    String.raw`\b(?:CONSTRAINT\s+(${IDENT})\s+)?(PRIMARY\s+KEY|UNIQUE)\b(?:\s+NULLS\s+(?:NOT\s+)?DISTINCT)?`,
    "gi",
  );
  const out: PendingKey[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(view)) !== null) {
    // Odraczalność dotyczy ograniczenia, za którym stoi - do następnego.
    const after = view.slice(match.index + match[0].length);
    const stop =
      /\b(?:CONSTRAINT|PRIMARY|UNIQUE|REFERENCES|CHECK|DEFAULT|GENERATED|NOT\s+NULL|NULL)\b/i.exec(
        after,
      );
    const scope = stop === null ? after : after.slice(0, stop.index);
    out.push({
      explicitName: match[1] === undefined ? null : normalizeIdent(match[1]),
      primary: /^PRIMARY/i.test(match[2]),
      columns: [column],
      deferrable: isDeferrable(scope),
    });
  }
  return out;
}

const TABLE_KEY_RE = new RegExp(
  String.raw`^(?:CONSTRAINT\s+(${IDENT})\s+)?(PRIMARY\s+KEY|UNIQUE)\b([\s\S]*)$`,
  "i",
);
const TABLE_OTHER_CONSTRAINT_RE = new RegExp(
  String.raw`^(?:CONSTRAINT\s+${IDENT}\s+)?(?:CHECK|FOREIGN\s+KEY|EXCLUDE)\b`,
  "i",
);
const COLUMN_DEF_RE = new RegExp(String.raw`^(${IDENT})(\s[\s\S]*)?$`);

/** Klucze z listy klucz-ograniczenie, nazwane i zarejestrowane w kolejności Postgresa. */
function registerKeys(
  state: SchemaState,
  table: string,
  pending: readonly PendingKey[],
  file: string,
): void {
  for (const key of pending) {
    const name =
      key.explicitName ??
      (key.primary
        ? state.chooseName(table, null, "pkey")
        : state.chooseName(table, indexNameAddition(key.columns), "key"));
    state.addKey({
      name,
      table,
      origin: key.primary ? "primary" : "unique",
      columns: [...key.columns],
      partial: false,
      expression: false,
      deferrable: key.deferrable,
      file,
      extra: "",
    });
  }
}

const CREATE_TABLE_RE = new RegExp(
  String.raw`^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(${QNAME})\s*([\s\S]*)$`,
  "i",
);

function applyCreateTable(state: SchemaState, statement: string, file: string): boolean {
  const match = CREATE_TABLE_RE.exec(statement);
  if (match === null) return false;
  if (match[1] !== undefined && /^TEMP/i.test(match[1])) return true;
  const table = publicName(match[3]);
  if (table === null) return true;
  if (match[2] !== undefined && state.tables.has(table)) return true;

  const rest = match[4];
  if (!rest.startsWith("(")) {
    // `AS SELECT` / `AS TABLE` / `PARTITION OF` / `OF typ`: tabela istnieje,
    // CTAS nie kopiuje indeksów, a kolumn nie znamy.
    state.dropTable(table);
    state.tables.set(table, { columns: null });
    return true;
  }
  const close = matchParenSql(rest, 0);
  const inner = rest.slice(1, close < 0 ? rest.length : close);

  state.dropTable(table);
  const columns = new Set<string>();
  state.tables.set(table, { columns });

  const collected: PendingKey[] = [];
  for (const element of splitTopLevelSql(inner)) {
    const keyMatch = TABLE_KEY_RE.exec(element);
    if (keyMatch !== null) {
      const body = parseKeyBody(keyMatch[3]);
      if (body !== null && body.columns !== null) {
        collected.push({
          explicitName: keyMatch[1] === undefined ? null : normalizeIdent(keyMatch[1]),
          primary: /^PRIMARY/i.test(keyMatch[2]),
          columns: body.columns,
          deferrable: body.deferrable,
        });
        continue;
      }
    }
    if (TABLE_OTHER_CONSTRAINT_RE.test(element) || /^LIKE\b/i.test(element)) continue;
    const column = COLUMN_DEF_RE.exec(element);
    if (column === null) continue;
    const name = normalizeIdent(column[1]);
    columns.add(name);
    collected.push(...columnConstraintKeys(name, column[2] ?? ""));
  }

  // `transformIndexConstraints`: PK idzie pierwszy, a UNIQUE identyczny
  // z wcześniejszym kluczem (ta sama lista kolumn) jest z nim scalany - stąd
  // `id uuid PRIMARY KEY UNIQUE` daje JEDEN indeks `<tabela>_pkey`.
  const primary = collected.filter((key) => key.primary);
  const ordered = [...primary.slice(0, 1), ...collected.filter((key) => !key.primary)];
  const final: PendingKey[] = [];
  for (const key of ordered) {
    const twin = final.find(
      (prior) =>
        prior.columns.join("\u0000") === key.columns.join("\u0000") &&
        prior.deferrable === key.deferrable,
    );
    if (twin === undefined) {
      final.push(key);
      continue;
    }
    if (twin.explicitName === null && key.explicitName !== null) {
      final[final.indexOf(twin)] = { ...twin, explicitName: key.explicitName };
    }
  }
  registerKeys(state, table, final, file);
  return true;
}

const CREATE_INDEX_RE = new RegExp(
  String.raw`^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?(?:(${IDENT})\s+)?ON\s+(?:ONLY\s+)?(${QNAME})\s*(?:USING\s+(?:${IDENT})\s*)?\(`,
  "i",
);

function applyCreateIndex(state: SchemaState, statement: string, file: string): boolean {
  const match = CREATE_INDEX_RE.exec(statement);
  if (match === null) return false;
  const table = publicName(match[4]);
  if (table === null) return true;
  const explicit = match[3] === undefined ? null : normalizeIdent(match[3]);
  if (match[2] !== undefined && explicit !== null && state.nameTaken(explicit)) return true;

  const open = match[0].length - 1;
  const close = matchParenSql(statement, open);
  if (close < 0) return true;
  const elements = splitTopLevelSql(statement.slice(open + 1, close)).map(parseIndexElement);
  const tail = statement.slice(close + 1);
  const tailView = sqlView(tail, true);
  const where = /\bWHERE\b/i.exec(tailView);
  const unique = match[1] !== undefined;

  const name =
    explicit ?? state.chooseName(table, indexNameAddition(uniqueElementNames(elements)), "idx");

  // Indeks na widoku zmaterializowanym zajmuje nazwę, ale celem upsertu
  // widok nie jest - nie wolno mu więc „powołać" tabeli w modelu.
  if (!unique || (state.views.has(table) && !state.tables.has(table))) {
    state.keys.delete(name);
    state.plainIndexes.set(name, table);
    return true;
  }
  state.ensureTable(table);
  state.addKey({
    name,
    table,
    origin: "index",
    columns: elements.map((element) => element.text),
    partial: where !== null,
    expression: elements.some((element) => element.expression),
    deferrable: false,
    file,
    extra: [
      ...elements.filter((element) => element.expression).map((element) => element.text),
      where === null ? "" : tail.slice(where.index),
    ]
      .join(" ")
      .toLowerCase(),
  });
  return true;
}

const DROP_INDEX_RE =
  /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\s\S]*?)(?:\s+(?:CASCADE|RESTRICT))?\s*$/i;

function applyDropIndex(state: SchemaState, statement: string): boolean {
  const match = DROP_INDEX_RE.exec(statement);
  if (match === null) return false;
  for (const raw of splitTopLevelSql(match[1])) {
    const name = publicName(raw);
    if (name === null) continue;
    state.keys.delete(name);
    state.plainIndexes.delete(name);
  }
  return true;
}

const ALTER_INDEX_RENAME_RE = new RegExp(
  String.raw`^ALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?(${QNAME})\s+RENAME\s+TO\s+(${IDENT})\s*$`,
  "i",
);

function applyAlterIndex(state: SchemaState, statement: string): boolean {
  if (!/^ALTER\s+INDEX\b/i.test(statement)) return false;
  const match = ALTER_INDEX_RENAME_RE.exec(statement);
  if (match === null) return true;
  const from = publicName(match[1]);
  if (from === null) return true;
  const to = normalizeIdent(match[2]);
  const key = state.keys.get(from);
  if (key !== undefined) {
    state.keys.delete(from);
    key.name = to;
    state.keys.set(to, key);
  }
  const plain = state.plainIndexes.get(from);
  if (plain !== undefined) {
    state.plainIndexes.delete(from);
    state.plainIndexes.set(to, plain);
  }
  return true;
}

const DROP_TABLE_RE =
  /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]*?)(?:\s+(?:CASCADE|RESTRICT))?\s*$/i;

function applyDropTable(state: SchemaState, statement: string): boolean {
  const match = DROP_TABLE_RE.exec(statement);
  if (match === null) return false;
  for (const raw of splitTopLevelSql(match[1])) {
    const name = publicName(raw);
    if (name !== null) state.dropTable(name);
  }
  return true;
}

const VIEW_CREATE_RE = new RegExp(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMP|TEMPORARY)\s+)?(?:RECURSIVE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`,
  "i",
);
const VIEW_DROP_RE =
  /^DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?([\s\S]*?)(?:\s+(?:CASCADE|RESTRICT))?\s*$/i;

function applyViews(state: SchemaState, statement: string): boolean {
  const created = VIEW_CREATE_RE.exec(statement);
  if (created !== null) {
    const name = publicName(created[1]);
    if (name !== null) state.views.add(name);
    return true;
  }
  const dropped = VIEW_DROP_RE.exec(statement);
  if (dropped === null) return false;
  for (const raw of splitTopLevelSql(dropped[1])) {
    const name = publicName(raw);
    if (name !== null) state.views.delete(name);
  }
  return true;
}

const ALTER_TABLE_RE = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})\s*\*?\s+([\s\S]*)$`,
  "i",
);
const RENAME_TABLE_RE = new RegExp(String.raw`^RENAME\s+TO\s+(${IDENT})\s*$`, "i");
const RENAME_CONSTRAINT_RE = new RegExp(
  String.raw`^RENAME\s+CONSTRAINT\s+(${IDENT})\s+TO\s+(${IDENT})\s*$`,
  "i",
);
const RENAME_COLUMN_RE = new RegExp(
  String.raw`^RENAME\s+(?:COLUMN\s+)?(${IDENT})\s+TO\s+(${IDENT})\s*$`,
  "i",
);
const SET_SCHEMA_RE = new RegExp(String.raw`^SET\s+SCHEMA\s+(${IDENT})\s*$`, "i");
const ADD_KEY_RE = new RegExp(
  String.raw`^ADD\s+(?:CONSTRAINT\s+(${IDENT})\s+)?(PRIMARY\s+KEY|UNIQUE)\b([\s\S]*)$`,
  "i",
);
const ADD_NON_COLUMN_RE = new RegExp(
  String.raw`^ADD\s+(?:CONSTRAINT\b|CHECK\b|FOREIGN\s+KEY\b|EXCLUDE\b)`,
  "i",
);
const ADD_COLUMN_RE = new RegExp(
  String.raw`^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?(${IDENT})(\s[\s\S]*)?$`,
  "i",
);
const DROP_CONSTRAINT_RE = new RegExp(
  String.raw`^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(${IDENT})`,
  "i",
);
const DROP_COLUMN_RE = new RegExp(
  String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(${IDENT})`,
  "i",
);

function wordRe(word: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_$])${word.replace(/[$]/g, "\\$")}(?![A-Za-z0-9_$])`, "i");
}

function applyAlterTable(state: SchemaState, statement: string, file: string): boolean {
  const match = ALTER_TABLE_RE.exec(statement);
  if (match === null) return false;
  const table = publicName(match[2]);
  if (table === null) return true;
  const ifExists = match[1] !== undefined;
  if (ifExists && !state.tables.has(table)) return true;
  const actions = match[3].trim();

  const renameTable = RENAME_TABLE_RE.exec(actions);
  if (renameTable !== null) {
    state.renameTable(table, normalizeIdent(renameTable[1]));
    return true;
  }
  const renameConstraint = RENAME_CONSTRAINT_RE.exec(actions);
  if (renameConstraint !== null) {
    const from = normalizeIdent(renameConstraint[1]);
    const to = normalizeIdent(renameConstraint[2]);
    const key = state.keys.get(from);
    // Zmiana nazwy ograniczenia z indeksem zmienia też nazwę indeksu.
    if (key !== undefined && key.table === table) {
      state.keys.delete(from);
      key.name = to;
      state.keys.set(to, key);
    }
    return true;
  }
  const renameColumn = RENAME_COLUMN_RE.exec(actions);
  if (renameColumn !== null) {
    const from = normalizeIdent(renameColumn[1]);
    const to = normalizeIdent(renameColumn[2]);
    const columns = state.tables.get(table)?.columns;
    if (columns) {
      columns.delete(from);
      columns.add(to);
    }
    const mentions = new RegExp(wordRe(from).source, "gi");
    for (const key of state.keys.values()) {
      if (key.table !== table) continue;
      key.columns = key.columns.map((column) => (column === from ? to : column));
      key.extra = key.extra.replace(mentions, `$1${to}`);
    }
    return true;
  }
  const setSchema = SET_SCHEMA_RE.exec(actions);
  if (setSchema !== null) {
    if (normalizeIdent(setSchema[1]) !== "public") state.dropTable(table);
    return true;
  }

  for (const action of splitTopLevelSql(actions)) {
    const addKey = ADD_KEY_RE.exec(action);
    if (addKey !== null) {
      const body = parseKeyBody(addKey[3]);
      if (body === null) continue;
      const primary = /^PRIMARY/i.test(addKey[2]);
      const explicitName = addKey[1] === undefined ? null : normalizeIdent(addKey[1]);
      if (body.usingIndex !== null) {
        // `ADD CONSTRAINT x UNIQUE USING INDEX i`: indeks staje się
        // ograniczeniem i przyjmuje jego nazwę.
        const index = state.keys.get(body.usingIndex);
        if (index === undefined) continue;
        state.keys.delete(index.name);
        index.name = explicitName ?? index.name;
        index.origin = primary ? "primary" : "unique";
        index.deferrable = body.deferrable;
        index.file = file;
        state.keys.set(index.name, index);
        continue;
      }
      state.ensureTable(table);
      registerKeys(
        state,
        table,
        [{ explicitName, primary, columns: body.columns ?? [], deferrable: body.deferrable }],
        file,
      );
      continue;
    }
    if (ADD_NON_COLUMN_RE.test(action)) continue;

    const addColumn = ADD_COLUMN_RE.exec(action);
    if (addColumn !== null) {
      const column = normalizeIdent(addColumn[2]);
      const known = state.tables.get(table)?.columns;
      if (addColumn[1] !== undefined && known?.has(column)) continue;
      known?.add(column);
      const keys = columnConstraintKeys(column, addColumn[3] ?? "");
      if (keys.length > 0) {
        state.ensureTable(table);
        registerKeys(state, table, keys, file);
      }
      continue;
    }

    const dropConstraint = DROP_CONSTRAINT_RE.exec(action);
    if (dropConstraint !== null) {
      const name = normalizeIdent(dropConstraint[1]);
      if (state.keys.get(name)?.table === table) state.keys.delete(name);
      continue;
    }

    const dropColumn = DROP_COLUMN_RE.exec(action);
    if (dropColumn !== null) {
      const column = normalizeIdent(dropColumn[1]);
      if (["constraint", "not", "default", "identity", "expression"].includes(column)) continue;
      state.tables.get(table)?.columns?.delete(column);
      // Postgres zdejmuje każdy indeks i każde ograniczenie tabeli, które
      // dotyka kolumny - także wielokolumnowe, bez CASCADE.
      const mentions = wordRe(column);
      for (const [name, key] of state.keys) {
        if (key.table !== table) continue;
        if (key.columns.includes(column) || mentions.test(key.extra)) state.keys.delete(name);
      }
    }
  }
  return true;
}

const DDL_HEAD_RE =
  /\b(?:ALTER\s+TABLE|ALTER\s+INDEX|DROP\s+TABLE|DROP\s+INDEX|CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW|DROP\s+(?:MATERIALIZED\s+)?VIEW)\b/i;
const KEY_DDL_HINT_RE =
  /\b(?:UNIQUE|PRIMARY\s+KEY|CONSTRAINT|INDEX|RENAME|DROP\s+TABLE|DROP\s+COLUMN|CREATE\s+TABLE)\b/i;

/** Ciało bloku `DO` - patrz „POLITYKA BLOKÓW DO" w nagłówku. */
function applyDoBlock(state: SchemaState, statement: string, file: string, depth: number): void {
  const head = /^DO\s+(?:LANGUAGE\s+\w+\s+)?/i.exec(statement);
  if (head === null) return;
  DOLLAR_TAG_RE.lastIndex = head[0].length;
  const tag = DOLLAR_TAG_RE.exec(statement);
  if (tag === null || tag.index !== head[0].length) return;
  const bodyStart = tag.index + tag[0].length;
  const bodyEnd = statement.indexOf(tag[0], bodyStart);
  const body = statement.slice(bodyStart, bodyEnd < 0 ? statement.length : bodyEnd);

  for (const fragment of splitSqlStatementsDeep(body)) {
    const view = sqlView(fragment, false);
    const execute = /\bEXECUTE\b/i.exec(view);
    if (execute !== null) {
      const argument = fragment.slice(execute.index + execute[0].length).trim();
      const literal = /^(E?)'((?:[^']|'')*)'$/.exec(argument);
      if (literal !== null) {
        const sql = literal[2].replace(/''/g, "'");
        for (const inner of splitSqlStatementsDeep(sql))
          applyStatement(state, inner, file, depth + 1);
      } else if (KEY_DDL_HINT_RE.test(argument)) {
        state.dynamicDdl.push({ file, text: argument.replace(/\s+/g, " ").slice(0, 200) });
      }
      continue;
    }
    const ddl = DDL_HEAD_RE.exec(view);
    if (ddl !== null) applyStatement(state, fragment.slice(ddl.index), file, depth + 1);
  }
}

function applyStatement(state: SchemaState, raw: string, file: string, depth: number): void {
  const statement = raw.trim();
  if (depth > 4) return;
  if (/^DO\b/i.test(statement)) {
    applyDoBlock(state, statement, file, depth);
    return;
  }
  // Kolejność ma znaczenie tylko tam, gdzie wyrażenia nachodzą na siebie:
  // `CREATE TABLE` przed `CREATE … VIEW`, `ALTER INDEX` przed `ALTER TABLE`.
  if (applyCreateTable(state, statement, file)) return;
  if (applyCreateIndex(state, statement, file)) return;
  if (applyDropIndex(state, statement)) return;
  if (applyAlterIndex(state, statement)) return;
  if (applyDropTable(state, statement)) return;
  if (applyViews(state, statement)) return;
  applyAlterTable(state, statement, file);
}

/**
 * Stan końcowy kluczy unikalnych `public` po wszystkich migracjach.
 *
 * Migracje muszą przyjść POSORTOWANE (kolejność nazw plików = kolejność
 * stosowania przez `supabase db push` i `db reset`).
 */
export function buildUniqueKeyModel(migrations: readonly MigrationFile[]): UniqueKeyModel {
  const state = new SchemaState();
  for (const { file, sql } of migrations) {
    for (const statement of splitSqlStatementsDeep(sql)) {
      state.statements += 1;
      applyStatement(state, statement, file, 0);
    }
  }

  const tables = new Map<string, UniqueKey[]>();
  for (const name of [...state.tables.keys()].sort()) tables.set(name, []);
  for (const key of state.keys.values()) {
    const bucket = tables.get(key.table) ?? [];
    bucket.push({
      name: key.name,
      origin: key.origin,
      columns: [...key.columns],
      partial: key.partial,
      expression: key.expression,
      deferrable: key.deferrable,
      file: key.file,
    });
    tables.set(key.table, bucket);
  }
  for (const bucket of tables.values()) bucket.sort((a, b) => a.name.localeCompare(b.name));

  return {
    tables,
    views: new Set(state.views),
    dynamicDdl: state.dynamicDdl,
    statements: state.statements,
  };
}

/** Klucz, którym Postgres rozwiąże `ON CONFLICT (kolumny)` bez predykatu. */
export function isArbiterCandidate(key: UniqueKey): boolean {
  return !key.partial && !key.expression && !key.deferrable;
}

// ═══════════════════════════════════════════════════════════════════════════
// Leksyka TS: maskowanie napisów
// ═══════════════════════════════════════════════════════════════════════════

interface StringToken {
  readonly start: number;
  /** Indeks ZA znakiem zamykającym. */
  readonly end: number;
  /** Treść; `null` - szablon z `${}` albo napis niedomknięty. */
  readonly value: string | null;
}

interface LexedSource {
  /** Kod z komentarzami ORAZ treścią napisów/wyrażeń regularnych zamienioną na spacje. */
  readonly code: string;
  readonly strings: ReadonlyMap<number, StringToken>;
}

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^\n".split(""));
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void"]);

/** Ta sama heurystyka co w `sourceScan.ts`: czy `/` zaczyna wyrażenie regularne. */
function startsRegex(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (src[j] === " " || src[j] === "\t")) j -= 1;
  if (j < 0) return true;
  if (REGEX_PRECEDERS.has(src[j])) return true;
  if (/[a-z]/.test(src[j])) {
    let start = j;
    while (start > 0 && /[a-zA-Z]/.test(src[start - 1])) start -= 1;
    return REGEX_KEYWORDS.has(src.slice(start, j + 1));
  }
  return false;
}

/**
 * Wejście: źródło PO `bezKomentarzy`. Wyjście: ten sam tekst (ta sama długość
 * i numeracja linii), w którym treść napisów, szablonów i wyrażeń regularnych
 * to spacje, plus mapa napisów po pozycji otwarcia. Dzięki temu składnię
 * (`.upsert(`, `onConflict:`, nawiasy) szuka się bez trafień w treść napisów,
 * a wartości literałów czyta się z mapy.
 */
function lexSource(src: string): LexedSource {
  const out: string[] = [];
  const strings = new Map<number, StringToken>();
  const blank = (ch: string) => (ch === "\n" ? "\n" : " ");
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const start = i;
      let value = "";
      let closed = false;
      out.push(c);
      i += 1;
      // Zwykły napis nie przechodzi przez koniec linii - apostrof w tekście
      // JSX nie może więc połknąć więcej niż reszty swojej linii.
      while (i < src.length && src[i] !== "\n") {
        if (src[i] === "\\") {
          value += src[i + 1] ?? "";
          out.push(" ", blank(src[i + 1] ?? " "));
          i += 2;
          continue;
        }
        if (src[i] === c) {
          out.push(c);
          i += 1;
          closed = true;
          break;
        }
        value += src[i];
        out.push(" ");
        i += 1;
      }
      strings.set(start, { start, end: i, value: closed ? value : null });
      continue;
    }
    if (c === "`") {
      const start = i;
      let value = "";
      let dynamic = false;
      let closed = false;
      let depth = 0;
      out.push(c);
      i += 1;
      while (i < src.length) {
        const d = src[i];
        if (depth === 0) {
          if (d === "\\") {
            value += src[i + 1] ?? "";
            out.push(" ", blank(src[i + 1] ?? " "));
            i += 2;
            continue;
          }
          if (d === "`") {
            out.push("`");
            i += 1;
            closed = true;
            break;
          }
          if (d === "$" && src[i + 1] === "{") {
            dynamic = true;
            depth = 1;
            out.push(" ", " ");
            i += 2;
            continue;
          }
          value += d;
          out.push(blank(d));
          i += 1;
          continue;
        }
        if (d === "{") depth += 1;
        else if (d === "}") depth -= 1;
        out.push(blank(d));
        i += 1;
      }
      strings.set(start, { start, end: i, value: closed && !dynamic ? value : null });
      continue;
    }
    if (c === "/" && startsRegex(src, i)) {
      out.push("/");
      i += 1;
      let inClass = false;
      while (i < src.length && src[i] !== "\n") {
        const d = src[i];
        if (d === "\\") {
          out.push(" ", blank(src[i + 1] ?? " "));
          i += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          out.push("/");
          i += 1;
          break;
        }
        out.push(" ");
        i += 1;
      }
      continue;
    }
    out.push(c);
    i += 1;
  }
  return { code: out.join(""), strings };
}

/** Indeks nawiasu zamykającego w kodzie z zamaskowanymi napisami. */
function matchCloseTs(code: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch in pairs) stack.push(pairs[ch]);
    else if (ch === ")" || ch === "]" || ch === "}") {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Zakresy argumentów wywołania - przecinki najwyższego poziomu między nawiasami. */
function argumentRanges(code: string, open: number, close: number): [number, number][] {
  const ranges: [number, number][] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      ranges.push([start, i]);
      start = i + 1;
    }
  }
  if (code.slice(start, close).trim() !== "") ranges.push([start, close]);
  return ranges;
}

/**
 * Początek wyrażenia-odbiorcy dla `.upsert` na pozycji `dot`: cofamy się przez
 * łańcuch (wywołania, indeksowanie, rzutowania w nawiasach) aż do granicy
 * wyrażenia na najniższym poziomie.
 */
function receiverStart(code: string, dot: number): number {
  let depth = 0;
  for (let i = dot - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      // Treść napisów jest zamaskowana - otwarcie to poprzedni ten sam znak.
      const open = code.lastIndexOf(ch, i - 1);
      i = open < 0 ? 0 : open;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") depth += 1;
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (depth === 0) return i + 1;
      depth -= 1;
    } else if (depth === 0) {
      if (ch === ";" || ch === "," || ch === "=" || ch === ":" || ch === "&" || ch === "|") {
        return i + 1;
      }
      if (ch === "?" && code[i + 1] !== ".") return i + 1;
    }
  }
  return 0;
}

function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) if (code[i] === "\n") line += 1;
  return line;
}

function excerptAt(raw: string, index: number): string {
  const start = raw.lastIndexOf("\n", index - 1) + 1;
  const end = raw.indexOf("\n", index);
  return raw.slice(start, end < 0 ? raw.length : end).trim();
}

/**
 * Stałe napisowe pliku: `const NAZWA = "…"` (także `as const` i z adnotacją
 * typu). Nazwa zadeklarowana w pliku więcej niż raz jest niejednoznaczna
 * (cieniowanie) - wtedy brak wpisu i cel trafia do nierozstrzygniętych.
 */
function stringConstants(lexed: LexedSource): Map<string, string | null> {
  // Wyłącznie `const`: `let` można nadpisać, więc jego wartość z deklaracji
  // nie jest wartością w miejscu wywołania.
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*/g;
  const out = new Map<string, string | null>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(lexed.code)) !== null) {
    const token = lexed.strings.get(match.index + match[0].length);
    const tail = token === undefined ? "" : lexed.code.slice(token.end);
    const value =
      token !== undefined && token.value !== null && /^\s*(?:as\s+const\s*)?[;,\n)]/.test(tail)
        ? token.value
        : null;
    out.set(match[1], out.has(match[1]) ? null : value);
  }
  return out;
}

/** Literał napisowy zaczynający się na `at` (po białych znakach), z granicą wyrażenia. */
function literalAt(lexed: LexedSource, at: number): StringToken | null {
  let j = at;
  while (j < lexed.code.length && /\s/.test(lexed.code[j])) j += 1;
  const token = lexed.strings.get(j);
  if (token === undefined) return null;
  const tail = lexed.code.slice(token.end);
  return /^\s*(?:as\s+const\s*)?[,})\]]/.test(tail) ? token : null;
}

interface ConflictProperty {
  /** Pozycja nazwy właściwości. */
  readonly at: number;
  /** Pozycja ZA dwukropkiem. */
  readonly valueAt: number;
}

/**
 * Wszystkie właściwości `onConflict: …` (także `"onConflict": …`) poza typami.
 * `onConflict?: string` i `onConflict: string` w typie nie są celem konfliktu.
 */
function conflictProperties(lexed: LexedSource): ConflictProperty[] {
  const out: ConflictProperty[] = [];
  const identRe = /(?<![\w$.])onConflict\s*(\?\s*)?:/g;
  let match: RegExpExecArray | null;
  while ((match = identRe.exec(lexed.code)) !== null) {
    if (match[1] !== undefined) continue;
    out.push({ at: match.index, valueAt: match.index + match[0].length });
  }
  // Skrót `{ onConflict }` - wartością jest zmienna o tej nazwie; bez tego
  // wpisu cel przechodziłby obok bramki bez śladu.
  const shorthandRe = /(?<![\w$.])onConflict(?=\s*[,}])/g;
  while ((match = shorthandRe.exec(lexed.code)) !== null) {
    out.push({ at: match.index, valueAt: match.index });
  }
  for (const token of lexed.strings.values()) {
    if (token.value !== "onConflict") continue;
    const colon = /^\s*:/.exec(lexed.code.slice(token.end));
    if (colon !== null) out.push({ at: token.start, valueAt: token.end + colon[0].length });
  }
  return out
    .filter(({ valueAt }) => {
      const value = lexed.code.slice(valueAt, valueAt + 64);
      return !/^\s*(?:string|undefined|null|never)\b\s*(?:[;,})|]|$)/.test(value);
    })
    .sort((a, b) => a.at - b.at);
}

/** Tabela z odbiorcy: najbliższe `.from("…")`, potem pomocnik z literałem znanej tabeli. */
function resolveTable(
  lexed: LexedSource,
  constants: ReadonlyMap<string, string | null>,
  start: number,
  end: number,
  knownTables: ReadonlySet<string>,
  depth = 0,
): { table: string } | { reason: string } {
  const receiver = lexed.code.slice(start, end);
  const schema = /\.schema\s*\(\s*/g.exec(receiver);
  if (schema !== null) {
    const token = literalAt(lexed, start + schema.index + schema[0].length);
    if (token?.value !== "public") {
      return { reason: "odbiorca ustawia `.schema(...)` - cel poza schematem public" };
    }
  }

  const fromRe = /\.from\s*(?:<[^>()]*>\s*)?\(\s*/g;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = fromRe.exec(receiver)) !== null) last = match;
  if (last !== null) {
    const at = start + last.index + last[0].length;
    const token = literalAt(lexed, at) ?? lexed.strings.get(at) ?? null;
    if (token !== null) {
      return token.value === null
        ? { reason: "nazwa tabeli w `.from(...)` jest szablonem z `${}`" }
        : { table: token.value };
    }
    const ident = /^([A-Za-z_$][\w$]*)\s*(?:as\s+[^)]*)?\)/.exec(lexed.code.slice(at));
    const constant = ident === null ? undefined : constants.get(ident[1]);
    if (constant !== undefined && constant !== null) return { table: constant };
    return { reason: "nazwa tabeli w `.from(...)` nie jest literałem ani stałą tego pliku" };
  }

  // Odbiorca bez `.from`: zmienna z zapytaniem (`const q = db.from("t")`).
  const bare = /^\s*(?:(?:return|await|yield)\s+)*([A-Za-z_$][\w$]*)\s*$/.exec(receiver);
  if (bare !== null && depth === 0) {
    const decl = new RegExp(
      String.raw`\bconst\s+${bare[1].replace(/\$/g, "\\$")}\s*(?::[^=;]+)?=`,
    ).exec(lexed.code.slice(0, start));
    if (decl !== null) {
      const initStart = decl.index + decl[0].length;
      const semi = lexed.code.indexOf(";", initStart);
      const resolved = resolveTable(
        lexed,
        constants,
        initStart,
        semi < 0 ? start : Math.min(semi, start),
        knownTables,
        depth + 1,
      );
      if ("table" in resolved) return resolved;
    }
  }

  // Pomocnik: `write(context, "crm_leads").upsert(...)`.
  const candidates = new Set<string>();
  for (const token of lexed.strings.values()) {
    if (token.start < start || token.end > end || token.value === null) continue;
    if (knownTables.has(token.value)) candidates.add(token.value);
  }
  if (candidates.size === 1) return { table: [...candidates][0] };
  if (candidates.size > 1) {
    return {
      reason: `odbiorca wskazuje kilka znanych tabel: ${[...candidates].sort().join(", ")}`,
    };
  }
  return { reason: 'nie da się ustalić tabeli (brak `.from("…")` i literału znanej tabeli)' };
}

/** Normalizacja celu tak, jak widzi go PostgREST: przecinki, bez cudzysłowów. */
export function parseConflictTarget(target: string): string[] {
  return target
    .split(",")
    .map((part) => part.trim().replace(/^"(.*)"$/, "$1"))
    .filter((part) => part !== "");
}

export interface ExtractedTargets {
  readonly sites: readonly OnConflictSite[];
  readonly unresolved: readonly UnresolvedOnConflict[];
  readonly upsertCalls: number;
}

/** Cele `onConflict` ze źródeł - patrz punkt B i „ZAMKNIĘTE NA NIEPEWNOŚĆ" w nagłówku. */
export function extractOnConflictTargets(
  sources: readonly SourceFile[],
  knownTables: ReadonlySet<string>,
): ExtractedTargets {
  const sites: OnConflictSite[] = [];
  const unresolved: UnresolvedOnConflict[] = [];
  let upsertCalls = 0;

  for (const { file, code: raw } of sources) {
    if (!raw.includes("upsert") && !raw.includes("onConflict")) continue;
    const lexed = lexSource(bezKomentarzy(raw));
    const { code } = lexed;
    const properties = conflictProperties(lexed);
    const consumed = new Set<number>();
    const constants = stringConstants(lexed);
    const report = (at: number, reason: string) =>
      unresolved.push({ file, line: lineOf(code, at), reason, excerpt: excerptAt(raw, at) });

    const upsertRe = /\.upsert\s*(?:<[^>()]*>\s*)?\(/g;
    let call: RegExpExecArray | null;
    while ((call = upsertRe.exec(code)) !== null) {
      upsertCalls += 1;
      const open = call.index + call[0].length - 1;
      const close = matchCloseTs(code, open);
      if (close < 0) continue;
      const args = argumentRanges(code, open, close);
      if (args.length < 2) continue;
      // Opcje to OSTATNI argument: przecinek w generyku pierwszego
      // (`x as Record<string, Json>`) nie przesuwa ich wtedy pozycji.
      const [argStart, argEnd] = args[args.length - 1];
      const objectStart = code.indexOf("{", argStart);
      if (
        objectStart < 0 ||
        objectStart >= argEnd ||
        code.slice(argStart, objectStart).trim() !== ""
      ) {
        continue;
      }
      const objectEnd = matchCloseTs(code, objectStart);
      const inside = properties.filter((prop) => prop.at > objectStart && prop.at < objectEnd);
      if (inside.length === 0) continue;

      const table = resolveTable(
        lexed,
        constants,
        receiverStart(code, call.index),
        call.index,
        knownTables,
      );
      for (const prop of inside) {
        consumed.add(prop.at);
        const literal = literalAt(lexed, prop.valueAt);
        let target: string | null = literal?.value ?? null;
        let viaConstant: string | null = null;
        let valueAt = literal?.start ?? prop.valueAt;
        if (literal === null) {
          const ident = /^\s*([A-Za-z_$][\w$]*)\s*(?:as\s+const\s*)?[,}]/.exec(
            code.slice(prop.valueAt),
          );
          const constant = ident === null ? undefined : constants.get(ident[1]);
          if (ident !== null && constant !== undefined && constant !== null) {
            target = constant;
            viaConstant = ident[1];
            valueAt = prop.valueAt + ident[0].indexOf(ident[1]);
          }
        }
        if (target === null) {
          report(
            prop.at,
            "wartość `onConflict` nie jest literałem ani stałą napisową tego pliku - cel nie do sprawdzenia",
          );
          continue;
        }
        if ("reason" in table) {
          report(prop.at, table.reason);
          continue;
        }
        const columns = parseConflictTarget(target);
        if (columns.length === 0) {
          report(prop.at, "pusty cel `onConflict`");
          continue;
        }
        sites.push({
          file,
          line: lineOf(code, valueAt),
          table: table.table,
          target,
          columns,
          viaConstant,
        });
      }
    }

    for (const prop of properties) {
      if (consumed.has(prop.at)) continue;
      report(
        prop.at,
        "`onConflict` poza literałem opcji `.upsert(...)` (zmienna z opcjami, pomocnik) - cel nie do powiązania z tabelą",
      );
    }
  }

  return { sites, unresolved, upsertCalls };
}

// ═══════════════════════════════════════════════════════════════════════════
// Analiza i raport
// ═══════════════════════════════════════════════════════════════════════════

function sameColumnSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((column) => right.has(column));
}

/** Sprawdzenie C dla jednego celu; `null` - arbiter istnieje. */
export function checkArbiter(site: OnConflictSite, model: UniqueKeyModel): ArbiterViolation | null {
  const keys = model.tables.get(site.table);
  if (keys === undefined) {
    return {
      site,
      problem: model.views.has(site.table) ? "view" : "missing-table",
      existingKeys: [],
      suggestions: [],
    };
  }
  if (keys.some((key) => isArbiterCandidate(key) && sameColumnSet(key.columns, site.columns))) {
    return null;
  }
  const candidates = keys.filter(isArbiterCandidate);
  const covering = candidates.filter((key) =>
    site.columns.every((column) => key.columns.includes(column)),
  );
  return {
    site,
    problem: "no-arbiter",
    existingKeys: keys,
    suggestions: (covering.length > 0 ? covering : candidates).map((key) => key.columns.join(",")),
  };
}

export interface OnConflictArbitersInput {
  /** Migracje POSORTOWANE chronologicznie. */
  readonly migrations: readonly MigrationFile[];
  /** Kod produkcyjny (bez testów) - surowy, komentarze maskuje moduł. */
  readonly sources: readonly SourceFile[];
}

export function analyzeOnConflictArbiters({
  migrations,
  sources,
}: OnConflictArbitersInput): OnConflictArbitersReport {
  const model = buildUniqueKeyModel(migrations);
  const extracted = extractOnConflictTargets(sources, new Set(model.tables.keys()));
  const violations = extracted.sites
    .map((site) => checkArbiter(site, model))
    .filter((violation): violation is ArbiterViolation => violation !== null);

  const byPosition = <T extends { file: string; line: number }>(a: T, b: T) =>
    a.file.localeCompare(b.file) || a.line - b.line;

  return {
    scannedFiles: sources.length,
    upsertCalls: extracted.upsertCalls,
    sites: [...extracted.sites].sort(byPosition),
    tablesInModel: model.tables.size,
    migrationStatements: model.statements,
    violations: violations.sort((a, b) => byPosition(a.site, b.site)),
    unresolved: [...extracted.unresolved].sort(byPosition),
    dynamicDdl: model.dynamicDdl,
  };
}

/**
 * Oblewa też przy zerowym skanie: bramka, która po refaktorze przestaje
 * widzieć cele albo tabele, wygląda identycznie jak bramka przechodząca.
 */
export function onConflictArbitersFailed(report: OnConflictArbitersReport): boolean {
  return (
    report.sites.length === 0 ||
    report.tablesInModel === 0 ||
    report.violations.length > 0 ||
    report.unresolved.length > 0
  );
}

function describeKey(key: UniqueKey): string {
  const kind =
    key.origin === "primary" ? "PRIMARY KEY" : key.origin === "unique" ? "UNIQUE" : "UNIQUE INDEX";
  const flags = [
    key.partial ? "częściowy - nie arbiter" : null,
    key.expression ? "na wyrażeniu - nie arbiter" : null,
    key.deferrable ? "DEFERRABLE - nie arbiter" : null,
  ].filter((flag): flag is string => flag !== null);
  return `${key.name} (${key.columns.join(", ")}) [${[kind, ...flags].join("; ")}; ${key.file}]`;
}

export function renderOnConflictArbitersReport(report: OnConflictArbitersReport): string {
  if (report.tablesInModel === 0 || report.sites.length === 0) {
    return [
      `✗ [on-conflict-arbiters] skan nic nie widzi: ${report.tablesInModel} tabel w modelu, ` +
        `${report.sites.length} celów onConflict w ${report.scannedFiles} plikach.`,
      "  To nie jest zielone światło - to zepsuty odczyt migracji albo źródeł.",
    ].join("\n");
  }

  const lines: string[] = [];
  if (report.violations.length > 0) {
    lines.push(
      `✗ [on-conflict-arbiters] ${report.violations.length} celów onConflict NIE MA arbitra ` +
        "w schemacie odtworzonym z migracji (42P10 przy KAŻDYM wywołaniu):",
    );
    for (const violation of report.violations) {
      const { site } = violation;
      const via = site.viaConstant === null ? "" : ` (stała ${site.viaConstant})`;
      lines.push(
        `    ${site.file}:${site.line}  public.${site.table}  onConflict: "${site.target}"${via}`,
      );
      if (violation.problem === "missing-table") {
        lines.push(
          "      relacji nie ma w stanie końcowym migracji (usunięta, przemianowana, literówka)",
        );
        continue;
      }
      if (violation.problem === "view") {
        lines.push(
          "      relacja jest WIDOKIEM - model nie mapuje kolumn widoku na klucze tabeli bazowej",
        );
        continue;
      }
      lines.push(
        violation.existingKeys.length === 0
          ? "      tabela nie ma ŻADNEGO klucza unikalnego"
          : `      klucze unikalne w stanie końcowym: ${violation.existingKeys.map(describeKey).join("; ")}`,
      );
      for (const suggestion of violation.suggestions) {
        lines.push(`      przejdzie: onConflict: "${suggestion}"`);
      }
    }
    lines.push(
      "",
      "  Postgres rozwiązuje `ON CONFLICT (kolumny)` WYŁĄCZNIE kluczem o identycznym",
      "  zbiorze kolumn (PK, UNIQUE albo UNIQUE INDEX bez WHERE i bez wyrażeń) -",
      "  nadzbiór się nie liczy. Atrapa bazy w teście jednostkowym przyjmie każdy",
      "  cel; tak przez wiele wydań nie działała żadna wysyłka zaproszenia.",
      "  Popraw cel albo dodaj brakujący klucz w nowej migracji.",
    );
  }

  if (report.unresolved.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `✗ [on-conflict-arbiters] ${report.unresolved.length} wystąpień onConflict nie da się sprawdzić statycznie:`,
    );
    for (const entry of report.unresolved) {
      lines.push(`    ${entry.file}:${entry.line}  ${entry.reason}`, `      ${entry.excerpt}`);
    }
    lines.push(
      "",
      "  Bramka jest ZAMKNIĘTA na niepewność: cel, którego nie umie sprawdzić, jest",
      '  czerwony, nie pominięty. Zapisz cel literałem (`onConflict: "a,b"`) albo',
      '  stałą napisową w tym samym pliku, a tabelę - literałem w `.from("…")`.',
    );
  }

  if (lines.length === 0) {
    return (
      `✓ Arbitrzy onConflict OK (${report.sites.length} celów w ${report.upsertCalls} wywołaniach ` +
      `.upsert, ${report.scannedFiles} plików; model: ${report.tablesInModel} tabel z ` +
      `${report.migrationStatements} instrukcji migracji; dynamiczne DDL poza modelem: ` +
      `${report.dynamicDdl.length}).`
    );
  }
  return lines.join("\n");
}

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
//   B. Cele `onConflict` z kodu produkcyjnego `src/**` (bez testów), czytane
//      DRZEWEM SKŁADNIOWYM kompilatora TypeScript (TS albo TSX wg
//      rozszerzenia): każde wywołanie `.upsert(...)` (także `?.`, `!`,
//      `["upsert"]`), opcje z drugiego argumentu. Cel to literał (także
//      szablon bez `${}`) albo identyfikator rozwiązany LEKSYKALNIE do
//      najbliższej deklaracji - liczy się wyłącznie `const` z literałem;
//      parametr, `let`/`var`, destrukturyzacja, zmienna pętli, `catch` czy
//      import tej nazwy na ścieżce rozwiązania to cel nie do sprawdzenia.
//      Tabela z łańcucha odbiorcy (wywołania, `.`/`[]`, `await`, nawiasy, `!`,
//      `as`, `satisfies`): najbliższe `.from(…)` z literałem albo stałą;
//      zmienna-zapytanie (`const query = db.from("t")`) rozwiązywana tak samo;
//      bez `.from` - literał znanej tabeli w wywołaniu pomocnika
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
// wyrażenie, szablon z `${}`, parametr, `let`), tabela nie do ustalenia
// (`.from(zmienna)`, odbiorca-parametr, `cond ? a : b` z różnymi tabelami,
// `.schema("inny")`), opcje, które nie są literałem obiektu, rozkład `...x` za
// ostatnim jawnym `onConflict`, klucz obliczany nie do rozstrzygnięcia albo
// `onConflict` poza opcjami `.upsert(...)` to osobna kategoria raportu
// i ZAPALA bramkę - cicha pominięta pozycja wyglądałaby identycznie jak
// spełniony inwariant. Obrona w głąb: KAŻDE tekstowe wystąpienie `onConflict`
// poza komentarzem musi trafić w węzeł, który przebieg po drzewie
// sklasyfikował - inaczej też czerwień. Ten sam powód stoi za oblaniem przy
// zerowym skanie: bramka, która po refaktorze przestaje cokolwiek widzieć, nie
// może być zielona.
//
// ── DLACZEGO KOMPILATOR, A NIE WŁASNY LEKSER ────────────────────────────────
// Pierwsza wersja maskowała napisy i komentarze dwoma ręcznymi lekserami
// (`bezKomentarzy`, potem drugi) i szukała składni wyrażeniami regularnymi.
// Przegląd adwersaryjny znalazł trzy ciche zielenie, wszystkie z tego samego
// źródła: (1) cofanie się po odbiorcy przechodziło przez `}` zamykający
// poprzedni blok `if`/`for`/`try`, więc `.from()` z TAMTEGO bloku dawało
// tabelę; (2) „pierwsze `const query =` w pliku" wygrywało z najbliższym, a
// stała pliku przesłonięta parametrem/`let`/destrukturyzacją dawała wartość
// zewnętrzną; (3) apostrof w tekście JSX (`Don't`) i `accept="image/*"`
// rozjechały oba leksery tak, że reszta pliku zniknęła razem z upsertami.
// Parser TypeScriptu zna regex vs dzielenie, JSX i szablony z definicji.
//
// ── POLITYKA BLOKÓW `DO $$ … $$` I DYNAMICZNEGO DDL ─────────────────────────
// Bloki DO WYKONUJĄ się przy migracji, więc ich DDL należy do modelu. Bramka
// wchodzi do ciała, dzieli je na instrukcje i stosuje DDL tak, JAKBY KAŻDA
// GAŁĄŹ SIĘ WYKONAŁA. Strażniki w repo są idempotentne („dodaj, jeśli nie ma
// ograniczenia o tej nazwie", `EXCEPTION WHEN duplicate_object`), a model
// trzyma klucze po nazwie, więc zastosowanie strażnika „na ślepo" daje ten sam
// stan co wykonanie warunkowe. `EXECUTE` z JEDNYM literałem (`'…'`, `E'…'`,
// `$q$…$q$`) jest rozwijany i stosowany jak zwykła instrukcja.
// `EXECUTE format(…)`, sklejanie tekstu i `EXECUTE zmienna` są poza zasięgiem
// analizy statycznej - a NIE są tylko źródłem fałszywych alarmów: dynamiczne
// `DROP CONSTRAINT %I` na kluczu unikalnym daje zielony model i 42P10 w bazie.
// Dlatego dynamiczne DDL zdolne zmienić klucz (słowa z `KEY_DDL_HINT_RE` w
// tekście polecenia; przy `EXECUTE zmienna` - w literałach całego bloku) jest
// ZAPADKĄ: `DYNAMIC_DDL_BASELINE` niżej wylicza pliki i liczby takich miejsc,
// które pomiar różnicowy z 2026-10-04 objął. Nowy plik albo zmiana liczby
// ZAPALA bramkę; lekarstwo to statyczny DDL (`ALTER TABLE … DROP CONSTRAINT
// nazwa`, `CREATE UNIQUE INDEX IF NOT EXISTS …`) - model zobaczy go od razu.
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
// Pomiar powtórzony po przejściu na drzewo składniowe i surowe migracje - ten
// sam wynik. Każdy z 46 różnych celów (tabela, kolumny) z kodu dostał na tej
// bazie `Conflict Arbiter Indexes` w `EXPLAIN INSERT … ON CONFLICT`, a stary
// cel `user_roles (user_id, role)` - 42P10. Nazwy domyślne (przycięcie do 63
// bajtów, `_key1` przy kolizji, scalenie UNIQUE z PK) sprawdzone tak samo.
//
// Moduł jest CZYSTY - odczyt migracji i źródeł żyje w
// `scripts/lib/onConflictArbitersInputs.ts` (wspólny dla runnera
// `scripts/check-on-conflict-arbiters.ts` i testu
// `src/lib/ci/__tests__/onConflictArbiters.test.ts`).
import ts from "typescript";
import { MigrationLexError, lexStatements } from "./migrationSplit";

// ═══════════════════════════════════════════════════════════════════════════
// Typy publiczne
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Plik migracji w postaci SUROWEJ. Komentarze, `$tag$` i `E'…'` rozbiera
 * lekser tego modułu - nie przepuszczaj tekstu przez `stripSqlComments`
 * (`scripts/lib/sqlMigrations.ts`): nie zna dollar-quote i potrafi połknąć
 * `DROP` stojący za `$$ SELECT '--' $$`.
 */
export interface MigrationFile {
  readonly file: string;
  readonly sql: string;
}

/** Plik źródłowy TS/TSX w postaci SUROWEJ - parsuje go kompilator TypeScript. */
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

/** `EXECUTE` z tekstem składanym w czasie wykonania, zdolnym zmienić klucz - poza modelem. */
export interface DynamicDdl {
  readonly file: string;
  readonly text: string;
}

/** Migracja (albo ciało DO / literał EXECUTE w niej), której `lexStatements` nie podzielił. */
export interface UnsplittableMigration {
  readonly file: string;
  readonly message: string;
}

/** Wpis zapadki dynamicznego DDL: ile takich miejsc plik ma i czemu model mimo to jest wierny. */
export interface DynamicDdlBaselineEntry {
  readonly count: number;
  readonly why: string;
}

/** Plik migracji, w którym liczba dynamicznych DDL kluczy rozjechała się z zapadką. */
export interface DynamicDdlDrift {
  readonly file: string;
  /** Liczba z `DYNAMIC_DDL_BASELINE` (0 - pliku tam nie ma). */
  readonly expected: number;
  readonly actual: number;
  /** Teksty poleceń z pliku - żeby raport dało się przeczytać bez otwierania migracji. */
  readonly texts: readonly string[];
}

/** Stan końcowy schematu `public` w zakresie, którego potrzebuje bramka. */
export interface UniqueKeyModel {
  /** Tabela -> jej klucze unikalne (posortowane po nazwie; pusta lista = brak kluczy). */
  readonly tables: ReadonlyMap<string, readonly UniqueKey[]>;
  /** Widoki żywe w stanie końcowym (cel upsertu, który okazuje się widokiem). */
  readonly views: ReadonlySet<string>;
  readonly dynamicDdl: readonly DynamicDdl[];
  /** Teksty, których lekser instrukcji nie podzielił - ich DDL nie weszło do modelu. */
  readonly unsplittable: readonly UnsplittableMigration[];
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
  /** Dynamiczne DDL kluczy poza zapadką `DYNAMIC_DDL_BASELINE` - zapala bramkę. */
  readonly dynamicDdlDrift: readonly DynamicDdlDrift[];
  /** Migracje, których lekser nie podzielił - model ich nie zna, zapala bramkę. */
  readonly unsplittable: readonly UnsplittableMigration[];
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

/**
 * Instrukcje najwyższego poziomu: komentarze zamienione na spację, bez
 * końcowego `;`. GRANICE wyznacza `lexStatements` z `migrationSplit.ts` - ten
 * sam lekser, który tnie migracje pod wdrożenie (reguły psql: `;` w nawiasie
 * i w `BEGIN ATOMIC … END` nie kończy instrukcji, `E'…'` sklejany przez nową
 * linię). `lexSql` tego modułu tylko wygasza komentarze WEWNĄTRZ jednej
 * instrukcji, więc ewentualny rozjazd dwóch lekserów nie przekroczy jej
 * granicy (lekcja z TS: dwa leksery po całym pliku zgubiły resztę pliku).
 * Przełączenie zmierzone 2026-10-04: identyczny podział wszystkich 1082
 * migracji (z ciałami DO i literałami EXECUTE), zero błędów leksera, model ==
 * pg_index 616/616. Wejście, którego lekser nie przyjmuje (meta-polecenie
 * psql, `COPY … FROM STDIN`, niedomknięty literał), rzuca `MigrationLexError`.
 */
export function splitSqlStatementsDeep(sql: string): string[] {
  const out: string[] = [];
  for (const segment of lexStatements(sql)) {
    if (segment.codeStart < 0) continue;
    const text = segment.text.slice(segment.codeStart - segment.start);
    let code = "";
    lexSql(text, (kind, start, end) => {
      code += kind === "comment" ? " " : text.slice(start, end);
    });
    code = code.trim();
    if (segment.terminated && code.endsWith(";")) code = code.slice(0, -1).trim();
    if (code !== "") out.push(code);
  }
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
  readonly unsplittable: UnsplittableMigration[] = [];
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

/** Zdejmuje nawiasy obejmujące CAŁE wyrażenie (`((a))` -> `a`) - w parserze nie tworzą węzła. */
function stripWrappingParens(text: string): string {
  let current = text.trim();
  while (current.startsWith("(") && matchParenSql(current, 0) === current.length - 1) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

const TRAILING_COLLATE_RE = new RegExp(String.raw`\s+COLLATE\s+${QNAME}\s*$`, "i");
const CAST_TYPE_RE = new RegExp(String.raw`^(${QNAME})(?:\s*\([^)]*\))?(?:\s*\[\s*\])*$`);
const CALL_HEAD_RE = new RegExp(String.raw`^(${QNAME})\s*\(`);
const QNAME_ONLY_RE = new RegExp(String.raw`^${QNAME}$`);
/** Typy, które gramatyka Postgresa zamienia na nazwy wewnętrzne (`SystemTypeName`). */
const SYSTEM_TYPE_NAMES: Readonly<Record<string, string>> = {
  int: "int4",
  integer: "int4",
  smallint: "int2",
  bigint: "int8",
  real: "float4",
  float: "float8",
  boolean: "bool",
  decimal: "numeric",
  dec: "numeric",
};

/** Atom wyrażenia: nawias obejmujący całość, wywołanie funkcji albo (kwalifikowana) nazwa. */
function isAtom(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("(") && matchParenSql(trimmed, 0) === trimmed.length - 1) return true;
  const call = CALL_HEAD_RE.exec(trimmed);
  if (call !== null && matchParenSql(trimmed, call[0].length - 1) === trimmed.length - 1) {
    return true;
  }
  return QNAME_ONLY_RE.test(trimmed);
}

/**
 * Operand rzutowania obejmującego CAŁE wyrażenie (`atom::typ`, także
 * `atom::a::b`) i nazwa typu; `null`, gdy `::` wiąże tylko kawałek - `::`
 * wiąże mocniej niż operatory, więc `a || b::text` to `a || (b::text)`.
 */
function wholeCast(text: string): { operand: string; type: string } | null {
  const view = sqlView(text, true);
  const cast = view.lastIndexOf("::");
  if (cast <= 0) return null;
  const type = CAST_TYPE_RE.exec(text.slice(cast + 2).trim());
  if (type === null) return null;
  const operand = text.slice(0, cast).trim();
  if (!isAtom(operand) && wholeCast(operand) === null) return null;
  const parts = splitQualified(type[1]);
  const name = normalizeIdent(parts[parts.length - 1]);
  return { operand, type: parts.length === 1 ? (SYSTEM_TYPE_NAMES[name] ?? name) : name };
}

/**
 * `FigureIndexColname` z Postgresa w zakresie spotykanym w indeksach: nazwa
 * członu domyślnej nazwy indeksu dla elementu-wyrażenia. Kolumna i funkcja
 * (także `schemat.f(…)`) dają swoją nazwę z siłą 2, rzutowanie całości
 * `x::typ` - nazwę operandu, a gdy ten nie ma mocnej nazwy, nazwę typu (siła
 * 1), `CASE` - `case`, `ARRAY[…]` - `array`; reszta (operator, literał) -
 * nic, czyli `expr` w `ChooseIndexColumnNames`. Zmierzone na PG16:
 * `(lower(x))` -> `lower`, `(pg_catalog.upper(a))` -> `upper`,
 * `(CASE … END)` -> `case`, `(a || b::text)` -> `expr`.
 */
function figureIndexColname(raw: string): { name: string; strength: 1 | 2 } | null {
  const text = stripWrappingParens(raw).replace(TRAILING_COLLATE_RE, "");
  const cast = wholeCast(text);
  if (cast !== null) {
    const inner = figureIndexColname(cast.operand);
    return inner !== null && inner.strength === 2 ? inner : { name: cast.type, strength: 1 };
  }
  if (/^CASE\b/i.test(text)) return { name: "case", strength: 1 };
  if (/^ARRAY\s*\[/i.test(text)) return { name: "array", strength: 2 };
  const call = CALL_HEAD_RE.exec(text);
  if (call !== null && matchParenSql(text, call[0].length - 1) === text.length - 1) {
    const parts = splitQualified(call[1]);
    return { name: normalizeIdent(parts[parts.length - 1]), strength: 2 };
  }
  if (new RegExp(String.raw`^${IDENT}$`).test(text)) {
    return { name: normalizeIdent(text), strength: 2 };
  }
  return null;
}

/**
 * Element indeksu: kolumna (z opcjonalnym COLLATE/opclass/ASC) albo wyrażenie.
 *
 * `(a)`, `((a))` i `(a COLLATE "C")` to KOLUMNA, nie wyrażenie: Postgres
 * (`ComputeIndexAttrs`) zdejmuje `COLLATE`, a goły `Var` traktuje jak prosty
 * atrybut - `indexprs` zostaje puste, a indeks jest arbitrem listy kolumn
 * (zmierzone na PG16: `((a), b)` daje `indkey 2 3`, `Conflict Arbiter
 * Indexes` dla `ON CONFLICT (a, b)`). Uznanie go za wyrażenie dawało fałszywy
 * alarm „brak arbitra".
 */
function parseIndexElement(raw: string): KeyElement {
  const text = raw.trim();
  if (text.startsWith("(")) {
    const close = matchParenSql(text, 0);
    const tail = close < 0 ? "" : text.slice(close + 1).trim();
    if (close > 0 && (tail === "" || COLUMN_ELEMENT_TAIL_RE.test(tail))) {
      const inner = stripWrappingParens(text.slice(1, close)).replace(TRAILING_COLLATE_RE, "");
      if (new RegExp(String.raw`^${IDENT}$`).test(inner)) {
        const column = normalizeIdent(inner);
        return { text: column, expression: false, nameHint: column };
      }
    }
    return {
      text: `(${text.replace(/^\(([\s\S]*)\)$/, "$1").trim()})`,
      expression: true,
      nameHint: figureIndexColname(close > 0 ? text.slice(0, close + 1) : text)?.name ?? "expr",
    };
  }
  const call = CALL_HEAD_RE.exec(text);
  if (call !== null) {
    // Wywołanie funkcji: `lower(email)` - Postgres nazywa element nazwą funkcji
    // (bez schematu: `public.f(x)` daje człon `f`).
    const parts = splitQualified(call[1]);
    return {
      text: `(${text})`,
      expression: true,
      nameHint: normalizeIdent(parts[parts.length - 1]),
    };
  }
  const head = new RegExp(String.raw`^(${IDENT})([\s\S]*)$`).exec(text);
  const rest = head === null ? null : head[2].trim();
  if (head !== null && rest !== null && (rest === "" || COLUMN_ELEMENT_TAIL_RE.test(rest))) {
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
    // Indeksu, za którym stoi ograniczenie PK/UNIQUE, `DROP INDEX` nie zdejmie
    // - Postgres odmawia („cannot drop index … because constraint … requires
    // it"), także z `IF EXISTS` i `CASCADE`. Klucz zostaje; zdejmuje go
    // wyłącznie `ALTER TABLE … DROP CONSTRAINT`.
    if (state.keys.get(name)?.origin === "index") state.keys.delete(name);
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
      // Gołe `CREATE UNIQUE INDEX` NIE jest ograniczeniem: `DROP CONSTRAINT
      // IF EXISTS <nazwa indeksu>` kończy się w Postgresie NOTICE „does not
      // exist, skipping" i indeks zostaje (bez `IF EXISTS` - błąd).
      const name = normalizeIdent(dropConstraint[1]);
      const key = state.keys.get(name);
      if (key !== undefined && key.table === table && key.origin !== "index") {
        state.keys.delete(name);
      }
      continue;
    }

    const dropColumn = DROP_COLUMN_RE.exec(action);
    if (dropColumn !== null) {
      const column = normalizeIdent(dropColumn[1]);
      // Słowo kluczowe w miejscu nazwy to inna akcja; cytowane `"constraint"`
      // to już kolumna o takiej nazwie.
      const keyword = !dropColumn[1].startsWith('"');
      if (keyword && ["constraint", "not", "default", "identity", "expression"].includes(column)) {
        continue;
      }
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
/**
 * Słowa, przy których tekst dynamicznego polecenia może zmienić klucz
 * unikalny: ADD/DROP CONSTRAINT, CREATE/DROP/ALTER INDEX, RENAME, DROP
 * COLUMN/TABLE, PRIMARY KEY/UNIQUE, CREATE TABLE, SET SCHEMA (tabela wychodzi
 * z `public`). Szerokie celowo - nadmiar kosztuje wpis w zapadce, niedomiar
 * to cicha zieleń.
 */
const KEY_DDL_HINT_RE =
  /\b(?:UNIQUE|PRIMARY\s+KEY|CONSTRAINT|INDEX|RENAME|DROP\s+TABLE|DROP\s+COLUMN|CREATE\s+TABLE|SET\s+SCHEMA)\b/i;

/** Treść wszystkich literałów (`'…'`, `E'…'`, `$tag$…$tag$`) tekstu SQL, sklejona spacją. */
function literalText(sql: string): string {
  const out: string[] = [];
  lexSql(sql, (kind, start, end) => {
    if (kind === "literal") out.push(sql.slice(start, end));
  });
  return out.join(" ");
}

/** Argument `EXECUTE` będący JEDNYM literałem - jego tekst SQL; inaczej `null`. */
function singleLiteralSql(argument: string): string | null {
  const quoted = /^(E?)'((?:[^']|'')*)'$/.exec(argument);
  if (quoted !== null) return quoted[2].replace(/''/g, "'");
  const dollar = /^(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*)\1$/.exec(argument);
  if (dollar !== null && !dollar[2].includes(dollar[1])) return dollar[2];
  return null;
}

/** Ciało bloku `DO` - patrz „POLITYKA BLOKÓW DO I DYNAMICZNEGO DDL" w nagłówku. */
function applyDoBlock(state: SchemaState, statement: string, file: string, depth: number): void {
  const head = /^DO\s+(?:LANGUAGE\s+\w+\s+)?/i.exec(statement);
  if (head === null) return;
  DOLLAR_TAG_RE.lastIndex = head[0].length;
  const tag = DOLLAR_TAG_RE.exec(statement);
  if (tag === null || tag.index !== head[0].length) return;
  const bodyStart = tag.index + tag[0].length;
  const bodyEnd = statement.indexOf(tag[0], bodyStart);
  const body = statement.slice(bodyStart, bodyEnd < 0 ? statement.length : bodyEnd);
  let bodyLiterals: string | null = null;

  for (const fragment of statementsOf(state, file, body)) {
    const view = sqlView(fragment, false);
    // `EXECUTE FUNCTION f()` w `CREATE TRIGGER` to nie dynamiczny SQL.
    const execute = /\bEXECUTE\b(?!\s+(?:FUNCTION|PROCEDURE)\b)/i.exec(view);
    if (execute !== null) {
      const argument = fragment.slice(execute.index + execute[0].length).trim();
      const sql = singleLiteralSql(argument);
      if (sql !== null) {
        for (const inner of statementsOf(state, file, sql)) {
          applyStatement(state, inner, file, depth + 1);
        }
        continue;
      }
      // Tekst polecenia bywa złożony WCZEŚNIEJ w bloku (`v_sql := '…' || …;
      // EXECUTE v_sql`) albo doklejony ze zmiennej - słowa, które czynią go
      // groźnym dla kluczy, stoją wtedy w literałach całego ciała, nie
      // w argumencie. Zakres skanu to więc argument + wszystkie literały bloku.
      bodyLiterals ??= literalText(body);
      if (KEY_DDL_HINT_RE.test(`${argument} ${bodyLiterals}`)) {
        state.dynamicDdl.push({ file, text: argument.replace(/\s+/g, " ").slice(0, 200) });
      }
      continue;
    }
    const ddl = DDL_HEAD_RE.exec(view);
    if (ddl !== null) applyStatement(state, fragment.slice(ddl.index), file, depth + 1);
  }
}

/**
 * Podział z zamknięciem na niepewność: tekst, którego lekser nie podzieli,
 * nie wnosi DDL do modelu, ale trafia do raportu i zapala bramkę - model bez
 * tego pliku byłby zieloną zgadywanką.
 */
function statementsOf(state: SchemaState, file: string, sql: string): string[] {
  try {
    return splitSqlStatementsDeep(sql);
  } catch (error) {
    if (!(error instanceof MigrationLexError)) throw error;
    state.unsplittable.push({ file, message: error.message });
    return [];
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
    for (const statement of statementsOf(state, file, sql)) {
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
    unsplittable: state.unsplittable,
    statements: state.statements,
  };
}

/** Klucz, którym Postgres rozwiąże `ON CONFLICT (kolumny)` bez predykatu. */
export function isArbiterCandidate(key: UniqueKey): boolean {
  return !key.partial && !key.expression && !key.deferrable;
}

// ═══════════════════════════════════════════════════════════════════════════
// Kod TS/TSX: drzewo składniowe kompilatora TypeScript
// ═══════════════════════════════════════════════════════════════════════════

/** Nazwa opcji celu konfliktu w supabase-js (`upsert(values, { onConflict })`). */
const CONFLICT_KEY = "onConflict";
/** Limit skoków przez stałe/zmienne-zapytania - ochrona przed cyklem `const a = b, b = a`. */
const MAX_HOPS = 8;

const TARGET_REASON =
  "wartość `onConflict` nie jest literałem ani stałą napisową tego pliku - cel nie do sprawdzenia";
const OUTSIDE_REASON =
  "`onConflict` poza literałem opcji `.upsert(...)` (zmienna z opcjami, pomocnik) - cel nie do powiązania z tabelą";
const OPTIONS_REASON =
  "opcje `.upsert(...)` nie są literałem obiektu (zmienna, wywołanie, wyrażenie) - bramka nie widzi, czy niosą `onConflict`";
const SPREAD_REASON =
  "opcje `.upsert(...)` rozkładają obiekt (`...`) za ostatnim jawnym `onConflict` - cel może przyjść z rozkładu, a bramka nie widzi jego wartości";
const COMPUTED_KEY_REASON =
  "klucz obliczany (`[…]`) w opcjach `.upsert(...)` nie daje się rozstrzygnąć - może to być `onConflict`";
const ACCESSOR_REASON =
  "`onConflict` jako metoda albo akcesor w opcjach `.upsert(...)` - cel nie do sprawdzenia";
const FROM_REASON = "nazwa tabeli w `.from(...)` nie jest literałem ani stałą tego pliku";
const SCHEMA_REASON = "odbiorca ustawia `.schema(...)` - cel poza schematem public";
const NO_TABLE_REASON = 'nie da się ustalić tabeli (brak `.from("…")` i literału znanej tabeli)';
const UNCLASSIFIED_REASON =
  "wystąpienie `onConflict`, którego przebieg po drzewie składniowym nie sklasyfikował - obrona w głąb";

/**
 * Opakowania, które nie zmieniają wartości ani odbiorcy: nawiasy, `as`,
 * `satisfies`, `!`, `<T>x` i `await` (`(await db).from(…)`).
 */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Nazwa członu wywołania: `x.m` / `x?.m` / `x["m"]`; inaczej `null`. */
function memberName(callee: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return null;
}

/** Odbiorca członu (`x` w `x.m`) - wołać tylko, gdy `memberName` dał nazwę. */
function memberReceiver(callee: ts.Expression): ts.Expression {
  return (callee as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
}

function isUpsertCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && memberName(unwrap(node.expression)) === "upsert";
}

// ── Rozwiązywanie nazw: zasięgi leksykalne ──────────────────────────────────

/**
 * Co stoi za identyfikatorem w miejscu użycia. Liczy się NAJBLIŻSZA
 * deklaracja na ścieżce zasięgów od użycia w górę - dokładnie jak w JS - więc
 * stała pliku przesłonięta parametrem, `let`, destrukturyzacją, zmienną pętli
 * albo `catch` to ta przesłaniająca wiązka, nie stała.
 */
type Binding =
  | { readonly kind: "const"; readonly initializer: ts.Expression }
  | { readonly kind: "other"; readonly detail: string }
  | { readonly kind: "none" };

function isBlockScopedList(list: ts.VariableDeclarationList): boolean {
  return (list.flags & ts.NodeFlags.BlockScoped) !== 0;
}

/** Deklaracje nazwy `wanted` we wzorcu wiązania; właścicielem jest deklaracja albo element wzorca. */
function collectBinding(
  name: ts.BindingName,
  wanted: string,
  owner: ts.Node,
  out: ts.Node[],
): void {
  if (ts.isIdentifier(name)) {
    if (name.text === wanted) out.push(owner);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBinding(element.name, wanted, element, out);
  }
}

function collectList(list: ts.VariableDeclarationList, wanted: string, out: ts.Node[]): void {
  for (const declaration of list.declarations)
    collectBinding(declaration.name, wanted, declaration, out);
}

/** Deklaracje blokowe (`let`/`const`, funkcje, klasy, enumy, importy) bezpośrednio w liście instrukcji. */
function collectStatements(
  statements: readonly ts.Statement[],
  wanted: string,
  out: ts.Node[],
): void {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      if (isBlockScopedList(statement.declarationList)) {
        collectList(statement.declarationList, wanted, out);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === wanted
    ) {
      out.push(statement);
    } else if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
      const clause = statement.importClause;
      if (clause.name?.text === wanted) out.push(clause);
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        if (bindings.name.text === wanted) out.push(bindings);
      } else if (bindings !== undefined) {
        for (const element of bindings.elements)
          if (element.name.text === wanted) out.push(element);
      }
    } else if (ts.isImportEqualsDeclaration(statement) && statement.name.text === wanted) {
      out.push(statement);
    }
  }
}

/** `var` wynoszone do zasięgu funkcji (albo pliku) - z dowolnie głębokich bloków, bez zagnieżdżonych funkcji. */
function collectHoistedVars(root: ts.Node, wanted: string, out: ts.Node[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isVariableDeclarationList(node) && !isBlockScopedList(node))
      collectList(node, wanted, out);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
}

function isFunctionScope(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Deklaracje nazwy wprowadzane przez JEDEN węzeł-zasięg. */
function declarationsIn(scope: ts.Node, wanted: string): ts.Node[] {
  const out: ts.Node[] = [];
  if (ts.isSourceFile(scope)) {
    collectStatements(scope.statements, wanted, out);
    collectHoistedVars(scope, wanted, out);
  } else if (ts.isBlock(scope) || ts.isModuleBlock(scope)) {
    collectStatements(scope.statements, wanted, out);
  } else if (ts.isCaseBlock(scope)) {
    for (const clause of scope.clauses) collectStatements(clause.statements, wanted, out);
  } else if (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) {
    const init = scope.initializer;
    if (init !== undefined && ts.isVariableDeclarationList(init) && isBlockScopedList(init)) {
      collectList(init, wanted, out);
    }
  } else if (ts.isCatchClause(scope)) {
    const variable = scope.variableDeclaration;
    if (variable !== undefined) collectBinding(variable.name, wanted, variable, out);
  } else if (isFunctionScope(scope)) {
    for (const parameter of scope.parameters)
      collectBinding(parameter.name, wanted, parameter, out);
    if (ts.isFunctionExpression(scope) && scope.name?.text === wanted) out.push(scope);
    if (scope.body !== undefined) collectHoistedVars(scope.body, wanted, out);
  } else if (ts.isClassExpression(scope) && scope.name?.text === wanted) {
    out.push(scope);
  }
  return out;
}

function classifyDeclaration(node: ts.Node): Binding {
  const other = (detail: string): Binding => ({ kind: "other", detail });
  if (ts.isVariableDeclaration(node)) {
    if (ts.isCatchClause(node.parent)) return other("zmienna `catch`");
    const list = node.parent;
    if (ts.isForOfStatement(list.parent) || ts.isForInStatement(list.parent)) {
      return other("zmienna pętli `for … of/in`");
    }
    // `using`/`await using` mają własne bity - stała to WYŁĄCZNIE `const`.
    if ((list.flags & ts.NodeFlags.BlockScoped) !== ts.NodeFlags.Const) {
      return other("`let`/`var` - wartość może się zmienić przed wywołaniem");
    }
    if (node.initializer === undefined) return other("`const` bez inicjalizatora");
    return { kind: "const", initializer: node.initializer };
  }
  if (ts.isParameter(node)) return other("parametr funkcji - wartość przychodzi z wywołania");
  if (ts.isBindingElement(node)) return other("destrukturyzacja - wartość przychodzi z obiektu");
  if (
    ts.isImportClause(node) ||
    ts.isImportSpecifier(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportEqualsDeclaration(node)
  ) {
    return other("import - wartość spoza pliku");
  }
  return other("funkcja, klasa albo enum - nie napis");
}

function resolveBinding(identifier: ts.Identifier): Binding {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    const found = declarationsIn(scope, identifier.text);
    if (found.length > 1)
      return { kind: "other", detail: "kilka deklaracji tej nazwy w jednym zasięgu" };
    if (found.length === 1) return classifyDeclaration(found[0]);
  }
  return { kind: "none" };
}

interface StringValue {
  readonly value: string;
  /** Nazwa stałej w miejscu użycia, gdy wartość nie była literałem. */
  readonly viaConstant: string | null;
  /** Węzeł w miejscu użycia (literał albo identyfikator) - do numeru linii. */
  readonly node: ts.Node;
}

/** Napis znany statycznie: literał, szablon bez `${}` albo `const` z takim inicjalizatorem. */
function resolveString(expression: ts.Expression, hops = 0): StringValue | { reason: string } {
  const node = unwrap(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.text, viaConstant: null, node };
  }
  if (ts.isTemplateExpression(node)) return { reason: "szablon z `${}`" };
  if (!ts.isIdentifier(node)) return { reason: "wyrażenie, nie literał ani stała" };
  const binding = resolveBinding(node);
  if (binding.kind === "none") return { reason: `\`${node.text}\` nie ma deklaracji w tym pliku` };
  if (binding.kind === "other") return { reason: `\`${node.text}\`: ${binding.detail}` };
  if (hops >= MAX_HOPS) return { reason: "zbyt długi łańcuch stałych" };
  const inner = resolveString(binding.initializer, hops + 1);
  if ("reason" in inner) return { reason: `stała \`${node.text}\` - ${inner.reason}` };
  return { value: inner.value, viaConstant: node.text, node };
}

/** Klucz członu literału obiektu; `null` - klucz obliczany, którego nie da się rozstrzygnąć. */
function propertyKey(member: ts.ObjectLiteralElementLike): string | null {
  if (ts.isSpreadAssignment(member)) return null;
  const name = member.name;
  if (ts.isComputedPropertyName(name)) {
    const key = resolveString(name.expression);
    return "reason" in key ? null : key.value;
  }
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

// ── Tabela z łańcucha odbiorcy ──────────────────────────────────────────────

/** Wynik zejścia po łańcuchu: tabela, twardy powód albo „to ogniwo nie mówi nic" (`soft`). */
type ReceiverTable =
  { readonly table: string } | { readonly reason: string } | { readonly soft: true };

/** Pomocnik: `write(context, "crm_leads")` - literał w argumentach nazywający znaną tabelę. */
function helperTable(
  call: ts.CallExpression,
  knownTables: ReadonlySet<string>,
): ReceiverTable | null {
  const candidates = new Set<string>();
  for (const argument of call.arguments) {
    const node = unwrap(argument);
    if (ts.isStringLiteralLike(node) && knownTables.has(node.text)) candidates.add(node.text);
  }
  if (candidates.size === 1) return { table: [...candidates][0] };
  if (candidates.size > 1) {
    return {
      reason: `odbiorca wskazuje kilka znanych tabel: ${[...candidates].sort().join(", ")}`,
    };
  }
  return null;
}

/**
 * `.schema("x")` z `x` innym niż `public` gdziekolwiek NIŻEJ w łańcuchu (także
 * przez stałą-klienta `const db = supabase.schema("x")`) - powód; inaczej `null`.
 */
function schemaBelow(expression: ts.Expression, hops: number): string | null {
  let node = unwrap(expression);
  for (let step = 0; step < 64; step += 1) {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const method = memberName(callee);
      if (method === null) return null;
      if (method === "schema") {
        const argument = node.arguments[0];
        const schema = argument === undefined ? null : resolveString(argument);
        if (schema === null || "reason" in schema || schema.value !== "public")
          return SCHEMA_REASON;
      }
      node = unwrap(memberReceiver(callee));
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      node = unwrap(node.expression);
    } else if (ts.isIdentifier(node) && hops < MAX_HOPS) {
      const binding = resolveBinding(node);
      if (binding.kind !== "const") return null;
      node = unwrap(binding.initializer);
      hops += 1;
    } else {
      return null;
    }
  }
  return null;
}

/**
 * Tabela odbiorcy `.upsert`: schodzimy po WĘZŁACH łańcucha (nie po tekście),
 * więc blok `if`/`for`/`try` przed instrukcją nie ma jak się wmieszać.
 * Pierwsze `.from(…)` od strony `.upsert` wygrywa; zmienna-zapytanie
 * prowadzi do inicjalizatora swojej NAJBLIŻSZEJ deklaracji `const`.
 */
function receiverTable(
  expression: ts.Expression,
  knownTables: ReadonlySet<string>,
  hops: number,
): ReceiverTable {
  const node = unwrap(expression);
  if (hops > MAX_HOPS * 4) return { reason: "łańcuch odbiorcy zbyt długi" };
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    const method = memberName(callee);
    if (method === "from") {
      const argument = node.arguments[0];
      const table = argument === undefined ? null : resolveString(argument);
      if (table === null) return { reason: FROM_REASON };
      if ("reason" in table) return { reason: `${FROM_REASON} (${table.reason})` };
      // `.schema("x")` NIŻEJ w łańcuchu przestawia także to `.from`.
      const below = schemaBelow(memberReceiver(callee), hops);
      return below === null ? { table: table.value } : { reason: below };
    }
    if (method === "schema") {
      const below = schemaBelow(node, hops);
      if (below !== null) return { reason: below };
      return receiverTable(memberReceiver(callee), knownTables, hops + 1);
    }
    if (method !== null) {
      const inner = receiverTable(memberReceiver(callee), knownTables, hops + 1);
      if (!("soft" in inner)) return inner;
      return helperTable(node, knownTables) ?? inner;
    }
    return helperTable(node, knownTables) ?? { soft: true };
  }
  if (ts.isIdentifier(node)) {
    const binding = resolveBinding(node);
    if (binding.kind === "const") return receiverTable(binding.initializer, knownTables, hops + 1);
    if (binding.kind === "other") {
      return { reason: `odbiorca \`${node.text}\`: ${binding.detail} - tabela nie do ustalenia` };
    }
    return { soft: true };
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = receiverTable(node.whenTrue, knownTables, hops + 1);
    const whenFalse = receiverTable(node.whenFalse, knownTables, hops + 1);
    if ("table" in whenTrue && "table" in whenFalse && whenTrue.table === whenFalse.table) {
      return whenTrue;
    }
    return { reason: "odbiorca wybiera zapytanie warunkowo (`? :`) - tabela nie do ustalenia" };
  }
  return { soft: true };
}

function tableOf(
  call: ts.CallExpression,
  knownTables: ReadonlySet<string>,
): { table: string } | { reason: string } {
  const resolved = receiverTable(memberReceiver(unwrap(call.expression)), knownTables, 0);
  return "soft" in resolved ? { reason: NO_TABLE_REASON } : resolved;
}

// ── Przebieg po pliku ───────────────────────────────────────────────────────

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

interface FileScan {
  readonly file: string;
  readonly raw: string;
  readonly source: ts.SourceFile;
  readonly knownTables: ReadonlySet<string>;
  readonly sites: OnConflictSite[];
  readonly unresolved: UnresolvedOnConflict[];
  /** Członkowie literałów z kluczem `onConflict`, które przebieg rozstrzygnął (cel albo powód). */
  readonly classified: Set<ts.Node>;
  /** Literały opcji `.upsert(...)` - poza nimi `onConflict` to osobna kategoria. */
  readonly upsertOptions: Set<ts.Node>;
}

function lineAt(scan: FileScan, position: number): number {
  return scan.source.getLineAndCharacterOfPosition(position).line + 1;
}

function report(scan: FileScan, at: ts.Node | number, reason: string): void {
  const position = typeof at === "number" ? at : at.getStart(scan.source);
  const start = scan.raw.lastIndexOf("\n", position - 1) + 1;
  const end = scan.raw.indexOf("\n", position);
  scan.unresolved.push({
    file: scan.file,
    line: lineAt(scan, position),
    reason,
    excerpt: scan.raw.slice(start, end < 0 ? scan.raw.length : end).trim(),
  });
}

/** Opcje `undefined`/`null`/`void 0` - brak celu, PostgREST bierze klucz główny. */
function isNullish(node: ts.Expression): boolean {
  return (
    (ts.isIdentifier(node) && node.text === "undefined") ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(node)
  );
}

function scanUpsert(scan: FileScan, call: ts.CallExpression): void {
  if (call.arguments.some((argument) => ts.isSpreadElement(argument))) {
    report(scan, call.arguments[0], OPTIONS_REASON);
    return;
  }
  const argument = call.arguments[1];
  if (argument === undefined) return;
  const options = unwrap(argument);
  if (isNullish(options)) return;
  if (!ts.isObjectLiteralExpression(options)) {
    report(scan, argument, OPTIONS_REASON);
    return;
  }
  scan.upsertOptions.add(options);

  const targets: ts.ObjectLiteralElementLike[] = [];
  let lastTarget = -1;
  let lastSpread = -1;
  options.properties.forEach((member, index) => {
    if (ts.isSpreadAssignment(member)) {
      lastSpread = index;
      return;
    }
    const key = propertyKey(member);
    if (key === null) {
      report(scan, member, COMPUTED_KEY_REASON);
    } else if (key === CONFLICT_KEY) {
      targets.push(member);
      lastTarget = index;
    }
  });
  // Późniejszy klucz literału nadpisuje wcześniejszy - rozkład PRZED jawnym
  // `onConflict` nie zmieni celu, rozkład ZA nim (albo bez niego) już tak.
  if (lastSpread > lastTarget) report(scan, options.properties[lastSpread], SPREAD_REASON);
  if (targets.length === 0) return;

  const table = tableOf(call, scan.knownTables);
  for (const member of targets) {
    scan.classified.add(member);
    const value = ts.isPropertyAssignment(member)
      ? member.initializer
      : ts.isShorthandPropertyAssignment(member)
        ? member.name
        : null;
    if (value === null) {
      report(scan, member, ACCESSOR_REASON);
      continue;
    }
    // `onConflict: undefined` - supabase-js pomija wtedy `on_conflict`
    // (`if (onConflict !== undefined)`), konflikt idzie po kluczu głównym.
    const plain = unwrap(value);
    if (
      ts.isIdentifier(plain) &&
      plain.text === "undefined" &&
      resolveBinding(plain).kind === "none"
    ) {
      continue;
    }
    const target = resolveString(value);
    if ("reason" in target) {
      report(scan, member, `${TARGET_REASON} (${target.reason})`);
      continue;
    }
    if ("reason" in table) {
      report(scan, member, table.reason);
      continue;
    }
    const columns = parseConflictTarget(target.value);
    if (columns.length === 0) {
      report(scan, member, "pusty cel `onConflict`");
      continue;
    }
    scan.sites.push({
      file: scan.file,
      line: lineAt(scan, target.node.getStart(scan.source)),
      table: table.table,
      target: target.value,
      columns,
      viaConstant: target.viaConstant,
    });
  }
}

/** Każdy literał obiektu POZA opcjami `.upsert(...)` z kluczem `onConflict` - zamknięte na niepewność. */
function scanStrayObjects(scan: FileScan, node: ts.Node): void {
  if (ts.isObjectLiteralExpression(node) && !scan.upsertOptions.has(node)) {
    for (const member of node.properties) {
      if (ts.isSpreadAssignment(member) || propertyKey(member) !== CONFLICT_KEY) continue;
      scan.classified.add(member);
      report(scan, member, OUTSIDE_REASON);
    }
  }
  ts.forEachChild(node, (child) => scanStrayObjects(scan, child));
}

/**
 * Gdzie w drzewie leży pozycja: token (z `getChildren`, więc także
 * interpunkcja), `"comment"` - komentarz w trywiach (także JSDoc i komentarz
 * za kodem w tej samej linii), albo `null` - trywia bez komentarza.
 */
function locate(source: ts.SourceFile, position: number): ts.Node | "comment" | null {
  let node: ts.Node = source;
  for (;;) {
    let child: ts.Node | undefined;
    for (const candidate of node.getChildren(source)) {
      // JSDoc jako dziecko zaczyna się w trywiach następnego tokenu - pomijamy
      // je, żeby komentarz rozpoznał `forEach…CommentRange` niżej.
      if (candidate.kind === ts.SyntaxKind.JSDoc) continue;
      if (candidate.pos <= position && position < candidate.end) {
        child = candidate;
        break;
      }
    }
    if (child === undefined) return null;
    if (position < child.getStart(source)) {
      let comment = false;
      const within = (pos: number, end: number): void => {
        if (pos <= position && position < end) comment = true;
      };
      ts.forEachLeadingCommentRange(source.text, child.pos, within);
      ts.forEachTrailingCommentRange(source.text, child.pos, within);
      return comment ? "comment" : null;
    }
    if (child.getChildCount(source) === 0) return child;
    node = child;
  }
}

/** Węzły-tokeny, w których tekście może stać słowo: identyfikatory, literały, JSX, regex. */
function isTextToken(node: ts.Node): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isPrivateIdentifier(node) ||
    ts.isStringLiteralLike(node) ||
    ts.isTemplateLiteralToken(node) ||
    ts.isRegularExpressionLiteral(node) ||
    ts.isJsxText(node)
  );
}

/** Członek literału obiektu, którego NAZWĄ (wprost albo w `[…]`) jest ten token. */
function memberNamedBy(token: ts.Node): ts.ObjectLiteralElementLike | null {
  const owner = ts.isComputedPropertyName(token.parent) ? token.parent.parent : token.parent;
  const name = ts.isComputedPropertyName(token.parent) ? token.parent : token;
  if (
    owner !== undefined &&
    ts.isObjectLiteralElementLike(owner) &&
    !ts.isSpreadAssignment(owner) &&
    ts.isObjectLiteralExpression(owner.parent) &&
    owner.name === name
  ) {
    return owner;
  }
  return null;
}

/**
 * Obrona w głąb: KAŻDE tekstowe wystąpienie `onConflict` poza komentarzem
 * musi siedzieć w tokenie tekstowym, a jeśli jest nazwą członu literału
 * obiektu z kluczem `onConflict` - ten członek musi być rozstrzygnięty przez
 * przebieg wyżej. Wszystko inne jest czerwone, a nie pominięte: rozjazd
 * między tekstem a drzewem to dokładnie ta klasa błędu, przez którą dawny
 * lekser gubił resztę pliku.
 */
function checkTextualOccurrences(scan: FileScan): void {
  const word = new RegExp(CONFLICT_KEY, "g");
  let match: RegExpExecArray | null;
  while ((match = word.exec(scan.raw)) !== null) {
    const where = locate(scan.source, match.index);
    if (where === "comment") continue;
    if (where === null || !isTextToken(where)) {
      report(scan, match.index, UNCLASSIFIED_REASON);
      continue;
    }
    const member = memberNamedBy(where);
    if (member !== null && propertyKey(member) === CONFLICT_KEY && !scan.classified.has(member)) {
      report(scan, match.index, UNCLASSIFIED_REASON);
    }
  }
}

/** Błędy składni plików przez publiczne API programu (bez typów, bez lib, bez importów). */
function syntaxErrors(sources: readonly ts.SourceFile[]): Map<ts.SourceFile, ts.Diagnostic> {
  const byName = new Map(sources.map((source) => [source.fileName, source]));
  const host: ts.CompilerHost = {
    getSourceFile: (name) => byName.get(name),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => byName.has(name),
    readFile: () => undefined,
  };
  const program = ts.createProgram({
    rootNames: [...byName.keys()],
    options: { noLib: true, noResolve: true, types: [] },
    host,
  });
  const out = new Map<ts.SourceFile, ts.Diagnostic>();
  for (const source of sources) {
    const [first] = program.getSyntacticDiagnostics(source);
    if (first !== undefined) out.set(source, first);
  }
  return out;
}

/**
 * Każdy plik jak moduł ES - tak ładuje go Vite. W „skrypcie" (plik bez
 * `import`/`export`) TypeScript czyta `await (x).upsert(…)` na najwyższym
 * poziomie jako WYWOŁANIE funkcji `await`, a odbiorca znika w argumencie.
 * Hak jest publiczny (`CreateSourceFileOptions`), samo pole - wewnętrzne
 * (to, co ustawia `moduleDetection: "force"`).
 */
function asEsModule(file: ts.SourceFile): void {
  Object.assign(file, { externalModuleIndicator: true });
}

/** Cele `onConflict` ze źródeł - patrz punkt B i „ZAMKNIĘTE NA NIEPEWNOŚĆ" w nagłówku. */
export function extractOnConflictTargets(
  sources: readonly SourceFile[],
  knownTables: ReadonlySet<string>,
): ExtractedTargets {
  const sites: OnConflictSite[] = [];
  const unresolved: UnresolvedOnConflict[] = [];
  let upsertCalls = 0;

  // Tani filtr tekstowy: plik bez obu słów nie ma ani wywołania, ani celu.
  const parsed = sources
    .filter(({ code }) => code.includes("upsert") || code.includes(CONFLICT_KEY))
    .map(({ file, code }) => ({
      file,
      raw: code,
      source: ts.createSourceFile(
        file,
        code,
        { languageVersion: ts.ScriptTarget.Latest, setExternalModuleIndicator: asEsModule },
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    }));
  const errors = syntaxErrors(parsed.map(({ source }) => source));

  for (const { file, raw, source } of parsed) {
    const scan: FileScan = {
      file,
      raw,
      source,
      knownTables,
      sites,
      unresolved,
      classified: new Set(),
      upsertOptions: new Set(),
    };
    const error = errors.get(source);
    if (error !== undefined) {
      const message = ts.flattenDiagnosticMessageText(error.messageText, " ");
      report(
        scan,
        error.start ?? 0,
        `plik ma błąd składni (${message}) - drzewo nie jest wiarygodne`,
      );
    }
    const visit = (node: ts.Node): void => {
      if (isUpsertCall(node)) {
        upsertCalls += 1;
        scanUpsert(scan, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    scanStrayObjects(scan, source);
    checkTextualOccurrences(scan);
  }

  return { sites, unresolved, upsertCalls };
}

// ═══════════════════════════════════════════════════════════════════════════
// Zapadka dynamicznego DDL
// ═══════════════════════════════════════════════════════════════════════════

const MEASURED = "pomiar 2026-10-04 (model == pg_index, 616/616) objął ten plik";

/**
 * Pliki migracji z dynamicznym DDL zdolnym zmienić klucz unikalny i DOKŁADNA
 * liczba takich `EXECUTE` w każdym. Model ich nie wykonuje, ale pomiar
 * różnicowy z nagłówka objął stan PO nich - każde jest więc sprawdzone
 * katalogiem, nie założone.
 *
 * ZAPADKA: lista może tylko MALEĆ. Wpis usuwa się, gdy plik zniknie albo DDL
 * zostanie przepisany statycznie. Nowy plik albo inna liczba zapala bramkę;
 * domyślne lekarstwo to statyczny DDL. Dopisanie wpisu jest wyjątkiem i wymaga
 * nowego porównania modelu z `pg_index` bazy odtworzonej z migracji (zero
 * rozbieżności), z datą tego pomiaru w uzasadnieniu.
 */
export const DYNAMIC_DDL_BASELINE: Readonly<Record<string, DynamicDdlBaselineEntry>> = {
  "20260720124500_follow_publish_alerts.sql": {
    count: 1,
    why: `DROP CONSTRAINT %I wybiera wyłącznie CHECK (contype = 'c') user_follows - ${MEASURED}`,
  },
  "20260720125526_e5987a7f-2285-4bb5-a79b-9d5821cd1df5.sql": {
    count: 1,
    why: `bliźniak poprzedniego: DROP CONSTRAINT %I tylko dla CHECK user_follows - ${MEASURED}`,
  },
  "20260815110844_54c27fbd-795e-4ad4-b4a4-e2ccc05135cc.sql": {
    count: 3,
    why: `CHECK programs (contype 'c') oraz FK research_program_* (contype 'f') - zdjęte i dodane - ${MEASURED}`,
  },
  "20260823140000_event_sessions.sql": {
    count: 1,
    why: `ADD CONSTRAINT … EXCLUDE USING gist - nie arbiter listy kolumn - ${MEASURED}`,
  },
  "20260823180000_event_onsite.sql": {
    count: 1,
    why: `ADD CONSTRAINT … EXCLUDE USING gist (event_checkins) - nie arbiter - ${MEASURED}`,
  },
  "20260823190000_event_meetings.sql": {
    count: 3,
    why: `trzy ADD CONSTRAINT … EXCLUDE USING gist (event_meeting_*) - nie arbitrzy - ${MEASURED}`,
  },
  "20260824083841_20857804-c3de-4bf0-b5c9-6a70404271f4.sql": {
    count: 1,
    why: `bliźniak event_sessions: EXCLUDE USING gist - nie arbiter - ${MEASURED}`,
  },
  "20260824101235_a8f6e612-baeb-4796-bf6f-eeb5f2d71c08.sql": {
    count: 1,
    why: `bliźniak event_onsite: EXCLUDE USING gist - nie arbiter - ${MEASURED}`,
  },
  "20260825062550_e3e4c344-184d-4f94-b3ed-8645d7d77117.sql": {
    count: 3,
    why: `bliźniak event_meetings: trzy EXCLUDE USING gist - nie arbitrzy - ${MEASURED}`,
  },
  "20260915090000_legal_document_versions_compliance_pack_keys.sql": {
    count: 1,
    why: `DROP CONSTRAINT %I wybiera wyłącznie CHECK (contype = 'c') legal_document_versions - ${MEASURED}`,
  },
};

/**
 * Rozjazd z zapadką dla plików z WEJŚCIA. Wpis bazy, którego pliku nie ma
 * w wejściu (fixture testu, migracje spłaszczone), nie jest tu błędem - że
 * każdy wpis wskazuje istniejącą migrację, pilnuje test stanu repozytorium.
 */
export function dynamicDdlDrift(
  migrations: readonly MigrationFile[],
  dynamicDdl: readonly DynamicDdl[],
  baseline: Readonly<Record<string, DynamicDdlBaselineEntry>> = DYNAMIC_DDL_BASELINE,
): DynamicDdlDrift[] {
  const texts = new Map<string, string[]>();
  for (const entry of dynamicDdl)
    texts.set(entry.file, [...(texts.get(entry.file) ?? []), entry.text]);
  const drift: DynamicDdlDrift[] = [];
  for (const { file } of migrations) {
    const found = texts.get(file) ?? [];
    const expected = Object.hasOwn(baseline, file) ? baseline[file].count : 0;
    if (found.length !== expected)
      drift.push({ file, expected, actual: found.length, texts: found });
  }
  return drift;
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
  /** Migracje POSORTOWANE chronologicznie, tekst SUROWY. */
  readonly migrations: readonly MigrationFile[];
  /** Kod produkcyjny (bez testów) - surowy, parsuje go kompilator TypeScript. */
  readonly sources: readonly SourceFile[];
  /** Zapadka dynamicznego DDL - domyślnie `DYNAMIC_DDL_BASELINE` (wstrzykiwana w testach). */
  readonly dynamicDdlBaseline?: Readonly<Record<string, DynamicDdlBaselineEntry>>;
}

export function analyzeOnConflictArbiters({
  migrations,
  sources,
  dynamicDdlBaseline = DYNAMIC_DDL_BASELINE,
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
    dynamicDdlDrift: dynamicDdlDrift(migrations, model.dynamicDdl, dynamicDdlBaseline),
    unsplittable: model.unsplittable,
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
    report.unresolved.length > 0 ||
    report.dynamicDdlDrift.length > 0 ||
    report.unsplittable.length > 0
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

  if (report.dynamicDdlDrift.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `✗ [on-conflict-arbiters] ${report.dynamicDdlDrift.length} migracji z dynamicznym DDL kluczy ` +
        "poza zapadką DYNAMIC_DDL_BASELINE (model go nie wykonuje):",
    );
    for (const drift of report.dynamicDdlDrift) {
      lines.push(`    ${drift.file}  w zapadce: ${drift.expected}, w pliku: ${drift.actual}`);
      for (const text of drift.texts) lines.push(`      EXECUTE ${text}`);
    }
    lines.push(
      "",
      "  `EXECUTE format(…)`, sklejany tekst albo `EXECUTE zmienna` może zdjąć lub dodać",
      "  klucz unikalny, którego model nie zobaczy - bramka byłaby zielona przy 42P10",
      "  w bazie. Zapisz DDL statycznie (`ALTER TABLE … DROP CONSTRAINT nazwa`,",
      "  `CREATE UNIQUE INDEX IF NOT EXISTS …`) - model zobaczy go od razu. Wyjątkowo:",
      "  dopisz plik do DYNAMIC_DDL_BASELINE (src/lib/ci/onConflictArbiters.ts) dopiero",
      "  po porównaniu modelu z pg_index bazy odtworzonej z migracji (zero rozbieżności).",
      "  Gdy liczba spadła albo plik zniknął - zmniejsz wpis: zapadka może tylko maleć.",
    );
  }

  if (report.unsplittable.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `✗ [on-conflict-arbiters] ${report.unsplittable.length} tekstów SQL nie daje się podzielić ` +
        "na instrukcje (lexStatements) - ich DDL nie weszło do modelu:",
    );
    for (const entry of report.unsplittable) lines.push(`    ${entry.file}  ${entry.message}`);
    lines.push(
      "",
      "  Model bez tych instrukcji mógłby nie znać zdjętego albo dodanego klucza. Popraw",
      "  składnię migracji (czysty SQL, bez meta-poleceń psql i `COPY … FROM STDIN`).",
    );
  }

  if (lines.length === 0) {
    return (
      `✓ Arbitrzy onConflict OK (${report.sites.length} celów w ${report.upsertCalls} wywołaniach ` +
      `.upsert, ${report.scannedFiles} plików; model: ${report.tablesInModel} tabel z ` +
      `${report.migrationStatements} instrukcji migracji; dynamiczne DDL kluczy w zapadce: ` +
      `${report.dynamicDdl.length}).`
    );
  }
  return lines.join("\n");
}

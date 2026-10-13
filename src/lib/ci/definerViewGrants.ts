// Bramka: widok w schemacie public, przez który zapis omija RLS, jest dla ról
// klienckich TYLKO DO ODCZYTU - w OBU pasach migracji (supabase/ i drizzle/).
//
// PRZYCZYNA ŹRÓDŁOWA (zmierzone na produkcji 2026-10-12). `pg_default_acl` roli
// postgres w public daje anon, authenticated i service_role `arwdDxtm` na KAŻDĄ
// nową relację, więc `CREATE VIEW` oddaje klientom INSERT/UPDATE/DELETE,
// a późniejszy `GRANT SELECT` tego nie zawęża. Widok `security_invoker = off`
// (albo bez tej opcji - domyślnie DEFINER) sprawdza tabelę bazową jako
// właściciel - postgres z BYPASSRLS - a prosty widok Postgres aktualizuje sam.
// Zapis przez PostgREST omijał więc CAŁE RLS tabeli bazowej (dziewięć widoków,
// domknięte w 20261012200000 i 20261012210000).
//
// DLACZEGO STATYCZNIE I PO OBU PASACH. Test pgTAP
// (supabase/tests/public_definer_views_read_only_test.sql) widzi wyłącznie
// bazę zbudowaną z supabase/migrations. Migracja panelu Lovable bywa TYLKO
// w drizzle/ (0148, 0150, 0170) i Lovable wgrywa ją na produkcję, zanim CI
// cokolwiek uruchomi. Ta bramka czyta oba pasy - drizzle w kolejności
// `_journal.json`, bo tylko te pliki migrator wykonuje.
//
// REGUŁA - PER PLIK, BEZ ZAUFANIA DO HISTORII. Każda instrukcja, po której
// widok public może przepuszczać zapis obok RLS, musi w TYM SAMYM pliku
// dostać `REVOKE ALL ON <widok> FROM anon, authenticated` (może być w kilku
// instrukcjach, byle zdjęły wszystkie prawa poza SELECT) albo przełączenie na
// `security_invoker = on`. Takie instrukcje to:
//   * `CREATE [OR REPLACE] VIEW` bez `security_invoker = on`,
//   * `ALTER VIEW|TABLE ... SET (security_invoker = off)` i `RESET (...)`,
//   * `CREATE TRIGGER ... INSTEAD OF ... ON <widok>` - funkcja wyzwalacza
//     (np. SECURITY DEFINER, jak przy suppressed_emails) pisze do bazy jako
//     ktoś inny niż klient, więc nawet widok INVOKER musi być wtedy zamknięty.
// Bramka NIE zakłada, że `CREATE OR REPLACE` zachowa wcześniej zdjęte prawa.
// W Postgresie zachowuje - ale tylko gdy pod tą nazwą wciąż stoi TEN SAM widok.
// `DROP ... CASCADE` tabeli bazowej, `RENAME`, `SET SCHEMA` i przeplot pasów
// (drizzle trafia na produkcję w innej kolejności niż supabase do CI) potrafią
// podmienić widok niezauważenie, a nowy dostaje świeże `arwdDxtm`. Wymóg
// REVOKE w każdym pliku jest tani (dwie idempotentne linie) i nie zależy od
// kolejności czegokolwiek.
//
// Do tego żaden GRANT praw innych niż SELECT dla anon/authenticated/PUBLIC na
// widok, który w tym miejscu historii jest DEFINEREM albo ma INSTEAD OF
// trigger - także w innym pliku niż jego CREATE i z pasa drizzle na widok
// z pasa supabase. Widok spoza public też jest śledzony, bo `SET SCHEMA public`
// przenosi go razem z prawami i triggerami.
//
// FAIL CLOSED. Instrukcja `CREATE ... VIEW` albo `ALTER VIEW|TABLE` dotykająca
// `security_invoker`, której parser nie rozpozna, czerwieni bramkę jako
// nierozpoznana - cicha luka parsera byłaby luką bramki. Tak samo plik, którego
// nie da się poprawnie podzielić na instrukcje.
//
// CZEGO NIE WIDZI, powiedziane wprost: SQL-a dynamicznego (`DO $$ ... $$`,
// `EXECUTE`, ciała funkcji). REVOKE w bloku DO też się nie liczy - musi być
// instrukcją najwyższego poziomu. W żadnym pasie nie ma dziś widoku tworzonego
// dynamicznie (sprawdzone 2026-10-13).
//
// Historyczne naruszenia, domknięte późniejszą migracją, stoją w rejestrze
// `KNOWN_DEFINER_VIEW_OFFENDERS` z WSKAZANIEM pliku, który je domyka. Bramka
// sprawdza ten wskaźnik: plik musi istnieć w tym samym pasie, być późniejszy
// i rzeczywiście zamykać ten widok (a sam nie być dla niego naruszeniem).
// Martwy albo zdublowany wpis czerwieni bramkę, a test jednostkowy pilnuje, że
// rejestr nie rośnie - nowe naruszenie naprawia się migracją, nie wpisem.
import { lexStatements, objectName } from "./migrationSplit";

export type MigrationLane = "supabase" | "drizzle";

export interface LaneFiles {
  readonly lane: MigrationLane;
  /** Pliki w kolejności zastosowania (supabase: po nazwie, drizzle: jak w `_journal.json`). */
  readonly files: readonly { readonly name: string; readonly sql: string }[];
}

/** Role, którym taki widok wolno dać wyłącznie SELECT. */
const CLIENT_ROLES = ["anon", "authenticated", "public"] as const;
type ClientRole = (typeof CLIENT_ROLES)[number];

/** Wszystkie prawa do relacji poza SELECT (PostgreSQL 17). */
const NON_SELECT_PRIVILEGES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

export interface DefinerViewOffender {
  readonly lane: MigrationLane;
  readonly file: string;
  /** `schema.nazwa` jak w `objectName`. */
  readonly view: string;
  /** Linia instrukcji, która otworzyła zapis dla pierwszej wciąż otwartej roli. */
  readonly line: number;
  readonly reason: string;
}

export interface KnownDefinerViewOffender {
  readonly lane: MigrationLane;
  readonly file: string;
  readonly view: string;
  /** Późniejszy plik tego samego pasa, który zamyka ten widok (REVOKE ALL albo INVOKER). */
  readonly closedBy: string;
}

export interface DefinerViewReport {
  readonly filesScanned: number;
  readonly viewStatements: number;
  readonly offenders: readonly DefinerViewOffender[];
  /** Naruszenia spoza rejestru znanych przypadków - czerwienią bramkę. */
  readonly fresh: readonly DefinerViewOffender[];
  /** Wady rejestru (martwy wpis, zły wskaźnik domknięcia) - też czerwienią bramkę. */
  readonly registryDefects: readonly string[];
  /** Instrukcje i pliki, których bramka nie umie odczytać (fail closed) - też czerwienią. */
  readonly parseDefects: readonly string[];
  /** `pas:plik` -> widoki, które ten plik zamyka. Do walidacji `closedBy` i `--print-baseline`. */
  readonly closingFiles: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * ZAMKNIĘTE NARUSZENIA HISTORYCZNE. Każdy wpis to plik, po którym widok
 * zostawał zapisywalny dla klientów obok RLS, oraz PÓŹNIEJSZY plik tego samego
 * pasa, który go domyka - bramka sprawdza oba fakty. Ostatnie domknięcia to
 * 20261012200000 (author_profiles_public) i 20261012210000 (pozostałe widoki
 * oraz content_access_public), zmierzone wcześniej na produkcji jako otwarte.
 * Lista może TYLKO MALEĆ (pilnuje tego test): nowe naruszenie naprawia się
 * migracją, nie wpisem. `bun run check:sql-definer-views --print-baseline`
 * wypisuje wpisy z najwcześniejszym plikiem domykającym.
 */
export const KNOWN_DEFINER_VIEW_OFFENDERS: readonly KnownDefinerViewOffender[] = [
  {
    lane: "supabase",
    file: "20260630053403_8783ac8b-8092-4a26-975b-be3447edc0c6.sql",
    view: "public.crm_leads_all",
    closedBy: "20260630053423_bf91f7f8-e8d0-4f3c-b2ca-e8b4d0df82b6.sql",
  },
  {
    lane: "supabase",
    file: "20260720085217_883486b3-1999-4684-99bb-38e0a7011958.sql",
    view: "public.content_access_public",
    closedBy: "20260720093437_d59e3029-1b69-48df-8bdf-5e63d5755390.sql",
  },
  {
    lane: "supabase",
    file: "20260720085723_dbdfd2ec-5fb4-478d-85d8-0378a24eaa9e.sql",
    view: "public.profiles_public",
    closedBy: "20260720093437_d59e3029-1b69-48df-8bdf-5e63d5755390.sql",
  },
  {
    lane: "supabase",
    file: "20260721063638_9fcae354-687c-4d57-bce7-b119d7b51f81.sql",
    view: "public.content_access_public",
    closedBy: "20260721105920_6d2d2d93-88b6-46e5-9104-17ecf307b4cb.sql",
  },
  {
    lane: "supabase",
    file: "20260721120000_crm_tasks_followups.sql",
    view: "public.content_access_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260723123230_b3623a89-2120-41ce-99ad-908ed83f3f4f.sql",
    view: "public.profiles_public",
    closedBy: "20260723151902_65ed789d-848f-42cc-b6ca-ddd115784f23.sql",
  },
  {
    lane: "supabase",
    file: "20260723184018_96a04425-b6ed-46a3-88c6-0661569d9ead.sql",
    view: "public.profiles_public",
    closedBy: "20260724051752_4485332f-f2cc-4d0f-8ef5-792804cca0a0.sql",
  },
  {
    lane: "supabase",
    file: "20260724090100_fix_profiles_authenticated_pii_and_anon_view.sql",
    view: "public.profiles_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724105044_f401da59-ff88-41a1-af7c-51603f8ac7e5.sql",
    view: "public.profiles_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724114239_ec696e17-0cdd-4d75-bddb-22f35a226eee.sql",
    view: "public.author_profiles_public",
    closedBy: "20261012200000_author_profiles_public_drop_contact_email.sql",
  },
  {
    lane: "supabase",
    file: "20260724115134_828ca291-240c-4b8c-a4b2-7ad696bfc05f.sql",
    view: "public.profiles_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724130000_expert_request_visibility.sql",
    view: "public.profiles_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724144112_932a6613-7d7f-43d2-958c-11a6fad3880f.sql",
    view: "public.personality_results_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724202133_c4dbe126-be8c-436e-b3a0-040f2daddf1f.sql",
    view: "public.profile_skills_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724202133_c4dbe126-be8c-436e-b3a0-040f2daddf1f.sql",
    view: "public.profile_experiences_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724202133_c4dbe126-be8c-436e-b3a0-040f2daddf1f.sql",
    view: "public.profile_education_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724202133_c4dbe126-be8c-436e-b3a0-040f2daddf1f.sql",
    view: "public.profile_hobbies_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260724202133_c4dbe126-be8c-436e-b3a0-040f2daddf1f.sql",
    view: "public.profile_awards_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260730072101_d98e0fa6-97b3-48e1-bb66-3cb2b1421073.sql",
    view: "public.author_profiles_public",
    closedBy: "20261012200000_author_profiles_public_drop_contact_email.sql",
  },
  {
    lane: "supabase",
    file: "20260730120000_author_contact_privacy.sql",
    view: "public.author_profiles_public",
    closedBy: "20261012200000_author_profiles_public_drop_contact_email.sql",
  },
  {
    lane: "supabase",
    file: "20260806160000_profiles_public_anon_gate.sql",
    view: "public.profiles_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260806183256_462f3e78-f5ff-4410-8a2b-25560fbcea2b.sql",
    view: "public.profiles_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260807061849_214732d8-7250-4da3-8d6d-ea03b22bdabb.sql",
    view: "public.profiles_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260817230000_career_sections_visibility_public_read.sql",
    view: "public.career_page_sections_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
  {
    lane: "supabase",
    file: "20260818061944_397f082a-34ba-4c68-8a6f-71b7248c0bd7.sql",
    view: "public.career_page_sections_public",
    closedBy: "20261012210000_public_definer_views_read_only.sql",
  },
];

// ---------------------------------------------------------------------------
// Tokeny. Instrukcje rozpoznajemy na znormalizowanym ciągu tokenów
// rozdzielonych pojedynczą spacją: `AS(`, `)AS`, `VIEW"x"` i `WITH(...)AS` są
// w Postgresie poprawne bez białych znaków, a wzorce na surowym tekście by je
// przeoczyły.
// ---------------------------------------------------------------------------

const WORD = /[A-Za-z0-9_$\u0080-￿]/;

/**
 * Tokenizuje kod SQL bez komentarzy. `keepLiterals = false` dla szkieletu
 * z `lexStatements` (literały są tam już `''`, ciała dolarowe `$$`).
 * Z `keepLiterals = true` czytamy surowy tekst instrukcji: komentarze są
 * pomijane, literały zostają całe - tylko po to, żeby odczytać wartość opcji.
 */
function tokenize(src: string, keepLiterals: boolean): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i += 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else i += 1;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === ch) {
          if (src[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      const token = src.slice(i, j + 1);
      out.push(ch === "'" && !keepLiterals ? "''" : token);
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(src.slice(i));
      if (tag) {
        // Szkielet ma już ciało zamaskowane do `$$`; surowy tekst - szukamy tagu zamykającego.
        const end = keepLiterals ? src.indexOf(tag[0], i + tag[0].length) : -1;
        out.push("$$");
        i = keepLiterals && end !== -1 ? end + tag[0].length : i + tag[0].length;
        continue;
      }
    }
    if (WORD.test(ch)) {
      let j = i + 1;
      while (j < src.length && WORD.test(src[j]!)) j += 1;
      out.push(src.slice(i, j));
      i = j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*)`;
const QNAME = String.raw`${IDENT}(?: \. ${IDENT})*`;
const rx = (src: string): RegExp => new RegExp(src, "i");

const RE_ANY_VIEW = rx(
  String.raw`^CREATE (?:OR REPLACE )?(?:(?:TEMP|TEMPORARY|RECURSIVE|MATERIALIZED) )*VIEW\b`,
);
const RE_CREATE_VIEW = rx(
  String.raw`^CREATE (OR REPLACE )?((?:(?:TEMP|TEMPORARY|RECURSIVE|MATERIALIZED) )*)VIEW (?:IF NOT EXISTS )?(${QNAME})(?: \( [^()]*\))?(?: WITH \( ([^()]*)\))? AS\b`,
);
const RE_SCHEMA_ELEMENT_VIEW = rx(
  String.raw`^CREATE SCHEMA\b.* CREATE (?:OR REPLACE )?(?:(?:TEMP|TEMPORARY|RECURSIVE) )*VIEW\b`,
);
const RE_ALTER_REL = rx(String.raw`^ALTER (VIEW|TABLE) (?:IF EXISTS )?(?:ONLY )?(${QNAME}) (.*)$`);
const RE_RENAME = rx(String.raw`^RENAME TO (${IDENT})(?: ;)?$`);
const RE_SET_SCHEMA = rx(String.raw`^SET SCHEMA (${IDENT})(?: ;)?$`);
const RE_OPTION_GROUP = /\b(SET|RESET) \( ([^()]*)\)/gi;
const RE_DROP_VIEW = rx(
  String.raw`^DROP VIEW (?:IF EXISTS )?(.+?)(?: (?:CASCADE|RESTRICT))?(?: ;)?$`,
);
const RE_CREATE_TABLE = rx(
  String.raw`^CREATE (?:(?:GLOBAL|LOCAL) )?(?:(?:TEMP|TEMPORARY|UNLOGGED) )?TABLE (?:IF NOT EXISTS )?(${QNAME})\b`,
);
const RE_INSTEAD_TRIGGER = rx(
  String.raw`^CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER ${IDENT} INSTEAD OF .+? ON (${QNAME}) `,
);
const RE_GRANT = rx(
  String.raw`^GRANT (.+?) ON (.+?) TO (.+?)(?: WITH GRANT OPTION)?(?: GRANTED BY .+?)?(?: ;)?$`,
);
const RE_REVOKE = rx(
  String.raw`^REVOKE (GRANT OPTION FOR )?(.+?) ON (.+?) FROM (.+?)(?: GRANTED BY .+?)?(?: (?:CASCADE|RESTRICT))?(?: ;)?$`,
);
const RE_ALL_IN_SCHEMA = rx(String.raw`^ALL TABLES IN SCHEMA (.+)$`);
const RE_NON_RELATION_TARGET = rx(
  String.raw`^(?:FUNCTION|PROCEDURE|ROUTINE|SEQUENCE|SCHEMA|DATABASE|DOMAIN|TYPE|LANGUAGE|TABLESPACE|FOREIGN|LARGE|PARAMETER|ALL (?:FUNCTIONS|PROCEDURES|ROUTINES|SEQUENCES))\b`,
);

/** Wartość opcji logicznej PostgreSQL (`on`/`true`/`1`/`yes`...) albo `null`, gdy nieczytelna. */
function pgBool(raw: string): boolean | null {
  const v = raw
    .trim()
    .replace(/^'(.*)'$/, "$1")
    .toLowerCase();
  if (["on", "true", "1", "yes", "y", "t"].includes(v)) return true;
  if (["off", "false", "0", "no", "n", "f"].includes(v)) return false;
  return null;
}

/**
 * Wartość `security_invoker` z listy opcji (`a = b , c`); `undefined`, gdy
 * opcji nie ma. Nazwa może stać w cudzysłowie, sama nazwa znaczy true, a
 * nieczytelna wartość liczy się jako DEFINER (bezpieczny kierunek błędu).
 */
function securityInvokerOption(options: string): boolean | undefined {
  let found: boolean | undefined;
  for (const item of splitTopLevel(options)) {
    const m = /^"?security_invoker"? *(?:= *(.+))?$/i.exec(item.trim());
    if (!m) continue;
    found = m[1] === undefined ? true : pgBool(m[1]) === true;
  }
  return found;
}

/** Elementy listy rozdzielonej przecinkami na najwyższym poziomie nawiasów. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let inQuote = false;
  for (const ch of list) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && ch === "(") depth += 1;
    if (!inQuote && ch === ")") depth -= 1;
    if (!inQuote && depth === 0 && ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** Nazwy relacji z listy celów (`[TABLE] a , b`). */
function targetNames(list: string): string[] {
  return splitTopLevel(list.replace(/^TABLE /i, "")).map((item) => objectName(item));
}

/** Role z listy odbiorców; `PUBLIC`, `GROUP x` i `"anon"` znormalizowane. */
function roleNames(list: string): string[] {
  return splitTopLevel(list).map((r) => {
    const name = r.replace(/^GROUP /i, "");
    return name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name.toLowerCase();
  });
}

const clientRoles = (list: string): ClientRole[] =>
  roleNames(list).filter((r): r is ClientRole => (CLIENT_ROLES as readonly string[]).includes(r));

interface PrivilegeSet {
  /** Prawa całej relacji; `ALL` rozwinięte. */
  readonly table: ReadonlySet<string>;
  /** Prawa kolumnowe (`UPDATE (a)`) - otwierają zapis, ale nie zamykają go. */
  readonly column: ReadonlySet<string>;
}

function privileges(list: string): PrivilegeSet {
  const table = new Set<string>();
  const column = new Set<string>();
  for (const item of splitTopLevel(list)) {
    const m = /^([A-Za-z]+)(?: PRIVILEGES)?(?: (\(.*\)))?$/i.exec(item);
    if (!m) continue;
    const name = m[1]!.toUpperCase();
    const target = m[2] ? column : table;
    if (name === "ALL") for (const p of ["SELECT", ...NON_SELECT_PRIVILEGES]) target.add(p);
    else target.add(name);
  }
  return { table, column };
}

const isPublic = (name: string): boolean => name.startsWith("public.");

interface Opening {
  readonly line: number;
  readonly reason: string;
}

/** Stan widoku W OBRĘBIE jednego pliku: kto ma jakie prawa poza SELECT. */
interface FileViewState {
  /** Prawa poza SELECT (relacja + kolumny) na rolę. */
  readonly open: Record<ClientRole, Set<string>>;
  /** Zdarzenie, które ostatnio otworzyło zapis danej roli. */
  readonly at: Record<ClientRole, Opening | null>;
}

const freshDefaults = (opening: Opening): FileViewState => ({
  open: {
    anon: new Set(NON_SELECT_PRIVILEGES),
    authenticated: new Set(NON_SELECT_PRIVILEGES),
    public: new Set(),
  },
  at: { anon: opening, authenticated: opening, public: null },
});

const emptyState = (): FileViewState => ({
  open: { anon: new Set(), authenticated: new Set(), public: new Set() },
  at: { anon: null, authenticated: null, public: null },
});

interface LaneScan {
  offenders: DefinerViewOffender[];
  parseDefects: string[];
  /** Widok -> czy DEFINER (stan końcowy pasa; drizzle startuje ze stanem supabase). */
  definer: Map<string, boolean>;
  /** Widoki z INSTEAD OF triggerem (przeżywa CREATE OR REPLACE, ginie z DROP VIEW). */
  triggered: Set<string>;
  viewStatements: number;
}

function scanLane(
  lane: LaneFiles,
  seed: Pick<LaneScan, "definer" | "triggered">,
  closing: Map<string, Set<string>>,
): LaneScan {
  const definer = new Map(seed.definer);
  const triggered = new Set(seed.triggered);
  const offenders: DefinerViewOffender[] = [];
  const parseDefects: string[] = [];
  let viewStatements = 0;
  const dir = lane.lane === "supabase" ? "supabase/migrations" : "drizzle/migrations";

  for (const file of lane.files) {
    const where = (line: number) => `${dir}/${file.name}:${line}`;
    const states = new Map<string, FileViewState>();
    const closed = new Set<string>();
    let segments;
    try {
      segments = lexStatements(file.sql);
    } catch (error) {
      parseDefects.push(
        `${dir}/${file.name}: nie da się podzielić na instrukcje - ${(error as Error).message}`,
      );
      continue;
    }

    const stateOf = (view: string, opening: Opening): FileViewState => {
      let s = states.get(view);
      if (!s) {
        s = freshDefaults(opening);
        states.set(view, s);
      }
      return s;
    };
    const rename = (from: string, to: string) => {
      if (definer.has(from)) {
        definer.set(to, definer.get(from)!);
        definer.delete(from);
      }
      const s = states.get(from);
      if (s) {
        states.set(to, s);
        states.delete(from);
      }
      if (closed.delete(from)) closed.add(to);
      if (triggered.delete(from)) triggered.add(to);
    };
    const knownViews = (schemaList: string): string[] => {
      const schemas = splitTopLevel(schemaList).map((s) => objectName(`${s} . x`).split(".")[0]!);
      return [...new Set([...definer.keys(), ...states.keys()])].filter((v) =>
        schemas.includes(v.split(".")[0]!),
      );
    };
    const viewTargets = (list: string): string[] => {
      const all = RE_ALL_IN_SCHEMA.exec(list);
      return all
        ? knownViews(all[1]!)
        : targetNames(list).filter((v) => definer.has(v) || states.has(v));
    };

    for (const seg of segments) {
      if (seg.codeStart === -1) continue;
      const sk = tokenize(seg.skeleton, false).join(" ");
      const opening = (reason: string): Opening => ({ line: seg.line, reason });
      let m: RegExpExecArray | null;

      if (/^CREATE (?:OR REPLACE )?MATERIALIZED VIEW\b/i.test(sk)) continue; // nie da się przez nie pisać
      if (RE_ANY_VIEW.test(sk) || RE_SCHEMA_ELEMENT_VIEW.test(sk)) {
        m = RE_CREATE_VIEW.exec(sk);
        if (!m) {
          parseDefects.push(
            `${where(seg.line)}: nierozpoznany CREATE VIEW - bramka nie wie, czy widok jest DEFINEREM`,
          );
          continue;
        }
        if (/TEMP/i.test(m[2]!)) continue; // obiekt sesji, nie schematu public
        // Widoki spoza public też śledzimy - `ALTER VIEW ... SET SCHEMA public` może je przenieść.
        const view = objectName(m[3]!);
        if (isPublic(view)) viewStatements += 1;
        // Wartość opcji czytamy z kodu bez komentarzy, ale z literałami (szkielet ma `''`).
        let invoker = securityInvokerOption(m[4] ?? "");
        if (m[4] !== undefined && /''/.test(m[4])) {
          const raw = tokenize(seg.text.slice(seg.codeStart), true).join(" ");
          const w = / WITH \( ([^()]*)\) AS\b/i.exec(raw);
          invoker = securityInvokerOption(w?.[1] ?? "");
        }
        const isInvoker = invoker === true;
        definer.set(view, !isInvoker);
        // Zawsze świeże domyślne prawa: patrz REGUŁA w nagłówku.
        states.set(
          view,
          freshDefaults(
            opening(
              isInvoker
                ? "widok INVOKER (domyślne arwdDxtm)"
                : `${m[1] ? "CREATE OR REPLACE" : "CREATE"} VIEW bez security_invoker = on`,
            ),
          ),
        );
        if (isInvoker) closed.add(view);
        continue;
      }

      if ((m = RE_ALTER_REL.exec(sk))) {
        const view = objectName(m[2]!);
        const action = m[3]!;
        if ((m = RE_RENAME.exec(action))) {
          rename(view, objectName(`${view.split(".")[0]!} . ${m[1]!}`));
          continue;
        }
        if ((m = RE_SET_SCHEMA.exec(action))) {
          rename(view, objectName(`${m[1]!} . ${view.split(".").slice(1).join(".")}`));
          continue;
        }
        if (!/security_invoker/i.test(action)) continue;
        const groups = [...action.matchAll(RE_OPTION_GROUP)];
        if (groups.length === 0) {
          parseDefects.push(`${where(seg.line)}: nierozpoznana zmiana security_invoker`);
          continue;
        }
        for (const g of groups) {
          const opts = g[2]!;
          if (!/security_invoker/i.test(opts)) continue;
          let invoker =
            g[1]!.toUpperCase() === "SET" ? securityInvokerOption(opts) === true : false;
          if (g[1]!.toUpperCase() === "SET" && /''/.test(opts)) {
            const raw = tokenize(seg.text.slice(seg.codeStart), true).join(" ");
            const all = [...raw.matchAll(RE_OPTION_GROUP)].filter((x) =>
              /security_invoker/i.test(x[2]!),
            );
            invoker = all.length > 0 && securityInvokerOption(all[all.length - 1]![2]!) === true;
          }
          definer.set(view, !invoker);
          if (invoker) closed.add(view);
          else {
            closed.delete(view);
            stateOf(
              view,
              opening("ALTER ... security_invoker = off/RESET (widok staje się DEFINEREM)"),
            );
          }
        }
        continue;
      }

      if ((m = RE_DROP_VIEW.exec(sk))) {
        for (const view of targetNames(m[1]!)) {
          definer.delete(view);
          triggered.delete(view);
          states.delete(view);
          closed.delete(view);
        }
        continue;
      }

      if ((m = RE_CREATE_TABLE.exec(sk))) {
        const name = objectName(m[1]!);
        definer.delete(name);
        triggered.delete(name);
        states.delete(name);
        continue;
      }

      if ((m = RE_INSTEAD_TRIGGER.exec(sk))) {
        const view = objectName(m[1]!);
        triggered.add(view);
        // Zamknięcie wymagane także dla INVOKER-a - zapis idzie przez funkcję wyzwalacza.
        stateOf(view, opening("INSTEAD OF trigger (zapis przez funkcję wyzwalacza)"));
        continue;
      }

      if ((m = RE_REVOKE.exec(sk))) {
        if (m[1] || RE_NON_RELATION_TARGET.test(m[3]!)) continue; // GRANT OPTION FOR zdejmuje tylko prawo nadawania
        const privs = privileges(m[2]!);
        const roles = clientRoles(m[4]!);
        for (const view of viewTargets(m[3]!)) {
          // Widok bez stanu w tym pliku: REVOKE liczymy wobec ZAŁOŻONYCH domyślnych praw -
          // pełne zdjęcie zamyka widok (plik domykający), częściowe niczego nie otwiera.
          const s = states.get(view) ?? freshDefaults(opening("prawa sprzed pliku"));
          for (const r of roles) {
            // REVOKE na relacji zdejmuje też prawa kolumnowe tego rodzaju; kolumnowy - tylko kolumnowe.
            for (const p of privs.table) {
              s.open[r].delete(p);
              s.open[r].delete(`${p}(kol)`);
            }
            for (const p of privs.column) s.open[r].delete(`${p}(kol)`);
            if (s.open[r].size === 0) s.at[r] = null;
          }
          if (CLIENT_ROLES.every((r) => s.open[r].size === 0)) closed.add(view);
        }
        continue;
      }

      if ((m = RE_GRANT.exec(sk))) {
        if (RE_NON_RELATION_TARGET.test(m[2]!)) continue;
        const privs = privileges(m[1]!);
        const write = [...privs.table].filter((p) => p !== "SELECT");
        const writeCols = [...privs.column].filter((p) => p !== "SELECT").map((p) => `${p}(kol)`);
        const roles = clientRoles(m[3]!);
        if (roles.length === 0 || write.length + writeCols.length === 0) continue;
        for (const view of viewTargets(m[2]!)) {
          let s = states.get(view);
          if (!s) {
            s = emptyState();
            states.set(view, s);
          }
          for (const r of roles) {
            for (const p of [...write, ...writeCols]) s.open[r].add(p);
            s.at[r] = opening(`GRANT ${[...write, ...writeCols].join(", ")} dla ${r}`);
          }
          closed.delete(view);
        }
      }
    }

    for (const [view, s] of states) {
      if (!isPublic(view)) continue;
      const mustClose = definer.get(view) === true || triggered.has(view);
      const roles = CLIENT_ROLES.filter((r) => s.open[r].size > 0);
      if (!mustClose || roles.length === 0) continue;
      closed.delete(view);
      const first = roles
        .map((r) => s.at[r])
        .filter((a): a is Opening => a !== null)
        .sort((a, b) => a.line - b.line)[0] ?? { line: 1, reason: "widok bez zamknięcia" };
      offenders.push({
        lane: lane.lane,
        file: file.name,
        view,
        line: first.line,
        reason: `${first.reason}${triggered.has(view) ? " + INSTEAD OF trigger" : ""}; po pliku zostaje: ${roles
          .map((r) => `${r} (${[...s.open[r]].join(", ")})`)
          .join("; ")}`,
      });
    }
    for (const view of closed) {
      if (!isPublic(view)) continue;
      const key = `${lane.lane}:${file.name}`;
      if (!closing.has(key)) closing.set(key, new Set());
      closing.get(key)!.add(view);
    }
  }
  return { offenders, parseDefects, definer, triggered, viewStatements };
}

const offenderKey = (o: { lane: string; file: string; view: string }): string =>
  `${o.lane}:${o.file}:${o.view}`;

/** Analiza obu pasów względem rejestru znanych, domkniętych przypadków. */
export function analyzeDefinerViews(
  lanes: readonly LaneFiles[],
  known: readonly KnownDefinerViewOffender[],
): DefinerViewReport {
  const closing = new Map<string, Set<string>>();
  const supabase = lanes.find((l) => l.lane === "supabase") ?? { lane: "supabase", files: [] };
  const drizzle = lanes.find((l) => l.lane === "drizzle") ?? { lane: "drizzle", files: [] };
  const a = scanLane(supabase, { definer: new Map(), triggered: new Set() }, closing);
  const b = scanLane(drizzle, a, closing);
  const offenders = [...a.offenders, ...b.offenders];

  const knownKeys = new Set(known.map(offenderKey));
  const offenderKeys = new Set(offenders.map(offenderKey));
  const fresh = offenders.filter((o) => !knownKeys.has(offenderKey(o)));
  const registryDefects: string[] = [];
  const filesOf = new Map<MigrationLane, string[]>([
    ["supabase", supabase.files.map((f) => f.name)],
    ["drizzle", drizzle.files.map((f) => f.name)],
  ]);

  const seen = new Set<string>();
  for (const k of known) {
    const key = offenderKey(k);
    if (seen.has(key)) registryDefects.push(`Zdublowany wpis rejestru: ${key}.`);
    seen.add(key);
    if (!offenderKeys.has(key)) {
      registryDefects.push(
        `Martwy wpis rejestru: ${key} nie jest już naruszeniem - usuń go (rejestr może tylko maleć).`,
      );
      continue;
    }
    const files = filesOf.get(k.lane) ?? [];
    const order = (f: string) => files.indexOf(f);
    if (!files.includes(k.closedBy)) {
      registryDefects.push(`${key}: plik domykający ${k.closedBy} nie istnieje w pasie ${k.lane}.`);
    } else if (order(k.closedBy) <= order(k.file)) {
      registryDefects.push(
        `${key}: plik domykający ${k.closedBy} nie jest późniejszy niż naruszenie.`,
      );
    } else if (!closing.get(`${k.lane}:${k.closedBy}`)?.has(k.view)) {
      registryDefects.push(
        `${key}: ${k.closedBy} nie zamyka ${k.view} (REVOKE ALL ... FROM anon, authenticated ani security_invoker = on).`,
      );
    }
  }

  return {
    filesScanned: supabase.files.length + drizzle.files.length,
    viewStatements: a.viewStatements + b.viewStatements,
    offenders,
    fresh,
    registryDefects,
    parseDefects: [...a.parseDefects, ...b.parseDefects],
    closingFiles: closing,
  };
}

/**
 * Wpisy rejestru dla bieżących naruszeń z NAJWCZEŚNIEJSZYM późniejszym plikiem
 * domykającym w tym samym pasie (`closedBy: null`, gdy żaden ich nie domyka -
 * takie naruszenie trzeba naprawić migracją, a nie wpisem).
 */
export function suggestKnownOffenders(
  report: DefinerViewReport,
  lanes: readonly LaneFiles[],
): (Omit<KnownDefinerViewOffender, "closedBy"> & { readonly closedBy: string | null })[] {
  return report.offenders.map((o) => {
    const files = lanes.find((l) => l.lane === o.lane)?.files.map((f) => f.name) ?? [];
    const from = files.indexOf(o.file);
    const closedBy =
      files.find(
        (f, i) => i > from && report.closingFiles.get(`${o.lane}:${f}`)?.has(o.view) === true,
      ) ?? null;
    return { lane: o.lane, file: o.file, view: o.view, closedBy };
  });
}

export function definerViewsFailed(report: DefinerViewReport): boolean {
  return (
    report.fresh.length > 0 || report.registryDefects.length > 0 || report.parseDefects.length > 0
  );
}

export function renderDefinerViewReport(report: DefinerViewReport): string {
  if (!definerViewsFailed(report)) {
    return `✓ Widoki DEFINER tylko do odczytu dla klientów (${report.filesScanned} plików w obu pasach, ${report.viewStatements} instrukcji widoków, ${report.offenders.length} znanych domkniętych naruszeń).`;
  }
  const lines: string[] = [];
  if (report.fresh.length > 0) {
    lines.push("✗ Widok w public zostaje zapisywalny dla ról klienckich obok RLS:");
    for (const o of report.fresh) {
      const dir = o.lane === "supabase" ? "supabase/migrations" : "drizzle/migrations";
      lines.push(`  ${dir}/${o.file}:${o.line}  ${o.view}`, `    ${o.reason}`);
    }
    lines.push(
      "  Naprawa: w TYM SAMYM pliku, jako instrukcje najwyższego poziomu (nie w bloku DO):",
      "    REVOKE ALL ON <widok> FROM anon, authenticated;",
      "    GRANT SELECT ON <widok> TO anon, authenticated;",
      "  albo `WITH (security_invoker = on)` (dla INSTEAD OF trigger to nie wystarcza).",
      "  Wzór: supabase/migrations/20261012210000_public_definer_views_read_only.sql.",
    );
  }
  if (report.parseDefects.length > 0) {
    lines.push("✗ Instrukcje, których bramka nie umie odczytać (fail closed):");
    for (const d of report.parseDefects) lines.push(`  ${d}`);
  }
  if (report.registryDefects.length > 0) {
    lines.push("✗ Wady rejestru znanych naruszeń:");
    for (const d of report.registryDefects) lines.push(`  ${d}`);
  }
  return lines.join("\n");
}

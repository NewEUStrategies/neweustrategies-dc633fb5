// Bramka: widok DEFINER w schemacie public jest dla ról klienckich TYLKO DO
// ODCZYTU - w OBU pasach migracji (supabase/ i drizzle/).
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
// w drizzle/ (0148, 0150) i Lovable wgrywa ją na produkcję, zanim CI cokolwiek
// uruchomi - widok DEFINER zapisywalny dla anon byłby dla pgTAP niewidzialny.
// Ta bramka czyta pliki obu pasów i zapala się na następnym PR-ze albo pushu do
// main, który taki plik niesie.
//
// REGUŁA (na plik, zachowawczo):
//   * Każde zdarzenie, które czyni widok public DEFINEREM - `CREATE [OR REPLACE]
//     VIEW` bez `security_invoker = on`, `ALTER VIEW ... SET (security_invoker =
//     off)` albo `RESET (security_invoker)` - musi w TYM SAMYM pliku dostać
//     `REVOKE ALL ON <widok> FROM anon, authenticated` (albo przełączenie na
//     `security_invoker = on`). `CREATE OR REPLACE` także: zachowuje ACL, ale
//     PODMIENIA opcje - bez `WITH (security_invoker = on)` robi z widoku
//     INVOKER-a DEFINERA (tak zdryfował content_access_public w 20260721120000),
//     a jeśli widoku nie było, dostaje świeże domyślne `arwdDxtm`.
//   * Wymagany jest REVOKE ALL (albo jawna lista wszystkich praw poza SELECT),
//     nie samo INSERT/UPDATE/DELETE - test pgTAP dopuszcza dla klientów
//     wyłącznie SELECT, więc bramka statyczna nie może przepuścić mniej.
//   * Żaden GRANT praw innych niż SELECT dla anon/authenticated/PUBLIC na widok,
//     który w tym miejscu historii jest DEFINEREM - także w innym pliku niż jego
//     CREATE i także z pasa drizzle na widok z pasa supabase.
//
// CZEGO NIE WIDZI, powiedziane wprost: SQL-a dynamicznego (`DO $$ ... EXECUTE
// ... $$`, ciała funkcji) - lekser maskuje ciała cytowane dolarami. W żadnym
// pasie nie ma dziś widoku tworzonego dynamicznie (sprawdzone 2026-10-12).
//
// Historyczne naruszenia, domknięte późniejszą migracją, stoją w rejestrze
// znanych przypadków (`KnownDefinerViewOffender`) z WSKAZANIEM pliku, który je
// domyka. Bramka sprawdza ten wskaźnik: plik musi istnieć w tym samym pasie,
// być późniejszy i rzeczywiście zdejmować prawa klientów albo przełączać widok
// na INVOKER. Wpis, który przestał być naruszeniem, czerwieni bramkę - rejestr
// może tylko maleć.
import { lexStatements, objectName } from "./migrationSplit";

export type MigrationLane = "supabase" | "drizzle";

export interface LaneFiles {
  readonly lane: MigrationLane;
  /** Pliki w kolejności zastosowania (sortowane po nazwie). */
  readonly files: readonly { readonly name: string; readonly sql: string }[];
}

/** Role, którym widok DEFINER wolno dać wyłącznie SELECT. */
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
  /** Linia instrukcji, po której widok został z prawami zapisu dla klientów. */
  readonly line: number;
  readonly reason: string;
}

export interface KnownDefinerViewOffender {
  readonly lane: MigrationLane;
  readonly file: string;
  readonly view: string;
  /** Późniejszy plik tego samego pasa, który zdejmuje klientom prawa zapisu albo przełącza widok na INVOKER. */
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
  /**
   * Pliki, które zdejmują klientom prawa zapisu do widoku albo przełączają go na
   * INVOKER (`pas:plik` -> widoki). Do walidacji `closedBy` i do `--print-baseline`.
   */
  readonly closingFiles: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * ZAMKNIĘTE NARUSZENIA HISTORYCZNE. Każdy wpis to plik, po którym widok DEFINER
 * zostawał zapisywalny dla klientów, oraz PÓŹNIEJSZY plik tego samego pasa,
 * który to domyka (REVOKE ALL ... FROM anon, authenticated albo
 * security_invoker = on) - bramka sprawdza oba fakty. Ostatnie domknięcia to
 * 20261012200000 (author_profiles_public) i 20261012210000 (pozostałe widoki
 * oraz content_access_public), zmierzone wcześniej na produkcji jako otwarte.
 *
 * Lista może TYLKO MALEĆ: nowe naruszenie naprawia się migracją, nie wpisem.
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

const QNAME = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*))?`;

const RE_CREATE_VIEW = new RegExp(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?((?:(?:TEMP|TEMPORARY|RECURSIVE|MATERIALIZED)\s+)*)VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})([\s\S]*?)\s+AS\s`,
  "i",
);
const RE_ALTER_VIEW_OPTS = new RegExp(
  String.raw`^ALTER\s+(VIEW|TABLE)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})\s+(SET|RESET)\s*\(([^)]*)\)`,
  "i",
);
const RE_DROP_VIEW =
  /^DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?([\s\S]+?)(?:\s+(?:CASCADE|RESTRICT))?\s*;?$/i;
const RE_GRANT =
  /^GRANT\s+([\s\S]+?)\s+ON\s+([\s\S]+?)\s+TO\s+([\s\S]+?)(?:\s+WITH\s+GRANT\s+OPTION)?(?:\s+GRANTED\s+BY\s+[\s\S]+?)?\s*;?$/i;
const RE_REVOKE =
  /^REVOKE\s+(GRANT\s+OPTION\s+FOR\s+)?([\s\S]+?)\s+ON\s+([\s\S]+?)\s+FROM\s+([\s\S]+?)(?:\s+GRANTED\s+BY\s+[\s\S]+?)?(?:\s+(?:CASCADE|RESTRICT))?\s*;?$/i;
const RE_ALL_IN_SCHEMA = /^ALL\s+TABLES\s+IN\s+SCHEMA\s+([\s\S]+)$/i;

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
 * Wartość `security_invoker` z listy opcji. Szkielet maskuje literały (`''`),
 * więc dla wartości w apostrofach sięgamy do surowego tekstu instrukcji.
 * Brak opcji = `false` (DEFINER, domyślne zachowanie PostgreSQL). Nieczytelna
 * wartość też liczy się jako DEFINER - bramka myli się w bezpieczną stronę.
 */
function securityInvoker(options: string, rawText: string): boolean {
  const m = /\bsecurity_invoker\b\s*(?:=\s*('[^']*'|[^,\s)]+))?/i.exec(options);
  if (!m) return false;
  if (m[1] === undefined) return true; // `WITH (security_invoker)` = true
  if (m[1] === "''") {
    const raw = /\bsecurity_invoker\b\s*=\s*'([^']*)'/i.exec(rawText);
    return raw ? pgBool(raw[1]!) === true : false;
  }
  return pgBool(m[1]) === true;
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

/** Nazwy obiektów z listy celów GRANT/REVOKE/DROP (`[TABLE] a, b`). */
function targetNames(list: string): string[] {
  const body = list.replace(/^TABLE\s+/i, "");
  return splitTopLevel(body).map((item) => objectName(item));
}

/** Role z listy odbiorców; `PUBLIC` i `"anon"` znormalizowane do małych liter bez cudzysłowów. */
function roleNames(list: string): string[] {
  return splitTopLevel(list).map((r) =>
    r.startsWith('"') ? r.slice(1, -1).replace(/""/g, '"') : r.toLowerCase(),
  );
}

interface PrivilegeSet {
  /** Prawa w postaci WIELKICH liter; `ALL` rozwinięte do pełnej listy. */
  readonly table: ReadonlySet<string>;
  /** Prawa kolumnowe (`UPDATE (a, b)`) - liczą się jako zapis, ale nie jako pełne zdjęcie. */
  readonly column: ReadonlySet<string>;
}

function privileges(list: string): PrivilegeSet {
  const table = new Set<string>();
  const column = new Set<string>();
  for (const item of splitTopLevel(list)) {
    const m = /^([A-Za-z]+)(?:\s+PRIVILEGES)?\s*(\(.*\))?$/i.exec(item);
    if (!m) continue;
    const name = m[1]!.toUpperCase();
    const target = m[2] ? column : table;
    if (name === "ALL") {
      target.add("SELECT");
      for (const p of NON_SELECT_PRIVILEGES) target.add(p);
    } else target.add(name);
  }
  return { table, column };
}

const grantsWrite = (p: PrivilegeSet): boolean =>
  [...p.table, ...p.column].some((x) => x !== "SELECT");

const revokesAllWrite = (p: PrivilegeSet): boolean =>
  NON_SELECT_PRIVILEGES.every((x) => p.table.has(x));

/** Stan widoku w historii pasa: tryb bezpieczeństwa i czy klient ma prawo zapisu. */
interface ViewState {
  definer: boolean;
  write: Record<ClientRole, boolean>;
  /** Plik i linia zdarzenia, które ostatnio otworzyło zapis (do raportu). */
  openedAt: { file: string; line: number; reason: string } | null;
}

const isPublic = (name: string): boolean => name.startsWith("public.");

/**
 * Widoki, których dotyczy lista celów GRANT/REVOKE: jawne nazwy albo - dla
 * `ALL TABLES IN SCHEMA s` - wszystkie znane widoki tego schematu.
 */
function viewTargets(list: string, state: ReadonlyMap<string, ViewState>): string[] {
  const schema = RE_ALL_IN_SCHEMA.exec(list.trim());
  if (!schema) return targetNames(list);
  const names = splitTopLevel(schema[1]!).map((s) => objectName(`${s}.x`).split(".")[0]!);
  return [...state.keys()].filter((v) => names.includes(v.split(".")[0]!));
}

/**
 * Przechodzi jeden pas w kolejności plików. `seed` to stan końcowy innego pasa
 * (drizzle startuje ze stanem supabase - tak wygląda produkcja, na której oba
 * pasy lądują w jednej bazie).
 */
function scanLane(
  lane: LaneFiles,
  seed: ReadonlyMap<string, ViewState>,
  closingEvents: Map<string, Set<string>>,
): {
  offenders: DefinerViewOffender[];
  state: Map<string, ViewState>;
  viewStatements: number;
} {
  const state = new Map<string, ViewState>(
    [...seed].map(([k, v]) => [k, { ...v, write: { ...v.write } }]),
  );
  const offenders: DefinerViewOffender[] = [];
  let viewStatements = 0;

  for (const file of lane.files) {
    const touched = new Set<string>();
    const open = (view: string, line: number, reason: string, roles: readonly ClientRole[]) => {
      const s = state.get(view)!;
      for (const r of roles) s.write[r] = true;
      s.openedAt = { file: file.name, line, reason };
      touched.add(view);
    };
    const close = (view: string) => {
      const key = `${lane.lane}:${file.name}`;
      if (!closingEvents.has(key)) closingEvents.set(key, new Set());
      closingEvents.get(key)!.add(view);
    };

    for (const seg of lexStatements(file.sql)) {
      if (seg.codeStart === -1) continue;
      const sk = seg.skeleton;
      let m: RegExpExecArray | null;

      if ((m = RE_CREATE_VIEW.exec(sk))) {
        const modifiers = m[1]!.toUpperCase();
        if (/MATERIALIZED|TEMP/.test(modifiers)) continue; // brak zapisu przez widok / obiekt sesji
        const view = objectName(m[2]!);
        if (!isPublic(view)) continue;
        viewStatements += 1;
        const withOpts = /\bWITH\s*\(([\s\S]*?)\)\s*$/i.exec(m[3]!.trim());
        const invoker = securityInvoker(withOpts?.[1] ?? "", seg.text);
        const prev = state.get(view);
        // Nowa relacja (CREATE, albo OR REPLACE widoku, którego historia pasa nie zna)
        // dostaje domyślne arwdDxtm. OR REPLACE znanego widoku zachowuje jego ACL,
        // ale PODMIENIA opcje - bez security_invoker = on widok staje się DEFINEREM.
        const isNew = !/^CREATE\s+OR\s+REPLACE/i.test(sk) || prev === undefined;
        const s: ViewState = {
          definer: !invoker,
          write: isNew ? { anon: true, authenticated: true, public: false } : { ...prev.write },
          openedAt: null,
        };
        state.set(view, s);
        touched.add(view);
        if (invoker) close(view);
        else
          s.openedAt = {
            file: file.name,
            line: seg.line,
            reason: isNew
              ? "nowy widok DEFINER (domyślne uprawnienia public dają klientom arwdDxtm)"
              : "CREATE OR REPLACE bez security_invoker = on (opcje podmienione - widok jest DEFINEREM)",
          };
        continue;
      }

      if ((m = RE_ALTER_VIEW_OPTS.exec(sk))) {
        const view = objectName(m[2]!);
        const s = state.get(view);
        if (!s || !/\bsecurity_invoker\b/i.test(m[4]!)) continue;
        const invoker = m[3]!.toUpperCase() === "SET" && securityInvoker(m[4]!, seg.text);
        s.definer = !invoker;
        touched.add(view);
        if (invoker) close(view);
        else if (s.write.anon || s.write.authenticated || s.write.public)
          s.openedAt = {
            file: file.name,
            line: seg.line,
            reason: "ALTER VIEW przełącza widok z prawami zapisu klientów na DEFINER",
          };
        continue;
      }

      if ((m = RE_DROP_VIEW.exec(sk))) {
        for (const view of targetNames(m[1]!)) {
          state.delete(view);
          touched.delete(view);
        }
        continue;
      }

      if ((m = RE_REVOKE.exec(sk))) {
        if (m[1]) continue; // GRANT OPTION FOR zdejmuje tylko prawo dalszego nadawania
        const privs = privileges(m[2]!);
        if (!revokesAllWrite(privs)) continue;
        const roles = roleNames(m[4]!).filter((r): r is ClientRole =>
          (CLIENT_ROLES as readonly string[]).includes(r),
        );
        for (const view of viewTargets(m[3]!, state)) {
          const s = state.get(view);
          if (!s) continue;
          for (const r of roles) s.write[r] = false;
          if (!s.write.anon && !s.write.authenticated && !s.write.public) close(view);
        }
        continue;
      }

      if ((m = RE_GRANT.exec(sk))) {
        const privs = privileges(m[1]!);
        if (!grantsWrite(privs)) continue;
        const roles = roleNames(m[3]!).filter((r): r is ClientRole =>
          (CLIENT_ROLES as readonly string[]).includes(r),
        );
        if (roles.length === 0) continue;
        for (const view of viewTargets(m[2]!, state)) {
          if (!state.has(view)) continue;
          open(view, seg.line, `GRANT praw innych niż SELECT dla ${roles.join(", ")}`, roles);
        }
      }
    }

    for (const view of touched) {
      const s = state.get(view);
      if (!s || !s.definer) continue;
      const roles = CLIENT_ROLES.filter((r) => s.write[r]);
      if (roles.length === 0) continue;
      offenders.push({
        lane: lane.lane,
        file: file.name,
        view,
        line: s.openedAt?.file === file.name ? s.openedAt.line : 1,
        reason: `${s.openedAt?.file === file.name ? s.openedAt.reason : "widok DEFINER"}; po pliku zapis zostaje dla: ${roles.join(", ")}`,
      });
    }
  }
  return { offenders, state, viewStatements };
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
  const a = scanLane(supabase, new Map(), closing);
  const b = scanLane(drizzle, a.state, closing);
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
    if (!files.includes(k.closedBy)) {
      registryDefects.push(`${key}: plik domykający ${k.closedBy} nie istnieje w pasie ${k.lane}.`);
    } else if (k.closedBy <= k.file) {
      registryDefects.push(
        `${key}: plik domykający ${k.closedBy} nie jest późniejszy niż naruszenie.`,
      );
    } else if (!closing.get(`${k.lane}:${k.closedBy}`)?.has(k.view)) {
      registryDefects.push(
        `${key}: ${k.closedBy} nie zdejmuje klientom praw do ${k.view} (REVOKE ALL ... FROM anon, authenticated) ani nie przełącza go na security_invoker = on.`,
      );
    }
  }

  return {
    filesScanned: supabase.files.length + drizzle.files.length,
    viewStatements: a.viewStatements + b.viewStatements,
    offenders,
    fresh,
    registryDefects,
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
    const closedBy =
      files.find(
        (f) => f > o.file && report.closingFiles.get(`${o.lane}:${f}`)?.has(o.view) === true,
      ) ?? null;
    return { lane: o.lane, file: o.file, view: o.view, closedBy };
  });
}

export function definerViewsFailed(report: DefinerViewReport): boolean {
  return report.fresh.length > 0 || report.registryDefects.length > 0;
}

export function renderDefinerViewReport(report: DefinerViewReport): string {
  const lines: string[] = [];
  if (!definerViewsFailed(report)) {
    lines.push(
      `✓ Widoki DEFINER tylko do odczytu dla klientów (${report.filesScanned} plików w obu pasach, ${report.viewStatements} instrukcji widoków, ${report.offenders.length} znanych domkniętych naruszeń).`,
    );
    return lines.join("\n");
  }
  if (report.fresh.length > 0) {
    lines.push("✗ Widok DEFINER w public zostaje zapisywalny dla ról klienckich:");
    for (const o of report.fresh) {
      lines.push(
        `  ${o.lane === "supabase" ? "supabase/migrations" : "drizzle/migrations"}/${o.file}:${o.line}  ${o.view}`,
      );
      lines.push(`    ${o.reason}`);
    }
    lines.push(
      "  Naprawa: w tym samym pliku `REVOKE ALL ON <widok> FROM anon, authenticated;` i `GRANT SELECT ON <widok> TO anon, authenticated;`",
      "  albo `WITH (security_invoker = on)`. Zob. supabase/migrations/20261012210000_public_definer_views_read_only.sql.",
    );
  }
  if (report.registryDefects.length > 0) {
    lines.push("✗ Wady rejestru znanych naruszeń:");
    for (const d of report.registryDefects) lines.push(`  ${d}`);
  }
  return lines.join("\n");
}

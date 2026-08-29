// KODY ODMÓW WYCZYTANE Z MIGRACJI - źródło prawdy dla bramek pięciu map błędów.
//
// PO CO TEN PLIK ISTNIEJE. Klucz komunikatu podróżuje z bazy do interfejsu
// GŁOWĄ tekstu wyjątku (`RAISE EXCEPTION 'quota_below_sold: 12 seats …'`).
// Nic w repozytorium tego nie spina: SQL stoi w `supabase/migrations`, słownik
// w nakładce i18n, a między nimi jest wyłącznie NAZWA. Nowy `RAISE EXCEPTION`
// w migracji przechodzi `tsc`, przechodzi lint i przechodzi parytet PL/EN
// (klucza nie ma w ŻADNYM języku, więc parytet go nie widzi). Widać go dopiero
// na ekranie - zdaniem awaryjnym, z którego organizator nie dowie się, co
// poprawić.
//
// LISTA WPISANA RĘCZNIE STARZEJE SIĘ PO CICHU, dlatego ten plik jej NIE
// zawiera: kody są WYLICZANE z drzewa migracji przy każdym przebiegu. Nowa
// migracja z nowym kodem od razu zaczerwieni bramkę modułu, którego dotyczy.
//
// SKĄD WIADOMO, KTÓRE KODY NALEŻĄ DO KTÓREJ MAPY. Z warstwy klienta: bierzemy
// moduły `src/lib/events/*Api.ts`, których ekrany używają danej mapy, czytamy
// z nich nazwy z `supabase.rpc("…")` i schodzimy do ciał tych funkcji w SQL-u.
// Funkcja, której żaden klient nie woła, nie ma prawa czerwienić mapy.
//
// DOMKNIĘCIE PO WYWOŁANIACH JEST KONIECZNE. Większość odmów nie pada w ciele
// funkcji RPC, tylko w pomocniczej: `assert_event_admin_tenant()` podnosi
// `forbidden` przed ciałem każdej funkcji panelu, a odprawę zapisuje
// `_event_checkin_write()`. Bez zejścia w wywołania bramka nie zobaczyłaby ani
// strażnika tenanta, ani połowy kodów odprawy.
//
// OSTATNIA DEFINICJA WYGRYWA - dokładnie tak, jak przy `supabase db push`.
// Funkcje modułu bywają przepisywane kilka razy (plik opisowy, potem migracja
// panelu z UUID-em w nazwie) i obowiązuje ta późniejsza.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const API_DIR = join(process.cwd(), "src", "lib", "events");

/** Ciało funkcji w stanie po odtworzeniu całego łańcucha migracji. */
function readFunctionBodies(): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    for (const match of sql.matchAll(head)) {
      // Ciało jest w cudzysłowie dolarowym, a tag bywa różny: `$$`, `$fn$`,
      // `$function$`. Szukamy PIERWSZEGO otwarcia po nagłówku (dalej stoi lista
      // argumentów i `RETURNS`, więc okno jest z zapasem) i jego domknięcia.
      const window = sql.slice(match.index, match.index + 4000);
      const open = /\$([a-z0-9_]*)\$/i.exec(window);
      if (open === null) continue;
      const tag = open[0];
      const start = match.index + open.index + tag.length;
      const end = sql.indexOf(tag, start);
      if (end === -1) continue;
      out.set(match[1], sql.slice(start, end));
    }
  }
  return out;
}

const BODIES = readFunctionBodies();

/** Kody podnoszone WPROST w ciele danej funkcji (bez schodzenia w wywołania). */
function ownCodes(body: string): Set<string> {
  const out = new Set<string>();
  // `RAISE EXCEPTION 'kod: ogon …'` oraz `RAISE EXCEPTION 'kod'` (bez ogona).
  // Komunikat bywa w następnej linii niż słowo kluczowe, stąd `\s` zamiast spacji.
  for (const match of body.matchAll(/raise\s+exception\s+'([a-z][a-z0-9_]*)\s*(?=:|')/gi)) {
    out.add(match[1]);
  }
  return out;
}

/** Funkcje z migracji wywoływane w ciele danej funkcji. */
function calleesOf(name: string, body: string): Set<string> {
  const out = new Set<string>();
  // Nazwa pomocnicza często zaczyna się podkreśleniem (`_event_checkin_write`),
  // więc identyfikator MUSI je dopuszczać - inaczej z bramki odprawy wypada
  // komplet kodów zapisu wejścia.
  for (const match of body.matchAll(/(?:^|[^a-z0-9_.])(?:public\.)?([a-z_][a-z0-9_]{3,})\s*\(/gi)) {
    const candidate = match[1].toLowerCase();
    if (candidate !== name && BODIES.has(candidate)) out.add(candidate);
  }
  return out;
}

const OWN_CODES = new Map<string, Set<string>>();
const CALLEES = new Map<string, Set<string>>();
for (const [name, body] of BODIES) {
  OWN_CODES.set(name, ownCodes(body));
  CALLEES.set(name, calleesOf(name, body));
}

/** Kody funkcji wraz z kodami wszystkiego, co ta funkcja woła (domknięcie). */
function reachableCodes(entry: string): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const code of OWN_CODES.get(current) ?? []) found.add(code);
    for (const callee of CALLEES.get(current) ?? []) stack.push(callee);
  }
  return found;
}

export interface RaiseCodeScan {
  /** Nazwy funkcji RPC, które woła warstwa kliencka danej mapy. */
  functions: readonly string[];
  /** Nazwy z `rpc("…")`, dla których w migracjach NIE MA definicji. */
  missingFunctions: readonly string[];
  /** Kody z `RAISE EXCEPTION`, posortowane i bez powtórzeń. */
  codes: readonly string[];
}

/**
 * Kody odmów osiągalne z modułów `src/lib/events/<nazwa>.ts` podanych po nazwie
 * (bez rozszerzenia). `missingFunctions` jest częścią wyniku po to, żeby
 * literówka w nazwie RPC albo funkcja skasowana z bazy nie udawała „modułu bez
 * odmów" - pusta lista kodów wygląda przecież jak sukces.
 */
export function scanRaiseCodes(apiModules: readonly string[]): RaiseCodeScan {
  const functions = new Set<string>();
  for (const moduleName of apiModules) {
    const source = readFileSync(join(API_DIR, `${moduleName}.ts`), "utf8");
    for (const match of source.matchAll(/\brpc\(\s*"([a-z0-9_]+)"/g)) functions.add(match[1]);
  }
  const codes = new Set<string>();
  const missingFunctions: string[] = [];
  for (const fn of functions) {
    if (!BODIES.has(fn)) missingFunctions.push(fn);
    for (const code of reachableCodes(fn)) codes.add(code);
  }
  return {
    functions: [...functions].sort(),
    missingFunctions: missingFunctions.sort(),
    codes: [...codes].sort(),
  };
}

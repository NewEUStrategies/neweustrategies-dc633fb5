// Inwariant CI: SZOSTY ARGUMENT emit_domain_event TO AKTOR (uuid), NIGDY FLAGA.
//
// PRZYCZYNA ZRODLOWA (2026-08-08). Migracja A12 dolozyla drugie przeciazenie
// emitera z booleanem na szostej pozycji. Migracja A16 zlikwidowala
// przeciazenie - poprawnie - ale zostawila boolean na szostym miejscu, bo
// autor sprawdzil wywolania w JEDNYM pliku i uznal, ze nikt nie podaje aktora
// pozycyjnie. Faktyczny rozklad: 25 wywolan z uuid, 4 z booleanem.
//
// Skutek byl niewidoczny dla kompilatora i dla `supabase db push`: cialo
// plpgsql rozwiazuje nazwy funkcji przy WYWOLANIU, a wszystkie emitery lapia
// wlasny wyjatek (fan-out nie ma wywracac transakcji biznesowej). Awaria
// wygladala wiec jak cisza - zdarzenia po prostu przestawaly powstawac.
//
// Bramka patrzy na STAN KONCOWY historii migracji, nie na kazdy plik z osobna
// - tak samo, jak check-sql-rpc-contract i check-sql-migration-replay. Migracje
// sa jednokierunkowe: A12 zostaje na dysku z bledna forma wywolania na zawsze,
// a liczy sie to, ze A17 odtwarza te same funkcje poprawnie. Bramka, ktora
// czytalaby historie, kazalaby edytowac wdrozone migracje - czyli dokladnie to,
// czego reszta bramek zabrania.
//
// W stanie koncowym: dla kazdej funkcji bierzemy JEJ OSTATNIA definicje
// i sprawdzamy wywolania w jej ciele. Tlumienie aktora wolamy wylacznie
// argumentem nazwanym `p_suppress_actor => ...`, ktory bramka przepuszcza.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Wyrazenia, ktore w tym repozytorium oznaczaja wartosc logiczna. */
const BOOLEAN_SHAPE =
  /^(true|false|not\s|.*\bhide_actor\b|.*\bsuppress\w*\b|.*\bis_[a-z_]+\b\s*$)/i;

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly sixth: string;
}

/**
 * Dzieli argumenty wywolania na poziomie pierwszym. Komentarz `--` jest
 * przepisywany doslownie do konca linii - przecinek w komentarzu nie jest
 * separatorem, co w tym repozytorium zdarza sie w kazdym wiekszym emiterze.
 */
export function splitCallArgs(sql: string, openParen: number): string[] | null {
  let depth = 0;
  let inString = false;
  let current = "";
  const out: string[] = [];
  for (let i = openParen; i < sql.length; i += 1) {
    if (!inString && sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) return null;
      current += sql.slice(i, nl + 1);
      i = nl;
      continue;
    }
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    if (!inString) {
      if (ch === "(") {
        depth += 1;
        if (depth === 1) continue;
      } else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          out.push(current);
          return out;
        }
      } else if (ch === "," && depth === 1) {
        out.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  return null;
}

interface FinalFunction {
  readonly name: string;
  readonly file: string;
  /** Numer linii poczatku definicji w swoim pliku - do czytelnego raportu. */
  readonly line: number;
  readonly body: string;
}

/**
 * Ostatnia definicja KAZDEJ funkcji w historii migracji. Pliki sortujemy po
 * nazwie, bo nazwa niesie znacznik czasu i to jest porzadek, w jakim Supabase
 * odtwarza baze od zera.
 */
export function finalFunctionBodies(
  files: readonly { readonly name: string; readonly sql: string }[],
): FinalFunction[] {
  const latest = new Map<string, FinalFunction>();
  for (const { name, sql } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const defs = sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)/gi);
    for (const def of defs) {
      const start = def.index ?? 0;
      // Ciało konczy sie na znaczniku dollar-quote domykajacym definicje.
      const open = sql.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/);
      if (open === null) continue;
      const bodyStart = start + (open.index ?? 0) + open[0].length;
      const close = sql.indexOf(open[1], bodyStart);
      if (close === -1) continue;
      latest.set(def[1].toLowerCase(), {
        name: def[1],
        file: name,
        line: sql.slice(0, start).split("\n").length,
        body: sql.slice(bodyStart, close),
      });
    }
  }
  return [...latest.values()];
}

/** Wywolania, ktorych szosty argument POZYCYJNY wyglada na flage. */
export function findActorPositionOffences(
  files: readonly { readonly name: string; readonly sql: string }[],
): Offence[] {
  const out: Offence[] = [];
  for (const fn of finalFunctionBodies(files)) {
    const calls = fn.body.matchAll(/public\.emit_domain_event\s*\(/g);
    for (const call of calls) {
      const open = (call.index ?? 0) + call[0].length - 1;
      const args = splitCallArgs(fn.body, open);
      if (args === null || args.length < 6) continue;
      const sixth = args[5].replace(/--[^\n]*\n/g, " ").trim();
      // Argument nazwany jest zawsze w porzadku - o to wlasnie chodzi.
      if (sixth.includes("=>")) continue;
      if (!BOOLEAN_SHAPE.test(sixth)) continue;
      out.push({
        file: `${fn.file} (public.${fn.name})`,
        line: fn.line + fn.body.slice(0, call.index ?? 0).split("\n").length,
        sixth: sixth.slice(0, 60),
      });
    }
  }
  return out;
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));

const offences = findActorPositionOffences(files);

if (offences.length > 0) {
  console.error("✗ emit_domain_event: flaga na SZOSTEJ pozycji argumentu.\n");
  console.error("  Szosta pozycja nalezy do p_actor_id (uuid) - tak wola 25 miejsc");
  console.error("  w billingu, monetyzacji i odznakach. Tlumienie aktora wolaj");
  console.error("  argumentem NAZWANYM: p_suppress_actor => <wyrazenie>.\n");
  for (const o of offences) {
    console.error(`    ${o.file}:${o.line}  6. argument: ${o.sixth}`);
  }
  process.exit(1);
}

console.log(
  `✓ emit_domain_event: szosty argument jest aktorem w kazdym wywolaniu stanu ` +
    `koncowego (${files.length} plikow migracji, ` +
    `${finalFunctionBodies(files).length} funkcji).`,
);

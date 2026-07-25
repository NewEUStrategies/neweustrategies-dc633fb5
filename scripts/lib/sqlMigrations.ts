/**
 * Wspolna analiza statyczna forward-only migracji SQL dla bramek CI.
 *
 * Migracje sa forward-only, wiec o stanie bazy decyduje OSTATNIA definicja
 * kazdej funkcji (po sortowaniu plikow migracji) - nie kazde historyczne
 * `CREATE OR REPLACE`. Kazda bramka, ktora bada ciala funkcji, musi patrzec na
 * ten sam "stan koncowy", inaczej albo zglasza nieaktualne naruszenia (juz
 * naprawione w nowszej migracji), albo przepuszcza regresje.
 *
 * Uzywane przez:
 *   - scripts/check-sql-tenant-scope.ts      (izolacja tenanta w SECURITY DEFINER)
 *   - scripts/check-sql-app-role-literals.ts (literaly enuma app_role)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIR = "supabase/migrations";

export interface FnDef {
  /** `schema.nazwa/liczba_parametrow` - klucz stanu koncowego. */
  readonly key: string;
  readonly name: string;
  readonly arity: number;
  readonly file: string;
  /** Cialo miedzy tagami dollar-quote. */
  readonly body: string;
  /** Atrybuty (LANGUAGE, SECURITY DEFINER, ...) - preambula + postambula, bez ciala. */
  readonly attrs: string;
}

/**
 * Usuwa komentarze SQL (`-- do konca linii` i bloki `/* ... *\/`), zachowujac
 * podzial na linie, zeby numery linii w raportach nadal wskazywaly zrodlo.
 * Bez tego bramka trafia we WLASNY naglowek dokumentacyjny migracji, ktora
 * cytuje naprawiany wzorzec.
 */
export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inSingle = false;
  let inDouble = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      if (ch === "\n") out += ch;
      i += 1;
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    out += ch;
    i += 1;
  }
  return out;
}

/** Dzieli liste parametrow po przecinkach najwyzszego poziomu. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/**
 * Najnowsza definicja kazdej funkcji (klucz: nazwa + liczba parametrow).
 *
 * Komentarze sa usuwane PRZED parsowaniem: bramki szukaja w cialach wzorcow
 * ryzyka, a migracje naprawcze cytuja te wzorce w notatkach (`-- FIX: byl
 * public_tenant_id()`). Bez tego bramka raportuje wlasne notatki naprawcze jako
 * naruszenia (4 falszywe trafienia w 20260724100000).
 */
export function extractLatestDefinitions(): Map<string, FnDef> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const createRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_."]+)\s*\(/gi;
  const latest = new Map<string, FnDef>();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    createRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(sql)) !== null) {
      const name = match[1].replace(/"/g, "").toLowerCase();
      const sigStart = match.index;

      // Domknij liste parametrow (zbalansowane nawiasy).
      let i = match.index + match[0].length - 1;
      let depth = 0;
      for (; i < sql.length; i += 1) {
        if (sql[i] === "(") depth += 1;
        else if (sql[i] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const argList = sql.slice(match.index + match[0].length, i);
      const arity = argList.trim() === "" ? 0 : splitTopLevel(argList).length;

      // Pierwszy tag dollar-quote po liscie parametrow otwiera cialo.
      const rest = sql.slice(i);
      const dq = /\$([A-Za-z0-9_]*)\$/.exec(rest);
      if (dq === null) continue;
      const tag = dq[0];
      const bodyOpen = i + dq.index + tag.length;
      const bodyClose = sql.indexOf(tag, bodyOpen);
      if (bodyClose < 0) continue;
      const body = sql.slice(bodyOpen, bodyClose);

      // Atrybuty (LANGUAGE, SECURITY DEFINER, ...) sa poza cialem: preambula +
      // postambula az do konca instrukcji - liczymy je bez tresci ciala, zeby
      // slowo w komentarzu ciala nie zaklamalo detekcji SECURITY DEFINER.
      const preamble = sql.slice(sigStart, i + dq.index);
      const afterBody = sql.slice(bodyClose + tag.length);
      const semi = afterBody.indexOf(";");
      const postamble = semi < 0 ? afterBody : afterBody.slice(0, semi);
      const attrs = `${preamble} ${postamble}`;

      const key = `${name}/${arity}`;
      latest.set(key, { key, name, arity, file, body, attrs });
    }
  }
  return latest;
}

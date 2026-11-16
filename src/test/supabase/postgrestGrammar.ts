// Wzorcowy interpreter filtrów PostgREST dla testów - port fragmentu gramatyki
// i semantyki, a NIE kolejna atrapa, która „wierzy" kodowi produkcyjnemu.
//
// PO CO. Filtr `.or("kol.ilike.\"...\"")` składamy ręcznie, a postgrest-js
// niczego w nim nie escapuje. Test, który porównuje napis z napisem, sprawdza
// tylko, że kod robi to, co robi. Ten moduł odczytuje filtr TAK JAK SERWER:
// parser jest przepisany 1:1 z PostgREST (src/library/PostgREST/ApiRequest/
// QueryParams.hs - identyczny w v12.2.3, v14.18 i main@b7b3336), zamiana `*`
// na `%` z SqlFragment.hs (`star c = if c == '*' then '%' else c`), a LIKE
// z dokumentacji PostgreSQL (`_`, `%`, ucieczka `\`). Atrapa bazy oparta na
// nim zwraca wiersz wtedy i tylko wtedy, gdy zwróciłby go PostgREST - więc
// zgubione escapowanie `_` daje w teście fałszywe trafienie, jak w produkcji.
//
// Semantykę LIKE potwierdzono osobno na lokalnym PostgreSQL 16 (te same
// wzorce co w testach); port parsera obejmuje to, czego używa kod: drzewo
// `or(...)` z liśćmi `kol.[not.]op.wartość`, operatory `in`, `eq`, `like`,
// `ilike`. Wszystko inne RZUCA - cichy brak obsługi udawałby zgodność.
import type { RecordedChain } from "./chain";

/** Liść drzewa logicznego po stronie serwera (wartość już bez cytowania). */
export type DecodedFilter =
  | {
      readonly column: string;
      readonly negated: boolean;
      readonly op: "in";
      readonly values: string[];
    }
  | {
      readonly column: string;
      readonly negated: boolean;
      readonly op: "eq" | "like" | "ilike";
      readonly value: string;
    };

class Cursor {
  pos = 0;
  constructor(readonly text: string) {}
  peek(): string | undefined {
    return this.text[this.pos];
  }
  fail(what: string): never {
    throw new Error(`postgrest: ${what} na pozycji ${this.pos} w ${JSON.stringify(this.text)}`);
  }
  expect(ch: string): void {
    if (this.text[this.pos] !== ch) this.fail(`oczekiwano ${JSON.stringify(ch)}`);
    this.pos += 1;
  }
  startsWith(s: string): boolean {
    return this.text.startsWith(s, this.pos);
  }
}

/**
 * `pQuotedValue = char '"' *> many (noneOf "\\\"" <|> (char '\\' *> anyChar)) <* char '"'`
 * Zwraca null (bez przesunięcia - Parsec `try`), gdy wartość nie jest cytowana.
 */
function quotedValue(c: Cursor): string | null {
  if (c.peek() !== '"') return null;
  const start = c.pos;
  c.pos += 1;
  let out = "";
  for (;;) {
    const ch = c.peek();
    if (ch === undefined) {
      c.pos = start;
      return null;
    }
    if (ch === '"') {
      c.pos += 1;
      return out;
    }
    if (ch === "\\") {
      const next = c.text[c.pos + 1];
      if (next === undefined) {
        c.pos = start;
        return null;
      }
      out += next;
      c.pos += 2;
      continue;
    }
    out += ch;
    c.pos += 1;
  }
}

/** `try (pQuotedValue <* notFollowedBy (noneOf ",)")) <|> many (noneOf ",)")` */
function element(c: Cursor): string {
  const start = c.pos;
  const quoted = quotedValue(c);
  if (quoted !== null) {
    const next = c.peek();
    if (next === undefined || next === "," || next === ")") return quoted;
    c.pos = start;
  }
  let out = "";
  while (c.peek() !== undefined && c.peek() !== "," && c.peek() !== ")") {
    out += c.peek();
    c.pos += 1;
  }
  return out;
}

/** `pFieldName = pQuotedValue <|> sepByDash pIdentifier`; identyfikator: `letter|digit|"_ $"`. */
function fieldName(c: Cursor): string {
  const quoted = quotedValue(c);
  if (quoted !== null) return quoted;
  let out = "";
  while (/[\p{L}\p{N}_ $]/u.test(c.peek() ?? "")) {
    out += c.peek();
    c.pos += 1;
  }
  if (out.trim() === "") c.fail("oczekiwano nazwy kolumny");
  return out.trim();
}

const QUANT_OPS = ["eq", "gte", "gt", "lte", "lt", "like", "ilike", "match", "imatch"] as const;

function leaf(c: Cursor): DecodedFilter {
  const column = fieldName(c);
  c.expect(".");
  let negated = false;
  if (c.startsWith("not.")) {
    negated = true;
    c.pos += 4;
  }
  if (c.startsWith("in.")) {
    c.pos += 3;
    c.expect("(");
    const values = [element(c)];
    while (c.peek() === ",") {
      c.pos += 1;
      values.push(element(c));
    }
    c.expect(")");
    return { column, negated, op: "in", values };
  }
  // Kolejność prób jak w `quantOperator` (gte przed gt, like przed ilike).
  const op = QUANT_OPS.find((o) => c.startsWith(`${o}.`));
  if (op === undefined) c.fail("nieobsługiwany operator");
  if (op !== "eq" && op !== "like" && op !== "ilike") c.fail(`operator ${op} poza portem`);
  c.pos += op.length + 1;
  // `pLogicSingleVal` = cytowana wartość albo wszystko do `,`/`)` (tablica pg poza portem).
  if (c.peek() === "{") c.fail("tablica pg poza portem");
  return { column, negated, op, value: element(c) };
}

/**
 * Parametr `or` w postaci, w jakiej wysyła go postgrest-js: `(${filters})`.
 * PostgREST parsuje `"or" <> wartość` gramatyką `pLogicTree`.
 *
 * Port jest tu CELOWO surowszy niż serwer: `P.parse` w PostgREST nie wymaga
 * `eof`, więc nadmiarowe znaki po drzewie są po cichu ignorowane. Dla testu
 * każdy taki ogon znaczy, że budowa filtra poszła nie tak - rzucamy.
 */
export function decodeOrParam(param: string): DecodedFilter[] {
  const c = new Cursor(param);
  c.expect("(");
  const out = [leaf(c)];
  while (c.peek() === ",") {
    c.pos += 1;
    out.push(leaf(c));
  }
  c.expect(")");
  if (c.pos !== param.length) c.fail("nadmiarowe znaki po drzewie logicznym");
  return out;
}

/** Parametr `in.(...)` dokładnie tak, jak składa go postgrest-js `.in()` (2.x). */
export function postgrestJsInParam(values: readonly unknown[]): string {
  const cleaned = Array.from(new Set(values))
    .map((s) => (typeof s === "string" && /[,()]/.test(s) ? `"${s}"` : `${s}`))
    .join(",");
  return `in.(${cleaned})`;
}

/**
 * Lista wartości operatora `in` po stronie serwera (`pListVal`). Jak
 * w PostgREST (`pRequestFilter` bez `eof`): reszta parametru za listą jest
 * IGNOROWANA - dlatego niecytowany `"` w wartości potrafi uciąć listę.
 */
export function decodeInParam(param: string): string[] {
  const c = new Cursor(param);
  if (!c.startsWith("in.(")) c.fail("oczekiwano in.(");
  c.pos += 3;
  c.expect("(");
  const values = [element(c)];
  while (c.peek() === ",") {
    c.pos += 1;
    values.push(element(c));
  }
  c.expect(")");
  return values;
}

/**
 * LIKE/ILIKE PostgreSQL: `_` dowolny znak, `%` dowolny ciąg, `\` ucieczka
 * (domyślna). Wzorzec kończący się `\` to błąd - jak w PostgreSQL.
 */
export function likeMatches(text: string, pattern: string, caseInsensitive: boolean): boolean {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) throw new Error("LIKE pattern must not end with escape character");
      source += next.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i += 1;
    } else if (ch === "%") source += "[\\s\\S]*";
    else if (ch === "_") source += "[\\s\\S]";
    else source += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, caseInsensitive ? "iu" : "u").test(text);
}

/** Wynik liścia dla wiersza - z zamianą `*` -> `%` we wzorcach (SqlFragment.hs). */
export function filterMatches(
  filter: DecodedFilter,
  row: Readonly<Record<string, unknown>>,
): boolean {
  const cell = row[filter.column];
  // NULL w SQL: ani `kol op x`, ani `NOT (kol op x)` nie przepuszcza wiersza.
  if (cell === null || cell === undefined) return false;
  const text = String(cell);
  let hit: boolean;
  if (filter.op === "in") hit = filter.values.includes(text);
  else if (filter.op === "eq") hit = text === filter.value;
  else hit = likeMatches(text, filter.value.replace(/\*/g, "%"), filter.op === "ilike");
  return filter.negated ? !hit : hit;
}

/**
 * Atrapa tabeli, która wykonuje ZAPISANY łańcuch tak, jak PostgREST:
 * `eq`, `in` (z cytowaniem postgrest-js), `or` (drzewo logiczne), `not(kol,
 * "is", null)`, `order`, rzutowanie `select`. Ogniwo spoza listy RZUCA.
 */
export function runRecordedChain(
  chain: RecordedChain,
  table: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Array<Record<string, unknown>> {
  let rows = [...table];
  let columns: string[] | null = null;
  for (const { method, args } of chain.calls) {
    if (method === "select") {
      columns = String(args[0])
        .split(",")
        .map((s) => s.trim());
    } else if (method === "eq") {
      const [column, value] = args as [string, unknown];
      rows = rows.filter((r) => r[column] !== null && String(r[column]) === String(value));
    } else if (method === "in") {
      const [column, values] = args as [string, unknown[]];
      const allowed = decodeInParam(postgrestJsInParam(values));
      rows = rows.filter((r) => r[column] !== null && allowed.includes(String(r[column])));
    } else if (method === "or") {
      const filters = decodeOrParam(`(${String(args[0])})`);
      rows = rows.filter((r) => filters.some((f) => filterMatches(f, r)));
    } else if (method === "not") {
      const [column, operator, value] = args as [string, string, unknown];
      if (operator !== "is" || value !== null)
        throw new Error(`atrapa: not(${operator}) poza portem`);
      rows = rows.filter((r) => r[column] !== null && r[column] !== undefined);
    } else if (method === "order") {
      const [column, options] = args as [string, { ascending: boolean }];
      const dir = options.ascending ? 1 : -1;
      // Porządek bajtowy (jak `uuid`/`text COLLATE "C"`), nie zależny od locale.
      rows.sort((a, b) => {
        const x = String(a[column]);
        const y = String(b[column]);
        return dir * (x < y ? -1 : x > y ? 1 : 0);
      });
    } else if (method === "returns") {
      // tylko typ
    } else {
      throw new Error(`atrapa: ogniwo ${method} poza portem`);
    }
  }
  if (columns === null) throw new Error("atrapa: łańcuch bez select");
  const picked = columns;
  return rows.map((r) => Object.fromEntries(picked.map((col) => [col, r[col] ?? null])));
}

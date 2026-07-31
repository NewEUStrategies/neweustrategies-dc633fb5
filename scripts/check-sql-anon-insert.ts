/**
 * Gate inwariantu: ZADNA tabela nie przyjmuje permisywnego anonimowego INSERT-u,
 * a tabele intake (telemetria / zgloszenia) nie przyjmuja BEZPOSREDNIEGO INSERT-u
 * od klienta w ogole (zapis idzie przez funkcje serwerowa / RPC SECURITY DEFINER).
 *
 * PRZYCZYNA ZRODLOWA (audyt bezpieczenstwa 2026-07-30): przez ~30 dni cztery
 * tabele przyjmowaly INSERT wprost przez PostgREST, bo polityka wpuszczajaca
 * anon/authenticated przetrwala churn migracji (guard is_experiment_running()
 * zgubiony w 20260702114108->20260703052115). Skutki: spam do skrzynki admina
 * (contact_messages), FABRYKACJA ZGOD RODO na dowolny e-mail (crm_consent_log),
 * falszowanie statystyk (related_post_clicks) i wynikow A/B
 * (builder_experiment_events). Zamkniete recznie migracjami 20260730130000 /
 * 20260730140000 - ale to JEDNA klasa bledu, ktora wroci bez bramki.
 *
 * INWARIANTY (stan koncowy polityk - migracje forward-only, CREATE/DROP POLICY
 * liczone po kolei):
 *   A. HARD, wszystkie tabele: zadna polityka INSERT-capable (FOR INSERT/FOR ALL)
 *      z rola `anon`/`public` nie moze miec PERMISYWNEGO checku INSERT-u (WITH
 *      CHECK sprowadzajacy sie do `true`, albo jego brak). Polityki z realnym
 *      warunkiem (np. `auth.role() = 'service_role'`, `has_role(...)`) i polityki
 *      DENY (`false`) sa poprawne - anon ich nie spelni.
 *   B. Tabele PROTECTED_INTAKE: zadna polityka INSERT-capable z rola klienta
 *      (anon/public/authenticated), ktora nie jest czystym DENY. Te tabele
 *      przyjmuja zapis WYLACZNIE przez service_role (omija RLS, nie potrzebuje
 *      polityki) - kazda inna sciezka to wektor fabrykacji danych.
 *
 * Zakres: bramka patrzy na POLITYKI (zaklada RLS wlaczony wszedzie - audyt
 * 198/198). Nie modeluje GRANT-ow: permisywna polityka bez GRANT-u nie jest
 * eksploatowalna, ale i tak jest smellem, wiec ja raportujemy.
 *
 * Usage: bun run scripts/check-sql-anon-insert.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR, stripSqlComments } from "./lib/sqlMigrations";

/** Legalne permisywne polityki anon-insert (klucz `tabela::nazwa` -> uzasadnienie). */
const ANON_INSERT_ALLOWLIST: Readonly<Record<string, string>> = {};

/** Tabele intake: zapis WYLACZNIE przez funkcje serwerowa (service_role). */
const PROTECTED_INTAKE_TABLES: ReadonlySet<string> = new Set([
  "contact_messages",
  "crm_consent_log",
  "related_post_clicks",
  "builder_experiment_events",
  "analytics_events",
  "web_vitals",
]);

interface PolicyState {
  readonly table: string;
  readonly name: string;
  readonly file: string;
  readonly insertCapable: boolean;
  readonly roles: ReadonlySet<string>;
  /** Efektywny check INSERT-u: 'permissive' (true/brak), 'deny' (false), 'restricted' (warunek). */
  readonly insertCheck: "permissive" | "deny" | "restricted";
}

function normTable(raw: string): string {
  return raw
    .replace(/"/g, "")
    .replace(/^[a-z0-9_]+\./i, "")
    .toLowerCase();
}
function normName(raw: string): string {
  return raw.replace(/"/g, "").trim().toLowerCase();
}

/** Od `fromIdx` czyta do `;` na poziomie 0 nawiasow, poza literalem '...'. */
function readStatementTail(sql: string, fromIdx: number): string {
  let depth = 0;
  let inSingle = false;
  for (let i = fromIdx; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === ";" && depth === 0) return sql.slice(fromIdx, i);
  }
  return sql.slice(fromIdx);
}

/** Wyrazenie w nawiasach po slowie kluczowym (np. WITH CHECK / USING), zbalansowane. */
function parenExprAfter(tail: string, kw: RegExp): string | null {
  const m = kw.exec(tail);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < tail.length && tail[i] !== "(") i += 1;
  if (i >= tail.length) return null;
  let depth = 0;
  const start = i;
  for (; i < tail.length; i += 1) {
    if (tail[i] === "(") depth += 1;
    else if (tail[i] === ")") {
      depth -= 1;
      if (depth === 0) return tail.slice(start + 1, i).trim();
    }
  }
  return null;
}

function normExpr(expr: string | null): "true" | "false" | "other" | "none" {
  if (expr === null) return "none";
  const n = expr.replace(/\s+/g, "").toLowerCase();
  if (n === "true") return "true";
  if (n === "false") return "false";
  return "other";
}

function parseRoles(tail: string): Set<string> {
  // Klauzula TO jest przed USING/WITH CHECK; wytnijmy ja do pierwszego z nich.
  const head = tail.split(/\bUSING\b|\bWITH\s+CHECK\b/i)[0];
  const m = /\bTO\s+([A-Za-z0-9_,"\s]+)/i.exec(head);
  if (!m) return new Set(["public"]);
  return new Set(
    m[1]
      .split(",")
      .map((r) => r.replace(/"/g, "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function isInsertCapable(tail: string): boolean {
  const head = tail.split(/\bUSING\b|\bWITH\s+CHECK\b/i)[0];
  const m = /\bFOR\s+(ALL|INSERT|SELECT|UPDATE|DELETE)\b/i.exec(head);
  if (!m) return true; // brak FOR = FOR ALL
  const op = m[1].toUpperCase();
  return op === "ALL" || op === "INSERT";
}

/** Efektywny check INSERT: WITH CHECK, wpp. USING (FOR ALL), wpp. brak = permisywny. */
function insertCheckKind(tail: string): "permissive" | "deny" | "restricted" {
  const withCheck = normExpr(parenExprAfter(tail, /\bWITH\s+CHECK\b/i));
  if (withCheck === "true") return "permissive";
  if (withCheck === "false") return "deny";
  if (withCheck === "other") return "restricted";
  // Brak WITH CHECK -> dla FOR ALL check INSERT-u dziedziczy z USING.
  const using = normExpr(parenExprAfter(tail, /\bUSING\b/i));
  if (using === "true") return "permissive";
  if (using === "false") return "deny";
  if (using === "other") return "restricted";
  return "permissive"; // ani WITH CHECK, ani USING -> nic nie ogranicza
}

interface PolicyEvent {
  readonly kind: "create" | "drop";
  readonly index: number;
  readonly table: string;
  readonly name: string;
  readonly state?: PolicyState;
}

const CREATE_HEAD = /CREATE\s+POLICY\s+("[^"]+"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)/gi;
const DROP_RE =
  /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)/gi;

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const policies = new Map<string, PolicyState>();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    const events: PolicyEvent[] = [];

    CREATE_HEAD.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_HEAD.exec(sql)) !== null) {
      const table = normTable(m[2]);
      const name = normName(m[1]);
      const tail = readStatementTail(sql, m.index + m[0].length);
      events.push({
        kind: "create",
        index: m.index,
        table,
        name,
        state: {
          table,
          name,
          file,
          insertCapable: isInsertCapable(tail),
          roles: parseRoles(tail),
          insertCheck: insertCheckKind(tail),
        },
      });
    }
    DROP_RE.lastIndex = 0;
    while ((m = DROP_RE.exec(sql)) !== null) {
      events.push({ kind: "drop", index: m.index, table: normTable(m[2]), name: normName(m[1]) });
    }

    events.sort((a, b) => a.index - b.index);
    for (const ev of events) {
      const key = `${ev.table}::${ev.name}`;
      if (ev.kind === "drop") policies.delete(key);
      else if (ev.state) policies.set(key, ev.state);
    }
  }

  const anonViolations: PolicyState[] = [];
  const intakeViolations: PolicyState[] = [];
  const allowlistHit = new Set<string>();

  for (const p of policies.values()) {
    if (!p.insertCapable) continue;
    const key = `${p.table}::${p.name}`;
    const hasAnon = p.roles.has("anon") || p.roles.has("public");
    const hasClient = hasAnon || p.roles.has("authenticated");

    // A: permisywny anon-insert (rola anon/public + check == true/brak).
    if (hasAnon && p.insertCheck === "permissive") {
      if (ANON_INSERT_ALLOWLIST[key] !== undefined) allowlistHit.add(key);
      else anonViolations.push(p);
    }

    // B: tabela intake z jakąkolwiek nie-DENY polityką INSERT dla roli klienta.
    if (PROTECTED_INTAKE_TABLES.has(p.table) && hasClient && p.insertCheck !== "deny") {
      intakeViolations.push(p);
    }
  }

  let failed = false;

  if (anonViolations.length > 0) {
    failed = true;
    console.error(`\n✗ Permisywny anonimowy INSERT w ${anonViolations.length} polityce/ach:\n`);
    for (const v of anonViolations.sort((a, b) => a.table.localeCompare(b.table))) {
      console.error(`  • ${v.table} :: "${v.name}"  (${v.file}), role: ${[...v.roles].join(", ")}`);
    }
    console.error(
      "\n  Naprawa: zapis anonimowy prowadz przez funkcje serwerowa / RPC SECURITY" +
        "\n  DEFINER (jak newsletter/kontakt), albo dodaj realny WITH CHECK. Uzasadniony" +
        "\n  wyjatek -> ANON_INSERT_ALLOWLIST.",
    );
  }

  if (intakeViolations.length > 0) {
    failed = true;
    console.error(
      `\n✗ Tabela intake przyjmuje INSERT klienta w ${intakeViolations.length} polityce/ach:\n`,
    );
    for (const v of intakeViolations.sort((a, b) => a.table.localeCompare(b.table))) {
      console.error(`  • ${v.table} :: "${v.name}"  (${v.file}), role: ${[...v.roles].join(", ")}`);
    }
    console.error(
      "\n  Te tabele przyjmuja zapis WYLACZNIE przez service_role. Usun polityke" +
        "\n  INSERT dla anon/authenticated (albo ustaw ja na DENY).",
    );
  }

  const staleAllowlist = Object.keys(ANON_INSERT_ALLOWLIST).filter((k) => !allowlistHit.has(k));
  if (staleAllowlist.length > 0) {
    console.warn(`\n⚠ Nieaktualne wpisy ANON_INSERT_ALLOWLIST: ${staleAllowlist.join(", ")}`);
  }

  if (failed) process.exit(1);

  console.log(
    `✓ Inwariant anon-insert OK (${policies.size} polityk w stanie koncowym, ` +
      `${PROTECTED_INTAKE_TABLES.size} tabel intake chronionych).`,
  );
}

main();

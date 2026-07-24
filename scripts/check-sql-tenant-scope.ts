/**
 * Gate inwariantu izolacji tenantow w funkcjach SECURITY DEFINER.
 *
 * PRZYCZYNA ZRODLOWA (powtarzalna, patrz migracja 20260724091000): funkcja
 * SECURITY DEFINER omija RLS. Jesli SKALUJE DANE po public_tenant_id() (tenant z
 * naglowka x-tenant-host, ustawianego przez klienta w
 * src/integrations/supabase/tenant-host-fetch.ts - do PODROBIENIA przez curl albo
 * supabase.rpc(), brak trusted-proxy), a AUTORYZUJE po has_role()/is_staff()
 * (rola w tenancie DOMOWYM = current_tenant_id()), to admin/edytor tenanta A moze
 * podrobic naglowek na domene tenanta B, przejsc bramke roli i odczytac/zapisac
 * dane tenanta B. Tak wyciekal przychod w monetization_dashboard.
 *
 * INWARIANT: cialo funkcji SECURITY DEFINER NIE moze laczyc public_tenant_id()
 * (lub request_public_host()) z has_role()/is_staff(), POZA jawnie uzasadnionymi
 * sciezkami publicznymi (PUBLIC_PATH_ALLOWLIST), gdzie public_tenant_id() jest
 * poprawny dla plaszczyzny tresci, a obejscie stafowe jest ZWIAZANE z
 * current_tenant_id() (dlatego kazdy wpis allowlisty MUSI nadal zawierac
 * current_tenant_id() w ciele - regresja mitygacji failuje gate).
 *
 * Analizuje NAJNOWSZA definicje kazdej funkcji (ostatni CREATE [OR REPLACE]
 * FUNCTION po sortowaniu plikow migracji), bo migracje sa forward-only.
 *
 * Usage: bun run scripts/check-sql-tenant-scope.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface FnDef {
  readonly key: string;
  readonly name: string;
  readonly arity: number;
  readonly file: string;
  readonly body: string;
  readonly attrs: string;
}

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Sciezki publiczne/czlonkowskie, gdzie public_tenant_id() jest POPRAWNY dla
 * plaszczyzny tresci (ranga warstwy liczona current_membership_tier() per
 * przegladany host), a obejscie stafowe (has_role) jest zwiazane z tenantem
 * wiersza (= current_tenant_id()). Wartosc to uzasadnienie widoczne w logu.
 * Kazdy wpis MUSI nadal zawierac current_tenant_id() w ciele.
 */
const PUBLIC_PATH_ALLOWLIST: Readonly<Record<string, string>> = {
  "public.authorize_resource_download/1":
    "biblioteka czlonkowska; obejscie stafowe zwiazane z v_res.tenant_id = current_tenant_id()",
  "public.get_event_access/1":
    "dostep do wydarzenia; obejscie stafowe zwiazane z v_event.tenant_id = current_tenant_id()",
  "public.get_poll_results/1":
    "wyniki ankiety spolecznosci; podglad stafowy zwiazany z v_poll.tenant_id = current_tenant_id()",
};

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

/** Najnowsza definicja kazdej funkcji (klucz: nazwa + liczba parametrow). */
function extractLatestDefinitions(): Map<string, FnDef> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const createRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_."]+)\s*\(/gi;
  const latest = new Map<string, FnDef>();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
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

function main(): void {
  const latest = extractLatestDefinitions();

  const violations: FnDef[] = [];
  const allowlistedRegressed: string[] = [];
  const allowlistHit = new Set<string>();

  for (const def of latest.values()) {
    const isSecurityDefiner = /SECURITY\s+DEFINER/i.test(def.attrs);
    const usesHeaderTenant = /\b(?:public_tenant_id|request_public_host)\s*\(/i.test(def.body);
    const usesRoleCheck = /\b(?:has_role|is_staff)\s*\(/i.test(def.body);
    if (!isSecurityDefiner || !usesHeaderTenant || !usesRoleCheck) continue;

    const justification = PUBLIC_PATH_ALLOWLIST[def.key];
    if (justification !== undefined) {
      allowlistHit.add(def.key);
      // Sciezka publiczna jest dozwolona TYLKO gdy obejscie stafowe jest zwiazane
      // z tenantem domowym (current_tenant_id()). Brak = regresja mitygacji.
      if (!/\bcurrent_tenant_id\s*\(/i.test(def.body)) {
        allowlistedRegressed.push(def.key);
      }
      continue;
    }
    violations.push(def);
  }

  // Stale wpisy allowlisty (funkcja juz nie laczy naglowka z rola) - sygnal do
  // sprzatania, nie blad krytyczny.
  const staleAllowlist = Object.keys(PUBLIC_PATH_ALLOWLIST).filter((k) => !allowlistHit.has(k));

  let failed = false;

  if (violations.length > 0) {
    failed = true;
    console.error(
      `\n✗ Inwariant tenant-scope zlamany w ${violations.length} funkcji SECURITY DEFINER:\n`,
    );
    for (const v of violations.sort((a, b) => a.name.localeCompare(b.name))) {
      console.error(`  • ${v.key}`);
      console.error(`      plik: ${v.file}`);
      console.error(
        "      cialo laczy public_tenant_id()/request_public_host() z has_role()/is_staff().",
      );
    }
    console.error(
      "\n  Naprawa: dla operacji uprzywilejowanych skaluj dane po current_tenant_id()" +
        "\n  (tenant domowy), nie po naglowku. Sciezki publiczne dodaj do" +
        "\n  PUBLIC_PATH_ALLOWLIST z obejsciem stafowym zwiazanym z current_tenant_id().",
    );
  }

  if (allowlistedRegressed.length > 0) {
    failed = true;
    console.error(
      `\n✗ Regresja mitygacji na sciezce publicznej (brak current_tenant_id() w ciele):\n`,
    );
    for (const k of allowlistedRegressed) console.error(`  • ${k}`);
    console.error(
      "\n  Obejscie stafowe musi byc ZWIAZANE z current_tenant_id(), inaczej wraca" +
        "\n  wyciek miedzy tenantami. Przywroc wiazanie albo usun funkcje z allowlisty.",
    );
  }

  if (staleAllowlist.length > 0) {
    console.warn(
      `\n⚠ Nieaktualne wpisy PUBLIC_PATH_ALLOWLIST (do usuniecia): ${staleAllowlist.join(", ")}`,
    );
  }

  if (failed) {
    process.exit(1);
  }

  const allowed = Object.keys(PUBLIC_PATH_ALLOWLIST).length - staleAllowlist.length;
  console.log(
    `✓ Inwariant tenant-scope OK (${latest.size} funkcji zbadanych, ` +
      `${allowed} uzasadnionych sciezek publicznych).`,
  );
}

main();

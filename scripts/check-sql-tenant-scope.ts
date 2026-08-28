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
import { extractLatestDefinitions, type FnDef } from "./lib/sqlMigrations";

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
  // Ta sama plaszczyzna co `get_event_access` i CELOWO to samo obejscie: migracja
  // `20260828203000` odwzorowuje bramke wydarzenia na poziomie SESJI, bo wczesniej
  // `event_session_access` sprawdzalo wylacznie wlasna range sesji i niezalogowany
  // czytal nagrania wydarzenia dla czlonkow. Zanim ta funkcja siegnela po
  // `has_role`, nie dotykala tego inwariantu wcale - wpis powstaje razem
  // z odwzorowaniem, nie zamiast niego.
  "public.event_session_access/1":
    "dostep do transmisji i nagrania sesji; obejscie stafowe zwiazane z v_event.tenant_id = current_tenant_id()",
  "public.get_poll_results/1":
    "wyniki ankiety spolecznosci; podglad stafowy zwiazany z v_poll.tenant_id = current_tenant_id()",
  "public.club_capabilities/3":
    "klub publiczny czytany anonimowo po hoscie; podglad cudzych uprawnien zwiazany z v_club.tenant_id = current_tenant_id()",
};

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

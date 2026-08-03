/**
 * Generator snapshotu bramek autoryzacji dla macierzy uprawnien (/admin/permissions).
 *
 * PO CO: macierz byla recznie wpisana tabelka - zmiana bramki w bazie nie dawala
 * ZADNEGO sygnalu, wiec strona rozjezdzala sie z rzeczywistoscia w ciszy. Teraz
 * dane macierzy pochodza z tego snapshotu, a snapshot ze SQL-a.
 *
 * Zapisuje src/lib/authz/authzSnapshot.generated.ts:
 *   - `appRoles`     - wartosci enuma public.app_role,
 *   - `roleGates`    - bramki dokumentowane przez macierz (permissionRows.ts)
 *                      wraz ze zbiorem rol, ktore je przechodza,
 *   - `featureGates` - KOMPLETNA mapa flag `membership_tiers.features` realnie
 *                      czytanych przez bramki (stad pole `enforced` w rejestrze
 *                      capabilities jest weryfikowalne).
 *
 * Usage:
 *   bun run generate:authz-snapshot          # zapis
 *   bun run generate:authz-snapshot --check  # tylko weryfikacja (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  deriveAuthzSnapshot,
  renderAuthzSnapshotModule,
  selectAuthzSnapshot,
} from "../src/lib/ci/authzGates";
import { DOCUMENTED_ROLE_GATE_REFS } from "../src/lib/authz/permissionRows";
import { readAuthzSource } from "./lib/authzSource";

const OUTPUT = "src/lib/authz/authzSnapshot.generated.ts";

function main(): void {
  const checkOnly = process.argv.includes("--check");

  const snapshot = deriveAuthzSnapshot(readAuthzSource());
  const selected = selectAuthzSnapshot(snapshot, { roleGateRefs: DOCUMENTED_ROLE_GATE_REFS });

  if (selected.appRoles.length === 0) {
    console.error("✗ Nie udalo sie odtworzyc wartosci enuma app_role z migracji.");
    process.exit(1);
  }
  if (selected.danglingRefs.length > 0) {
    console.error(
      `✗ Macierz uprawnien wskazuje bramki, ktorych nie ma w migracjach:\n` +
        selected.danglingRefs.map((ref) => `    • ${ref}`).join("\n") +
        "\n  Popraw `gateRef` w src/lib/authz/permissionRows.ts albo usun wiersz.",
    );
    process.exit(1);
  }

  const rendered = renderAuthzSnapshotModule(selected);
  const current = (() => {
    try {
      return readFileSync(OUTPUT, "utf8");
    } catch {
      return null;
    }
  })();

  if (checkOnly) {
    if (current !== rendered) {
      console.error(
        `✗ ${OUTPUT} jest nieaktualny wobec supabase/migrations.\n` +
          "  Uruchom `bun run generate:authz-snapshot` i zacommituj wynik.",
      );
      process.exit(1);
    }
    console.log(`✓ ${OUTPUT} zgodny z migracjami.`);
    return;
  }

  if (current === rendered) {
    console.log(`✓ ${OUTPUT} bez zmian.`);
  } else {
    writeFileSync(OUTPUT, rendered);
    console.log(`✓ Zapisano ${OUTPUT}.`);
  }

  console.log(
    `  role: ${selected.appRoles.join(" | ")}\n` +
      `  bramki rolowe: ${selected.roleGates.length} (z ${snapshot.roleGates.length} znalezionych)\n` +
      `  bramki flag warstw: ${selected.featureGates.length} dla ${
        new Set(selected.featureGates.map((gate) => gate.capability)).size
      } flag\n` +
      `  skan: ${selected.stats.migrations} migracji, ${selected.stats.functions} funkcji, ${selected.stats.policies} polityk`,
  );
}

main();

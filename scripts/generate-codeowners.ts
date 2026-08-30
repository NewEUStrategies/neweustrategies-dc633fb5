/**
 * Generator `.github/CODEOWNERS` z rejestru własnicielstwa.
 *
 * Wzorzec jak `scripts/generate-authz-snapshot.ts`: ten sam skrypt PISZE plik
 * i - z flagą `--check` - porównuje go bajt w bajt z tym, co jest w repo.
 * Dzięki temu CODEOWNERS nie może cicho rozjechać się z `governance/ownership.json`:
 * dopisanie trasy do domeny bez przegenerowania pliku przewraca bramkę.
 *
 * Usage:
 *   bun run generate:codeowners   # zapisuje .github/CODEOWNERS
 *   bun run check:codeowners      # tylko weryfikacja (CI)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseRegistry, renderCodeowners } from "../src/lib/ci/ownership";

const REGISTRY_PATH = "governance/ownership.json";
const OUTPUT_PATH = ".github/CODEOWNERS";

function main(): void {
  const registry = parseRegistry(JSON.parse(readFileSync(REGISTRY_PATH, "utf8")));
  const expected = renderCodeowners(registry);
  const checkOnly = process.argv.includes("--check");

  if (!checkOnly) {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, expected);
    console.log(`✓ [codeowners] zapisano ${OUTPUT_PATH} z ${registry.domeny.length} domen.`);
    return;
  }

  let actual: string;
  try {
    actual = readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    console.error(
      [
        `✗ [codeowners] brak pliku ${OUTPUT_PATH}.`,
        "  Lekarstwo: bun run generate:codeowners",
      ].join("\n"),
    );
    process.exit(1);
    return;
  }

  if (actual !== expected) {
    const actualLines = actual.split("\n");
    const expectedLines = expected.split("\n");
    const firstDiff = expectedLines.findIndex((line, index) => actualLines[index] !== line);
    console.error(
      [
        `✗ [codeowners] ${OUTPUT_PATH} rozjechał się z ${REGISTRY_PATH}.`,
        `  Pierwsza różnica w linii ${firstDiff + 1}:`,
        `    w repo:      ${JSON.stringify(actualLines[firstDiff] ?? "<brak linii>")}`,
        `    z rejestru:  ${JSON.stringify(expectedLines[firstDiff] ?? "<brak linii>")}`,
        "  Lekarstwo: bun run generate:codeowners",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `✓ [codeowners] ${OUTPUT_PATH} zgodny z rejestrem (${registry.domeny.length} domen).`,
  );
}

main();

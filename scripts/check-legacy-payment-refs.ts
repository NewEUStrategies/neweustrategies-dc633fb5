/**
 * Bramka inwariantu: PO MIGRACJI NA STRIPE NIE ZOSTAJE ŻADNA ŻYWA REFERENCJA
 * DO POPRZEDNIEGO OPERATORA PŁATNOŚCI.
 *
 * Cienki runner - cała logika (zasięg skanu, składnie komentarzy, granica
 * zamrożonych migracji, uzasadnienie) żyje w `src/lib/ci/legacyPaymentRefs.ts`,
 * dokładnie jak `check-sql-migration-replay.ts` trzyma swoją w
 * `src/lib/ci/migrationReplay.ts`. Dzięki temu inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/legacyPaymentRefs.test.ts`), a nie tylko przebieg w CI.
 *
 * Poprzednik (`check-no-paddle.ts`) skanował wyłącznie `src/` i `scripts/`,
 * więc martwy sekret `PADDLE_SANDBOX_API_KEY` w `.github/workflows/` był poza
 * jego zasięgiem przez cały czas życia tamtej bramki.
 *
 * Usage: bun run scripts/check-legacy-payment-refs.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  SCAN_FILES,
  SCAN_ROOTS,
  SKIP_DIRS,
  type ScannedFile,
  isScannable,
  renderLegacyPaymentRefsReport,
  scanLegacyPaymentRefs,
} from "../src/lib/ci/legacyPaymentRefs";

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collect(): ScannedFile[] {
  const paths = [
    ...SCAN_ROOTS.filter((root) => existsSync(root)).flatMap((root) => walk(root, [])),
    ...SCAN_FILES.filter((file) => existsSync(file)),
  ];

  return paths
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter(isScannable)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function main(): void {
  const files = collect();
  const hits = scanLegacyPaymentRefs(files);
  const report = renderLegacyPaymentRefsReport(hits, files.length);

  if (hits.length > 0) {
    console.error(report);
    process.exit(1);
  }
  console.log(report);
}

main();

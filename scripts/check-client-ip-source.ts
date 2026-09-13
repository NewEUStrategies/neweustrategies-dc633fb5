/**
 * Bramka inwariantu: „KTO DZWONI" MA DOKŁADNIE JEDNĄ DEFINICJĘ.
 *
 * Nazwa nagłówka `x-forwarded-for` może wystąpić w kodzie wykonywanym tylko
 * w `src/lib/http/rateLimit.ts`; reszta repozytorium woła stamtąd
 * `clientIpFromHeaders` / `rateLimitIpSubject`. Powód: klient dopisuje do tej
 * listy własny prefiks, więc pierwszy wpis jest jego DEKLARACJĄ, a kubełek po
 * nim kluczowany rotuje się jednym nagłówkiem.
 *
 * Cienki runner - inwariant, zasięg, allowlista i uzasadnienie żyją w
 * `src/lib/ci/clientIpSource.ts` (konwencja jak `check-dangerous-html.ts`),
 * dzięki czemu bramka ma test jednostkowy
 * (`src/lib/ci/__tests__/clientIpSource.test.ts`), a nie tylko przebieg w CI.
 *
 * Usage: bun run check:client-ip-source
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CLIENT_IP_ALLOWLIST,
  SCAN_ROOT,
  SKIP_DIRS,
  clientIpSourceFailed,
  isScannable,
  renderClientIpSourceReport,
  scanClientIpSource,
  type ScannedSource,
} from "../src/lib/ci/clientIpSource";

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collect(): ScannedSource[] {
  if (!existsSync(SCAN_ROOT)) return [];
  return walk(SCAN_ROOT, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter(isScannable)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function main(): void {
  const report = scanClientIpSource(collect(), CLIENT_IP_ALLOWLIST);
  const rendered = renderClientIpSourceReport(report);

  if (clientIpSourceFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();

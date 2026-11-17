// Granica bundla przeglądarki dla modułów server-only ładowanych z kodu
// osiągalnego w grafie klienta. Bramka `import.meta.env.SSR` przed surowym
// `import()` nie wystarcza (bundler podglądu rozwiązuje specyfikator przed
// eliminacją martwego kodu i import-protection odrzuca cały bundle klienta),
// więc te moduły sięgają po server-only WYŁĄCZNIE przez `createServerOnlyFn`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** Moduły w grafie klienta (wejście Start i klient przeglądarkowy bazy). */
const CLIENT_REACHABLE = [
  "src/start.ts",
  "src/lib/http/requestHost.ts",
  "src/lib/http/documentCache.server.ts",
  "src/integrations/supabase/tenant-host-fetch.ts",
] as const;

const RAW_SERVER_IMPORT = /import\(\s*["'][^"']*(requestHost|ssrTiming)\.server["']\s*\)/;

describe("serverOnlyLoaders - granica bundla klienta", () => {
  it.each(CLIENT_REACHABLE)("%s nie ma surowego import() modułu server-only", (file) => {
    expect(read(file)).not.toMatch(RAW_SERVER_IMPORT);
  });

  it("loadery owijają dynamiczne importy w createServerOnlyFn", () => {
    const source = read("src/lib/http/serverOnlyLoaders.ts");
    expect(source).toMatch(
      /loadRequestHostServer = createServerOnlyFn\(\(\) => import\("\.\/requestHost\.server"\)\)/,
    );
    expect(source).toMatch(
      /loadSsrTimingServer = createServerOnlyFn\(\(\) => import\("\.\/ssrTiming\.server"\)\)/,
    );
  });

  it("na serwerze loader zwraca ten sam moduł co bezpośredni import", async () => {
    const { loadSsrTimingServer } = await import("../serverOnlyLoaders");
    const viaLoader = await loadSsrTimingServer();
    const direct = await import("../ssrTiming.server");
    expect(viaLoader.recordDbRoundTrip).toBe(direct.recordDbRoundTrip);
  });
});

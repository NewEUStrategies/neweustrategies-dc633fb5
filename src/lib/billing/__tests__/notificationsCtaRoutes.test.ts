// P12: KAŻDA ścieżka CTA maili subskrypcji istnieje w drzewie tras.
//
// Dawny mail o rezygnacji prowadził na `/cennik` - trasy, której nie ma
// (404 w chwili, gdy klient chciał wrócić). Test czyta ścieżki z kodu
// nadawców (`ctaPath` w notifications.server.ts, stałe tras profilu) i z
// szablonów `tx-*`, a potem szuka ich w `routeTree.gen.ts` (pole `fullPath`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as profileRoutes from "@/lib/profile/routes";
import { SUBSCRIPTION_CTA_PATHS, accessEndedAt } from "@/lib/billing/notifications.server";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ROUTE_TREE = read("src/routeTree.gen.ts");

/** Pełne ścieżki tras z wygenerowanego drzewa. */
const ROUTES = new Set(
  [...ROUTE_TREE.matchAll(/fullPath: '([^']+)'/g)].map((m) => m[1].replace(/\/$/, "") || "/"),
);

const exists = (path: string) => ROUTES.has(path.replace(/\/$/, "") || "/");

describe("ścieżki CTA maili subskrypcji istnieją", () => {
  it("drzewo tras zostało odczytane", () => {
    expect(ROUTES.size).toBeGreaterThan(50);
    expect(exists("/pricing")).toBe(true);
  });

  it.each(Object.entries(SUBSCRIPTION_CTA_PATHS))("SUBSCRIPTION_CTA_PATHS.%s = %s", (_k, path) => {
    expect(exists(path), path).toBe(true);
  });

  it.each(
    Object.entries(profileRoutes).filter(([, v]) => typeof v === "string" && v.startsWith("/")),
  )("stała tras profilu %s = %s", (_k, path) => {
    expect(exists(path as string), path as string).toBe(true);
  });

  it("każdy literał `ctaPath` w nadawcach i ścieżka w szablonach tx-* to istniejąca trasa", () => {
    const sources = [
      read("src/lib/billing/notifications.server.ts"),
      read("src/lib/email-templates/tx-copy.ts"),
      read("src/lib/email-templates/tx-body.ts"),
    ].join("\n");
    const literals = [
      ...sources.matchAll(/ctaPath:\s*"([^"]+)"/g),
      ...sources.matchAll(/(?:href|path)\s*[:=]\s*"(\/[a-z0-9/_-]*)"/gi),
    ].map((m) => m[1]);
    for (const path of literals) expect(exists(path), path).toBe(true);
    expect(sources).not.toContain('"/cennik"');
  });
});

describe("accessEndedAt", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it("koniec w przeszłości = wygasł; w przyszłości albo brak daty = nie", () => {
    expect(accessEndedAt("2026-10-01T00:00:00Z", now)).toBe(true);
    expect(accessEndedAt("2026-11-01T00:00:00Z", now)).toBe(false);
    expect(accessEndedAt(null, now)).toBe(false);
    expect(accessEndedAt("nie-data", now)).toBe(false);
  });
});

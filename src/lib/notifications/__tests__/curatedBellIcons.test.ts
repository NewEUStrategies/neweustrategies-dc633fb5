// Ikony dzwonka w NOWYM i ZMIENIONYM kodzie powiadomień F1-F5 (spec B.7).
//
// Nazwa ikony spoza listy kuratorskiej (`CURATED_ICON_NAMES`) nie psuje
// niczego widocznie - `DynamicIcon` dociąga ją leniwie z rejestru 109 KB, czyli
// każdy dzwonek z taką ikoną płaci za pełny rejestr w przeglądarce. Tak było
// z `receipt` (MAJ-13). Ten plik skanuje źródła nadawców dzwonków i sprawdza
// KAŻDY literał na linii z `icon`/`p_icon`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CURATED_ICON_NAMES } from "@/lib/icons/curatedIconNames";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Fragment od deklaracji funkcji do jej zamykającej klamry na początku linii. */
function functionBody(path: string, declaration: string): string {
  const text = source(path);
  const start = text.indexOf(declaration);
  expect(start, `${path}: ${declaration}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end === -1 ? undefined : end);
}

/** Literały z linii, które mówią o ikonie (`icon:`, `p_icon:`, `icon ?? "…"`, `icon?: "…"`). */
function iconLiterals(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!/\bp?_?icon\b/.test(line)) continue;
    for (const match of line.matchAll(/"([a-z0-9-]+)"/g)) out.push(match[1]);
  }
  return out;
}

const SCANNED: ReadonlyArray<readonly [label: string, text: () => string]> = [
  ["participantNotify.server.ts", () => source("src/lib/events/participantNotify.server.ts")],
  ["tenantAdminAlert.server.ts", () => source("src/lib/events/tenantAdminAlert.server.ts")],
  [
    "registrationOutcomeNotify.server.ts",
    () => source("src/lib/events/registrationOutcomeNotify.server.ts"),
  ],
  [
    "refunds.server.ts#pushRefundNotification",
    () =>
      functionBody("src/lib/billing/refunds.server.ts", "async function pushRefundNotification("),
  ],
];

describe("ikony dzwonka F1-F5 wyłącznie z listy kuratorskiej", () => {
  it.each(SCANNED)("%s", (_label, text) => {
    const literals = iconLiterals(text());
    expect(literals.length).toBeGreaterThan(0);
    for (const name of literals) expect(CURATED_ICON_NAMES, name).toContain(name);
  });

  it("`receipt` nie wraca do żadnego z nadawców (kanarek skanu)", () => {
    for (const [, text] of SCANNED) expect(iconLiterals(text())).not.toContain("receipt");
    expect(CURATED_ICON_NAMES).not.toContain("receipt");
  });
});

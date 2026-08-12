// Parzystosc PL/EN slownika powiadomien + pokrycie kluczy uzywanych w kodzie.
//
// Druga czesc tego pliku jest wazniejsza od pierwszej. Ta powierzchnia stala
// na `t(key, { defaultValue: "<polski tekst>" })` bez wpisu w zadnym bundlu,
// czyli EN dostawal polskie napisy - i ZADNA bramka tego nie widziala, bo
// `check:i18n-parity` porownuje drzewa kluczy, a brak wpisu to nie rozjazd.
// Dlatego mierzymy od strony KODU: kazdy klucz `notifications.*` faktycznie
// wolany w komponentach musi istniec w obu jezykach.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { notificationsResources } from "@/lib/i18n-notifications";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" ? [] : walk(full);
    }
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

/** Klucze `notifications.*` realnie wolane w kodzie powierzchni powiadomien. */
function usedKeys(): string[] {
  const roots = ["src/components/notifications", "src/routes/profile.notifications.tsx"];
  const files = roots.flatMap((root) => (statSync(root).isDirectory() ? walk(root) : [root]));
  const keys = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"(notifications\.[A-Za-z0-9_.]+)"/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

describe("i18n-notifications", () => {
  const pl = flatten(notificationsResources.pl as unknown as Tree).sort();
  const en = flatten(notificationsResources.en as unknown as Tree).sort();

  it("ma identyczny zestaw kluczy w PL i EN", () => {
    expect(pl).toEqual(en);
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = [notificationsResources.pl, notificationsResources.en]
      .map((tree) => JSON.stringify(tree))
      .join(" ");
    expect(values).not.toContain("—");
    expect(values).not.toContain('""');
  });

  it("pokrywa KAZDY klucz notifications.* wolany w kodzie", () => {
    const missing = usedKeys().filter((key) => !pl.includes(key));
    expect(missing).toEqual([]);
  });

  it("PL i EN roznia sie trescia - inaczej jeden z jezykow jest kopia drugiego", () => {
    // Regresja na sedno tej luki: bundle mogly powstac przez skopiowanie
    // polskiego drzewa i podmiane samych kluczy. Porownujemy WARTOSCI kilku
    // napisow, ktore w obu jezykach musza byc rozne.
    const probes = [
      ["notifications.title", "Powiadomienia", "Notifications"],
      ["notifications.settings.digestOff", "Wyłączony", "Off"],
      ["notifications.filters.unread", "Nieprzeczytane", "Unread"],
    ] as const;
    for (const [key, expectedPl, expectedEn] of probes) {
      const path = key.split(".");
      const read = (tree: Tree): string =>
        path.reduce<string | Tree>((node, part) => (node as Tree)[part], tree) as string;
      expect(read(notificationsResources.pl as unknown as Tree)).toBe(expectedPl);
      expect(read(notificationsResources.en as unknown as Tree)).toBe(expectedEn);
    }
  });
});

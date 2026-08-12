// Parzystosc PL/EN slownika panelu spolecznosci + pokrycie kluczy uzywanych
// w kodzie + gwarancja, ze skonwertowane ekrany nie wracaja do `isPl ? … : …`.
//
// Caly modul /admin/community/* trzymal ~250 napisow w recznych wyrazeniach
// warunkowych. Konwersja idzie ekran po ekranie, wiec ta bramka rosnie razem
// z nia: `CONVERTED` jest lista ekranow, ktore MAJA byc juz czyste. Plik nie
// przechodzi, jesli ktorys z nich cofnie sie do literalow.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { adminCommunityPl, adminCommunityEn } from "@/lib/i18n-admin-community";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: readonly string[]): string[] => [
  ...new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, ""))),
];

/** Ekrany, ktorych konwersja jest zakonczona - lista rosnie z kazdym krokiem. */
const CONVERTED = [
  "src/routes/admin.community.contributors.tsx",
  "src/routes/admin.community.badges.tsx",
  "src/routes/admin.community.engagement.tsx",
  "src/routes/admin.community.polls.tsx",
  "src/routes/admin.community.chat.tsx",
  "src/components/admin/community/VerificationDomainsCard.tsx",
  "src/routes/admin.community.index.tsx",
  "src/routes/admin.community.qa.tsx",
  "src/routes/admin.community.notifications.tsx",
  "src/components/admin/community/CommunitySubNav.tsx",
] as const;

const SOURCES = CONVERTED.map((path) => ({ path, src: readFileSync(path, "utf8") }));

const pl = flatten(adminCommunityPl as unknown as Tree);
const en = flatten(adminCommunityEn as unknown as Tree);

describe("i18n-admin-community", () => {
  it("ma identyczny zestaw kluczy w PL i EN", () => {
    expect(baseKeys(pl).sort()).toEqual(baseKeys(en).sort());
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    // Sprawdzamy WARTOSCI, nie podciag w JSON-ie: `'RSVPs "going"'` po
    // serializacji zawiera `\"\"`, wiec naiwne `not.toContain('""')` daje
    // falszywy alarm na poprawnym tlumaczeniu z cudzyslowem w tresci.
    const values = (tree: Tree): string[] =>
      Object.values(tree).flatMap((v) => (typeof v === "string" ? [v] : values(v)));
    const all = [
      ...values(adminCommunityPl as unknown as Tree),
      ...values(adminCommunityEn as unknown as Tree),
    ];
    expect(all.filter((v) => v.trim() === "")).toEqual([]);
    expect(all.filter((v) => v.includes("—"))).toEqual([]);
  });

  it("pokrywa KAZDY klucz adminCommunity.* wolany w skonwertowanych ekranach", () => {
    const used = SOURCES.flatMap(({ src }) =>
      [...src.matchAll(/"(adminCommunity\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]),
    );
    const declared = new Set([...pl, ...baseKeys(pl)]);
    const missing = [...new Set(used)].filter((key) => !declared.has(key)).sort();
    expect(missing).toEqual([]);
  });

  it("zachowuje interpolacje wolane przez kod", () => {
    // `{{badge}}` w potwierdzeniu odebrania odznaki: literowka w nazwie zmiennej
    // renderuje surowy placeholder w oknie, ktore pyta o nieodwracalna operacje.
    for (const tree of [adminCommunityPl, adminCommunityEn]) {
      expect(tree.adminCommunity.badges.revokeConfirmBody).toContain("{{badge}}");
    }
  });

  it("skonwertowane ekrany nie maja ani jednego `isPl`", () => {
    for (const { path, src } of SOURCES) {
      expect({ path, occurrences: (src.match(/isPl/g) ?? []).length }).toEqual({
        path,
        occurrences: 0,
      });
    }
  });

  it("skonwertowane ekrany nie maja twardych polskich napisow", () => {
    const offenders: string[] = [];
    for (const { path, src } of SOURCES) {
      const withoutComments = src
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      for (const match of withoutComments.matchAll(/>([^<>{}\n]{3,80})</g)) {
        if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(match[1])) offenders.push(`${path}: ${match[1].trim()}`);
      }
      for (const match of withoutComments.matchAll(/"([^"\\\n]{4,120})"/g)) {
        if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(match[1])) offenders.push(`${path}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("znacznik BCP-47 idzie z kanonicznego helpera, nie z kopii w komponencie", () => {
    // `isPl ? "pl-PL" : "en-GB"` to jedyne miejsce, gdzie jezyk INTERFEJSU
    // zamienia sie w region FORMATU - kopia w komponencie rozjezdza sie
    // z pozostalymi i daje dwa formaty daty na jednym ekranie.
    for (const { path, src } of SOURCES) {
      expect({ path, hardcoded: src.includes('"pl-PL"') || src.includes('"en-GB"') }).toEqual({
        path,
        hardcoded: false,
      });
    }
  });
});

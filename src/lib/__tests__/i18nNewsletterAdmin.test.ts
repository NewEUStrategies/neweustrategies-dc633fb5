// Parytet PL/EN slownika newslettera + pokrycie kluczy wolanych w kodzie.
//
// STAN ZASTANY. Slownik `i18n-newsletter-admin.ts` ISTNIAL, ale trasy kampanii
// nigdy nie zostaly do niego podlaczone: 91 kluczy, z czego 54 martwe, a same
// trasy trzymaly 60 wyrazen `isPl ? "PL" : "EN"`. Dwa rownolegle slowniki -
// jeden w pliku i18n, drugi rozsypany po JSX - z czego bramka parytetu widziala
// tylko pierwszy.
//
// Konwersja polegala wiec na UZGODNIENIU, nie na dopisaniu: kazde wyrazenie
// zostalo dopasowane do istniejacego klucza po OBU jezykach, a nowy klucz
// powstawal tylko wtedy, gdy zadny nie pasowal. Dwa przypadki wymagaly decyzji:
//   * `Odbiorcy` mialo w slowniku EN "Recipients", a w trasie "Audience" -
//     to dwa rozne uzycia (liczba odbiorcow vs naglowek karty segmentu), wiec
//     `audience` powstalo osobno, zamiast po cichu zmienic widoczny tekst;
//   * `campaigns.cancelEdit` bylo martwe, wiec zostalo przemianowane na
//     `cancel` - nazwa "cancelEdit" klamalaby w dialogu potwierdzenia.
//
// Ten test pilnuje trzech rzeczy naraz: parytetu, pokrycia kluczy wolanych
// w kodzie oraz tego, ze skonwertowane pliki nie wracaja do literalow.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { newsletterAdminPl, newsletterAdminEn } from "@/lib/i18n-newsletter-admin";

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

/** Pliki, ktore MAJA byc juz wolne od recznych wyrazen jezykowych. */
const CONVERTED = [
  "src/routes/admin.newsletter.campaigns.$id.tsx",
  "src/routes/admin.newsletter.campaigns.index.tsx",
  "src/components/admin/newsletter/CampaignContentBuilder.tsx",
  "src/components/admin/newsletter/CampaignBlockProperties.tsx",
] as const;

const SOURCES = CONVERTED.map((path) => ({ path, src: readFileSync(path, "utf8") }));

const pl = flatten(newsletterAdminPl as unknown as Tree);
const en = flatten(newsletterAdminEn as unknown as Tree);

describe("i18n-newsletter-admin", () => {
  it("ma identyczny zestaw kluczy w PL i EN", () => {
    expect(baseKeys(pl).sort()).toEqual(baseKeys(en).sort());
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = (tree: Tree): string[] =>
      Object.values(tree).flatMap((v) => (typeof v === "string" ? [v] : values(v)));
    const all = [
      ...values(newsletterAdminPl as unknown as Tree),
      ...values(newsletterAdminEn as unknown as Tree),
    ];
    expect(all.filter((v) => v.trim() === "")).toEqual([]);
    expect(all.filter((v) => v.includes("—"))).toEqual([]);
  });

  it("pokrywa KAZDY klucz adminNewsletter.* wolany gdziekolwiek w kodzie", () => {
    // Skan calego `src`, nie tylko skonwertowanych plikow: brakujacy klucz
    // renderuje surowa sciezke w interfejsie, wiec bramka ma widziec wszystko.
    const used = new Set<string>();
    for (const { src } of SOURCES) {
      for (const m of src.matchAll(/"(adminNewsletter\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    }
    const declared = new Set([...pl, ...baseKeys(pl)]);
    expect([...used].filter((key) => !declared.has(key)).sort()).toEqual([]);
  });

  it("zachowuje interpolacje wolane przez kod", () => {
    for (const tree of [newsletterAdminPl, newsletterAdminEn]) {
      expect(tree.adminNewsletter.campaigns.testResult).toContain("{{sent}}");
      expect(tree.adminNewsletter.campaigns.testResult).toContain("{{failed}}");
      expect(tree.adminNewsletter.campaigns.sendConfirmCount).toContain("{{count}}");
      expect(tree.adminNewsletter.subscribers.capWarning).toContain("{{count}}");
    }
  });

  it("rozrozznia liczbe odbiorcow od naglowka segmentu", () => {
    // Po polsku oba brzmia "Odbiorcy" - po angielsku NIE, i to jest cala
    // przyczyna istnienia dwoch kluczy zamiast jednego.
    expect(newsletterAdminPl.adminNewsletter.campaigns.recipients).toBe("Odbiorcy");
    expect(newsletterAdminPl.adminNewsletter.campaigns.audience).toBe("Odbiorcy");
    expect(newsletterAdminEn.adminNewsletter.campaigns.recipients).toBe("Recipients");
    expect(newsletterAdminEn.adminNewsletter.campaigns.audience).toBe("Audience");
  });

  it("skonwertowane pliki nie maja ani jednego `isPl`", () => {
    for (const { path, src } of SOURCES) {
      expect({ path, occurrences: (src.match(/isPl/g) ?? []).length }).toEqual({
        path,
        occurrences: 0,
      });
    }
  });

  it("paleta blokow i etykiety wlasciwosci wskazuja KLUCZE, nie napisy", () => {
    // Pary `{ pl, en }` w tablicy `PALETTE` byly kolejnym rownoleglym
    // slownikiem - poza zasiegiem bramki parytetu, bo nie mieszkaly w pliku i18n.
    const builder = SOURCES.find((s) => s.path.endsWith("CampaignContentBuilder.tsx"))!.src;
    expect(builder).toContain("labelKey:");
    expect(builder).not.toMatch(/\bpl:\s*"/);
    expect(builder).not.toMatch(/\ben:\s*"/);
  });

  it("nie tlumaczy jezyka na kod ani na znacznik BCP-47 w komponencie", () => {
    for (const { path, src } of SOURCES) {
      const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect({ path, bcp47: code.includes('"pl-PL"') || code.includes('"en-GB"') }).toEqual({
        path,
        bcp47: false,
      });
    }
  });
});

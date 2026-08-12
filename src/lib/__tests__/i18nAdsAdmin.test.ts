// Parzystosc PL/EN slownika panelu reklam + pokrycie kluczy uzywanych w kodzie
// + gwarancja, ze panel nie wraca do twardych polskich napisow.
//
// Panel mial 53 twarde napisy przy 15 wywolaniach `t()`, a trzy mapy etykiet
// w `lib/ads/types.ts` trzymaly polskie wartosci wprost - czyli caly panel
// dzialal w jednym jezyku bez wzgledu na wybor interfejsu (audyt, pozycja 14.8).
// Testy nizej pilnuja wszystkich trzech warstw tej naprawy naraz.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { adsAdminResources } from "@/lib/i18n-ads-admin";
import {
  AD_PAGE_TYPE_LABEL_KEYS,
  AD_POSITION_LABEL_KEYS,
  AD_SLOT_KIND_LABEL_KEYS,
} from "@/lib/ads/types";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

const ROUTE_SOURCE = readFileSync("src/routes/admin.ads.tsx", "utf8");

describe("i18n-ads-admin", () => {
  const pl = flatten(adsAdminResources.pl as unknown as Tree).sort();
  const en = flatten(adsAdminResources.en as unknown as Tree).sort();

  it("ma identyczny zestaw kluczy w PL i EN", () => {
    expect(pl).toEqual(en);
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = [adsAdminResources.pl, adsAdminResources.en]
      .map((tree) => JSON.stringify(tree))
      .join(" ");
    expect(values).not.toContain("—");
    expect(values).not.toContain('""');
  });

  it("pokrywa KAZDY klucz adsAdmin.* wolany w trasie panelu", () => {
    const used = [...ROUTE_SOURCE.matchAll(/"(adsAdmin\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]);
    const missing = [...new Set(used)].filter((key) => !pl.includes(key)).sort();
    expect(missing).toEqual([]);
  });

  it("pokrywa klucze WSZYSTKICH map etykiet enumow", () => {
    // `Record<Enum, string>` w types.ts wymusza, ze kazdy wariant enuma MA klucz.
    // Ten test domyka druga polowe kontraktu: ze ten klucz istnieje w slowniku.
    const mapped = [
      ...Object.values(AD_POSITION_LABEL_KEYS),
      ...Object.values(AD_PAGE_TYPE_LABEL_KEYS),
      ...Object.values(AD_SLOT_KIND_LABEL_KEYS),
    ];
    const missing = mapped.filter((key) => !pl.includes(key)).sort();
    expect(missing).toEqual([]);
  });

  it("trasa panelu nie zawiera twardych polskich napisow", () => {
    // Bramka regresyjna: konwersja na slownik jest warta tyle, ile jej trwalosc.
    // Skanujemy tekst JSX i literaly stringow (bez komentarzy) w poszukiwaniu
    // polskich znakow diakrytycznych - one nie maja jak trafic do kodu inaczej
    // niz jako tekst dla uzytkownika.
    const withoutComments = ROUTE_SOURCE.replace(/\/\/[^\n]*/g, "").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const offenders: string[] = [];
    for (const match of withoutComments.matchAll(/>([^<>{}\n]{3,80})</g)) {
      if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(match[1])) offenders.push(match[1].trim());
    }
    for (const match of withoutComments.matchAll(/"([^"\\\n]{4,120})"/g)) {
      if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(match[1])) offenders.push(match[1]);
    }
    expect(offenders).toEqual([]);
  });
});

// Parzystosc PL/EN slownika publicznej sieci podcastow + pokrycie kluczy
// wolanych w kodzie + gwarancja, ze trzy trasy nie wracaja do recznych
// `lang === "en" ? ... : ...`.
//
// Trzy trasy publiczne (/podcasts, /podcasts/$show, /podcast/$slug) trzymaly
// razem 35 etykiet w wyrazeniach warunkowych, w tym cztery komunikaty bledu
// wpisane wprost po polsku (errorComponent/notFoundComponent), ktore mowily po
// polsku do KAZDEGO odwiedzajacego.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { podcastsPl, podcastsEn } from "@/lib/i18n-podcasts";

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

const ROUTES = [
  "src/routes/podcasts.index.tsx",
  "src/routes/podcasts.$show.tsx",
  "src/routes/podcast.$slug.tsx",
] as const;

const SOURCES = ROUTES.map((path) => ({ path, src: readFileSync(path, "utf8") }));

const pl = flatten(podcastsPl as unknown as Tree);
const en = flatten(podcastsEn as unknown as Tree);

describe("i18n-podcasts", () => {
  it("ma identyczny zestaw kluczy w PL i EN (po normalizacji liczby mnogiej)", () => {
    expect(baseKeys(pl).sort()).toEqual(baseKeys(en).sort());
  });

  it("ma polskie formy liczby mnogiej dla licznika odcinkow", () => {
    // 1 odcinek / 2-4 odcinki / 5+ odcinkow. Karta katalogu pokazywala wczesniej
    // skrot „odc." dla kazdej liczby, a strona programu zawsze „odcinkow".
    expect(pl.filter((k) => k.startsWith("podcastNetwork.episodeCount")).sort()).toEqual([
      "podcastNetwork.episodeCount_few",
      "podcastNetwork.episodeCount_many",
      "podcastNetwork.episodeCount_one",
      "podcastNetwork.episodeCount_other",
    ]);
    expect(en.filter((k) => k.startsWith("podcastNetwork.episodeCount")).sort()).toEqual([
      "podcastNetwork.episodeCount_one",
      "podcastNetwork.episodeCount_other",
    ]);
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = [podcastsPl, podcastsEn].map((tree) => JSON.stringify(tree)).join(" ");
    expect(values).not.toContain("—");
    expect(values).not.toContain('""');
  });

  it("pokrywa KAZDY klucz podcastNetwork.* wolany w trzech trasach", () => {
    const used = SOURCES.flatMap(({ src }) =>
      [...src.matchAll(/"(podcastNetwork\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]),
    );
    const declared = new Set([...pl, ...baseKeys(pl)]);
    const missing = [...new Set(used)].filter((key) => !declared.has(key)).sort();
    expect(missing).toEqual([]);
  });

  it("zachowuje interpolacje uzywane przez kod", () => {
    // `seasonHeading` bierze `{{season}}`, a licznik `{{count}}` - literowka
    // w nazwie zmiennej renderuje surowy placeholder w naglowku sezonu.
    for (const tree of [podcastsPl, podcastsEn]) {
      expect(tree.podcastNetwork.seasonHeading).toContain("{{season}}");
    }
    expect(podcastsPl.podcastNetwork.episodeCount_many).toContain("{{count}}");
    expect(podcastsEn.podcastNetwork.episodeCount_other).toContain("{{count}}");
  });

  it("zadna z trzech tras nie ma twardych polskich napisow w JSX ani w literalach", () => {
    // Bramka regresyjna. `head()` jest wylaczony ze skanu jednym, jawnym
    // powodem: sklada metadane SSR POZA Reactem, gdzie `t()` nie jest dostepne,
    // wiec tytuly kanalow RSS i opisy Open Graph musza tam zostac przy `lang`.
    const offenders: string[] = [];
    for (const { path, src } of SOURCES) {
      const headStart = src.indexOf("  head:");
      const componentStart = src.indexOf("\nfunction ");
      const scanned =
        headStart >= 0 && componentStart > headStart
          ? src.slice(0, headStart) + src.slice(componentStart)
          : src;
      const withoutComments = scanned
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

  it("etykiety interfejsu nie sa juz wybierane recznie przez `lang`", () => {
    // Poza `head()` nie moze zostac ani jedno `lang === "en" ? ... : ...`:
    // tresc z blizniaczych kolumn idzie teraz przez `pickLocalized`/`pickPair`.
    for (const { path, src } of SOURCES) {
      const headStart = src.indexOf("  head:");
      const componentStart = src.indexOf("\nfunction ");
      const body = headStart >= 0 && componentStart > headStart ? src.slice(componentStart) : src;
      expect({ path, ternaries: (body.match(/lang === "en"/g) ?? []).length }).toEqual({
        path,
        ternaries: 0,
      });
    }
  });
});

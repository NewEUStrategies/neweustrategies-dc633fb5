// Guard KLASY BLEDU, nie pojedynczego przypadku.
//
// Zbior korzeni unieważnianych "na zywo" (LIVE_INVALIDATED_ROOTS) i literaly
// uzyte w `queryKey` zapytan byly utrzymywane niezaleznie. Rozjazd nie dawal
// ZADNEGO sygnalu: `invalidateQueries` po prostu nie trafial w zadne zapytanie,
// wiec widget nie odswiezal sie po zmianie tresci, a lista sugerowala pokrycie,
// ktorego nie bylo (historycznie: "post-list" vs faktyczne
// "builder-post-list", "news-ticker" vs "builder-news-ticker", "rated-list",
// "categories-widget", "tags-widget").
//
// Test czyta ZRODLA z dysku (nie importuje modulow), bo pyta o fakt skladniowy:
// "czy ten korzen wystepuje jako PIERWSZY element jakiegos queryKey". Dzieki
// temu wykrywa martwa rejestracje niezaleznie od tego, czy zapytanie da sie
// zaimportowac w srodowisku testowym (Supabase, React, SSR).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  LIVE_INVALIDATED_ROOTS,
  WIDGET_LIVE_QUERY_PREFIXES,
  WIDGET_QUERY_ROOTS,
} from "@/lib/builder/queryKeys";

const SRC_DIR = resolve(process.cwd(), "src");

/** Modul definicji korzeni - sam w sobie nie jest uzyciem klucza. */
const ROOTS_MODULE = resolve(SRC_DIR, "lib/builder/queryKeys.ts");

/** Wywolania operujace na CUDZYM kluczu - nie dowodza istnienia zapytania. */
const NON_DEFINING_CALL =
  /(invalidate|remove|cancel|refetch|reset|prefetch|ensure|fetch)Quer(y|ies)[\s\S]{0,120}$/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    // Testy i generowane artefakty nie sa dowodem istnienia zapytania.
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    if (full.includes("__tests__")) continue;
    if (/\.gen\.ts$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

const SOURCE_FILES = collectSourceFiles(SRC_DIR).filter((file) => file !== ROOTS_MODULE);
const SOURCES: ReadonlyArray<{ file: string; text: string }> = SOURCE_FILES.map((file) => ({
  file,
  text: readFileSync(file, "utf8"),
}));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Nazwa stalej w WIDGET_QUERY_ROOTS dla danej wartosci korzenia. */
function rootConstName(value: string): string | undefined {
  return Object.entries(WIDGET_QUERY_ROOTS).find(([, v]) => v === value)?.[0];
}

/**
 * Pliki, w ktorych korzen wystepuje jako PIERWSZY element literalu tablicy -
 * czyli jako korzen klucza zapytania. Akceptuje obie formy zapisu: literal
 * ("builder-post-list") i stala (WIDGET_QUERY_ROOTS.postList).
 */
function filesDefiningRoot(root: string): string[] {
  const constName = rootConstName(root);
  const alternatives = [`["']${escapeRegExp(root)}["']`];
  if (constName) alternatives.push(`WIDGET_QUERY_ROOTS\\.${escapeRegExp(constName)}\\b`);
  const pattern = new RegExp(`\\[\\s*(?:${alternatives.join("|")})\\s*(?:,|\\])`, "g");
  const hits: string[] = [];
  for (const { file, text } of SOURCES) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match !== null) {
      const prefix = text.slice(Math.max(0, match.index - 160), match.index);
      if (!NON_DEFINING_CALL.test(prefix)) {
        hits.push(relative(process.cwd(), file));
        break;
      }
      match = pattern.exec(text);
    }
  }
  return hits;
}

describe("WIDGET_QUERY_ROOTS", () => {
  it("nie ma dwoch nazw na ten sam korzen", () => {
    const values = Object.values(WIDGET_QUERY_ROOTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("wystawia korzenie widgetow tresciowych pod stalymi nazwami", () => {
    expect(WIDGET_QUERY_ROOTS.postList).toBe("builder-post-list");
    expect(WIDGET_QUERY_ROOTS.newsTicker).toBe("builder-news-ticker");
    expect(WIDGET_QUERY_ROOTS.sliderPosts).toBe("builder-slider-posts");
    expect(WIDGET_QUERY_ROOTS.categories).toBe("builder-cats");
    expect(WIDGET_QUERY_ROOTS.tags).toBe("builder-tags");
    expect(WIDGET_QUERY_ROOTS.recommendedPosts).toBe("recommended-posts");
    expect(WIDGET_QUERY_ROOTS.eventById).toBe("builder-event-by-id");
    expect(WIDGET_QUERY_ROOTS.speakers).toBe("builder-speakers");
    expect(WIDGET_QUERY_ROOTS.meetingSlots).toBe("builder-meeting-slots");
  });
});

describe("WIDGET_LIVE_QUERY_PREFIXES", () => {
  it("zawiera dokladnie LIVE_INVALIDATED_ROOTS", () => {
    expect(WIDGET_LIVE_QUERY_PREFIXES.size).toBe(new Set(LIVE_INVALIDATED_ROOTS).size);
    for (const root of LIVE_INVALIDATED_ROOTS) {
      expect(WIDGET_LIVE_QUERY_PREFIXES.has(root)).toBe(true);
    }
  });

  it("obejmuje korzenie widgetow tresciowych (post-list, ticker, slider, taksonomie, rekomendacje)", () => {
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.postList)).toBe(true);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.newsTicker)).toBe(true);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.sliderPosts)).toBe(true);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.ratedList)).toBe(true);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.categories)).toBe(true);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.tags)).toBe(true);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.recommendedPosts)).toBe(true);
  });

  it("NIE obejmuje slotow spotkan (dane per-uzytkownik, wlasna inwalidacja)", () => {
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.meetingSlots)).toBe(false);
  });
});

describe("spojnosc inwalidacji live ze zrodlami", () => {
  it("znajduje pliki zrodlowe do przeszukania", () => {
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  // WLASCIWY guard: kazdy korzen zarejestrowany do inwalidacji musi byc
  // korzeniem JAKIEGOS realnego queryKey. Rejestracja korzenia, ktorego zadne
  // zapytanie nie uzywa, to cicha martwa sciezka - dokladnie ten blad, ktory
  // zabral odswiezanie szesciu widgetom.
  it.each(LIVE_INVALIDATED_ROOTS.map((root) => [root] as const))(
    'korzen "%s" jest uzywany jako pierwszy element queryKey',
    (root) => {
      expect(filesDefiningRoot(root)).not.toHaveLength(0);
    },
  );

  it("wykrywa korzen zarejestrowany do inwalidacji, ktorego nikt nie uzywa", () => {
    // Kontrola samego detektora: nazwa spoza kodu nie moze byc "znaleziona".
    expect(filesDefiningRoot("builder-nieistniejacy-korzen")).toHaveLength(0);
    // ...a historyczna, bledna nazwa post-listy tez nie (to byl ten bug).
    expect(filesDefiningRoot("post-list")).toHaveLength(0);
  });

  it("nie liczy samego invalidateQueries jako uzycia korzenia", () => {
    const probe = 'void qc.invalidateQueries({ queryKey: ["builder-post-list"] });';
    expect(NON_DEFINING_CALL.test(probe.slice(0, probe.indexOf("[")))).toBe(true);
  });
});

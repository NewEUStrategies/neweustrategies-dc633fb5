// @vitest-environment node
//
// JEDEN FONT W ŚCIEŻCE KRYTYCZNEJ (P3.2b, fala 3; decyzja właściciela
// 2026-10-08: jedynym fontem ścieżki krytycznej jest Red Hat Display, oś wag
// przycięta do 400-900).
//
// CO TEN PLIK PRZYPINA. `src/assets/fonts/red-hat-display-latin-pl.woff2` to
// jedyny preloadowany font, ten sam dla PL i EN. Bez tego testu każda z poniższych
// regresji przechodzi po cichu, bo strona „działa” - tylko wolniej albo z CLS:
//   - polska litera poza plikiem głównym albo w `unicode-range` latin-ext:
//     PL znowu pobiera drugi plik (dawne 30 672 + 14 060 B w dwóch żądaniach);
//   - podzbiór z innego wydania fontu albo inne metryki pionowe: inna wysokość
//     linii po podmianie = CLS przy `font-display: swap`;
//   - fallback z jedną twarzą dla wszystkich wag albo metryką niepasującą do
//     pliku: tekst przed podmianą ma inną szerokość niż RHD = CLS;
//   - preload innego pliku niż `url()` w `@font-face`: dwa pobrania;
//   - drugi preloadowany font: bramka `fontPreloadCount` w `check:document-weight`.
//
// RECEPTURA PLIKU (narzędzia poza repo, bez zależności w package.json; szczegóły
// i hashe w komentarzu nad `@font-face` w `src/styles.css`):
//   SOURCE_DATE_EPOCH=1731673512 uvx --python 3.11 --from fonttools==4.66.1 \
//     --with brotli==1.2.0 fonttools varLib.instancer RedHatDisplay[wght].ttf \
//     wght=400:900 -q -o RHD-400-900.ttf
//   uvx … pyftsubset RHD-400-900.ttf --unicodes="$UNICODES" \
//     --layout-features="$FEATURES" --flavor=woff2 \
//     --output-file=red-hat-display-latin-pl.woff2
// gdzie UNICODES i FEATURES to stałe niżej.
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  readCmap,
  readFvarAxes,
  readHead,
  readHhea,
  readLayoutFeatures,
  readNameVersion,
  readOs2,
  readWoff2Tables,
} from "../woff2Tables";
import { analyzeDocument } from "../../../../scripts/performance/documentWeight";
import { rootDocumentLinks, rootLinkHeaderValues } from "@/lib/seo/rootHead";

/** Zestaw kodów `pyftsubset` (cmap dzisiejszego latin Google + 18 polskich liter). */
const UNICODES =
  "U+000D,U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC," +
  "U+0300-0301,U+0303-0304,U+0308,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215," +
  "U+FEFF,U+FFFD,U+0104-0107,U+0118-0119,U+0141-0144,U+015A-015B,U+0179-017C";
/** Cechy OpenType `pyftsubset` (cechy dawnego pliku latin + `mkmk`). */
const FEATURES = "calt,ccmp,dnom,frac,liga,locl,numr,pnum,tnum,kern,mark,mkmk";

const MAIN_FILE = "red-hat-display-latin-pl.woff2";
const EXT_FILE = "red-hat-display-latin-ext.woff2";
const FONTS = "src/assets/fonts";
const PL_LETTERS = "ĄąĆćĘęŁłŃńÓóŚśŹźŻż";
/**
 * Symbole ze słowników i fixture, których nie ma w ŻADNYM pliku rodziny Red Hat
 * Display (sprawdzone na pełnym zmiennym foncie 1.030): przeglądarka bierze je
 * z fontu systemowego dziś i przed P3.2b, bez pobierania drugiego pliku.
 */
const SYSTEM_FALLBACK_SYMBOLS = "→⌘≥≤✓←↩↔≈✗⇄";
/**
 * `size-adjust` per waga (procent), policzone z kształtowania HarfBuzz
 * (kerning) korpusu strony `/` + słownika PL (49 385 znaków): szerokość RHD(w) /
 * szerokość Liberation Sans Regular (w <= 500) albo Bold (w >= 600). Wyjątek:
 * 800 = stosunek ważony użyciem na produkcyjnej stronie `/` (etykiety wielkimi
 * literami; korpus mieszanej wielkości liter dawał 97,75% i etykieta sekcji
 * fixture EN łamała się dopiero po podmianie). Zmiana pliku fontu = przeliczenie
 * tej tabeli i bloku w `styles.css`.
 */
const SIZE_ADJUST: Record<string, number> = {
  "1 449": 97.72,
  "450 549": 99.22,
  "550 649": 93.4,
  "650 749": 95.34,
  "750 849": 99.71,
  "850 1000": 100.63,
};

const read = (path: string) => readFileSync(path, "utf8");
const main = readWoff2Tables(readFileSync(`${FONTS}/${MAIN_FILE}`));
const ext = readWoff2Tables(readFileSync(`${FONTS}/${EXT_FILE}`));
const mainCmap = readCmap(main);
const extCmap = readCmap(ext);

type Range = readonly [number, number];
interface FontFace {
  readonly family: string;
  readonly descriptors: Readonly<Record<string, string>>;
}

/** Bloki `@font-face` arkusza (komentarze usunięte), w kolejności deklaracji. */
function fontFaces(css: string): FontFace[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const descriptors: Record<string, string> = {};
    for (const decl of m[1].split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      descriptors[decl.slice(0, at).trim()] = decl
        .slice(at + 1)
        .replace(/\s+/g, " ")
        .trim();
    }
    return { family: (descriptors["font-family"] ?? "").replace(/["']/g, ""), descriptors };
  });
}

function unicodeRanges(value: string): Range[] {
  return value.split(",").map((part) => {
    const m = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
    if (!m) throw new Error(`nieobsługiwany zapis unicode-range: ${part}`);
    const from = parseInt(m[1], 16);
    return [from, m[2] ? parseInt(m[2], 16) : from] as const;
  });
}

const inRanges = (ranges: readonly Range[], code: number) =>
  ranges.some(([from, to]) => code >= from && code <= to);

const percent = (value: string | undefined) => {
  const m = /^(-?[\d.]+)%$/.exec(value ?? "");
  if (!m) throw new Error(`oczekiwano procentu, jest ${value}`);
  return Number(m[1]);
};

const faces = fontFaces(read("src/styles.css"));
const rhd = faces.filter((f) => f.family === "Red Hat Display");
const fallback = faces.filter((f) => f.family === "Red Hat Display Fallback");
const mainFace = rhd.find((f) => f.descriptors["src"]?.includes(MAIN_FILE));
const extFace = rhd.find((f) => f.descriptors["src"]?.includes(EXT_FILE));
const mainRange = unicodeRanges(mainFace?.descriptors["unicode-range"] ?? "U+0");
const extRange = unicodeRanges(extFace?.descriptors["unicode-range"] ?? "U+0");

/** Znaki napisów publicznych: słowniki PL i EN + napisy fixture pomiaru `/`. */
function corpusCharacters(): Set<string> {
  const texts = [read("src/lib/locale/pl.ts"), read("src/lib/locale/en.ts")];
  const walk = (value: unknown): void => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(JSON.parse(read("e2e/fixtures/first-visit.json")));
  const out = new Set<string>();
  for (const text of texts) for (const ch of text) if (ch.codePointAt(0)! >= 0x20) out.add(ch);
  return out;
}

describe("plik główny: pokrycie polskich liter i zakresy", () => {
  it("18 polskich liter jest w pliku głównym i w zakresie twarzy głównej, a NIE w zakresie latin-ext", () => {
    for (const letter of PL_LETTERS) {
      const code = letter.codePointAt(0)!;
      expect({ letter, inMainCmap: mainCmap.has(code) }).toEqual({ letter, inMainCmap: true });
      expect({ letter, inMainRange: inRanges(mainRange, code) }).toEqual({
        letter,
        inMainRange: true,
      });
      expect({ letter, inExtRange: inRanges(extRange, code) }).toEqual({
        letter,
        inExtRange: false,
      });
    }
  });

  it("każdy znak pliku głównego mieści się w zakresie twarzy głównej", () => {
    const outside = [...mainCmap].filter((code) => !inRanges(mainRange, code));
    expect(outside.map((c) => `U+${c.toString(16).toUpperCase()}`)).toEqual([]);
  });

  it("słowniki PL/EN i fixture: nic nie trafia do latin-ext, a brakujące glify to tylko symbole spoza rodziny", () => {
    const problems: string[] = [];
    for (const ch of corpusCharacters()) {
      const code = ch.codePointAt(0)!;
      const hex = `U+${code.toString(16).toUpperCase().padStart(4, "0")} ${ch}`;
      // Znak z zakresu latin-ext = drugie żądanie fontu na stronie PL/EN.
      if (inRanges(extRange, code)) problems.push(`${hex}: w zakresie latin-ext`);
      if (mainCmap.has(code)) {
        if (!inRanges(mainRange, code)) problems.push(`${hex}: w pliku, poza zakresem twarzy`);
      } else if (extCmap.has(code)) {
        problems.push(`${hex}: tylko w latin-ext`);
      } else if (!SYSTEM_FALLBACK_SYMBOLS.includes(ch) && code >= 0x80) {
        problems.push(`${hex}: poza rodziną i poza listą symboli systemowych`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("Ă (U+0102) z dawnego pliku latin idzie do latin-ext, nie znika (krytyka L8)", () => {
    expect(mainCmap.has(0x0102)).toBe(false);
    expect(extCmap.has(0x0102)).toBe(true);
    expect(inRanges(extRange, 0x0102)).toBe(true);
  });
});

describe("plik główny zgodny z recepturą", () => {
  it("cmap mieści się w zestawie kodów receptury i obejmuje wszystkie znaki ASCII", () => {
    const recipe = unicodeRanges(UNICODES);
    expect([...mainCmap].filter((code) => !inRanges(recipe, code))).toEqual([]);
    for (let code = 0x20; code <= 0x7e; code++) expect(mainCmap.has(code)).toBe(true);
  });

  it("cechy OpenType jak w dawnym pliku latin (kerning, ligatury, cyfry) i tylko z receptury", () => {
    // Utrata `kern` albo `liga` zmienia szerokości tekstu po podmianie = CLS.
    const gsub = readLayoutFeatures(main, "GSUB");
    const gpos = readLayoutFeatures(main, "GPOS");
    expect(gsub).toEqual(["calt", "ccmp", "dnom", "frac", "liga", "locl", "numr", "pnum", "tnum"]);
    expect(gpos).toEqual(["kern", "mark"]);
    const allowed = FEATURES.split(",");
    expect([...gsub, ...gpos].filter((f) => !allowed.includes(f))).toEqual([]);
  });
});

describe("plik główny: metryki, oś wag i rozmiar", () => {
  it("metryki pionowe identyczne z wydaniem 1.030 i z plikiem latin-ext", () => {
    // Stałe zapisane z dawnego `red-hat-display-latin.woff2` (1.030), który zniknął.
    const expected = {
      unitsPerEm: 1000,
      hhea: { ascender: 1018, descender: -305, lineGap: 0 },
      typo: [1018, -305, 0],
      win: [1018, 305],
      useTypoMetrics: true,
      xHeight: 501,
      capHeight: 700,
    };
    for (const tables of [main, ext]) {
      const os2 = readOs2(tables);
      expect({
        unitsPerEm: readHead(tables).unitsPerEm,
        hhea: readHhea(tables),
        typo: [os2.typoAscender, os2.typoDescender, os2.typoLineGap],
        win: [os2.winAscent, os2.winDescent],
        useTypoMetrics: (os2.fsSelection & 0x80) !== 0,
        xHeight: os2.xHeight,
        capHeight: os2.capHeight,
      }).toEqual(expected);
    }
    expect(readNameVersion(main)).toMatch(/^Version 1\.030/);
  });

  it("oś wag zachowana: jedna oś wght, min <= 400, domyślnie 400, max >= 900", () => {
    const axes = readFvarAxes(main);
    expect(axes.map((a) => a.tag)).toEqual(["wght"]);
    expect(axes[0].min).toBeLessThanOrEqual(400);
    expect(axes[0].default).toBe(400);
    expect(axes[0].max).toBeGreaterThanOrEqual(900);
  });

  it("rozmiar: przycięty podzbiór (~24 KB), nie pełny font ani plik bez kompresji", () => {
    expect(statSync(`${FONTS}/${MAIN_FILE}`).size).toBeLessThanOrEqual(26_000);
  });
});

describe("`@font-face` Red Hat Display w styles.css", () => {
  it("dokładnie dwie twarze z woff2, główna zadeklarowana PO latin-ext", () => {
    expect(rhd).toHaveLength(2);
    expect(rhd.every((f) => /url\([^)]*\.woff2[^)]*\)/.test(f.descriptors["src"] ?? ""))).toBe(
      true,
    );
    // Przy nakładających się zakresach przeglądarka sprawdza najpierw ostatnią regułę.
    expect(rhd[1]).toBe(mainFace);
    expect(rhd[0]).toBe(extFace);
  });

  it("obie twarze: font-display swap i font-weight 400 900", () => {
    for (const face of rhd) {
      expect(face.descriptors["font-display"]).toBe("swap");
      expect(face.descriptors["font-weight"]).toBe("400 900");
    }
  });
});

describe("krój zastępczy Red Hat Display Fallback", () => {
  const hhea = readHhea(main);
  const upm = readHead(main).unitsPerEm;
  const ascent = (100 * hhea.ascender) / upm; // 101,8%
  const descent = (100 * -hhea.descender) / upm; // 30,5%
  const weights = fallback.map((f) => {
    const [min, max] = (f.descriptors["font-weight"] ?? "").split(" ").map(Number);
    return { face: f, min, max };
  });

  it("zakresy wag są ciągłe od 1 do 1000, bez nakładania", () => {
    const sorted = [...weights].sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(1);
    expect(sorted.at(-1)!.max).toBe(1000);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].min).toBe(sorted[i - 1].max + 1);
  });

  it("override x size-adjust = metryka pliku głównego w każdej twarzy", () => {
    for (const { face } of weights) {
      const sa = percent(face.descriptors["size-adjust"]) / 100;
      expect(Math.abs(percent(face.descriptors["ascent-override"]) * sa - ascent)).toBeLessThan(
        0.02,
      );
      expect(Math.abs(percent(face.descriptors["descent-override"]) * sa - descent)).toBeLessThan(
        0.02,
      );
      expect(face.descriptors["line-gap-override"]).toBe("0%");
    }
  });

  it("size-adjust z tabeli policzonej dla każdej wagi", () => {
    expect(
      Object.fromEntries(
        weights.map(({ face }) => [
          face.descriptors["font-weight"],
          percent(face.descriptors["size-adjust"]),
        ]),
      ),
    ).toEqual(SIZE_ADJUST);
  });

  it("wagi >= 550 biorą prawdziwy Bold (bez syntezy), niższe - Regular", () => {
    for (const { face, min } of weights) {
      const names = [...(face.descriptors["src"] ?? "").matchAll(/local\(["']?([^"')]+)/g)].map(
        (m) => m[1],
      );
      expect(names.length).toBeGreaterThan(0);
      const bold = names.filter((n) => /bold/i.test(n));
      expect({
        weight: face.descriptors["font-weight"],
        allBold: bold.length === names.length,
      }).toEqual({ weight: face.descriptors["font-weight"], allBold: min >= 550 });
      if (min < 550) expect(bold).toEqual([]);
      // Liberation Sans (metryczny bliźniak Arialu) - jedyny kandydat na runnerach CI.
      expect(names.some((n) => /^Liberation ?Sans/.test(n))).toBe(true);
    }
  });
});

describe("preload = plik z @font-face, dokładnie jeden", () => {
  it("__root.tsx importuje `?url` tego samego pliku, do którego prowadzi url() twarzy głównej", () => {
    const root = read("src/routes/__root.tsx");
    const imports = [...root.matchAll(/from\s+"([^"]+\.woff2)\?url"/g)].map((m) => m[1]);
    expect(imports).toEqual([`../assets/fonts/${MAIN_FILE}`]);
    expect(mainFace?.descriptors["src"]).toContain(`./assets/fonts/${MAIN_FILE}`);
  });

  it("bramka check:document-weight liczy jeden font dla zestawu korzenia, dwa dla dawnego", () => {
    const assets = { appCss: "/assets/styles-x.css", font: "/assets/rhd-latin-pl-1.woff2" };
    const tag = (link: Record<string, string>) =>
      `<link ${Object.entries(link)
        .map(([k, v]) => `${k === "crossOrigin" ? "crossorigin" : k}="${v}"`)
        .join(" ")}>`;
    const html = (links: Record<string, string>[]) =>
      `<!doctype html><html><head>${links.map(tag).join("")}</head><body></body></html>`;
    const now = analyzeDocument({
      html: html(rootDocumentLinks("", assets)),
      linkHeader: rootLinkHeaderValues(assets).join(", "),
    });
    expect(now.fontPreloadCount).toBe(1);
    // Kontrola negatywna: drugi preloadowany font (dawne latin-ext) bramka widzi.
    const second = { ...rootDocumentLinks("", assets).find((l) => l.as === "font")! };
    second.href = "/assets/rhd-latin-ext-1.woff2";
    const before = analyzeDocument({ html: html([...rootDocumentLinks("", assets), second]) });
    expect(before.fontPreloadCount).toBe(2);
  });
});

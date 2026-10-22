// Słowniki panelu zgody i dymków pomiaru (I9d-Y2) - parytet PL/EN,
// liczebniki, kompletność kluczy czytanych z list stałych i arkusz publiczny.
//
// PO CO. Parytet kluczy pilnuje też typ (`const en: typeof pl`), ale nie to,
// czy napis EN różni się od PL, czy formy liczebników są kompletne, ani czy
// angielskie słowo nie jest klasą Tailwinda (pliki `src/lib/i18n-*.ts`
// skanuje generator arkusza CZYTELNIKA - budżet `publicCss` zamrożony).
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-newsletter-measurement";
import "@/lib/i18n-admin-measurement-hint";

type Tree = Record<string, unknown>;

const PREFIXES = ["adminNewsletterMeasurement", "adminMeasurementHint"] as const;

function tree(lang: "pl" | "en", prefix: string): Tree {
  return i18n.getResource(lang, "translation", prefix) as Tree;
}

function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Tree).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

describe("parytet PL/EN", () => {
  it.each(PREFIXES)("%s: te same klucze, napisy niepuste i różne w PL i EN", (prefix) => {
    const pl = new Map(leaves(tree("pl", prefix)));
    const en = new Map(leaves(tree("en", prefix)));
    expect([...en.keys()].sort()).toEqual([...pl.keys()].sort());
    for (const [key, value] of pl) {
      expect(value.trim(), key).not.toBe("");
      // Wersja treści i liczby są wspólne - reszta napisów musi być przetłumaczona.
      expect(en.get(key), key).not.toBe(value);
    }
  });

  it("liczebniki: PL `_one/_few/_many/_other`, interpolacja tych samych zmiennych", () => {
    const pl = new Map(leaves(tree("pl", "adminNewsletterMeasurement")));
    const en = new Map(leaves(tree("en", "adminNewsletterMeasurement")));
    for (const base of ["request.confirmBody", "request.started"]) {
      for (const form of ["one", "few", "many", "other"]) {
        expect(pl.get(`${base}_${form}`), `${base}_${form}`).toBeTruthy();
      }
    }
    const vars = (text: string | undefined) =>
      [...(text ?? "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [key, value] of pl) {
      expect(vars(en.get(key)), key).toEqual(vars(value));
    }
  });

  it("okno potwierdzenia mówi o liczbie, limicie dziennym i ważności linku", () => {
    const t = i18n.getFixedT("pl");
    const text = t("adminNewsletterMeasurement.request.confirmBody", {
      count: 5,
      cap: 200,
      days: 60,
    });
    expect(text).toMatch(/do 5 subskrybentów/);
    expect(text).toMatch(/200 maili dziennie/);
    expect(text).toMatch(/60 dni/);
    expect(i18n.getFixedT("en")("adminNewsletterMeasurement.request.started", { count: 1 })).toBe(
      "Request queued for 1 subscriber.",
    );
  });
});

describe("arkusz publiczny", () => {
  // Lista jak w teście słownika retencji (`i18nDataRetention.test.ts`).
  const UTILITIES = new Set([
    "block",
    "inline",
    "flex",
    "grid",
    "table",
    "contents",
    "hidden",
    "visible",
    "invisible",
    "collapse",
    "static",
    "fixed",
    "absolute",
    "relative",
    "sticky",
    "grow",
    "shrink",
    "truncate",
    "italic",
    "underline",
    "overline",
    "uppercase",
    "lowercase",
    "capitalize",
    "border",
    "rounded",
    "shadow",
    "ring",
    "outline",
    "blur",
    "invert",
    "sepia",
    "grayscale",
    "filter",
    "transform",
    "transition",
    "container",
    "isolate",
    "resize",
    "group",
    "peer",
    "ordinal",
    "antialiased",
  ]);

  it.each(PREFIXES)(
    "%s: żaden napis nie zawiera samodzielnej nazwy klasy narzędziowej",
    (prefix) => {
      for (const lang of ["pl", "en"] as const) {
        for (const [key, value] of leaves(tree(lang, prefix))) {
          for (const word of value.split(/[^A-Za-z-]+/)) {
            expect(UTILITIES.has(word), `${lang} ${key}: ${word}`).toBe(false);
          }
        }
      }
    },
  );
});

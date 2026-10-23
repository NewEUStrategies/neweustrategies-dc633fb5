// Słownik decyzji o pomiarze na stronach publicznych (`/newsletter/measurement`
// i karta na `/newsletter/confirm`; I9d-Y2, I9d-Y2b) - parytet PL/EN,
// komplet kluczy wspólnego panelu decyzji i arkusz publiczny.
//
// PO CO. Nakładka `src/lib/i18n-newsletter-measurement.ts` jest ładowana
// w chunku strony czytelnika, a pliki `src/lib/i18n-*.ts` skanuje generator
// arkusza PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda
// dokłada regułę do CSS każdej strony (budżet `publicCss` zamrożony).
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import "@/lib/i18n-newsletter-measurement";

type Tree = Record<string, unknown>;

function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Tree).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

const tree = (lang: "pl" | "en") =>
  i18n.getResource(lang, "translation", "newsletterMeasurement") as Tree;

describe("newsletterMeasurement (strony publiczne)", () => {
  it("parytet PL/EN: te same klucze, napisy niepuste i przetłumaczone", () => {
    const pl = new Map(leaves(tree("pl")));
    const en = new Map(leaves(tree("en")));
    expect([...en.keys()].sort()).toEqual([...pl.keys()].sort());
    for (const [key, value] of pl) {
      expect(value.trim(), key).not.toBe("");
      expect(en.get(key), key).not.toBe(value);
    }
  });

  it("komplet kluczy karty DOI i wspólnego panelu decyzji (I9d-Y2b)", () => {
    const pl = new Map(leaves(tree("pl")));
    for (const key of [
      "grantTitle",
      "grantLead",
      "doiLead",
      "grantNote",
      "grantBtn",
      "declineBtn",
      "working",
      "grantedTitle",
      "grantedBody",
      "declinedTitle",
      "declinedBody",
      "alreadyDecidedTitle",
      "alreadyDecidedBody",
      "inactiveTitle",
      "inactiveBody",
      "expiredTitle",
      "expiredBody",
      "invalidTitle",
      "invalidBody",
      "errorTitle",
      "errorBody",
      "rateLimitedBody",
      "retryBtn",
    ]) {
      expect(pl.get(key), key).toBeTruthy();
    }
  });

  it("odmowa ma równorzędny, jednoznaczny przycisk w obu językach", () => {
    expect(i18n.getFixedT("pl")("newsletterMeasurement.declineBtn")).toBe("Nie zgadzam się");
    expect(i18n.getFixedT("en")("newsletterMeasurement.declineBtn")).toBe("I do not agree");
  });

  // Lista jak w testach słowników panelu (`i18nNewsletterMeasurement.test.ts`).
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

  it("żaden napis nie zawiera samodzielnej nazwy klasy narzędziowej (arkusz publiczny)", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const [key, value] of leaves(tree(lang))) {
        for (const word of value.split(/[^A-Za-z-]+/)) {
          expect(UTILITIES.has(word), `${lang} ${key}: ${word}`).toBe(false);
        }
      }
    }
  });
});

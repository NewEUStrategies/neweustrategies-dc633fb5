// Słowniki retencji (karta, lista „do wygaszenia", edytor prośby, notka
// agregatu) - kompletność per kategoria i arkusz publiczny.
//
// PO CO. Karta renderuje kategorie z odczytu bazy kluczem dynamicznym
// (`categories.<klucz>.name`), a edytor pola z listy stałej - bramka parytetu
// porównuje PL z EN, ale nie wie, że nowa kategoria (stała TS) w ogóle
// potrzebuje wpisu. Brak dawałby surowy klucz w wierszu, którego admin
// używa, żeby zdecydować o usuwaniu danych.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-data-retention";
import "@/lib/i18n-admin-retention-aggregate";
import {
  DATA_RETENTION_EDITABLE_CATEGORIES,
  DATA_RETENTION_RUN_CATEGORIES,
} from "@/lib/privacy/dataRetention";
import { NEWSLETTER_SUNSET_COPY_FIELDS } from "@/lib/privacy/newsletterSunset";

type Tree = Record<string, unknown>;

function tree(lang: "pl" | "en"): Tree {
  return i18n.getResource(lang, "translation", "adminDataRetention") as Tree;
}

function leaf(root: Tree, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object" ? (node as Tree)[part] : undefined,
      root,
    );
}

function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Tree).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

describe("kompletność słownika retencji", () => {
  it.each(["pl", "en"] as const)(
    "%s: każda kategoria ma nazwę, opis, skutki, podstawę i standard",
    (lang) => {
      const root = tree(lang);
      for (const key of DATA_RETENTION_RUN_CATEGORIES) {
        for (const part of ["name", "what", "after", "basis", "standard"]) {
          const value = leaf(root, `categories.${key}.${part}`);
          expect(typeof value === "string" && value.trim() !== "", `${key}.${part}`).toBe(true);
        }
      }
      // Kategoria ustawowa opisuje regułę zamiast okresu.
      for (const key of ["crm_customers", "consent_log"]) {
        expect(typeof leaf(root, `categories.${key}.rule`), key).toBe("string");
      }
      expect(DATA_RETENTION_EDITABLE_CATEGORIES).toContain("club_applications");
    },
  );

  it.each(["pl", "en"] as const)("%s: każde pole treści prośby ma etykietę", (lang) => {
    const root = tree(lang);
    for (const field of NEWSLETTER_SUNSET_COPY_FIELDS) {
      expect(typeof leaf(root, `sunsetCopy.fields.${field}`), field).toBe("string");
    }
  });

  it("dni na reakcję w opisie skutków wygaszania to zmienna, nie liczba wpisana w tekst", () => {
    for (const lang of ["pl", "en"] as const) {
      expect(leaf(tree(lang), "categories.newsletter_inactive.after")).toMatch(
        /\{\{responseDays\}\}/,
      );
    }
  });
});

describe("arkusz publiczny", () => {
  // Pliki `src/lib/i18n-*.ts` skanuje generator CSS czytelnika: słowo będące
  // klasą narzędziową dokłada regułę do każdej strony (lista jak w teście
  // słownika finansów huba).
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

  it("żaden napis nie zawiera samodzielnej nazwy klasy narzędziowej", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const [key, value] of leaves(tree(lang))) {
        for (const word of value.split(/[^A-Za-z-]+/)) {
          expect(UTILITIES.has(word), `${lang} ${key}: ${word}`).toBe(false);
        }
      }
    }
  });
});

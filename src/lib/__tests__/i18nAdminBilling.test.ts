// Słownik panelu rozliczeń (PL/EN) - rejestracja bundle'a i parytet drzew.
//
// DLACZEGO OSOBNY PLIK. Panele rozliczeń mockują ten moduł (`vi.mock(... () =>
// ({}))`), bo w ich testach i18n jest echem kluczy. Tym samym ŻADEN test nie
// wykonywał rejestracji słownika - a to jest jedyne miejsce, w którym brakujący
// klucz EN (np. nowa etykieta „liczony w naszej kasie" dla kodów wydarzeń)
// wychodzi jako surowy klucz na ekranie admina drugiego języka.
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-billing";

type Tree = { [key: string]: string | Tree };

function leafPaths(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : leafPaths(value, path);
  });
}

function adminBilling(lang: "pl" | "en"): Tree {
  const bundle = i18n.getResourceBundle(lang, "translation") as { adminBilling: Tree };
  return bundle.adminBilling;
}

describe("i18n-admin-billing - rejestracja i parytet", () => {
  it("import rejestruje drzewo `adminBilling` w PL i EN o identycznych kluczach", () => {
    const pl = leafPaths(adminBilling("pl")).sort();
    const en = leafPaths(adminBilling("en")).sort();

    expect(pl.length).toBeGreaterThan(0);
    expect(pl).toEqual(en);
  });

  it("kod liczony w naszej kasie ma własne etykiety w obu językach", () => {
    const tPl = i18n.getFixedT("pl");
    const tEn = i18n.getFixedT("en");

    expect(tPl("adminBilling.eventCodeLocal")).toBe("liczony w naszej kasie");
    expect(tEn("adminBilling.eventCodeLocal")).toBe("counted at our checkout");
    expect(tPl("adminBilling.eventCodeStaleCopy")).toBe("aktywna kopia u operatora - wyłącz");
    expect(tEn("adminBilling.eventCodeStaleCopy")).toBe("active copy at provider - deactivate");
    expect(tPl("adminBilling.eventCodesNotSynced")).toContain("nie trafiają do operatora");
    expect(tEn("adminBilling.eventCodesNotSynced")).toContain("not sent to the provider");
  });
});

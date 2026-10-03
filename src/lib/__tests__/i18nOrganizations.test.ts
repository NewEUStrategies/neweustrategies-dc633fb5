// Nakładka publicznego profilu organizacji (`organization.*`) - kontrakt
// rejestracji i odmiany.
//
// DLACZEGO WZORZEC, A NIE TYLKO SKUTEK. Wszystkie pozostałe nakładki trzymają
// rejestrację W `ensureI18n()` (z flagą `registered`) i wołają ją przy imporcie.
// `i18n-organizations` miała stary wzorzec: rejestracja luzem na poziomie
// modułu i `ensureI18n(){}` jako no-op. Trasa i komponent wołają tę funkcję
// w przekonaniu, że ZAPEWNIA słownik - a ona nie robiła nic. Słownik żył
// wyłącznie dzięki efektowi ubocznemu importu, który bundler wolno wyciąć,
// gdy jedyną referencją do modułu jest wywołanie pustej funkcji (Vite i Nitro
// tree-shakują na różnych zasadach). Wtedy profil organizacji pokazuje gołe
// `organization.postsHeading`. Test skutku przechodzi na obu wzorcach - dlatego
// ostatni przypadek pyta wprost, czy to `ensureI18n()` rejestruje słownik.
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-organizations";
import { ORGANIZATION_PAGE_COPY } from "@/lib/queries/organizationTerm";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("i18n-organizations - słownik po imporcie", () => {
  it("import rejestruje OBA języki - nagłówek błędu trasy i notka degradacji są tym samym zdaniem", () => {
    expect(i18n.getFixedT("pl")("organization.loadFailed")).toBe(
      "Nie udało się załadować profilu organizacji",
    );
    expect(i18n.getFixedT("en")("organization.loadFailed")).toBe(
      "Couldn't load the organization profile",
    );
  });

  it("licznik publikacji odmienia się po polsku przez trzy formy, po angielsku przez dwie", () => {
    const pl = i18n.getFixedT("pl");
    const en = i18n.getFixedT("en");
    expect(pl("organization.postsCount", { count: 1 })).toBe("1 publikacja");
    expect(pl("organization.postsCount", { count: 3 })).toBe("3 publikacje");
    expect(pl("organization.postsCount", { count: 5 })).toBe("5 publikacji");
    expect(pl("organization.postsCount", { count: 22 })).toBe("22 publikacje");
    expect(en("organization.postsCount", { count: 1 })).toBe("1 publication");
    expect(en("organization.postsCount", { count: 7 })).toBe("7 publications");
  });

  // Zdania `head()` (opis zastępczy, numer strony) NIE są kluczami nakładki:
  // `head()` nie ma `t()`, więc f8738e23 przeniósł je do `ORGANIZATION_PAGE_COPY`.
  // Asercja pyta to źródło; pytana o klucze i18n dostawała gołe klucze
  // (`organization.seoDescriptionFallback`) i była czerwona od scalenia obu zmian.
  it("zdania SEO interpolują nazwę i numer strony w obu językach", () => {
    expect(ORGANIZATION_PAGE_COPY.pl.descriptionFallback("NATO")).toBe(
      "NATO - profil organizacji w New European Strategies.",
    );
    expect(ORGANIZATION_PAGE_COPY.en.descriptionFallback("NATO")).toBe(
      "NATO - organization profile at New European Strategies.",
    );
    expect(ORGANIZATION_PAGE_COPY.en.pageLabel).toBe("page");
  });
});

describe("i18n-organizations - `ensureI18n()` (wzorzec pozostałych nakładek)", () => {
  it("jest idempotentne: kolejne wywołania nie scalają słownika po raz drugi", () => {
    const add = vi.spyOn(i18n, "addResourceBundle");
    ensureI18n();
    ensureI18n();
    expect(add).not.toHaveBeenCalled();
  });

  it("świeża ewaluacja modułu rejestruje słownik DOKŁADNIE raz na język", async () => {
    vi.resetModules();
    const { default: fresh } = await import("@/lib/i18n");
    const add = vi.spyOn(fresh, "addResourceBundle");
    const mod = await import("@/lib/i18n-organizations");
    mod.ensureI18n();

    const organizationCalls = add.mock.calls.filter(([, , resources]) =>
      Object.prototype.hasOwnProperty.call(resources, "organization"),
    );
    expect(organizationCalls.map(([lang]) => lang).sort()).toEqual(["en", "pl"]);
    // Ostatnie dwa argumenty: głębokie scalenie z nadpisaniem - jak w każdej nakładce.
    for (const call of organizationCalls) expect(call.slice(3)).toEqual([true, true]);
  });

  it("to `ensureI18n()` rejestruje słownik - nie jest pustą funkcją obok efektu importu", () => {
    // Treść funkcji, nie pliku: chodzi o to, czy WYWOŁANIE z trasy i komponentu
    // cokolwiek gwarantuje. Pusta funkcja daje `function ensureI18n() {\n}`.
    const body = String(ensureI18n);
    expect(body).toMatch(/addResourceBundle\(\s*["']pl["']/);
    expect(body).toMatch(/addResourceBundle\(\s*["']en["']/);
    expect(body).toMatch(/registered/);
  });
});

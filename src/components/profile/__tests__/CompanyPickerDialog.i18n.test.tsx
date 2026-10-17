// Dialog firmy na PUBLICZNYM /profile rozwiązuje KAŻDY swój klucz z rdzenia
// i własnego słownika `i18n-company` - bez nakładki panelu/CRM.
//
// PO CO. Do 2026-10-17 dialog rejestrował `i18n-admin-extras` (~19 KB gzip)
// dla gałęzi `company.*`, przez co cały słownik panelu liczył się do sumy
// PUBLIC `check:bundle`. Gałąź wyjechała do `i18n-company.ts`. Ten plik
// pilnuje obu stron tej zmiany naraz:
//   1. KRAWĘDŹ: import komponentu nie rejestruje żadnego słownika `i18n-admin-*`
//      (powrót importu nakładki panelu czerwieni test, zanim zrobi to bramka
//      rozmiaru na mainie, gdzie krok `check:bundle` w ogóle jedzie);
//   2. KLUCZE: każde `t()` z pliku dialogu (skan źródła, nie lista z ręki)
//      istnieje w PL i EN, a wyrenderowany dialog - wyszukiwanie i formularz
//      tworzenia - nie pokazuje gołego klucza w tekście ani w atrybutach.
// Testy zachowania (RPC, walidacja, dwa kroki tworzenia) są w
// `CompanyPickerDialog.test.tsx` - tam `react-i18next` jest atrapą, więc
// nie widzą, czy klucz w ogóle ma tłumaczenie.
import { readFileSync } from "node:fs";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/test/i18nReal";
import { scanTranslationCalls } from "@/lib/ci/i18nKeyUsage";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-me" }, tenantId: "tenant-alfa" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Ramka stosu pliku nakładki - ta sama atrybucja co w bramce integralności. */
const OVERLAY_FRAME = /\/src\/lib\/(i18n-[\w-]+)\.ts\b/;

const registered = new Set<string>();
const original = i18n.addResourceBundle.bind(i18n);
const previousLimit = Error.stackTraceLimit;
Error.stackTraceLimit = 50;
const spy = vi
  .spyOn(i18n, "addResourceBundle")
  .mockImplementation((lng, ns, resources, deep, overwrite) => {
    registered.add(OVERLAY_FRAME.exec(new Error().stack ?? "")?.[1] ?? "?");
    return original(lng, ns, resources, deep, overwrite);
  });
const { CompanyPickerDialog } = await import("@/components/profile/CompanyPickerDialog");
spy.mockRestore();
Error.stackTraceLimit = previousLimit;

const SOURCE_FILE = "src/components/profile/CompanyPickerDialog.tsx";
const usage = scanTranslationCalls(SOURCE_FILE, readFileSync(SOURCE_FILE, "utf8"));

/** Goły klucz w DOM: tekst albo atrybut z kropkowaną ścieżką `company.*`. */
const RAW_KEY = /\bcompany\.[A-Za-z][\w.]*/;

function rawKeysOnScreen(): string[] {
  const found: string[] = [];
  const text = document.body.textContent ?? "";
  const textHit = RAW_KEY.exec(text);
  if (textHit) found.push(`text: ${textHit[0]}`);
  for (const el of document.body.querySelectorAll("*")) {
    for (const attr of ["aria-label", "title", "placeholder", "aria-description"]) {
      const value = el.getAttribute(attr);
      if (value !== null && RAW_KEY.test(value)) found.push(`${attr}: ${value}`);
    }
  }
  return found;
}

/**
 * Klucz obecny W TYM języku - `getResource`, nie `exists`: `exists` przechodzi
 * przez `fallbackLng` („pl"), więc brak w EN chowałby się za polskim napisem.
 */
function hasOwnTranslation(lng: "pl" | "en", key: string): boolean {
  return typeof i18n.getResource(lng, "translation", key) === "string";
}

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

describe("CompanyPickerDialog - słowniki na publicznym /profile", () => {
  it("import dialogu rejestruje `i18n-company` i ŻADNEJ nakładki panelu", () => {
    expect(registered).toContain("i18n-company");
    expect([...registered].filter((name) => name.startsWith("i18n-admin-"))).toEqual([]);
    // Wartownik nakładki panelu/CRM: klucz, który ma TYLKO `i18n-admin-extras`.
    expect(i18n.exists("admin.analyticsPanel.embed.frameTitle")).toBe(false);
  });

  it("skan źródła widzi wywołania `t()` dialogu (kontrola narzędzia)", () => {
    const keys = usage.map((u) => u.key);
    expect(keys).toContain("company.pickTitle");
    expect(keys).toContain("company.fields.postalCode");
    expect(keys).toContain("company.toast.created");
    expect(usage.every((u) => u.kind === "literal")).toBe(true);
  });

  it.each(["pl", "en"] as const)("%s: każdy klucz dialogu ma tłumaczenie", (lng) => {
    const missing = [...new Set(usage.map((u) => u.key))].filter(
      (key) => !hasOwnTranslation(lng, key),
    );
    expect(missing).toEqual([]);
  });

  it.each(["pl", "en"] as const)(
    "%s: wyszukiwanie i formularz tworzenia nie pokazują gołych kluczy",
    async (lng) => {
      await i18n.changeLanguage(lng);
      renderWithQueryClient(
        <CompanyPickerDialog
          open={true}
          onOpenChange={vi.fn()}
          currentCompanyId="550e8400-e29b-41d4-a716-446655440000"
          currentCompanyName="Acme"
        />,
      );
      const t = i18n.getFixedT(lng);
      // Wyszukiwanie: tytuł, opis, placeholder, „brak dopasowań", odłączenie.
      expect(await screen.findByText(String(t("company.noMatches")))).toBeInTheDocument();
      expect(screen.getByText(String(t("company.detach")))).toBeInTheDocument();
      expect(rawKeysOnScreen()).toEqual([]);

      // Formularz tworzenia: osiem etykiet pól, „wróć" i „dodaj firmę".
      fireEvent.click(screen.getByText(String(t("company.createNamed", { name: "Acme" }))));
      expect(await screen.findByText(String(t("company.createTitle")))).toBeInTheDocument();
      expect(screen.getByText(String(t("company.fields.postalCode")))).toBeInTheDocument();
      expect(rawKeysOnScreen()).toEqual([]);
    },
  );
});

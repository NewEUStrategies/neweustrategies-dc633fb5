// Inline-edytor layoutu na PUBLICZNYM /author/<slug> rozwiązuje KAŻDY swój
// klucz z rdzenia i własnego słownika `i18n-expert-layout-editor` - bez
// słownika panelu `i18n-admin-layouts`.
//
// PO CO. Do 2026-10-17 edytor rejestrował `i18n-admin-layouts` dla etykiet
// współdzielonych z /admin/expert-layouts, więc słownik panelu był publiczny
// w grafie chunków (`check:bundle` liczy do PUBLIC każdy chunk osiągalny
// z trasy publicznej). Etykiety (`adminLayouts.expertLayouts.*`) mają dziś
// właściciela w słowniku edytora. Pułapka, którą ten plik zamyka: klucz sekcji
// jest SKŁADANY W LOCIE (`sections.${sectionKey}`), więc skan literałów go nie
// widzi - brak jednej sekcji to goły klucz na stronie eksperta, a żadna inna
// bramka tego nie złapie (dryf kluczy scala WSZYSTKIE nakładki naraz).
import { readFileSync } from "node:fs";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/test/i18nReal";
import { scanTranslationCalls } from "@/lib/ci/i18nKeyUsage";
import { EXPERT_SECTIONS } from "@/lib/expertLayouts";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { expertSettings } from "@/test/experts/fixtures";

vi.mock("@/hooks/useExpertLayoutSettings", () => ({
  useSaveExpertLayoutOverrides: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
const { default: ExpertLayoutInlineEditor } =
  await import("@/components/experts/ExpertLayoutInlineEditor");
spy.mockRestore();
Error.stackTraceLimit = previousLimit;

const SOURCE_FILE = "src/components/experts/ExpertLayoutInlineEditor.tsx";
const usage = scanTranslationCalls(SOURCE_FILE, readFileSync(SOURCE_FILE, "utf8"));

/** Goły klucz w DOM: kropkowana ścieżka gałęzi, które czyta edytor. */
const RAW_KEY = /\b(?:adminLayouts|expertLayoutEditor)\.[A-Za-z][\w.]*/;

function rawKeysOnScreen(): string[] {
  const found: string[] = [];
  const textHit = RAW_KEY.exec(document.body.textContent ?? "");
  if (textHit) found.push(`text: ${textHit[0]}`);
  for (const el of document.body.querySelectorAll("*")) {
    for (const attr of ["aria-label", "title", "placeholder"]) {
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

describe("ExpertLayoutInlineEditor - słowniki na publicznym /author/<slug>", () => {
  it("import edytora rejestruje słownik edytora i ŻADNEGO słownika panelu", () => {
    expect(registered).toContain("i18n-expert-layout-editor");
    expect([...registered].filter((name) => name.startsWith("i18n-admin-"))).toEqual([]);
    // Wartownik `i18n-admin-layouts`: klucz, którego edytor nie czyta.
    expect(i18n.exists("adminLayouts.postLayouts.pageTitle")).toBe(false);
  });

  it("skan źródła widzi literały i klucz sekcji składany w locie (kontrola narzędzia)", () => {
    const literal = usage.filter((u) => u.kind === "literal").map((u) => u.key);
    expect(literal).toContain("adminLayouts.expertLayouts.moveUp");
    expect(literal).toContain("expertLayoutEditor.open");
    expect(usage.filter((u) => u.kind !== "literal").map((u) => u.key)).toEqual([
      "adminLayouts.expertLayouts.sections",
    ]);
  });

  it.each(["pl", "en"] as const)("%s: każdy literał edytora ma tłumaczenie", (lng) => {
    const keys = usage.filter((u) => u.kind === "literal").map((u) => u.key);
    expect([...new Set(keys)].filter((key) => !hasOwnTranslation(lng, key))).toEqual([]);
  });

  it.each(["pl", "en"] as const)("%s: każda sekcja strony eksperta ma etykietę", (lng) => {
    // Pełna lista z `EXPERT_SECTIONS`, nie z kolejności tenanta: nowa sekcja
    // bez etykiety ma oblać tutaj, a nie dopiero u eksperta, który ją włączy.
    const missing = EXPERT_SECTIONS.map(
      (key) => `adminLayouts.expertLayouts.sections.${key}`,
    ).filter((key) => !hasOwnTranslation(lng, key));
    expect(missing).toEqual([]);
  });

  it.each(["pl", "en"] as const)("%s: otwarty panel nie pokazuje gołych kluczy", async (lng) => {
    await i18n.changeLanguage(lng);
    renderWithQueryClient(
      <ExpertLayoutInlineEditor
        expertId="11111111-1111-4111-8111-111111111111"
        tenantId="22222222-2222-4222-8222-222222222222"
        tenantSettings={expertSettings()}
        savedOverrides={{ accent_color: "#112233" }}
        onDraftChange={vi.fn()}
      />,
    );
    const t = i18n.getFixedT(lng);
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(String(t("expertLayoutEditor.open"))) }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(String(t("adminLayouts.expertLayouts.sections.hero_cover"))),
    ).toBeInTheDocument();
    expect(rawKeysOnScreen()).toEqual([]);
  });
});

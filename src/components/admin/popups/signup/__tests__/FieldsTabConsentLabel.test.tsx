// Zakładka „Pola" popupu rejestracji - etykieta zgody na newsletter (I9d-Y2).
//
// Etykieta pola „newsletter" JEST treścią zgody: domyślna (albo pusta) daje
// w popupie pełną treść zgody z pomiarem otwarć i kliknięć, WŁASNA zostaje
// bez wersji i nie obejmuje pomiaru. Zakładka mówi to ostrzeżeniem przy polu -
// rozstrzyga jedno źródło `isNewsletterConsentDefault`, nie szukanie słów.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: () => null,
}));
vi.mock("@/lib/icons/DynamicIcon", () => ({ DynamicIcon: () => null }));

import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { FieldsTab } from "@/components/admin/popups/signup/FieldsTab";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import "@/lib/i18n-admin-popup-signup";
import "@/lib/i18n-admin-measurement-hint";

h.fixedT = realT;

const WARNING = /Własna etykieta zgody na newsletter nie obejmuje pomiaru/;

function mount(labels: { pl?: string; en?: string } | null) {
  const value: NewsletterSettings = {
    ...defaultNewsletterSettings(),
    popup_fields:
      labels === null
        ? []
        : [{ key: "newsletter_optin", enabled: true, label_pl: labels.pl, label_en: labels.en }],
  } as NewsletterSettings;
  return render(<FieldsTab value={value} onChange={vi.fn()} />);
}

afterEach(cleanup);

describe("FieldsTab - etykieta zgody na newsletter", () => {
  it("etykieta domyślna (albo brak nadpisania) - bez ostrzeżenia", () => {
    mount(null);
    expect(screen.queryByText(WARNING)).toBeNull();
    cleanup();
    mount({ pl: "Chcę otrzymywać newsletter", en: "I want to receive the newsletter" });
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("własna etykieta (w którymkolwiek języku) - ostrzeżenie przy polu newslettera", async () => {
    const { container } = mount({ pl: "Tak, chcę analizy NES", en: "" });
    const note = screen.getByText(WARNING);
    expect(note.getAttribute("role")).toBe("note");
    // Ostrzeżenie stoi w bloku pola „newsletter", nie przy innych polach.
    const block = note.closest("div.rounded-md") as HTMLElement;
    expect(within(block).getAllByLabelText(/newsletter_optin$/)).toHaveLength(4);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

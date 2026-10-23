// Zakładka „Pola" popupu rejestracji - etykieta zgody na newsletter (I9d-Y2,
// I9d-Y2b).
//
// Wariant (b): etykieta pola „newsletter" jest treścią zgody na newsletter
// i NIE dotyczy pomiaru - pomiar ma osobne, domyślnie niezaznaczone pole.
// Dawne ostrzeżenie „własna etykieta nie obejmuje pomiaru" zniknęło: każda
// etykieta - domyślna i własna - jest poprawna bez pomiaru. Zostaje
// ostrzeżenie odwrotne (R1.24): własna etykieta, która WSPOMINA pomiar,
// wprowadzałaby czytelnika w błąd (opis pomiaru należy do osobnego pola).
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

const WARNING = /Własna etykieta zgody na newsletter wspomina pomiar otwarć i kliknięć/;
const OLD_WARNING = /nie obejmuje pomiaru/;

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

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

describe("FieldsTab - etykieta zgody na newsletter (wariant (b))", () => {
  it("etykieta domyślna (albo brak nadpisania) - bez ostrzeżenia", () => {
    mount(null);
    expect(screen.queryByText(WARNING)).toBeNull();
    cleanup();
    mount({ pl: "Chcę otrzymywać newsletter", en: "I want to receive the newsletter" });
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("własna etykieta BEZ opisu pomiaru - bez ostrzeżenia (dawnego „nie obejmuje pomiaru” też nie ma)", () => {
    mount({ pl: "Tak, chcę analizy NES", en: "" });
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(screen.queryByText(OLD_WARNING)).toBeNull();
    expect(document.querySelector("[data-measurement-warning]")).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "własna etykieta wspominająca pomiar (w którymkolwiek języku) - ostrzeżenie przy polu newslettera, axe (%s)",
    async (theme) => {
      if (theme === "dark") document.documentElement.classList.add("dark");
      const { container } = mount({
        pl: "Chcę newsletter",
        en: "I agree to the newsletter and the measurement of opens",
      });
      const note = screen.getByText(WARNING);
      expect(note.getAttribute("role")).toBe("note");
      expect(note.textContent).toMatch(/osobnego pola zgody na pomiar/);
      // Ostrzeżenie stoi w bloku pola „newsletter", nie przy innych polach.
      const block = note.closest("div.rounded-md") as HTMLElement;
      expect(within(block).getAllByLabelText(/newsletter_optin$/)).toHaveLength(4);
      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
    },
  );
});

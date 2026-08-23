// ZAKŁADKA "PRAWA STRONA" edytora popupu rejestracji - gałęzie, w które
// przemiał `signupPopupTabs.test.tsx` nie wchodzi.
//
// Tamten test przeciska KAŻDĄ kontrolkę każdej zakładki i pilnuje kompletności
// patcha `popup_design`. Zostają po nim dwie rzeczy nienaruszone, obie
// o widocznym skutku dla odwiedzającego:
//
//   1. IKONA PRZYCISKU CTA. Picker oddaje wybór osobną ścieżką (`onChange`
//      kontrolki `IconRow`), której przemiał nie dotyka. Niepodłączony picker
//      wygląda na ekranie jak działający - operator wybiera ikonę, widzi
//      podgląd, wychodzi, a przycisk w popupie zostaje bez ikony.
//   2. NOTA POD FORMULARZEM. Jedyne pole zakładki, które w bazie może być
//      PUSTE (`null`), a nie pustym napisem. Dwie pomyłki dają tu różne
//      skutki: brak `?? ""` wywala pole w React w tryb niekontrolowany
//      (operator nie może nic wpisać), a zapis `""` zamiast `null` zostawia
//      w popupie pusty akapit pod formularzem.
//
// Reguła i18n bez wyjątku: atrapa `t` oddaje KLUCZ, więc asercje celują
// w klucze tłumaczeń, nie w polskie copy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Picker ikon ciągnie katalog całej platformy - w teście zakładki wystarczy
// atrapa oddająca wybraną nazwę (ten sam wzorzec co w `controls.test.tsx`).
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({ value, onChange }: { value?: string; onChange: (v?: string) => void }) => (
    <div>
      <button type="button" aria-label="picker-wybierz" onClick={() => onChange("Star")}>
        {value ?? "brak"}
      </button>
      <button type="button" aria-label="picker-czysc" onClick={() => onChange(undefined)} />
    </div>
  ),
}));
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid="ikona">{name}</span>,
}));

import { FormTab } from "@/components/admin/popups/signup/FormTab";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";

function setup(overrides: Partial<NewsletterSettings> = {}) {
  const onChange = vi.fn();
  const patchForm = vi.fn();
  const noop = vi.fn();
  const value: NewsletterSettings = { ...defaultNewsletterSettings(), ...overrides };
  const view = render(
    <FormTab
      value={value}
      design={defaultPopupDesign()}
      onChange={onChange}
      patchPanel={noop}
      patchGallery={noop}
      patchForm={patchForm}
      patchLight={noop}
      patchControls={noop}
      setColorScheme={noop}
    />,
  );
  return { view, onChange, patchForm };
}

/** Pole dwujęzyczne jest opisane etykietą `<klucz> (PL|EN)`. */
function bilingual(key: string, side: "PL" | "EN"): HTMLElement {
  return screen.getByLabelText(`${key} (${side})`);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe("ikona przycisku CTA", () => {
  it("wybór ikony z pickera dojeżdża do dokumentu, a nie tylko do podglądu", () => {
    const { patchForm } = setup();
    fireEvent.click(screen.getByLabelText("picker-wybierz"));
    expect(patchForm).toHaveBeenCalledWith({ ctaIcon: "Star" });
  });

  it("wyczyszczenie wyboru zapisuje pustkę, żeby dało się cofnąć jednorazowe kliknięcie", () => {
    const { patchForm } = setup();
    fireEvent.click(screen.getByLabelText("picker-czysc"));
    expect(patchForm).toHaveBeenCalledWith({ ctaIcon: "" });
  });

  it("aktualna ikona jest widoczna w podglądzie zakładki", () => {
    setup();
    // `defaultPopupDesign()` startuje z ikoną `user-plus`.
    expect(screen.getByTestId("ikona")).toHaveTextContent("user-plus");
  });
});

// ---------------------------------------------------------------------------
describe("nota pod formularzem - jedyne pole zakładki, które bywa puste w bazie", () => {
  it("brak noty w bazie daje puste, ale EDYTOWALNE pole", () => {
    setup({ popup_note_pl: null, popup_note_en: null });
    expect(bilingual("adminPopupSignup.form.note", "PL")).toHaveValue("");
    expect(bilingual("adminPopupSignup.form.note", "EN")).toHaveValue("");
  });

  it("zapisana nota jest pokazana operatorowi w obu językach", () => {
    setup({ popup_note_pl: "Bez spamu.", popup_note_en: "No spam." });
    expect(bilingual("adminPopupSignup.form.note", "PL")).toHaveValue("Bez spamu.");
    expect(bilingual("adminPopupSignup.form.note", "EN")).toHaveValue("No spam.");
  });

  it("wpisana nota jedzie do zapisu jako tekst", () => {
    const { onChange } = setup({ popup_note_pl: null });
    fireEvent.change(bilingual("adminPopupSignup.form.note", "PL"), {
      target: { value: "Bez spamu." },
    });
    expect(onChange).toHaveBeenCalledWith({ popup_note_pl: "Bez spamu." });
  });

  it("skasowana nota jedzie jako PUSTKA, nie jako pusty napis", () => {
    // Pusty napis zostawiłby w popupie pusty akapit pod formularzem.
    const { onChange } = setup({ popup_note_pl: "Bez spamu.", popup_note_en: "No spam." });
    fireEvent.change(bilingual("adminPopupSignup.form.note", "PL"), { target: { value: "" } });
    fireEvent.change(bilingual("adminPopupSignup.form.note", "EN"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ popup_note_pl: null });
    expect(onChange).toHaveBeenCalledWith({ popup_note_en: null });
  });

  it("angielska nota jedzie osobnym kluczem - nie nadpisuje polskiej", () => {
    const { onChange } = setup({ popup_note_en: null });
    fireEvent.change(bilingual("adminPopupSignup.form.note", "EN"), {
      target: { value: "No spam." },
    });
    expect(onChange).toHaveBeenCalledWith({ popup_note_en: "No spam." });
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ popup_note_pl: expect.anything() }),
    );
  });
});

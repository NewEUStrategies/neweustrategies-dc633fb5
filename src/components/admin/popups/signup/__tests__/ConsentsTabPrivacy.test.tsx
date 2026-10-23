// Zakładka „Zgody" popupu rejestracji - pole „prywatność" (I9d-Y2b).
//
// Pole „prywatność" jest WYMAGANE, więc nie może nieść zgody na newsletter
// (art. 7 ust. 4 RODO - wariant (b): każda zgoda ma osobne pole). Dawniej
// puste pole spadało w edytorze na treść zgody na newsletter
// (`policy_html_*`) - operator widział ją jako treść pola prywatności i mógł
// ją zapisać. Teraz puste pole jest puste, a placeholder pokazuje domyślną
// akceptację polityki (`privacyAcceptanceHtml`) - tę, którą popup wyświetla.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { ConsentsTab } from "@/components/admin/popups/signup/ConsentsTab";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";
import { newsletterConsentHtml, privacyAcceptanceHtml } from "@/lib/newsletter/consentText";
import "@/lib/i18n-admin-popup-signup";

h.fixedT = realT;

function mount(over: Partial<NewsletterSettings> = {}) {
  const onChange = vi.fn();
  const value = {
    ...defaultNewsletterSettings(),
    policy_html_pl: newsletterConsentHtml("pl"),
    policy_html_en: newsletterConsentHtml("en"),
    popup_privacy_html_pl: null,
    popup_privacy_html_en: null,
    ...over,
  } as NewsletterSettings;
  const utils = render(
    <ConsentsTab
      value={value}
      design={defaultPopupDesign()}
      onChange={onChange}
      patchPanel={vi.fn()}
      patchGallery={vi.fn()}
      patchForm={vi.fn()}
      patchLight={vi.fn()}
      patchControls={vi.fn()}
      setColorScheme={vi.fn()}
    />,
  );
  return { ...utils, onChange };
}

/** Pola „prywatność" (PL, EN) - pierwsze dwa pola tekstowe zakładki. */
function privacyFields(): [HTMLTextAreaElement, HTMLTextAreaElement] {
  const areas = Array.from(document.querySelectorAll("textarea")) as HTMLTextAreaElement[];
  return [areas[0]!, areas[1]!];
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

describe("ConsentsTab - pole „prywatność” nie niesie zgody na newsletter", () => {
  it("puste pole jest PUSTE (bez spadania na treść zgody na newsletter), placeholder = akceptacja polityki", () => {
    mount();
    const [pl, en] = privacyFields();
    expect(pl.value).toBe("");
    expect(en.value).toBe("");
    expect(pl.getAttribute("placeholder")).toBe(privacyAcceptanceHtml("pl"));
    expect(en.getAttribute("placeholder")).toBe(privacyAcceptanceHtml("en"));
    expect(pl.getAttribute("placeholder")).not.toBe(newsletterConsentHtml("pl"));
  });

  it("własna treść pola pokazuje się bez zmian; wyczyszczenie zapisuje `null`", () => {
    const own = 'Akceptuję <a href="/regulamin">regulamin</a> i politykę prywatności.';
    const { onChange } = mount({ popup_privacy_html_pl: own });
    const [pl] = privacyFields();
    expect(pl.value).toBe(own);
    fireEvent.change(pl, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ popup_privacy_html_pl: null });
  });

  it.each(["light", "dark"] as const)("brak naruszeń axe (%s)", async (theme) => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    const { container } = mount();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThanOrEqual(2);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

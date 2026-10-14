// Molekuła „Sprawdź skrzynkę" - ekran po zapisie dla każdego, kto NIE jest
// zweryfikowanym właścicielem adresu (REG-04, decyzja D3).
//
// CO TEN PLIK DOWODZI.
//   1. EKRAN MÓWI TYLKO TO, CO UCZESTNIK SAM WPISAŁ: adres z formularza i
//      prośbę o sprawdzenie skrzynki. Nic o statusie, kolejce ani kluczu -
//      to samo zdanie pada dla nowego zapisu i dla adresu, który już ma
//      zgłoszenie, więc ekran nie zdradza, czy adres jest na liście.
//   2. ZGODY DO POTWIERDZENIA MAJĄ WŁASNE ZDANIE wyłącznie wtedy, gdy uczestnik
//      coś zaznaczył (double opt-in, D5) - inaczej drugi mail wyglądałby na spam.
//   3. TREŚCI SĄ W OBU JĘZYKACH - zdania czytamy z PRAWDZIWEGO słownika, bo
//      to jedyny ekran, na którym uczestnik dowiaduje się, co dalej.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RegistrationCheckEmail } from "@/components/events/registration/molecules/RegistrationCheckEmail";

const EMAIL = "anna.kowalska@example.com";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("RegistrationCheckEmail", () => {
  it("pokazuje wpisany adres i prośbę o sprawdzenie skrzynki - bez statusu i klucza", async () => {
    await i18n.changeLanguage("pl");
    render(<RegistrationCheckEmail email={EMAIL} consentPending={false} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      i18n.t("eventRegistration.result.checkEmailTitle"),
    );
    expect(screen.getByText(new RegExp(EMAIL.replace(/\./g, "\\.")))).toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t("eventRegistration.result.checkEmailConsent")),
    ).not.toBeInTheDocument();
    // Ekran nie mówi ani „zapisano", ani „lista rezerwowa" - te zdania
    // zdradzałyby wynik zapisu komuś, kto nie udowodnił, że adres jest jego.
    for (const key of ["approved", "pending", "waitlist", "cancelled"] as const) {
      expect(
        screen.queryByText(i18n.t(`eventRegistration.result.${key}`, { position: 1 })),
      ).not.toBeInTheDocument();
    }
  });

  it("zaznaczona zgoda zapowiada osobny mail do potwierdzenia", async () => {
    await i18n.changeLanguage("pl");
    render(<RegistrationCheckEmail email={EMAIL} consentPending />);

    expect(
      screen.getByText(i18n.t("eventRegistration.result.checkEmailConsent")),
    ).toBeInTheDocument();
  });

  it("po angielsku mówi po angielsku", async () => {
    await i18n.changeLanguage("en");
    render(<RegistrationCheckEmail email={EMAIL} consentPending />);

    const title = i18n.t("eventRegistration.result.checkEmailTitle");
    expect(title).not.toBe("eventRegistration.result.checkEmailTitle");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(title);
    expect(screen.getByText(i18n.t("eventRegistration.result.checkEmailHint"))).toBeInTheDocument();
  });

  it("ogłasza się czytnikom ekranu i nie ma naruszeń dostępności", async () => {
    const { container } = render(<RegistrationCheckEmail email={EMAIL} consentPending />);

    const region = container.querySelector("section");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-labelledby", "registration-check-email-title");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

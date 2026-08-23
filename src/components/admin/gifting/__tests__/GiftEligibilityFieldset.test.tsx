// Molekuła bramki uprawnienia gifting - KTO WYGENERUJE LINK DO PŁATNEJ TREŚCI.
//
// CO TEN PLIK DOWODZI.
//   1. WYBÓR JEST RADIOGROUPĄ O WSPÓLNYM `name`, nie dwoma niezależnymi
//      checkboxami. To nie kosmetyka: dwa pola bez wspólnego `name` dałyby się
//      zaznaczyć RAZEM, a wtedy „kto może udostępniać" przestaje być jedną
//      decyzją. Przeglądarka wymusza rozłączność wyłącznie po `name`, czego ani
//      tsc, ani lint nie sprawdzi.
//   2. KOLEJNOŚĆ OPCJI POCHODZI Z `GIFT_ELIGIBILITY_OPTIONS` - z produkcji, nie
//      z listy wpisanej w teście. Dopisanie trzeciej opcji w libie ma zapalić
//      ten test, a nie przejść niezauważone.
//   3. KAŻDA OPCJA MA ETYKIETĘ *I* PODPOWIEDŹ (`.label` + `.hint`), bo różnica
//      między „zarejestrowani" a „subskrybenci" jest różnicą przychodu, nie
//      niuansem nazewniczym.
//   4. ZMIANA ODDAJE WARTOŚĆ OPCJI wołającemu (molekuła nie trzyma stanu) -
//      to ta wartość jedzie potem w payloadzie zapisu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Normalizacji wartości z bazy
// (`normalizeGiftEligibility`) - to `lib/gifting/__tests__/model.test.ts`.
// Tego, że wybór dojeżdża do server fn - to `GiftSettingsPanel.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));

import { GiftEligibilityFieldset } from "@/components/admin/gifting/molecules/GiftEligibilityFieldset";
import { GIFT_ELIGIBILITY_OPTIONS } from "@/lib/gifting/admin-model";

function bramka(value: "registered" | "subscribers" = "registered") {
  const onChange = vi.fn();
  render(<GiftEligibilityFieldset value={value} onChange={onChange} />);
  return { onChange, radia: screen.getAllByRole("radio") as HTMLInputElement[] };
}

describe("bramka uprawnienia gifting", () => {
  it("renderuje opcje w kolejności z GIFT_ELIGIBILITY_OPTIONS", () => {
    const { radia } = bramka();

    expect(radia.map((r) => r.value)).toEqual([...GIFT_ELIGIBILITY_OPTIONS]);
  });

  it("wszystkie opcje dzielą jeden `name`, więc wykluczają się wzajemnie", () => {
    const { radia } = bramka();

    expect(new Set(radia.map((r) => r.name))).toEqual(new Set(["gift-admin-eligibility"]));
  });

  it("zaznaczona jest DOKŁADNIE jedna opcja - ta przekazana propsem", () => {
    const { radia } = bramka("subscribers");

    expect(radia.filter((r) => r.checked).map((r) => r.value)).toEqual(["subscribers"]);
  });

  it("każda opcja ma etykietę I podpowiedź (różnica przychodu, nie niuans nazwy)", () => {
    bramka();

    for (const option of GIFT_ELIGIBILITY_OPTIONS) {
      expect(
        screen.getByText(`giftingAdmin.settings.eligibilityOptions.${option}.label`),
      ).toBeTruthy();
      expect(
        screen.getByText(`giftingAdmin.settings.eligibilityOptions.${option}.hint`),
      ).toBeTruthy();
    }
  });

  it("zmiana oddaje WARTOŚĆ opcji, a nie indeks ani etykietę", () => {
    const { onChange, radia } = bramka("registered");

    fireEvent.click(radia[1]);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("subscribers");
  });

  it("ponowny wybór już wybranej opcji nie wywołuje zmiany", () => {
    const { onChange, radia } = bramka("registered");

    fireEvent.click(radia[0]);

    expect(onChange).not.toHaveBeenCalled();
  });
});

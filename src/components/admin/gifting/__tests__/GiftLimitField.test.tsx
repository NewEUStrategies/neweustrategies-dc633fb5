// Molekuła pola limitu w ustawieniach gifting - CZY PUSTE POLE MOŻE ZOSTAĆ ZEREM.
//
// CO TEN PLIK DOWODZI.
//   1. WYCZYSZCZENIE POLA ODDAJE `null`, NIE `0`. W tej domenie 0 znaczy „bez
//      limitu", czyli obejście paywalla: gdyby skasowanie wartości cicho dawało
//      zero, admin poprawiający literówkę wyłączyłby limit miesięczny całego
//      tenanta. `parseGiftAdminLimitInput` ma własny test w
//      `lib/gifting/__tests__/admin-model.test.ts` - tutaj dowodzimy, że
//      FORMULARZ go faktycznie używa, a nie `Number(e.target.value) || 0`.
//   2. ATRYBUTY min/max POCHODZĄ Z `GIFT_ADMIN_BOUNDS`, a nie z liczb wpisanych
//      z ręki. To ta sama tabela, którą czyta walidator zod server fn i CHECK w
//      bazie; ręczne 1000 w markupie rozjechałoby się bez żadnego sygnału.
//   3. KOMUNIKAT BŁĘDU ZASTĘPUJE PODPOWIEDŹ, nie staje obok niej (jeden akapit,
//      jedno `aria-describedby`), a pole dostaje `aria-invalid` - inaczej
//      czytnik ekranu czyta podpowiedź jako obowiązującą.
//   4. OSTRZEŻENIE O ZERZE POJAWIA SIĘ TYLKO TAM, GDZIE JE PODANO, i tylko gdy
//      pole nie ma błędu (`role="alert"` przy błędnym polu byłby drugim,
//      sprzecznym komunikatem).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Samych zakresów i semantyki walidacji - to
// `src/lib/gifting/__tests__/admin-model.test.ts`. Bramki zapisu (kiedy przycisk
// jest martwy) - to `GiftSettingsPanel.test.tsx`.
//
// Atrapa i18n: `@/test/i18nStub` (echo klucza z parametrami), bo asercja ma
// mierzyć DOBÓR klucza i przekazane granice, nie polszczyznę słownika.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));

import { GiftLimitField } from "@/components/admin/gifting/molecules/GiftLimitField";
import { GIFT_ADMIN_BOUNDS } from "@/lib/gifting/admin-model";

function pole(
  opcje: {
    field?: "monthly_limit" | "link_ttl_days" | "max_redemptions_per_link";
    value?: number | null;
    issue?: "required" | "range";
    zeroWarning?: string;
  } = {},
) {
  const onChange = vi.fn();
  const field = opcje.field ?? "monthly_limit";
  const widok = render(
    <GiftLimitField
      field={field}
      label="Limit miesięczny"
      hint="Podpowiedź"
      value={opcje.value === undefined ? 10 : opcje.value}
      issue={opcje.issue}
      zeroWarning={opcje.zeroWarning}
      onChange={onChange}
    />,
  );
  return {
    onChange,
    unmount: widok.unmount,
    input: screen.getByLabelText("Limit miesięczny") as HTMLInputElement,
  };
}

describe("pole limitu ustawień gifting", () => {
  it("wyczyszczenie pola oddaje NULL, a nie ciche zero", () => {
    const { onChange, input } = pole({ value: 10 });

    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it("wpisane zero oddaje ZERO - „bez limitu” jest legalną decyzją admina", () => {
    const { onChange, input } = pole({ value: 10 });

    fireEvent.change(input, { target: { value: "0" } });

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("ułamek jest obcinany do liczby całkowitej, bo limity są całkowite", () => {
    const { onChange, input } = pole({ value: 10 });

    fireEvent.change(input, { target: { value: "7.9" } });

    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("null pokazuje pole PUSTE, nie zero", () => {
    const { input } = pole({ value: null });

    expect(input.value).toBe("");
  });

  it("min i max w markupie to DOKŁADNIE GIFT_ADMIN_BOUNDS pola", () => {
    for (const field of ["monthly_limit", "link_ttl_days", "max_redemptions_per_link"] as const) {
      const { input, unmount } = pole({ field });
      expect(input.getAttribute("min")).toBe(String(GIFT_ADMIN_BOUNDS[field].min));
      expect(input.getAttribute("max")).toBe(String(GIFT_ADMIN_BOUNDS[field].max));
      expect(input.getAttribute("step")).toBe("1");
      unmount();
    }
  });

  it("błąd zakresu ZASTĘPUJE podpowiedź i podaje granice pola", () => {
    const { input } = pole({ field: "link_ttl_days", value: 366, issue: "range" });

    expect(screen.getByText("giftingAdmin.settings.errors.range(max=365,min=0)")).toBeTruthy();
    expect(screen.queryByText("Podpowiedź")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("gift-admin-link_ttl_days-message");
  });

  it("brak wartości to „wymagane”, a nie błąd zakresu", () => {
    pole({ value: null, issue: "required" });

    expect(screen.getByText("giftingAdmin.settings.errors.required(max=1000,min=0)")).toBeTruthy();
  });

  it("poprawne pole NIE ma aria-invalid i pokazuje podpowiedź", () => {
    const { input } = pole({ value: 10 });

    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("Podpowiedź")).toBeTruthy();
  });

  it("zero zapala ostrzeżenie role=alert TYLKO w polu, które je dostało", () => {
    pole({ field: "max_redemptions_per_link", value: 0, zeroWarning: "UWAGA BEZ LIMITU" });

    expect(screen.getByRole("alert").textContent).toBe("UWAGA BEZ LIMITU");
  });

  it("pole bez zeroWarning nie ostrzega przy zerze (limit miesięczny 0 jest cichy)", () => {
    pole({ field: "monthly_limit", value: 0 });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ostrzeżenie o zerze USTĘPUJE komunikatowi błędu - nigdy dwa naraz", () => {
    pole({
      field: "max_redemptions_per_link",
      value: 0,
      issue: "range",
      zeroWarning: "UWAGA BEZ LIMITU",
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("giftingAdmin.settings.errors.range(max=100000,min=0)")).toBeTruthy();
  });
});

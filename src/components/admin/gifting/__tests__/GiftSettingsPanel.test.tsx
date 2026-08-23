// Organizm formularza ustawień gifting - CZEGO PANEL NIE POZWOLI WYSŁAĆ.
//
// CO TEN PLIK DOWODZI.
//   1. FORMULARZ RESPEKTUJE `GIFT_ADMIN_BOUNDS` PRZED WYSŁANIEM: wartość poza
//      zakresem czyni przycisk martwym i ZERO wywołań server fn. Zakresy same
//      mają test w `lib/gifting/__tests__/admin-model.test.ts` - tutaj dowodzimy,
//      że FORMULARZ ich faktycznie słucha, a nie liczy na walidator zod po
//      drugiej stronie sieci (który zwróciłby surowy błąd zod jako toast).
//   2. PUSTE POLE NIE JEDZIE JAKO ZERO. W tej domenie 0 znaczy „bez limitu",
//      więc ciche zero po skasowaniu wartości byłoby wyłączeniem paywalla przez
//      literówkę. Dowodem jest brak wywołania `updateGiftAdminSettings`, a nie
//      sam komunikat pod polem.
//   3. TENANT BEZ ZAPISANYCH USTAWIEŃ WIDZI EFEKTYWNE DOMYŚLNE BAZY (10/30/5,
//      włączone, „registered") - nie zera. Panel z zerami skłoniłby admina do
//      „naprawiania" ustawień, które nie są zepsute, a jedno kliknięcie utrwala
//      to, co i tak już obowiązuje (dlatego zapis jest wtedy aktywny BEZ edycji).
//   4. SUKCES ZAPISU UNIEWAŻNIA DOKŁADNIE JEDEN KLUCZ CACHE (`gift-admin/settings`)
//      i czyści draft; BŁĄD pokazuje komunikat serwera i ZOSTAWIA wpisaną wartość
//      (admin nie traci pracy przez nieudany zapis).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Markupu pola limitu, `aria-invalid` i ostrzeżenia
// o zerze - to `GiftLimitField.test.tsx`. Radiogrupy uprawnienia -
// `GiftEligibilityFieldset.test.tsx`. Schematu zod server fn -
// `src/lib/__tests__/giftingAdminFunctions.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminSettings: h.getSettings,
  updateGiftAdminSettings: h.updateSettings,
}));

import { GiftSettingsPanel } from "@/components/admin/gifting/organisms/GiftSettingsPanel";
import { DEFAULT_GIFT_ADMIN_SETTINGS, GIFT_ADMIN_BOUNDS } from "@/lib/gifting/admin-model";

/** Wiersz zapisany w bazie - wartości brane Z PRODUKCJI, nie przepisane z ręki. */
const ZAPISANE = {
  ...DEFAULT_GIFT_ADMIN_SETTINGS,
  updated_at: "2026-08-01T10:00:00.000Z",
  updated_by: "11111111-1111-4111-8111-111111111111",
  persisted: true,
};

/** Brak wiersza: server fn oddaje efektywne domyślne bazy z `persisted: false`. */
const BRAK_WIERSZA = {
  ...DEFAULT_GIFT_ADMIN_SETTINGS,
  updated_at: null,
  updated_by: null,
  persisted: false,
};

const zapisz = () => screen.getByRole("button", { name: "giftingAdmin.settings.save" });
const limit = () => screen.getByLabelText("giftingAdmin.settings.monthlyLimit") as HTMLInputElement;
const ttl = () => screen.getByLabelText("giftingAdmin.settings.ttl") as HTMLInputElement;
const cap = () => screen.getByLabelText("giftingAdmin.settings.cap") as HTMLInputElement;

async function panel(settings: unknown = ZAPISANE) {
  h.getSettings.mockResolvedValue(settings);
  const widok = renderWithQueryClient(<GiftSettingsPanel />);
  await screen.findByLabelText("giftingAdmin.settings.monthlyLimit");
  return widok;
}

beforeEach(() => {
  h.getSettings.mockReset();
  h.updateSettings.mockReset();
  h.updateSettings.mockResolvedValue({ ok: true });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("ustawienia gifting: granice przed wysłaniem", () => {
  it("wartość ponad maksimum czyni zapis MARTWYM i nie wysyła nic na serwer", async () => {
    await panel();

    fireEvent.change(limit(), {
      target: { value: String(GIFT_ADMIN_BOUNDS.monthly_limit.max + 1) },
    });

    expect(zapisz()).toBeDisabled();
    fireEvent.click(zapisz());
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText("giftingAdmin.settings.errors.range(max=1000,min=0)")).toBeTruthy();
  });

  it("TTL ponad rok blokuje zapis (własny zakres pola, nie wspólny)", async () => {
    await panel();

    fireEvent.change(ttl(), { target: { value: String(GIFT_ADMIN_BOUNDS.link_ttl_days.max + 1) } });

    expect(zapisz()).toBeDisabled();
    expect(screen.getByText("giftingAdmin.settings.errors.range(max=365,min=0)")).toBeTruthy();
  });

  it("budżet otwarć ponad maksimum blokuje zapis", async () => {
    await panel();

    fireEvent.change(cap(), {
      target: { value: String(GIFT_ADMIN_BOUNDS.max_redemptions_per_link.max + 1) },
    });

    expect(zapisz()).toBeDisabled();
    fireEvent.click(zapisz());
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("PUSTE pole to „wymagane”, a NIE ciche zero - nic nie jedzie na serwer", async () => {
    await panel();

    fireEvent.change(limit(), { target: { value: "" } });

    expect(limit().value).toBe("");
    expect(screen.getByText("giftingAdmin.settings.errors.required(max=1000,min=0)")).toBeTruthy();
    expect(zapisz()).toBeDisabled();
    fireEvent.click(zapisz());
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("wpisane ZERO jest legalne i jedzie jako zero (świadome „bez limitu”)", async () => {
    await panel();

    fireEvent.change(cap(), { target: { value: "0" } });

    // Zero jest OSTRZEŻENIEM, nie błędem - zapis zostaje dozwolony.
    expect(screen.getByRole("alert").textContent).toBe("giftingAdmin.settings.capZeroWarning");
    fireEvent.click(zapisz());

    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    expect(h.updateSettings.mock.calls[0][0]).toEqual({
      data: { ...DEFAULT_GIFT_ADMIN_SETTINGS, max_redemptions_per_link: 0 },
    });
  });

  it("brak zmian przy istniejącym wierszu = zapis nieaktywny", async () => {
    await panel();

    expect(zapisz()).toBeDisabled();
  });
});

describe("ustawienia gifting: tenant bez zapisanego wiersza", () => {
  it("pokazuje EFEKTYWNE DOMYŚLNE bazy (10/30/5 + registered), a nie zera", async () => {
    await panel(BRAK_WIERSZA);

    expect(limit().value).toBe(String(DEFAULT_GIFT_ADMIN_SETTINGS.monthly_limit));
    expect(ttl().value).toBe(String(DEFAULT_GIFT_ADMIN_SETTINGS.link_ttl_days));
    expect(cap().value).toBe(String(DEFAULT_GIFT_ADMIN_SETTINGS.max_redemptions_per_link));
    expect(limit().value).not.toBe("0");
    const zaznaczone = (screen.getAllByRole("radio") as HTMLInputElement[]).filter(
      (r) => r.checked,
    );
    expect(zaznaczone.map((r) => r.value)).toEqual([DEFAULT_GIFT_ADMIN_SETTINGS.eligibility]);
  });

  it("mówi WPROST, że to domyślne, i nie kłamie o „ostatniej zmianie”", async () => {
    await panel(BRAK_WIERSZA);

    expect(screen.getByText("giftingAdmin.settings.defaultsNotice")).toBeTruthy();
    expect(screen.queryByText(/giftingAdmin\.settings\.updatedAt/)).toBeNull();
  });

  it("zapis jest AKTYWNY bez żadnej edycji i utrwala dokładnie te domyślne", async () => {
    await panel(BRAK_WIERSZA);

    expect(zapisz()).not.toBeDisabled();
    fireEvent.click(zapisz());

    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    expect(h.updateSettings.mock.calls[0][0]).toEqual({ data: DEFAULT_GIFT_ADMIN_SETTINGS });
  });

  it("zapisany wiersz BEZ znacznika czasu nie zmyśla „ostatniej zmiany”", async () => {
    // Wiersz istnieje (persisted), ale kolumna `updated_at` jest pusta - panel
    // ma wtedy milczeć, a nie pokazywać „Invalid Date”.
    await panel({ ...ZAPISANE, updated_at: null });

    expect(screen.queryByText(/giftingAdmin\.settings\.updatedAt/)).toBeNull();
    expect(screen.queryByText("giftingAdmin.settings.defaultsNotice")).toBeNull();
  });

  it("istniejący wiersz pokazuje notę o ostatniej zmianie, a NIE notę o domyślnych", async () => {
    await panel();

    expect(screen.queryByText("giftingAdmin.settings.defaultsNotice")).toBeNull();
    expect(screen.getByText(/giftingAdmin\.settings\.updatedAt/)).toBeTruthy();
  });
});

describe("ustawienia gifting: co robi z odpowiedzią", () => {
  it("sukces potwierdza toastem i unieważnia DOKŁADNIE klucz ustawień", async () => {
    const { queryClient } = await panel(BRAK_WIERSZA);
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(zapisz());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("giftingAdmin.settings.saved"));
    expect(szpieg).toHaveBeenCalledTimes(1);
    expect(szpieg).toHaveBeenCalledWith({ queryKey: ["gift-admin", "settings"] });
  });

  it("po sukcesie draft jest wyczyszczony - zapis znowu wymaga realnej zmiany", async () => {
    await panel();

    fireEvent.change(limit(), { target: { value: "7" } });
    expect(zapisz()).not.toBeDisabled();
    fireEvent.click(zapisz());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(zapisz()).toBeDisabled());
    expect(limit().value).toBe(String(DEFAULT_GIFT_ADMIN_SETTINGS.monthly_limit));
  });

  it("błąd zapisu pokazuje KOMUNIKAT SERWERA i ZOSTAWIA wpisaną wartość", async () => {
    h.updateSettings.mockRejectedValue(
      new Error("permission denied for table gift_article_settings"),
    );
    await panel();

    fireEvent.change(limit(), { target: { value: "7" } });
    fireEvent.click(zapisz());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "permission denied for table gift_article_settings",
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(limit().value).toBe("7");
  });

  it("wybór węższej bramki uprawnienia dojeżdża do payloadu", async () => {
    await panel();

    fireEvent.click((screen.getAllByRole("radio") as HTMLInputElement[])[1]);
    fireEvent.click(zapisz());

    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    expect(h.updateSettings.mock.calls[0][0]).toEqual({
      data: { ...DEFAULT_GIFT_ADMIN_SETTINGS, eligibility: "subscribers" },
    });
  });

  it("wyłączenie funkcji jedzie jako enabled:false, a nie jako brak pola", async () => {
    await panel();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(zapisz());

    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    expect(h.updateSettings.mock.calls[0][0]).toEqual({
      data: { ...DEFAULT_GIFT_ADMIN_SETTINGS, enabled: false },
    });
  });

  it("odczyt ustawień w locie pokazuje komunikat, a nie pusty formularz", () => {
    h.getSettings.mockReturnValue(new Promise(() => undefined));
    renderWithQueryClient(<GiftSettingsPanel />);

    expect(screen.getByText("giftingAdmin.common.loading")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

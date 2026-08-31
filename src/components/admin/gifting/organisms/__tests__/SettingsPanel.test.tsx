// Organizm: zakladka USTAWIENIA panelu prezentow.
//
// PO CO TEN PLIK ISTNIEJE. To jest formularz, ktory ustawia REGULY OBEJSCIA
// PAYWALLA dla calego tenanta: kto moze wygenerowac link, ile linkow miesiecznie,
// jak dlugo dziala i ilu NOWYCH ludzi otworzy z niego platny artykul. Kazde
// z tych pol ma stan "0", ktory NIE znaczy "zero", tylko "bez limitu" - wiec
// najgrozniejsze bledy tego ekranu nie wygladaja jak bledy:
//
//   1. ZAPIS PUSTEGO POLA JAKO ZERA. Skasowanie zawartosci i klikniecie
//      "Zapisz" nie moze utrwalic "bez limitu". Bramka stoi na
//      `draftToGiftAdminSettings` (null -> brak ladunku) i na wylaczonym
//      przycisku - dowodzimy OBU, bo kazda z nich osobno jest do usuniecia
//      jednym "uproszczeniem".
//   2. ZAPIS BEZ ZMIAN przy istniejacym wierszu - to jest jedyny powod,
//      dla ktorego przycisk bywa nieaktywny mimo poprawnego formularza;
//      pomylenie tego z "formularz niepoprawny" myli admina.
//   3. TENANT BEZ WIERSZA. Wtedy panel pokazuje EFEKTYWNE DOMYSLNE i zapis
//      MUSI byc dozwolony mimo braku zmian - inaczej pierwszego zapisu nie
//      da sie wykonac nigdy, a panel do konca zycia klamie, ze ustawienia sa.
//   4. ODMOWA ZAPISU NIE MOZE CZYSCIC DRAFTU - admin traci wpisane liczby
//      razem z komunikatem.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Reguly parsowania i walidacji pola - maja
// wlasny plik (`lib/gifting/__tests__/admin-model.test.ts`) i wlasny test
// molekuly (`molecules/__tests__/LimitField.test.tsx`). (2) Parytetu liczb
// z CHECK-ami bazy (`lib/gifting/__tests__/dbEnumParity.test.ts`).
//
// ATRAPY: granice - server fn, `useServerFn`, i18n, toast. `admin-model`
// i `LimitField` biegna PRAWDZIWE: to sasiedzi, a nie granice, i to na nich
// stoi cala semantyka "0 = bez limitu".
//
// RODO: same UUID-y, zero danych osobowych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import type { GiftAdminSettings } from "@/lib/gifting/admin-model";
import type { GiftAdminSettingsRow } from "@/lib/gifting-admin.functions";

const h = vi.hoisted(() => ({
  lang: "pl",
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminSettings: (...args: unknown[]) => h.getSettings(...args),
  updateGiftAdminSettings: (...args: unknown[]) => h.updateSettings(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => h.toastSuccess(...args),
    error: (...args: unknown[]) => h.toastError(...args),
  },
}));

const { SettingsPanel } = await import("@/components/admin/gifting/organisms/SettingsPanel");

function row(overrides: Partial<GiftAdminSettingsRow> = {}): GiftAdminSettingsRow {
  return {
    enabled: true,
    monthly_limit: 10,
    link_ttl_days: 30,
    max_redemptions_per_link: 5,
    eligibility: "registered",
    updated_at: "2026-08-01T10:30:00.000Z",
    updated_by: "00000000-0000-4000-8000-000000000001",
    persisted: true,
    ...overrides,
  };
}

const field = {
  monthly: () => document.getElementById("gift-admin-monthly_limit") as HTMLInputElement,
  ttl: () => document.getElementById("gift-admin-link_ttl_days") as HTMLInputElement,
  cap: () => document.getElementById("gift-admin-max_redemptions_per_link") as HTMLInputElement,
};

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "giftingAdmin.settings.save" }) as HTMLButtonElement;
}

/** Renderuje panel i czeka, az wyjdzie ze stanu ladowania. */
async function renderPanel() {
  const utils = renderWithQueryClient(<SettingsPanel />);
  await waitFor(() => expect(saveButton()).toBeTruthy());
  return utils;
}

/** Ladunek przekazany do server fn zapisu w ostatnim wywolaniu. */
function lastPayload(): GiftAdminSettings {
  const call = h.updateSettings.mock.calls.at(-1);
  return (call?.[0] as { data: GiftAdminSettings }).data;
}

beforeEach(() => {
  h.lang = "pl";
  h.getSettings.mockReset();
  h.updateSettings.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.updateSettings.mockResolvedValue({ ok: true });
});

describe("SettingsPanel - stan ladowania", () => {
  it("pokazuje komunikat ladowania, zanim ustawienia dojda", () => {
    h.getSettings.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<SettingsPanel />);
    expect(screen.getByText("giftingAdmin.common.loading")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("odmowa odczytu NIE pokazuje formularza z wymyslonymi domyslnymi", async () => {
    // Formularz narysowany na domyslnych po awarii odczytu kusi do zapisu,
    // ktory NADPISALBY prawdziwe ustawienia tenanta.
    h.getSettings.mockRejectedValue(new Error("Forbidden"));
    renderWithQueryClient(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.common.loading")).toBeTruthy());
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SettingsPanel - draft vs zapisane", () => {
  it("bez zmian przy istniejacym wierszu przycisk zapisu jest NIEAKTYWNY", async () => {
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    expect(saveButton().disabled).toBe(true);
  });

  it("zmiana pola odblokowuje zapis", async () => {
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("powrot do wartosci zapisanej znowu blokuje zapis", async () => {
    // `giftAdminSettingsEqual` porownuje WARTOSCI, nie fakt dotkniecia pola -
    // inaczej panel oferowalby zapis identycznego wiersza.
    h.getSettings.mockResolvedValue(row({ monthly_limit: 10 }));
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.change(field.monthly(), { target: { value: "10" } });
    expect(saveButton().disabled).toBe(true);
  });

  it("draft przezywa zmiany innych pol (nie resetuje sie po kazdym wpisie)", async () => {
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.change(field.ttl(), { target: { value: "7" } });
    expect(field.monthly().value).toBe("25");
    expect(field.ttl().value).toBe("7");
  });

  it("przelacznik 'funkcja wlaczona' tez jest zmiana", async () => {
    h.getSettings.mockResolvedValue(row({ enabled: true }));
    await renderPanel();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(saveButton().disabled).toBe(false);
  });

  it("zmiana bramki uprawnienia tez jest zmiana", async () => {
    h.getSettings.mockResolvedValue(row({ eligibility: "registered" }));
    await renderPanel();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    fireEvent.click(radios[1]);
    expect(saveButton().disabled).toBe(false);
  });

  it("pola startuja z wartosci ZAPISANYCH, nie z domyslnych modelu", async () => {
    h.getSettings.mockResolvedValue(
      row({ monthly_limit: 3, link_ttl_days: 1, max_redemptions_per_link: 99 }),
    );
    await renderPanel();
    expect(field.monthly().value).toBe("3");
    expect(field.ttl().value).toBe("1");
    expect(field.cap().value).toBe("99");
  });
});

describe("SettingsPanel - tenant BEZ zapisanego wiersza", () => {
  it("pokazuje note o wartosciach domyslnych", async () => {
    h.getSettings.mockResolvedValue(row({ persisted: false, updated_at: null }));
    await renderPanel();
    expect(screen.getByText("giftingAdmin.settings.defaultsNotice")).toBeTruthy();
  });

  it("zapis jest dozwolony MIMO braku zmian (pierwsze utrwalenie)", async () => {
    h.getSettings.mockResolvedValue(row({ persisted: false, updated_at: null }));
    await renderPanel();
    expect(saveButton().disabled).toBe(false);
  });

  it("nie pokazuje daty ostatniej zmiany", async () => {
    h.getSettings.mockResolvedValue(row({ persisted: false, updated_at: null }));
    await renderPanel();
    expect(screen.queryByText(/giftingAdmin\.settings\.updatedAt/)).toBeNull();
  });

  it("tenant Z wierszem noty domyslnych NIE pokazuje", async () => {
    h.getSettings.mockResolvedValue(row({ persisted: true }));
    await renderPanel();
    expect(screen.queryByText("giftingAdmin.settings.defaultsNotice")).toBeNull();
  });

  it("tenant Z wierszem pokazuje sformatowana date ostatniej zmiany", async () => {
    h.getSettings.mockResolvedValue(row({ persisted: true, updated_at: "2026-08-01T10:30:00Z" }));
    await renderPanel();
    const stamp = screen.getByText(/giftingAdmin\.settings\.updatedAt/);
    // Atrapa i18n dokleja parametry, wiec widac, ze do klucza jedzie
    // SFORMATOWANA data, a nie surowy ISO z bazy.
    expect(stamp.textContent).toContain("when=");
    expect(stamp.textContent).not.toContain("2026-08-01T10:30:00Z");
  });

  it("brak `updated_at` przy persisted:true tez nie rysuje stempla", async () => {
    h.getSettings.mockResolvedValue(row({ persisted: true, updated_at: null }));
    await renderPanel();
    expect(screen.queryByText(/giftingAdmin\.settings\.updatedAt/)).toBeNull();
  });
});

describe("SettingsPanel - walidacja blokuje zapis", () => {
  it("PUSTE pole nie moze stac sie cichym zerem - zapis zablokowany", async () => {
    // To jest najwazniejsza asercja tego pliku. `Number("") === 0`, a 0 znaczy
    // w tej domenie "bez limitu klikniec", czyli jeden upubliczniony link
    // otwierajacy platny artykul calemu internetowi.
    h.getSettings.mockResolvedValue(row({ max_redemptions_per_link: 5 }));
    await renderPanel();
    fireEvent.change(field.cap(), { target: { value: "" } });
    expect(saveButton().disabled).toBe(true);
    expect(field.cap().value).toBe("");
  });

  it("puste pole pokazuje komunikat 'wymagane' przy TYM polu", async () => {
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(field.ttl(), { target: { value: "" } });
    expect(screen.getByText(/giftingAdmin\.settings\.errors\.required/)).toBeTruthy();
    expect(field.ttl().getAttribute("aria-invalid")).toBe("true");
    // Sasiednie pola pozostaja poprawne - blad nie "rozlewa sie" po formularzu.
    expect(field.monthly().getAttribute("aria-invalid")).toBeNull();
  });

  it("klikniecie w zablokowany przycisk NIE wysyla nic na serwer", async () => {
    // Sam atrybut `disabled` to za malo: `onClick` ma dodatkowa straz
    // `payload && ...`. Dowodzimy, ze zadna z nich nie zostala sama.
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(field.cap(), { target: { value: "" } });
    fireEvent.click(saveButton());
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["monthly_limit ponad 1000", () => field.monthly(), "1001"],
    ["link_ttl_days ponad 365", () => field.ttl(), "400"],
    ["cap ponad 100000", () => field.cap(), "100001"],
    ["wartosc ujemna", () => field.monthly(), "-1"],
  ])("%s blokuje zapis i podnosi komunikat o zakresie", async (_opis, target, value) => {
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(target(), { target: { value } });
    expect(screen.getByText(/giftingAdmin\.settings\.errors\.range/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("wartosc na GORNEJ granicy jest poprawna (zakres domkniety)", async () => {
    // `BETWEEN 0 AND 1000` w bazie jest domkniety obustronnie - panel odmawiajacy
    // 1000 klamalby o regule.
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "1000" } });
    expect(screen.queryByText(/giftingAdmin\.settings\.errors/)).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("dwa bledne pola naraz daja dwa komunikaty", async () => {
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "" } });
    fireEvent.change(field.ttl(), { target: { value: "9999" } });
    expect(screen.getByText(/giftingAdmin\.settings\.errors\.required/)).toBeTruthy();
    expect(screen.getByText(/giftingAdmin\.settings\.errors\.range/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });
});

describe("SettingsPanel - budzet klikniec (cap) rowny zero", () => {
  it("cap 0 podnosi ostrzezenie o zniesionym limicie", async () => {
    h.getSettings.mockResolvedValue(row({ max_redemptions_per_link: 5 }));
    await renderPanel();
    fireEvent.change(field.cap(), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toBe("giftingAdmin.settings.capZeroWarning");
  });

  it("cap 0 jest ZAPISYWALNY - to swiadoma decyzja, nie blad", async () => {
    // Ostrzezenie ma informowac, a nie blokowac: "bez limitu" jest legalna
    // konfiguracja (CHECK w bazie dopuszcza 0).
    h.getSettings.mockResolvedValue(row({ max_redemptions_per_link: 5 }));
    await renderPanel();
    fireEvent.change(field.cap(), { target: { value: "0" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updateSettings).toHaveBeenCalled());
    expect(lastPayload().max_redemptions_per_link).toBe(0);
  });

  it("miesieczny limit 0 ostrzezenia NIE dostaje", async () => {
    // Zero w limicie miesiecznym takze znaczy "bez limitu", ale nie otwiera
    // POJEDYNCZEGO linku na caly internet - panel celowo ostrzega tylko tam,
    // gdzie konsekwencja jest nieodwracalna.
    h.getSettings.mockResolvedValue(row());
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "0" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("powrot capu ponad zero gasi ostrzezenie", async () => {
    h.getSettings.mockResolvedValue(row({ max_redemptions_per_link: 0 }));
    await renderPanel();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(field.cap(), { target: { value: "5" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SettingsPanel - zapis", () => {
  it("wysyla KOMPLETNY wiersz, a nie samo zmienione pole", async () => {
    // Server fn robi UPSERT, wiec czesciowy ladunek wyzerowalby pozostale
    // kolumny. Sprawdzamy caly obiekt, nie jedno pole.
    h.getSettings.mockResolvedValue(
      row({
        enabled: true,
        monthly_limit: 10,
        link_ttl_days: 30,
        max_redemptions_per_link: 5,
        eligibility: "registered",
      }),
    );
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toEqual({
      enabled: true,
      monthly_limit: 25,
      link_ttl_days: 30,
      max_redemptions_per_link: 5,
      eligibility: "registered",
    });
  });

  it("zmiana bramki uprawnienia dociera do ladunku", async () => {
    h.getSettings.mockResolvedValue(row({ eligibility: "registered" }));
    await renderPanel();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updateSettings).toHaveBeenCalled());
    expect(lastPayload().eligibility).toBe("subscribers");
  });

  it("wylaczenie funkcji dociera do ladunku", async () => {
    h.getSettings.mockResolvedValue(row({ enabled: true }));
    await renderPanel();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.updateSettings).toHaveBeenCalled());
    expect(lastPayload().enabled).toBe(false);
  });

  it("sukces melduje sie toastem i uniewaznia wspolny klucz ustawien", async () => {
    h.getSettings.mockResolvedValue(row());
    const { queryClient } = await renderPanel();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("giftingAdmin.settings.saved"));
    // Ten sam klucz czyta zakladka LINKI (nota "nowe linki dostaja budzet N").
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["gift-admin", "settings"] });
  });

  it("po sukcesie draft wraca do stanu serwera (przycisk znowu nieaktywny)", async () => {
    h.getSettings.mockResolvedValue(row({ monthly_limit: 25 }));
    const { queryClient } = await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.change(field.ttl(), { target: { value: "7" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["gift-admin", "settings"] });
    });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    // Draft zdjety - pola pokazuja to, co odpowiedzial serwer.
    expect(field.ttl().value).toBe("30");
  });

  it("podwojne klikniecie w trakcie zapisu nie wysyla drugiego zadania", async () => {
    h.getSettings.mockResolvedValue(row());
    let resolveSave: (value: { ok: boolean }) => void = () => {};
    h.updateSettings.mockReturnValue(
      new Promise<{ ok: boolean }>((resolve) => {
        resolveSave = resolve;
      }),
    );
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.click(saveButton());
    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSave({ ok: true });
    });
  });
});

describe("SettingsPanel - odmowa zapisu", () => {
  it("odmowa serwera pokazuje jej TRESC, a nie ogolne 'blad'", async () => {
    // Komunikaty tej server fn niosa konkret ("Forbidden: no tenant"),
    // po ktorym admin wie, czy problem jest po jego stronie.
    h.getSettings.mockResolvedValue(row());
    h.updateSettings.mockRejectedValue(new Error("Forbidden: no tenant"));
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Forbidden: no tenant"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa NIE czysci draftu - admin nie traci wpisanych liczb", async () => {
    h.getSettings.mockResolvedValue(row());
    h.updateSettings.mockRejectedValue(new Error("odmowa"));
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.change(field.ttl(), { target: { value: "7" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(field.monthly().value).toBe("25");
    expect(field.ttl().value).toBe("7");
  });

  it("po odmowie przycisk zapisu znowu dziala (mozna ponowic)", async () => {
    h.getSettings.mockResolvedValue(row());
    h.updateSettings.mockRejectedValueOnce(new Error("odmowa"));
    await renderPanel();
    fireEvent.change(field.monthly(), { target: { value: "25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    h.updateSettings.mockResolvedValue({ ok: true });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.updateSettings).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsPanel - jezyk i dostepnosc", () => {
  it("data ostatniej zmiany jest formatowana wedlug jezyka interfejsu", async () => {
    h.getSettings.mockResolvedValue(row({ updated_at: "2026-08-01T10:30:00Z" }));
    const { unmount } = await renderPanel();
    const plStamp = screen.getByText(/giftingAdmin\.settings\.updatedAt/).textContent;
    unmount();

    h.lang = "en";
    await renderPanel();
    const enStamp = screen.getByText(/giftingAdmin\.settings\.updatedAt/).textContent;
    // pl-PL i en-GB roznia sie zapisem miesiaca - identyczny napis znaczylby,
    // ze jezyk nie dociera do formatera.
    expect(enStamp).not.toBe(plStamp);
  });

  it("nie wnosi naruszen dostepnosci - formularz poprawny", async () => {
    h.getSettings.mockResolvedValue(row());
    const { container } = await renderPanel();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nie wnosi naruszen dostepnosci - formularz z bledami", async () => {
    h.getSettings.mockResolvedValue(row());
    const { container } = await renderPanel();
    fireEvent.change(field.cap(), { target: { value: "" } });
    fireEvent.change(field.monthly(), { target: { value: "9999" } });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

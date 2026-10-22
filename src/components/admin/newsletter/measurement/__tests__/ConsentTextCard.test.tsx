// Treść zgody na newsletter w przeglądzie newslettera (I9d-Y2) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Puste pole = treść domyślna z pomiarem (placeholder i podgląd z JEDNEGO
//      źródła `consentText.ts`), stan „domyślna - obejmuje pomiar", bez
//      oznaczenia do zaznaczenia.
//   2. Własny tekst bez oznaczenia: ostrzeżenie (z bazy - `covers: false`,
//      nie z heurystyki słów) i pole „mój tekst obejmuje pomiar" dla admina;
//      zaznaczenie woła oznaczenie ZAPISANEGO pola.
//   3. Redaktor widzi ostrzeżenie, ale oznaczenia nie zmieni (pole zablokowane
//      z wyjaśnieniem) - lustro bramki `requireAdmin`.
//   4. Szkic własnego tekstu ostrzega PRZED zapisem i blokuje oznaczenie
//      (oznaczenie dotyczy skrótu zapisanego tekstu); zapis idzie grupą
//      `inline` z tokenem CAS, „Przywróć domyślną" zapisuje `null`.
//   5. Tekst zmieniony po oznaczeniu (`stale`) - ostrzeżenie i dopisek.
//   6. Dawna treść domyślna sprzed Y2 nie ostrzega (formularz pokazuje
//      bieżącą treść z pomiarem), choć baza mówi `covers: false`.
//   7. Brak naruszeń axe.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  settings: null as Record<string, unknown> | null,
  consentGet: vi.fn(),
  mark: vi.fn(),
  patch: vi.fn(),
}));

// Słownik prawdziwy (`realT`), podpięty po importach - fabryka `vi.mock` jest
// synchroniczna (asynchroniczna z `i18nReal` zapętla się z rejestracją nakładki).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({ useUnsavedChangesGuard: () => undefined }));
vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () => ({ data: h.settings, isError: false, refetch: vi.fn() }),
  newsletterSettingsQueryOptions: () => ({
    queryKey: ["newsletter-settings"],
    queryFn: async () => h.settings,
  }),
}));
vi.mock("@/lib/newsletter/settingsQueries", () => ({
  usePatchNewsletterSettings: (group: string) => ({
    mutateAsync: (input: unknown) => h.patch(group, input),
    isPending: false,
  }),
}));
vi.mock("@/lib/privacy/measurement.functions", () => ({
  getNewsletterConsentMeasurement: () => h.consentGet(),
  markNewsletterConsentMeasurement: (input: unknown) => h.mark(input),
  getCampaignMeasurement: vi.fn(),
  getNewsletterMeasurementCopy: vi.fn(),
  getNewsletterMeasurementPreview: vi.fn(),
  previewNewsletterMeasurementEmail: vi.fn(),
  requestNewsletterMeasurement: vi.fn(),
  saveNewsletterMeasurementCopy: vi.fn(),
}));

import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { ConsentTextCard } from "@/components/admin/newsletter/measurement/ConsentTextCard";
import "@/lib/i18n-admin-newsletter-measurement";
import {
  LEGACY_NEWSLETTER_CONSENT_DEFAULTS,
  NEWSLETTER_CONSENT_VERSION,
  newsletterConsentHtml,
} from "@/lib/newsletter/consentText";

h.fixedT = realT;

const TOKEN = "2026-10-21T10:00:00.000000+00:00";
const OWN_PL = "Zapisując się, akceptujesz regulamin redakcji.";

type FieldOverrides = Partial<Record<string, unknown>>;

function field(name: string, lang: "pl" | "en", over: FieldOverrides = {}) {
  return {
    field: name,
    lang,
    text_present: false,
    is_default: false,
    marked: false,
    stale: false,
    covers: null,
    marked_at: null,
    ...over,
  };
}

/** Odczyt RPC po parserze (kształt DTO - funkcja serwerowa parsuje). */
function consentRead(pl: FieldOverrides = {}, en: FieldOverrides = {}) {
  const raw = [
    field("policy_html_pl", "pl", pl),
    field("policy_html_en", "en", en),
    field("popup_privacy_html_pl", "pl"),
    field("popup_privacy_html_en", "en"),
  ];
  return {
    state: "ready",
    data: {
      version: NEWSLETTER_CONSENT_VERSION,
      fields: raw.map((f) => ({
        field: f.field,
        lang: f.lang,
        textPresent: f.text_present,
        isDefault: f.is_default,
        marked: f.marked,
        stale: f.stale,
        covers: f.covers,
        markedAt: f.marked_at,
      })),
    },
  };
}

let qc: QueryClient;

function mount(canMark = true) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConsentTextCard canMark={canMark} />
    </QueryClientProvider>,
  );
}

const polish = () => screen.getByLabelText("Treść zgody - polski") as HTMLTextAreaElement;
const plBox = () => document.querySelector('[data-consent-field="pl"]') as HTMLElement;

beforeEach(() => {
  h.settings = { policy_html_pl: null, policy_html_en: null, updated_at: TOKEN };
  h.consentGet.mockReset();
  h.mark.mockReset();
  h.patch.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  h.consentGet.mockResolvedValue(consentRead());
  h.patch.mockResolvedValue({ updatedAt: "2026-10-21T10:05:00Z", changed: ["x"], merged: false });
});

afterEach(() => {
  cleanup();
  qc?.clear();
});

describe("treść zgody - stan pól", () => {
  it("puste pole: treść domyślna z pomiarem (placeholder, stan, podgląd), bez oznaczenia", async () => {
    mount();
    expect(polish().value).toBe("");
    expect(polish().getAttribute("placeholder")).toBe(newsletterConsentHtml("pl"));
    expect(
      await within(plBox()).findByText("Treść domyślna - obejmuje pomiar otwarć i kliknięć."),
    ).toBeTruthy();
    expect(within(plBox()).getByText(/Wiadomości mogą zawierać elementy mierzące/)).toBeTruthy();
    expect(screen.queryByLabelText("Mój tekst obejmuje pomiar otwarć i kliknięć")).toBeNull();
    expect(screen.getByText(new RegExp(NEWSLETTER_CONSENT_VERSION))).toBeTruthy();
  });

  it("własny tekst bez oznaczenia: ostrzeżenie z bazy i oznaczenie zapisanego pola przez admina", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    h.consentGet.mockResolvedValue(consentRead({ text_present: true, covers: false }));
    h.mark.mockResolvedValue({
      ok: true,
      data: consentRead({ text_present: true, covers: true, marked: true }).data,
    });
    mount();
    expect(await within(plBox()).findByText(/Własny tekst nie obejmuje pomiaru/)).toBeTruthy();
    const mark = within(plBox()).getByRole("checkbox", {
      name: "Mój tekst obejmuje pomiar otwarć i kliknięć",
    });
    expect(mark.hasAttribute("disabled")).toBe(false);
    fireEvent.click(mark);
    await waitFor(() =>
      expect(h.mark).toHaveBeenCalledWith({ data: { field: "policy_html_pl", marked: true } }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Oznaczono tekst jako obejmujący pomiar."),
    );
  });

  it("redaktor: ostrzeżenie widzi, oznaczenia nie zmieni", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    h.consentGet.mockResolvedValue(consentRead({ text_present: true, covers: false }));
    mount(false);
    expect(await within(plBox()).findByText(/Własny tekst nie obejmuje pomiaru/)).toBeTruthy();
    const mark = within(plBox()).getByRole("checkbox", {
      name: "Mój tekst obejmuje pomiar otwarć i kliknięć",
    });
    expect(mark.hasAttribute("disabled")).toBe(true);
    expect(within(plBox()).getByText(/Oznaczenie zmienia wyłącznie administrator\./)).toBeTruthy();
  });

  it("oznaczony tekst zmieniony później (`stale`): ostrzeżenie i dopisek", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    h.consentGet.mockResolvedValue(
      consentRead({ text_present: true, covers: false, stale: true, marked_at: TOKEN }),
    );
    mount();
    expect(
      await within(plBox()).findByText(
        "Tekst zmieniono po oznaczeniu - oznaczenie przestało działać.",
      ),
    ).toBeTruthy();
  });

  it("oznaczony tekst: stan „obejmuje pomiar” z datą oznaczenia", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    h.consentGet.mockResolvedValue(
      consentRead({ text_present: true, covers: true, marked: true, marked_at: TOKEN }),
    );
    mount();
    expect(
      await within(plBox()).findByText(/Własny tekst oznaczony jako obejmujący pomiar \(21/),
    ).toBeTruthy();
    expect(
      (
        within(plBox()).getByRole("checkbox", {
          name: "Mój tekst obejmuje pomiar otwarć i kliknięć",
        }) as HTMLElement
      ).getAttribute("data-state"),
    ).toBe("checked");
  });

  it("dawna treść domyślna sprzed Y2 nie ostrzega - formularz pokazuje bieżącą z pomiarem", async () => {
    h.settings = {
      policy_html_pl: LEGACY_NEWSLETTER_CONSENT_DEFAULTS[0],
      policy_html_en: null,
      updated_at: TOKEN,
    };
    h.consentGet.mockResolvedValue(consentRead({ text_present: true, covers: false }));
    mount();
    expect(
      await within(plBox()).findByText("Treść domyślna - obejmuje pomiar otwarć i kliknięć."),
    ).toBeTruthy();
    expect(within(plBox()).queryByText(/Własny tekst nie obejmuje pomiaru/)).toBeNull();
  });
});

describe("treść zgody - szkic i zapis", () => {
  it("szkic własnego tekstu: ostrzeżenie przed zapisem, zapis grupą `inline` z tokenem", async () => {
    mount();
    await within(plBox()).findByText("Treść domyślna - obejmuje pomiar otwarć i kliknięć.");
    fireEvent.change(polish(), { target: { value: OWN_PL } });
    expect(
      within(plBox()).getByText(
        "Po zapisie własny tekst nie obejmie pomiaru, dopóki administrator go nie oznaczy.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Niezapisane zmiany")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść zgody" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    const [group, input] = h.patch.mock.calls[0] as [
      string,
      { draft: Record<string, unknown>; expectedUpdatedAt: string | null },
    ];
    expect(group).toBe("inline");
    expect(input.expectedUpdatedAt).toBe(TOKEN);
    expect(input.draft.policy_html_pl).toBe(OWN_PL);
    expect(input.draft.policy_html_en).toBeNull();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zapisano treść zgody."));
  });

  it("szkic zapisanego własnego tekstu blokuje oznaczenie (oznaczenie dotyczy zapisanego)", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    h.consentGet.mockResolvedValue(consentRead({ text_present: true, covers: false }));
    mount();
    await within(plBox()).findByText(/Własny tekst nie obejmuje pomiaru/);
    fireEvent.change(polish(), { target: { value: `${OWN_PL} Dopisek.` } });
    const mark = within(plBox()).getByRole("checkbox", {
      name: "Mój tekst obejmuje pomiar otwarć i kliknięć",
    });
    expect(mark.hasAttribute("disabled")).toBe(true);
    expect(within(plBox()).getByText(/Zapisz tekst, zanim go oznaczysz\./)).toBeTruthy();
  });

  it("„Przywróć domyślną” czyści pole, a zapis wysyła `null` (treść domyślna z TS)", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    h.consentGet.mockResolvedValue(consentRead({ text_present: true, covers: false }));
    mount();
    await within(plBox()).findByText(/Własny tekst nie obejmuje pomiaru/);
    fireEvent.click(within(plBox()).getByRole("button", { name: "Przywróć domyślną" }));
    expect(polish().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść zgody" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    const [, input] = h.patch.mock.calls[0] as [string, { draft: Record<string, unknown> }];
    expect(input.draft.policy_html_pl).toBeNull();
  });

  it("bez zmian zapis jest zablokowany", async () => {
    mount();
    await within(plBox()).findByText("Treść domyślna - obejmuje pomiar otwarć i kliknięć.");
    expect(
      screen.getByRole("button", { name: "Zapisz treść zgody" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("treść zgody - dostępność", () => {
  it("brak naruszeń axe (ostrzeżenie i oznaczenie widoczne)", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    h.consentGet.mockResolvedValue(consentRead({ text_present: true, covers: false }));
    const { container } = mount();
    await within(plBox()).findByText(/Własny tekst nie obejmuje pomiaru/);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

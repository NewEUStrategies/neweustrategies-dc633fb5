// Treść zgody na newsletter w przeglądzie newslettera (I9d-Y2, I9d-Y2b) -
// RTL + axe w motywie jasnym i ciemnym.
//
// CO TEN PLIK DOWODZI (wariant (b), decyzje właściciela 2026-10-23).
//   1. Puste pole = treść domyślna BEZ pomiaru (placeholder i podgląd
//      z JEDNEGO źródła `consentText.ts`), stan „Treść domyślna (wersja …)".
//   2. Żadnych oznaczeń admina „mój tekst obejmuje pomiar" - ani pola, ani
//      zapytania o stan treści (RPC oznaczeń usunęła migracja).
//   3. Sekcja tylko do odczytu: treść i wersja OSOBNEGO pola zgody na pomiar
//      (PL i EN z jednego źródła `measurementConsentText.ts`).
//   4. Własny tekst = „Treść własna"; własny tekst, który wspomina pomiar -
//      ostrzeżenie R1.24 (także w szkicu, przed zapisem); dawna treść
//      domyślna (a) z opisem pomiaru - stan „domyślna", bez ostrzeżenia.
//   5. Zapis grupą `inline` z tokenem CAS, „Przywróć domyślną" zapisuje `null`.
//   6. Brak naruszeń axe (jasny i ciemny motyw).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  settings: null as Record<string, unknown> | null,
  settingsError: false,
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
  useNewsletterSettings: () => ({
    data: h.settingsError ? undefined : h.settings,
    isError: h.settingsError,
    refetch: vi.fn(),
  }),
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

import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { ConsentTextCard } from "@/components/admin/newsletter/measurement/ConsentTextCard";
import "@/lib/i18n-admin-newsletter-measurement";
import {
  LEGACY_NEWSLETTER_CONSENT_DEFAULTS,
  NEWSLETTER_CONSENT_VERSION,
  newsletterConsentHtml,
  newsletterConsentPlain,
} from "@/lib/newsletter/consentText";
import {
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  measurementConsentPlain,
} from "@/lib/newsletter/measurementConsentText";

h.fixedT = realT;

const TOKEN = "2026-10-23T10:00:00.000000+00:00";
const OWN_PL = "Zapisując się, akceptujesz regulamin redakcji.";
const OWN_WITH_MEASUREMENT =
  "Zapisując się, zgadzasz się na newsletter. Mierzymy otwarcia i kliknięcia wiadomości.";
const WARNING = /Ten tekst wspomina pomiar otwarć i kliknięć/;

let qc: QueryClient;

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConsentTextCard />
    </QueryClientProvider>,
  );
}

const polish = () => screen.getByLabelText("Treść zgody - polski") as HTMLTextAreaElement;
const plBox = () => document.querySelector('[data-consent-field="pl"]') as HTMLElement;
const measurementSection = () =>
  document.querySelector("[data-measurement-field-preview]") as HTMLElement;

beforeEach(() => {
  h.settings = { policy_html_pl: null, policy_html_en: null, updated_at: TOKEN };
  h.settingsError = false;
  h.patch.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  h.patch.mockResolvedValue({ updatedAt: "2026-10-23T10:05:00Z", changed: ["x"], merged: false });
});

afterEach(() => {
  cleanup();
  qc?.clear();
  document.documentElement.classList.remove("dark");
});

describe("treść zgody - stan pól (wariant (b))", () => {
  it("puste pole: treść domyślna BEZ pomiaru (placeholder, stan z wersją, podgląd)", () => {
    mount();
    expect(polish().value).toBe("");
    expect(polish().getAttribute("placeholder")).toBe(newsletterConsentHtml("pl"));
    expect(
      within(plBox()).getByText(`Treść domyślna (wersja ${NEWSLETTER_CONSENT_VERSION}).`),
    ).toBeTruthy();
    const preview = within(plBox()).getByText("Tak zobaczy ją czytelnik:").parentElement!;
    expect(preview.textContent).toContain(newsletterConsentPlain("pl"));
    expect(preview.textContent).not.toMatch(/mierz|pomiar/i);
    expect(within(plBox()).queryByText(WARNING)).toBeNull();
  });

  it("bez oznaczeń admina: brak pola „mój tekst obejmuje pomiar” i brak odczytu stanu treści", () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    mount();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/obejmuje pomiar/)).toBeNull();
    // Karta nie pyta bazy o stan treści (RPC oznaczeń usunęła migracja) -
    // jedynym odczytem są ustawienia newslettera.
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("własny tekst: stan „Treść własna”, podgląd tego tekstu, bez ostrzeżenia", () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    mount();
    expect(within(plBox()).getByText("Treść własna.")).toBeTruthy();
    const preview = within(plBox()).getByText("Tak zobaczy ją czytelnik:").parentElement!;
    expect(preview.textContent).toContain(OWN_PL);
    expect(within(plBox()).queryByText(WARNING)).toBeNull();
  });

  it("własny tekst, który wspomina pomiar - ostrzeżenie R1.24 (opis pomiaru należy do osobnego pola)", () => {
    h.settings = { policy_html_pl: OWN_WITH_MEASUREMENT, policy_html_en: null, updated_at: TOKEN };
    mount();
    const warning = within(plBox()).getByText(WARNING);
    expect(warning.getAttribute("role")).toBe("note");
    expect(warning.textContent).toMatch(/osobnego pola zgody na pomiar/);
    // Ostrzeżenie jest częścią opisu pola (czytnik ekranu czyta je przy polu).
    const describedBy = polish().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.contains(warning)).toBe(true);
  });

  it("dawna treść domyślna (a) z opisem pomiaru: stan „domyślna”, bez ostrzeżenia", () => {
    const bundledPl = LEGACY_NEWSLETTER_CONSENT_DEFAULTS[2];
    expect(bundledPl).toMatch(/mierzące/);
    h.settings = { policy_html_pl: bundledPl, policy_html_en: null, updated_at: TOKEN };
    mount();
    expect(
      within(plBox()).getByText(`Treść domyślna (wersja ${NEWSLETTER_CONSENT_VERSION}).`),
    ).toBeTruthy();
    expect(within(plBox()).queryByText(WARNING)).toBeNull();
  });

  it("błąd odczytu ustawień: komunikat z ponowieniem", () => {
    h.settingsError = true;
    mount();
    expect(screen.getByRole("alert").textContent).toMatch(/Nie udało się wczytać treści zgody/);
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeTruthy();
  });
});

describe("osobne pole zgody na pomiar - sekcja tylko do odczytu", () => {
  it("treść PL i EN pola pomiaru z jednego źródła i wersja pomiaru", () => {
    mount();
    const section = measurementSection();
    expect(
      within(section).getByRole("heading", {
        name: "Zgoda na pomiar otwarć i kliknięć - osobne pole",
      }),
    ).toBeTruthy();
    expect(
      within(section).getByText(`Wersja treści: ${EMAIL_MEASUREMENT_CONSENT_VERSION}`),
    ).toBeTruthy();
    for (const lang of ["pl", "en"] as const) {
      const box = section.querySelector(`[data-measurement-preview="${lang}"]`) as HTMLElement;
      expect(box.textContent).toContain(measurementConsentPlain(lang));
      expect(box.querySelector(`[lang="${lang}"]`)).not.toBeNull();
    }
    // Link „szczegóły” prowadzi do sekcji pomiaru polityki komunikacji.
    const link = within(section).getByRole("link", { name: "szczegóły" });
    expect(link.getAttribute("href")).toBe("/komunikacja-i-marketing#pomiar");
    // Tylko do odczytu - żadnego pola edycji w sekcji.
    expect(section.querySelector("textarea, input")).toBeNull();
    expect(within(section).getByText(/domyślnie niezaznaczone/)).toBeTruthy();
    expect(within(section).getByText(/potwierdzi zgodę przyciskiem/)).toBeTruthy();
  });
});

describe("treść zgody - szkic i zapis", () => {
  it("szkic wspominający pomiar ostrzega PRZED zapisem; zapis grupą `inline` z tokenem", async () => {
    mount();
    fireEvent.change(polish(), { target: { value: OWN_WITH_MEASUREMENT } });
    expect(within(plBox()).getByText(WARNING)).toBeTruthy();
    expect(screen.getByText("Niezapisane zmiany")).toBeTruthy();
    fireEvent.change(polish(), { target: { value: OWN_PL } });
    expect(within(plBox()).queryByText(WARNING)).toBeNull();
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

  it("„Przywróć domyślną” czyści pole, a zapis wysyła `null` (treść domyślna z TS)", async () => {
    h.settings = { policy_html_pl: OWN_PL, policy_html_en: null, updated_at: TOKEN };
    mount();
    fireEvent.click(within(plBox()).getByRole("button", { name: "Przywróć domyślną" }));
    expect(polish().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść zgody" }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    const [, input] = h.patch.mock.calls[0] as [string, { draft: Record<string, unknown> }];
    expect(input.draft.policy_html_pl).toBeNull();
  });

  it("bez zmian zapis jest zablokowany", () => {
    mount();
    expect(
      screen.getByRole("button", { name: "Zapisz treść zgody" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("treść zgody - dostępność", () => {
  it.each(["light", "dark"] as const)(
    "brak naruszeń axe - motyw %s (ostrzeżenie i sekcja pola pomiaru widoczne)",
    async (theme) => {
      if (theme === "dark") document.documentElement.classList.add("dark");
      h.settings = {
        policy_html_pl: OWN_WITH_MEASUREMENT,
        policy_html_en: null,
        updated_at: TOKEN,
      };
      const { container } = mount();
      expect(within(plBox()).getByText(WARNING)).toBeTruthy();
      expect(measurementSection()).not.toBeNull();
      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
    },
  );
});

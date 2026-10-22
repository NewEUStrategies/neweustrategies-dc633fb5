// Edytor treści maila „Poproś o zgodę na pomiar" (I9d-Y2) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Jeden edytor z prośbą wygaszania (`MailCopyEditorBody`): te same pola
//      i limity, ale treść domyślna (placeholder) i zmienne prośby o pomiar.
//   2. Zapis mutatorem pomiaru z tokenem CAS; podgląd to render serwera
//      z treścią SZKICU w ramce z tytułem prośby o pomiar.
//   3. Konflikt nie wyciera szkicu; odmowa roli to stan karty; brak naruszeń axe.
//   4. Sekcje wejściowe pokazują karty tylko rolom, które wpuszcza serwer.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  get: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  auth: { tenantId: "t" as string | null, isAdmin: true, roles: ["admin"] as string[] },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/privacy/measurement.functions", () => ({
  getNewsletterMeasurementCopy: () => h.get(),
  saveNewsletterMeasurementCopy: (input: unknown) => h.save(input),
  previewNewsletterMeasurementEmail: (input: unknown) => h.preview(input),
  getCampaignMeasurement: vi.fn(),
  getNewsletterConsentMeasurement: vi.fn(),
  getNewsletterMeasurementPreview: vi.fn(),
  markNewsletterConsentMeasurement: vi.fn(),
  requestNewsletterMeasurement: vi.fn(),
}));
// Panel przeglądu (sekcja wejściowa) - atrapa: tu liczy się wyłącznie, KOMU
// sekcja go montuje i z jakimi uprawnieniami.
vi.mock("@/components/admin/newsletter/measurement/NewsletterMeasurementPanel", () => ({
  default: ({ isAdmin }: { isAdmin: boolean }) => (
    <div data-testid="measurement-panel" data-admin={String(isAdmin)} />
  ),
}));

import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import axe from "axe-core";
import { summarize } from "@/test/axe";
import NewsletterMeasurementCopyEditor from "@/components/admin/newsletter/measurement/NewsletterMeasurementCopyEditor";
import { NewsletterMeasurementCopySection } from "@/components/admin/newsletter/measurement/NewsletterMeasurementCopySection";
import { NewsletterMeasurementSection } from "@/components/admin/newsletter/measurement/NewsletterMeasurementSection";
import "@/lib/i18n-admin-newsletter-measurement";
import {
  NEWSLETTER_MEASUREMENT_DEFAULT_COPY,
  NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES,
  type NewsletterMeasurementCopyOverrides,
} from "@/lib/privacy/measurementReconfirm";

h.fixedT = realT;

const TOKEN = "2026-10-21T10:00:00.000000+00:00";
const TOKEN_NEWER = "2026-10-21T10:05:00.000000+00:00";

function overrides(
  pl: Partial<NewsletterMeasurementCopyOverrides["pl"]> = {},
): NewsletterMeasurementCopyOverrides {
  return {
    pl: { ...NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES.pl, ...pl },
    en: { ...NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES.en },
  };
}

let qc: QueryClient;

function mount(node = <NewsletterMeasurementCopyEditor />) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  for (const fn of [h.get, h.save, h.preview]) fn.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  h.auth = { tenantId: "t", isAdmin: true, roles: ["admin"] };
  h.get.mockResolvedValue({ state: "ready", data: { overrides: overrides(), updatedAt: TOKEN } });
  h.preview.mockImplementation(async (input: { data: { lang: string } }) => ({
    ok: true,
    data: {
      subject: `Prośba ${input.data.lang}`,
      html: `<p>Mail ${input.data.lang}</p>`,
      text: "Mail",
    },
  }));
  h.save.mockImplementation(
    async (input: { data: { overrides: NewsletterMeasurementCopyOverrides } }) => ({
      ok: true,
      data: { overrides: input.data.overrides, updatedAt: TOKEN_NEWER },
    }),
  );
});

afterEach(() => {
  cleanup();
  qc?.clear();
});

describe("treść maila prośby o zgodę na pomiar", () => {
  it("placeholder = treść domyślna prośby o pomiar, zmienne prośby", async () => {
    mount();
    expect((await screen.findByLabelText("Temat")).getAttribute("placeholder")).toBe(
      NEWSLETTER_MEASUREMENT_DEFAULT_COPY.pl.subject,
    );
    expect(field("Przycisk").getAttribute("placeholder")).toBe(
      NEWSLETTER_MEASUREMENT_DEFAULT_COPY.pl.cta,
    );
    expect(screen.getByText(/Zmienne: \{firstName\} - imię subskrybenta\./)).toBeTruthy();
    expect(document.getElementById("newsletter-measurement-copy")).not.toBeNull();
  });

  it("zapis mutatorem pomiaru z tokenem CAS; podgląd z treścią szkicu", async () => {
    mount();
    const frame = await screen.findByTitle("Podgląd maila z prośbą o zgodę na pomiar");
    expect(frame.getAttribute("srcdoc")).toBe("<p>Mail pl</p>");
    expect(frame.getAttribute("sandbox")).toBe("");
    fireEvent.change(field("Temat"), { target: { value: "Czy możemy mierzyć?" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść" }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: {
          overrides: overrides({ subject: "Czy możemy mierzyć?" }),
          expectedUpdatedAt: TOKEN,
        },
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Zapisano treść prośby o zgodę na pomiar."),
    );
    await waitFor(() =>
      expect(h.preview).toHaveBeenLastCalledWith({
        data: { lang: "pl", overrides: overrides({ subject: "Czy możemy mierzyć?" }) },
      }),
    );
  });

  it("konflikt: szkic zostaje, komunikat prośby o pomiar", async () => {
    h.save.mockResolvedValue({ ok: false, error: "conflict", reason: "stale_write" });
    mount();
    await screen.findByLabelText("Temat");
    fireEvent.change(field("Temat"), { target: { value: "Mój temat" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/^Ktoś zapisał treść prośby o zgodę na pomiar w innej karcie/),
      ),
    );
    expect(field("Temat").value).toBe("Mój temat");
  });

  it("odmowa roli to stan karty", async () => {
    h.get.mockResolvedValue({ state: "forbidden" });
    mount();
    expect(
      await screen.findByText("Treść prośby o zgodę na pomiar zmienia wyłącznie administrator."),
    ).toBeTruthy();
  });

  it("brak naruszeń axe", async () => {
    const { container } = mount();
    await screen.findByTitle("Podgląd maila z prośbą o zgodę na pomiar");
    // Reguły jak `@/test/axe`, bez wchodzenia do ramki podglądu (happy-dom nie
    // ma okna ramki); sama ramka - tytuł, `frame-title` - jest sprawdzana.
    const { violations } = await axe.run(container as HTMLElement, {
      iframes: false,
      rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    });
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("sekcje wejściowe - role jak bramki serwera", () => {
  it("treść maila prośby: wyłącznie administrator", async () => {
    h.auth = { tenantId: "t", isAdmin: false, roles: ["editor"] };
    const { container } = mount(<NewsletterMeasurementCopySection />);
    expect(container.innerHTML).toBe("");
    cleanup();
    h.auth = { tenantId: "t", isAdmin: true, roles: ["admin"] };
    mount(<NewsletterMeasurementCopySection />);
    expect(await screen.findByLabelText("Temat")).toBeTruthy();
  });

  it("przegląd: redaktor - treść zgody bez prośby, admin - obie karty, autor - nic", async () => {
    h.auth = { tenantId: "t", isAdmin: false, roles: ["author"] };
    const { container } = mount(<NewsletterMeasurementSection />);
    expect(container.innerHTML).toBe("");
    cleanup();
    h.auth = { tenantId: "t", isAdmin: false, roles: ["editor"] };
    mount(<NewsletterMeasurementSection />);
    expect((await screen.findByTestId("measurement-panel")).getAttribute("data-admin")).toBe(
      "false",
    );
    cleanup();
    h.auth = { tenantId: "t", isAdmin: true, roles: ["admin"] };
    mount(<NewsletterMeasurementSection />);
    expect((await screen.findByTestId("measurement-panel")).getAttribute("data-admin")).toBe(
      "true",
    );
    cleanup();
    h.auth = { tenantId: null, isAdmin: true, roles: ["admin"] };
    const ssr = mount(<NewsletterMeasurementSection />);
    expect(ssr.container.innerHTML).toBe("");
  });
});

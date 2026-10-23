// „Poproś o zgodę na pomiar" i wspólny przełącznik pomiaru w przeglądzie
// newslettera (I9d-Y2, Z-I9c-09; I9d-Y2b - prośba o OSOBNĄ zgodę na pomiar,
// wersja treści pola pomiaru) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Podgląd liczb (aktywni, ze zgodą, do prośby, na liście wyłączeń) i stan
//      próśb z PANELU bieżącej wersji treści pomiaru; notka, że prośby po
//      zapisie bez double opt-in nie są tu liczone (`request.originNote`).
//   2. Start WYŁĄCZNIE po potwierdzeniu w oknie z liczbą z podglądu; do bazy
//      idzie dokładnie ta liczba (`expected`), wynik mówi, ilu zlecono.
//   3. Konflikt (kandydatów przybyło po podglądzie) - komunikat, nic nie
//      wysłane bez nowego potwierdzenia.
//   4. Brak kandydatów - przycisk zablokowany z wyjaśnieniem; przełącznik
//      wyłączony - notka, że zgody zapiszemy, ale pomiar ruszy po włączeniu.
//   5. Przełącznik to wspólne ustawienie silnika (`open_tracking_enabled`)
//      zapisywane z tokenem CAS ustawień silnika.
//   6. Odmowa roli i okno wdrożenia jako stan karty; brak naruszeń axe.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  preview: vi.fn(),
  request: vi.fn(),
  journeySettings: vi.fn(),
  journeySave: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children, className }: Record<string, string> & { children: unknown }) => (
    <a href={`${to}#${hash}`} className={className}>
      {children as never}
    </a>
  ),
}));
vi.mock("@/lib/privacy/measurement.functions", () => ({
  getNewsletterMeasurementPreview: () => h.preview(),
  requestNewsletterMeasurement: (input: unknown) => h.request(input),
  getCampaignMeasurement: vi.fn(),
  getNewsletterMeasurementCopy: vi.fn(),
  previewNewsletterMeasurementEmail: vi.fn(),
  saveNewsletterMeasurementCopy: vi.fn(),
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  getJourneySettings: () => h.journeySettings(),
  saveJourneySettings: (input: unknown) => h.journeySave(input),
}));
vi.mock("@/lib/privacy/dataRetention.functions", () => ({
  extendDataRetentionContact: vi.fn(),
  getDataRetention: vi.fn(),
  getDataRetentionCrmDue: vi.fn(),
  getDataRetentionPreview: vi.fn(),
  runDataRetentionNow: vi.fn(),
  saveDataRetentionCategory: vi.fn(),
  setDataRetentionEnforcement: vi.fn(),
}));

import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { MeasurementRequestCard } from "@/components/admin/newsletter/measurement/MeasurementRequestCard";
import "@/lib/i18n-admin-newsletter-measurement";
import type { NewsletterMeasurementPreviewDto } from "@/lib/privacy/measurementParse";

h.fixedT = realT;

const TENANT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "2026-10-21T10:00:00.000000+00:00";

function preview(over: Partial<NewsletterMeasurementPreviewDto> = {}) {
  const data: NewsletterMeasurementPreviewDto = {
    version: "email-measurement-2026-10-23",
    enabled: true,
    subscribers: 1200,
    withConsent: 300,
    candidates: 850,
    suppressed: 50,
    requested: 0,
    pending: 0,
    mailed: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
    confirmed: 0,
    dailyCap: 200,
    lastRequestedAt: null,
    ...over,
  };
  return { state: "ready", data };
}

function journeySettings(openTrackingEnabled = true) {
  return {
    state: "ready",
    data: { openTrackingEnabled, updatedAt: TOKEN, exists: true },
  };
}

let qc: QueryClient;

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MeasurementRequestCard tenantId={TENANT} />
    </QueryClientProvider>,
  );
}

const stat = (key: string) => document.querySelector(`[data-stat="${key}"]`) as HTMLElement;

beforeEach(() => {
  for (const fn of [h.preview, h.request, h.journeySettings, h.journeySave]) fn.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.info).mockReset();
  h.preview.mockResolvedValue(preview());
  h.journeySettings.mockResolvedValue(journeySettings());
  h.request.mockResolvedValue({
    ok: true,
    data: { requested: 850, version: "email-measurement-2026-10-23" },
  });
  h.journeySave.mockResolvedValue({ ok: true, data: { openTrackingEnabled: false } });
});

afterEach(() => {
  cleanup();
  qc?.clear();
});

describe("prośba o zgodę na pomiar - podgląd i start", () => {
  it("liczby z podglądu i link do treści maila", async () => {
    mount();
    expect(await screen.findByText("Aktywni subskrybenci")).toBeTruthy();
    expect(within(stat("subscribers")).getByText(/1\s?200/)).toBeTruthy();
    expect(within(stat("withConsent")).getByText("300")).toBeTruthy();
    expect(within(stat("candidates")).getByText("850")).toBeTruthy();
    expect(within(stat("suppressed")).getByText("50")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Edytuj treść maila z prośbą" }).getAttribute("href"),
    ).toBe("/admin/newsletter/email-content#newsletter-measurement-copy");
    // Bez próśb tej wersji - bez sekcji stanu.
    expect(screen.queryByText(/Prośby z panelu dla wersji treści/)).toBeNull();
    // Prośby po zapisie (origin signup) nie wchodzą do liczników karty.
    const originNote = document.querySelector('[data-request-note="origin"]') as HTMLElement;
    expect(originNote.textContent).toMatch(/po zapisie z zaznaczonym polem pomiaru/);
    expect(originNote.textContent).toMatch(/nie są tu liczone/);
    // Podtytuł mówi o OSOBNEJ zgodzie na pomiar, nie o treści zgody z pomiarem.
    expect(screen.getByText(/Prośba dotyczy osobnej zgody na pomiar/)).toBeTruthy();
  });

  it("start dopiero po potwierdzeniu, z liczbą z podglądu", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Poproś o zgodę na pomiar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/jednorazowy mail do 850 subskrybentów/)).toBeTruthy();
    expect(within(dialog).getByText(/najwyżej 200 maili dziennie/)).toBeTruthy();
    expect(within(dialog).getByText(/Link jest ważny 60 dni/)).toBeTruthy();
    expect(h.request).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Wyślij prośbę" }));
    await waitFor(() => expect(h.request).toHaveBeenCalledWith({ data: { expected: 850 } }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Zlecono prośbę do 850 subskrybentów."),
    );
  });

  it("anulowanie okna niczego nie wysyła", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Poproś o zgodę na pomiar" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.request).not.toHaveBeenCalled();
  });

  it("konflikt (kandydatów przybyło po podglądzie): komunikat i nowy podgląd", async () => {
    h.request.mockResolvedValue({ ok: false, error: "conflict", reason: "stale_preview" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Poproś o zgodę na pomiar" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Wyślij prośbę",
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Liczba subskrybentów do prośby zmieniła się od podglądu - sprawdź nową liczbę i potwierdź ponownie.",
      ),
    );
    await waitFor(() => expect(h.preview).toHaveBeenCalledTimes(2));
  });

  it("nikt nowy: powtórny start nie dubluje próśb", async () => {
    h.request.mockResolvedValue({
      ok: true,
      data: { requested: 0, version: "email-measurement-2026-10-23" },
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Poproś o zgodę na pomiar" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Wyślij prośbę",
      }),
    );
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        "Prośby dla tej wersji treści są już zlecone - nikt nowy nie dostanie maila.",
      ),
    );
  });

  it("stan próśb bieżącej wersji", async () => {
    h.preview.mockResolvedValue(
      preview({
        candidates: 0,
        requested: 900,
        pending: 400,
        mailed: 450,
        blocked: 20,
        skipped: 10,
        failed: 20,
        confirmed: 120,
        lastRequestedAt: TOKEN,
      }),
    );
    mount();
    expect(
      await screen.findByText("Prośby z panelu dla wersji treści email-measurement-2026-10-23"),
    ).toBeTruthy();
    const confirmed = document.querySelector('[data-progress="confirmed"]') as HTMLElement;
    expect(within(confirmed).getByText("120")).toBeTruthy();
    expect(screen.getByText(/Ostatnie zlecenie: 21/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Poproś o zgodę na pomiar" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/Nie ma subskrybentów, do których można wysłać prośbę/)).toBeTruthy();
  });
});

describe("wspólny przełącznik pomiaru (Z-I9c-09)", () => {
  it("zapis ustawienia silnika z tokenem CAS", async () => {
    mount();
    const toggle = await screen.findByRole("switch", {
      name: "Mierz otwarcia i kliknięcia (ścieżki i kampanie)",
    });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(h.journeySave).toHaveBeenCalledWith({
        data: { patch: { open_tracking_enabled: false }, expectedUpdatedAt: TOKEN },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zapisano ustawienie pomiaru."));
  });

  it("pomiar wyłączony: notka, że zgody zapiszemy, a pomiar ruszy po włączeniu", async () => {
    h.preview.mockResolvedValue(preview({ enabled: false }));
    h.journeySettings.mockResolvedValue(journeySettings(false));
    mount();
    expect(await screen.findByText(/Pomiar jest wyłączony: zgody zapiszemy/)).toBeTruthy();
  });
});

describe("prośba o zgodę na pomiar - stany i dostępność", () => {
  it("odmowa roli i okno wdrożenia to stan karty", async () => {
    h.preview.mockResolvedValue({ state: "forbidden" });
    const first = mount();
    expect(
      await screen.findByText("Prośbę o zgodę na pomiar zleca wyłącznie administrator."),
    ).toBeTruthy();
    first.unmount();
    h.preview.mockResolvedValue({ state: "unavailable" });
    mount();
    expect(await screen.findByText(/zadziała po wdrożeniu migracji pomiaru/)).toBeTruthy();
  });

  it("brak naruszeń axe", async () => {
    const { container } = mount();
    await screen.findByText("Aktywni subskrybenci");
    // Odczyt ustawień silnika odblokowuje przełącznik - axe na stanie końcowym.
    await waitFor(() => expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(false));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

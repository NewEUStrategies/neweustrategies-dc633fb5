// Karta „Retencja danych" (I9c-X2) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Kategoria edytowalna ma okres w zakresie z katalogu (wspólny atom
//      listy), przełącznik i dymek z podstawą prawną; kategoria ustawowa jest
//      oznaczona „Minimum ustawowe - tylko do odczytu" i nie ma kontrolek.
//   2. Zmiana okresu jedzie wspólnym mutatorem z tokenem `updated_at` (CAS);
//      wyłączenie kategorii wymaga potwierdzenia z ostrzeżeniem o zasadzie
//      ograniczenia przechowywania - anulowanie nie zapisuje niczego.
//   3. Bezpieczny start: tryb podglądu z datą, „włącz teraz" przez
//      potwierdzenie, przesunięcie terminu - dzień spoza zakresu blokuje zapis
//      (odrzucenie, nie przycięcie).
//   4. Lista „do anonimizacji": przedłużenie z powodem 3-500 znaków.
//   5. Piksel otwarć zapisuje ustawienie silnika ścieżek z tokenem.
//   6. Stan „niewdrożone" i brak naruszeń axe.
//
// SŁOWNIK PRAWDZIWY (`realT`), funkcje serwerowe atrapowane - przedmiotem
// dowodu jest karta, nie RPC (te przypina pgTAP).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  get: vi.fn(),
  preview: vi.fn(),
  crmDue: vi.fn(),
  save: vi.fn(),
  enforcement: vi.fn(),
  extend: vi.fn(),
  run: vi.fn(),
  journeySave: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/privacy/dataRetention.functions", () => ({
  getDataRetention: () => h.get(),
  getDataRetentionPreview: () => h.preview(),
  getDataRetentionCrmDue: () => h.crmDue(),
  saveDataRetentionCategory: (input: unknown) => h.save(input),
  setDataRetentionEnforcement: (input: unknown) => h.enforcement(input),
  extendDataRetentionContact: (input: unknown) => h.extend(input),
  runDataRetentionNow: (input: unknown) => h.run(input),
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  saveJourneySettings: (input: unknown) => h.journeySave(input),
}));

import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import DataRetentionCard from "@/components/admin/settings/dataRetention/DataRetentionCard";
import "@/lib/i18n-admin-data-retention";
import type { DataRetentionStateDto } from "@/lib/privacy/dataRetentionParse";

h.fixedT = realT;

const TENANT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "2026-10-20T17:49:38.164871+00:00";
const LEAD = "22222222-2222-4222-8222-222222222222";

function state(overrides: Partial<DataRetentionStateDto> = {}): DataRetentionStateDto {
  return {
    categories: [
      {
        key: "paywall_metering",
        editable: true,
        periodMonths: 13,
        defaultMonths: 13,
        minMonths: 3,
        maxMonths: 25,
        enabled: true,
        enforceAfter: "2026-11-03T17:49:38.164871+00:00",
        enforced: false,
        cutoff: "2025-09-20T18:14:17.727283+00:00",
        updatedAt: TOKEN,
        stored: true,
        lastRun: {
          mode: "preview",
          trigger: "schedule",
          affected: 42,
          backlog: false,
          errorCode: null,
          cutoff: "2025-09-20T00:00:00+00:00",
          startedAt: "2026-10-20T02:07:00+00:00",
          finishedAt: "2026-10-20T02:07:01+00:00",
        },
      },
      {
        key: "consent_log",
        editable: false,
        periodMonths: null,
        defaultMonths: null,
        minMonths: null,
        maxMonths: null,
        enabled: true,
        enforceAfter: "2026-11-03T17:49:38.164871+00:00",
        enforced: false,
        cutoff: null,
        updatedAt: TOKEN,
        stored: true,
        lastRun: null,
      },
    ],
    grace: {
      enforceAfter: "2026-11-03T17:49:38.164871+00:00",
      enforceAfterMax: "2026-11-03T17:49:38.164871+00:00",
      enforced: false,
      anyPreview: true,
    },
    funnelCut: "2025-09-20",
    journeySealed: null,
    openTrackingEnabled: true,
    journeySettingsUpdatedAt: TOKEN,
    lastScheduledRunAt: "2026-10-20T02:07:00+00:00",
    ...overrides,
  };
}

let qc: QueryClient;

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DataRetentionCard tenantId={TENANT} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [
    h.get,
    h.preview,
    h.crmDue,
    h.save,
    h.enforcement,
    h.extend,
    h.run,
    h.journeySave,
  ]) {
    fn.mockReset();
  }
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  h.get.mockResolvedValue({ state: "ready", data: state() });
  h.preview.mockResolvedValue({
    state: "ready",
    data: {
      cap: 100000,
      categories: [
        {
          key: "paywall_metering",
          enabled: true,
          mode: "preview",
          cutoff: "2025-09-20T00:00:00+00:00",
          count: 7,
          capped: false,
        },
        {
          key: "consent_log",
          enabled: true,
          mode: "preview",
          cutoff: "2020-10-20T00:00:00+00:00",
          count: 0,
          capped: false,
        },
      ],
    },
  });
  h.crmDue.mockResolvedValue({
    state: "ready",
    data: {
      noticeDays: 30,
      enabled: true,
      enforced: false,
      items: [
        {
          leadId: LEAD,
          email: "anna@example.test",
          firstName: "Anna",
          lastName: "Nowak",
          company: null,
          lastActivity: "2024-10-01T10:00:00+00:00",
          dueAt: "2026-11-01T10:00:00+00:00",
          customer: false,
        },
      ],
    },
  });
  h.save.mockResolvedValue({ ok: true, data: state() });
  h.enforcement.mockResolvedValue({ ok: true, data: state() });
  h.extend.mockResolvedValue({
    ok: true,
    data: { leadId: LEAD, extendedUntil: "2027-10-20T10:00:00+00:00" },
  });
  h.run.mockResolvedValue({ ok: true, data: { busy: false, categories: [] } });
  h.journeySave.mockResolvedValue({ ok: true, data: {} });
});

afterEach(() => {
  cleanup();
  qc?.clear();
});

describe("karta retencji - kategorie", () => {
  it("edytowalna: okres w zakresie katalogu, dymek z podstawą; ustawowa: tylko do odczytu", async () => {
    mount();
    const period = await screen.findByLabelText(
      "Okres przechowywania: Uderzenia w paywall i dziennik licznika artykułów",
    );
    const options = within(period)
      .getAllByRole("option")
      .map((o) => o.getAttribute("value"));
    expect(options[0]).toBe("3");
    expect(options.at(-1)).toBe("25");
    expect(within(period).getByRole("option", { name: "13 miesięcy (domyślnie)" })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Podstawa prawna i standard: Uderzenia w paywall i dziennik licznika artykułów",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Minimum ustawowe - tylko do odczytu")).toBeTruthy();
    expect(screen.queryByLabelText("Kategoria włączona: Dziennik zgód")).toBeNull();
    expect(screen.getByText(/Podgląd: 42 rekordy/)).toBeTruthy();
    expect(await screen.findByText(/7 rekordów starszych niż/)).toBeTruthy();
  });

  it("zmiana okresu: wspólny mutator z tokenem CAS", async () => {
    mount();
    const period = await screen.findByLabelText(
      "Okres przechowywania: Uderzenia w paywall i dziennik licznika artykułów",
    );
    fireEvent.change(period, { target: { value: "6" } });
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: {
          category: "paywall_metering",
          periodMonths: 6,
          enabled: true,
          expectedUpdatedAt: TOKEN,
        },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zapisano okres retencji."));
  });

  it("wyłączenie wymaga potwierdzenia z ostrzeżeniem; anulowanie niczego nie zapisuje", async () => {
    mount();
    const toggle = await screen.findByLabelText(
      "Kategoria włączona: Uderzenia w paywall i dziennik licznika artykułów",
    );
    fireEvent.click(toggle);
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/ograniczenia przechowywania \(RODO art\. 5 ust\. 1 lit\. e\)/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.save).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Wyłącz mimo to",
      }),
    );
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: {
          category: "paywall_metering",
          periodMonths: 13,
          enabled: false,
          expectedUpdatedAt: TOKEN,
        },
      }),
    );
  });

  it("konflikt zapisu (40001): komunikat konfliktu, nie ogólny błąd", async () => {
    h.save.mockResolvedValueOnce({ ok: false, error: "conflict", reason: "conflict" });
    mount();
    fireEvent.change(
      await screen.findByLabelText(
        "Okres przechowywania: Uderzenia w paywall i dziennik licznika artykułów",
      ),
      { target: { value: "14" } },
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Ktoś zmienił to ustawienie"),
      ),
    );
  });
});

describe("karta retencji - bezpieczny start, przebieg, piksel, CRM", () => {
  it("tryb podglądu: „włącz teraz” przez potwierdzenie", async () => {
    mount();
    expect(await screen.findByText(/Bezpieczny start: tryb podglądu do/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Włącz usuwanie teraz" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Włącz usuwanie teraz" }));
    await waitFor(() =>
      expect(h.enforcement).toHaveBeenCalledWith({ data: { action: "enable_now" } }),
    );
  });

  it("przesunięcie terminu: dzień spoza zakresu blokuje zapis (bez przycięcia)", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Przesuń termin" }));
    const field = screen.getByLabelText("Nowy termin włączenia usuwania");
    fireEvent.change(field, { target: { value: "2099-01-01" } });
    expect(screen.getByText(/Wybierz dzień od jutra do 90 dni od dziś/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zapisz termin" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(h.enforcement).not.toHaveBeenCalled();
  });

  it("uruchom teraz: w trybie podglądu opis „tylko policzy”, potem wywołanie z potwierdzeniem", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Uruchom teraz" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/przebieg tylko policzy/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uruchom przebieg" }));
    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
  });

  it("piksel otwarć: ustawienie silnika ścieżek z tokenem", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText("Mierz otwarcia maili ścieżek pikselem"));
    await waitFor(() =>
      expect(h.journeySave).toHaveBeenCalledWith({
        data: { patch: { open_tracking_enabled: false }, expectedUpdatedAt: TOKEN },
      }),
    );
    expect(screen.getByText(/Rekomendacja: uzupełnić treść zgody/)).toBeTruthy();
  });

  it("przedłużenie kontaktu: powód poniżej 3 znaków blokuje zapis, poprawny - zapis i komunikat", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: /Przedłuż przechowywanie: Anna Nowak/ }),
    );
    const reason = await screen.findByLabelText("Powód przedłużenia");
    fireEvent.change(reason, { target: { value: "ab" } });
    const saveButton = screen.getByRole("button", { name: "Przedłuż o 12 miesięcy" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Powód musi mieć od 3 do 500 znaków/)).toBeTruthy();
    fireEvent.change(reason, { target: { value: "Negocjacje umowy ramowej" } });
    fireEvent.click(screen.getByRole("button", { name: "Przedłuż o 12 miesięcy" }));
    await waitFor(() =>
      expect(h.extend).toHaveBeenCalledWith({
        data: { leadId: LEAD, reason: "Negocjacje umowy ramowej" },
      }),
    );
  });

  it("baza bez migracji: stan „niewdrożone”, bez kontrolek", async () => {
    h.get.mockResolvedValue({ state: "unavailable" });
    mount();
    expect(await screen.findByText(/nie jest jeszcze wdrożona w tej bazie/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Uruchom teraz" })).toBeNull();
  });

  it("brak naruszeń axe (etykiety, nazwy przycisków, struktura list i tabel)", async () => {
    const { container } = mount();
    await screen.findByText(/7 rekordów starszych niż/);
    await screen.findByText(/Anna Nowak/);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

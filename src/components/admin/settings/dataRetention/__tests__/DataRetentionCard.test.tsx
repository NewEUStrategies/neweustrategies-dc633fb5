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
//   7. (I9d-Y1) Cztery nowe kategorie mają nazwy, opisy podstawy prawnej
//      i skutków, okres w zakresie katalogu i własną karencję w wierszu, gdy
//      terminy kategorii się różnią.
//   8. (I9d-Y1) Lista „do wygaszenia": liczby, adres MASKOWANY, stan prośby
//      (wysłana, lista wyłączeń, w najbliższym przebiegu) i termin usunięcia;
//      wykluczenie i cofnięcie z powodem 3-500 znaków (odrzucenie, nie
//      przycięcie); dymki zaangażowania (Gmail tak, Apple MPP nie) i „bez
//      otwarć" przy wyłączonym pomiarze; baza bez kategorii - listy nie ma.
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
  newsletterDue: vi.fn(),
  exclude: vi.fn(),
  include: vi.fn(),
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
vi.mock("@/lib/privacy/newsletterSunset.functions", () => ({
  getDataRetentionNewsletterDue: () => h.newsletterDue(),
  excludeNewsletterSubscriber: (input: unknown) => h.exclude(input),
  includeNewsletterSubscriber: (input: unknown) => h.include(input),
  getNewsletterSunsetCopy: vi.fn(),
  saveNewsletterSunsetCopy: vi.fn(),
  previewNewsletterSunsetEmail: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import DataRetentionCard from "@/components/admin/settings/dataRetention/DataRetentionCard";
import "@/lib/i18n-admin-data-retention";
import type {
  DataRetentionCategoryDto,
  DataRetentionNewsletterDueDto,
  DataRetentionStateDto,
} from "@/lib/privacy/dataRetentionParse";

h.fixedT = realT;

const TENANT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "2026-10-20T17:49:38.164871+00:00";
const LEAD = "22222222-2222-4222-8222-222222222222";
const SUB_MAILED = "33333333-3333-4333-8333-333333333331";
const SUB_SUPPRESSED = "33333333-3333-4333-8333-333333333332";
const SUB_CANDIDATE = "33333333-3333-4333-8333-333333333333";
const SUB_EXCLUDED = "33333333-3333-4333-8333-333333333334";
/** Karencja NOWYCH kategorii I9d - inna niż starych (seed +14 dni po wdrożeniu). */
const Y1_GRACE = "2026-11-05T09:00:00+00:00";

/** Kategoria edytowalna I9d-Y1 w trybie podglądu (własna karencja). */
function y1Category(
  key: DataRetentionCategoryDto["key"],
  period: { months: number; min: number; max: number },
): DataRetentionCategoryDto {
  return {
    key,
    editable: true,
    periodMonths: period.months,
    defaultMonths: period.months,
    minMonths: period.min,
    maxMonths: period.max,
    enabled: true,
    enforceAfter: Y1_GRACE,
    enforced: false,
    cutoff: "2025-10-20T00:00:00+00:00",
    updatedAt: TOKEN,
    stored: true,
    lastRun: null,
  };
}

function due(
  overrides: Partial<DataRetentionNewsletterDueDto> = {},
): DataRetentionNewsletterDueDto {
  return {
    counts: { candidates: 3, requested: 1, mailed: 2, due: 0, excluded: 1 },
    items: [
      {
        subscriberId: SUB_MAILED,
        email: "anna.kowalska@example.test",
        firstName: "Anna",
        lastName: "Kowalska",
        language: "pl",
        state: "mailed",
        lastEngagedAt: "2025-08-01T10:00:00+00:00",
        requestedAt: "2026-10-20T02:10:00+00:00",
        mailedAt: "2026-10-20T09:09:00+00:00",
        mailOutcome: "queued",
        deleteAfter: "2026-11-19T09:09:00+00:00",
      },
      {
        subscriberId: SUB_SUPPRESSED,
        email: "jan@partner.test",
        firstName: null,
        lastName: null,
        language: "en",
        state: "mailed",
        lastEngagedAt: "2025-07-01T10:00:00+00:00",
        requestedAt: "2026-10-20T02:10:00+00:00",
        mailedAt: "2026-10-20T09:19:00+00:00",
        mailOutcome: "suppressed",
        deleteAfter: "2026-11-19T09:19:00+00:00",
      },
      {
        subscriberId: SUB_CANDIDATE,
        email: "ola@example.test",
        firstName: "Ola",
        lastName: null,
        language: "pl",
        state: "candidate",
        lastEngagedAt: null,
        requestedAt: null,
        mailedAt: null,
        mailOutcome: null,
        deleteAfter: null,
      },
    ],
    excluded: [
      {
        subscriberId: SUB_EXCLUDED,
        email: "instytut@think.test",
        reason: "Prenumerata instytucjonalna",
        createdAt: "2026-10-21T10:00:00+00:00",
      },
    ],
    responseDays: 30,
    dailyCap: 200,
    openTrackingEnabled: true,
    enabled: true,
    enforced: false,
    cutoff: "2025-10-20T00:00:00+00:00",
    periodMonths: 12,
    ...overrides,
  };
}

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
      y1Category("metered_views", { months: 3, min: 2, max: 13 }),
      y1Category("newsletter_inactive", { months: 12, min: 6, max: 24 }),
      y1Category("event_attendees", { months: 24, min: 12, max: 36 }),
      y1Category("club_applications", { months: 24, min: 12, max: 36 }),
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
    h.newsletterDue,
    h.exclude,
    h.include,
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
        {
          key: "club_applications",
          enabled: true,
          mode: "preview",
          cutoff: "2024-10-20T00:00:00+00:00",
          count: 4,
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
  h.newsletterDue.mockResolvedValue({ state: "ready", data: due() });
  h.exclude.mockResolvedValue({
    ok: true,
    data: { subscriberId: SUB_MAILED, excluded: true, cycleCancelled: true },
  });
  h.include.mockResolvedValue({
    ok: true,
    data: { subscriberId: SUB_EXCLUDED, excluded: false, cycleCancelled: false },
  });
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
    await screen.findByText("an***@example.test");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("karta retencji - kategorie I9d-Y1", () => {
  it("cztery nowe kategorie: nazwa, opis, zakres okresu z katalogu i dymek z podstawą", async () => {
    mount();
    const metered = await screen.findByLabelText(
      "Okres przechowywania: Odczyty licznika artykułów",
    );
    const options = within(metered)
      .getAllByRole("option")
      .map((o) => o.getAttribute("value"));
    expect(options[0]).toBe("2");
    expect(options.at(-1)).toBe("13");
    expect(within(metered).getByRole("option", { name: "3 miesiące (domyślnie)" })).toBeTruthy();
    for (const name of [
      "Odczyty licznika artykułów",
      "Nieaktywni subskrybenci newslettera",
      "Uczestnicy wydarzeń bez konta",
      "Zgłoszenia do klubów",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: `Podstawa prawna i standard: ${name}` }),
      ).toBeTruthy();
    }
    // Żaden surowy klucz nowej kategorii nie wycieka na ekran.
    expect(document.body.textContent).not.toMatch(/adminDataRetention\./);
    // Reguła stała (30 dni na reakcję) wchodzi do opisu skutków ze stałej TS.
    expect(
      screen.getByText(/Bez reakcji przez 30 dni wiersz subskrybenta jest usuwany/),
    ).toBeTruthy();
    expect(screen.getByText(/RODO art\. 6 ust\. 1 lit\. b \(rozpatrzenie zgłoszenia/)).toBeTruthy();
    expect(await screen.findByText(/4 rekordy starsze niż/)).toBeTruthy();
  });

  it("różne terminy karencji: wiersz nowej kategorii mówi, do kiedy tylko liczy", async () => {
    mount();
    await screen.findByLabelText("Okres przechowywania: Zgłoszenia do klubów");
    // 4 nowe kategorie (5.11) + stare (3.11) - każda w podglądzie ma termin w wierszu.
    expect(screen.getAllByText(/^Karencja: do .* przebieg tylko liczy/).length).toBe(6);
  });

  it("jeden wspólny termin karencji: bez powtórzeń w wierszach (wystarczy nagłówek)", async () => {
    const base = state();
    h.get.mockResolvedValue({
      state: "ready",
      data: {
        ...base,
        categories: base.categories.map((c) => ({ ...c, enforceAfter: Y1_GRACE })),
      },
    });
    mount();
    await screen.findByLabelText("Okres przechowywania: Zgłoszenia do klubów");
    expect(screen.queryByText(/^Karencja: do .* przebieg tylko liczy/)).toBeNull();
  });
});

describe("karta retencji - nieaktywni subskrybenci do wygaszenia", () => {
  it("liczby, adres maskowany (bez imienia), stan prośby i termin usunięcia", async () => {
    mount();
    const list = (
      await screen.findByRole("heading", {
        name: "Nieaktywni subskrybenci - do wygaszenia",
      })
    ).closest("section") as HTMLElement;
    expect(await within(list).findByText("an***@example.test")).toBeTruthy();
    expect(document.body.textContent).not.toContain("anna.kowalska@example.test");
    expect(within(list).queryByText(/Kowalska/)).toBeNull();
    expect(within(list).getAllByText(/^Prośba wysłana \d/).length).toBe(1);
    expect(within(list).getByText(/^Adres na liście wyłączeń - prośba nie wyszła/)).toBeTruthy();
    expect(within(list).getAllByText("Prośba w najbliższym przebiegu").length).toBe(2);
    expect(within(list).getByText("30 dni po wysłaniu prośby")).toBeTruthy();
    expect(within(list).getAllByText(/^po \d/).length).toBe(2);
    expect(within(list).getByText("brak")).toBeTruthy();
    const counts = within(list).getByLabelText("Stan wygaszania");
    expect(within(counts).getByText("Prośba wysłana - biegnie czas na reakcję")).toBeTruthy();
    expect(
      within(list).getByText(/Karencja: do .* prośby nie wychodzą, nikt nie jest usuwany/),
    ).toBeTruthy();
    expect(within(list).getByText(/Najwyżej 200 próśb na dobę/)).toBeTruthy();
    expect(
      within(list).getByRole("link", { name: "Treść prośby i podgląd maila" }).getAttribute("href"),
    ).toBe("/admin/newsletter/email-content");
  });

  it("dymek zaangażowania zawsze: Gmail liczy się jak człowiek, Apple MPP nie", async () => {
    mount();
    expect(
      await screen.findByRole("button", {
        name: "Co liczy się jako zaangażowanie: Nieaktywni subskrybenci newslettera",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/proxy obrazów Gmaila liczy się jak ludzkie/)).toBeTruthy();
    expect(screen.getByText(/Apple Mail Privacy Protection się nie liczy/)).toBeTruthy();
    expect(screen.queryByText("Zaangażowanie liczone bez otwarć")).toBeNull();
  });

  it("pomiar otwarć wyłączony: znacznik „bez otwarć” z dymkiem", async () => {
    h.newsletterDue.mockResolvedValue({
      state: "ready",
      data: due({ openTrackingEnabled: false }),
    });
    mount();
    expect(await screen.findByText("Zaangażowanie liczone bez otwarć")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Dlaczego bez otwarć: Nieaktywni subskrybenci newslettera",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/otwarcia nie są zapisywane i nie odsuwają prośby/)).toBeTruthy();
  });

  it("wykluczenie: powód poniżej 3 znaków blokuje zapis, poprawny - RPC i komunikat o anulowanej prośbie", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Wyklucz z wygaszania: an***@example.test" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/an\*\*\*@example\.test nie dostanie prośby/)).toBeTruthy();
    const reason = within(dialog).getByLabelText("Powód wykluczenia");
    fireEvent.change(reason, { target: { value: "ab" } });
    const confirm = within(dialog).getByRole("button", { name: "Wyklucz adres" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByText(/Powód musi mieć od 3 do 500 znaków/)).toBeTruthy();
    fireEvent.change(reason, { target: { value: "x".repeat(501) } });
    expect(
      within(dialog).getByRole("button", { name: "Wyklucz adres" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(reason, { target: { value: "Partner - prenumerata redakcyjna" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Wyklucz adres" }));
    await waitFor(() =>
      expect(h.exclude).toHaveBeenCalledWith({
        data: { subscriberId: SUB_MAILED, reason: "Partner - prenumerata redakcyjna" },
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Adres wykluczony - prośba w toku została anulowana.",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cofnięcie wykluczenia z powodem; subskrybent już nie istnieje - komunikat, okno zostaje", async () => {
    h.include.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
      reason: "exclusion_not_found",
    });
    mount();
    const list = (await screen.findByRole("heading", { name: "Wykluczone adresy" })).closest(
      "[role=region]",
    ) as HTMLElement;
    expect(within(list).getByText("Prenumerata instytucjonalna")).toBeTruthy();
    fireEvent.click(
      within(list).getByRole("button", { name: "Cofnij wykluczenie: in***@think.test" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Powód cofnięcia"), {
      target: { value: "Umowa wygasła" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cofnij wykluczenie" }));
    await waitFor(() =>
      expect(h.include).toHaveBeenCalledWith({
        data: { subscriberId: SUB_EXCLUDED, reason: "Umowa wygasła" },
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Subskrybent już nie istnieje albo nie jest wykluczony.",
      ),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cofnij wykluczenie" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Wykluczenie cofnięte."));
  });

  it("kategoria wyłączona: komunikat zamiast karencji", async () => {
    h.newsletterDue.mockResolvedValue({ state: "ready", data: due({ enabled: false }) });
    mount();
    expect(
      await screen.findByText(
        "Kategoria wyłączona - nikt nie dostanie prośby ani nie zostanie usunięty.",
      ),
    ).toBeTruthy();
  });

  it("baza bez kategorii wygaszania (front nowszy niż migracja): listy nie ma, RPC nie jest wołane", async () => {
    const base = state();
    h.get.mockResolvedValue({
      state: "ready",
      data: { ...base, categories: base.categories.filter((c) => c.key !== "newsletter_inactive") },
    });
    mount();
    await screen.findByText(/7 rekordów starszych niż/);
    expect(screen.queryByText("Nieaktywni subskrybenci - do wygaszenia")).toBeNull();
    expect(h.newsletterDue).not.toHaveBeenCalled();
  });

  it("brak naruszeń axe przy wyłączonym pomiarze otwarć; okno wykluczenia osobno", async () => {
    h.newsletterDue.mockResolvedValue({
      state: "ready",
      data: due({ openTrackingEnabled: false }),
    });
    const { container } = mount();
    const exclude = await screen.findByRole("button", {
      name: "Wyklucz z wygaszania: ol***@example.test",
    });
    await screen.findByText("Zaangażowanie liczone bez otwarć");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
    // Otwarte okno modalne ukrywa tło (`aria-hidden`) - axe tła z otwartym
    // oknem mierzyłby mechanikę okna, nie kartę; okno sprawdzane osobno.
    fireEvent.click(exclude);
    const dialogViolations = await axeViolations(await screen.findByRole("dialog"));
    expect(dialogViolations, summarize(dialogViolations)).toEqual([]);
  });
});

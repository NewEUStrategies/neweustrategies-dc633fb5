// Ekran „Raport dla sponsorów" w studiu wydarzenia (`SponsorReportPanel`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. „NIE WIEM" JAKO ZERO. Zanim baza odpowie (albo gdy odmówi), KAŻDY kafel
//      to kreska; CTR przy zerze wyświetleń to kreska, a nie „0%".
//   2. FILTR SPONSORA ZAWĘŻA LISTĘ, Z KTÓREJ SIĘ WYBIERA. Podsumowanie (tabela
//      sponsorów) idzie zawsze bez sponsora, a kafle, wykres i rozbicie - z nim.
//   3. SZEREG Z DZIURAMI. Wykres dostaje dzień bez pomiaru jako zero.
//   4. EKSPORT: pusty plik, plik z innymi kolumnami niż nagłówek, kontakty bez
//      filtra sponsora albo awaria bez słowa.
//   5. CRM BEZ POTWIERDZENIA, bez licznika wyniku, bez ostrzeżenia o błędach.
//   6. LINK DLA SPONSORA z wiersza tabeli dla ZŁEGO sponsora.
//
// ATRAPY: hooki zapytań (liczy się, z czym panel je woła i co rysuje z ich
// danych), dwa sąsiednie organizmy z własnymi testami (okno linku, lista
// linków), karta wykresu (silnik wykresów ma własne testy - tutaj liczy się
// konfiguracja), pobieranie pliku i proces arkuszy. Model raportu, etykiety,
// eksport metryk i reguła CSV biegną prawdziwe.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import { freezeClock } from "@/test/time";
import type { ChartConfig } from "@/lib/charts/types";
import type { LeadExportFile } from "@/lib/events/leadExport";
import type {
  SponsorReportLeadsSeriesRow,
  SponsorReportQuery,
  SponsorReportSeriesRow,
  SponsorReportSummaryRow,
} from "@/lib/events/sponsorReportApi";

type Result = { onSuccess?: (value: unknown) => void; onError?: (error: unknown) => void };
type Q<T> = { data: T | undefined; isPending: boolean; isError: boolean; error: unknown };

const h = vi.hoisted(() => ({
  summary: { data: undefined, isPending: true, isError: false, error: null } as Q<unknown[]>,
  series: { data: undefined, isPending: true, isError: false, error: null } as Q<unknown[]>,
  leads: { data: undefined, isPending: true, isError: false, error: null } as Q<unknown[]>,
  queries: { summary: [] as unknown[], series: [] as unknown[], leads: [] as unknown[] },
  push: [] as unknown[],
  pushOutcome: {} as Record<string, number> | Error,
  pushPending: false,
  confirms: [] as unknown[],
  answer: true,
  share: [] as {
    open: boolean;
    sponsorId: string;
    sponsors: unknown;
    onOpenChange: (o: boolean) => void;
  }[],
  linksPanel: [] as unknown[],
  charts: [] as ChartConfig[],
  leadRows: [] as unknown[],
  leadArgs: [] as unknown[],
  leadFails: false,
  downloads: [] as LeadExportFile[],
  sheets: [] as unknown[][][],
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (request: unknown) => {
    h.confirms.push(request);
    return h.answer;
  },
}));
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/lib/events/useSponsorReport", () => ({
  useSponsorReportSummary: (query: SponsorReportQuery) => {
    h.queries.summary.push(query);
    return h.summary;
  },
  useSponsorReportSeries: (query: SponsorReportQuery) => {
    h.queries.series.push(query);
    return h.series;
  },
  useSponsorReportLeadsSeries: (query: SponsorReportQuery) => {
    h.queries.leads.push(query);
    return h.leads;
  },
  usePushLeadScansToCrm: () => ({
    isPending: h.pushPending,
    mutate: (input: unknown, result: Result) => {
      h.push.push(input);
      if (h.pushOutcome instanceof Error) result.onError?.(h.pushOutcome);
      else result.onSuccess?.(h.pushOutcome);
    },
  }),
}));
vi.mock("@/components/admin/events/molecules/SponsorReportShareDialog", () => ({
  SponsorReportShareDialog: (props: (typeof h.share)[number]) => {
    h.share.push(props);
    return props.open ? <div data-testid="share-dialog" data-sponsor={props.sponsorId} /> : null;
  },
}));
vi.mock("@/components/admin/events/organisms/SponsorReportLinksPanel", () => ({
  SponsorReportLinksPanel: (props: unknown) => {
    h.linksPanel.push(props);
    return <div data-testid="links-panel" />;
  },
}));
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: ({ config }: { config: ChartConfig }) => {
    h.charts.push(config);
    return <div data-testid="chart" />;
  },
}));
vi.mock("@/lib/events/onsiteApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/onsiteApi")>()),
  fetchLeadScansExport: async (...args: unknown[]) => {
    h.leadArgs.push(args);
    if (h.leadFails) throw new Error("forbidden");
    return h.leadRows;
  },
}));
vi.mock("@/lib/events/leadExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/leadExport")>()),
  downloadLeadExport: (file: LeadExportFile) => h.downloads.push(file),
}));
vi.mock("@/lib/files/spreadsheetWorker", () => ({
  writeSpreadsheetInWorker: async (_name: string, rows: unknown[][]) => {
    h.sheets.push(rows);
    return new Uint8Array([1]);
  },
}));

const { SponsorReportPanel } =
  await import("@/components/admin/events/organisms/SponsorReportPanel");

// Dni szeregu (czerwiec 2099) i nazwa pliku eksportu (dzień „teraz") liczą się
// od tej samej, zamrożonej chwili - 15.06.2099, 12:00 UTC.
freezeClock();

const R = "adminEventSponsorReport";
const SP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function summary(patch: Partial<SponsorReportSummaryRow>): SponsorReportSummaryRow {
  return {
    active_links: 0,
    clicks_total: 0,
    clicks_unique: 0,
    company_id: "c1",
    is_published: true,
    lead_scans_total: 0,
    leads_avg_rating: null as unknown as number,
    leads_consented: 0,
    leads_total: 0,
    material_opens: 0,
    meetings_accepted: 0,
    meetings_held: 0,
    meetings_total: 0,
    role: "sponsor",
    sponsor_id: SP_A,
    sponsor_logo_url: "",
    sponsor_name: "Acme",
    tier_id: "t1",
    tier_name_en: "Gold",
    tier_name_pl: "Złoty",
    tier_rank: 30,
    views_total: 0,
    views_unique: 0,
    ...patch,
  };
}

function series(patch: Partial<SponsorReportSeriesRow>): SponsorReportSeriesRow {
  return {
    clicks_total: 0,
    clicks_unique: 0,
    day: "2099-06-15",
    material_opens: 0,
    placement: "home_strip",
    sponsor_id: SP_A,
    views_total: 0,
    views_unique: 0,
    ...patch,
  };
}

const SUMMARY = [
  summary({
    views_unique: 10,
    views_total: 14,
    clicks_unique: 2,
    clicks_total: 3,
    material_opens: 1,
    leads_total: 4,
    leads_consented: 2,
    // Zaproszeń 5 (z odmowami i bez odpowiedzi), umówionych 3 - ekran
    // pokazuje umówione, nie zaproszenia.
    meetings_total: 5,
    meetings_accepted: 3,
    meetings_held: 1,
    active_links: 1,
  }),
  summary({
    sponsor_id: SP_B,
    sponsor_name: "Beta",
    role: "media_partner",
    is_published: false,
    tier_name_pl: "",
    tier_name_en: "",
  }),
];

const SERIES = [
  series({ day: "2099-06-15", views_unique: 6, views_total: 8, clicks_unique: 2, clicks_total: 3 }),
  series({ day: "2099-06-17", placement: "materials", views_unique: 4, material_opens: 1 }),
];

const LEADS: SponsorReportLeadsSeriesRow[] = [
  { day: "2099-06-16", leads_new: 3, leads_new_consented: 1, sponsor_id: SP_A },
];

function ready<T>(data: T[]): Q<T[]> {
  return { data, isPending: false, isError: false, error: null } as Q<T[]>;
}

function panel(initialSponsorId: string | null = null) {
  return render(
    <SponsorReportPanel
      row={adminEventDetailRow({ ends_at: "2099-06-21T16:00:00Z" })}
      initialSponsorId={initialSponsorId}
    />,
  );
}

/** Wiersz tabeli sponsorów po nazwie sponsora (nazwa stoi też w selektorze filtra). */
function sponsorRow(name: string): HTMLElement {
  const cell = screen.getAllByText(name).find((node) => node.closest("tr") !== null);
  if (cell === undefined) throw new Error(`brak wiersza sponsora ${name}`);
  return cell.closest("tr") as HTMLElement;
}

/** Wartość kafla po jego etykiecie. */
function tile(label: string): string {
  const card = screen.getByText(`${R}.kpi.${label}`).closest("div")?.parentElement;
  return card?.children[1]?.textContent ?? "";
}

beforeEach(() => {
  h.summary = { data: undefined, isPending: true, isError: false, error: null };
  h.series = { data: undefined, isPending: true, isError: false, error: null };
  h.leads = { data: undefined, isPending: true, isError: false, error: null };
  h.queries = { summary: [], series: [], leads: [] };
  h.push = [];
  h.pushOutcome = {
    persons: 4,
    created: 1,
    updated: 1,
    skippedNoEmail: 1,
    skippedNoConsent: 1,
    failed: 0,
  };
  h.pushPending = false;
  h.confirms = [];
  h.answer = true;
  h.share = [];
  h.linksPanel = [];
  h.charts = [];
  h.leadRows = [];
  h.leadArgs = [];
  h.leadFails = false;
  h.downloads = [];
  h.sheets = [];
  for (const fn of Object.values(h.toast)) fn.mockClear();
});

describe("kafle", () => {
  it("zanim baza odpowie, KAŻDY kafel to kreska, a tabela mówi, że wczytuje", () => {
    panel();
    for (const label of ["views", "clicks", "ctr", "materialOpens", "leads", "meetings"]) {
      expect(tile(label), label).toBe("-");
    }
    expect(screen.getByText(`${R}.loading`)).toBeTruthy();
    expect(screen.getByText(`${R}.chart.empty`)).toBeTruthy();
    expect(screen.getByText(`${R}.placementTable.empty`)).toBeTruthy();
  });

  it("odmowa bazy: kafle zostają kreską, a tabela mówi zdaniem zamiast kodu", () => {
    h.summary = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("forbidden: x"),
    };
    panel();
    expect(tile("views")).toBe("-");
    expect(screen.queryByText(/forbidden:/)).toBeNull();
  });

  it("sumy wszystkich sponsorów z podpowiedziami; CTR z wyświetleń unikalnych", () => {
    h.summary = ready(SUMMARY);
    panel();
    expect(tile("views")).toBe("10");
    expect(screen.getByText(`${R}.kpi.viewsHint(count=14)`)).toBeTruthy();
    expect(tile("clicks")).toBe("2");
    expect(tile("ctr")).toBe("20%");
    expect(tile("materialOpens")).toBe("1");
    expect(tile("leads")).toBe("4");
    expect(screen.getByText(`${R}.kpi.leadsHint(count=2)`)).toBeTruthy();
    expect(tile("meetings")).toBe("1");
    expect(screen.getByText(`${R}.kpi.meetingsHint(count=3)`)).toBeTruthy();
  });

  it("zero wyświetleń: CTR to kreska, nie „0%”", () => {
    h.summary = ready([summary({ clicks_unique: 0, views_unique: 0 })]);
    panel();
    expect(tile("views")).toBe("0");
    expect(tile("ctr")).toBe("-");
  });

  it("nota o zgodzie stoi przy kaflach", () => {
    h.summary = ready(SUMMARY);
    panel();
    expect(screen.getByText(`${R}.consentNote`)).toBeTruthy();
  });
});

describe("filtry i zapytania", () => {
  it("sponsor z adresu zawęża kafle i szeregi, ale NIE listę sponsorów", () => {
    h.summary = ready(SUMMARY);
    panel(SP_B);
    expect(tile("views")).toBe("0");
    expect(h.queries.summary.at(-1)).toMatchObject({ eventId: STUDIO_EVENT_ID, sponsorId: null });
    expect(h.queries.series.at(-1)).toMatchObject({ eventId: STUDIO_EVENT_ID, sponsorId: SP_B });
    expect(h.queries.leads.at(-1)).toMatchObject({ sponsorId: SP_B });
    expect(screen.getAllByRole("row").length).toBeGreaterThan(2);
  });

  it("zmiana miejsca i dni trafia do wszystkich trzech zapytań", () => {
    h.summary = ready(SUMMARY);
    panel();
    fireEvent.change(screen.getByLabelText(`${R}.filters.placement`), {
      target: { value: "materials" },
    });
    fireEvent.change(screen.getByLabelText(`${R}.filters.from`), {
      target: { value: "2099-06-01" },
    });
    for (const list of [h.queries.summary, h.queries.series, h.queries.leads]) {
      expect(list.at(-1)).toMatchObject({ placement: "materials", from: "2099-06-01", to: null });
    }
  });

  it("filtr sponsora wybiera się z listy sponsorów podsumowania", () => {
    h.summary = ready(SUMMARY);
    panel();
    const select = screen.getByLabelText<HTMLSelectElement>(`${R}.filters.sponsor`);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      `${R}.filters.allSponsors`,
      "Acme",
      "Beta",
    ]);
    fireEvent.change(select, { target: { value: SP_A } });
    expect(tile("views")).toBe("10");
    expect(h.queries.series.at(-1)).toMatchObject({ sponsorId: SP_A });
  });
});

describe("tabela sponsorów", () => {
  it("wiersz: nazwa, rola, poziom, liczby, CTR i aktywne linki; brak poziomu i szkic mają etykiety", () => {
    h.summary = ready(SUMMARY);
    panel();
    const acme = sponsorRow("Acme");
    const a = within(acme);
    expect(a.getByText(`${R}.roles.sponsor`)).toBeTruthy();
    expect(a.getByText("Złoty")).toBeTruthy();
    expect(a.getByText(`${R}.table.totalHint(count=14)`)).toBeTruthy();
    expect(a.getByText("20%")).toBeTruthy();
    expect(acme.textContent).toContain("4 (2)");
    expect(acme.textContent).toContain("3 (1)");

    const beta = within(sponsorRow("Beta"));
    expect(beta.getByText(`${R}.roles.mediaPartner`)).toBeTruthy();
    expect(beta.getByText(`${R}.table.noTier`)).toBeTruthy();
    expect(beta.getByText(`${R}.table.unpublished`)).toBeTruthy();
    expect(beta.getByText("-")).toBeTruthy();
  });

  it("wydarzenie bez sponsorów mówi to zdaniem", () => {
    h.summary = ready([]);
    panel();
    expect(screen.getByText(`${R}.empty`)).toBeTruthy();
  });

  it("„udostępnij” z wiersza otwiera okno linku dla TEGO sponsora; zamknięcie je chowa", () => {
    h.summary = ready(SUMMARY);
    panel();
    expect(screen.queryByTestId("share-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `${R}.table.shareFor(name=Beta)` }));
    expect(screen.getByTestId("share-dialog").getAttribute("data-sponsor")).toBe(SP_B);
    const last = h.share.at(-1)!;
    expect(last.sponsors).toEqual([
      { id: SP_A, name: "Acme" },
      { id: SP_B, name: "Beta" },
    ]);
    act(() => last.onOpenChange(true));
    expect(screen.getByTestId("share-dialog")).toBeTruthy();
    act(() => last.onOpenChange(false));
    expect(screen.queryByTestId("share-dialog")).toBeNull();
  });

  it("przycisk nad listą linków otwiera okno ze sponsorem z filtra (albo do wyboru)", () => {
    h.summary = ready(SUMMARY);
    const first = panel();
    const buttons = screen.getAllByRole("button", { name: `${R}.table.share` });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByTestId("share-dialog").getAttribute("data-sponsor")).toBe("");
    first.unmount();
    panel(SP_A);
    const again = screen.getAllByRole("button", { name: `${R}.table.share` });
    fireEvent.click(again[again.length - 1]);
    expect(screen.getByTestId("share-dialog").getAttribute("data-sponsor")).toBe(SP_A);
    expect(h.linksPanel.at(-1)).toEqual({ eventId: STUDIO_EVENT_ID, timezone: "Europe/Warsaw" });
  });
});

describe("wykres i rozbicie na miejsca", () => {
  it("wykres dostaje szereg dzienny bez dziur: wyświetlenia, kliknięcia, kontakty", () => {
    h.summary = ready(SUMMARY);
    h.series = ready(SERIES);
    h.leads = ready(LEADS);
    panel();
    expect(screen.getByTestId("chart")).toBeTruthy();
    const config = h.charts.at(-1)!;
    expect(config.categories).toHaveLength(3);
    expect(config.series.map((s) => [s.name, s.values])).toEqual([
      [`${R}.chart.views`, [6, 0, 4]],
      [`${R}.chart.clicks`, [2, 0, 0]],
      [`${R}.chart.leads`, [0, 3, 0]],
    ]);
  });

  it("rozbicie: sponsor x miejsce z etykietą miejsca i CTR (kreska przy zerze)", () => {
    h.summary = ready(SUMMARY);
    h.series = ready([...SERIES, series({ sponsor_id: SP_B, placement: "home_ad" })]);
    panel();
    const rows = screen
      .getAllByText(/placements\./)
      .map((node) => node.closest("tr")?.textContent ?? null)
      .filter((row): row is string => row !== null);
    expect(rows).toEqual([
      expect.stringContaining(`Acme${R}.placements.homeStrip`),
      expect.stringContaining(`Acme${R}.placements.materials`),
      expect.stringContaining(`Beta${R}.placements.homeAd`),
    ]);
    expect(rows[0]).toContain("33,3%");
    expect(rows[2]).toContain("-");
  });
});

describe("eksport", () => {
  const click = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${R}.export.${name}` }));
    });
  };

  it("metryki CSV: nagłówki ze słownika, wiersze dzień x sponsor x miejsce", async () => {
    h.summary = ready(SUMMARY);
    h.series = ready(SERIES);
    panel();
    await click("metricsCsv");
    expect(h.downloads).toHaveLength(1);
    const csv = String(h.downloads[0].data).slice(1).split("\n");
    expect(csv[0]).toBe(
      [
        "day",
        "sponsor",
        "placement",
        "viewsUnique",
        "viewsTotal",
        "clicksUnique",
        "clicksTotal",
        "ctr",
        "materialOpens",
      ]
        .map((c) => `${R}.export.columns.${c}`)
        .join(","),
    );
    expect(csv[1]).toBe(`2099-06-15,Acme,${R}.placements.homeStrip,6,8,2,3,33.3,0`);
    expect(csv[2]).toBe(`2099-06-17,Acme,${R}.placements.materials,4,0,0,0,0,1`);
    expect(h.downloads[0].fileName.endsWith(".csv")).toBe(true);
    expect(h.toast.success).toHaveBeenCalledWith(`${R}.export.done`);
  });

  it("metryki XLSX idą przez proces arkuszy", async () => {
    h.summary = ready(SUMMARY);
    h.series = ready(SERIES);
    panel();
    await click("metricsXlsx");
    expect(h.sheets).toHaveLength(1);
    expect(h.downloads[0].fileName.endsWith(".xlsx")).toBe(true);
  });

  it("sponsor spoza podsumowania i miejsce spoza listy nie wywracają pliku", async () => {
    // Szereg może wyprzedzić podsumowanie (sponsor odpięty między zapytaniami),
    // a starsza baza może oddać miejsce, którego front jeszcze nie zna.
    h.summary = ready(SUMMARY);
    h.series = ready([series({ sponsor_id: "odpiety", placement: "billboard", views_unique: 1 })]);
    panel();
    await click("metricsCsv");
    const csv = String(h.downloads[0].data).slice(1).split("\n");
    expect(csv[1]).toBe("2099-06-15,,billboard,1,0,0,0,0,0");
  });

  it("szereg jeszcze w locie: eksport metryk mówi, że nie ma czego zapisać", async () => {
    h.summary = ready(SUMMARY);
    panel();
    await click("metricsXlsx");
    expect(h.downloads).toEqual([]);
    expect(h.toast.info).toHaveBeenCalledWith(`${R}.export.empty`);
  });

  it("brak pomiarów: zamiast pustego pliku komunikat", async () => {
    h.summary = ready(SUMMARY);
    h.series = ready([]);
    panel();
    await click("metricsCsv");
    expect(h.downloads).toEqual([]);
    expect(h.toast.info).toHaveBeenCalledWith(`${R}.export.empty`);
  });

  it("kontakty: funkcja eksportu odprawy z filtrem sponsora; pusty wynik to komunikat", async () => {
    h.summary = ready(SUMMARY);
    panel(SP_A);
    await click("leadsCsv");
    expect(h.leadArgs).toEqual([[STUDIO_EVENT_ID, SP_A]]);
    expect(h.downloads).toEqual([]);
    expect(h.toast.info).toHaveBeenCalledWith(`${R}.export.empty`);
  });

  it("kontakty XLSX bez filtra sponsora - wszyscy sponsorzy", async () => {
    h.summary = ready(SUMMARY);
    h.leadRows = [
      {
        sponsor_name: "Acme",
        first_name: "Anna",
        last_name: "Nowak",
        company: "NES",
        job_title: "Analityk",
        email: "anna@example.org",
        phone: null,
        consent: true,
        consent_snapshot_at: null,
        interest_rating: 4,
        note: null,
        scan_count: 1,
        first_scanned_at: null,
        last_scanned_at: null,
        device_label: null,
      },
    ];
    panel();
    await click("leadsXlsx");
    expect(h.leadArgs).toEqual([[STUDIO_EVENT_ID, undefined]]);
    expect(h.downloads[0].fileName.endsWith(".xlsx")).toBe(true);
  });

  it("awaria eksportu kończy się komunikatem i odblokowuje przyciski", async () => {
    h.summary = ready(SUMMARY);
    h.leadFails = true;
    panel();
    await click("leadsCsv");
    expect(h.toast.error).toHaveBeenCalledWith(`${R}.export.failed`);
    expect(screen.getByRole("button", { name: `${R}.export.leadsCsv` })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("przeniesienie kontaktów do CRM", () => {
  const push = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${R}.crm.push` }));
    });
  };

  it("pyta o potwierdzenie i po zgodzie przenosi kontakty z filtrem sponsora; wynik w komunikacie", async () => {
    h.summary = ready(SUMMARY);
    panel(SP_A);
    await push();
    expect(h.confirms).toEqual([
      {
        title: `${R}.crm.confirmTitle`,
        description: `${R}.crm.confirmBody`,
        confirmLabel: `${R}.crm.confirmAction`,
      },
    ]);
    expect(h.push).toEqual([{ eventId: STUDIO_EVENT_ID, sponsorId: SP_A }]);
    expect(h.toast.success).toHaveBeenCalledWith(`${R}.crm.done(created=1,skipped=2,updated=1)`);
    expect(h.toast.warning).not.toHaveBeenCalled();
  });

  it("nieudane pozycje dostają osobne ostrzeżenie", async () => {
    h.summary = ready(SUMMARY);
    h.pushOutcome = {
      persons: 2,
      created: 1,
      updated: 0,
      skippedNoEmail: 0,
      skippedNoConsent: 0,
      failed: 1,
    };
    panel();
    await push();
    expect(h.push).toEqual([{ eventId: STUDIO_EVENT_ID, sponsorId: null }]);
    expect(h.toast.warning).toHaveBeenCalledWith(`${R}.crm.failedSome(count=1)`);
  });

  it("odmowa w oknie niczego nie przenosi; odmowa bazy mówi zdaniem", async () => {
    h.summary = ready(SUMMARY);
    h.answer = false;
    const first = panel();
    await push();
    expect(h.push).toEqual([]);
    first.unmount();

    h.answer = true;
    h.pushOutcome = new Error("forbidden: event admin required");
    panel();
    await push();
    expect(h.toast.error).toHaveBeenCalledTimes(1);
    expect(String(h.toast.error.mock.calls[0]?.[0])).not.toContain("forbidden:");
  });

  it("w trakcie przenoszenia przycisk jest zgaszony, a obok stoi odnośnik do kontaktów odprawy", () => {
    h.summary = ready(SUMMARY);
    h.pushPending = true;
    panel();
    expect(screen.getByRole("button", { name: `${R}.crm.push` })).toHaveProperty("disabled", true);
    expect(screen.getByRole("link", { name: `${R}.crm.leadsLink` }).getAttribute("href")).toBe(
      `/admin/events/${STUDIO_EVENT_ID}/onsite/leads`,
    );
  });

  it("nagłówek ekranu to etykieta sekcji z sidebara", () => {
    panel();
    expect(
      screen.getByRole("heading", { level: 1, name: "adminEvents.studio.sections.sponsorReport" }),
    ).toBeTruthy();
  });
});

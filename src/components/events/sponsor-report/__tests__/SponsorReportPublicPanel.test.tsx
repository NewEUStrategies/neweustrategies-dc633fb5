// Strona raportu dla sponsora bez konta: organizm wczytujący
// (`SponsorReportPublicPanel`) i sam rysunek raportu (`SponsorReportPublicView`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. TOKEN ZOSTAJE W PASKU ADRESU (historia, zrzut ekranu, zakładka) albo
//      w ogóle nie jest czytany z fragmentu `#t=`.
//   2. ZŁY TOKEN IDZIE DO SERWERA i zjada limit prób.
//   3. „SPRÓBUJ PONOWNIE" PRZY ODPOWIEDZI OSTATECZNEJ - „nie znaleziono"
//      i „wygasł" nie mają przycisku; limit i błąd mają, i ponawiają TYM
//      SAMYM tokenem.
//   4. „NIE WIEM" JAKO ZERO - CTR bez wyświetleń to kreska.
//   5. KONTAKTY: „organizator nie dołączył listy" to co innego niż „lista jest
//      pusta"; plik kontaktów nie niesie danych osoby bez zgody.
//   6. POBIERANIE BEZ STANU - w trakcie przyciski są zgaszone, awaria mówi
//      zdaniem.
//
// ATRAPY: funkcja serwerowa (granica sieci), silnik wykresu (ma własne
// testy - tu liczy się konfiguracja), zapis pliku i proces arkuszy. Parser
// odpowiedzi, model, eksport CSV i reguła zgody biegną prawdziwe.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChartConfig } from "@/lib/charts/types";
import type { LeadExportFile } from "@/lib/events/leadExport";

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  charts: [] as ChartConfig[],
  downloads: [] as LeadExportFile[],
  sheets: [] as unknown[][][],
  sheetFails: false,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/events/sponsorReport.functions", () => ({ getSponsorReportByToken: h.fetch }));
vi.mock("@/components/charts/Chart", () => ({
  Chart: ({ config, ariaLabel }: { config: ChartConfig; ariaLabel?: string }) => {
    h.charts.push(config);
    return <div role="img" aria-label={ariaLabel} />;
  },
}));
vi.mock("@/lib/events/leadExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/leadExport")>()),
  downloadLeadExport: (file: LeadExportFile) => h.downloads.push(file),
}));
vi.mock("@/lib/files/spreadsheetWorker", () => ({
  writeSpreadsheetInWorker: async (_name: string, rows: unknown[][]) => {
    if (h.sheetFails) throw new Error("worker");
    h.sheets.push(rows);
    return new Uint8Array([1]);
  },
}));

const { SponsorReportPublicPanel } =
  await import("@/components/events/sponsor-report/SponsorReportPublicPanel");

const E = "eventSponsorReport";
const TOKEN = "Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab";

function report(patch: Record<string, unknown> = {}) {
  return {
    ok: true,
    generated_at: "2099-06-15T12:00:00Z",
    event: {
      slug: "kongres",
      title_pl: "Kongres Energii",
      title_en: "Energy Congress",
      timezone: "Europe/Warsaw",
      starts_at: "2099-06-20T08:00:00Z",
      ends_at: "2099-06-21T16:00:00Z",
    },
    sponsor: {
      name: "Acme",
      logo_url: "https://cdn.example.org/acme.png",
      role: "sponsor",
      tier_name_pl: "Złoty",
      tier_name_en: "Gold",
    },
    link: { label: "Dla Acme", expires_at: "2099-08-19T23:59:59Z", include_leads: true },
    totals: {
      views_unique: 10,
      views_total: 14,
      clicks_unique: 2,
      clicks_total: 3,
      material_opens: 1,
      leads_total: 2,
      leads_consented: 1,
      meetings_total: 3,
      meetings_held: 1,
    },
    placements: [
      {
        placement: "home_strip",
        views_unique: 10,
        views_total: 14,
        clicks_unique: 2,
        clicks_total: 3,
        material_opens: 0,
      },
      { placement: "materials", views_unique: 0, clicks_unique: 0, material_opens: 1 },
    ],
    series: [
      { day: "2099-06-15", views_unique: 6, clicks_unique: 2, material_opens: 0, leads_new: 1 },
      { day: "2099-06-17", views_unique: 4, clicks_unique: 0, material_opens: 1, leads_new: 1 },
    ],
    leads: [
      {
        sponsor_name: "Acme",
        first_name: "Anna",
        last_name: "Nowak",
        company: "NES",
        job_title: "Analityk",
        email: "anna@example.org",
        phone: "+48 500",
        consent: true,
        interest_rating: 4,
        note: "Oferta",
        scan_count: 2,
      },
      { sponsor_name: "Acme", consent: false, note: "Bez zgody", scan_count: 1 },
    ],
    ...patch,
  };
}

function respond(value: unknown) {
  h.fetch.mockResolvedValue({ json: JSON.stringify(value) });
}

function openAt(hash: string, search = "") {
  window.history.replaceState({ marker: 1 }, "", `/events/kongres/sponsor-report${search}${hash}`);
}

async function mount(strict = false) {
  const node = strict ? (
    <StrictMode>
      <SponsorReportPublicPanel />
    </StrictMode>
  ) : (
    <SponsorReportPublicPanel />
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(node);
  });
  return view;
}

beforeEach(() => {
  h.fetch.mockReset();
  h.charts = [];
  h.downloads = [];
  h.sheets = [];
  h.sheetFails = false;
  respond(report());
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("token z adresu", () => {
  it("token z fragmentu idzie do serwera, a adres traci fragment (zapytanie i stan historii zostają)", async () => {
    openAt(`#t=${TOKEN}`, "?utm=x");
    await mount();
    expect(h.fetch).toHaveBeenCalledWith({ data: { token: TOKEN } });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?utm=x");
    expect(window.history.state).toEqual({ marker: 1 });
    expect(await screen.findByRole("heading", { level: 1, name: "Acme" })).toBeTruthy();
  });

  it("StrictMode (podwójny efekt) nie gubi tokenu, choć fragment znika po pierwszym razie", async () => {
    openAt(`#t=${TOKEN}`);
    await mount(true);
    expect(h.fetch.mock.calls.every(([arg]) => arg.data.token === TOKEN)).toBe(true);
    expect(await screen.findByRole("heading", { level: 1, name: "Acme" })).toBeTruthy();
  });

  it("brak tokenu albo zły kształt: zdanie o niepełnym linku, bez zapytania do serwera", async () => {
    openAt("#t=krotki");
    await mount();
    expect(screen.getByText(`${E}.missingToken`)).toBeTruthy();
    expect(h.fetch).not.toHaveBeenCalled();
    cleanup();
    openAt("");
    await mount();
    expect(screen.getByText(`${E}.missingToken`)).toBeTruthy();
  });

  it("zanim serwer odpowie, strona mówi, że wczytuje", async () => {
    openAt(`#t=${TOKEN}`);
    h.fetch.mockReturnValue(new Promise(() => undefined));
    await mount();
    expect(screen.getByRole("status").textContent).toBe(`${E}.loading`);
  });
});

describe("odmowy", () => {
  it.each([
    ["not_found", `${E}.notFound`],
    ["expired", `${E}.expired`],
  ])("„%s” to odpowiedź ostateczna - bez przycisku ponowienia", async (reason, key) => {
    respond({ ok: false, reason });
    openAt(`#t=${TOKEN}`);
    await mount();
    expect((await screen.findByRole("alert")).textContent).toContain(key);
    expect(screen.queryByRole("button", { name: `${E}.retry` })).toBeNull();
  });

  it("limit prób ponawia TYM SAMYM tokenem i przy sukcesie rysuje raport", async () => {
    respond({ ok: false, reason: "rate_limited" });
    openAt(`#t=${TOKEN}`);
    await mount();
    expect((await screen.findByRole("alert")).textContent).toContain(`${E}.rateLimited`);
    respond(report());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${E}.retry` }));
    });
    expect(h.fetch).toHaveBeenLastCalledWith({ data: { token: TOKEN } });
    expect(await screen.findByRole("heading", { level: 1, name: "Acme" })).toBeTruthy();
  });

  it("wyjątek funkcji serwerowej i zepsuta odpowiedź to zwykły błąd z ponowieniem", async () => {
    h.fetch.mockRejectedValue(new Error("network"));
    openAt(`#t=${TOKEN}`);
    await mount();
    expect((await screen.findByRole("alert")).textContent).toContain(`${E}.error`);
    expect(screen.getByRole("button", { name: `${E}.retry` })).toBeTruthy();
    cleanup();
    h.fetch.mockResolvedValue({ json: "{nie-json" });
    openAt(`#t=${TOKEN}`);
    await mount();
    expect((await screen.findByRole("alert")).textContent).toContain(`${E}.error`);
  });
});

async function showReport(value = report()) {
  respond(value);
  openAt(`#t=${TOKEN}`);
  await mount();
  await screen.findByRole("heading", { level: 1, name: "Acme" });
}

function kpi(label: string): string {
  const card = screen.getByText(`${E}.kpi.${label}`).parentElement;
  return card?.children[1]?.textContent ?? "";
}

describe("raport", () => {
  it("nagłówek: sponsor, poziom, wydarzenie, stan na dzień, ważność linku i nota o zgodzie", async () => {
    await showReport();
    expect(screen.getByText("Złoty")).toBeTruthy();
    expect(screen.getByText(/Kongres Energii/)).toBeTruthy();
    expect(screen.getByText(/generatedAt\(date=/)).toBeTruthy();
    expect(screen.getByText(/validUntil\(date=/)).toBeTruthy();
    expect(screen.getByText(`${E}.consentNote`)).toBeTruthy();
    expect(document.querySelector("header img")?.getAttribute("alt")).toBe("");
  });

  it("kafle z tymi samymi miarami co w studiu", async () => {
    await showReport();
    expect(kpi("views")).toBe("10");
    expect(screen.getByText(`${E}.kpi.viewsHint(count=14)`)).toBeTruthy();
    expect(kpi("clicks")).toBe("2");
    expect(kpi("ctr")).toBe("20%");
    expect(kpi("materialOpens")).toBe("1");
    expect(kpi("leads")).toBe("2");
    expect(kpi("meetings")).toBe("1");
    expect(screen.getByText(`${E}.kpi.meetingsHint(count=3)`)).toBeTruthy();
  });

  it("wykres dzień po dniu bez dziur; tabela miejsc z etykietą i kreską CTR przy zerze", async () => {
    await showReport();
    const config = h.charts.at(-1)!;
    expect(config.series.map((s) => s.values)).toEqual([
      [6, 0, 4],
      [2, 0, 0],
      [1, 0, 1],
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain(`${E}.placements.homeStrip`);
    expect(rows[0].textContent).toContain("20%");
    expect(rows[1].textContent).toContain(`${E}.placements.materials`);
    expect(rows[1].textContent).toContain("-");
  });

  it("raport bez pomiarów: zera, kreska CTR i zdania zamiast pustego wykresu i tabeli", async () => {
    await showReport(
      report({
        generated_at: null,
        link: { include_leads: false },
        event: { slug: "kongres", title_pl: null, title_en: null, timezone: null, starts_at: null },
        sponsor: { name: "Acme", logo_url: null, tier_name_pl: null, tier_name_en: null },
        totals: {},
        placements: [],
        series: [],
        leads: null,
      }),
    );
    expect(kpi("views")).toBe("0");
    expect(kpi("ctr")).toBe("-");
    expect(screen.getByText(`${E}.chart.empty`)).toBeTruthy();
    expect(screen.getByText(`${E}.table.empty`)).toBeTruthy();
    expect(screen.getByText(`${E}.leads.notIncluded`)).toBeTruthy();
    expect(screen.queryByText(/generatedAt/)).toBeNull();
    expect(screen.queryByText(/validUntil/)).toBeNull();
    expect(document.querySelector("header img")).toBeNull();
    expect(h.charts).toEqual([]);
  });

  it("pusta lista kontaktów to inne zdanie niż lista niedołączona", async () => {
    await showReport(report({ leads: [] }));
    expect(screen.getByText(`${E}.leads.empty`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: `${E}.leads.downloadCsv` })).toBeNull();
  });
});

describe("pobieranie", () => {
  const click = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }));
    });
  };

  it("metryki CSV: dzień po dniu, CTR w procentach, kreska jako pusta komórka", async () => {
    await showReport();
    await click(`${E}.download.metricsCsv`);
    const lines = String(h.downloads[0].data).slice(1).split("\n");
    expect(lines[0]).toBe(
      ["day", "viewsUnique", "clicksUnique", "ctr", "materialOpens", "leadsNew"]
        .map((c) => `${E}.download.columns.${c}`)
        .join(","),
    );
    expect(lines.slice(1)).toEqual([
      "2099-06-15,6,2,33.3,0,1",
      "2099-06-16,0,0,,0,0",
      "2099-06-17,4,0,0,1,1",
    ]);
    expect(h.downloads[0].fileName).toMatch(/\.csv$/);
  });

  it("metryki XLSX idą przez proces arkuszy", async () => {
    await showReport();
    await click(`${E}.download.metricsXlsx`);
    expect(h.sheets).toHaveLength(1);
    expect(h.downloads[0].fileName).toMatch(/\.xlsx$/);
  });

  it("kontakty CSV: kontakt tylko przy zgodzie, wiersz bez zgody bez danych osoby", async () => {
    await showReport();
    expect(screen.getByText(`${E}.leads.hint`)).toBeTruthy();
    await click(`${E}.leads.downloadCsv`);
    const text = String(h.downloads[0].data);
    expect(text).toContain("anna@example.org");
    const lines = text.slice(1).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("Bez zgody");
    expect(lines[2]).toContain(",nie,");
    expect(lines[2]).not.toContain("@");
  });

  it("kontakty XLSX i awaria pliku: zdanie, a przyciski wracają", async () => {
    await showReport();
    await click(`${E}.leads.downloadXlsx`);
    expect(h.sheets).toHaveLength(1);
    h.sheetFails = true;
    await click(`${E}.download.metricsXlsx`);
    expect(screen.getByRole("alert").textContent).toBe(`${E}.download.failed`);
    expect(screen.getByRole("button", { name: `${E}.download.metricsXlsx` })).toHaveProperty(
      "disabled",
      false,
    );
    h.sheetFails = false;
    await click(`${E}.download.metricsCsv`);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

// Organizm: tabela kampanii kuponowych.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY zawartości karty są ROZŁĄCZNE: wczytywanie, pusto, tabela.
//   2. STAN PUSTY I STAN BŁĘDU SĄ NIEROZRÓŻNIALNE. Organizm nie dostaje
//      informacji o awarii odczytu, bo trasa nie ma gałęzi `isError`; operator
//      widzi „nie ma kampanii" także wtedy, gdy baza odmówiła dostępu. Defekt
//      jest zgłoszony przez `it.fails` w teście trasy - tam, gdzie mieszka
//      zapytanie.
//   3. Zdarzenia akcji niosą WŁAŚCIWY WIERSZ, nie pierwszy z brzegu. Tabela
//      z trzema wierszami to trzy zestawy przycisków o tych samych etykietach -
//      pomyłka w domknięciu (`c` kontra ostatnie `c` z pętli) archiwizuje cudzą
//      kampanię i nie widać tego ani w `tsc`, ani na ekranie.
//   4. Maska prefiksu pojawia się TYLKO dla prefiksu niepustego.
//   5. Blokada „w toku" jest wspólna dla całej tabeli: generowanie jednej
//      kampanii blokuje przycisk generowania w KAŻDYM wierszu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Formatowania rabatu i warstwy (`campaignAtoms`),
// reguły akcji per status (`CampaignRowActions` + `couponCampaignForm`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  CampaignsTable,
  type CampaignTableRow,
  type CampaignsTableLabels,
} from "@/components/admin/coupons/organisms/CampaignsTable";

afterEach(cleanup);

const LABELS: CampaignsTableLabels = {
  title: "Kampanie",
  loading: "Wczytywanie…",
  empty: "Brak kampanii.",
  name: "Nazwa",
  discount: "Rabat",
  codes: "Kody",
  subscription: "Subskrypcja",
  segment: "Segment",
  status: "Status",
  actions: "Akcje",
  generate: "Generuj",
  csv: "CSV",
  send: "Wyślij",
  archive: "archive",
  statusLabel: (status) => status,
};

function campaign(overrides: Partial<CampaignTableRow> = {}): CampaignTableRow {
  return {
    id: "camp-1",
    name: "Q1 2026 VIP",
    prefix: "NES-",
    code_count: 100,
    generated_count: 0,
    discount_kind: "percent",
    discount_percent: 20,
    discount_cents: null,
    currency: null,
    grants_tier_key: null,
    grants_duration_days: null,
    newsletter_segment: null,
    status: "draft",
    ...overrides,
  };
}

/**
 * Rysuje tabelę i oddaje ATRAPY ZDARZEŃ osobno od reszty propsów - inaczej typ
 * zwrotny byłby unią (atrapa albo prawdziwa procedura z nadpisania) i asercja
 * na `mock.calls` nie skompilowałaby się bez rzutowania.
 */
function renderTable(overrides: Partial<Parameters<typeof CampaignsTable>[0]> = {}) {
  const zdarzenia = {
    onGenerate: vi.fn(),
    onExport: vi.fn(),
    onSend: vi.fn(),
    onArchive: vi.fn(),
  };
  render(
    <CampaignsTable
      rows={[campaign()]}
      loading={false}
      labels={LABELS}
      generating={false}
      sending={false}
      {...zdarzenia}
      {...overrides}
    />,
  );
  return zdarzenia;
}

describe("stany zawartości", () => {
  it("wczytywanie pokazuje komunikat i NIE rysuje tabeli", () => {
    renderTable({ loading: true, rows: [] });
    expect(screen.getByText("Wczytywanie…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("wczytywanie wygrywa z danymi - nie pokazujemy nieaktualnej listy jako świeżej", () => {
    renderTable({ loading: true, rows: [campaign()] });
    expect(screen.getByText("Wczytywanie…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("pusty zbiór pokazuje komunikat zamiast pustej tabeli z samymi nagłówkami", () => {
    renderTable({ rows: [] });
    expect(screen.getByText("Brak kampanii.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("niepusty zbiór rysuje tabelę z siedmioma nagłówkami", () => {
    renderTable();
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });
});

describe("awaria odczytu wygląda jak brak kampanii", () => {
  // Organizm nie ma propa opisującego awarię, bo trasa nie czyta `isError` -
  // dodanie takiego propa byłoby ZMIANĄ ZACHOWANIA, nie ekstrakcją. Dowód
  // defektu (odmowa bazy == „brak kampanii") stoi w teście trasy
  // `adminCouponsCampaignsRoute.test.tsx` jako `it.fails`. Tutaj utrwalamy
  // tylko fakt, że organizm ma DWA stany braku danych, nie trzy.
  it("pusta lista ma jeden komunikat i żadnego śladu po ewentualnym błędzie", () => {
    renderTable({ rows: [] });
    expect(screen.getByText("Brak kampanii.")).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
  });
});

describe("wiersz kampanii", () => {
  it("prefiks niepusty pokazuje maskę z gwiazdkami", () => {
    renderTable({ rows: [campaign({ prefix: "NES-" })] });
    expect(screen.getByText("NES-***")).toBeInTheDocument();
  });

  it("prefiks PUSTY nie rysuje maski - nie pokazujemy samych gwiazdek", () => {
    renderTable({ rows: [campaign({ prefix: "" })] });
    expect(screen.queryByText("***")).not.toBeInTheDocument();
  });

  it("licznik kodów pokazuje wygenerowane na tle zamówionych", () => {
    renderTable({ rows: [campaign({ generated_count: 37, code_count: 100 })] });
    expect(screen.getByText(/37/)).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it("brak segmentu newslettera pokazuje myślnik, a nie pustą komórkę", () => {
    renderTable({ rows: [campaign({ newsletter_segment: null })] });
    const komorki = screen.getAllByRole("cell");
    expect(komorki[4].textContent).toBe("—");
  });

  it("segment ustawiony jest wypisany dosłownie - to znacznik listy, nie napis", () => {
    renderTable({ rows: [campaign({ newsletter_segment: "vip" })] });
    expect(screen.getByText("vip")).toBeInTheDocument();
  });

  it("etykieta statusu przechodzi przez funkcję z propsów - miejsce na klucz i18n jest widoczne", () => {
    renderTable({
      rows: [campaign({ status: "generated" })],
      labels: { ...LABELS, statusLabel: () => "Wygenerowana" },
    });
    expect(screen.getByText("Wygenerowana")).toBeInTheDocument();
  });
});

describe("akcje trafiają do WŁAŚCIWEGO wiersza", () => {
  const TRZY = [
    campaign({ id: "camp-1", name: "Pierwsza", status: "draft" }),
    campaign({ id: "camp-2", name: "Druga", status: "draft" }),
    campaign({ id: "camp-3", name: "Trzecia", status: "generated" }),
  ];

  it("generowanie w DRUGIM wierszu niesie drugą kampanię, nie pierwszą i nie ostatnią", () => {
    const props = renderTable({ rows: TRZY });
    const wiersz = screen.getByText("Druga").closest("tr");
    expect(wiersz).not.toBeNull();
    fireEvent.click(within(wiersz as HTMLElement).getByRole("button", { name: "Generuj" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    expect(props.onGenerate.mock.calls[0][0].id).toBe("camp-2");
  });

  it("eksport i wysyłka istnieją WYŁĄCZNIE w wierszu ze statusem 'generated'", () => {
    const props = renderTable({ rows: TRZY });
    expect(screen.getAllByRole("button", { name: "CSV" })).toHaveLength(1);
    const wiersz = screen.getByText("Trzecia").closest("tr") as HTMLElement;
    fireEvent.click(within(wiersz).getByRole("button", { name: "Wyślij" }));
    expect(props.onSend.mock.calls[0][0].id).toBe("camp-3");
  });

  it("archiwizacja niesie cały wiersz - wołający ma z czego wziąć identyfikator", () => {
    const props = renderTable({ rows: TRZY });
    const wiersz = screen.getByText("Trzecia").closest("tr") as HTMLElement;
    fireEvent.click(within(wiersz).getByRole("button", { name: "archive" }));
    expect(props.onArchive.mock.calls[0][0]).toMatchObject({ id: "camp-3", name: "Trzecia" });
  });

  it("trwające generowanie blokuje przycisk w KAŻDYM wierszu roboczym, nie tylko w klikniętym", () => {
    renderTable({ rows: TRZY, generating: true });
    const przyciski = screen.getAllByRole("button", { name: "Generuj" });
    expect(przyciski).toHaveLength(2);
    for (const p of przyciski) expect(p).toBeDisabled();
  });
});

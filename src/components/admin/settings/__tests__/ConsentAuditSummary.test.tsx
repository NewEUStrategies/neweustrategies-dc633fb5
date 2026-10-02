// REJESTR ZGÓD W PANELU (`ConsentAuditSummary`) - do tego pliku na ZERZE.
//
// Trasa `/admin/settings/privacy` montuje go jako zaślepkę
// (`adminSettingsRoutes.test.tsx`), a warstwa serwerowa ma własny test
// (`consentAudit.test.ts`) - więc to, co operator NAPRAWDĘ czyta jako dowód
// zgody (art. 7 ust. 1 RODO), nie było sprawdzane wcale.
//
// PRZEDMIOT DOWODU:
//   * okno czasu jedzie na serwer i przełącza zestawienie;
//   * stany „wczytywanie", „błąd", „pusto" są rozłączne - błąd odczytu
//     rejestru NIE może wyglądać jak „brak zapisanych decyzji";
//   * wiersz decyzji pokazuje osobę, kategorie udzielone i cofnięte, znacznik
//     GPC, wersję banera z językiem, źródło (przetłumaczone albo surowe) i stronę;
//   * „Pokaż więcej" doczytuje, nie gubi wierszy w trakcie i znika przy
//     sufitcie 200 (naprawa: wcześniej zostawał i nie robił nic).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ConsentDecisionRow, ConsentStatRow } from "@/lib/admin/consentAudit.server";

const h = vi.hoisted(() => ({
  statsCalls: [] as unknown[],
  decisionsCalls: [] as { limit: number; offset: number }[],
  stats: (_days: number): Promise<ConsentStatRow[]> => Promise.resolve([]),
  decisions: (_limit: number): Promise<ConsentDecisionRow[]> => Promise.resolve([]),
}));

vi.mock("@/lib/admin/consentAudit.functions", () => ({
  listConsentStats: (input: { data: { days: number } }) => {
    h.statsCalls.push(input.data);
    return h.stats(input.data.days);
  },
  listConsentDecisions: (input: { data: { limit: number; offset: number } }) => {
    h.decisionsCalls.push(input.data);
    return h.decisions(input.data.limit);
  },
}));

import i18n from "@/lib/i18n";
import { ConsentAuditSummary } from "@/components/admin/settings/ConsentAuditSummary";

const t = (key: string) => i18n.t(`adminConsentAudit.${key}`);

function stat(overrides: Partial<ConsentStatRow> = {}): ConsentStatRow {
  return {
    consent_key: "analytics",
    granted: 12,
    denied: 3,
    gpc_events: 2,
    last_event_at: "2026-06-01T10:00:00.000Z",
    banner_versions: ["v3", "v4"],
    ...overrides,
  };
}

function decision(i: number, overrides: Partial<ConsentDecisionRow> = {}): ConsentDecisionRow {
  return {
    decision_id: `dec-${i}`,
    user_id: `user-${i}`,
    email: `osoba${i}@example.com`,
    display_name: `Osoba ${i}`,
    decided_at: "2026-06-02T08:30:00.000Z",
    source: "cmp_banner",
    banner_version: "v4",
    lang: "pl",
    gpc: false,
    page_url: "https://example.com/polityka",
    granted_keys: ["necessary"],
    denied_keys: ["marketing"],
    ...overrides,
  };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => decision(i));

/** Tabela po indeksie: 0 = zestawienie, 1 = dziennik decyzji. */
function table(index: 0 | 1): HTMLElement {
  return screen.getAllByRole("table")[index];
}

beforeEach(async () => {
  h.statsCalls = [];
  h.decisionsCalls = [];
  h.stats = () => Promise.resolve([stat()]);
  h.decisions = () => Promise.resolve([decision(1)]);
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("ConsentAuditSummary - zestawienie", () => {
  it("domyślne okno to 30 dni; wiersz niesie liczniki, wersje banera i datę ostatniego zdarzenia", async () => {
    renderWithQueryClient(<ConsentAuditSummary />);
    const row = await within(table(0)).findByText("analytics");
    const cells = within(row.closest("tr") as HTMLElement).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "analytics",
      "12",
      "3",
      "2",
      "v3, v4",
      new Date("2026-06-01T10:00:00.000Z").toLocaleString("pl-PL", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    ]);
    expect(h.statsCalls).toEqual([{ days: 30 }]);
    expect(screen.getByRole("button", { name: t("stats.days30") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("przełączenie okna pyta serwer o nowe okno i przestawia zaznaczenie", async () => {
    renderWithQueryClient(<ConsentAuditSummary />);
    await within(table(0)).findByText("analytics");
    fireEvent.click(screen.getByRole("button", { name: t("stats.days7") }));
    await waitFor(() => expect(h.statsCalls).toContainEqual({ days: 7 }));
    expect(screen.getByRole("button", { name: t("stats.days7") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: t("stats.days30") })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("brak wersji banera i brak / zepsuta data zdarzenia to kreska, nie pusta komórka ani „Invalid Date”", async () => {
    h.stats = () =>
      Promise.resolve([
        stat({ consent_key: "a", banner_versions: [], last_event_at: null }),
        stat({ consent_key: "b", banner_versions: [], last_event_at: "nie-data" }),
      ]);
    renderWithQueryClient(<ConsentAuditSummary />);
    for (const key of ["a", "b"]) {
      const row = (await within(table(0)).findByText(key)).closest("tr") as HTMLElement;
      const cells = within(row).getAllByRole("cell");
      expect(cells[4].textContent).toBe("-");
      expect(cells[5].textContent).toBe("-");
    }
  });

  it("błąd odczytu zestawienia to komunikat BŁĘDU, nie „brak decyzji”", async () => {
    h.stats = () => Promise.reject(new Error("permission denied"));
    renderWithQueryClient(<ConsentAuditSummary />);
    expect(await within(table(0)).findByText(t("decisions.error"))).toBeInTheDocument();
    expect(within(table(0)).queryByText(t("decisions.empty"))).not.toBeInTheDocument();
  });

  it("w trakcie odczytu - „wczytywanie”; po pustej odpowiedzi - „brak”", async () => {
    let resolve: (rows: ConsentStatRow[]) => void = () => {};
    h.stats = () => new Promise((r) => (resolve = r));
    renderWithQueryClient(<ConsentAuditSummary />);
    expect(await within(table(0)).findByText(t("decisions.loading"))).toBeInTheDocument();
    expect(within(table(0)).queryByText(t("decisions.empty"))).not.toBeInTheDocument();
    await act(async () => resolve([]));
    expect(await within(table(0)).findByText(t("decisions.empty"))).toBeInTheDocument();
  });
});

describe("ConsentAuditSummary - dziennik decyzji", () => {
  it("wiersz pokazuje osobę z adresem, kategorie, GPC, wersję z językiem, źródło i stronę", async () => {
    h.decisions = () => Promise.resolve([decision(1, { gpc: true })]);
    renderWithQueryClient(<ConsentAuditSummary />);
    const name = await within(table(1)).findByText("Osoba 1");
    const cells = within(name.closest("tr") as HTMLElement).getAllByRole("cell");
    expect(cells[0].textContent).toBe("Osoba 1osoba1@example.com");
    expect(within(cells[2]).getByText("necessary").className).toContain("emerald");
    expect(within(cells[2]).getByText("marketing").className).toContain("destructive");
    expect(within(cells[2]).getByText(t("decisions.gpcActive"))).toBeInTheDocument();
    expect(cells[3].textContent).toBe("v4 · PL");
    expect(cells[4].textContent).toBe(t("sources.cmp_banner"));
    expect(cells[5].textContent).toBe("https://example.com/polityka");
    expect(h.decisionsCalls).toEqual([{ limit: 25, offset: 0 }]);
  });

  it("braki: sam adres zamiast nazwy, bez wersji, języka, źródła i strony - kreski; nieznane źródło - surowe", async () => {
    h.decisions = () =>
      Promise.resolve([
        decision(1, {
          display_name: null,
          banner_version: null,
          lang: null,
          source: null,
          page_url: null,
        }),
        decision(2, { display_name: null, email: null, source: "import_csv" }),
      ]);
    renderWithQueryClient(<ConsentAuditSummary />);
    const first = (await within(table(1)).findByText("osoba1@example.com")).closest(
      "tr",
    ) as HTMLElement;
    const cells = within(first).getAllByRole("cell");
    expect(cells[0].textContent).toBe("osoba1@example.com");
    expect(cells[3].textContent).toBe("-");
    expect(cells[4].textContent).toBe("-");
    expect(cells[5].textContent).toBe("-");
    const rows = within(table(1)).getAllByRole("row");
    const second = within(rows[2]).getAllByRole("cell");
    expect(second[0].textContent).toBe("-");
    expect(second[4].textContent).toBe("import_csv");
  });

  it("błąd odczytu dziennika to komunikat błędu, nie „brak decyzji”", async () => {
    h.decisions = () => Promise.reject(new Error("permission denied"));
    renderWithQueryClient(<ConsentAuditSummary />);
    expect(await within(table(1)).findByText(t("decisions.error"))).toBeInTheDocument();
    expect(within(table(1)).queryByText(t("decisions.empty"))).not.toBeInTheDocument();
  });

  it("pusty dziennik: komunikat „brak” i bez przycisku doczytania", async () => {
    h.decisions = () => Promise.resolve([]);
    renderWithQueryClient(<ConsentAuditSummary />);
    expect(await within(table(1)).findByText(t("decisions.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("decisions.more") })).not.toBeInTheDocument();
  });

  it("strona pełna - „Pokaż więcej” doczytuje kolejne 25, NIE gubiąc wierszy w trakcie", async () => {
    let release: () => void = () => {};
    h.decisions = (limit) =>
      limit === 25
        ? Promise.resolve(many(25))
        : new Promise((resolve) => (release = () => resolve(many(limit))));
    renderWithQueryClient(<ConsentAuditSummary />);
    await within(table(1)).findByText("Osoba 24");
    fireEvent.click(screen.getByRole("button", { name: t("decisions.more") }));
    await waitFor(() => expect(h.decisionsCalls).toContainEqual({ limit: 50, offset: 0 }));
    // NAPRAWA: w trakcie doczytywania poprzednia strona zostaje na ekranie.
    expect(within(table(1)).getByText("Osoba 24")).toBeInTheDocument();
    expect(within(table(1)).queryByText(t("decisions.loading"))).not.toBeInTheDocument();
    await act(async () => release());
    expect(await within(table(1)).findByText("Osoba 49")).toBeInTheDocument();
  });

  it("strona niepełna nie obiecuje kolejnej", async () => {
    h.decisions = () => Promise.resolve(many(24));
    renderWithQueryClient(<ConsentAuditSummary />);
    await within(table(1)).findByText("Osoba 23");
    expect(screen.queryByRole("button", { name: t("decisions.more") })).not.toBeInTheDocument();
  });

  it("NAPRAWA: przy sufitcie 200 przycisk znika - nie zostaje martwy", async () => {
    h.decisions = (limit) => Promise.resolve(many(limit));
    renderWithQueryClient(<ConsentAuditSummary />);
    for (let expected = 50; expected <= 200; expected += 25) {
      fireEvent.click(await screen.findByRole("button", { name: t("decisions.more") }));
      await waitFor(() => expect(h.decisionsCalls.at(-1)).toEqual({ limit: expected, offset: 0 }));
    }
    await within(table(1)).findByText("Osoba 199");
    expect(screen.queryByRole("button", { name: t("decisions.more") })).not.toBeInTheDocument();
  });

  it("angielski interfejs formatuje daty po brytyjsku i tłumaczy źródło", async () => {
    await i18n.changeLanguage("en");
    renderWithQueryClient(<ConsentAuditSummary />);
    const name = await within(table(1)).findByText("Osoba 1");
    const cells = within(name.closest("tr") as HTMLElement).getAllByRole("cell");
    expect(cells[1].textContent).toBe(
      new Date("2026-06-02T08:30:00.000Z").toLocaleString("en-GB", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    );
    expect(cells[4].textContent).toBe(t("sources.cmp_banner"));
    await i18n.changeLanguage("pl");
  });
});

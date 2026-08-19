// Log wysyłek maili systemowych - jedyne miejsce, w którym operator widzi, czy
// maile autoryzacyjne i transakcyjne faktycznie wychodzą.
//
// PANEL ZAWSZE COŚ POKAZUJE, dlatego jego pomyłki są ciche: pusta tabela wygląda
// jak „nic nie wysłaliśmy”, kreska jak „brak danych”, a filtr wpuszczony do
// zapytania z sentynelą „wszystkie” zwraca zero wierszy przy tysiącach wysyłek.
// Testy patrzą więc na TREŚĆ i na to, co poszło w zapytaniu, nie na sam render.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  report: null as unknown,
  fail: false,
  calls: [] as Record<string, unknown>[],
}));

// Raport idzie funkcją serwerową - atrapa. Żaden test nie wykonuje realnego
// żądania i żaden adres nie jest prawdziwy.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (input: { data: Record<string, unknown> }) => {
    env.calls.push(input.data);
    if (env.fail) throw new Error("serwer padl");
    return env.report;
  },
}));
vi.mock("@/lib/system-emails.functions", () => ({ getSystemEmailReport: {} }));
// Silnik wykresów ma własne testy; tu wystarczy, że widać, CO trafiło na wykres.
vi.mock("@/components/charts/Chart", () => ({
  Chart: ({ config }: { config: { title: string; series: { name: string }[] } }) => (
    <div data-testid="wykres">
      {config.title}: {config.series.map((s) => s.name).join(",")}
    </div>
  ),
}));

import i18n from "@/lib/i18n";
import "@/lib/i18n-system-emails";
import { SystemEmailsPanel } from "@/components/admin/newsletter/system-emails/SystemEmailsPanel";
import type { SystemEmailReport, SystemEmailRow } from "@/lib/email/system-log.server";

const T = (key: string) => i18n.t(`systemEmails.${key}`);

/** Wiersz logu - adresy WYŁĄCZNIE syntetyczne. */
function row(overrides: Partial<SystemEmailRow> = {}): SystemEmailRow {
  return {
    messageId: "msg-1",
    templateName: "magiclink",
    recipientEmail: "ktos@example.test",
    status: "sent",
    errorMessage: null,
    createdAt: "2026-08-01T10:30:00.000Z",
    attempts: 1,
    ...overrides,
  };
}

function report(overrides: Partial<SystemEmailReport> = {}): SystemEmailReport {
  return {
    days: 7,
    totals: { total: 120, sent: 100, failed: 12, suppressed: 5, pending: 3 },
    deliveryRate: 0.8333,
    templates: ["magiclink", "recovery"],
    series: [
      { day: "2026-08-01", sent: 10, failed: 1, suppressed: 2, pending: 0 },
      { day: "2026-08-02", sent: 20, failed: 0, suppressed: 0, pending: 1 },
    ],
    rows: [row()],
    rowsTotal: 1,
    suppressedRecipients: 4,
    infraReady: true,
    generatedAt: "2026-08-02T12:00:00.000Z",
    ...overrides,
  };
}

async function mount(data: SystemEmailReport | null = report()) {
  env.report = data;
  const utils = renderWithQueryClient(<SystemEmailsPanel />);
  // Czekamy na wartość, która pojawia się WYŁĄCZNIE z danymi - pusta tabela
  // renderuje się też przed odpowiedzią serwera, więc jej komunikat nic nie
  // dowodzi.
  if (data) await screen.findByText(String(data.totals.total));
  return utils;
}

/** Lista filtra: rodzaj jest pierwsza, status druga. */
function filterTrigger(which: "template" | "status"): HTMLElement {
  return screen.getAllByRole("combobox")[which === "template" ? 0 : 1]!;
}

/** Ostatnie zapytanie, jakie panel wysłał na serwer. */
function lastQuery(): Record<string, unknown> {
  return env.calls.at(-1)!;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  env.report = report();
  env.fail = false;
  env.calls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("wskaźniki", () => {
  it("pokazuje liczby z raportu, a nie zera", async () => {
    await mount();

    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
  });

  it("skuteczność pokazuje procent, nie surowy współczynnik", async () => {
    await mount();

    expect(screen.getByText("83.3%")).toBeTruthy();
    expect(screen.queryByText("0.8333")).toBeNull();
  });

  it("BRAK danych o skuteczności to kreska, nie „0%”", async () => {
    // „0%” w pustym logu czyta się jako awaria wysyłki.
    await mount(report({ deliveryRate: null, rows: [], rowsTotal: 0 }));

    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText("0.0%")).toBeNull();
  });

  it("liczba wykluczonych adresatów jest podana osobno", async () => {
    await mount();

    expect(screen.getByText(i18n.t("systemEmails.suppressed", { count: 4 }))).toBeTruthy();
    expect(screen.getByText(T("kpi.rate"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("ostrzeżenia i błędy", () => {
  it("BRAK infrastruktury logu jest zgłaszany wprost", async () => {
    // Bez tego ostrzeżenia pusty log wygląda jak „nic nie wysłaliśmy”.
    await mount(report({ infraReady: false, rows: [], rowsTotal: 0 }));

    expect(screen.getByText(T("notReady"))).toBeTruthy();
    expect(screen.getByText(T("table.empty"))).toBeTruthy();
  });

  it("gotowa infrastruktura nie straszy operatora ostrzeżeniem", async () => {
    await mount();

    expect(screen.queryByText(T("notReady"))).toBeNull();
    expect(screen.queryByText(T("error"))).toBeNull();
  });

  it("awaria zapytania pokazuje komunikat błędu", async () => {
    env.fail = true;
    renderWithQueryClient(<SystemEmailsPanel />);

    expect(await screen.findByText(T("error"))).toBeTruthy();
  });

  it("pusty log MÓWI, że w zakresie nic nie było", async () => {
    await mount(report({ rows: [], rowsTotal: 0, series: [] }));

    expect(screen.getByText(T("table.empty"))).toBeTruthy();
    expect(screen.queryByTestId("wykres")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("wykres", () => {
  it("pokazuje TRZY serie - wysłane, błędy i wykluczone", async () => {
    await mount();

    expect(screen.getByTestId("wykres").textContent).toContain(T("chart.sent"));
    expect(screen.getByTestId("wykres").textContent).toContain(T("chart.suppressed"));
  });

  it("bez danych dziennych wykres NIE jest rysowany", async () => {
    await mount(report({ series: [] }));

    expect(screen.queryByTestId("wykres")).toBeNull();
    expect(screen.getByText("120")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("tabela wysyłek", () => {
  it("wiersz pokazuje szablon, adresata i status", async () => {
    await mount();

    expect(screen.getByText("magiclink")).toBeTruthy();
    expect(screen.getByText("ktos@example.test")).toBeTruthy();
    expect(screen.getByText(T("status.sent"))).toBeTruthy();
  });

  it("BŁĄD wysyłki jest widoczny w wierszu - bez niego wiersz kłamie", async () => {
    await mount(
      report({
        rows: [row({ status: "dlq", errorMessage: "550 mailbox unavailable" })],
      }),
    );

    expect(screen.getByText("550 mailbox unavailable")).toBeTruthy();
    expect(screen.getByText(T("status.dlq"))).toBeTruthy();
  });

  it("wiersz BEZ daty pokazuje kreskę, nie „Invalid Date”", async () => {
    await mount(report({ rows: [row({ createdAt: "" })] }));

    expect(screen.getByText("ktos@example.test")).toBeTruthy();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("podpis mówi, ile wierszy widać z ilu", async () => {
    await mount(
      report({
        rows: [row(), row({ messageId: "msg-2", recipientEmail: "inny@example.test" })],
        rowsTotal: 90,
      }),
    );

    expect(
      screen.getByText(i18n.t("systemEmails.table.showing", { shown: 2, total: 90 })),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("filtry", () => {
  it("zakres czasu trafia do ZAPYTANIA, nie tylko do przycisku", async () => {
    await mount();

    fireEvent.click(screen.getByText(T("range.d30")));

    await waitFor(() => expect(lastQuery().days).toBe(30));
    expect(lastQuery().page).toBe(1);
  });

  it("fraza wyszukiwania jest OBCINANA i trafia do zapytania", async () => {
    await mount();

    fireEvent.change(screen.getByPlaceholderText(T("filters.search")), {
      target: { value: "  ktos@example.test  " },
    });

    await waitFor(() => expect(lastQuery().search).toBe("ktos@example.test"));
  });

  it("fraza z samych spacji znaczy BEZ FILTRA", async () => {
    await mount();

    fireEvent.change(screen.getByPlaceholderText(T("filters.search")), {
      target: { value: "   " },
    });

    await waitFor(() => expect(lastQuery().search).toBeNull());
  });

  it("wybór szablonu trafia do zapytania jako nazwa", async () => {
    await mount();

    fireEvent.keyDown(filterTrigger("template"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "recovery" }));

    await waitFor(() => expect(lastQuery().template).toBe("recovery"));
  });

  it("powrót na „wszystkie” zdejmuje filtr - sentynela NIE jedzie na serwer", async () => {
    // Wpuszczona jako nazwa szablonu filtruje log do zera i operator widzi „brak
    // wysyłek” tam, gdzie wysyłek są tysiące.
    await mount();
    fireEvent.keyDown(filterTrigger("template"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "recovery" }));
    await waitFor(() => expect(lastQuery().template).toBe("recovery"));

    fireEvent.keyDown(filterTrigger("template"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: T("filters.all") }));

    await waitFor(() => expect(lastQuery().template).toBeNull());
  });

  it("wybór statusu trafia do zapytania", async () => {
    await mount();

    fireEvent.keyDown(filterTrigger("status"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: T("status.dlq") }));

    await waitFor(() => expect(lastQuery().status).toBe("dlq"));
  });

  it("powrót na „wszystkie” zdejmuje też filtr statusu", async () => {
    await mount();
    fireEvent.keyDown(filterTrigger("status"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: T("status.dlq") }));
    await waitFor(() => expect(lastQuery().status).toBe("dlq"));

    fireEvent.keyDown(filterTrigger("status"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: T("filters.all") }));

    await waitFor(() => expect(lastQuery().status).toBeNull());
  });

  it("odświeżenie ponawia zapytanie", async () => {
    await mount();
    const przed = env.calls.length;

    fireEvent.click(screen.getByText(T("refresh")));

    await waitFor(() => expect(env.calls.length).toBeGreaterThan(przed));
  });
});

// ---------------------------------------------------------------------------
describe("stronicowanie", () => {
  it("na pierwszej stronie „poprzednia” jest zablokowana", async () => {
    await mount(report({ rowsTotal: 200 }));

    expect(screen.getByText(T("table.prev")).closest("button")).toHaveProperty("disabled", true);
    expect(screen.getByText(T("table.next")).closest("button")).toHaveProperty("disabled", false);
  });

  it("PUSTY log blokuje „następną” - jedna strona, nie zero", async () => {
    await mount(report({ rows: [], rowsTotal: 0 }));

    expect(screen.getByText(T("table.next")).closest("button")).toHaveProperty("disabled", true);
    expect(screen.getByText(T("table.prev")).closest("button")).toHaveProperty("disabled", true);
  });

  it("„następna” podbija numer strony w ZAPYTANIU", async () => {
    await mount(report({ rowsTotal: 200 }));

    fireEvent.click(screen.getByText(T("table.next")));

    await waitFor(() => expect(lastQuery().page).toBe(2));
  });

  it("powrót na poprzednią stronę wraca do numeru 1", async () => {
    await mount(report({ rowsTotal: 200 }));
    fireEvent.click(screen.getByText(T("table.next")));
    await waitFor(() => expect(lastQuery().page).toBe(2));

    fireEvent.click(screen.getByText(T("table.prev")));

    await waitFor(() => expect(lastQuery().page).toBe(1));
  });

  it("zmiana filtra WRACA na pierwszą stronę", async () => {
    // Bez tego operator zostaje na stronie 3 filtra, który ma jedną stronę,
    // i widzi pustą tabelę.
    await mount(report({ rowsTotal: 200 }));
    fireEvent.click(screen.getByText(T("table.next")));
    await waitFor(() => expect(lastQuery().page).toBe(2));

    fireEvent.change(screen.getByPlaceholderText(T("filters.search")), {
      target: { value: "ktos@example.test" },
    });

    await waitFor(() => expect(lastQuery().page).toBe(1));
  });
});

// ---------------------------------------------------------------------------
describe("tłumaczenia", () => {
  it("nagłówek i tabela idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      await mount();

      expect(screen.getByText(i18n.t("systemEmails.title"))).toBeTruthy();
      expect(screen.getByText(i18n.t("systemEmails.table.recipient"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});

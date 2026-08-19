// Log webhooka maili autoryzacyjnych - diagnostyka jednej konkretnej awarii:
// „nie dostałem linku do resetu hasła" albo „dostałem maila po polsku, choć
// korzystam z wersji angielskiej".
//
// PANEL ZAWSZE COŚ POKAZUJE, więc pomyłka jest cicha. Testy patrzą na TREŚĆ i na
// to, co poszło w zapytaniu:
//   * WYBÓR JĘZYKA i jego ŹRÓDŁO - to o nich jest cała diagnostyka; brak języka
//     musi być kreską, bo puste pole czyta się jako „polski";
//   * „odrzucony" (webhook odmówił) i „nieudany" (webhook się wywalił) to dwie
//     różne diagnozy - muszą się różnić na oczy;
//   * sentynela „wszystkie" w filtrach NIE MOŻE jechać na serwer jako wartość -
//     zwróciłaby zero wierszy przy tysiącach zdarzeń;
//   * adresy w logu są MASKOWANE - panel nie pokazuje pełnych adresów.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  report: null as unknown,
  fail: false,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (input: { data: Record<string, unknown> }) => {
    env.calls.push(input.data);
    if (env.fail) throw new Error("serwer padl");
    return env.report;
  },
}));
vi.mock("@/lib/auth-email-events.functions", () => ({ getAuthEmailEvents: {} }));

import i18n from "@/lib/i18n";
import "@/lib/i18n-auth-email-logs";
import { AuthEmailLogsPanel } from "@/components/admin/newsletter/auth-logs/AuthEmailLogsPanel";
import type { AuthEmailEventRow, AuthEmailEventsReport } from "@/lib/email/auth-events.server";

const A = (key: string) => i18n.t(`authEmailLogs.${key}`);

/** Wiersz logu. Adresy są maskowane po stronie serwera - tu tylko syntetyczne. */
function row(overrides: Partial<AuthEmailEventRow> = {}): AuthEmailEventRow {
  return {
    id: "evt-1",
    createdAt: "2026-08-19T11:30:00.000Z",
    runId: "run-1",
    messageId: "msg-1",
    emailType: "recovery",
    lang: "en",
    langSource: "header",
    langFallback: false,
    langRaw: "en-GB",
    recipientMasked: "k***s@example.test",
    recipientDomain: "example.test",
    sender: "newsletter@example.test",
    senderDomain: "example.test",
    subject: "Reset hasla",
    redirectTo: "https://example.test/reset",
    actionUrlHost: "example.test",
    greetingName: null,
    status: "enqueued",
    errorMessage: null,
    durationMs: 42,
    ...overrides,
  };
}

function report(overrides: Partial<AuthEmailEventsReport> = {}): AuthEmailEventsReport {
  return {
    days: 7,
    totals: { total: 120, enqueued: 110, failed: 10, pl: 70, en: 50, fallback: 8 },
    bySource: [
      { source: "header", count: 90 },
      { source: "fallback", count: 30 },
    ],
    byType: [{ type: "recovery", count: 120 }],
    rows: [row()],
    rowsTotal: 1,
    infraReady: true,
    generatedAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

async function mount(data: AuthEmailEventsReport | null = report()) {
  env.report = data;
  const utils = renderWithQueryClient(<AuthEmailLogsPanel />);
  // Liczba pojawia się WYŁĄCZNIE z danymi - pusta tabela renderuje się także
  // przed odpowiedzią serwera.
  if (data) await screen.findByText(String(data.totals.total));
  return utils;
}

function lastQuery(): Record<string, unknown> {
  return env.calls.at(-1)!;
}

/** Listy filtrów w kolejności: rodzaj, język, status. */
function filterTrigger(index: 0 | 1 | 2): HTMLElement {
  return screen.getAllByRole("combobox")[index]!;
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
  it("pokazuje rozbicie na języki i liczbę wywnioskowanych", async () => {
    // „fallback" to liczba maili, w których języka NIE dało się odczytać -
    // to ona tłumaczy zgłoszenia „dostałem maila w złym języku".
    await mount();

    expect(screen.getByText(A("kpi.pl"))).toBeTruthy();
    expect(screen.getByText(A("kpi.fallback"))).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("liczba nieudanych jest osobnym wskaźnikiem", async () => {
    await mount();

    expect(screen.getByText(A("kpi.failed"))).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
  });

  it("źródła języka są wypisane z licznikami", async () => {
    await mount();

    expect(screen.getByText(A("sources.title"))).toBeTruthy();
    expect(screen.getByText("90")).toBeTruthy();
  });

  it("brak danych o źródłach nie zostawia pustej sekcji", async () => {
    await mount(report({ bySource: [] }));

    expect(screen.queryByText(A("sources.title"))).toBeNull();
    expect(screen.getByText(A("kpi.total"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("tabela zdarzeń", () => {
  it("wiersz pokazuje typ maila, język i zamaskowany adres", async () => {
    await mount();

    expect(screen.getByText("recovery")).toBeTruthy();
    expect(screen.getByText("k***s@example.test")).toBeTruthy();
    expect(screen.getByText("en")).toBeTruthy();
  });

  it("BRAK języka to kreska - puste pole czyta się jako „polski”", async () => {
    await mount(report({ rows: [row({ lang: null, langSource: null })] }));

    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
    expect(screen.getByText("k***s@example.test")).toBeTruthy();
  });

  it("język WYWNIOSKOWANY jest wyróżniony - to on tłumaczy złe tłumaczenie maila", async () => {
    const { container } = await mount(
      report({ bySource: [], rows: [row({ langFallback: true, langSource: "default" })] }),
    );

    expect(container.innerHTML).toContain("amber");
    expect(screen.getByText(A("sources.default"))).toBeTruthy();
  });

  it("źródło NIEZNANE słownikowi ma awaryjny podpis, nie pustkę", async () => {
    // Webhook może dołożyć nowe źródło rozpoznania języka; pusta komórka nie
    // powiedziałaby operatorowi nic.
    await mount(
      report({ bySource: [], rows: [row({ langSource: "cos-nowego", langFallback: false })] }),
    );

    expect(screen.getByText("cos-nowego")).toBeTruthy();
  });

  it("BRAK źródła schodzi na „nieznane”", async () => {
    await mount(report({ bySource: [], rows: [row({ langSource: null })] }));

    expect(screen.getByText(A("sources.unknown"))).toBeTruthy();
  });

  it("nieudane zdarzenie ma alarmowy ton i treść błędu w podpowiedzi", async () => {
    const { container } = await mount(
      report({ rows: [row({ status: "failed", errorMessage: "resend 5xx" })] }),
    );

    expect(screen.getByText(A("status.failed"))).toBeTruthy();
    expect(container.querySelector('[title="resend 5xx"]')).toBeTruthy();
  });

  it("PUSTY log mówi, że w zakresie nic nie było", async () => {
    await mount(report({ rows: [], rowsTotal: 0 }));

    expect(screen.getByText(A("table.empty"))).toBeTruthy();
  });

  it("wiersz BEZ daty pokazuje kreskę, nie „Invalid Date”", async () => {
    await mount(report({ rows: [row({ createdAt: "" })] }));

    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
    expect(screen.getByText("recovery")).toBeTruthy();
  });

  it("brakujące pola opcjonalne pokazują kreski, a wiersz nadal niesie informację", async () => {
    await mount(
      report({
        rows: [row({ sender: null, subject: null, redirectTo: null, recipientMasked: null })],
      }),
    );

    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(A("status.enqueued"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("filtry", () => {
  it("zakres czasu trafia do zapytania i wraca na pierwszą stronę", async () => {
    await mount();

    fireEvent.click(screen.getByText(A("range.d30")));

    await waitFor(() => expect(lastQuery().days).toBe(30));
    expect(lastQuery().page).toBe(1);
  });

  it("typ maila trafia do zapytania", async () => {
    await mount();

    fireEvent.keyDown(filterTrigger(0), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "magiclink" }));

    await waitFor(() => expect(lastQuery().emailType).toBe("magiclink"));
  });

  it("powrót na „wszystkie” zdejmuje filtr typu - sentynela NIE jedzie na serwer", async () => {
    await mount();
    fireEvent.keyDown(filterTrigger(0), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "magiclink" }));
    await waitFor(() => expect(lastQuery().emailType).toBe("magiclink"));

    fireEvent.keyDown(filterTrigger(0), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: A("filters.all") }));

    await waitFor(() => expect(lastQuery().emailType).toBeNull());
  });

  it("filtr JĘZYKA trafia do zapytania - to on izoluje zgłoszenia o złym języku", async () => {
    await mount();

    fireEvent.keyDown(filterTrigger(1), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "EN" }));

    await waitFor(() => expect(lastQuery().lang).toBe("en"));
  });

  it("powrót na „wszystkie” zdejmuje filtr języka", async () => {
    await mount();
    fireEvent.keyDown(filterTrigger(1), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "EN" }));
    await waitFor(() => expect(lastQuery().lang).toBe("en"));

    fireEvent.keyDown(filterTrigger(1), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: A("filters.all") }));

    await waitFor(() => expect(lastQuery().lang).toBeNull());
  });

  it("status trafia do zapytania", async () => {
    await mount();

    fireEvent.keyDown(filterTrigger(2), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: A("status.failed") }));

    await waitFor(() => expect(lastQuery().status).toBe("failed"));
  });

  it("powrót na „wszystkie” zdejmuje filtr statusu", async () => {
    await mount();
    fireEvent.keyDown(filterTrigger(2), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: A("status.failed") }));
    await waitFor(() => expect(lastQuery().status).toBe("failed"));

    fireEvent.keyDown(filterTrigger(2), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: A("filters.all") }));

    await waitFor(() => expect(lastQuery().status).toBeNull());
  });

  it("przełącznik „tylko wywnioskowane” jest DWUSTANOWY", async () => {
    await mount();

    fireEvent.click(screen.getByText(A("filters.fallbackOnly")));
    await waitFor(() => expect(lastQuery().fallbackOnly).toBe(true));

    fireEvent.click(screen.getByText(A("filters.fallbackOnly")));
    await waitFor(() => expect(lastQuery().fallbackOnly).toBe(false));
  });

  it("fraza wyszukiwania jest obcinana, a same spacje znaczą BEZ FILTRA", async () => {
    await mount();

    fireEvent.change(screen.getByPlaceholderText(A("filters.search")), {
      target: { value: "  example.test " },
    });
    await waitFor(() => expect(lastQuery().search).toBe("example.test"));

    fireEvent.change(screen.getByPlaceholderText(A("filters.search")), {
      target: { value: "   " },
    });
    await waitFor(() => expect(lastQuery().search).toBeNull());
  });

  it("odświeżenie ponawia zapytanie", async () => {
    await mount();
    const przed = env.calls.length;

    fireEvent.click(screen.getByText(A("refresh")));

    await waitFor(() => expect(env.calls.length).toBeGreaterThan(przed));
  });
});

// ---------------------------------------------------------------------------
describe("stronicowanie", () => {
  it("na pierwszej stronie „poprzednia” jest zablokowana, licznik pokazuje 1", async () => {
    await mount(report({ rowsTotal: 200 }));

    expect(screen.getByText(A("table.prev")).closest("button")).toHaveProperty("disabled", true);
    expect(screen.getByText("1 / 4")).toBeTruthy();
  });

  it("PUSTY log ma jedną stronę, więc „następna” też jest zablokowana", async () => {
    await mount(report({ rows: [], rowsTotal: 0 }));

    expect(screen.getByText(A("table.next")).closest("button")).toHaveProperty("disabled", true);
    expect(screen.getByText("1 / 1")).toBeTruthy();
  });

  it("„następna” podbija numer strony w zapytaniu", async () => {
    await mount(report({ rowsTotal: 200 }));

    fireEvent.click(screen.getByText(A("table.next")));

    await waitFor(() => expect(lastQuery().page).toBe(2));
  });

  it("powrót na poprzednią stronę wraca do numeru 1", async () => {
    await mount(report({ rowsTotal: 200 }));
    fireEvent.click(screen.getByText(A("table.next")));
    await waitFor(() => expect(lastQuery().page).toBe(2));

    fireEvent.click(screen.getByText(A("table.prev")));

    await waitFor(() => expect(lastQuery().page).toBe(1));
  });

  it("podpis mówi, ile wierszy widać z ilu", async () => {
    await mount(report({ rowsTotal: 90 }));

    expect(
      screen.getByText(i18n.t("authEmailLogs.table.showing", { shown: 1, total: 90 })),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("ostrzeżenia", () => {
  it("BRAK infrastruktury logu jest zgłaszany wprost", async () => {
    await mount(report({ infraReady: false, rows: [], rowsTotal: 0 }));

    expect(screen.getByText(A("notReady"))).toBeTruthy();
    expect(screen.getByText(A("table.empty"))).toBeTruthy();
  });

  it("gotowa infrastruktura nie straszy ostrzeżeniem", async () => {
    await mount();

    expect(screen.queryByText(A("notReady"))).toBeNull();
    expect(screen.queryByText(A("error"))).toBeNull();
  });

  it("awaria zapytania pokazuje komunikat błędu", async () => {
    env.fail = true;
    renderWithQueryClient(<AuthEmailLogsPanel />);

    expect(await screen.findByText(A("error"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("tłumaczenia", () => {
  it("nagłówek i tabela idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      await mount();

      expect(screen.getByText(i18n.t("authEmailLogs.title"))).toBeTruthy();
      expect(screen.getByText(i18n.t("authEmailLogs.table.recipient"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});

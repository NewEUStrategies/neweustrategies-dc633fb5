// Serwerowe funkcje telemetrii popupu newslettera: zapis zdarzenia i raport.
//
// PO CO ZAPIS IDZIE WYŁĄCZNIE SERWEREM. Klient nie zna tenanta i nie ma grantu
// INSERT na tabelę zdarzeń - inaczej raport w panelu dałoby się zatruć obcym
// tenantem albo spreparowaną sesją, a operator zobaczyłby wyniki kampanii,
// której nie prowadził. Tenant rozwiązujemy z HOSTA żądania, wolumen tniemy
// limiterem per sesja, a każda ścieżka błędu MILCZY (`ok: false`), bo telemetria
// nie może wywrócić zapisu do newslettera.
//
// Raport ma własną, cichą regułę: dzielenie przez zero. Skuteczność przy zerze
// wyświetleń musi dać 0, nie NaN - „NaN%" w panelu to widoczna awaria, ale
// wynik wyliczony z NaN cicho psuje każdy wykres, na którym się pojawi.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  tenantId: "tenant-1" as string | null,
  rateLimitOk: true,
  rateLimitCalls: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { name: "requireStaff" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: h.insert }) },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => h.tenantId,
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "redakcja.example.test",
}));
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (args: Record<string, unknown>) => {
    h.rateLimitCalls.push(args);
    return h.rateLimitOk;
  },
}));

import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";
import {
  NEWSLETTER_POPUP_EVENTS,
  getNewsletterPopupEventStats,
  logNewsletterPopupEvent,
} from "@/lib/newsletter-popup-events.functions";

/** Wiersz raportu z RPC. */
const row = (day: string, event: string, count: number) => ({ day, event, count });

beforeEach(() => {
  h.insert.mockReset();
  h.insert.mockResolvedValue({ error: null });
  h.tenantId = "tenant-1";
  h.rateLimitOk = true;
  h.rateLimitCalls = [];
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [], error: null });
  resetServerFnContext();
  setServerFnContext({ supabase: { rpc: h.rpc } });
});

// ---------------------------------------------------------------------------
describe("zapis zdarzenia - kontrakt wejścia", () => {
  it("odrzuca zdarzenie SPOZA słownika", async () => {
    // Dowolny napis w kolumnie `event` rozsypałby raport na zawsze - wiersze,
    // których panel nie umie policzyć, zostają w bazie.
    await expect(logNewsletterPopupEvent({ data: { event: "cokolwiek" } })).rejects.toThrow();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("przyjmuje KAŻDE zdarzenie ze słownika", async () => {
    for (const event of NEWSLETTER_POPUP_EVENTS) {
      await logNewsletterPopupEvent({ data: { event } });
    }

    expect(h.insert).toHaveBeenCalledTimes(NEWSLETTER_POPUP_EVENTS.length);
  });

  it("domyślnym językiem jest polski, gdy nie podano", async () => {
    await logNewsletterPopupEvent({ data: { event: "impression" } });

    expect(h.insert.mock.calls[0]![0]).toMatchObject({ lang: "pl" });
  });

  it("odrzuca język spoza dwóch obsługiwanych", async () => {
    await expect(
      logNewsletterPopupEvent({ data: { event: "impression", lang: "de" } }),
    ).rejects.toThrow();
  });

  it("ucina wejście po długości - pole bez limitu to wektor zapchania tabeli", async () => {
    await expect(
      logNewsletterPopupEvent({ data: { event: "impression", sessionId: "x".repeat(65) } }),
    ).rejects.toThrow();
  });

  it("jest funkcją POST - zapis nie może iść metodą cachowalną", () => {
    expect(serverFnMeta(logNewsletterPopupEvent)?.method).toBe("POST");
  });

  it("wymaga walidatora - bez niego dowolny ładunek trafiałby do bazy", () => {
    expect(serverFnMeta(logNewsletterPopupEvent)?.hasValidator).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("zapis zdarzenia - tenant i limiter", () => {
  it("zapisuje zdarzenie z tenantem rozwiązanym z HOSTA, nie z ładunku", async () => {
    // Tenant z ładunku dałby się podstawić i zatruł raport obcej instalacji.
    const result = await logNewsletterPopupEvent({
      data: { event: "submit", lang: "en", layout: "showcase", sessionId: "s-1" },
    });

    expect(result).toEqual({ ok: true });
    expect(h.insert.mock.calls[0]![0]).toMatchObject({
      tenant_id: "tenant-1",
      event: "submit",
      lang: "en",
      layout: "showcase",
      session_id: "s-1",
    });
  });

  it("BRAK tenanta dla hosta MILCZY - nie zapisuje wiersza bez właściciela", async () => {
    h.tenantId = null;

    const result = await logNewsletterPopupEvent({ data: { event: "impression" } });

    expect(result).toEqual({ ok: false });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("limiter działa PER SESJA, nie per instalacja", async () => {
    // Limit globalny znaczyłby, że jeden bot wycisza telemetrię wszystkim.
    await logNewsletterPopupEvent({ data: { event: "impression", sessionId: "sesja-a" } });

    expect(h.rateLimitCalls[0]).toMatchObject({
      scope: "newsletter.popup.event",
      subjectId: "sesja-a",
    });
  });

  it("zdarzenie BEZ sesji dostaje wspólny podmiot limitu, nie brak limitu", async () => {
    await logNewsletterPopupEvent({ data: { event: "impression" } });

    expect(h.rateLimitCalls[0]).toMatchObject({ subjectId: "anonymous-session" });
  });

  it("przekroczony limit MILCZY i nie zapisuje", async () => {
    h.rateLimitOk = false;

    const result = await logNewsletterPopupEvent({ data: { event: "impression" } });

    expect(result).toEqual({ ok: false });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("pola nieobecne w ładunku lądują jako NULL, nie jako pusty napis", async () => {
    // Pusty napis w kolumnie źródła liczyłby się w raporcie jako osobne źródło.
    await logNewsletterPopupEvent({ data: { event: "impression" } });

    expect(h.insert.mock.calls[0]![0]).toMatchObject({
      session_id: null,
      layout: null,
      source: null,
      variant: null,
      error_code: null,
      meta: {},
    });
  });

  it("BŁĄD zapisu MILCZY - telemetria nie może wywrócić zapisu do newslettera", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    h.insert.mockResolvedValue({ error: { message: "brak grantu" } });

    const result = await logNewsletterPopupEvent({ data: { event: "success" } });

    expect(result).toEqual({ ok: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("WYJĄTEK w środku też MILCZY", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    h.insert.mockRejectedValue(new Error("sieć padła"));

    const result = await logNewsletterPopupEvent({ data: { event: "error" } });

    expect(result).toEqual({ ok: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
describe("raport zdarzeń", () => {
  it("jest za bramką personelu - raport to dane operacyjne instalacji", () => {
    const middleware = serverFnMeta(getNewsletterPopupEventStats)?.middleware ?? [];
    expect(middleware.map((m) => (m as { name?: string }).name)).toContain("requireStaff");
  });

  it("domyślnym okresem jest 30 dni", async () => {
    await getNewsletterPopupEventStats({ data: {} });

    expect(h.rpc).toHaveBeenCalledWith("newsletter_popup_event_stats", { _days: 30 });
  });

  it("okres poza zakresem 1-365 jest odrzucany", async () => {
    await expect(getNewsletterPopupEventStats({ data: { days: 0 } })).rejects.toThrow();
    await expect(getNewsletterPopupEventStats({ data: { days: 400 } })).rejects.toThrow();
  });

  it("sumuje zdarzenia per dzień i globalnie", async () => {
    h.rpc.mockResolvedValue({
      data: [
        row("2026-08-01", "impression", 100),
        row("2026-08-01", "submit", 20),
        row("2026-08-02", "impression", 50),
      ],
      error: null,
    });

    const stats = await getNewsletterPopupEventStats({ data: { days: 7 } });

    expect(stats.totals).toMatchObject({ impression: 150, submit: 20 });
    expect(stats.days).toHaveLength(2);
  });

  it("dni są posortowane od NAJNOWSZEGO - panel czyta pierwszy wiersz jako dziś", async () => {
    h.rpc.mockResolvedValue({
      data: [row("2026-08-01", "impression", 1), row("2026-08-03", "impression", 1)],
      error: null,
    });

    const stats = await getNewsletterPopupEventStats({ data: {} });

    expect(stats.days.map((d) => d.day)).toEqual(["2026-08-03", "2026-08-01"]);
  });

  it("zdarzenie NIEZNANE słownikowi jest POMIJANE, nie wywala raportu", async () => {
    // Nowa nazwa zdarzenia dopisana w bazie nie może zgasić całego panelu.
    h.rpc.mockResolvedValue({
      data: [row("2026-08-01", "cos-nowego", 999), row("2026-08-01", "impression", 5)],
      error: null,
    });

    const stats = await getNewsletterPopupEventStats({ data: {} });

    expect(stats.totals.impression).toBe(5);
    expect(Object.values(stats.totals).reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("wskaźniki liczą się z właściwych mianowników", async () => {
    h.rpc.mockResolvedValue({
      data: [
        row("2026-08-01", "impression", 1000),
        row("2026-08-01", "submit", 200),
        row("2026-08-01", "success", 180),
        row("2026-08-01", "error", 20),
      ],
      error: null,
    });

    const stats = await getNewsletterPopupEventStats({ data: {} });

    expect(stats.submitRate).toBeCloseTo(0.2);
    expect(stats.successRate).toBeCloseTo(0.9);
    // Udział błędów liczy się od WYSŁAŃ, nie od wyświetleń: 20/200.
    expect(stats.errorRate).toBeCloseTo(0.1);
  });

  it("ZERO wyświetleń daje zerowe wskaźniki, nie NaN", async () => {
    // NaN cicho psuje każdy wykres, na którym się pojawi.
    h.rpc.mockResolvedValue({ data: [], error: null });

    const stats = await getNewsletterPopupEventStats({ data: {} });

    expect(stats.submitRate).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.errorRate).toBe(0);
  });

  it("brak wierszy daje pusty raport z zerowymi licznikami", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });

    const stats = await getNewsletterPopupEventStats({ data: {} });

    expect(stats.days).toEqual([]);
    expect(stats.totals).toEqual({ impression: 0, open: 0, submit: 0, success: 0, error: 0 });
  });

  it("BŁĄD RPC jest zgłaszany - raport nie może kłamać zerami", async () => {
    // Milczące zera w raporcie czytałoby się jako „popup nie działa".
    h.rpc.mockResolvedValue({ data: null, error: { message: "brak funkcji" } });

    await expect(getNewsletterPopupEventStats({ data: {} })).rejects.toThrow("brak funkcji");
  });
});

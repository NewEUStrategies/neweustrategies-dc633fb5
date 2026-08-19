// Panele doręczalności - trzy ekrany, na których operator decyduje, czy wolno
// jeszcze wysyłać.
//
// Każdy z nich odpowiada na inne pytanie i każdy stał na zerze:
//   * WebhookSetupCard: „czy pętla zwrotna w ogóle działa" - najczęstszy powód
//     pustej listy wykluczeń mimo odbić to niepodłączony webhook. Kafel musi
//     rozróżniać SKONFIGUROWANY od DZIAŁAJĄCEGO (sekret jest, ale nic nie
//     przyszło), bo to dwie różne awarie.
//   * SuppressionTable: kto i dlaczego nie dostanie już poczty - plus jedyne
//     miejsce, w którym operator ZDEJMUJE blokadę. Przywrócenie subskrypcji
//     musi być osobną, jawną decyzją, bo zdjęcie blokady po skardze bez zgody
//     odbiorcy wraca prosto pod próg Google.
//   * DeliverabilityPanel: agregat - a w nim OSTRZEŻENIE o zablokowanej
//     wysyłce, które nie może się nie pokazać.
//
// Reguły filtra i eksportu mają własny test obok. Asercje celują w klucze i18n.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type {
  DeliverabilitySetup,
  SuppressionRow,
} from "@/lib/newsletter-deliverability.functions";

const h = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  release: vi.fn(),
  metrics: vi.fn(),
  setup: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "count" in opts
        ? `${key}:${String(opts.count)}`
        : opts && "when" in opts
          ? `${key}:${String(opts.when)}`
          : key,
    i18n: { language: "pl" },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/newsletter-deliverability.functions", () => ({
  listSuppressions: { __fn: "list" },
  addSuppression: { __fn: "add" },
  releaseSuppression: { __fn: "release" },
  getDeliverabilityMetrics: { __fn: "metrics" },
  getDeliverabilitySetup: { __fn: "setup" },
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { __fn: keyof typeof h }) => h[fn.__fn],
}));
// Wykres i mierniki mają własne powierzchnie; tu interesuje nas decyzja, nie piksel.
vi.mock("@/components/charts/Chart", () => ({
  Chart: ({ config }: { config: { title?: string } }) => (
    <div data-testid="chart">{config?.title ?? "wykres"}</div>
  ),
}));

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { WebhookSetupCard } from "@/components/admin/newsletter/deliverability/WebhookSetupCard";
import { SuppressionTable } from "@/components/admin/newsletter/deliverability/SuppressionTable";
import { DeliverabilityPanel } from "@/components/admin/newsletter/deliverability/DeliverabilityPanel";

function setupData(overrides: Partial<DeliverabilitySetup> = {}): DeliverabilitySetup {
  return {
    webhookConfigured: true,
    webhookUrl: "https://example.test/api/public/webhooks/resend",
    events: ["email.bounced", "email.complained"],
    engagementSource: "first_party",
    lastEventAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

function suppression(overrides: Partial<SuppressionRow> = {}): SuppressionRow {
  return {
    id: "sup-1",
    email: "martwy@example.test",
    reason: "hard_bounce",
    scope: "permanent",
    source: "webhook",
    occurrences: 3,
    diagnostic: "550 no such user",
    note: null,
    campaignId: null,
    expiresAt: null,
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    lastSeenAt: "2026-08-10T10:00:00.000Z",
    releasedAt: null,
    ...overrides,
  };
}

function metricsData(overrides: Record<string, unknown> = {}) {
  return {
    days: 30,
    counts: {
      sent: 1000,
      delivered: 980,
      bounced: 15,
      hardBounced: 10,
      softBounced: 5,
      complained: 1,
      failed: 3,
      delayed: 1,
      suppressedSends: 4,
      activeSuppressions: 42,
    },
    reputation: {
      complaint: {
        rate: 0.001,
        numerator: 1,
        denominator: 980,
        status: "healthy",
        target: 0.001,
        limit: 0.003,
      },
      bounce: {
        rate: 0.015,
        numerator: 15,
        denominator: 1000,
        status: "healthy",
        target: 0.02,
        limit: 0.05,
      },
      hardBounce: {
        rate: 0.01,
        numerator: 10,
        denominator: 1000,
        status: "healthy",
        target: 0.02,
        limit: 0.05,
      },
      deliveryRate: 0.98,
      overall: "healthy",
      blocksSending: false,
      blockReasons: [],
    },
    reasons: [{ reason: "hard_bounce", scope: "permanent", count: 10 }],
    series: [{ day: "2026-08-17", sent: 100, delivered: 98, bounced: 2, complained: 0 }],
    campaigns: [],
    generatedAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.list.mockResolvedValue([suppression()]);
  h.add.mockResolvedValue({ ok: true });
  h.release.mockResolvedValue({ ok: true });
  h.metrics.mockResolvedValue(metricsData());
  h.setup.mockResolvedValue(setupData());
  h.writeText.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: h.writeText } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// KAFEL WEBHOOKA
// ---------------------------------------------------------------------------
describe("WebhookSetupCard", () => {
  function mount(setup: DeliverabilitySetup) {
    return renderWithQueryClient(<WebhookSetupCard setup={setup} locale="pl-PL" />);
  }

  it("skonfigurowany webhook z ruchem jest oznaczony jako skonfigurowany", () => {
    mount(setupData());

    expect(screen.getByText("adminDeliverability.setup.configured")).toBeTruthy();
    expect(screen.queryByText("adminDeliverability.setup.missingBody")).toBeNull();
  });

  it("BRAK sekretu daje ostrzeżenie i instrukcję naprawy", () => {
    mount(setupData({ webhookConfigured: false, lastEventAt: null }));

    expect(screen.getByText("adminDeliverability.setup.missing")).toBeTruthy();
    expect(screen.getByText("adminDeliverability.setup.missingBody")).toBeTruthy();
  });

  it("SKONFIGUROWANY, ale bez ani jednego zdarzenia - to inna awaria niż brak sekretu", () => {
    mount(setupData({ webhookConfigured: true, lastEventAt: null }));

    // Status nadal „skonfigurowany", ale podtytuł mówi, że nic nie przyszło.
    expect(screen.getByText("adminDeliverability.setup.configured")).toBeTruthy();
    expect(screen.getByText("adminDeliverability.setup.noEvents")).toBeTruthy();
  });

  it("czas ostatniego zdarzenia jest pokazany jako dowód, że pętla żyje", () => {
    mount(setupData());

    expect(screen.getByText(/adminDeliverability\.setup\.lastEvent:/)).toBeTruthy();
    expect(screen.queryByText("adminDeliverability.setup.noEvents")).toBeNull();
  });

  it("adres do wklejenia u dostawcy jest widoczny", () => {
    mount(setupData());

    expect(screen.getByText("https://example.test/api/public/webhooks/resend")).toBeTruthy();
  });

  it("bez adresu pokazuje kreskę i BLOKUJE kopiowanie", () => {
    mount(setupData({ webhookUrl: "" }));

    expect(screen.getByText("-")).toBeTruthy();
    const copyBtn = screen.getByRole("button") as HTMLButtonElement;
    expect(copyBtn.disabled).toBe(true);
  });

  it("kopiowanie wkłada adres do schowka i potwierdza to operatorowi", async () => {
    mount(setupData());

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(h.writeText).toHaveBeenCalledWith("https://example.test/api/public/webhooks/resend"),
    );
    expect(await screen.findByText("adminDeliverability.setup.copied")).toBeTruthy();
  });

  it("niedostępny schowek NIE wywraca kafla", async () => {
    h.writeText.mockRejectedValue(new Error("brak uprawnień"));
    mount(setupData());

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.writeText).toHaveBeenCalled());
    // Adres nadal na ekranie - operator zaznaczy go ręcznie.
    expect(screen.getByText("https://example.test/api/public/webhooks/resend")).toBeTruthy();
    expect(screen.queryByText("adminDeliverability.setup.copied")).toBeNull();
  });

  it("lista zdarzeń do subskrypcji jest wypisana wprost", () => {
    mount(setupData({ events: ["email.bounced", "email.complained", "email.delivered"] }));

    expect(screen.getByText("email.bounced")).toBeTruthy();
    expect(screen.getByText("email.delivered")).toBeTruthy();
  });

  it("TRYB WŁASNY tłumaczy, czemu nie ma tu otwarć - inaczej operator je dopisze", () => {
    mount(setupData({ engagementSource: "first_party" }));

    expect(screen.getByText("adminDeliverability.setup.engagementFirstParty")).toBeTruthy();
    expect(screen.queryByText("adminDeliverability.setup.engagementProvider")).toBeNull();
  });

  it("TRYB DOSTAWCY ma własne wyjaśnienie", () => {
    mount(setupData({ engagementSource: "provider" }));

    expect(screen.getByText("adminDeliverability.setup.engagementProvider")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// LISTA WYKLUCZEŃ
// ---------------------------------------------------------------------------
describe("SuppressionTable", () => {
  async function mount(rows: SuppressionRow[] = [suppression()]) {
    h.list.mockResolvedValue(rows);
    const utils = renderWithQueryClient(<SuppressionTable locale="pl-PL" />);
    if (rows.length) await screen.findByText(rows[0]!.email);
    return utils;
  }

  it("pyta o wpisy AKTYWNE i z limitem", async () => {
    await mount();

    expect(h.list).toHaveBeenCalledWith({
      data: { search: "", reason: "all", state: "active", limit: 300 },
    });
  });

  it("pokazuje adres, powód i liczbę wystąpień", async () => {
    await mount();

    expect(screen.getByText("martwy@example.test")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(/adminDeliverability\.list\.title:1/)).toBeTruthy();
  });

  it("pusta lista mówi to wprost", async () => {
    h.list.mockResolvedValue([]);
    renderWithQueryClient(<SuppressionTable locale="pl-PL" />);

    expect(await screen.findByText("adminDeliverability.list.empty")).toBeTruthy();
  });

  it("szukanie działa LOKALNIE - bez zapytania na każde naciśnięcie klawisza", async () => {
    await mount([
      suppression({ id: "a", email: "anna@example.test" }),
      suppression({ id: "b", email: "borys@example.test" }),
    ]);
    h.list.mockClear();

    fireEvent.change(screen.getByPlaceholderText("adminDeliverability.list.searchPlaceholder"), {
      target: { value: "borys" },
    });

    await waitFor(() => expect(screen.queryByText("anna@example.test")).toBeNull());
    expect(h.list).not.toHaveBeenCalled();
  });

  it("zmiana filtru powodu ODPYTUJE serwer na nowo", async () => {
    await mount();
    h.list.mockClear();

    const triggers = screen.getAllByRole("combobox");
    fireEvent.keyDown(triggers[1]!, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("option", { name: "adminDeliverability.reason.complaint" }),
    );

    await waitFor(() => expect(h.list).toHaveBeenCalled());
    expect(h.list.mock.calls[0]?.[0]).toMatchObject({ data: { reason: "complaint" } });
  });

  it("zmiana filtru stanu też idzie do serwera", async () => {
    await mount();
    h.list.mockClear();

    const triggers = screen.getAllByRole("combobox");
    fireEvent.keyDown(triggers[2]!, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("option", { name: "adminDeliverability.list.stateReleased" }),
    );

    await waitFor(() => expect(h.list).toHaveBeenCalled());
    expect(h.list.mock.calls[0]?.[0]).toMatchObject({ data: { state: "released" } });
  });

  it("eksport jest ZABLOKOWANY, gdy nie ma czego wyeksportować", async () => {
    h.list.mockResolvedValue([]);
    renderWithQueryClient(<SuppressionTable locale="pl-PL" />);
    await screen.findByText("adminDeliverability.list.empty");

    const button = screen.getByRole("button", { name: /exportCsv/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("eksport zapisuje plik z WIDOCZNYMI wpisami i datą w nazwie", async () => {
    const createUrl = vi.fn().mockReturnValue("blob:sup");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const anchors: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        anchors.push(el as HTMLAnchorElement);
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    });

    await mount();
    fireEvent.click(screen.getByRole("button", { name: /exportCsv/ }));

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(anchors[0]?.download).toMatch(/^suppressions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(revokeUrl).toHaveBeenCalledWith("blob:sup");
    createSpy.mockRestore();
  });

  it("dodanie blokady wysyła adres małymi literami i melduje sukces", async () => {
    await mount();

    fireEvent.change(screen.getByPlaceholderText("adminDeliverability.list.addPlaceholder"), {
      target: { value: "  Nowy@Example.TEST " },
    });
    fireEvent.click(screen.getByRole("button", { name: /addAction/ }));

    await waitFor(() => expect(h.add).toHaveBeenCalled());
    expect(h.add.mock.calls[0]?.[0]).toEqual({
      data: { email: "nowy@example.test", reason: "manual" },
    });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminDeliverability.list.added"),
    );
  });

  it("PUSTE pole nie wysyła żądania - przycisk jest zablokowany", async () => {
    await mount();

    const addButton = screen.getByRole("button", { name: /addAction/ }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    fireEvent.click(addButton);
    expect(h.add).not.toHaveBeenCalled();
  });

  it("adres BEZ małpy nie idzie do serwera", async () => {
    await mount();

    fireEvent.change(screen.getByPlaceholderText("adminDeliverability.list.addPlaceholder"), {
      target: { value: "to nie adres" },
    });
    fireEvent.click(screen.getByRole("button", { name: /addAction/ }));

    await waitFor(() => expect(h.toastSuccess).not.toHaveBeenCalled());
    expect(h.add).not.toHaveBeenCalled();
  });

  it("błąd dodania nie udaje sukcesu", async () => {
    h.add.mockRejectedValue(new Error("odmowa"));
    await mount();

    fireEvent.change(screen.getByPlaceholderText("adminDeliverability.list.addPlaceholder"), {
      target: { value: "nowy@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /addAction/ }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminDeliverability.list.addError"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zdjęcie blokady wymaga POTWIERDZENIA w oknie", async () => {
    await mount();

    fireEvent.click(screen.getByLabelText("adminDeliverability.list.releaseAction"));

    expect(await screen.findByText("adminDeliverability.list.releaseTitle")).toBeTruthy();
    // Samo otwarcie okna niczego nie zdejmuje.
    expect(h.release).not.toHaveBeenCalled();
  });

  it("okno pokazuje ADRES, którego blokada ma zniknąć", async () => {
    await mount();

    fireEvent.click(screen.getByLabelText("adminDeliverability.list.releaseAction"));

    await screen.findByText("adminDeliverability.list.releaseTitle");
    expect(screen.getAllByText("martwy@example.test").length).toBeGreaterThanOrEqual(2);
  });

  it("domyślnie zdjęcie blokady NIE przywraca subskrypcji", async () => {
    await mount();

    fireEvent.click(screen.getByLabelText("adminDeliverability.list.releaseAction"));
    fireEvent.click(await screen.findByText("adminDeliverability.list.releaseConfirm"));

    await waitFor(() => expect(h.release).toHaveBeenCalled());
    // Zdjęcie blokady po skardze bez zgody odbiorcy wraca prosto pod próg Google.
    expect(h.release.mock.calls[0]?.[0]).toEqual({ data: { id: "sup-1", resubscribe: false } });
  });

  it("przywrócenie subskrypcji jest OSOBNĄ, jawną decyzją operatora", async () => {
    await mount();

    fireEvent.click(screen.getByLabelText("adminDeliverability.list.releaseAction"));
    await screen.findByText("adminDeliverability.list.releaseTitle");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("adminDeliverability.list.releaseConfirm"));

    await waitFor(() => expect(h.release).toHaveBeenCalled());
    expect(h.release.mock.calls[0]?.[0]).toEqual({ data: { id: "sup-1", resubscribe: true } });
  });

  it("po zdjęciu blokady odświeża listę I metryki", async () => {
    const { queryClient } = await mount();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByLabelText("adminDeliverability.list.releaseAction"));
    fireEvent.click(await screen.findByText("adminDeliverability.list.releaseConfirm"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes("email-suppressions"))).toBe(true);
    expect(keys.some((k) => k.includes("deliverability-metrics"))).toBe(true);
  });

  it("błąd zdjęcia blokady nie udaje sukcesu", async () => {
    h.release.mockRejectedValue(new Error("odmowa"));
    await mount();

    fireEvent.click(screen.getByLabelText("adminDeliverability.list.releaseAction"));
    fireEvent.click(await screen.findByText("adminDeliverability.list.releaseConfirm"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminDeliverability.list.releaseError"),
    );
  });

  it("wpis bez terminu wygaśnięcia mówi „nigdy”, a nie pustką", async () => {
    await mount([suppression({ expiresAt: null })]);

    expect(screen.getByText("adminDeliverability.list.never")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PANEL AGREGUJĄCY
// ---------------------------------------------------------------------------
describe("DeliverabilityPanel", () => {
  async function mount() {
    const utils = renderWithQueryClient(<DeliverabilityPanel />);
    await screen.findByText("adminDeliverability.title");
    return utils;
  }

  it("pyta o metryki w domyślnym oknie 30 dni", async () => {
    await mount();

    await waitFor(() => expect(h.metrics).toHaveBeenCalledWith({ data: { days: 30 } }));
    expect(h.setup).toHaveBeenCalled();
  });

  it("zmiana zakresu odpytuje serwer o nowe okno", async () => {
    await mount();
    h.metrics.mockClear();

    fireEvent.click(screen.getByText("adminDeliverability.range.d7"));

    await waitFor(() => expect(h.metrics).toHaveBeenCalledWith({ data: { days: 7 } }));
  });

  it("wybrany zakres jest oznaczony dla czytnika ekranu", async () => {
    await mount();

    fireEvent.click(screen.getByText("adminDeliverability.range.d90"));

    await waitFor(() =>
      expect(screen.getByText("adminDeliverability.range.d90").getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(screen.getByText("adminDeliverability.range.d7").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("zdrowa domena NIE pokazuje ostrzeżenia o blokadzie", async () => {
    await mount();

    await waitFor(() => expect(h.metrics).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ZABLOKOWANA wysyłka pokazuje alarm i WYMIENIA powody", async () => {
    h.metrics.mockResolvedValue(
      metricsData({
        reputation: {
          ...metricsData().reputation,
          overall: "critical",
          blocksSending: true,
          blockReasons: ["complaint_rate", "hard_bounce_rate"],
        },
      }),
    );
    await mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("adminDeliverability.gate.complaint_rate");
    expect(alert.textContent).toContain("adminDeliverability.gate.hard_bounce_rate");
  });

  it("odświeżenie ponawia OBA zapytania", async () => {
    await mount();
    await waitFor(() => expect(h.metrics).toHaveBeenCalled());
    h.metrics.mockClear();
    h.setup.mockClear();

    fireEvent.click(screen.getByText("adminDeliverability.refresh"));

    await waitFor(() => expect(h.metrics).toHaveBeenCalled());
    expect(h.setup).toHaveBeenCalled();
  });

  it("szereg dzienny buduje wykres", async () => {
    await mount();

    expect(await screen.findByTestId("chart")).toBeTruthy();
  });

  it("BEZ danych dziennych nie renderuje pustego wykresu", async () => {
    h.metrics.mockResolvedValue(metricsData({ series: [] }));
    await mount();

    await waitFor(() => expect(h.metrics).toHaveBeenCalled());
    expect(screen.queryByTestId("chart")).toBeNull();
  });
});

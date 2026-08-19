// Kafel automatu wysyłki - odpowiada na pytanie „czy poczta wychodzi", nie „czy
// przełącznik jest włączony".
//
// PO CO GO TESTOWAĆ. Runner startował kiedyś z wyłączonym przełącznikiem i
// pustym adresem, więc świeże wdrożenie nie wysyłało w tle NICZEGO - ani
// zaplanowanych kampanii, ani digestów, ani kolejki transakcyjnej - a jedynym
// śladem była rosnąca kolejka, której panel nie pokazywał. Ten kafel jest
// odpowiedzią na tę awarię, więc jego cichy błąd przywraca dokładnie ten stan.
//
// Testy patrzą na TREŚĆ: rozstrzygnięty stan, podpowiedź co zrobić, głębokość
// kolejek i ostrzeżenia o zaległości oraz martwych listach.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

interface RunnerSettings {
  enabled: boolean;
  base_url: string;
  effective_base_url: string;
  last_tick_at: string | null;
  last_tick_status: "dispatched" | "skipped" | "error" | null;
  last_tick_error: string | null;
  tick_count: number | null;
  secret_preview: string | null;
  queues: {
    auth: number;
    transactional: number;
    authDlq: number;
    transactionalDlq: number;
  } | null;
}

const env = vi.hoisted(() => ({
  settings: null as unknown,
  saveFails: false,
  saved: [] as Record<string, unknown>[],
  reads: 0,
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn: (fn: { kind?: string }) => async (input?: { data: Record<string, unknown> }) => {
      if (fn.kind === "save") {
        if (env.saveFails) throw new Error("zapis padl");
        env.saved.push(input!.data);
        return { ok: true };
      }
      env.reads += 1;
      return env.settings;
    },
  };
});
vi.mock("@/lib/newsletter-admin.functions", () => ({
  getJobRunnerSettings: { kind: "get" },
  updateJobRunnerSettings: { kind: "save" },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { JobRunnerCard } from "@/components/admin/newsletter/runner/JobRunnerCard";

const R = (key: string) => i18n.t(`adminRunner.${key}`);

function settings(overrides: Partial<RunnerSettings> = {}): RunnerSettings {
  return {
    enabled: true,
    base_url: "https://example.test",
    effective_base_url: "https://example.test",
    last_tick_at: "2026-08-19T11:59:00.000Z",
    last_tick_status: "dispatched",
    last_tick_error: null,
    tick_count: 1234,
    secret_preview: "abc…xyz",
    queues: { auth: 0, transactional: 0, authDlq: 0, transactionalDlq: 0 },
    ...overrides,
  };
}

async function mount(data: RunnerSettings = settings()) {
  env.settings = data;
  const utils = renderWithQueryClient(<JobRunnerCard />);
  // Kafel renderuje się ZANIM przyjdą dane (stan schodzi wtedy na „wyłączony",
  // a kolejki na „niedostępne"), więc czekamy na element, który pojawia się
  // WYŁĄCZNIE po odpowiedzi serwera - inaczej asercje czytałyby render sprzed
  // danych.
  if (data.queues) {
    await screen.findByText(R("queues.auth"));
  } else {
    await waitFor(() => expect(env.reads).toBeGreaterThan(0));
    await act(async () => {});
    await waitFor(() => expect(screen.queryByText(R("tick.never"))).toBeNull());
  }
  return utils;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  env.settings = settings();
  env.saveFails = false;
  env.saved = [];
  env.reads = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("rozstrzygnięty stan automatu", () => {
  it("DZIAŁA: tick dotarł, więc kafel nie straszy podpowiedzią", async () => {
    await mount();

    expect(screen.getByText(R("state.running"))).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("WYŁĄCZONY mówi wprost, że wysyłka czeka na ręczne uruchomienie", async () => {
    // To jest ta awaria: przełącznik na „nie" i cisza.
    await mount(settings({ enabled: false }));

    expect(screen.getByText(R("state.disabled"))).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(R("stateHint.disabled"));
  });

  it("BRAK ADRESU to osobny stan - cron nie ma gdzie zapukać", async () => {
    await mount(settings({ base_url: "", effective_base_url: "" }));

    expect(screen.getByText(R("state.misconfigured"))).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(R("stateHint.misconfigured"));
  });

  it("BŁĄD ostatniego ticku pokazuje treść błędu, nie tylko stan", async () => {
    await mount(
      settings({ last_tick_status: "error", last_tick_error: "connect ETIMEDOUT 10.0.0.1:443" }),
    );

    expect(screen.getByText(R("state.error"))).toBeTruthy();
    expect(screen.getByText("connect ETIMEDOUT 10.0.0.1:443")).toBeTruthy();
  });

  it("WŁĄCZONY BEZ TICKU to bezczynność, nie „działa”", async () => {
    // „Działa" przy zerowej liczbie ticków byłoby kłamstwem o wysyłce.
    await mount(settings({ last_tick_at: null, last_tick_status: null, tick_count: 0 }));

    expect(screen.getByText(R("state.idle"))).toBeTruthy();
    expect(screen.getByText(R("tick.never"))).toBeTruthy();
  });

  it("tick POMINIĘTY też jest bezczynnością", async () => {
    await mount(settings({ last_tick_status: "skipped" }));

    expect(screen.getByText(R("state.idle"))).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(R("stateHint.idle"));
  });

  it("podpowiedź stanu jest OGŁASZANA czytnikowi ekranu", async () => {
    // Hint jest treścią, nie dekoracją - po zapisaniu adresu ma być usłyszany.
    await mount(settings({ enabled: false }));

    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    // Rola bez treści nic nie ogłasza.
    expect(status.textContent?.trim()).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("kolejki poczty", () => {
  it("pokazuje trzy kolejki: autoryzacyjną, transakcyjną i martwe listy", async () => {
    await mount();

    expect(screen.getByText(R("queues.auth"))).toBeTruthy();
    expect(screen.getByText(R("queues.transactional"))).toBeTruthy();
    expect(screen.getByText(R("queues.dlq"))).toBeTruthy();
  });

  it("ZALEGŁOŚĆ powyżej progu jest OSTRZEŻENIEM, nie samą liczbą", async () => {
    // Rosnąca kolejka była jedynym śladem awarii, którego panel nie pokazywał.
    await mount(
      settings({ queues: { auth: 20, transactional: 20, authDlq: 0, transactionalDlq: 0 } }),
    );

    expect(
      screen.getByText(i18n.t("adminRunner.queues.backlogWarning", { count: 40 })),
    ).toBeTruthy();
    // Ostrzeżenie sumuje OBIE kolejki - 20 + 20, nie jedną z nich.
    expect(screen.queryByText(i18n.t("adminRunner.queues.backlogWarning", { count: 20 }))).toBeNull();
  });

  it("kolejka poniżej progu nie straszy ostrzeżeniem", async () => {
    await mount(
      settings({ queues: { auth: 2, transactional: 3, authDlq: 0, transactionalDlq: 0 } }),
    );

    expect(
      screen.queryByText(i18n.t("adminRunner.queues.backlogWarning", { count: 5 })),
    ).toBeNull();
    expect(screen.getByText(R("queues.title"))).toBeTruthy();
  });

  it("MARTWE LISTY alarmują od PIERWSZEJ wiadomości", async () => {
    // Wiadomość w DLQ nie wyjdzie już nigdy - nie ma tu progu tolerancji.
    await mount(
      settings({ queues: { auth: 0, transactional: 0, authDlq: 1, transactionalDlq: 0 } }),
    );

    expect(screen.getByText(i18n.t("adminRunner.queues.dlqWarning", { count: 1 }))).toBeTruthy();
    // Zaległość zerowa nie zapala drugiego ostrzeżenia - operator ma widzieć
    // jeden problem, nie dwa.
    expect(
      screen.queryByText(i18n.t("adminRunner.queues.backlogWarning", { count: 0 })),
    ).toBeNull();
  });

  it("martwe listy sumują OBIE kolejki", async () => {
    await mount(
      settings({ queues: { auth: 0, transactional: 0, authDlq: 2, transactionalDlq: 3 } }),
    );

    expect(screen.getByText(i18n.t("adminRunner.queues.dlqWarning", { count: 5 }))).toBeTruthy();
    // Nie 2 i nie 3 osobno - jedno ostrzeżenie o łącznej liczbie.
    expect(screen.queryByText(i18n.t("adminRunner.queues.dlqWarning", { count: 2 }))).toBeNull();
  });

  it("BRAK danych o kolejkach mówi to wprost, zamiast pokazywać zera", async () => {
    // Zera sugerowałyby puste kolejki, a to zupełnie inna diagnoza.
    await mount(settings({ queues: null }));

    expect(screen.getByText(R("queues.unavailable"))).toBeTruthy();
    expect(screen.queryByText(R("queues.auth"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("telemetria ticku", () => {
  it("pokazuje moment ostatniego ticku", async () => {
    await mount();

    expect(document.body.textContent).toContain(R("tick.lastAt").replace("{{when}}", "").trim());
    expect(screen.queryByText(R("tick.never"))).toBeNull();
  });

  it("liczba ticków pojawia się TYLKO gdy jakiś był", async () => {
    await mount();
    expect(screen.getByText(i18n.t("adminRunner.tick.count", { count: 1234 }))).toBeTruthy();
    cleanup();

    await mount(settings({ tick_count: 0, last_tick_at: null, last_tick_status: null }));
    expect(screen.queryByText(i18n.t("adminRunner.tick.count", { count: 0 }))).toBeNull();
  });

  it("podgląd sekretu i endpoint są pokazane, gdy sekret istnieje", async () => {
    await mount();

    expect(screen.getByText("abc…xyz")).toBeTruthy();
    // Endpoint jest w tym samym akapicie co podgląd sekretu - dopasowanie po
    // fragmencie, bo sam napis niesie nawiasy i ukośniki.
    expect(document.body.textContent).toContain(R("tick.endpoint"));
  });

  it("brak sekretu nie pokazuje pustego podglądu", async () => {
    await mount(settings({ secret_preview: null }));

    expect(document.body.textContent).not.toContain(R("tick.endpoint"));
    expect(screen.getByText(R("queues.title"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("konfiguracja", () => {
  it("adres i przełącznik pokazują stan Z BAZY, nie domyślny", async () => {
    await mount();

    expect((screen.getByLabelText(R("fields.urlLabel")) as HTMLInputElement).value).toBe(
      "https://example.test",
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("zapis wysyła DOKŁADNIE to, co operator ustawił", async () => {
    await mount(settings({ enabled: false, base_url: "" }));

    fireEvent.change(screen.getByLabelText(R("fields.urlLabel")), {
      target: { value: "https://nowy.example.test" },
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText(R("fields.save")));

    await waitFor(() => expect(env.saved).toHaveLength(1));
    expect(env.saved[0]).toEqual({ enabled: true, base_url: "https://nowy.example.test" });
  });

  it("udany zapis potwierdza się komunikatem", async () => {
    await mount();

    fireEvent.click(screen.getByText(R("fields.save")));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R("fields.saved")));
    // Udany zapis nie pokazuje przy okazji błędu.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("BŁĄD zapisu jest widoczny - cicha porażka zostawia automat wyłączony", async () => {
    env.saveFails = true;
    await mount();

    fireEvent.click(screen.getByText(R("fields.save")));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("zapis padl"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("PUSTY adres oferuje wpisanie bieżącej domeny jednym klikiem", async () => {
    await mount(settings({ base_url: "", effective_base_url: "" }));

    fireEvent.click(screen.getByText(R("fields.useCurrentDomain")));

    expect((screen.getByLabelText(R("fields.urlLabel")) as HTMLInputElement).value).toBe(
      window.location.origin,
    );
    // Po wypełnieniu propozycja znika - inaczej klik drugi raz nic nie znaczy.
    expect(screen.queryByText(R("fields.useCurrentDomain"))).toBeNull();
  });

  it("wypełniony adres nie proponuje bieżącej domeny", async () => {
    await mount();

    expect(screen.queryByText(R("fields.useCurrentDomain"))).toBeNull();
    // Pole jednak jest i niesie zapisany adres.
    expect((screen.getByLabelText(R("fields.urlLabel")) as HTMLInputElement).value).not.toBe("");
  });

  it("puste pole adresu MÓWI, skąd cron weźmie adres", async () => {
    await mount(settings({ base_url: "", effective_base_url: "https://tenant.example.test" }));

    expect(
      screen.getByText(
        i18n.t("adminRunner.fields.urlHint", { url: "https://tenant.example.test" }),
      ),
    ).toBeTruthy();
    // Nie komunikat „brak domeny" - te dwa stany wymagają różnych reakcji.
    expect(screen.queryByText(R("fields.urlHintMissing"))).toBeNull();
  });

  it("puste pole i BRAK domeny tenanta mówi, że automat nie ma gdzie zapukać", async () => {
    await mount(settings({ base_url: "", effective_base_url: "" }));

    expect(screen.getByText(R("fields.urlHintMissing"))).toBeTruthy();
    // ...i od razu daje wyjście: wpisanie bieżącej domeny jednym klikiem.
    expect(screen.getByText(R("fields.useCurrentDomain"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("tłumaczenia", () => {
  it("kafel mówi po angielsku, gdy panel jest po angielsku", async () => {
    await i18n.changeLanguage("en");
    try {
      await mount(settings({ enabled: false }));

      expect(screen.getByText(i18n.t("adminRunner.title"))).toBeTruthy();
      expect(screen.getByText(i18n.t("adminRunner.state.disabled"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});

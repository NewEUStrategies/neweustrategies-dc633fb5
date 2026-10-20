// Pasek zdrowia silnika ścieżek (S8) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Z-S5-03: włączony silnik, kontakty „do wykonania” i ŻADEN wykonany
//      krok -> komunikat „kroki ruszą po podpięciu harmonogramu (I9)”
//      (kształt z prawdziwego RPC, `RPC_SHAPES.health`).
//   2. Stan silnika słowem i ikoną: włączony, wyłączony, wyłącznik awaryjny
//      (kolor nigdy sam).
//   3. Wejście w ustawienia: admin - „Ustawienia silnika”, redaktor -
//      „Podgląd ustawień”; funkcje niewdrożone - komunikat bez przycisku.
//   4. Ostatnie błędy z fazą silnika; axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  health: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  getJourneyEngineHealth: () => h.health(),
}));

import { JourneyEngineHealthStrip } from "../JourneyEngineHealthStrip";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { parseEngineHealth } from "@/lib/journeys/parse";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";

h.fixedT = realT;
const T = "11111111-1111-4111-8111-111111111111";

function healthOf(patch: Record<string, unknown> = {}, killSwitch = false) {
  return {
    state: "ready",
    data: parseEngineHealth({ ...RPC_SHAPES.health, ...patch }, killSwitch),
  };
}

function mount(props: { canManageEngine?: boolean; onOpenSettings?: () => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JourneyEngineHealthStrip
        tenantId={T}
        canManageEngine={props.canManageEngine ?? true}
        onOpenSettings={props.onOpenSettings ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.health.mockReset();
  h.lang = "pl";
});
afterEach(cleanup);

describe("JourneyEngineHealthStrip", () => {
  it("Z-S5-03: kolejka bez żadnego kroku = harmonogram jeszcze niepodpięty", async () => {
    h.health.mockResolvedValue(healthOf());
    const { container } = mount();
    const t = realT("pl");
    const region = screen.getByRole("region", { name: t("adminJourneys.health.title") });
    const text = await within(region).findByText(
      t("adminJourneys.engineStrip.notice.scheduler_pending"),
    );
    const notice = text.closest('[role="status"]');
    expect(notice).toHaveAttribute("data-notice", "scheduler_pending");
    expect(region).toHaveTextContent(t("adminJourneys.engineStrip.enabled"));
    // Ostatni krok: „jeszcze nie było”, a nie pusta komórka.
    const last = region.querySelector('[data-metric="lastStepAt"]');
    expect(last).toHaveTextContent(t("adminJourneys.engineStrip.never"));
    expect(region.querySelector('[data-metric="dueNow"]')).toHaveTextContent("1");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("wyłącznik awaryjny ma pierwszeństwo i jest nazwany słowem", async () => {
    h.health.mockResolvedValue(healthOf({ enabled: false }, true));
    mount();
    const t = realT("pl");
    expect(await screen.findByText(t("adminJourneys.engineStrip.killSwitch"))).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("data-notice", "kill_switch");
  });

  it("silnik wyłączony: komunikat z następnym krokiem", async () => {
    h.health.mockResolvedValue(healthOf({ enabled: false }));
    mount();
    const t = realT("pl");
    expect(await screen.findByText(t("adminJourneys.engineStrip.disabled"))).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      t("adminJourneys.engineStrip.notice.disabled"),
    );
  });

  it("admin otwiera ustawienia, redaktor - podgląd", async () => {
    h.health.mockResolvedValue(healthOf());
    const onOpen = vi.fn();
    mount({ onOpenSettings: onOpen });
    const t = realT("pl");
    fireEvent.click(
      await screen.findByRole("button", { name: t("adminJourneys.engineStrip.settings") }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    cleanup();
    mount({ canManageEngine: false });
    expect(
      await screen.findByRole("button", { name: t("adminJourneys.engineStrip.preview") }),
    ).toBeInTheDocument();
  });

  it("ostatnie błędy z fazą silnika; brak notki, gdy wszystko działa", async () => {
    h.health.mockResolvedValue(
      healthOf({
        due_now: 0,
        last_step_at: "2026-10-20T09:00:00+00:00",
        failed_24h: 1,
        last_errors: [
          {
            phase: "email",
            created_at: "2026-10-20T09:00:00+00:00",
            journey_id: null,
            node_id: null,
            error: "resend 500",
          },
        ],
      }),
    );
    mount();
    const t = realT("pl");
    expect(
      await screen.findByText(new RegExp(t("adminJourneys.health.lastErrors"))),
    ).toBeInTheDocument();
    expect(screen.getByText(/resend 500/)).toBeInTheDocument();
    expect(screen.getByText(t("adminJourneys.enginePhase.email"))).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("data-notice", "errors");
  });

  it("funkcje niewdrożone: komunikat, bez przycisku ustawień", async () => {
    h.health.mockResolvedValue({ state: "unavailable" });
    mount();
    const t = realT("pl");
    expect(await screen.findByText(t("adminJourneys.engineStrip.unavailable"))).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("awaria odczytu: komunikat i ponowienie", async () => {
    // `retry: 1` z fabryki S5 - komunikat pojawia się po drugiej nieudanej próbie.
    h.health.mockRejectedValue(new Error("network"));
    mount();
    const t = realT("pl");
    const retry = await screen.findByRole(
      "button",
      { name: t("adminJourneys.common.retry") },
      { timeout: 5000 },
    );
    expect(screen.getByText(t("adminJourneys.engineStrip.loadError"))).toBeInTheDocument();
    h.health.mockResolvedValue(healthOf());
    fireEvent.click(retry);
    expect(await screen.findByRole("status")).toHaveAttribute("data-notice", "scheduler_pending");
  });

  it("panel angielski mówi po angielsku", async () => {
    h.lang = "en";
    h.health.mockResolvedValue(healthOf());
    mount();
    expect(
      await screen.findByText(/steps will start once the scheduler is connected/),
    ).toBeInTheDocument();
  });
});

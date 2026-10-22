// Arkusz wyzwalacza ścieżki (S8.3c) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Szkic bez wyzwalacza: tryb „wybierz wyzwalacz” - wybór idzie przez
//      `onChooseTrigger` (sesja zapisuje go od razu), porażka jako zdanie.
//   2. Zmiana zdarzenia = nowe ustawienia przez `onChangeSettings` z etykietą
//      historii, warunek poprzedniego zdarzenia znika; grupy katalogu S5.
//   3. Ścieżka z mailem nie przełączy się na windykację (opcja wyłączona).
//   4. Warunek zdarzenia z katalogu (`buildTriggerCondition`).
//   5. Szacunek = `estimateJourneyTrigger` (30 dni) z kluczem
//      `triggerEstimate(tenant, typ, skrót warunku)`; odmowa -> „niedostępny”,
//      brak `aal2` -> `MfaRequiredNotice`.
//   6. Filtr wejścia (warunki S5) i ostrzeżenie o polach spoza nowego zdarzenia.
//   7. Rola bez edycji - tylko odczyt. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  estimate: vi.fn(),
}));

// Fabryka niczego nie importuje (import `@/lib/i18n` z wnętrza fabryki
// `react-i18next` zakleszcza moduły) - prawdziwe `t` wpinamy po importach.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  estimateJourneyTrigger: (input: unknown) => h.estimate(input),
}));

import {
  JourneyTriggerSheet,
  withJourneySettings,
  type JourneyTriggerSheetProps,
} from "../JourneyTriggerSheet";
import type { JourneyCapabilities } from "@/lib/admin/journeys/access";
import { conditionHash } from "@/lib/admin/journeys/hash";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { JourneyDraftSchema, type JourneyDraft, type JourneySettings } from "@/lib/journeys/graph";
import { journeyKeys } from "@/lib/journeys/keys";
import { journeyLabelKey, journeyTriggerLabelKey } from "@/lib/journeys/labels";
import { parseTriggerEstimate } from "@/lib/journeys/parse";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-editor";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-publish";
import "@/lib/i18n-admin-journeys-steps";

h.fixedT = realT;
const t = realT("pl");
const T = "11111111-1111-4111-8111-111111111111";

/** Fikstury `as const` przez JSON - kopia bez wspólnych referencji. */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const ready = <D,>(data: D) => ({ state: "ready" as const, data });

const ADMIN: JourneyCapabilities = {
  canEdit: true,
  canPublish: true,
  canManageEngine: true,
  canSkipWait: true,
  canTest: true,
};
const VIEWER: JourneyCapabilities = { ...ADMIN, canEdit: false, canPublish: false };

const graph = (withEmail: boolean) => ({
  nodes: [
    { id: "t", type: "trigger", params: {} },
    ...(withEmail ? [{ id: "m1", type: "send_email", params: {} }] : []),
    { id: "x", type: "exit", params: {} },
  ],
  edges: withEmail
    ? [
        { from: "t", to: "m1", branch: "next" },
        { from: "m1", to: "x", branch: "next" },
      ]
    : [{ from: "t", to: "x", branch: "next" }],
});

const draftWith = (settings: JourneySettings, withEmail = true): JourneyDraft =>
  JourneyDraftSchema.parse({ graph: graph(withEmail), settings });

const ABANDONED = draftWith({
  triggerEventType: "checkout.abandoned.v1",
  triggerCondition: { kind: "subscription" },
});

beforeEach(() => {
  h.estimate.mockReset().mockResolvedValue(ready(parseTriggerEstimate(clone(RPC_SHAPES.estimate))));
});
afterEach(cleanup);

/** Arkusz jak w edytorze: ustawienia wracają z „sesji” po każdej zmianie. */
function mount(overrides: Partial<JourneyTriggerSheetProps> = {}) {
  const onChangeSettings = vi.fn<JourneyTriggerSheetProps["onChangeSettings"]>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [draft, setDraft] = useState<JourneyDraft | null>(
      overrides.draft === undefined ? ABANDONED : overrides.draft,
    );
    return (
      <JourneyTriggerSheet
        open
        onOpenChange={() => {}}
        tenantId={T}
        contents={[]}
        capabilities={ADMIN}
        editable
        {...overrides}
        draft={draft}
        onChangeSettings={(settings, options) => {
          onChangeSettings(settings, options);
          setDraft((current) => (current ? withJourneySettings(current, settings) : current));
        }}
      />
    );
  }
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { ...utils, onChangeSettings, queryClient };
}

const triggerSelect = () =>
  screen.getByLabelText(t("adminJourneys.create.trigger")) as HTMLSelectElement;
const lastSettings = (spy: ReturnType<typeof mount>["onChangeSettings"]) =>
  spy.mock.calls.at(-1)?.[0];

describe("JourneyTriggerSheet - wybór wyzwalacza", () => {
  it("szkic bez wyzwalacza: wybór zapisuje szkic przez sesję", async () => {
    const onChooseTrigger = vi.fn(async () => ({ ok: true as const }));
    mount({ draft: null, onChooseTrigger });
    expect(screen.getByText(t("adminJourneys.triggerSheet.chooseIntro"))).toBeTruthy();
    const choose = screen.getByRole("button", { name: t("adminJourneys.triggerSheet.choose") });
    expect((choose as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(triggerSelect(), { target: { value: "paywall.hit.v1" } });
    fireEvent.click(choose);
    await waitFor(() => expect(onChooseTrigger).toHaveBeenCalledWith("paywall.hit.v1"));
  });

  it("nieudany zapis wyboru - zdanie z sesji, bez zmiany szkicu", async () => {
    const onChooseTrigger = vi.fn(async () => ({ ok: false as const, message: "Brak sieci" }));
    mount({ draft: null, onChooseTrigger });
    fireEvent.change(triggerSelect(), { target: { value: "paywall.hit.v1" } });
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.triggerSheet.choose") }));
    expect((await screen.findByRole("alert")).textContent).toBe("Brak sieci");
  });

  it("wyjątek sieci przy wyborze - zdanie startu szkicu, przycisk znów aktywny", async () => {
    const onChooseTrigger = vi.fn(async () => {
      throw new Error("network");
    });
    mount({ draft: null, onChooseTrigger });
    fireEvent.change(triggerSelect(), { target: { value: "paywall.hit.v1" } });
    const choose = screen.getByRole("button", { name: t("adminJourneys.triggerSheet.choose") });
    fireEvent.click(choose);
    expect((await screen.findByRole("alert")).textContent).toBe(
      t("adminJourneys.editor.session.startFailed"),
    );
    await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false));
  });

  it("zmiana zdarzenia czyści warunek poprzedniego; etykieta historii; grupy katalogu", () => {
    const { onChangeSettings } = mount();
    const select = triggerSelect();
    expect(
      within(select).getByRole("group", { name: t(journeyLabelKey("triggerGroup", "billing")) }),
    ).toBeTruthy();
    fireEvent.change(select, { target: { value: "checkout.completed.v1" } });
    expect(lastSettings(onChangeSettings)).toEqual({ triggerEventType: "checkout.completed.v1" });
    expect(onChangeSettings.mock.calls.at(-1)?.[1]).toEqual({
      label: t("adminJourneys.triggerSheet.history.trigger"),
      coalesceKey: "trigger:event",
    });
  });

  it("ścieżka z mailem: windykacja niedostępna (maile należą do modułu windykacji)", () => {
    mount();
    const option = [...triggerSelect().options].find(
      (candidate) => candidate.value === "billing_subscription.payment_failed.v1",
    );
    expect(option?.disabled).toBe(true);
    expect(screen.getByText(t("adminJourneys.triggerSheet.emailBlockedHint"))).toBeTruthy();
  });

  it("bez maila windykacja jest dostępna", () => {
    mount({ draft: draftWith({ triggerEventType: "checkout.abandoned.v1" }, false) });
    const option = [...triggerSelect().options].find(
      (candidate) => candidate.value === "billing_subscription.payment_failed.v1",
    );
    expect(option?.disabled).toBe(false);
  });
});

describe("JourneyTriggerSheet - warunek i szacunek", () => {
  it("warunek z katalogu zdarzenia; pusty usuwa warunek ze szkicu", () => {
    const { onChangeSettings } = mount();
    const kind = screen.getByLabelText(t("adminJourneys.sheetField.condition.kind"));
    fireEvent.change(kind, { target: { value: "one_time" } });
    expect(lastSettings(onChangeSettings)).toEqual({
      triggerEventType: "checkout.abandoned.v1",
      triggerCondition: { kind: "one_time" },
    });
    fireEvent.change(kind, { target: { value: "" } });
    expect(lastSettings(onChangeSettings)).toEqual({ triggerEventType: "checkout.abandoned.v1" });
  });

  it("szacunek z RPC (30 dni) pod kluczem z typem i skrótem warunku", async () => {
    const { queryClient } = mount();
    const expected = t("adminJourneys.publishDialog.estimateValue", {
      count: RPC_SHAPES.estimate.contacts,
      days: RPC_SHAPES.estimate.days,
      events: RPC_SHAPES.estimate.events,
    });
    await waitFor(() =>
      expect(screen.getByTestId("journey-trigger-estimate").textContent).toBe(expected),
    );
    expect(h.estimate).toHaveBeenCalledWith({
      data: {
        eventType: "checkout.abandoned.v1",
        condition: { kind: "subscription" },
        days: 30,
      },
    });
    const key = journeyKeys.triggerEstimate(
      T,
      "checkout.abandoned.v1",
      conditionHash({ kind: "subscription" }),
    );
    expect(queryClient.getQueryData(key)).toBeTruthy();
  });

  it("odmowa odczytu - „szacunek niedostępny”, brak aal2 - MfaRequiredNotice", async () => {
    h.estimate.mockResolvedValue({ state: "forbidden" });
    mount();
    expect(
      await screen.findByText(t("adminJourneys.publishDialog.estimateUnavailable")),
    ).toBeTruthy();
    cleanup();

    h.estimate.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    // Zapytanie szacunku ponawia raz (`retry: 1`) - komunikat po drugiej odmowie.
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
    expect(screen.queryByTestId("journey-trigger-estimate")).toBeNull();
  });
});

describe("JourneyTriggerSheet - filtr wejścia", () => {
  it("dodany warunek trafia do szkicu; pusty filtr znika", () => {
    const { onChangeSettings } = mount();
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.predicateRow.add") }));
    expect(lastSettings(onChangeSettings)).toEqual({
      triggerEventType: "checkout.abandoned.v1",
      triggerCondition: { kind: "subscription" },
      entryFilter: [{ kind: "consent", marketing: true }],
    });
    expect(onChangeSettings.mock.calls.at(-1)?.[1].label).toBe(
      t("adminJourneys.triggerSheet.history.entryFilter"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("adminJourneys.predicateRow.remove", { number: 1 }) }),
    );
    expect(lastSettings(onChangeSettings)).toEqual({
      triggerEventType: "checkout.abandoned.v1",
      triggerCondition: { kind: "subscription" },
    });
  });

  it("pole zdarzenia spoza nowego wyzwalacza - ostrzeżenie zamiast cichego usunięcia", () => {
    mount({
      draft: draftWith({
        triggerEventType: "checkout.abandoned.v1",
        entryFilter: [{ kind: "trigger_field", key: "new_status", op: "in", values: ["active"] }],
      }),
    });
    expect(
      screen.getByText(t("adminJourneys.triggerSheet.staleFields", { count: 1 })),
    ).toBeTruthy();
    expect(screen.getByText(t("adminJourneys.predicateRow.fieldOutside"))).toBeTruthy();
  });
});

describe("JourneyTriggerSheet - dostęp i dostępność", () => {
  it("rola bez edycji: pola wyłączone, nic nie trafia do szkicu", () => {
    const { onChangeSettings } = mount({ capabilities: VIEWER });
    expect(triggerSelect().disabled).toBe(true);
    expect(screen.getByText(t("adminJourneys.stepSheet.roleReadOnly"))).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: t("adminJourneys.predicateRow.add"),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(onChangeSettings).not.toHaveBeenCalled();
  });

  it("tytuł zdarzenia z katalogu S5 w liście", () => {
    mount();
    expect(
      within(triggerSelect()).getByRole("option", {
        name: t(journeyTriggerLabelKey("checkout.abandoned.v1")),
      }),
    ).toBeTruthy();
  });

  it("axe bez naruszeń", async () => {
    mount({
      draft: draftWith({
        triggerEventType: "checkout.abandoned.v1",
        triggerCondition: { kind: "subscription" },
        entryFilter: [{ kind: "plan", op: "none" }],
      }),
    });
    await screen.findByTestId("journey-trigger-estimate");
    const violations = await axeViolations(screen.getByRole("dialog"));
    expect(violations, summarize(violations)).toEqual([]);
  });
});

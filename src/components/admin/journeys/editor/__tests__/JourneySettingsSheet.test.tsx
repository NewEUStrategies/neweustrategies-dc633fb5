// Arkusz ustawień ścieżki (S8.3c) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Pola definicji (nazwa 1-160, opis ≤ 2000, kategoria, podstawa prawna
//      ≤ 500) idą przez `onChangeDefinition`, ustawienia szkicu (ponowne
//      wejście, cel, wyjścia) przez `onChangeSettings` - z etykietami historii.
//   2. Odrzucenie, nie przycięcie: pusta i za długa nazwa, karencja spoza
//      1-730 dni zostają w polu z błędem i nie trafiają do szkicu.
//   3. Usługa wymaga podstawy prawnej (pole mówi to wprost).
//   4. Karencja domyślna = wartość RPC publikacji (30 dni); „nigdy” usuwa ją.
//   5. Cel i do 10 zdarzeń wyjścia z katalogu S5 (z warunkiem); nowe wyjście
//      czeka na wybór zdarzenia, zamiast go zgadywać.
//   6. Okno wysyłki i nadawca z ustawień silnika (tylko odczyt, zdania wspólne
//      z publikacją). Rola bez edycji - podgląd. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  settings: vi.fn(),
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
  getJourneySettings: () => h.settings(),
}));

import {
  JOURNEY_DEFAULT_COOLDOWN_DAYS,
  JOURNEY_EXIT_EVENTS_MAX,
  JourneySettingsSheet,
  withExitEvents,
  withReentry,
  type JourneySettingsSheetProps,
} from "../JourneySettingsSheet";
import type { JourneyCapabilities } from "@/lib/admin/journeys/access";
import type { JourneyDefinitionFields } from "@/lib/admin/journeys/editorSession";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import type { JourneySettings } from "@/lib/journeys/graph";
import { parseJourneySettings } from "@/lib/journeys/parse";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
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

const DEFINITION: JourneyDefinitionFields = {
  name: "Porzucony koszyk",
  description: "",
  category: "marketing",
  legalBasis: "",
};
const SETTINGS: JourneySettings = { triggerEventType: "checkout.abandoned.v1" };

beforeEach(() => {
  h.settings
    .mockReset()
    .mockResolvedValue(ready(parseJourneySettings(clone(RPC_SHAPES.settingsSaved))));
});
afterEach(cleanup);

/** Arkusz jak w edytorze: definicja i ustawienia wracają z „sesji”. */
function mount(
  overrides: Partial<JourneySettingsSheetProps> = {},
  initial: { definition?: JourneyDefinitionFields; settings?: JourneySettings } = {},
) {
  const onChangeDefinition = vi.fn<JourneySettingsSheetProps["onChangeDefinition"]>();
  const onChangeSettings = vi.fn<JourneySettingsSheetProps["onChangeSettings"]>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [definition, setDefinition] = useState(initial.definition ?? DEFINITION);
    const [settings, setSettings] = useState(initial.settings ?? SETTINGS);
    return (
      <JourneySettingsSheet
        open
        onOpenChange={() => {}}
        tenantId={T}
        capabilities={ADMIN}
        editable
        {...overrides}
        definition={definition}
        settings={settings}
        onChangeDefinition={(patch, options) => {
          onChangeDefinition(patch, options);
          setDefinition((current) => ({ ...current, ...patch }));
        }}
        onChangeSettings={(next, options) => {
          onChangeSettings(next, options);
          setSettings(next);
        }}
      />
    );
  }
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { ...utils, onChangeDefinition, onChangeSettings };
}

const input = (key: string) => screen.getByLabelText(t(key)) as HTMLInputElement;
const lastSettings = (spy: ReturnType<typeof mount>["onChangeSettings"]) =>
  spy.mock.calls.at(-1)?.[0];

describe("JourneySettingsSheet - definicja", () => {
  it("nazwa: pusta i ponad 160 znaków odrzucone, poprawna przycięta z etykietą historii", () => {
    const { onChangeDefinition } = mount();
    const name = input("adminJourneys.create.name");
    fireEvent.change(name, { target: { value: "   " } });
    expect(screen.getByText(t("adminJourneys.sheetField.error.required"))).toBeTruthy();
    fireEvent.change(name, { target: { value: "x".repeat(161) } });
    expect(
      screen.getByText(t("adminJourneys.sheetField.error.tooLong", { max: 160 })),
    ).toBeTruthy();
    expect(onChangeDefinition).not.toHaveBeenCalled();
    expect(name.value).toHaveLength(161);

    fireEvent.change(name, { target: { value: " Powrót do koszyka " } });
    expect(onChangeDefinition).toHaveBeenLastCalledWith(
      { name: "Powrót do koszyka" },
      { label: t("adminJourneys.settingsSheet.history.name"), coalesceKey: "settings:name" },
    );
  });

  it("opis ponad 2000 znaków odrzucony", () => {
    const { onChangeDefinition } = mount();
    fireEvent.change(input("adminJourneys.create.description"), {
      target: { value: "x".repeat(2001) },
    });
    expect(onChangeDefinition).not.toHaveBeenCalled();
    expect(
      screen.getByText(t("adminJourneys.common.counter", { count: 2001, max: 2000 })),
    ).toBeTruthy();
  });

  it("usługa: kategoria przyjęta, podstawa prawna wymagana (pole mówi to wprost)", () => {
    const { onChangeDefinition } = mount();
    fireEvent.change(input("adminJourneys.create.category"), { target: { value: "service" } });
    expect(onChangeDefinition).toHaveBeenLastCalledWith(
      { category: "service" },
      expect.objectContaining({ label: t("adminJourneys.settingsSheet.history.category") }),
    );
    const legal = input("adminJourneys.create.legalBasis");
    expect(legal.required).toBe(true);
    expect(legal.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(t("adminJourneys.common.categoryHint.service"))).toBeTruthy();

    fireEvent.change(legal, { target: { value: "x".repeat(501) } });
    expect(onChangeDefinition).toHaveBeenCalledTimes(1);
    fireEvent.change(legal, { target: { value: "Wykonanie umowy" } });
    expect(onChangeDefinition).toHaveBeenLastCalledWith(
      { legalBasis: "Wykonanie umowy" },
      expect.objectContaining({ coalesceKey: "settings:legalBasis" }),
    );
  });
});

describe("JourneySettingsSheet - ponowne wejście", () => {
  it("karencja domyślna 30 dni (jak RPC publikacji), zakres 1-730, „nigdy” ją usuwa", () => {
    const { onChangeSettings } = mount();
    fireEvent.change(input("adminJourneys.settingsSheet.reentryPolicy"), {
      target: { value: "cooldown" },
    });
    expect(lastSettings(onChangeSettings)).toEqual({
      ...SETTINGS,
      reentry: "cooldown",
      reentryCooldownDays: JOURNEY_DEFAULT_COOLDOWN_DAYS,
    });

    const days = input("adminJourneys.settingsSheet.cooldownDays");
    fireEvent.change(days, { target: { value: "731" } });
    fireEvent.change(days, { target: { value: "0" } });
    expect(onChangeSettings).toHaveBeenCalledTimes(1);
    fireEvent.change(days, { target: { value: "14" } });
    expect(lastSettings(onChangeSettings)).toEqual({
      ...SETTINGS,
      reentry: "cooldown",
      reentryCooldownDays: 14,
    });

    fireEvent.change(input("adminJourneys.settingsSheet.reentryPolicy"), {
      target: { value: "never" },
    });
    expect(lastSettings(onChangeSettings)).toEqual({ ...SETTINGS, reentry: "never" });
  });

  it("withReentry zachowuje zapisaną karencję przy powrocie do „po karencji”", () => {
    expect(withReentry({ ...SETTINGS, reentryCooldownDays: 7 }, "cooldown")).toEqual({
      ...SETTINGS,
      reentry: "cooldown",
      reentryCooldownDays: 7,
    });
    expect(
      withReentry({ ...SETTINGS, reentry: "cooldown", reentryCooldownDays: 7 }, "after_exit"),
    ).toEqual({ ...SETTINGS, reentry: "after_exit" });
  });
});

describe("JourneySettingsSheet - cel i wyjścia", () => {
  it("cel: zdarzenie z katalogu, warunek; „bez celu” usuwa cel", () => {
    const { onChangeSettings } = mount();
    const goal = input("adminJourneys.settingsSheet.goalEvent");
    fireEvent.change(goal, { target: { value: "checkout.completed.v1" } });
    expect(lastSettings(onChangeSettings)).toEqual({
      ...SETTINGS,
      goal: { eventType: "checkout.completed.v1" },
    });
    fireEvent.change(screen.getAllByLabelText(t("adminJourneys.sheetField.condition.kind"))[0], {
      target: { value: "subscription" },
    });
    expect(lastSettings(onChangeSettings)).toEqual({
      ...SETTINGS,
      goal: { eventType: "checkout.completed.v1", condition: { kind: "subscription" } },
    });
    fireEvent.change(goal, { target: { value: "" } });
    expect(lastSettings(onChangeSettings)).toEqual(SETTINGS);
  });

  it("wyjście: nowe czeka na wybór zdarzenia, potem trafia do szkicu; usunięcie", () => {
    const { onChangeSettings } = mount();
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.settingsSheet.exitAdd") }));
    expect(onChangeSettings).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByLabelText(t("adminJourneys.settingsSheet.exitEvent", { number: 1 })),
      { target: { value: "billing_subscription.status_changed.v1" } },
    );
    expect(lastSettings(onChangeSettings)).toEqual({
      ...SETTINGS,
      exitEvents: [{ eventType: "billing_subscription.status_changed.v1" }],
    });
    expect(onChangeSettings.mock.calls.at(-1)?.[1].label).toBe(
      t("adminJourneys.settingsSheet.history.exits"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("adminJourneys.settingsSheet.exitRemove", { number: 1 }),
      }),
    );
    expect(lastSettings(onChangeSettings)).toEqual(SETTINGS);
  });

  it("najwyżej 10 wyjść - przycisk wyłączony z limitem", () => {
    const exits = Array.from({ length: JOURNEY_EXIT_EVENTS_MAX }, () => ({
      eventType: "checkout.completed.v1",
    }));
    mount({}, { settings: withExitEvents(SETTINGS, exits) });
    const add = screen.getByRole("button", {
      name: t("adminJourneys.settingsSheet.exitsMax", { max: JOURNEY_EXIT_EVENTS_MAX }),
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getAllByTestId("journey-exit-event")).toHaveLength(JOURNEY_EXIT_EVENTS_MAX);
  });
});

describe("JourneySettingsSheet - okno wysyłki i dostęp", () => {
  it("marketing: limit, cisza nocna, strefa i nadawca z ustawień silnika", async () => {
    mount();
    const saved = RPC_SHAPES.settingsSaved;
    expect(
      await screen.findByText(
        t("adminJourneys.publishDialog.policyMarketing", {
          cap: saved.marketing_cap_per_7d,
          start: saved.quiet_start,
          end: saved.quiet_end,
          timezone: saved.timezone,
        }),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(t("adminJourneys.publishDialog.sender", { name: saved.sender_name })),
    ).toBeTruthy();
  });

  it("usługa bez nadawcy: polityka usługowa i nadawca domyślny", async () => {
    h.settings.mockResolvedValue(ready(parseJourneySettings(clone(RPC_SHAPES.settingsDefault))));
    mount({}, { definition: { ...DEFINITION, category: "service", legalBasis: "Umowa" } });
    expect(await screen.findByText(t("adminJourneys.publishDialog.policyService"))).toBeTruthy();
    expect(screen.getByText(t("adminJourneys.publishDialog.senderDefault"))).toBeTruthy();
  });

  it("brak aal2 przy odczycie silnika - MfaRequiredNotice", async () => {
    h.settings.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
  });

  it("rola bez edycji: podgląd bez zmian", () => {
    const { onChangeDefinition, onChangeSettings } = mount({
      capabilities: { ...ADMIN, canEdit: false },
    });
    expect(input("adminJourneys.create.name").disabled).toBe(true);
    expect(input("adminJourneys.settingsSheet.reentryPolicy").disabled).toBe(true);
    expect(screen.getByText(t("adminJourneys.stepSheet.roleReadOnly"))).toBeTruthy();
    expect(onChangeDefinition).not.toHaveBeenCalled();
    expect(onChangeSettings).not.toHaveBeenCalled();
  });

  it("axe bez naruszeń", async () => {
    mount(
      {},
      {
        settings: {
          ...SETTINGS,
          reentry: "cooldown",
          reentryCooldownDays: 14,
          goal: { eventType: "checkout.completed.v1" },
          exitEvents: [{ eventType: "subscription.expired.v1" }],
        },
      },
    );
    await waitFor(() => expect(h.settings).toHaveBeenCalled());
    const violations = await axeViolations(screen.getByRole("dialog"));
    expect(violations, summarize(violations)).toEqual([]);
  });
});

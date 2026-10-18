// Tablica zmiany planu - 0 z 8 funkcji pokrytych do 18.08.2026.
//
// Reguła podziału na „w górę" i „w dół" (`buildPlanSwitchBoard`) ma własny test
// jednostkowy (`planSwitch.test.ts`) i tego NIE duplikujemy. Ten plik sprawdza
// UŻYCIE reguły w komponencie, czyli trzy rzeczy, których reguła nie pilnuje:
//
//   1. TECHNICZNY `lookup_key` WIDZĄ WYŁĄCZNIE ADMINI. Dla klienta to szum
//      z panelu operatora; dla admina - jedyny sposób sprawdzenia, czy UI
//      i proracja mówią o tej samej cenie.
//   2. BEZ SUBSKRYPCJI TABLICA JEST LISTĄ WEJŚCIA, nie zmianą planu. Przycisk
//      „zmień" na koncie bez subskrypcji wołałby `changeMySubscriptionPlan`
//      bez identyfikatora - musi go tam nie być.
//   3. KOLEJNOŚĆ IDZIE Z RANGI KATALOGU, nie z kwoty w bazie.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { accessPlan, moneyPattern, planLadder, userSubscription } from "@/test/billing/fixtures";
import type { UserSubscriptionRow } from "@/lib/billing/types";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  isAdmin: { current: false },
  plans: { current: [] as unknown[] },
  changePlan: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: h.isAdmin.current }) }));

vi.mock("@/lib/billing/queries", () => ({
  fetchActivePlans: () => Promise.resolve(h.plans.current),
  changeMySubscriptionPlan: (subscriptionId: string, planId: string) =>
    h.changePlan(subscriptionId, planId),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { PlanSwitchBoard } from "@/components/billing/molecules/PlanSwitchBoard";

/** Subskrypcja na planie `member` (ranga 30) - w górę pro, w dół student. */
function memberSubscription(overrides: Partial<UserSubscriptionRow> = {}): UserSubscriptionRow {
  return userSubscription(overrides);
}

function renderBoard(subscription: UserSubscriptionRow | null) {
  return renderWithQueryClient(<PlanSwitchBoard subscription={subscription} />);
}

const awaitBoard = () =>
  waitFor(() => expect(screen.getByText("profile.planPage.switchTitle")).toBeTruthy());

/**
 * Klika akcję w WIERSZU danego planu. Etykiety CTA powtarzają się (dwie
 * ścieżki w górę = dwa przyciski „w górę"), więc szukanie po samym tekście
 * trafiłoby w dowolny wiersz - a test ma dowodzić, że wychodzi identyfikator
 * TEGO planu, nie jakiegokolwiek.
 */
function clickRowAction(planName: string, ctaKey: string): void {
  const row = screen.getByText(planName).closest("li")!;
  const button = Array.from(row.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === ctaKey,
  );
  if (!button) throw new Error(`brak akcji ${ctaKey} w wierszu ${planName}`);
  fireEvent.click(button);
}

beforeEach(() => {
  h.lang.current = "pl";
  h.isAdmin.current = false;
  h.plans.current = planLadder();
  h.changePlan.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("PlanSwitchBoard - podział na ścieżki", () => {
  it("dzieli plany na sekcję w górę i w dół względem bieżącego", async () => {
    renderBoard(memberSubscription());
    await awaitBoard();

    expect(screen.getByText("profile.planPage.upgradesTitle")).toBeTruthy();
    expect(screen.getByText("profile.planPage.downgradesTitle")).toBeTruthy();
  });

  it("KOLEJNOŚĆ w górę idzie rosnąco po randze katalogu", async () => {
    renderBoard(memberSubscription());
    await awaitBoard();

    const upgrades = screen
      .getByText("profile.planPage.upgradesTitle")
      .parentElement!.querySelectorAll("li");
    const names = Array.from(upgrades).map((li) => li.querySelector("span")?.textContent);
    // pro_monthly (40) przed pro_annual (41).
    expect(names[0]).toBe("Pro");
    expect(names[1]).toBe("Pro rocznie");
  });

  it("bez planów niższych sekcja „w dół” nie istnieje", async () => {
    h.plans.current = [accessPlan(), accessPlan({ id: "plan-pro-monthly", tier_key: "pro" })];
    renderBoard(memberSubscription());
    await awaitBoard();

    expect(screen.getByText("profile.planPage.upgradesTitle")).toBeTruthy();
    expect(screen.queryByText("profile.planPage.downgradesTitle")).toBeNull();
  });

  it("brak jakichkolwiek ścieżek = karta się nie renderuje", async () => {
    h.plans.current = [accessPlan()];
    const { container } = renderBoard(memberSubscription());

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("profile.planPage.switchTitle")).toBeNull();
  });

  it("plan poza katalogiem cen jest pomijany (nie da się go kupić)", async () => {
    h.plans.current = [
      accessPlan(),
      accessPlan({ id: "plan-widmo", tier_key: "nieistniejacy", name_pl: "Widmo" }),
    ];
    const { container } = renderBoard(memberSubscription());

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("Widmo")).toBeNull();
  });
});

describe("PlanSwitchBoard - co widzi klient, a co admin", () => {
  it("klient NIE widzi technicznego lookup_key", async () => {
    renderBoard(memberSubscription());
    await awaitBoard();

    expect(screen.queryByText("pro_monthly")).toBeNull();
    expect(screen.getByText("Pro")).toBeTruthy();
  });

  it("admin widzi lookup_key przy każdej ścieżce", async () => {
    h.isAdmin.current = true;
    renderBoard(memberSubscription());
    await awaitBoard();

    expect(screen.getByText("pro_monthly")).toBeTruthy();
    expect(screen.getByText("student_monthly")).toBeTruthy();
  });

  it("wiersz podaje kwotę, okres i kierunek zmiany", async () => {
    renderBoard(memberSubscription());
    await awaitBoard();

    const row = screen.getByText("Pro").closest("li")!;
    expect(row.textContent).toMatch(moneyPattern(9900));
    expect(row.textContent).toContain("pricing.perMonth");
    expect(row.textContent).toContain("profile.planPage.upgradeNote");
  });
});

describe("PlanSwitchBoard - wykonanie zmiany", () => {
  it("wysyła identyfikator subskrypcji i planu docelowego", async () => {
    renderBoard(memberSubscription());
    await awaitBoard();

    clickRowAction("Pro", "profile.planPage.upgradeCta");

    await waitFor(() => expect(h.changePlan).toHaveBeenCalledTimes(1));
    expect(h.changePlan).toHaveBeenCalledWith("sub-1", "plan-pro-monthly");
  });

  it("zejście w dół ma własne wezwanie do działania", async () => {
    renderBoard(memberSubscription());
    await awaitBoard();

    clickRowAction("Student", "profile.planPage.downgradeCta");

    await waitFor(() => expect(h.changePlan).toHaveBeenCalledTimes(1));
    expect(h.changePlan).toHaveBeenCalledWith("sub-1", "plan-student-monthly");
  });

  it("nieudana zmiana nie udaje sukcesu", async () => {
    h.changePlan.mockRejectedValue(new Error("odmowa"));
    renderBoard(memberSubscription());
    await awaitBoard();

    clickRowAction("Pro", "profile.planPage.upgradeCta");

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.changePlan.error"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("BEZ SUBSKRYPCJI nie ma przycisku zmiany - jest wejście na cennik", async () => {
    renderBoard(null);
    await awaitBoard();

    expect(screen.queryAllByText("profile.planPage.upgradeCta")).toHaveLength(0);
    const cta = screen.getAllByText("profile.planPage.chooseCta")[0];
    expect(cta.closest("a")?.getAttribute("href")).toBe("/pricing");
  });

  it("bez subskrypcji wszystkie plany są wejściem „w górę”", async () => {
    renderBoard(null);
    await awaitBoard();

    expect(screen.getByText("profile.planPage.upgradesTitle")).toBeTruthy();
    expect(screen.queryByText("profile.planPage.downgradesTitle")).toBeNull();
  });

  it("każdy wiersz linkuje do szczegółów planu", async () => {
    renderBoard(memberSubscription());
    await awaitBoard();

    const row = screen.getByText("Pro").closest("li")!;
    const details = Array.from(row.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("profile.planPage.details"),
    );
    expect(details?.getAttribute("href")).toBe("/plans/plan-pro-monthly");
  });
});

describe("PlanSwitchBoard - komunikat po zmianie mówi, KIEDY zmiana wchodzi", () => {
  it("zejście zaplanowane od nowego okresu ogłasza harmonogram, nie „plan zmieniony”", async () => {
    // Downgrade wchodzi dopiero od nowego okresu - „zmieniono" sugerowałoby,
    // że niższy plan (i niższa cena) obowiązuje już teraz.
    h.changePlan.mockResolvedValue({ effect: "scheduled" });
    renderBoard(memberSubscription());
    await awaitBoard();

    clickRowAction("Student", "profile.planPage.downgradeCta");

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.downgradeScheduled"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.subscription.changePlan.success");
  });

  it("zmiana zastosowana od razu ogłasza zmianę planu", async () => {
    h.changePlan.mockResolvedValue({ effect: "applied" });
    renderBoard(memberSubscription());
    await awaitBoard();

    clickRowAction("Pro", "profile.planPage.upgradeCta");

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.changePlan.success"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith(
      "profile.subscription.portal.downgradeScheduled",
    );
  });
});

describe("PlanSwitchBoard - subskrypcja, której nie da się przełączyć", () => {
  // Serwer (`changeSubscriptionPlan`) odmawia zmiany planu subskrypcji bez
  // okresu rozliczeniowego (zakup dożywotni: `subscription_not_switchable`)
  // i po końcu opłaconego okresu (`subscription_period_ended`). Tablica
  // pokazywała mimo to „W górę”/„W dół” - klik kończył się zawsze ogólnym
  // błędem. Ta sama reguła co przy karcie zmiany planu w sekcji subskrypcji:
  // zmiana tylko w trwającym okresie, poza nim - wejście na cennik.
  it("zakup dożywotni (bez końca okresu): zamiast zmiany jest wejście na cennik", async () => {
    renderBoard(memberSubscription({ current_period_end: null }));
    await awaitBoard();

    expect(screen.queryAllByText("profile.planPage.upgradeCta")).toHaveLength(0);
    expect(screen.queryAllByText("profile.planPage.downgradeCta")).toHaveLength(0);
    const cta = screen.getAllByText("profile.planPage.chooseCta")[0];
    expect(cta.closest("a")?.getAttribute("href")).toBe("/pricing");
    expect(h.changePlan).not.toHaveBeenCalled();
  });

  it("po końcu opłaconego okresu też nie ma przycisku zmiany", async () => {
    renderBoard(memberSubscription({ current_period_end: "2020-01-01T00:00:00.000Z" }));
    await awaitBoard();

    expect(screen.queryAllByText("profile.planPage.upgradeCta")).toHaveLength(0);
    expect(screen.queryAllByText("profile.planPage.downgradeCta")).toHaveLength(0);
    const ctas = screen.getAllByText("profile.planPage.chooseCta");
    expect(ctas.length).toBeGreaterThan(0);
    expect(ctas.every((cta) => cta.closest("a")?.getAttribute("href") === "/pricing")).toBe(true);
  });
});

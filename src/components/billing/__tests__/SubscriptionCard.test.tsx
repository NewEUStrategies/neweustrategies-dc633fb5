// Karta subskrypcji u operatora płatności - 426 linii, 0 z 39 funkcji pokrytych
// do 18.08.2026. To główny ekran obsługi posprzedażowej dla klienta ze
// subskrypcją Stripe: status, data odnowienia, zmiana planu z podglądem
// proracji, miejsca w planie zespołowym, portal klienta, wznowienie
// i anulowanie.
//
// Ten plik pilnuje tego, co widzi klient, i tego, co komponent WYSYŁA:
//
//   1. KIERUNEK ZMIANY PLANU I KWOTA PRORACJI POCHODZĄ Z REGUŁY, NIE Z KARTY.
//      `planChangeDirection` liczy z rangi katalogu, a kwotę i datę podaje
//      podgląd z operatora. Karta nie ma prawa ich zgadywać - inaczej klient
//      zobaczyłby dopłatę dopiero na wyciągu z karty.
//   2. STANY WYJĄTKOWE MAJĄ WŁASNE KOMUNIKATY: zaległość (`past_due`),
//      wstrzymanie (`paused`), zaplanowane anulowanie.
//   3. PORTAL OPERATORA ODCZYTUJE BŁĄD Z ŁADUNKU. `createStripePortalSession`
//      zwraca `{ error: "no_customer" }` bez rzucania - karta sprawdza to
//      jawnie i to jest wzorzec, którego brakowało pozostałym mutacjom
//      (patrz `SubscriptionCard.falseSuccess.test.tsx`).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { isoFuture, moneyPattern, planLadder, providerSubscription } from "@/test/billing/fixtures";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  plans: { current: [] as unknown[] },
  preview: {
    current: null as {
      amountCents?: number | null;
      currency?: string | null;
      direction?: string;
      nextBilledAt?: string | null;
    } | null,
  },
  portalResult: { current: {} as Record<string, unknown> },
  changePlan: vi.fn(),
  cancel: vi.fn(),
  resume: vi.fn(),
  seats: vi.fn(),
  portal: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  opened: [] as string[],
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixSelectStub(react);
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-me" } } }),
}));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => "sandbox" }));

vi.mock("@/lib/billing/queries", () => ({
  fetchActivePlans: () => Promise.resolve(h.plans.current),
}));

vi.mock("@/utils/payments.functions", () => ({
  changeStripePlan: (arg: unknown) => h.changePlan(arg),
  cancelStripeSubscription: (arg: unknown) => h.cancel(arg),
  resumeStripeSubscription: (arg: unknown) => h.resume(arg),
  updateStripeSubscriptionSeats: (arg: unknown) => h.seats(arg),
  createStripePortalSession: (arg: unknown) => h.portal(arg),
  previewStripePlanChange: () => Promise.resolve(h.preview.current),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { SubscriptionCard } from "@/components/billing/organisms/SubscriptionCard";

function renderCard(overrides: Partial<StripeSubscriptionRow> = {}) {
  return renderWithQueryClient(<SubscriptionCard subscription={providerSubscription(overrides)} />);
}

const clickKey = (key: string) => fireEvent.click(screen.getByText(key));

/**
 * Czeka na WCZYTANE plany, nie na sam `<select>`. Combobox istnieje od
 * pierwszego renderu (pusty), więc `waitFor` na nim przechodzi natychmiast
 * i test strzelałby w listę bez opcji - `onValueChange` nigdy by nie odpalił.
 * Czekamy więc na pojawienie się opcji.
 */
async function awaitPlans(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
  return screen.getByRole("combobox");
}

/** Wybiera plan docelowy po identyfikatorze ceny w katalogu operatora. */
async function pickTarget(priceId: string): Promise<void> {
  const select = await awaitPlans();
  fireEvent.change(select, { target: { value: priceId } });
}

beforeEach(() => {
  h.lang.current = "pl";
  h.plans.current = planLadder();
  h.preview.current = null;
  h.portalResult.current = { overviewUrl: "https://portal.example.test/overview", url: "x" };
  h.changePlan.mockReset().mockResolvedValue({ ok: true, direction: "upgrade" });
  h.cancel.mockReset().mockResolvedValue({ ok: true });
  h.resume.mockReset().mockResolvedValue({ ok: true, mode: "cancellation_reverted" });
  h.seats.mockReset().mockResolvedValue({ ok: true, quantity: 3, immediate: true });
  h.portal.mockReset().mockImplementation(() => Promise.resolve(h.portalResult.current));
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.opened.length = 0;
  vi.stubGlobal("open", (url: string) => {
    h.opened.push(url);
    return null;
  });
});

describe("SubscriptionCard - stan subskrypcji", () => {
  it("pokazuje status operatora i nazwę planu z katalogu", async () => {
    renderCard();

    expect(screen.getByText("profile.subscription.portal.status.active")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
  });

  it("nazwa planu idzie za językiem interfejsu", async () => {
    h.lang.current = "en";
    renderCard();

    await waitFor(() => expect(screen.getByText("Member")).toBeTruthy());
    expect(screen.queryByText("Członek")).toBeNull();
  });

  it("bez dopasowania planu w katalogu pokazuje warstwę, nie puste miejsce", async () => {
    h.plans.current = [];
    renderCard();

    // `plus_monthly` -> tierKey `member` z katalogu cen operatora.
    await waitFor(() => expect(screen.getByText("member")).toBeTruthy());
  });

  it("subskrypcja aktywna: etykieta odnowienia, nie wygaśnięcia", () => {
    renderCard();

    expect(screen.getByText("profile.subscription.renewsAt")).toBeTruthy();
    expect(screen.queryByText("profile.subscription.cancelsAt")).toBeNull();
  });

  it("zaplanowane anulowanie: etykieta wygaśnięcia i dostęp do końca okresu", () => {
    renderCard({ cancel_at_period_end: true });

    expect(screen.getByText("profile.subscription.cancelsAt")).toBeTruthy();
    expect(screen.getByText(/profile\.subscription\.accessUntil/)).toBeTruthy();
  });

  it("zaplanowane anulowanie ukrywa przycisk rezygnacji i daje wznowienie", () => {
    renderCard({ cancel_at_period_end: true });

    expect(screen.queryByText("profile.subscription.cancel")).toBeNull();
    expect(screen.getByText("profile.subscription.resume")).toBeTruthy();
  });

  it("subskrypcja anulowana nie proponuje ponownego anulowania", () => {
    renderCard({ status: "canceled", cancel_at_period_end: false });

    expect(screen.queryByText("profile.subscription.cancel")).toBeNull();
  });

  it("zaległość (past_due) pokazuje ostrzeżenie o nieudanej płatności", () => {
    renderCard({ status: "past_due" });

    expect(screen.getByText("profile.subscription.portal.pastDue")).toBeTruthy();
    expect(screen.getByText("profile.subscription.portal.status.past_due")).toBeTruthy();
  });

  it("subskrypcja wstrzymana: nota o braku dostępu i przycisk wznowienia", () => {
    renderCard({ status: "paused" });

    expect(screen.getByText("profile.subscription.portal.paused.note")).toBeTruthy();
    expect(screen.getByText("profile.subscription.portal.paused.cta")).toBeTruthy();
  });

  it("okres próbny jest osobnym stanem, a zmiana planu zostaje dostępna", async () => {
    renderCard({ status: "trialing" });

    expect(screen.getByText("profile.subscription.portal.status.trialing")).toBeTruthy();
    // Zmiana planu w okresie próbnym MUSI zostać dostępna - lista celów się wczytuje.
    expect((await awaitPlans()).querySelectorAll("option").length).toBeGreaterThan(0);
  });
});

describe("SubscriptionCard - zmiana planu", () => {
  it("lista celów pomija plan bieżący", async () => {
    renderCard();

    const select = await awaitPlans();
    const values = Array.from(select.querySelectorAll("option")).map((option) =>
      option.getAttribute("value"),
    );
    expect(values).toEqual(["student_monthly", "pro_monthly", "pro_annual"]);
    expect(values).not.toContain("plus_monthly");
  });

  it("KIERUNEK zmiany bierze z rangi katalogu - w górę", async () => {
    renderCard();

    await pickTarget("pro_monthly");

    await waitFor(() =>
      expect(screen.getByText("profile.subscription.portal.upgradeNote")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.subscription.portal.downgradeNote")).toBeNull();
  });

  it("KIERUNEK zmiany bierze z rangi katalogu - w dół", async () => {
    renderCard();

    await pickTarget("student_monthly");

    await waitFor(() =>
      expect(screen.getByText("profile.subscription.portal.downgradeNote")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.subscription.portal.upgradeNote")).toBeNull();
  });

  it("PRORACJA pokazuje kwotę z podglądu operatora, nie cenę planu z bazy", async () => {
    h.preview.current = { amountCents: 1234, currency: "PLN", direction: "upgrade" };
    renderCard();

    await pickTarget("pro_monthly");

    await waitFor(() =>
      expect(screen.getByText(/profile\.subscription\.portal\.preview\.upgrade/)).toBeTruthy(),
    );
    const text = screen.getByText(/profile\.subscription\.portal\.preview\.upgrade/).textContent;
    // 1234 groszy z podglądu, a NIE 9900 z ceny planu pro.
    expect(text).toMatch(moneyPattern(1234));
    expect(text).not.toMatch(moneyPattern(9900));
  });

  it("PRORACJA w dół podaje kwotę i datę kolejnego obciążenia", async () => {
    h.preview.current = {
      amountCents: 500,
      currency: "PLN",
      direction: "downgrade",
      nextBilledAt: isoFuture(15),
    };
    renderCard();

    await pickTarget("student_monthly");

    await waitFor(() =>
      expect(screen.getByText(/profile\.subscription\.portal\.preview\.downgrade/)).toBeTruthy(),
    );
    const text = screen.getByText(/profile\.subscription\.portal\.preview\.downgrade/).textContent;
    expect(text).toMatch(moneyPattern(500));
    expect(text).toContain("date");
  });

  it("niedostępny podgląd mówi to wprost, zamiast pokazywać zero", async () => {
    h.preview.current = { amountCents: null, currency: null };
    renderCard();

    await pickTarget("pro_monthly");

    await waitFor(() =>
      expect(screen.getByText("profile.subscription.portal.preview.unavailable")).toBeTruthy(),
    );
    expect(screen.queryByText(/preview\.upgrade/)).toBeNull();
  });

  it("bez wybranego celu przycisk zmiany jest wyłączony", async () => {
    renderCard();

    await awaitPlans();
    const cta = screen.getByText("profile.subscription.changePlan.cta").closest("button");
    expect(cta?.hasAttribute("disabled")).toBe(true);
    expect(h.changePlan).not.toHaveBeenCalled();
  });

  it("zmiana planu wysyła wybrany identyfikator ceny i środowisko", async () => {
    renderCard();
    await pickTarget("pro_annual");

    clickKey("profile.subscription.changePlan.cta");

    await waitFor(() => expect(h.changePlan).toHaveBeenCalledTimes(1));
    expect(h.changePlan).toHaveBeenCalledWith({
      data: { targetPriceId: "pro_annual", environment: "sandbox" },
    });
  });

  it("zejście w dół komunikuje wejście od nowego okresu, nie natychmiastowe", async () => {
    h.changePlan.mockResolvedValue({ ok: true, direction: "downgrade" });
    renderCard();
    await pickTarget("student_monthly");

    clickKey("profile.subscription.changePlan.cta");

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.downgradeScheduled"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.subscription.changePlan.success");
  });

  it("odrzucone żądanie zmiany planu (wyjątek) daje komunikat błędu", async () => {
    h.changePlan.mockRejectedValue(new Error("boom"));
    renderCard();
    await pickTarget("pro_monthly");

    clickKey("profile.subscription.changePlan.cta");

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.changePlan.error"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("SubscriptionCard - miejsca w planie zespołowym", () => {
  const teamSub = { price_id: "team_monthly_seat", quantity: 2 } as const;

  it("plan bez rozliczenia za miejsce nie pokazuje licznika miejsc", () => {
    renderCard();

    expect(screen.queryByText("profile.subscription.portal.seats.title")).toBeNull();
  });

  it("plan per-seat pokazuje licznik z bieżącą liczbą miejsc", () => {
    renderCard(teamSub);

    expect(screen.getByText("profile.subscription.portal.seats.title")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("przyciski +/- mają etykiety dostępne i zmieniają liczbę miejsc", () => {
    renderCard(teamSub);

    fireEvent.click(screen.getByLabelText("profile.subscription.portal.seats.label +1"));

    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByLabelText("profile.subscription.portal.seats.label -1")).toBeTruthy();
  });

  it("nie da się zejść poniżej jednego miejsca", () => {
    renderCard({ price_id: "team_monthly_seat", quantity: 1 });

    const minus = screen.getByLabelText("profile.subscription.portal.seats.label -1");
    expect(minus.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("zapis miejsc jest wyłączony, dopóki liczba się nie zmieniła", () => {
    renderCard(teamSub);

    const cta = screen.getByText("profile.subscription.portal.seats.cta").closest("button");
    expect(cta?.hasAttribute("disabled")).toBe(true);
    expect(h.seats).not.toHaveBeenCalled();
  });

  it("zapis miejsc wysyła docelową liczbę", async () => {
    renderCard(teamSub);

    fireEvent.click(screen.getByLabelText("profile.subscription.portal.seats.label +1"));
    clickKey("profile.subscription.portal.seats.cta");

    await waitFor(() => expect(h.seats).toHaveBeenCalledTimes(1));
    expect(h.seats).toHaveBeenCalledWith({ data: { quantity: 3, environment: "sandbox" } });
  });
});

describe("SubscriptionCard - portal operatora", () => {
  it("otwiera portal w nowej karcie (portal nie działa w iframe)", async () => {
    renderCard();

    clickKey("profile.subscription.portal.openPortal");

    await waitFor(() => expect(h.opened).toHaveLength(1));
    expect(h.opened[0]).toBe("https://portal.example.test/overview");
  });

  it("zmiana metody płatności woli adres dedykowany, a bez niego wraca na przegląd", async () => {
    h.portalResult.current = {
      url: "x",
      overviewUrl: "https://portal.example.test/overview",
      updatePaymentMethodUrl: "https://portal.example.test/payment",
    };
    renderCard();

    clickKey("profile.subscription.portal.updatePayment");

    await waitFor(() => expect(h.opened).toHaveLength(1));
    expect(h.opened[0]).toBe("https://portal.example.test/payment");
  });

  it("BRAK KONTA U OPERATORA ma własny komunikat, nie generyczny błąd", async () => {
    h.portalResult.current = { error: "no_customer" };
    renderCard();

    clickKey("profile.subscription.portal.openPortal");

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.noCustomer"),
    );
    expect(h.opened).toHaveLength(0);
  });

  it("inny błąd portalu nie otwiera karty i nie udaje sukcesu", async () => {
    h.portalResult.current = { error: "portal_failed" };
    renderCard();

    clickKey("profile.subscription.portal.openPortal");

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.error"),
    );
    expect(h.opened).toHaveLength(0);
  });

  // Stripe otwiera JEDEN ogólny portal - `updatePaymentMethodUrl` jest zawsze
  // nullem (inaczej niż w Paddle, gdzie istniały podadresy per akcja). To nie
  // wariant brzegowy, a REALNY kształt odpowiedzi, więc fallback na przegląd
  // musi działać, bo inaczej „Zmień metodę płatności" nie otwiera niczego.
  it("realny kształt Stripe (updatePaymentMethodUrl: null) i tak otwiera portal", async () => {
    h.portalResult.current = {
      url: "https://portal.example.test/overview",
      overviewUrl: "https://portal.example.test/overview",
      updatePaymentMethodUrl: null,
      cancelUrl: null,
    };
    renderCard();

    clickKey("profile.subscription.portal.updatePayment");

    await waitFor(() => expect(h.opened).toHaveLength(1));
    expect(h.opened[0]).toBe("https://portal.example.test/overview");
  });
});

// Karta subskrypcji u operatora - BRZEGI DANYCH, żądania w locie i hook
// odczytu subskrypcji.
//
// Ryzyka przypinane w tym pliku (uzupełnienie `SubscriptionCard.test.tsx`
// i `subscriptionFalseSuccess.test.tsx`):
//
//   1. ŻĄDANIE W LOCIE BLOKUJE WSZYSTKIE AKCJE. Anulowanie, wznowienie, zmiana
//      planu i zmiana miejsc dotykają pieniędzy; klik w drugą akcję, gdy pierwsza
//      leci do operatora, to dwa sprzeczne żądania (np. „anuluj" i „zmień plan")
//      i niedeterministyczny stan subskrypcji.
//   2. ŚRODOWISKO I WŁAŚCICIEL. Hook odczytu kluczuje cache po użytkowniku
//      i środowisku bramki, a bez sesji NIE wysyła zapytania - inaczej po
//      wylogowaniu karta pokazywałaby subskrypcję poprzedniego konta.
//   3. BRAKI W DANYCH NIE UDAJĄ WARTOŚCI. Brak daty okresu to „-", nie
//      „Invalid Date" ani 1970 r.; cena spoza katalogu pokazuje swój
//      identyfikator zamiast pustego miejsca; liczba miejsc `null` to jedno
//      miejsce, nie zero.
//   4. PORTAL BEZ ADRESU NIE OTWIERA PUSTEJ KARTY i mówi o błędzie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderHookWithQueryClient, renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  accessPlan,
  moneyPattern,
  ok,
  planLadder,
  providerSubscription,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";
import { supabaseAuthStub } from "@/test/supabase";
import { freezeClock } from "@/test/time";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";

freezeClock();

const h = vi.hoisted(() => ({
  session: { current: null as { user: { id: string } } | null },
  plans: { current: [] as unknown[] },
  preview: { current: null as Record<string, unknown> | null },
  chain: null as unknown as SupabaseFromStub,
  changePlan: vi.fn(),
  cancel: vi.fn(),
  resume: vi.fn(),
  seats: vi.fn(),
  portal: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  opened: [] as string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session.current }) }));

// Środowisko bramki = live (opublikowana aplikacja). Każde wywołanie i klucz
// cache muszą to środowisko nieść dalej.
vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => "live" }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.chain.from(table),
    auth: supabaseAuthStub("user-me"),
  },
}));

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

import {
  SubscriptionCard,
  useMySubscriptionProvider,
} from "@/components/billing/organisms/SubscriptionCard";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderCard(overrides: Partial<StripeSubscriptionRow> = {}) {
  return renderWithQueryClient(<SubscriptionCard subscription={providerSubscription(overrides)} />);
}

const buttonOf = (key: string) => screen.getByText(key).closest("button")!;
const spinnerIn = (key: string) => buttonOf(key).querySelector("svg.animate-spin");

/** Akcje karty, które razem z selektorem planu muszą stanąć na czas żądania. */
const ACTION_KEYS = [
  "profile.subscription.portal.updatePayment",
  "profile.subscription.portal.openPortal",
  "profile.subscription.changePlan.cta",
];

async function awaitPlans(): Promise<HTMLSelectElement> {
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
  return screen.getByRole("combobox") as HTMLSelectElement;
}

beforeEach(() => {
  h.session.current = { user: { id: "user-me" } };
  h.plans.current = planLadder();
  h.preview.current = null;
  h.chain = supabaseFromStub();
  h.changePlan.mockReset().mockResolvedValue({ ok: true, direction: "upgrade" });
  h.cancel.mockReset().mockResolvedValue({ ok: true });
  h.resume.mockReset().mockResolvedValue({ ok: true, mode: "cancellation_reverted" });
  h.seats.mockReset().mockResolvedValue({ ok: true, quantity: 2, immediate: false });
  h.portal.mockReset().mockResolvedValue({
    url: "https://portal.example.com/s/1",
    overviewUrl: "https://portal.example.com/s/1",
    updatePaymentMethodUrl: null,
  });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.opened.length = 0;
  vi.stubGlobal("open", (url: string) => {
    h.opened.push(url);
    return null;
  });
});

describe("useMySubscriptionProvider - odczyt subskrypcji zalogowanego", () => {
  it("z sesją czyta wiersz z filtrem użytkownika i środowiska, cache kluczowany tak samo", async () => {
    const row = providerSubscription({ environment: "live" });
    h.chain.setResponse("subscriptions", ok(row));

    const { result, queryClient } = renderHookWithQueryClient(() => useMySubscriptionProvider());

    await waitFor(() => expect(result.current.data).toEqual(row));
    const calls = h.chain.lastChain("subscriptions")!.calls;
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", "user-me"] });
    expect(calls).toContainEqual({ method: "eq", args: ["environment", "live"] });
    expect(queryClient.getQueryData(["my-stripe-subscription", "user-me", "live"])).toEqual(row);
  });

  it("bez sesji NIE wysyła zapytania (po wylogowaniu nie ma czyjej subskrypcji czytać)", async () => {
    h.session.current = null;

    const { result, queryClient } = renderHookWithQueryClient(() => useMySubscriptionProvider());

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(h.chain.chains).toHaveLength(0);
    expect(queryClient.getQueryState(["my-stripe-subscription", "anon", "live"])?.status).toBe(
      "pending",
    );
  });
});

describe("SubscriptionCard - braki w danych nie udają wartości", () => {
  it("brak daty końca okresu to „-”, także w nocie o dostępie po anulowaniu", () => {
    renderCard({ current_period_end: null, cancel_at_period_end: true });

    const label = screen.getByText("profile.subscription.cancelsAt");
    expect(label.nextElementSibling?.textContent).toBe("-");
    expect(screen.getByText('profile.subscription.accessUntil {"date":"-"}')).toBeTruthy();
  });

  it("nieczytelna data końca okresu też daje „-”, nie „Invalid Date”", () => {
    renderCard({ current_period_end: "nie-data" });

    const label = screen.getByText("profile.subscription.renewsAt");
    expect(label.nextElementSibling?.textContent).toBe("-");
    expect(document.body.textContent).not.toContain("Invalid Date");
  });

  it("cena spoza katalogu pokazuje swój identyfikator, a nie puste miejsce", async () => {
    renderCard({ price_id: "price_legacy_2019" });

    await waitFor(() => expect(screen.getByText("price_legacy_2019")).toBeTruthy());
    // Bez dopasowanego planu nie ma też kwoty - karta nie zgaduje ceny.
    expect(document.body.textContent).not.toMatch(moneyPattern(4900));
  });

  it("plan zespołowy na kilka miejsc pokazuje cenę z mnożnikiem miejsc", async () => {
    h.plans.current = [
      accessPlan({ id: "plan-team", tier_key: "team", name_pl: "Zespół", price_cents: 3900 }),
    ];
    renderCard({ price_id: "team_monthly_seat", quantity: 3 });

    await waitFor(() => expect(screen.getByText("Zespół")).toBeTruthy());
    const price = screen.getByText("Zespół").nextElementSibling!.textContent!;
    expect(price).toMatch(moneyPattern(3900));
    expect(price).toContain(" × 3");
  });

  it("pojedyncze miejsce nie dostaje mnożnika", async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.getByText("Członek").nextElementSibling!.textContent).not.toContain("×");
  });

  it("liczba miejsc `null` to jedno miejsce - nie da się zejść niżej ani zapisać zera", () => {
    renderCard({
      price_id: "team_monthly_seat",
      quantity: null as unknown as number,
    });

    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByLabelText("profile.subscription.portal.seats.label -1")).toBeDisabled();
    expect(buttonOf("profile.subscription.portal.seats.cta")).toBeDisabled();
  });

  it("podgląd downgrade'u bez daty kolejnego obciążenia podaje „-” zamiast daty", async () => {
    h.preview.current = { amountCents: 1900, currency: "PLN", direction: "downgrade" };
    renderCard();
    fireEvent.change(await awaitPlans(), { target: { value: "student_monthly" } });

    await waitFor(() =>
      expect(screen.getByText(/profile\.subscription\.portal\.preview\.downgrade/)).toBeTruthy(),
    );
    const text = screen.getByText(/preview\.downgrade/).textContent!;
    expect(text).toContain('"date":"-"');
    expect(text).toMatch(moneyPattern(1900));
  });
});

describe("SubscriptionCard - miejsca: zejście w dół", () => {
  it("minus zmniejsza liczbę miejsc i zapis wysyła NIŻSZĄ liczbę w środowisku live", async () => {
    renderCard({ price_id: "team_monthly_seat", quantity: 3 });

    fireEvent.click(screen.getByLabelText("profile.subscription.portal.seats.label -1"));
    expect(screen.getByText("2")).toBeTruthy();
    fireEvent.click(buttonOf("profile.subscription.portal.seats.cta"));

    await waitFor(() => expect(h.seats).toHaveBeenCalledTimes(1));
    expect(h.seats).toHaveBeenCalledWith({ data: { quantity: 2, environment: "live" } });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.seats.success"),
    );
  });
});

describe("SubscriptionCard - wznowienie zaplanowanego anulowania", () => {
  it("udane cofnięcie anulowania ma własny komunikat i odświeża subskrypcję oraz warstwę", async () => {
    const { queryClient } = renderCard({ cancel_at_period_end: true });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(buttonOf("profile.subscription.resume"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.resumed"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.subscription.portal.paused.success");
    expect(h.resume).toHaveBeenCalledWith({ data: { environment: "live" } });
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["my-stripe-subscription"]));
    expect(keys).toContain(JSON.stringify(["current-tier"]));
  });
});

describe("SubscriptionCard - portal bez adresu", () => {
  it("odpowiedź bez `url` nie otwiera pustej karty i daje komunikat błędu", async () => {
    h.portal.mockResolvedValue({ overviewUrl: null });
    renderCard();

    fireEvent.click(buttonOf("profile.subscription.portal.openPortal"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.error"),
    );
    expect(h.opened).toHaveLength(0);
  });

  it("portal dostaje ścieżkę powrotu na bieżący ekran", async () => {
    window.history.replaceState(null, "", "/profile/subscription?tab=billing");
    renderCard();

    fireEvent.click(buttonOf("profile.subscription.portal.openPortal"));

    await waitFor(() => expect(h.opened).toEqual(["https://portal.example.com/s/1"]));
    expect(h.portal).toHaveBeenCalledWith({
      data: { environment: "live", returnPath: "/profile/subscription?tab=billing" },
    });
  });
});

describe("SubscriptionCard - żądanie w locie blokuje wszystkie akcje", () => {
  it("anulowanie w locie: spinner na przycisku i zablokowane portal, zmiana planu, selektor", async () => {
    const pending = deferred<{ ok: true }>();
    h.cancel.mockReturnValue(pending.promise);
    renderCard();
    const select = await awaitPlans();

    fireEvent.click(buttonOf("profile.subscription.cancel"));

    await waitFor(() => expect(buttonOf("profile.subscription.cancel")).toBeDisabled());
    expect(spinnerIn("profile.subscription.cancel")).not.toBeNull();
    for (const key of ACTION_KEYS) expect(buttonOf(key)).toBeDisabled();
    expect(select).toBeDisabled();
    fireEvent.click(buttonOf("profile.subscription.portal.openPortal"));
    expect(h.portal).not.toHaveBeenCalled();

    pending.resolve({ ok: true });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.canceled"),
    );
    await waitFor(() => expect(buttonOf("profile.subscription.portal.openPortal")).toBeEnabled());
  });

  it("odwieszanie wstrzymanej subskrypcji w locie: spinner i brak anulowania w tym czasie", async () => {
    const pending = deferred<{ ok: true; mode: string }>();
    h.resume.mockReturnValue(pending.promise);
    renderCard({ status: "paused" });

    fireEvent.click(buttonOf("profile.subscription.portal.paused.cta"));

    await waitFor(() => expect(buttonOf("profile.subscription.portal.paused.cta")).toBeDisabled());
    expect(spinnerIn("profile.subscription.portal.paused.cta")).not.toBeNull();
    expect(buttonOf("profile.subscription.cancel")).toBeDisabled();

    pending.resolve({ ok: true, mode: "unpaused" });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.paused.success"),
    );
  });

  it("cofanie anulowania w locie: spinner na „wznów” i zablokowane portale", async () => {
    const pending = deferred<{ ok: true; mode: string }>();
    h.resume.mockReturnValue(pending.promise);
    renderCard({ cancel_at_period_end: true });

    fireEvent.click(buttonOf("profile.subscription.resume"));

    await waitFor(() => expect(buttonOf("profile.subscription.resume")).toBeDisabled());
    expect(spinnerIn("profile.subscription.resume")).not.toBeNull();
    expect(buttonOf("profile.subscription.portal.updatePayment")).toBeDisabled();

    pending.resolve({ ok: true, mode: "cancellation_reverted" });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.resumed"),
    );
  });

  it("zmiana planu w locie: spinner, zablokowany selektor i anulowanie", async () => {
    const pending = deferred<{ ok: true; direction: string }>();
    h.changePlan.mockReturnValue(pending.promise);
    renderCard();
    fireEvent.change(await awaitPlans(), { target: { value: "pro_monthly" } });

    fireEvent.click(buttonOf("profile.subscription.changePlan.cta"));

    await waitFor(() => expect(buttonOf("profile.subscription.changePlan.cta")).toBeDisabled());
    expect(spinnerIn("profile.subscription.changePlan.cta")).not.toBeNull();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(buttonOf("profile.subscription.cancel")).toBeDisabled();
    fireEvent.click(buttonOf("profile.subscription.changePlan.cta"));
    expect(h.changePlan).toHaveBeenCalledTimes(1);
    expect(h.changePlan).toHaveBeenCalledWith({
      data: { targetPriceId: "pro_monthly", environment: "live" },
    });

    pending.resolve({ ok: true, direction: "upgrade" });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.changePlan.success"),
    );
    // Po sukcesie wybór jest czyszczony - kolejny klik nie powtórzy zmiany.
    // Czekamy na KONIEC żądania (spinner znika); dopiero wtedy zablokowany
    // przycisk dowodzi pustego wyboru, a nie trwającej mutacji.
    await waitFor(() => expect(spinnerIn("profile.subscription.changePlan.cta")).toBeNull());
    expect(buttonOf("profile.subscription.changePlan.cta")).toBeDisabled();
    // Nota kierunku znika tylko przy pustym wyborze (kierunek „same").
    expect(screen.queryByText("profile.subscription.portal.upgradeNote")).toBeNull();
    fireEvent.click(buttonOf("profile.subscription.changePlan.cta"));
    expect(h.changePlan).toHaveBeenCalledTimes(1);
  });

  it("zmiana miejsc w locie: spinner i zablokowane +/-", async () => {
    const pending = deferred<{ ok: true; quantity: number }>();
    h.seats.mockReturnValue(pending.promise);
    renderCard({ price_id: "team_monthly_seat", quantity: 2 });

    fireEvent.click(screen.getByLabelText("profile.subscription.portal.seats.label +1"));
    fireEvent.click(buttonOf("profile.subscription.portal.seats.cta"));

    await waitFor(() => expect(buttonOf("profile.subscription.portal.seats.cta")).toBeDisabled());
    expect(spinnerIn("profile.subscription.portal.seats.cta")).not.toBeNull();
    expect(screen.getByLabelText("profile.subscription.portal.seats.label +1")).toBeDisabled();
    expect(screen.getByLabelText("profile.subscription.portal.seats.label -1")).toBeDisabled();

    pending.resolve({ ok: true, quantity: 3 });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.seats.success"),
    );
  });
});

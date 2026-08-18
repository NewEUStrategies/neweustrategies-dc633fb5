// BRAMKA PRZECIW FAŁSZYWEMU SUKCESOWI na ścieżce pieniężnej.
//
// Server fn operatora świadomie NIE RZUCAJĄ, gdy Stripe odmówi - zwracają
// `{ error: "<powód>" }`, żeby powód dało się pokazać człowiekowi. Dla
// `useMutation` z react-query taka odpowiedź to jednak ROZWIĄZANY promise,
// czyli sukces: `onSuccess` odpala się normalnie, a `onError` nigdy.
//
// Do 18.08.2026 cztery mutacje w `SubscriptionCard` nie odpakowywały tego
// ładunku i wszystkie meldowały sukces po odmowie operatora:
//
//   * anulowanie   -> „Subskrypcja anulowana", a klient DALEJ obciążany,
//   * wznowienie   -> „Subskrypcja wznowiona", a dostęp NIE wrócił,
//   * zmiana planu -> komunikat udanej zmiany (`result.direction` był
//                     `undefined`, więc brany był arm „w górę"), do tego
//                     wyczyszczony wybór i odświeżone zapytania - czyli UI
//                     wyglądał dokładnie jak po udanej zmianie,
//   * miejsca      -> „miejsca zaktualizowane", a faktura bez zmian.
//
// Mutacja `portal` w tym samym pliku sprawdzała ładunek POPRAWNIE i to jest
// dowód, że pozostałe cztery były przeoczeniem, nie konwencją.
//
// Każdy test w tym pliku był CZERWONY przed naprawą (commit z `providerResult`)
// i jest zielony po. To bramka: gdyby ktoś usunął `unwrapProviderResult`
// z którejkolwiek mutacji, ten plik natychmiast to pokaże.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { planLadder, providerSubscription } from "@/test/billing/fixtures";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";

const h = vi.hoisted(() => ({
  plans: { current: [] as unknown[] },
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
  return stubs.reactI18nextStub();
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
  previewStripePlanChange: () => Promise.resolve(null),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { SubscriptionCard } from "@/components/billing/SubscriptionCard";

/** Kształt odmowy, jaki server fn operatora naprawdę zwracają. */
const refusal = { error: "subscription_update_failed" } as const;

function renderCard(overrides: Partial<StripeSubscriptionRow> = {}) {
  return renderWithQueryClient(<SubscriptionCard subscription={providerSubscription(overrides)} />);
}

beforeEach(() => {
  h.plans.current = planLadder();
  h.changePlan.mockReset().mockResolvedValue(refusal);
  h.cancel.mockReset().mockResolvedValue(refusal);
  h.resume.mockReset().mockResolvedValue(refusal);
  h.seats.mockReset().mockResolvedValue(refusal);
  h.portal.mockReset().mockResolvedValue(refusal);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.opened.length = 0;
  vi.stubGlobal("open", (url: string) => {
    h.opened.push(url);
    return null;
  });
});

describe("odmowa operatora NIE jest sukcesem - anulowanie", () => {
  it("nie ogłasza „subskrypcja anulowana”, gdy operator odmówił", async () => {
    renderCard();

    fireEvent.click(screen.getByText("profile.subscription.cancel"));

    await waitFor(() => expect(h.cancel).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.cancelFailed"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.subscription.canceled");
  });

  it("udane anulowanie nadal potwierdza (naprawa nie zabiła szczęśliwej ścieżki)", async () => {
    h.cancel.mockResolvedValue({ ok: true });
    renderCard();

    fireEvent.click(screen.getByText("profile.subscription.cancel"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.canceled"),
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("odmowa operatora NIE jest sukcesem - wznowienie", () => {
  it("nie ogłasza wznowienia, gdy operator odmówił", async () => {
    renderCard({ cancel_at_period_end: true });

    fireEvent.click(screen.getByText("profile.subscription.resume"));

    await waitFor(() => expect(h.resume).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.resumeError"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odwieszenie wstrzymanej subskrypcji przy odmowie też nie kłamie", async () => {
    renderCard({ status: "paused" });

    fireEvent.click(screen.getByText("profile.subscription.portal.paused.cta"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.resumeError"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.subscription.portal.paused.success");
  });

  it("udane odwieszenie rozróżnia tryb „unpaused” od cofnięcia anulowania", async () => {
    h.resume.mockResolvedValue({ ok: true, mode: "unpaused" });
    renderCard({ status: "paused" });

    fireEvent.click(screen.getByText("profile.subscription.portal.paused.cta"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.paused.success"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.subscription.resumed");
  });
});

describe("odmowa operatora NIE jest sukcesem - zmiana planu", () => {
  async function pickPro(): Promise<void> {
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro_monthly" } });
  }

  it("nie ogłasza zmiany planu, gdy operator odmówił", async () => {
    renderCard();
    await pickPro();

    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() => expect(h.changePlan).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.changePlan.error"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("po odmowie WYBÓR ZOSTAJE - UI nie wygląda jak po udanej zmianie", async () => {
    renderCard();
    await pickPro();

    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // `onSuccess` czyściło `targetPriceId`; po naprawie nie odpala się wcale,
    // więc wybrany plan i jego nota kierunku dalej są na ekranie.
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("pro_monthly");
    expect(screen.getByText("profile.subscription.portal.upgradeNote")).toBeTruthy();
  });
});

describe("odmowa operatora NIE jest sukcesem - miejsca w planie zespołowym", () => {
  it("nie ogłasza zmiany liczby miejsc, gdy operator odmówił", async () => {
    renderCard({ price_id: "team_monthly_seat", quantity: 2 });

    fireEvent.click(screen.getByLabelText("profile.subscription.portal.seats.label +1"));
    fireEvent.click(screen.getByText("profile.subscription.portal.seats.cta"));

    await waitFor(() => expect(h.seats).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.seats.error"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("odmowa operatora NIE jest sukcesem - portal klienta", () => {
  it("nie otwiera karty i zachowuje osobny komunikat dla braku konta", async () => {
    h.portal.mockResolvedValue({ error: "no_customer" });
    renderCard();

    fireEvent.click(screen.getByText("profile.subscription.portal.openPortal"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.noCustomer"),
    );
    expect(h.opened).toHaveLength(0);
  });

  it("inny powód odmowy daje komunikat ogólny, nie „brak konta”", async () => {
    renderCard();

    fireEvent.click(screen.getByText("profile.subscription.portal.openPortal"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.error"),
    );
    expect(h.toastError).not.toHaveBeenCalledWith("profile.subscription.portal.noCustomer");
  });
});

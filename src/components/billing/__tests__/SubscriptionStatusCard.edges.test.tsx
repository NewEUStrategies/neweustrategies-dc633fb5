// Karta statusu subskrypcji - krawędzie, których nie dotyka
// `billingSmallSurfaces.test.tsx`: język interfejsu przy nazwie warstwy,
// nadania w trakcie wczytywania i metoda płatności, która NIE jest kartą
// (polecenie zapłaty SEPA, portfel bez czterech cyfr). Klient z taką metodą
// ma zobaczyć, czym płaci, a nie pusty napis albo „•••• null”.
//
// Atrapy wyłącznie na granicach: odczyt lustra operatora, nadań i warstwy
// (warstwa danych) oraz server fn metody płatności. Reguła stanu
// (`deriveSubscriptionStatus`) i formatowanie dat działają naprawdę.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { membershipGrant, providerSubscription } from "@/test/billing/fixtures";
import type { MembershipGrantRow } from "@/lib/billing/membership";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  providerSub: { current: null as StripeSubscriptionRow | null },
  grants: { current: [] as MembershipGrantRow[] | undefined },
  tier: { current: null as { key: string; name_pl: string; name_en: string } | null },
  method: { current: null as Record<string, unknown> | null },
  methodCalls: [] as unknown[],
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-me" } } }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripeEnvironmentSafe: () => "sandbox",
  isPaymentsConfigured: () => true,
}));

vi.mock("@/lib/billing/subscriptionQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/subscriptionQueries")>()),
  fetchMyStripeSubscription: () => Promise.resolve(h.providerSub.current),
}));

vi.mock("@/lib/billing/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/membership")>()),
  useMyGrants: () => ({ data: h.grants.current }),
}));

vi.mock("@/lib/billing/tiers", () => ({
  useCurrentTier: () => ({ data: h.tier.current }),
  tierName: (tier: { name_pl: string; name_en: string }, lang: string) =>
    lang === "en" ? tier.name_en : tier.name_pl,
}));

vi.mock("@/utils/payments.functions", () => ({
  getMyPaymentMethod: (arg: unknown) => {
    h.methodCalls.push(arg);
    return Promise.resolve({ method: h.method.current });
  },
}));

import { SubscriptionStatusCard } from "@/components/billing/organisms/SubscriptionStatusCard";

const renderCard = () => renderWithQueryClient(<SubscriptionStatusCard subscription={null} />);

beforeEach(() => {
  h.lang.current = "pl";
  h.providerSub.current = null;
  h.grants.current = [];
  h.tier.current = null;
  h.method.current = null;
  h.methodCalls.length = 0;
});

describe("SubscriptionStatusCard - nadania i język", () => {
  it("w interfejsie angielskim nazwa warstwy nadania jest angielska", async () => {
    h.lang.current = "en";
    h.grants.current = [membershipGrant({ tier_key: "member" })];
    h.tier.current = { key: "member", name_pl: "Członek", name_en: "Member" };
    renderCard();

    await waitFor(() => expect(screen.getByText("Member")).toBeTruthy());
    expect(screen.queryByText("Członek")).toBeNull();
    expect(screen.getByText("profile.planPage.subStatus.grantLifetime")).toBeTruthy();
  });

  it("nadania jeszcze się wczytują: karta pokazuje stan bez nadania, zamiast się wywrócić", async () => {
    h.grants.current = undefined;
    renderCard();

    await waitFor(() => expect(screen.getByText("profile.planPage.subStatus.none")).toBeTruthy());
    expect(screen.queryByText("profile.planPage.grantLifetime")).toBeNull();
  });
});

describe("SubscriptionStatusCard - metoda płatności inna niż karta", () => {
  it("polecenie zapłaty bez marki pokazuje TYP metody i cztery cyfry, bez daty ważności", async () => {
    h.providerSub.current = providerSubscription();
    h.method.current = {
      brand: null,
      last4: "3000",
      expMonth: null,
      expYear: null,
      wallet: null,
      type: "sepa_debit",
    };
    renderCard();

    await waitFor(() => expect(screen.getByText("sepa_debit")).toBeTruthy());
    expect(screen.getByText(/3000/)).toBeTruthy();
    expect(screen.queryByText(/profile\.planPage\.statusCard\.expires/)).toBeNull();
    // Zapytanie idzie ze środowiskiem operatora - nic więcej nie wychodzi.
    expect(h.methodCalls).toEqual([{ data: { environment: "sandbox" } }]);
  });

  it("metoda bez czterech cyfr nie drukuje „•••• null”", async () => {
    h.method.current = {
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      wallet: null,
      type: "link",
    };
    const { container } = renderCard();

    await waitFor(() => expect(screen.getByText("link")).toBeTruthy());
    expect(container.textContent).not.toContain("••••");
    expect(container.textContent).not.toContain("null");
  });

  it("karta bez roku ważności nie składa daty z połowy danych", async () => {
    h.method.current = {
      brand: "visa",
      last4: "4242",
      expMonth: 4,
      expYear: null,
      wallet: null,
      type: "card",
    };
    renderCard();

    await waitFor(() => expect(screen.getByText("visa")).toBeTruthy());
    expect(screen.queryByText(/profile\.planPage\.statusCard\.expires/)).toBeNull();
  });
});

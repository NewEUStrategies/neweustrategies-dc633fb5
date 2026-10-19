// PurchaseConfirmationView: własne CTA i odpowiedzi operatora portalu.
//
// Co udowadniamy i dlaczego:
//   * CTA „własne" pojawia się TYLKO z etykietą I bezpiecznym adresem. Warunek
//     `extraHref && extraLabel` był martwy, bo `safeUrl` bez drugiego argumentu
//     zamienia pusty/niebezpieczny adres w "#": sama etykieta dawała przycisk-
//     -odnośnik na górę strony (naprawione 2026-10-18).
//   * Odpowiedź serwera `{ error }` z tworzenia sesji portalu kończy się
//     toastem błędu i NIE otwiera okna; odpowiedź bez adresu niczego nie
//     otwiera i nie straszy błędem; przycisk wraca do stanu aktywnego.
//
// Granice (jak w purchaseConfirmationView.test.tsx): sonner, TanStack Link
// (wspólna atrapa), useAuth, zapytania billingowe, środowisko Stripe i server fn
// portalu - wszystko poza komponentem; sam komponent i React Query są prawdziwe.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  portalResult: {} as Record<string, unknown>,
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } } }),
}));
vi.mock("@/lib/billing/subscriptionQueries", () => ({
  fetchMyStripeSubscription: async () => ({
    status: "active",
    current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    cancel_at_period_end: false,
    provider_customer_id: "ctm_1",
    provider_subscription_id: "sub_abc",
  }),
}));
vi.mock("@/lib/billing/queries", () => ({ fetchMyOrders: async () => [] }));
vi.mock("@/lib/stripe", () => ({
  getStripeEnvironment: () => "sandbox",
  getStripeEnvironmentSafe: () => "sandbox",
}));
vi.mock("@/utils/payments.functions", () => ({
  createStripePortalSession: async () => state.portalResult,
}));

import { PurchaseConfirmationView } from "../PurchaseConfirmationView";
import type { WidgetContent } from "@/lib/builder/types";

function renderView(c: WidgetContent = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PurchaseConfirmationView c={c} lang="pl" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.portalResult = {};
  toastMock.error.mockClear();
});
afterEach(cleanup);

describe("PurchaseConfirmationView - własne CTA", () => {
  it("sama etykieta bez adresu NIE renderuje odnośnika (wcześniej href='#')", async () => {
    renderView({ ctaLabel_pl: "Czytaj dalej" } as WidgetContent);
    await screen.findByRole("button", { name: /Portal klienta/ });
    expect(screen.queryByRole("link", { name: /Czytaj dalej/ })).toBeNull();
  });

  it("niebezpieczny adres (javascript:) też nie daje odnośnika", async () => {
    renderView({ ctaLabel_pl: "Czytaj dalej", href: "javascript:alert(1)" } as WidgetContent);
    await screen.findByRole("button", { name: /Portal klienta/ });
    expect(screen.queryByRole("link", { name: /Czytaj dalej/ })).toBeNull();
  });

  it("adres bez etykiety nie renderuje pustego przycisku", async () => {
    renderView({ href: "/dalej" } as WidgetContent);
    await screen.findByRole("button", { name: /Portal klienta/ });
    expect(document.querySelector('a[href="/dalej"]')).toBeNull();
  });
});

describe("PurchaseConfirmationView - odpowiedź portalu", () => {
  it("odpowiedź { error } kończy się toastem i nie otwiera okna", async () => {
    state.portalResult = { error: "no_customer" };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderView();
    const button = await screen.findByRole("button", { name: /Portal klienta/ });
    fireEvent.click(button);
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Nie udało się otworzyć portalu klienta. Spróbuj ponownie.",
      ),
    );
    expect(open).not.toHaveBeenCalled();
    await waitFor(() => expect(button).not.toBeDisabled());
    open.mockRestore();
  });

  it("odpowiedź bez adresu niczego nie otwiera i nie zgłasza błędu", async () => {
    state.portalResult = { url: null, overviewUrl: null };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderView();
    const button = await screen.findByRole("button", { name: /Portal klienta/ });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(open).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

// PurchaseConfirmationView: sekcja potwierdzenia po zakupie. Testujemy stany
// danych (aktywna subskrypcja z odnowieniem, wygasła, zakup jednorazowy,
// oczekiwanie na webhook, anonim), portal klienta operatora (otwarcie w nowej
// karcie + błąd -> toast), deterministyczny podgląd w builderze oraz przełącz-
// niki treści widgetu (portal/orders/reference/secure/CTA własne).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  subscription: null as unknown,
  orders: [] as unknown[],
  portalResult: {} as { url?: string; overviewUrl?: string },
  portalShouldFail: false,
  portalCalls: [] as unknown[],
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMock }));
// Widget renderuje TanStack <Link> (orders/profile) - poza RouterProviderem
// zastępujemy go zwykłą kotwicą, jak w pozostałych testach warstwy widgetów.
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...rest
    }: { to?: unknown; children?: unknown } & Record<string, unknown>) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children as never}
      </a>
    ),
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock("@/lib/billing/subscriptionQueries", () => ({
  fetchMyStripeSubscription: async () => state.subscription,
}));
vi.mock("@/lib/billing/queries", () => ({
  fetchMyOrders: async () => state.orders,
}));
vi.mock("@/lib/stripe", () => ({
  getStripeEnvironment: () => "sandbox",
  getStripeEnvironmentSafe: () => "sandbox",
}));
vi.mock("@/utils/payments.functions", () => ({
  createStripePortalSession: async (args: unknown) => {
    state.portalCalls.push(args);
    if (state.portalShouldFail) throw new Error("portal down");
    return state.portalResult;
  },
}));

import { PurchaseConfirmationView } from "../PurchaseConfirmationView";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import type { WidgetContent } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function renderView(c: WidgetContent = {}, lang: "pl" | "en" = "pl") {
  return wrap(<PurchaseConfirmationView c={c} lang={lang} />);
}

const futureIso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const activeSub = (over: Record<string, unknown> = {}) => ({
  status: "active",
  current_period_end: futureIso(30),
  cancel_at_period_end: false,
  provider_customer_id: "ctm_1",
  provider_subscription_id: "sub_abc",
  ...over,
});

const paidOrder = (over: Record<string, unknown> = {}) => ({
  id: "ord-1",
  status: "paid",
  amount_cents: 12900,
  currency: "PLN",
  provider_intent_id: "txn_77",
  provider_session_id: null,
  metadata: { access_until: futureIso(7) },
  ...over,
});

beforeEach(() => {
  state.session = null;
  state.subscription = null;
  state.orders = [];
  state.portalResult = {};
  state.portalShouldFail = false;
  state.portalCalls = [];
  toastMock.error.mockClear();
});
afterEach(cleanup);

describe("PurchaseConfirmationView - stany danych", () => {
  it("asks anonymous visitors to sign in and hides access details", () => {
    renderView();
    expect(screen.getByText("Zaloguj się, aby zobaczyć szczegóły dostępu.")).toBeInTheDocument();
    expect(screen.queryByText("Dostęp")).not.toBeInTheDocument();
  });

  it("shows the renewing subscription with date, days-left and reference", async () => {
    state.session = { user: { id: "u1" } };
    state.subscription = activeSub();
    renderView();

    expect(await screen.findByText(/Odnawia się/)).toBeInTheDocument();
    expect(screen.getByText("Subskrypcja")).toBeInTheDocument();
    expect(screen.getByText(/pozostało 30 dni|pozostało 29 dni/)).toBeInTheDocument();
    expect(screen.getByText("sub_abc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Portal klienta/ })).toBeInTheDocument();
  });

  it("shows the expired subscription state in EN", async () => {
    state.session = { user: { id: "u1" } };
    state.subscription = activeSub({
      status: "canceled",
      current_period_end: new Date(Date.now() - 86_400_000).toISOString(),
      cancel_at_period_end: true,
    });
    renderView({}, "en");
    expect(await screen.findByText("The access period has ended")).toBeInTheDocument();
  });

  it("shows a one-time purchase with amount and EN days-left", async () => {
    state.session = { user: { id: "u1" } };
    state.orders = [paidOrder({ metadata: { access_until: futureIso(1) } })];
    renderView({}, "en");

    expect(await screen.findByText("One-time purchase")).toBeInTheDocument();
    expect(screen.getByText("txn_77")).toBeInTheDocument();
    expect(screen.getByText("1 day left")).toBeInTheDocument();
    // Zakup jednorazowy bez klienta u operatora -> brak portalu.
    expect(screen.queryByRole("button", { name: /Customer portal/ })).not.toBeInTheDocument();
  });

  it("shows the pending-payment panel when no purchase is resolvable yet", async () => {
    state.session = { user: { id: "u1" } };
    renderView();
    expect(await screen.findByText("Potwierdzamy płatność")).toBeInTheDocument();
  });
});

describe("PurchaseConfirmationView - portal klienta", () => {
  it("opens the provider portal in a new tab", async () => {
    state.session = { user: { id: "u1" } };
    state.subscription = activeSub();
    state.portalResult = { overviewUrl: "https://portal.example.com/overview" };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /Portal klienta/ }));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://portal.example.com/overview",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    // Portal dostaje też ścieżkę powrotu, żeby wrócić dokładnie na tę stronę.
    expect(state.portalCalls[0]).toEqual({ data: { environment: "sandbox", returnPath: "/" } });

    open.mockRestore();
  });

  it("falls back to result.url and reports failures with a toast", async () => {
    state.session = { user: { id: "u1" } };
    state.subscription = activeSub();
    state.portalResult = { url: "https://portal.example.com/plain" };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    const first = renderView();
    fireEvent.click(await screen.findByRole("button", { name: /Portal klienta/ }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://portal.example.com/plain",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    first.unmount();

    state.portalShouldFail = true;
    renderView({}, "en");
    fireEvent.click(await screen.findByRole("button", { name: /Customer portal/ }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Could not open the customer portal. Please try again.",
      ),
    );
    open.mockRestore();
  });
});

describe("PurchaseConfirmationView - builder i przełączniki treści", () => {
  it("renders the deterministic DEMO summary on the builder canvas", () => {
    wrap(
      <BuilderModeProvider mode="light">
        <PurchaseConfirmationView
          c={{ heading_pl: "Nagłówek własny", accentColor: "#ff0000" }}
          lang="pl"
        />
      </BuilderModeProvider>,
    );

    expect(screen.getByText("Nagłówek własny")).toBeInTheDocument();
    // DEMO: subskrypcja z odnowieniem i referencją sub_demo_0000.
    expect(screen.getByText("sub_demo_0000")).toBeInTheDocument();
    expect(screen.getByText(/Odnawia się/)).toBeInTheDocument();
    // W builderze portal jest atrapą (bez onClick), ale widoczny.
    expect(screen.getByRole("button", { name: /Portal klienta/ })).toBeInTheDocument();
  });

  it("honors the visibility switches and renders the custom CTA", async () => {
    state.session = { user: { id: "u1" } };
    state.orders = [paidOrder()];
    renderView({
      showPortalLink: "0",
      showOrdersLink: "0",
      showReference: "0",
      showAccessEnd: "0",
      href: "https://example.com/dalej",
      ctaLabel_pl: "Czytaj dalej",
    });

    // showAccessEnd=0 -> brak kart dostępu/referencji nawet po załadowaniu.
    await screen.findByText("Dziękujemy za zakup");
    await waitFor(() => expect(screen.queryByText("Numer transakcji")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Portal klienta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Historia zamówień/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Czytaj dalej/ })).toHaveAttribute(
      "href",
      "https://example.com/dalej",
    );
    // Nota secure bez podpowiedzi portalowej (portal wyłączony).
    expect(screen.getByText(/certyfikowany operator/)).toBeInTheDocument();
    expect(screen.queryByText(/Metoda płatności, faktury/)).not.toBeInTheDocument();
  });

  it("hides the secure note on demand and masks the reference", async () => {
    state.session = { user: { id: "u1" } };
    state.orders = [paidOrder()];
    renderView({ showSecureNote: "0", showReference: "0" });

    expect(await screen.findByText("Zakup jednorazowy")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText(/certyfikowany operator/)).not.toBeInTheDocument();
  });
});

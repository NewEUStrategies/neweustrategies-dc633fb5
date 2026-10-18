// Karta przeniesienia subskrypcji na cennik v6.2 w panelu rozliczeń.
//
// CZEGO PILNUJE:
//   1. PODGLĄD JEST PIERWSZY - „Przelicz podgląd" wysyła `preview`, przechodzi
//      wszystkie partie po kursorze i skleja sumy MRR z całości.
//   2. WYKONANIE ZA PEŁNYM PODGLĄDEM - przycisk jest nieaktywny bez podglądu,
//      przy problemach cennika i bez subskrypcji do przeniesienia.
//   3. FRAZA POTWIERDZENIA - akcja w dialogu odblokowuje się dopiero po
//      przepisaniu literału; wykonanie wysyła `execute` RAZEM z frazą.
//   4. BŁĘDY WIDOCZNE - odmowa prewarunków pokazuje problemy, błędy wierszy
//      zostają w tabeli.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  REPRICING_CONFIRM,
  type RepricingPage,
  type RepricingRow,
} from "@/lib/billing/subscriptionRepricing";

const h = vi.hoisted(() => ({ run: vi.fn(), log: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/i18n-admin-repricing", () => ({ ensureAdminRepricingI18n: () => undefined }));
vi.mock("@/lib/billing/subscriptionRepricing.functions", () => ({
  runSubscriptionRepricing: (arg: unknown) => h.run(arg),
  listSubscriptionRepricingLog: (arg: unknown) => h.log(arg),
}));

import { SubscriptionRepricingCard } from "@/components/admin/billing/SubscriptionRepricingCard";

function row(id: string, patch: Partial<RepricingRow> = {}): RepricingRow {
  return {
    action: "apply",
    reason: null,
    mode: "item",
    lookupKey: "plus_monthly",
    interval: "month",
    quantity: 1,
    fromPriceId: "price_old",
    toPriceId: "price_new",
    currency: "PLN",
    currentAmount: 5900,
    newAmount: 3900,
    currentMrr: 5900,
    newMrr: 3900,
    effectiveAt: "2026-11-05T10:00:00.000Z",
    emailEligible: true,
    subscriptionId: id,
    providerSubscriptionId: `sub_${id}`,
    outcome: "planned",
    emailStatus: null,
    error: null,
    ...patch,
  };
}

function page(patch: Partial<RepricingPage> = {}): RepricingPage {
  return {
    ok: true,
    mode: "preview",
    environment: "live",
    problems: [],
    rows: [row("a")],
    nextCursor: null,
    done: true,
    ...patch,
  };
}

const CURSOR = "00000000-0000-4000-8000-000000000050";

beforeEach(() => {
  h.run.mockReset();
  h.log.mockReset().mockResolvedValue([]);
});

function executeButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "adminRepricing.execute" }) as HTMLButtonElement;
}

describe("SubscriptionRepricingCard", () => {
  it("wykonanie jest nieaktywne przed podglądem", () => {
    renderWithQueryClient(<SubscriptionRepricingCard />);
    expect(executeButton().disabled).toBe(true);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("podgląd przechodzi partie po kursorze i skleja sumy z całości", async () => {
    h.run.mockResolvedValueOnce(page({ nextCursor: CURSOR, done: false })).mockResolvedValueOnce(
      page({
        rows: [row("b", { lookupKey: "team_monthly_seat", currentMrr: 19800, newMrr: 17800 })],
      }),
    );
    renderWithQueryClient(<SubscriptionRepricingCard />);

    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.preview" }));

    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
    expect(h.run).toHaveBeenNthCalledWith(1, { data: { mode: "preview", cursor: null } });
    expect(h.run).toHaveBeenNthCalledWith(2, { data: { mode: "preview", cursor: CURSOR } });
    expect(await screen.findByText("sub_a")).toBeInTheDocument();
    expect(screen.getByText("sub_b")).toBeInTheDocument();
    const summary = screen.getByText(/^adminRepricing\.summary /);
    expect(summary.textContent).toContain('"total":2');
    expect(summary.textContent).toContain('"apply":2');
    expect(executeButton().disabled).toBe(false);
  });

  it("problemy cennika blokują wykonanie i są nazwane", async () => {
    h.run.mockResolvedValueOnce(
      page({ problems: ["catalog_not_synced", "target_price_mismatch:plus_monthly"] }),
    );
    renderWithQueryClient(<SubscriptionRepricingCard />);
    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.preview" }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText('adminRepricing.problems.catalog_not_synced {"key":""}'),
    ).toBeInTheDocument();
    expect(
      within(alert).getByText(
        'adminRepricing.problems.target_price_mismatch {"key":"plus_monthly"}',
      ),
    ).toBeInTheDocument();
    expect(executeButton().disabled).toBe(true);
  });

  it("bez subskrypcji do przeniesienia wykonanie zostaje nieaktywne", async () => {
    h.run.mockResolvedValueOnce(
      page({ rows: [row("a", { action: "skip", reason: "already_current", outcome: "skipped" })] }),
    );
    renderWithQueryClient(<SubscriptionRepricingCard />);
    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.preview" }));

    expect(await screen.findByText("sub_a")).toBeInTheDocument();
    expect(executeButton().disabled).toBe(true);
  });

  it("wykonanie wymaga przepisania frazy i wysyła `execute` razem z nią", async () => {
    h.run
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(
        page({ mode: "execute", rows: [row("a", { outcome: "applied", emailStatus: "queued" })] }),
      );
    renderWithQueryClient(<SubscriptionRepricingCard />);
    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.preview" }));
    await waitFor(() => expect(executeButton().disabled).toBe(false));

    fireEvent.click(executeButton());
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "adminRepricing.confirmAction" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "obniz" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: REPRICING_CONFIRM } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
    expect(h.run).toHaveBeenLastCalledWith({
      data: { mode: "execute", cursor: null, confirm: REPRICING_CONFIRM },
    });
    expect(await screen.findByText("adminRepricing.emailStatuses.queued")).toBeInTheDocument();
  });

  it("odmowa prewarunków przy wykonaniu pokazuje problemy zamiast surowego błędu", async () => {
    h.run.mockResolvedValueOnce(page()).mockResolvedValueOnce({
      ok: false,
      error: "preconditions_failed",
      problems: ["catalog_not_synced"],
    });
    renderWithQueryClient(<SubscriptionRepricingCard />);
    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.preview" }));
    await waitFor(() => expect(executeButton().disabled).toBe(false));
    fireEvent.click(executeButton());
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: REPRICING_CONFIRM } });
    fireEvent.click(within(dialog).getByRole("button", { name: "adminRepricing.confirmAction" }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(/adminRepricing\.problems\.catalog_not_synced/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/adminRepricing\.failed/)).not.toBeInTheDocument();
  });

  it("błąd wiersza zostaje w tabeli, wymóg MFA dostaje wskazówkę step-upu", async () => {
    h.run.mockResolvedValueOnce(
      page({ rows: [row("a", { outcome: "failed", error: "provider_error" })] }),
    );
    renderWithQueryClient(<SubscriptionRepricingCard />);
    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.preview" }));
    // Kod błędu idzie przez słownik (`adminRepricing.reasons.*`), nie surowo.
    expect(await screen.findByText(/^adminRepricing\.reasons\.provider_error/)).toBeInTheDocument();
    expect(screen.queryByText("provider_error")).not.toBeInTheDocument();

    h.run.mockRejectedValueOnce(new Error("Forbidden: mfa_required - verify your second factor"));
    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.preview" }));
    expect(await screen.findByText("adminBilling.mfaStepUpRequired")).toBeInTheDocument();
  });

  it("dziennik ładuje się dopiero po rozwinięciu", async () => {
    h.log.mockResolvedValue([
      {
        id: "log-1",
        provider_subscription_id: "sub_logged",
        to_provider_price_id: "price_new",
        from_provider_price_id: "price_old",
        status: "applied",
        reason: null,
        attempts: 1,
        email_status: "queued",
        lookup_key: "plus_monthly",
        quantity: 1,
        currency: "PLN",
        billing_interval: "month",
        from_amount_cents: 5900,
        to_amount_cents: 3900,
        effective_at: null,
        applied_at: "2026-10-18T10:00:00.000Z",
        user_id: "user-1",
        subscription_id: "a",
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:00:00.000Z",
      },
    ]);
    renderWithQueryClient(<SubscriptionRepricingCard />);
    expect(h.log).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.showLog" }));
    expect(await screen.findByText("sub_logged")).toBeInTheDocument();
    expect(h.log).toHaveBeenCalledWith({ data: {} });
  });

  it("powód w dzienniku idzie przez słownik, a nie jako surowy kod", async () => {
    h.log.mockResolvedValue([
      {
        id: "log-2",
        provider_subscription_id: "sub_interrupted",
        to_provider_price_id: "price_new",
        from_provider_price_id: "price_old",
        status: "failed",
        reason: "in_progress",
        attempts: 1,
        email_status: "pending",
        lookup_key: "plus_monthly",
        quantity: 1,
        currency: "PLN",
        billing_interval: "month",
        from_amount_cents: 5900,
        to_amount_cents: 3900,
        effective_at: null,
        applied_at: null,
        user_id: "user-1",
        subscription_id: "a",
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:00:00.000Z",
      },
    ]);
    renderWithQueryClient(<SubscriptionRepricingCard />);
    fireEvent.click(screen.getByRole("button", { name: "adminRepricing.showLog" }));

    expect(await screen.findByText(/adminRepricing\.reasons\.in_progress/)).toBeInTheDocument();
    expect(screen.queryByText(/· in_progress$/)).not.toBeInTheDocument();
  });
});

// Karta uzgodnienia dawnych anulowań za brak płatności w panelu rozliczeń.
//
// CZEGO PILNUJE:
//   1. SYMULACJA JEST PRZYCISKIEM DOMYŚLNYM - wysyła `dry_run`, nigdy `apply`.
//   2. ZAPIS ZA POTWIERDZENIEM - „Zastosuj" najpierw otwiera dialog; dopiero
//      potwierdzenie wysyła `apply`.
//   3. PARTIE - karta przechodzi kursor z odpowiedzi serwera, aż `done`,
//      i skleja liczniki wszystkich partii.
//   4. ODMOWA BRAMKI PLATFORMY - admin najemcy dostaje wyjaśnienie, a przyciski
//      gasną (operacja nie jest dla niego, ponowienie nic nie da).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  emptyLegacyCounts,
  type LegacyReconcileReport,
} from "@/lib/billing/legacyNonPaymentReconcile";

const h = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/i18n-admin-legacy-non-payment", () => ({
  ensureAdminLegacyNonPaymentI18n: () => undefined,
}));
vi.mock("@/lib/billing/legacyNonPaymentReconcile.functions", () => ({
  runLegacyNonPaymentReconcile: (arg: unknown) => h.run(arg),
}));
// Dialog potwierdzenia jako przycisk - tu liczy się wyłącznie to, że zapis
// czeka na potwierdzenie; sam dialog ma własne testy.
vi.mock("@/components/admin/ConfirmDialog", () => ({
  ConfirmDialog: ({ state }: { state: { onConfirm: () => void } | null }) =>
    state ? <button onClick={() => state.onConfirm()}>potwierdź</button> : null,
}));

import { LegacyNonPaymentReconcileCard } from "@/components/admin/billing/LegacyNonPaymentReconcileCard";

const CURSOR = "00000000-0000-4000-8000-000000000050";

function batch(overrides: Partial<LegacyReconcileReport> = {}): LegacyReconcileReport {
  const counts = emptyLegacyCounts();
  counts.clamp = 1;
  return {
    environment: "live",
    mode: "dry_run",
    scanned: 50,
    candidates: 1,
    counts,
    writes: { anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 },
    rows: [
      {
        subscriptionId: "sub_legacy_1",
        tenantId: "tenant-alfa",
        decision: "clamp",
        evidence: "reason",
        paymentProof: null,
        cancellationReason: "payment_failed",
        invoiceStatus: "open",
        anchor: "2026-01-01T00:00:00.000Z",
        accessUntilBefore: "2026-12-31T00:00:00.000Z",
        accessUntilAfter: "2026-01-15T00:00:00.000Z",
        suspendTeam: false,
        applied: false,
        error: null,
      },
    ],
    nextCursor: null,
    done: true,
    ...overrides,
  };
}

beforeEach(() => {
  h.run.mockReset();
});

describe("LegacyNonPaymentReconcileCard", () => {
  it("symulacja wysyła `dry_run` i przechodzi wszystkie partie po kursorze", async () => {
    h.run.mockResolvedValueOnce(batch({ nextCursor: CURSOR, done: false })).mockResolvedValueOnce(
      batch({
        scanned: 7,
        rows: [{ ...batch().rows[0]!, subscriptionId: "sub_legacy_2", decision: "voluntary" }],
      }),
    );
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
    expect(h.run.mock.calls.map((c) => c[0])).toEqual([
      { data: { mode: "dry_run", cursor: null } },
      { data: { mode: "dry_run", cursor: CURSOR } },
    ]);
    await waitFor(() =>
      expect(
        screen.getByText(
          (text) => text.includes("adminLegacyNonPayment.summary") && text.includes('"scanned":57'),
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByText("sub_legacy_1")).toBeTruthy();
    expect(screen.getByText("sub_legacy_2")).toBeTruthy();
    expect(screen.getByText("adminLegacyNonPayment.decisions.voluntary")).toBeTruthy();
  });

  it("okres opłacony po anulowaniu: wiersz mówi, czym zapłata została udowodniona", async () => {
    const paidRow = {
      ...batch().rows[0]!,
      decision: "paid" as const,
      paymentProof: "invoice" as const,
      invoiceStatus: "paid",
      accessUntilAfter: null,
    };
    h.run.mockResolvedValueOnce(batch({ rows: [paidRow] }));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() =>
      expect(screen.getByText("adminLegacyNonPayment.decisions.paid")).toBeTruthy(),
    );
    expect(screen.getByText("adminLegacyNonPayment.paymentProof.invoice")).toBeTruthy();
  });

  it("„Zastosuj” niczego nie wysyła przed potwierdzeniem, a potem wysyła `apply`", async () => {
    h.run.mockResolvedValue(batch({ mode: "apply" }));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.apply"));
    expect(h.run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("potwierdź"));

    await waitFor(() =>
      expect(h.run).toHaveBeenCalledWith({ data: { mode: "apply", cursor: null } }),
    );
  });

  it("odmowa bramki platformy: wyjaśnienie i wygaszone przyciski", async () => {
    h.run.mockRejectedValue(new Error("Forbidden: platform admin role (super_admin) required"));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() =>
      expect(screen.getByText("adminLegacyNonPayment.platformOnly")).toBeTruthy(),
    );
    const dryRun = screen.getByText("adminLegacyNonPayment.dryRun").closest("button");
    expect(dryRun?.hasAttribute("disabled")).toBe(true);
  });
});

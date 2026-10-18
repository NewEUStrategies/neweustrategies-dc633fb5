// Karta uzgodnienia dawnych anulowań za brak płatności w panelu rozliczeń.
//
// CZEGO PILNUJE:
//   1. SYMULACJA JEST PRZYCISKIEM DOMYŚLNYM - wysyła `dry_run`, nigdy `apply`.
//   2. ZAPIS ZA POTWIERDZENIEM - „Zastosuj" najpierw otwiera dialog; dopiero
//      potwierdzenie wysyła `apply`, a anulowanie niczego nie wysyła.
//   3. PARTIE - karta przechodzi kursor z odpowiedzi serwera, aż `done`,
//      i skleja liczniki wszystkich partii; limit partii na kliknięcie
//      i błąd w połowie zostawiają raport i „Kontynuuj" od miejsca zatrzymania.
//   4. ODMOWA BRAMKI PLATFORMY - admin najemcy dostaje wyjaśnienie, a przyciski
//      gasną (operacja nie jest dla niego, ponowienie nic nie da). Brak MFA
//      i każdy inny błąd - komunikat, przyciski zostają.
//   5. RAPORT - każdy wiersz mówi, co zapisano, z jakiego powodu i co poszło
//      źle; tabela ma limit wierszy, liczniki obejmują wszystkie.
//
// Dialog potwierdzenia jest PRAWDZIWY (`ConfirmDialog` na Radix AlertDialog):
// atrapa tylko granicy sieci (server fn) i słownika.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  emptyLegacyCounts,
  type LegacyReconcileReport,
  type LegacyReconcileRow,
} from "@/lib/billing/legacyNonPaymentReconcile";
import { uiLocale } from "@/lib/i18n/format";

const h = vi.hoisted(() => ({ run: vi.fn(), lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/reactStubs")).reactI18nextStub(() => h.lang),
);
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/i18n-admin-legacy-non-payment", () => ({
  ensureAdminLegacyNonPaymentI18n: () => undefined,
}));
vi.mock("@/lib/billing/legacyNonPaymentReconcile.functions", () => ({
  runLegacyNonPaymentReconcile: (arg: unknown) => h.run(arg),
}));

import {
  LEGACY_RECONCILE_PAGES_PER_RUN,
  LegacyNonPaymentReconcileCard,
} from "@/components/admin/billing/LegacyNonPaymentReconcileCard";

const CURSOR = "00000000-0000-4000-8000-000000000050";

function row(overrides: Partial<LegacyReconcileRow> = {}): LegacyReconcileRow {
  return {
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
    ...overrides,
  };
}

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
    rows: [row()],
    nextCursor: null,
    done: true,
    ...overrides,
  };
}

const summaryWith = (fragment: string) =>
  screen.getByText(
    (text, el) =>
      el?.tagName === "P" &&
      text.includes("adminLegacyNonPayment.summary") &&
      text.includes(fragment),
  );

const button = (label: string) => screen.getByText(label).closest("button") as HTMLButtonElement;

beforeEach(() => {
  h.run.mockReset();
  h.lang = "pl";
});

describe("LegacyNonPaymentReconcileCard", () => {
  it("symulacja wysyła `dry_run` i przechodzi wszystkie partie po kursorze", async () => {
    h.run.mockResolvedValueOnce(batch({ nextCursor: CURSOR, done: false })).mockResolvedValueOnce(
      batch({
        scanned: 7,
        rows: [row({ subscriptionId: "sub_legacy_2", decision: "voluntary" })],
      }),
    );
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
    expect(h.run.mock.calls.map((c) => c[0])).toEqual([
      { data: { mode: "dry_run", cursor: null } },
      { data: { mode: "dry_run", cursor: CURSOR } },
    ]);
    await waitFor(() => expect(summaryWith('"scanned":57')).toBeTruthy());
    expect(summaryWith('"scanned":57').textContent).toContain("adminLegacyNonPayment.simulated");
    expect(screen.getByText("sub_legacy_1")).toBeTruthy();
    expect(screen.getByText("sub_legacy_2")).toBeTruthy();
    expect(screen.getByText("adminLegacyNonPayment.decisions.voluntary")).toBeTruthy();
    // Zadanie skończone - nie ma czego kontynuować.
    expect(screen.queryByText("adminLegacyNonPayment.resume")).toBeNull();
    expect(screen.queryByText("adminLegacyNonPayment.unfinished")).toBeNull();
  });

  it("okres opłacony po anulowaniu: wiersz mówi, czym zapłata została udowodniona", async () => {
    const paidRow = row({
      decision: "paid",
      paymentProof: "invoice",
      invoiceStatus: "paid",
      accessUntilAfter: null,
    });
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
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("adminLegacyNonPayment.confirmTitle")).toBeTruthy();
    expect(h.run).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText("adminLegacyNonPayment.apply"));

    await waitFor(() =>
      expect(h.run).toHaveBeenCalledWith({ data: { mode: "apply", cursor: null } }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("anulowanie dialogu zamyka go i niczego nie wysyła", async () => {
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.apply"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("common.cancel"));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.run).not.toHaveBeenCalled();
  });

  it("w trakcie przebiegu: komunikat „przetwarzanie” i wygaszone przyciski - bez drugiego przebiegu", async () => {
    let finish: (report: LegacyReconcileReport) => void = () => undefined;
    h.run.mockImplementationOnce(
      () => new Promise<LegacyReconcileReport>((resolve) => (finish = resolve)),
    );
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() => expect(screen.getByText("adminLegacyNonPayment.running")).toBeTruthy());
    expect(button("adminLegacyNonPayment.dryRun").disabled).toBe(true);
    expect(button("adminLegacyNonPayment.apply").disabled).toBe(true);
    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));
    expect(h.run).toHaveBeenCalledTimes(1);

    finish(batch());

    await waitFor(() => expect(screen.queryByText("adminLegacyNonPayment.running")).toBeNull());
    expect(button("adminLegacyNonPayment.dryRun").disabled).toBe(false);
  });

  it("odmowa bramki platformy: wyjaśnienie i wygaszone przyciski", async () => {
    h.run.mockRejectedValue(new Error("Forbidden: platform admin role (super_admin) required"));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() =>
      expect(screen.getByText("adminLegacyNonPayment.platformOnly")).toBeTruthy(),
    );
    expect(screen.getByText("adminLegacyNonPayment.platformOnly").className).toContain(
      "text-muted-foreground",
    );
    expect(button("adminLegacyNonPayment.dryRun").disabled).toBe(true);
    expect(button("adminLegacyNonPayment.apply").disabled).toBe(true);
  });

  it("brak podniesienia MFA: prośba o weryfikację, przyciski zostają aktywne", async () => {
    h.run.mockRejectedValue(new Error("mfa_required: step-up verification needed"));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() => expect(screen.getByText("adminBilling.mfaStepUpRequired")).toBeTruthy());
    expect(screen.getByText("adminBilling.mfaStepUpRequired").className).toContain(
      "text-destructive",
    );
    expect(button("adminLegacyNonPayment.dryRun").disabled).toBe(false);
  });
});

describe("LegacyNonPaymentReconcileCard - przebieg przerwany i kontynuacja", () => {
  it("limit partii na kliknięcie: raport zostaje, „Kontynuuj” idzie od kursora tym samym trybem", async () => {
    let n = 0;
    h.run.mockImplementation(async () => {
      n += 1;
      return batch({
        mode: "apply",
        rows: [row({ subscriptionId: `sub_legacy_p${n}` })],
        nextCursor: `cursor-${n}`,
        done: false,
      });
    });
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.apply"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText("adminLegacyNonPayment.apply"),
    );

    await waitFor(() => expect(screen.getByText("adminLegacyNonPayment.resume")).toBeTruthy());
    expect(h.run).toHaveBeenCalledTimes(LEGACY_RECONCILE_PAGES_PER_RUN);
    expect(screen.getByText("adminLegacyNonPayment.unfinished")).toBeTruthy();
    expect(summaryWith(`"scanned":${LEGACY_RECONCILE_PAGES_PER_RUN * 50}`)).toBeTruthy();

    h.run.mockReset();
    h.run.mockResolvedValueOnce(
      batch({ mode: "apply", scanned: 3, rows: [row({ subscriptionId: "sub_legacy_last" })] }),
    );
    fireEvent.click(screen.getByText("adminLegacyNonPayment.resume"));

    await waitFor(() => expect(screen.getByText("sub_legacy_last")).toBeTruthy());
    expect(h.run.mock.calls.map((c) => c[0])).toEqual([
      { data: { mode: "apply", cursor: `cursor-${LEGACY_RECONCILE_PAGES_PER_RUN}` } },
    ]);
    // Kontynuacja dokleja się do raportu, nie zaczyna go od nowa.
    expect(summaryWith(`"scanned":${LEGACY_RECONCILE_PAGES_PER_RUN * 50 + 3}`)).toBeTruthy();
    expect(screen.queryByText("adminLegacyNonPayment.resume")).toBeNull();
    expect(screen.queryByText("adminLegacyNonPayment.unfinished")).toBeNull();
  });

  it("błąd w połowie: komunikat z treścią, raport z udanych partii i kontynuacja od ostatniego kursora", async () => {
    h.run
      .mockResolvedValueOnce(batch({ nextCursor: CURSOR, done: false }))
      .mockRejectedValueOnce(new Error("Worker exceeded time limit"));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    const failure = await screen.findByText(
      'adminLegacyNonPayment.failed {"message":"Worker exceeded time limit"}',
    );
    expect(failure.className).toContain("text-destructive");
    expect(summaryWith('"scanned":50')).toBeTruthy();
    expect(screen.getByText("adminLegacyNonPayment.unfinished")).toBeTruthy();
    expect(button("adminLegacyNonPayment.dryRun").disabled).toBe(false);

    h.run.mockResolvedValueOnce(
      batch({ scanned: 4, rows: [row({ subscriptionId: "sub_legacy_2" })] }),
    );
    fireEvent.click(screen.getByText("adminLegacyNonPayment.resume"));

    await waitFor(() => expect(summaryWith('"scanned":54')).toBeTruthy());
    expect(h.run.mock.calls.at(-1)?.[0]).toEqual({ data: { mode: "dry_run", cursor: CURSOR } });
    expect(screen.queryByText(/adminLegacyNonPayment\.failed/)).toBeNull();
  });
});

describe("LegacyNonPaymentReconcileCard - raport", () => {
  it("zastosowanie: liczniki zapisów, a w wierszu zapis, zespół, powód i błąd", async () => {
    h.run.mockResolvedValueOnce(
      batch({
        mode: "apply",
        writes: { anchors: 2, paymentMarkers: 1, entitlements: 3, teams: 1 },
        rows: [
          row({ applied: true, suspendTeam: true, decision: "revoke" }),
          // Bez powodu od operatora szczegół to status faktury; „przed” bez
          // końca, „po” bez zmiany.
          row({
            subscriptionId: "sub_legacy_2",
            decision: "error",
            cancellationReason: null,
            invoiceStatus: "uncollectible",
            accessUntilBefore: null,
            accessUntilAfter: null,
            error: "entitlement clamp failed: row is locked",
          }),
          row({
            subscriptionId: "sub_legacy_3",
            decision: "stripe_missing",
            cancellationReason: null,
            invoiceStatus: null,
          }),
        ],
      }),
    );
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.apply"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText("adminLegacyNonPayment.apply"),
    );

    await waitFor(() => expect(screen.getByText("sub_legacy_3")).toBeTruthy());
    const summary = summaryWith('"candidates":1').textContent;
    expect(summary).toContain(
      'adminLegacyNonPayment.writes {"anchors":2,"paymentMarkers":1,"entitlements":3,"teams":1}',
    );
    expect(summary).not.toContain("adminLegacyNonPayment.simulated");

    const [first, second, third] = screen.getAllByRole("row").slice(1);
    const cells = (tr: HTMLElement | undefined) =>
      within(tr as HTMLElement)
        .getAllByRole("cell")
        .map((td) => td.textContent);
    const fmt = (iso: string) => new Date(iso).toLocaleString(uiLocale("pl"));

    expect(cells(first)).toEqual([
      "sub_legacy_1",
      "adminLegacyNonPayment.decisions.revoke",
      fmt("2026-12-31T00:00:00.000Z"),
      fmt("2026-01-15T00:00:00.000Z"),
      "adminLegacyNonPayment.appliedadminLegacyNonPayment.teamSuspendedpayment_failed",
    ]);
    expect(cells(second)).toEqual([
      "sub_legacy_2",
      "adminLegacyNonPayment.decisions.error",
      "adminLegacyNonPayment.noEnd",
      "-",
      "uncollectibleentitlement clamp failed: row is locked",
    ]);
    expect(within(second as HTMLElement).getByText(/row is locked/).className).toContain(
      "text-destructive",
    );
    // Bez powodu, statusu faktury i błędu - szczegół pusty.
    expect(cells(third)?.at(-1)).toBe("");
  });

  it("partia bez kandydatów: komunikat zamiast pustej tabeli", async () => {
    h.run.mockResolvedValueOnce(batch({ candidates: 0, counts: emptyLegacyCounts(), rows: [] }));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() => expect(screen.getByText("adminLegacyNonPayment.empty")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("ponad 200 pozycji: tabela pokazuje pierwsze 200 i mówi, ile jest wszystkich", async () => {
    const rows = Array.from({ length: 205 }, (_, i) => row({ subscriptionId: `sub_legacy_${i}` }));
    h.run.mockResolvedValueOnce(batch({ candidates: 205, rows }));
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    await waitFor(() =>
      expect(
        screen.getByText('adminLegacyNonPayment.rowsTruncated {"shown":200,"total":205}'),
      ).toBeTruthy(),
    );
    expect(screen.getAllByRole("row")).toHaveLength(201);
    expect(screen.getByText("sub_legacy_199")).toBeTruthy();
    expect(screen.queryByText("sub_legacy_200")).toBeNull();
  });

  it("interfejs po angielsku: daty w formacie angielskim", async () => {
    h.lang = "en";
    h.run.mockResolvedValueOnce(batch());
    renderWithQueryClient(<LegacyNonPaymentReconcileCard />);

    fireEvent.click(screen.getByText("adminLegacyNonPayment.dryRun"));

    const en = new Date("2026-12-31T00:00:00.000Z").toLocaleString(uiLocale("en"));
    expect(en).not.toBe(new Date("2026-12-31T00:00:00.000Z").toLocaleString(uiLocale("pl")));
    await waitFor(() => expect(screen.getByText(en)).toBeTruthy());
  });
});

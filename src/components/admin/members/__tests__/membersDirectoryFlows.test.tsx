// KATALOG CZŁONKÓW - przepływy, których `membersDirectoryPanel.test.tsx` nie
// dotyka: rozwinięcie wiersza (płatności i nadania), ręczna zmiana planu,
// cofnięcie nadania, synchronizacja z CRM, wyszukiwanie i stronicowanie.
//
// DLACZEGO OSOBNY PLIK. Tamten plik atrapuje `useServerFn` JEDNĄ funkcją
// zwracającą ten sam wynik dla każdej operacji - wystarcza do listy, ale nie
// da się na nim odróżnić nadania od cofnięcia ani odczytu szczegółów od listy.
// Tu każda funkcja serwerowa ma własną atrapę, a `useServerFn` oddaje ją
// po tożsamości.
//
// DEFEKTY PRZYPIĘTE TUTAJ (naprawione w tej samej zmianie):
//   * `MemberBillingDetails` przy BŁĘDZIE odczytu pokazywał „Brak płatności."
//     i „Brak nadań." - nieudany odczyt wyglądał jak zmierzona pusta historia;
//   * pusty kod waluty z bazy wywracał wiersz `RangeError`-em z `Intl`;
//   * `MemberTierDialog` jest zamontowany na stałe, a plan, czas i notatka
//     siedziały w stanie inicjowanym RAZ - notatka i plan wybrane dla osoby A
//     jechały do nadania dla osoby B.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { MemberDirectoryRow } from "@/lib/admin/membersDirectory.functions";

const h = vi.hoisted(() => ({
  fns: {
    listMembers: { id: "listMembers" },
    getMemberBilling: { id: "getMemberBilling" },
    setMemberTier: { id: "setMemberTier" },
    revokeMemberTier: { id: "revokeMemberTier" },
    syncMembersWithCrm: { id: "syncMembersWithCrm" },
  },
  impl: new Map<string, (input: { data: Record<string, unknown> }) => Promise<unknown>>(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { id: string }) => (input: { data: Record<string, unknown> }) => {
    const impl = h.impl.get(fn.id);
    if (!impl) throw new Error(`test: brak atrapy ${fn.id}`);
    return impl(input);
  },
}));
vi.mock("@/lib/admin/membersDirectory.functions", () => h.fns);
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/atoms/AppLink", () => ({
  AppLink: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-members";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { freezeClock } from "@/test/time";
import { MembersDirectoryPanel } from "../MembersDirectoryPanel";
import { MemberBillingDetails } from "../MemberBillingDetails";
import { MemberTierDialog } from "../MemberTierDialog";

const T = (key: string, opts?: Record<string, unknown>) => i18n.t(`adminMembers.${key}`, opts);

function row(over: Partial<MemberDirectoryRow> = {}): MemberDirectoryRow {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    email: "ana@example.com",
    displayName: "Ana Nowak",
    jobTitle: null,
    company: null,
    createdAt: "2026-01-02T10:00:00.000Z",
    tierKey: "reader",
    tierName: "Czytelnik",
    tierSource: "default",
    grantId: null,
    grantExpiresAt: null,
    subscriptionStatus: null,
    subscriptionPeriodEnd: null,
    paidCents: 0,
    currency: "PLN",
    paidOther: [],
    lastPaymentAt: null,
    paymentsCount: 0,
    crmLeadId: null,
    crmStage: null,
    crmCompanyId: null,
    crmCompanyName: null,
    ...over,
  };
}

const TIERS = [
  { key: "reader", name: "Czytelnik", rank: 0 },
  { key: "pro", name: "Pro", rank: 30 },
];

function listResult(rows: MemberDirectoryRow[], total = rows.length) {
  return { rows, total, page: 1, pageSize: 25, tiers: TIERS };
}

const calls = (id: string) =>
  vi.mocked(h.impl.get(id) as (input: { data: Record<string, unknown> }) => Promise<unknown>).mock
    ?.calls ?? [];

function stub(id: keyof typeof h.fns, impl: (data: Record<string, unknown>) => unknown) {
  h.impl.set(
    id,
    vi.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve().then(() => impl(input.data)),
    ),
  );
}

// Daty płatności i nadań są tu WEJŚCIEM formatowania (data w wierszu), a nie
// oknem liczonym od „teraz" - zamrożony zegar trzyma to jawnie.
freezeClock();

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.impl.clear();
  for (const fn of Object.values(h.toast)) fn.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ------------------------------------------------- szczegóły rozliczeń */

describe("MemberBillingDetails", () => {
  it("płatności: data, status, kwota w walucie wiersza i faktura tylko gdy jest", async () => {
    stub("getMemberBilling", () => ({
      payments: [
        {
          id: "p1",
          status: "paid",
          amountCents: 24900,
          currency: "PLN",
          date: "2026-02-03T10:00:00.000Z",
          invoiceUrl: "https://example.com/faktura.pdf",
        },
        {
          id: "p2",
          status: "refunded",
          amountCents: 1000,
          currency: "EUR",
          date: "2026-02-04T10:00:00.000Z",
          invoiceUrl: null,
        },
      ],
      grants: [],
    }));
    renderWithQueryClient(<MemberBillingDetails userId="u1" />);

    const payments = await screen.findAllByRole("listitem");
    expect(payments).toHaveLength(2);
    const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ");
    expect(norm(payments[0]?.textContent ?? null)).toContain("3.02.2026 · paid");
    expect(norm(payments[0]?.textContent ?? null)).toContain("249,00 zł");
    const invoice = within(payments[0] as HTMLElement).getByRole("link", {
      name: T("details.invoice"),
    });
    expect(invoice.getAttribute("href")).toBe("https://example.com/faktura.pdf");
    expect(invoice.getAttribute("rel")).toBe("noreferrer");
    expect(within(payments[1] as HTMLElement).queryByRole("link")).toBeNull();
    expect(norm(payments[1]?.textContent ?? null)).toContain("10,00 €");
    expect(screen.getByText(T("details.noGrants"))).toBeTruthy();
    expect(calls("getMemberBilling")[0]?.[0]).toEqual({ data: { userId: "u1" } });
  });

  it("nadania: cofnięte, terminowe i bezterminowe mówią każde co innego", async () => {
    stub("getMemberBilling", () => ({
      payments: [],
      grants: [
        { id: "g1", tierKey: "pro", revokedAt: "2026-01-05T00:00:00Z", expiresAt: null },
        { id: "g2", tierKey: "pro", revokedAt: null, expiresAt: "2026-12-31T12:00:00Z" },
        { id: "g3", tierKey: "patron", revokedAt: null, expiresAt: null },
      ],
    }));
    renderWithQueryClient(<MemberBillingDetails userId="u1" />);

    const grants = await screen.findAllByRole("listitem");
    expect(grants.map((g) => g.textContent)).toEqual([
      `pro${T("details.revoked")}`,
      `pro${T("details.until", { date: "31.12.2026" })}`,
      `patron${T("details.forever")}`,
    ]);
    expect(screen.getByText(T("details.noPayments"))).toBeTruthy();
  });

  it("w trakcie odczytu pokazuje ładowanie, a nie puste listy", () => {
    stub("getMemberBilling", () => new Promise(() => {}));
    renderWithQueryClient(<MemberBillingDetails userId="u1" />);
    expect(screen.getByText(T("table.loading"))).toBeTruthy();
    expect(screen.queryByText(T("details.noPayments"))).toBeNull();
  });

  it("BŁĄD odczytu to komunikat błędu, a NIE „brak płatności”", async () => {
    stub("getMemberBilling", () => Promise.reject(new Error("permission denied")));
    renderWithQueryClient(<MemberBillingDetails userId="u1" />);

    expect((await screen.findByRole("alert")).textContent).toBe(T("details.loadError"));
    expect(screen.queryByText(T("details.noPayments"))).toBeNull();
    expect(screen.queryByText(T("details.noGrants"))).toBeNull();
  });

  it("pusty kod waluty z bazy nie wywraca wiersza", async () => {
    stub("getMemberBilling", () => ({
      payments: [
        {
          id: "p1",
          status: "paid",
          amountCents: 1234,
          currency: "",
          date: "2026-02-03T10:00:00.000Z",
          invoiceUrl: null,
        },
      ],
      grants: [],
    }));
    renderWithQueryClient(<MemberBillingDetails userId="u1" />);
    expect((await screen.findByRole("listitem")).textContent).toContain("12.34");
  });

  it("po angielsku daty i kwoty idą za językiem panelu", async () => {
    await i18n.changeLanguage("en");
    stub("getMemberBilling", () => ({
      payments: [
        {
          id: "p1",
          status: "paid",
          amountCents: 24900,
          currency: "PLN",
          date: "2026-02-03T10:00:00.000Z",
          invoiceUrl: "https://example.com/f.pdf",
        },
      ],
      grants: [],
    }));
    renderWithQueryClient(<MemberBillingDetails userId="u1" />);
    const item = await screen.findByRole("listitem");
    expect(item.textContent).toContain("03/02/2026");
    expect(within(item).getByRole("link", { name: "Invoice" })).toBeTruthy();
  });
});

/* ------------------------------------------------ ręczna zmiana planu */

describe("MemberTierDialog", () => {
  function renderDialog(member: MemberDirectoryRow | null, onOpenChange = vi.fn()) {
    const utils = renderWithQueryClient(
      <MemberTierDialog member={member} tiers={TIERS} onOpenChange={onOpenChange} />,
    );
    return { ...utils, onOpenChange };
  }

  it("nadanie niesie wybrany plan, liczbę miesięcy i przyciętą notatkę", async () => {
    stub("setMemberTier", () => ({ crmSynced: true }));
    const { onOpenChange } = renderDialog(row());

    fireEvent.change(screen.getByLabelText(T("grant.tier")), { target: { value: "pro" } });
    fireEvent.change(screen.getByLabelText(T("grant.months")), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText(T("grant.note")), {
      target: { value: "  przelew 03/2026  " },
    });
    fireEvent.click(screen.getByRole("button", { name: T("grant.submit") }));

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(T("grant.success")));
    expect(calls("setMemberTier")[0]?.[0]).toEqual({
      data: {
        userId: row().userId,
        tierKey: "pro",
        months: 6,
        note: "przelew 03/2026",
      },
    });
    expect(h.toast.warning).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("„bezterminowo” wysyła `months: null`, pusta notatka - `null`", async () => {
    stub("setMemberTier", () => ({ crmSynced: true }));
    renderDialog(row());

    fireEvent.change(screen.getByLabelText(T("grant.months")), {
      target: { value: "__forever__" },
    });
    fireEvent.click(screen.getByRole("button", { name: T("grant.submit") }));

    await waitFor(() => expect(calls("setMemberTier")).toHaveLength(1));
    expect(calls("setMemberTier")[0]?.[0]).toMatchObject({
      data: { months: null, note: null, tierKey: "reader" },
    });
  });

  it("plan zapisany, ale CRM nie nadążył - sukces I ostrzeżenie", async () => {
    stub("setMemberTier", () => ({ crmSynced: false }));
    renderDialog(row());
    fireEvent.click(screen.getByRole("button", { name: T("grant.submit") }));
    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledWith(T("crm.pending")));
    expect(h.toast.success).toHaveBeenCalled();
  });

  it("odmowa nadania to błąd, a okno zostaje otwarte", async () => {
    stub("setMemberTier", () => Promise.reject(new Error("denied")));
    const { onOpenChange } = renderDialog(row());
    fireEvent.click(screen.getByRole("button", { name: T("grant.submit") }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(T("grant.error")));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("cofnięcie nadania jest dostępne TYLKO przy nadaniu i niesie jego identyfikator", async () => {
    stub("revokeMemberTier", () => ({ crmSynced: false }));
    const { unmount } = renderDialog(row());
    expect(screen.queryByRole("button", { name: T("grant.revoke") })).toBeNull();
    unmount();

    const { onOpenChange } = renderDialog(row({ grantId: "grant-9", tierSource: "grant" }));
    fireEvent.click(screen.getByRole("button", { name: T("grant.revoke") }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(T("grant.revoked")));
    expect(calls("revokeMemberTier")[0]?.[0]).toEqual({ data: { grantId: "grant-9" } });
    expect(h.toast.warning).toHaveBeenCalledWith(T("crm.pending"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("odmowa cofnięcia to błąd", async () => {
    stub("revokeMemberTier", () => Promise.reject(new Error("denied")));
    renderDialog(row({ grantId: "grant-9" }));
    fireEvent.click(screen.getByRole("button", { name: T("grant.revoke") }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(T("grant.error")));
  });

  it("anuluj zamyka okno bez żadnej operacji", () => {
    const { onOpenChange } = renderDialog(row());
    fireEvent.click(screen.getByRole("button", { name: T("grant.cancel") }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("okno otwarte dla osoby pokazuje JEJ obecny plan, a nie pusty wybór", () => {
    // Dialog jest zamontowany na stałe, a otwiera się dopiero po wyborze osoby.
    const { rerender, queryClient } = renderDialog(null);
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemberTierDialog member={row({ tierKey: "pro" })} tiers={TIERS} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText(T("grant.tier"))).toHaveProperty("value", "pro");
  });

  it("plan i notatka wybrane dla osoby A NIE jadą do nadania dla osoby B", async () => {
    stub("setMemberTier", () => ({ crmSynced: true }));
    const onOpenChange = vi.fn();
    const anna = row();
    const bartek = row({ userId: "22222222-2222-4222-8222-222222222222", tierKey: "reader" });
    const { rerender, queryClient } = renderDialog(anna, onOpenChange);
    const withClient = (member: MemberDirectoryRow | null) => (
      <QueryClientProvider client={queryClient}>
        <MemberTierDialog member={member} tiers={TIERS} onOpenChange={onOpenChange} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByLabelText(T("grant.tier")), { target: { value: "pro" } });
    fireEvent.change(screen.getByLabelText(T("grant.note")), { target: { value: "dla Anny" } });
    fireEvent.click(screen.getByRole("button", { name: T("grant.cancel") }));
    rerender(withClient(null));
    rerender(withClient(bartek));

    fireEvent.click(screen.getByRole("button", { name: T("grant.submit") }));
    await waitFor(() => expect(calls("setMemberTier")).toHaveLength(1));
    expect(calls("setMemberTier")[0]?.[0]).toEqual({
      data: { userId: bartek.userId, tierKey: "reader", months: 12, note: null },
    });
  });
});

/* ------------------------------------------------------ panel katalogu */

describe("MembersDirectoryPanel - przepływy", () => {
  it("rozwinięcie wiersza dociąga szczegóły TEJ osoby, a drugie kliknięcie je chowa", async () => {
    stub("listMembers", () => listResult([row({ paymentsCount: 1 })]));
    stub("getMemberBilling", () => ({ payments: [], grants: [] }));
    renderWithQueryClient(<MembersDirectoryPanel />);

    fireEvent.click(await screen.findByRole("button", { name: T("details.show") }));
    expect(await screen.findByText(T("details.noPayments"))).toBeTruthy();
    expect(calls("getMemberBilling")[0]?.[0]).toEqual({ data: { userId: row().userId } });

    fireEvent.click(screen.getByRole("button", { name: T("details.hide") }));
    expect(screen.queryByText(T("details.noPayments"))).toBeNull();
  });

  it("wyszukiwanie idzie na serwer PRZYCIĘTE i po odczekaniu, od pierwszej strony", async () => {
    stub("listMembers", () => listResult([row()]));
    renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText("Ana Nowak");

    fireEvent.change(screen.getByLabelText(T("filters.search")), {
      target: { value: "  nowak  " },
    });
    await waitFor(
      () =>
        expect(calls("listMembers").at(-1)?.[0]).toEqual({
          data: { search: "nowak", tierKey: null, page: 1 },
        }),
      { timeout: 2000 },
    );
  });

  it("filtr planu wysyła klucz planu, a lista pokazuje tylko ten plan", async () => {
    stub("listMembers", (data) =>
      listResult(
        data.tierKey === "pro"
          ? [row({ tierKey: "pro", tierName: "Pro" }), row({ userId: "x", displayName: "Inny" })]
          : [row()],
      ),
    );
    renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText("Ana Nowak");

    fireEvent.change(screen.getByLabelText(T("filters.tier")), { target: { value: "pro" } });

    await waitFor(() =>
      expect(calls("listMembers").at(-1)?.[0]).toMatchObject({ data: { tierKey: "pro" } }),
    );
    await waitFor(() => expect(screen.queryByText("Inny")).toBeNull());
    expect(await screen.findByText("Ana Nowak")).toBeTruthy();
  });

  it("stronicowanie: następna i poprzednia strona, z granicami", async () => {
    stub("listMembers", (data) => ({ ...listResult([row()], 60), page: data.page }));
    renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText(T("table.page", { page: 1, pages: 3 }));

    const prev = screen.getByRole("button", { name: T("table.prev") });
    const next = screen.getByRole("button", { name: T("table.next") });
    expect(prev).toHaveProperty("disabled", true);

    fireEvent.click(next);
    await screen.findByText(T("table.page", { page: 2, pages: 3 }));
    expect(calls("listMembers").at(-1)?.[0]).toMatchObject({ data: { page: 2 } });

    fireEvent.click(screen.getByRole("button", { name: T("table.prev") }));
    await screen.findByText(T("table.page", { page: 1, pages: 3 }));
    expect(screen.getByText(T("table.count", { count: 60 }))).toBeTruthy();
  });

  it("błąd odczytu listy NIE twierdzi, że członków brak", async () => {
    stub("listMembers", () => Promise.reject(new Error("timeout")));
    renderWithQueryClient(<MembersDirectoryPanel />);
    expect(await screen.findByText(T("error"))).toBeTruthy();
    expect(screen.queryByText(T("table.empty"))).toBeNull();
  });

  it("pusta lista mówi to wprost", async () => {
    stub("listMembers", () => listResult([]));
    renderWithQueryClient(<MembersDirectoryPanel />);
    expect(await screen.findByText(T("table.empty"))).toBeTruthy();
  });

  it("członek bez kontaktu CRM i bez płatności ma czytelne braki", async () => {
    stub("listMembers", () => listResult([row({ displayName: null })]));
    renderWithQueryClient(<MembersDirectoryPanel />);
    expect(await screen.findByText(T("crm.missing"))).toBeTruthy();
    expect(screen.getByText(T("table.never"))).toBeTruthy();
    // Bez nazwy wiersz pokazuje adres w obu miejscach.
    expect(screen.getAllByText("ana@example.com")).toHaveLength(2);
  });

  it("„Odśwież” czyta listę ponownie", async () => {
    stub("listMembers", () => listResult([row()]));
    renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText("Ana Nowak");
    const before = calls("listMembers").length;
    fireEvent.click(screen.getByRole("button", { name: T("refresh") }));
    await waitFor(() => expect(calls("listMembers").length).toBe(before + 1));
  });

  it("zamknięcie dialogu zmiany planu wraca do katalogu", async () => {
    stub("listMembers", () => listResult([row()]));
    renderWithQueryClient(<MembersDirectoryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: T("grant.open") }));
    fireEvent.click(await screen.findByRole("button", { name: T("grant.cancel") }));
    await waitFor(() => expect(screen.queryByText(T("grant.title"))).toBeNull());
  });
});

describe("MembersDirectoryPanel - synchronizacja z CRM", () => {
  it("idzie partiami za kursorem aż do końca i melduje sumę", async () => {
    stub("listMembers", () => listResult([row()]));
    const batches = [
      { people: 25, companies: 3, skipped: 0, errors: 0, done: false, nextCursor: "c1" },
      { people: 5, companies: 1, skipped: 2, errors: 0, done: true, nextCursor: null },
    ];
    stub("syncMembersWithCrm", () => batches.shift());
    renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText("Ana Nowak");

    fireEvent.click(screen.getByRole("button", { name: T("crm.sync") }));

    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith(T("crm.synced", { people: 30, companies: 4 })),
    );
    expect(calls("syncMembersWithCrm").map((c) => c[0])).toEqual([
      { data: { cursor: null, batchSize: 25 } },
      { data: { cursor: "c1", batchSize: 25 } },
    ]);
  });

  it("partia z błędami kończy przebieg ostrzeżeniem, nie sukcesem", async () => {
    stub("listMembers", () => listResult([row()]));
    stub("syncMembersWithCrm", () => ({
      people: 3,
      companies: 0,
      skipped: 0,
      errors: 2,
      done: false,
      nextCursor: "c1",
    }));
    renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText("Ana Nowak");
    fireEvent.click(screen.getByRole("button", { name: T("crm.sync") }));
    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledWith(T("crm.pending")));
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("kursor, który stoi w miejscu, przerywa pętlę błędem zamiast kręcić się bez końca", async () => {
    stub("listMembers", () => listResult([row()]));
    stub("syncMembersWithCrm", () => ({
      people: 0,
      companies: 0,
      skipped: 0,
      errors: 0,
      done: false,
      nextCursor: null,
    }));
    renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText("Ana Nowak");
    fireEvent.click(screen.getByRole("button", { name: T("crm.sync") }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(T("crm.syncError")));
    expect(calls("syncMembersWithCrm")).toHaveLength(1);
  });

  it("odmontowanie w trakcie przebiegu przerywa pętlę", async () => {
    stub("listMembers", () => listResult([row()]));
    let release: (value: unknown) => void = () => {};
    stub(
      "syncMembersWithCrm",
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { unmount } = renderWithQueryClient(<MembersDirectoryPanel />);
    await screen.findByText("Ana Nowak");
    fireEvent.click(screen.getByRole("button", { name: T("crm.sync") }));
    await waitFor(() => expect(calls("syncMembersWithCrm")).toHaveLength(1));
    unmount();
    await act(async () => {
      release({ people: 1, companies: 0, skipped: 0, errors: 0, done: false, nextCursor: "c2" });
    });
    expect(calls("syncMembersWithCrm")).toHaveLength(1);
  });
});

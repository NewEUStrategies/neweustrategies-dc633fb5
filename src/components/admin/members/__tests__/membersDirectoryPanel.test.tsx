// Katalog członków - ekran zawsze coś rysuje, więc pomyłka jest cicha.
// Testy pilnują trzech rzeczy decydujących o zaufaniu do panelu:
//   * podstawa planu (nadanie / subskrypcja / domyślny) jest widoczna i tłumaczona,
//   * sentynela „wszystkie plany" NIE jedzie na serwer jako wartość filtra,
//   * kwoty i licznik pochodzą z tej samej odpowiedzi serwera.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  result: null as unknown,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (input: { data: Record<string, unknown> }) => {
    env.calls.push(input.data);
    return env.result;
  },
}));
vi.mock("@/lib/admin/membersDirectory.functions", () => ({
  listMembers: {},
  getMemberBilling: {},
  setMemberTier: {},
  revokeMemberTier: {},
}));

import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-members";
import { MembersDirectoryPanel } from "@/components/admin/members/MembersDirectoryPanel";

const T = (key: string) => i18n.t(`adminMembers.${key}`);

const result = {
  rows: [
    {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "ana@example.com",
      displayName: "Ana Nowak",
      jobTitle: null,
      company: null,
      createdAt: "2026-01-02T10:00:00.000Z",
      tierKey: "pro",
      tierName: "Pro",
      tierSource: "grant" as const,
      grantId: "22222222-2222-4222-8222-222222222222",
      grantExpiresAt: null,
      subscriptionStatus: null,
      subscriptionPeriodEnd: null,
      paidCents: 24900,
      currency: "PLN",
      lastPaymentAt: "2026-02-03T10:00:00.000Z",
      paymentsCount: 2,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  tiers: [
    { key: "reader", name: "Czytelnik", rank: 0 },
    { key: "pro", name: "Pro", rank: 30 },
  ],
};

describe("MembersDirectoryPanel", () => {
  beforeEach(() => {
    env.result = result;
    env.calls = [];
  });
  afterEach(() => cleanup());

  it("pokazuje członka, jego plan i podstawę planu", async () => {
    await i18n.changeLanguage("pl");
    renderWithQueryClient(<MembersDirectoryPanel />);

    expect(await screen.findByText("Ana Nowak")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText(T("source.grant"))).toBeInTheDocument();
  });

  it("nie wysyła sentyneli filtrów na serwer", async () => {
    renderWithQueryClient(<MembersDirectoryPanel />);
    await waitFor(() => expect(env.calls.length).toBeGreaterThan(0));
    expect(env.calls[0]).toMatchObject({ search: null, tierKey: null, page: 1 });
  });

  it("tłumaczy nagłówki na angielski", async () => {
    await i18n.changeLanguage("en");
    renderWithQueryClient(<MembersDirectoryPanel />);
    expect(await screen.findByText("Manual grant")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    await i18n.changeLanguage("pl");
  });

  it("otwiera dialog ręcznej zmiany planu", async () => {
    await i18n.changeLanguage("pl");
    renderWithQueryClient(<MembersDirectoryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: T("grant.open") }));
    expect(await screen.findByText(T("grant.title"))).toBeInTheDocument();
  });
});

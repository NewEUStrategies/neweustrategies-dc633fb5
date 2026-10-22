// Sklejenie trasy `/admin/newsletter/email-content` z edytorem prośby
// o potwierdzenie (I9d-Y1): edytor leży obok treści maili transakcyjnych,
// ładuje się leniwie (`NewsletterSunsetCopySection`) i widzi go WYŁĄCZNIE
// administrator najemcy (te same role co bramka `requireAdmin` funkcji
// serwerowych) - redaktor newslettera dostałby tylko odmowę, więc nie dostaje
// sekcji wcale. Sama trasa nie sprawdza ról (bramka
// `adminRouteAuthority.gate.test.ts` - dostępu pilnuje layout `/admin`).
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import { renderRoute } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  auth: { tenantId: null as string | null, isAdmin: false },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/components/admin/newsletter/system-emails/TxEmailContentPanel", () => ({
  TxEmailContentPanel: () => <div data-testid="panel-email-content" />,
}));
vi.mock("@/components/admin/settings/dataRetention/NewsletterSunsetCopyEditor", () => ({
  default: ({ tenantId }: { tenantId: string }) => (
    <div data-testid="sunset-copy-editor" data-tenant={tenantId} />
  ),
}));

import { Route } from "@/routes/admin.newsletter.email-content";

const PATH = "/admin/newsletter/email-content";
const TENANT = "11111111-1111-4111-8111-111111111111";

describe("treści maili newslettera + prośba o potwierdzenie", () => {
  it("administrator z najemcą: oba edytory, prośba z najemcą sesji", async () => {
    h.auth = { tenantId: TENANT, isAdmin: true };
    const { getByTestId, findByTestId } = await renderRoute({
      route: Route,
      path: PATH,
      initialEntry: PATH,
    });
    expect(getByTestId("panel-email-content")).toBeTruthy();
    expect((await findByTestId("sunset-copy-editor")).getAttribute("data-tenant")).toBe(TENANT);
  });

  it("redaktor (bez roli administratora): tylko treści maili transakcyjnych", async () => {
    h.auth = { tenantId: TENANT, isAdmin: false };
    const { getByTestId, queryByTestId } = await renderRoute({
      route: Route,
      path: PATH,
      initialEntry: PATH,
    });
    expect(getByTestId("panel-email-content")).toBeTruthy();
    await waitFor(() => expect(queryByTestId("sunset-copy-editor")).toBeNull());
  });

  it("bez najemcy sesji (render serwera): bez edytora prośby", async () => {
    h.auth = { tenantId: null, isAdmin: true };
    const { queryByTestId } = await renderRoute({ route: Route, path: PATH, initialEntry: PATH });
    expect(queryByTestId("sunset-copy-editor")).toBeNull();
  });
});

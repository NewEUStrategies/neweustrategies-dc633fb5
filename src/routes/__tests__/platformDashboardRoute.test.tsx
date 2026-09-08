import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, okCount, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ tenant: "tenant-a" }));
const db = supabaseFromStub();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));
vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => h.tenant }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/admin/analytics/AdminBiStrip", () => ({
  AdminBiStrip: () => <aside>Analytics</aside>,
}));
import { Route } from "../admin.index";

let qc: QueryClient;
beforeEach(() => {
  h.tenant = "tenant-a";
  db.reset();
  for (const table of ["categories", "tags", "media"]) db.setResponse(table, okCount(3));
  db.setResponse("posts", (chain) => {
    const status = chain.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
    return okCount(status === "published" ? 2400 : status === "draft" ? 101 : 2501);
  });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
});
function tree() {
  const Component = Route.options.component!;
  return (
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>
  );
}

describe("tenant dashboard measures server counts and exposes failed reads", () => {
  it("shows pending, then exact counts beyond the PostgREST row limit using HEAD", async () => {
    render(tree());
    expect(screen.getByRole("status").textContent).toBe("admin.loading");
    expect(screen.queryByRole("link")).toBeNull();
    const posts = await screen.findByRole("link", { name: /admin.nav.posts/ });
    expect(within(posts).getByText("2501")).toBeTruthy();
    expect(posts.textContent).toContain("2400 admin.published · 101 admin.drafts");
    expect(screen.getAllByRole("link")).toHaveLength(4);
    for (const chain of db.chains) {
      expect(chain.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
      expect(chain.calls).toContainEqual({ method: "eq", args: ["tenant_id", "tenant-a"] });
    }
    for (const chain of db.chainsFor("posts"))
      expect(chain.argsOf("is")).toEqual(["deleted_at", null]);
  });
  it("renders a genuine empty database as zero after the read succeeds", async () => {
    for (const table of ["posts", "categories", "tags", "media"]) db.setResponse(table, okCount(0));
    render(tree());
    await screen.findByRole("link", { name: /admin.nav.posts/ });
    expect(screen.getAllByText("0")).toHaveLength(4);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["posts", "categories", "tags", "media"])(
    "does not replace a failed %s read with zero",
    async (table) => {
      db.setResponse(table, fail("private database details"));
      render(tree());
      expect((await screen.findByRole("alert")).textContent).toContain("admin.dashboard.loadError");
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByText(/private database/)).toBeNull();
      expect(screen.getByText("Analytics")).toBeTruthy();
    },
  );
  it("treats a missing exact count as a protocol error and can retry", async () => {
    db.setResponse("media", ok(null));
    render(tree());
    await screen.findByRole("alert");
    db.setResponse("media", okCount(12));
    fireEvent.click(screen.getByRole("button", { name: "admin.dashboard.retry" }));
    expect(
      within(await screen.findByRole("link", { name: /admin.nav.media/ })).getByText("12"),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not show the previous tenant's cached counts after switching tenant", async () => {
    const view = render(tree());
    await screen.findByText("2501");
    h.tenant = "tenant-b";
    db.setResponse("posts", okCount(8));
    view.rerender(tree());
    expect(screen.queryByText("2501")).toBeNull();
    await waitFor(() =>
      expect(qc.getQueryData(["admin-stats", "tenant-b"])).toMatchObject({ posts: 8 }),
    );
    expect(qc.getQueryData(["admin-stats", "tenant-a"])).toMatchObject({ posts: 2501 });
  });
});

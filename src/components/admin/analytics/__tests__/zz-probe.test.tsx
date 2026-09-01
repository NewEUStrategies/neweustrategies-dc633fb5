import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ listSites: vi.fn(), queryAnalytics: vi.fn() }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/analytics/gsc.functions", () => ({
  listGscSites: (...a: unknown[]) => h.listSites(...a),
  queryGscAnalytics: (...a: unknown[]) => h.queryAnalytics(...a),
}));
vi.mock("@/components/admin/analytics/EChart", () => ({ EChart: () => <div data-testid="echart" /> }));
import "@/test/i18nReal";
import { axeViolations } from "@/test/axe";
import { GscBiDashboard } from "@/components/admin/analytics/GscBiDashboard";

beforeEach(() => {
  h.listSites.mockResolvedValue({ sites: [{ siteUrl: "sc-domain:alfa.example.com", permissionLevel: "siteOwner" }], configured: true });
  h.queryAnalytics.mockResolvedValue({ rows: [{ keys: ["2026-08-01"], clicks: 1, impressions: 10, ctr: 0.1, position: 3 }] });
});

describe("probe", () => {
  it("axe nodes", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><GscBiDashboard configured /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
    const v = await axeViolations(container);
    for (const vio of v) {
      console.log("RULE", vio.id, vio.nodes.length);
      for (const n of vio.nodes) console.log("  NODE", n.html.slice(0, 160));
    }
    expect(true).toBe(true);
  });

  it("transient leak", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.queryAnalytics.mockResolvedValue({ rows: [{ keys: ["alfa fraza"], clicks: 5, impressions: 50, ctr: 0.1, position: 3 }] });
    const first = render(<QueryClientProvider client={client}><GscBiDashboard configured /></QueryClientProvider>);
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));
    await screen.findByText("alfa fraza");
    first.unmount();

    h.listSites.mockResolvedValue({ sites: [{ siteUrl: "sc-domain:beta.example.org", permissionLevel: "siteOwner" }], configured: true });
    h.queryAnalytics.mockClear();
    h.queryAnalytics.mockResolvedValue({ rows: [{ keys: ["beta fraza"], clicks: 5, impressions: 50, ctr: 0.1, position: 3 }] });
    const second = render(<QueryClientProvider client={client}><GscBiDashboard configured /></QueryClientProvider>);
    console.log("TRANSIENT contains alfa:", (second.container.textContent ?? "").includes("alfa fraza"));
    const calls = h.queryAnalytics.mock.calls.map((c) => (c[0] as { data: { siteUrl: string } }).data.siteUrl);
    console.log("IMMEDIATE CALLS", JSON.stringify(calls));
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));
    const all = h.queryAnalytics.mock.calls.map((c) => (c[0] as { data: { siteUrl: string } }).data.siteUrl);
    console.log("ALL CALLS", JSON.stringify([...new Set(all)]));
    expect(true).toBe(true);
  });
});

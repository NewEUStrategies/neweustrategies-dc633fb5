// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, expect, it, vi } from "vitest";
import { fetchSiteDesignTokensRow } from "../designTokens";
import { clearEdgeTtlCache, setEdgeTtlL2Adapter } from "@/lib/ssrCache";

const requestHost = new AsyncLocalStorage<string>();
const reads: string[] = [];
const pending = new Map<string, () => void>();
const failedHosts = new Set<string>();

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => requestHost.getStore() ?? null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        maybeSingle: () => {
          const host = requestHost.getStore()!;
          reads.push(host);
          if (failedHosts.has(host))
            return Promise.resolve({ data: null, error: new Error("temporary outage") });
          return new Promise((resolve) =>
            pending.set(host, () =>
              resolve({
                data: {
                  fonts: { body: host },
                  colors: [],
                  scale: {},
                  global_colors: {},
                  font_scale: {},
                },
                error: null,
              }),
            ),
          );
        },
      }),
    }),
  },
}));

beforeEach(() => {
  clearEdgeTtlCache();
  setEdgeTtlL2Adapter(null);
  reads.length = 0;
  pending.clear();
  failedHosts.clear();
});

it("deduplicates concurrent chrome reads per host without sharing another tenant's theme", async () => {
  const a = requestHost.run("a.example", () => fetchSiteDesignTokensRow());
  const a2 = requestHost.run("a.example", () => fetchSiteDesignTokensRow());
  const b = requestHost.run("b.example", () => fetchSiteDesignTokensRow());
  await vi.waitFor(() => expect(reads).toEqual(["a.example", "b.example"]));
  pending.get("a.example")!();
  pending.get("b.example")!();
  expect((await a)?.fonts).toEqual({ body: "a.example" });
  expect(await a2).toEqual(await a);
  expect((await b)?.fonts).toEqual({ body: "b.example" });
});

it("does not cache a database failure as a successful empty theme", async () => {
  failedHosts.add("a.example");
  await expect(requestHost.run("a.example", fetchSiteDesignTokensRow)).resolves.toBeNull();
  failedHosts.clear();
  const recovered = requestHost.run("a.example", fetchSiteDesignTokensRow);
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  pending.get("a.example")!();
  expect((await recovered)?.fonts).toEqual({ body: "a.example" });
});

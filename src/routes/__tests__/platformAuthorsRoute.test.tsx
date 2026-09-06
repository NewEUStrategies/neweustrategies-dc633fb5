import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserRow } from "@/lib/admin/users-query";
import type { ExpertsDirectoryData } from "@/lib/experts/directory";

const h = vi.hoisted(() => ({
  lang: "pl",
  directory: {} as ExpertsDirectoryData,
  users: [] as AdminUserRow[],
  posts: vi.fn(),
  rpc: vi.fn(),
  chain: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: h.lang },
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      options?.defaultValue ?? (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/lib/i18n-experts", () => ({ ensureI18n() {} }));
vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-one" }));
vi.mock("@/components/ui/select", async () => await import("@/test/platform/nativeControls"));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: { slug: string };
    children: ReactNode;
  }) => <a href={to.replace("$slug", params?.slug ?? "")}>{children}</a>,
}));
vi.mock("@/lib/experts/directory", () => ({
  expertsDirectoryQueryOptions: () => ({
    queryKey: ["experts-test"],
    queryFn: async () => h.directory,
    staleTime: Infinity,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
    from: (table: string) => {
      const builder = {
        select: (value: string) => {
          h.chain(table, "select", value);
          return builder;
        },
        eq: (...args: unknown[]) => {
          h.chain(table, "eq", ...args);
          return builder;
        },
        in: (...args: unknown[]) => {
          h.chain(table, "in", ...args);
          return builder;
        },
        is: (...args: unknown[]) => {
          h.chain(table, "is", ...args);
          return h.posts();
        },
      };
      return builder;
    },
  },
}));

import { Route } from "@/routes/admin.authors";
import { adminUsersQueryKey } from "@/lib/admin/users-query";
import { expertsDirectoryQueryOptions } from "@/lib/experts/directory";

const area = {
  id: "area",
  slug: "economy",
  name_pl: "Gospodarka",
  name_en: "Economy",
  sort_order: 0,
  is_active: true,
};
const program = { id: "program", name_pl: "Europa", name_en: "Europe" };
function user(id: string, overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id,
    display_name: id,
    email: `${id}@example.test`,
    avatar_url: null,
    slug: id,
    cover_url: null,
    bio: null,
    bio_pl: null,
    bio_en: null,
    twitter_url: null,
    linkedin_url: null,
    website_url: null,
    created_at: "2026-01-01",
    updated_at: null,
    roles: ["author"],
    ...overrides,
  };
}
let qc: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.directory = {
    experts: [
      {
        id: "Ala",
        slug: "ala",
        display_name: "Ala",
        avatar_url: null,
        job_title: "Analityczka",
        company: "NES",
        verified_at: "2026-01-01",
        areas: [area],
        programs: [program],
        postCount: 0,
      },
    ],
    facets: { areas: [area], programs: [program] },
  };
  h.users = [
    user("Ala", { avatar_url: "/avatar.png" }),
    user("Beata", { roles: ["editor", "admin"] }),
    user("ignored", { roles: ["user"] }),
    user("unknown", { display_name: null, email: null, slug: null, roles: ["super_admin"] }),
  ];
  h.rpc.mockImplementation(async () => ({ data: h.users, error: null }));
  h.posts.mockResolvedValue({
    data: [{ author_id: "Ala" }, { author_id: "Ala" }, { author_id: "Beata" }, { author_id: null }],
    error: null,
  });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(expertsDirectoryQueryOptions().queryKey, h.directory);
});
afterEach(() => {
  cleanup();
  qc.clear();
});
function mount() {
  const Component = Route.options.component!;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

describe("authors: live user cache and publication counts", () => {
  it.each(["pl", "en"])(
    "renders roles, expertise, profile links and publication ranking in %s",
    async (lang) => {
      h.lang = lang;
      mount();
      await screen.findByText("Analityczka · NES");
      const cards = screen.getAllByRole("listitem");
      expect(cards).toHaveLength(3);
      expect(within(cards[0]).getByText("Ala")).toBeTruthy();
      expect(within(cards[0]).getByText("expert.publicationsCount:2")).toBeTruthy();
      expect(within(cards[0]).getByRole("link", { name: "expert.viewProfile" })).toHaveAttribute(
        "href",
        "/author/Ala",
      );
      expect(cards[0].querySelector("img")).toHaveAttribute("src", "/avatar.png");
      expect(within(cards[1]).getByText("Beata@example.test")).toBeTruthy();
      expect(within(cards[2]).queryByRole("link", { name: "expert.viewProfile" })).toBeNull();
      expect(screen.queryByText("ignored")).toBeNull();
      expect(h.chain).toHaveBeenCalledWith("posts", "eq", "tenant_id", "tenant-one");
      expect(h.chain).toHaveBeenCalledWith("posts", "eq", "status", "published");
      expect(h.chain).toHaveBeenCalledWith("posts", "is", "deleted_at", null);
    },
  );
  it("combines text, area and program filters and clears each of them", async () => {
    mount();
    await screen.findByText("Ala");
    const [areaControl, programControl] = screen.getAllByRole("combobox");
    fireEvent.change(areaControl, { target: { value: "economy" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(programControl, { target: { value: "program" } });
    fireEvent.change(areaControl, { target: { value: "__all__" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(programControl, { target: { value: "__all__" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  BEATA@EXAMPLE  " } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(areaControl, { target: { value: "economy" } });
    expect(screen.getByText("expert.directoryEmptyFiltered")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "expert.clearFilters" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("reflects a renamed author immediately without a user-count change", async () => {
    mount();
    await screen.findByText("Ala");
    await act(async () => {
      qc.setQueryData(
        adminUsersQueryKey("tenant-one"),
        h.users.map((u) => (u.id === "Ala" ? { ...u, display_name: "Nowe imię" } : u)),
      );
    });
    expect(await screen.findByText("Nowe imię")).toBeTruthy();
    expect(screen.queryByText("Ala")).toBeNull();
    expect(h.posts).toHaveBeenCalledTimes(1);
  });
  it("recounts when roles change while the user count stays constant", async () => {
    mount();
    await screen.findByText("Ala");
    await act(async () => {
      qc.setQueryData(
        adminUsersQueryKey("tenant-one"),
        h.users.map((u) => ({
          ...u,
          roles: (u.id === "ignored" ? ["author"] : ["user"]) as AdminUserRow["roles"],
        })),
      );
    });
    await screen.findByText("ignored");
    expect(screen.queryByText("Ala")).toBeNull();
    expect(h.chain).toHaveBeenLastCalledWith("posts", "is", "deleted_at", null);
    expect(h.chain).toHaveBeenCalledWith("posts", "in", "author_id", ["ignored"]);
  });
  it("does not query posts when there are no authors", async () => {
    h.users = [];
    h.directory = { experts: [], facets: { areas: [], programs: [] } };
    qc.setQueryData(["experts-test"], h.directory);
    mount();
    await screen.findByText("Brak autorów.");
    expect(h.posts).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("sorts ties, including missing names, and accepts a genuinely empty post result", async () => {
    h.posts.mockResolvedValue({ data: null, error: null });
    h.users = [user("Zeta"), user("Beta"), user("null", { display_name: null })];
    mount();
    await screen.findByText("Zeta");
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).getByText("-")).toBeTruthy();
    expect(within(cards[1]).getByText("Beta")).toBeTruthy();
  });
  it.each(["users", "posts"])(
    "shows a %s failure instead of fabricated zero counts",
    async (source) => {
      (source === "users" ? h.rpc : h.posts).mockResolvedValue({
        data: null,
        error: new Error("denied"),
      });
      mount();
      expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się pobrać");
      expect(screen.queryByRole("list")).toBeNull();
    },
  );
  it("renders loading until the user directory resolves", async () => {
    let resolve!: (value: unknown) => void;
    h.rpc.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mount();
    expect(screen.getByText("Ładowanie...")).toBeTruthy();
    await act(async () => {
      resolve({ data: [], error: null });
    });
    await screen.findByText("Brak autorów.");
  });
  it("uses the shared directory loader contract", async () => {
    const loader = Route.options.loader as (args: unknown) => Promise<unknown>;
    const ensure = vi.spyOn(qc, "ensureQueryData");
    expect(await loader({ context: { queryClient: qc } })).toBeNull();
    expect(ensure).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["experts-test"] }));
  });
});

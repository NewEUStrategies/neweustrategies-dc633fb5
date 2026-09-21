import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawerConfig } from "@/lib/mobileDrawer";
import type { ReadingTimeSettings } from "@/lib/readingTime";
const h = vi.hoisted(() => ({
  lang: "pl",
  super: true,
  loading: false,
  dragging: false,
  navigate: vi.fn(),
  upsert: vi.fn(),
  saveReading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  reading: {} as ReadingTimeSettings,
  drag: { active: { id: "nav" }, over: { id: "account" } as { id: string } | null },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.lang } }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/lib/i18n-admin-mobile-drawer", () => ({ ensureI18n() {} }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isSuperAdmin: h.super, loading: h.loading }),
}));
vi.mock("@tanstack/react-router", async (o) => ({
  ...(await o<typeof import("@tanstack/react-router")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("@tanstack/react-start", async (o) => ({
  ...(await o<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/mobileDrawer.functions", () => ({
  upsertMobileDrawerConfig: (...args: unknown[]) => h.upsert(...args),
  getMobileDrawerConfig: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({ upsert: (...args: unknown[]) => h.saveReading(table, ...args) }),
  },
}));
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: () => h.reading,
  siteSettingsQueryOptions: { queryKey: ["site-settings"] },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => h.success(...args),
    error: (...args: unknown[]) => h.error(...args),
  },
}));
vi.mock("@/components/ui/select", async () => await import("@/test/platform/nativeControls"));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: (event: typeof h.drag) => void;
  }) => (
    <div>
      <button data-testid="drag-boundary" onClick={() => onDragEnd(h.drag)}>
        drag
      </button>
      {children}
    </div>
  ),
  PointerSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: () => [],
}));
vi.mock("@dnd-kit/sortable", async (o) => ({
  ...(await o<typeof import("@dnd-kit/sortable")>()),
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: h.dragging ? { x: 3, y: 4, scaleX: 1, scaleY: 1 } : null,
    transition: "transform 100ms",
    isDragging: h.dragging,
  }),
}));

import { Route as Reading } from "@/routes/admin.reading-time";
import { Route as Drawer } from "@/routes/admin.super.mobile-drawer";
import { DEFAULT_DRAWER_CONFIG } from "@/lib/mobileDrawer";
import { DEFAULT_READING_TIME_SETTINGS } from "@/lib/readingTime";
import { mobileDrawerConfigQueryOptions } from "@/lib/queries/mobileDrawer";

let qc: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.super = true;
  h.loading = false;
  h.dragging = false;
  h.reading = { ...DEFAULT_READING_TIME_SETTINGS };
  h.saveReading.mockResolvedValue({ error: null });
  h.upsert.mockImplementation(async ({ data }: { data: DrawerConfig }) => data);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
});
function mount(Component: NonNullable<typeof Reading.options.component>) {
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}
function drawerConfig(): DrawerConfig {
  return {
    ...structuredClone(DEFAULT_DRAWER_CONFIG),
    nav_items: [
      {
        id: "nav-a",
        label_pl: "Analizy",
        label_en: "Analyses",
        href: "/blog",
        icon: "home",
        enabled: true,
      },
      {
        id: "nav-b",
        label_pl: "Kontakt",
        label_en: "Contact",
        href: "/kontakt",
        icon: "home",
        enabled: true,
      },
    ],
  };
}
function drawer(config: DrawerConfig = drawerConfig()) {
  qc.setQueryData(mobileDrawerConfigQueryOptions.queryKey, config);
  return mount(Drawer.options.component!);
}
function change(id: string, value: string) {
  const field = document.getElementById(id);
  expect(field).toBeTruthy();
  fireEvent.change(field!, { target: { value } });
}

describe("reading-time settings route", () => {
  it("marks both settings surfaces as non-indexable", () => {
    for (const route of [Reading, Drawer]) {
      const head = route.options.head as () => { meta: unknown[] };
      expect(head().meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    }
  });
  it("saves validated settings and invalidates the public settings cache", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    mount(Reading.options.component!);
    for (const [id, value] of [
      ["rt-wpm-pl", "300"],
      ["rt-wpm-en", "320"],
      ["rt-min", "2"],
      ["rt-img-head", "10"],
      ["rt-img-tail", "2"],
      ["rt-img-count", "5"],
      ["rt-code", "0.5"],
    ])
      change(id, value);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "floor" } });
    fireEvent.click(screen.getByRole("switch"));
    change("rt-sample-pl", "Polski tekst testowy.");
    change("rt-sample-en", "English sample text.");
    change("rt-sample-images", "3");
    fireEvent.click(screen.getByRole("button", { name: "admin.save" }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("admin.saved"));
    expect(h.saveReading).toHaveBeenCalledWith(
      "site_settings",
      expect.objectContaining({
        key: "reading_time",
        value: expect.objectContaining({
          wpm_pl: 300,
          wpm_en: 320,
          min_minutes: 2,
          rounding: "floor",
          enabled: false,
        }),
      }),
      { onConflict: "tenant_id,key" },
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site-settings"] });
  });
  it("hides advanced controls for ordinary admins and resets the draft", () => {
    h.super = false;
    mount(Reading.options.component!);
    expect(document.getElementById("rt-code")).toBeNull();
    change("rt-wpm-pl", "100");
    fireEvent.click(screen.getByRole("button", { name: "admin.readingTime.reset" }));
    expect((document.getElementById("rt-wpm-pl") as HTMLInputElement).value).toBe(
      String(DEFAULT_READING_TIME_SETTINGS.wpm_pl),
    );
  });
  it("disables saving invalid input and keeps the preview usable", () => {
    mount(Reading.options.component!);
    change("rt-wpm-pl", "1");
    expect(screen.getByRole("button", { name: "admin.save" })).toBeDisabled();
    expect(h.saveReading).not.toHaveBeenCalled();
  });
  it.each(["database", "network"])(
    "reports a rejected %s write without claiming success or leaving the form busy",
    async (failure) => {
      if (failure === "database")
        h.saveReading.mockResolvedValue({ error: new Error("RLS denied") });
      else h.saveReading.mockRejectedValue(new Error("network offline"));
      mount(Reading.options.component!);
      fireEvent.click(screen.getByRole("button", { name: "admin.save" }));
      await waitFor(() => expect(h.error).toHaveBeenCalledWith("admin.saveError"));
      expect(h.success).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "admin.save" })).toBeEnabled();
    },
  );
});

describe("mobile-drawer configuration route", () => {
  it.each([true, false])(
    "redirects unauthorized users only after auth resolves (loading=%s)",
    async (loading) => {
      h.super = false;
      h.loading = loading;
      const view = drawer();
      expect(view.container.textContent).toBe("");
      expect(h.navigate).toHaveBeenCalledTimes(loading ? 0 : 1);
    },
  );
  it.each(["pl", "en"])(
    "edits all navigation fields, saves and updates the shared cache in %s",
    async (lang) => {
      h.lang = lang;
      const config = drawerConfig();
      config.nav_items = config.nav_items.slice(0, 2);
      drawer(config);
      fireEvent.change(screen.getAllByLabelText("mobileDrawer.admin.labelPl")[0], {
        target: { value: "Nowe menu" },
      });
      fireEvent.change(screen.getAllByLabelText("mobileDrawer.admin.labelEn")[0], {
        target: { value: "New menu" },
      });
      fireEvent.change(screen.getAllByLabelText("mobileDrawer.admin.url")[0], {
        target: { value: "/new" },
      });
      fireEvent.change(screen.getAllByLabelText("mobileDrawer.admin.icon")[0], {
        target: { value: "home" },
      });
      fireEvent.click(screen.getAllByLabelText("mobileDrawer.admin.enabled")[0]);
      for (const key of ["toolSearch", "toolTheme", "toolLanguage"])
        fireEvent.click(screen.getByLabelText(`mobileDrawer.admin.${key}`));
      fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.save" }));
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe("mobileDrawer.admin.saved"),
      );
      expect(qc.getQueryData(mobileDrawerConfigQueryOptions.queryKey)).toMatchObject({
        nav_items: [
          expect.objectContaining({
            label_pl: "Nowe menu",
            label_en: "New menu",
            href: "/new",
            icon: "home",
            enabled: false,
          }),
          config.nav_items[1],
        ],
      });
    },
  );
  it("adds and removes items, restores missing sections, and resets defaults", async () => {
    const config = drawerConfig();
    config.nav_items = [];
    config.section_order = ["nav"];
    drawer(config);
    expect(screen.getByText("mobileDrawer.admin.navEmpty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.add" }));
    expect(screen.getByLabelText("mobileDrawer.admin.labelPl")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.remove" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Narzędzia" }));
    fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.save" }));
    await waitFor(() => expect(h.upsert).toHaveBeenCalled());
    expect(h.upsert.mock.calls[0][0].data.section_order).toEqual(["nav", "top_tools"]);
    fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.resetDefaults" }));
    expect(screen.queryAllByLabelText("mobileDrawer.admin.labelPl")).toHaveLength(
      DEFAULT_DRAWER_CONFIG.nav_items.length,
    );
  });
  it.each(["none", "same", "old-missing", "new-missing", "move"])(
    "handles section and item drag outcome %s",
    async (kind) => {
      h.dragging = true;
      const config = drawerConfig();
      drawer(config);
      for (const [index, ids] of [
        [0, config.section_order],
        [1, config.nav_items.map((i) => i.id)],
      ] as const) {
        h.drag = {
          active: { id: kind === "old-missing" ? "missing" : ids[0] },
          over:
            kind === "none"
              ? null
              : { id: kind === "same" ? ids[0] : kind === "new-missing" ? "missing" : ids[1] },
        };
        fireEvent.click(screen.getAllByTestId("drag-boundary")[index]);
      }
      fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.save" }));
      await waitFor(() => expect(h.upsert).toHaveBeenCalled());
      const saved = h.upsert.mock.calls[0][0].data as DrawerConfig;
      expect(saved.section_order[0]).toBe(config.section_order[kind === "move" ? 1 : 0]);
      expect(saved.nav_items[0].id).toBe(config.nav_items[kind === "move" ? 1 : 0].id);
    },
  );
  it.each([new Error("backend failed"), "unknown failure"])(
    "reports save failures and releases the busy state: %s",
    async (error) => {
      h.upsert.mockRejectedValue(error);
      drawer();
      fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.save" }));
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe(
          error instanceof Error ? error.message : "mobileDrawer.admin.saveError",
        ),
      );
      expect(screen.getByRole("button", { name: "mobileDrawer.admin.save" })).toBeEnabled();
    },
  );
  it("shows validation failures before calling the server", async () => {
    drawer();
    fireEvent.change(screen.getAllByLabelText("mobileDrawer.admin.url")[0], {
      target: { value: "javascript:bad()" },
    });
    fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.save" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it("keeps save disabled until the server confirms it", async () => {
    let resolve!: (config: DrawerConfig) => void;
    h.upsert.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    drawer();
    fireEvent.click(screen.getByRole("button", { name: "mobileDrawer.admin.save" }));
    expect(screen.getByRole("button", { name: "mobileDrawer.admin.save" })).toBeDisabled();
    await act(async () => {
      resolve(structuredClone(DEFAULT_DRAWER_CONFIG));
    });
    expect(screen.getByRole("status").textContent).toBe("mobileDrawer.admin.saved");
  });
});

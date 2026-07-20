// Widget wyszukiwarki (nagłówek/builder): cztery premium kubełki podpowiedzi,
// nawigacja klawiaturą (combobox/aria-activedescendant), ostatnie
// wyszukiwania, stan pusty, stopka składni + link trybów zaawansowanych.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SearchButtonWidget } from "../SearchButtonWidget";

const rpc = vi.hoisted(() => ({
  rows: [] as Array<Record<string, string | number | null>>,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), preloadRoute: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.calls.push({ name, args });
      return { data: name === "search_autosuggest" ? rpc.rows : [], error: null };
    },
  },
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => ({
      navigate: nav.navigate,
      preloadRoute: () => Promise.resolve(),
    }),
  };
});

const row = (p: Partial<Record<string, string | number | null>>) => ({
  kind: "post",
  id: "id-1",
  slug: "slug-1",
  label_pl: "Etykieta",
  label_en: "Label",
  parent_page_id: null,
  score: 1,
  ...p,
});

const renderWidget = (over: Partial<Parameters<typeof SearchButtonWidget>[0]> = {}) =>
  render(
    <SearchButtonWidget
      label="Szukaj"
      mode="dropdown"
      heading=""
      liveResults
      limit={8}
      lang="pl"
      height={40}
      radius={8}
      fontSize={14}
      {...over}
    />,
  );

describe("SearchButtonWidget", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    rpc.rows = [];
    rpc.calls = [];
    nav.navigate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("grupuje podpowiedzi w cztery premium kubełki (organizacja w Osobach i organizacjach)", async () => {
    rpc.rows = [
      row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" }),
      row({ kind: "pub_type", id: "t1", slug: "raport", label_pl: "Raport" }),
      row({ kind: "topic", id: "top1", slug: "energia", label_pl: "Energia" }),
      row({ kind: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" }),
      row({ kind: "organization", id: "o1", slug: "nato", label_pl: "NATO" }),
    ];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "en" } });

    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    // Etykiety kubełków występują podwójnie (zakładka megaboxa + nagłówek
    // sekcji) - liczy się obecność, nie pojedynczość.
    expect(screen.getAllByText("Tytuły").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rodzaje treści").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tematyka").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Osoby i organizacje").length).toBeGreaterThan(0);

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/post/wpis");
    expect(hrefs).toContain("/search?type=t1");
    expect(hrefs).toContain("/search?org=o1");
    expect(hrefs).toContain("/search?author=a1");

    // Hover podświetla opcję (aria-selected), klik wyniku zapisuje frazę
    // w ostatnich wyszukiwaniach i zamyka popover.
    const option = screen.getByText("Tytuł wpisu").closest("a")!;
    fireEvent.mouseEnter(option);
    await waitFor(() => {
      expect(option.getAttribute("aria-selected")).toBe("true");
    });
    fireEvent.click(option);
    expect(localStorage.getItem("recent-searches:v1")).toContain("en");
  });

  it("linki stopki (wszystkie wyniki + zaawansowane) zapisują frazę i zamykają popover", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "energia" } });
    await screen.findByText("Tytuł wpisu");

    const seeAll = screen.getByText(/Zobacz wszystkie wyniki dla/).closest("a")!;
    expect(seeAll.getAttribute("href")).toBe("/search?q=energia");
    fireEvent.click(seeAll);
    expect(localStorage.getItem("recent-searches:v1")).toContain("energia");

    fireEvent.focus(input);
    await screen.findByText("Tytuł wpisu");
    fireEvent.click(screen.getByText("Wyszukiwanie zaawansowane").closest("a")!);
    await waitFor(() => {
      expect(screen.queryByText("Tytuł wpisu")).toBeNull();
    });
  });

  it("nawigacja klawiaturą: strzałki wybierają opcję, Enter nawiguje do jej celu", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ty" } });
    await screen.findByText("Tytuł wpisu");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => {
      expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.navigate).toHaveBeenCalledWith({ href: "/post/wpis" });
    // Fraza wylądowała w ostatnich wyszukiwaniach.
    expect(localStorage.getItem("recent-searches:v1")).toContain("ty");
  });

  it("Enter bez wybranej opcji prowadzi do pełnych wyników /search", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "energia" } });
    await screen.findByText("Tytuł wpisu");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // pozostaje -1
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.navigate).toHaveBeenCalledWith({ href: "/search?q=energia" });
  });

  it("stan pusty pokazuje frazę, a stopka linkuje tryby zaawansowane (adv=1)", async () => {
    rpc.rows = [];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyzq" } });
    expect(await screen.findByText(/Brak wyników dla/)).toBeTruthy();
    const adv = screen.getByText("Wyszukiwanie zaawansowane").closest("a")!;
    expect(adv.getAttribute("href")).toBe("/search?q=xyzq&adv=1");
    expect(screen.getByText('"fraza"')).toBeTruthy();
    expect(screen.getByText("-słowo")).toBeTruthy();
  });

  it("ostatnie wyszukiwania: klik przenosi frazę do pola", async () => {
    localStorage.setItem("recent-searches:v1", JSON.stringify(["geopolityka"]));
    const { container } = renderWidget();
    const input = container.querySelector("input")! as HTMLInputElement;
    fireEvent.focus(input);
    const recent = await screen.findByText("geopolityka");
    fireEvent.mouseDown(recent);
    expect(input.value).toBe("geopolityka");
  });

  it("przycisk czyszczenia usuwa frazę i wyniki", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")! as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ty" } });
    await screen.findByText("Tytuł wpisu");
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(input.value).toBe("");
    expect(screen.queryByText("Tytuł wpisu")).toBeNull();
  });

  it("Escape zamyka popover", async () => {
    localStorage.setItem("recent-searches:v1", JSON.stringify(["nato"]));
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    await screen.findByText("nato");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("nato")).toBeNull();
    });
  });

  it("tryb bez wyników na żywo: wyszukiwanie dopiero po Enterze", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget({ liveResults: false });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ty" } });
    // Debounce nie striggeruje zapytania w trybie off.
    await new Promise((r) => setTimeout(r, 250));
    expect(rpc.calls).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    expect(rpc.calls[0]?.name).toBe("search_autosuggest");
  });

  it("limit wyników jest ograniczany do zakresu RPC (4-24)", async () => {
    rpc.rows = [];
    const { container } = renderWidget({ limit: 20 });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    await waitFor(() => {
      expect(rpc.calls.length).toBeGreaterThan(0);
    });
    expect(rpc.calls[0]?.args._limit).toBe(24);
  });
});

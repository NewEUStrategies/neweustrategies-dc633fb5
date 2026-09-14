// Tabela rejestru fraz. Przedmiotem dowodu są GAŁĘZIE, których w trasie nie da
// się wykonać bez podstawienia całego Google i całej bazy naraz: trzy werdykty
// CTR, artykuł nierozpoznany w CMS-ie, wpis kontra strona w adresie edycji,
// i lista brakujących słów.
//
// Arytmetyki NIE dublujemy - `queryRegistry.test.ts` ma pełną tablicę wejść dla
// `expectedCtr`, `ctrVerdict`, `missedClicks` i `missingQueryTerms`. Tutaj
// sprawdzamy WYŁĄCZNIE, czy komponent te wyniki pokazuje i czy prowadzi we
// właściwe miejsce.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  QueryRegistryTable,
  type QueryRegistryContent,
} from "@/components/admin/seo/QueryRegistryTable";
import { groupByPage, flattenQueries, type GscPageQueryRow } from "@/lib/seo/queryRegistry";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

afterEach(cleanup);

const row = (
  page: string,
  query: string,
  over: Partial<Omit<GscPageQueryRow, "keys">> = {},
): GscPageQueryRow => ({
  keys: [page, query],
  clicks: over.clicks ?? 0,
  impressions: over.impressions ?? 0,
  ctr: over.ctr ?? 0,
  position: over.position ?? 10,
});

const content = (over: Partial<QueryRegistryContent> = {}): QueryRegistryContent => ({
  kind: over.kind ?? "post",
  title: over.title ?? "Raport roczny",
  description: over.description ?? "Podsumowanie prac zespołu",
});

function renderTable(
  rows: GscPageQueryRow[],
  map: Map<string, QueryRegistryContent>,
  view: "pages" | "queries" = "pages",
) {
  const pages = groupByPage(rows);
  return render(
    <QueryRegistryTable
      view={view}
      pages={pages}
      queries={flattenQueries(pages)}
      contentBySlug={map}
      minImpressions={30}
    />,
  );
}

describe("QueryRegistryTable - ujęcie po artykule", () => {
  it('werdykt „poniżej normy" jest oznaczony i niesie wyjaśnienie', () => {
    renderTable(
      [
        row("https://x.pl/blog/raport", "raport", {
          impressions: 1000,
          clicks: 1,
          ctr: 0.001,
          position: 3,
        }),
      ],
      new Map([["raport", content()]]),
    );
    const card = screen.getByTestId("registry-page");
    expect(card.getAttribute("data-verdict")).toBe("below");
    expect(within(card).getByTestId("verdict").textContent).toContain(
      "adminSeoHub.queriesVerdictBelow",
    );
    expect(card.textContent).toContain("adminSeoHub.queriesVerdictBelowHint");
  });

  it('werdykt „w normie" nie straszy i nie pokazuje podpowiedzi o naprawie', () => {
    renderTable(
      [
        row("https://x.pl/blog/raport", "raport", {
          impressions: 1000,
          clicks: 300,
          ctr: 0.3,
          position: 3,
        }),
      ],
      new Map([["raport", content()]]),
    );
    const card = screen.getByTestId("registry-page");
    expect(card.getAttribute("data-verdict")).toBe("ok");
    expect(card.textContent).toContain("adminSeoHub.queriesVerdictOk");
    expect(card.textContent).not.toContain("adminSeoHub.queriesVerdictBelowHint");
  });

  it("przy zbyt małej próbce mówi wprost, że nie orzeka - zamiast oskarżać stronę", () => {
    renderTable(
      [
        row("https://x.pl/blog/raport", "raport", {
          impressions: 4,
          clicks: 0,
          ctr: 0,
          position: 2,
        }),
      ],
      new Map([["raport", content()]]),
    );
    const card = screen.getByTestId("registry-page");
    expect(card.getAttribute("data-verdict")).toBe("tooFew");
    expect(card.textContent).toContain("adminSeoHub.queriesVerdictTooFew");
    expect(card.textContent).toContain("adminSeoHub.queriesVerdictTooFewHint");
    // Odmowa orzekania NIE jest oskarżeniem: plakietka werdyktu się nie pojawia.
    expect(within(card).queryByTestId("verdict")).toBeNull();
  });

  it("liczba do odzyskania pojawia się tylko tam, gdzie jest co odzyskać", () => {
    renderTable(
      [
        row("https://x.pl/blog/slaby", "a", {
          impressions: 1000,
          clicks: 1,
          ctr: 0.001,
          position: 3,
        }),
        row("https://x.pl/blog/dobry", "b", {
          impressions: 1000,
          clicks: 300,
          ctr: 0.3,
          position: 3,
        }),
      ],
      new Map([
        ["slaby", content()],
        ["dobry", content()],
      ]),
    );
    const cards = screen.getAllByTestId("registry-page");
    const slaby = cards.find((c) => c.getAttribute("data-verdict") === "below")!;
    const dobry = cards.find((c) => c.getAttribute("data-verdict") === "ok")!;
    expect(within(slaby).getByTestId("recoverable")).toBeTruthy();
    expect(within(dobry).queryByTestId("recoverable")).toBeNull();
  });

  it("brakujące słowa frazy są wypisane, gdy nie ma ich w tytule ani w opisie", () => {
    renderTable(
      [row("https://x.pl/blog/raport", "raport o dronach", { impressions: 100 })],
      new Map([["raport", content({ title: "Raport roczny", description: "Podsumowanie" })]]),
    );
    const missing = screen.getByTestId("missing-terms");
    expect(missing.textContent).toContain("dronach");
    expect(missing.textContent).not.toContain("raport");
  });

  it("gdy tytuł pokrywa całą frazę, nie ma sekcji braków", () => {
    renderTable(
      [row("https://x.pl/blog/raport", "raport o dronach", { impressions: 100 })],
      new Map([["raport", content({ title: "Raport o dronach", description: "" })]]),
    );
    expect(screen.queryByTestId("missing-terms")).toBeNull();
  });

  it("artykuł nierozpoznany w CMS-ie pokazuje ścieżkę i etykietę zamiast martwego linku", () => {
    renderTable([row("https://x.pl/cos/obcego", "fraza", { impressions: 100 })], new Map());
    const card = screen.getByTestId("registry-page");
    expect(card.textContent).toContain("/cos/obcego");
    expect(card.textContent).toContain("adminSeoHub.queriesUnmatched");
    // Bez dopasowania nie ma dokąd prowadzić - przycisk edycji się nie pojawia.
    expect(card.textContent).not.toContain("adminSeoHub.queriesEditContent");
  });

  it("wpis prowadzi do /admin/posts, a strona do /admin/pages", () => {
    renderTable(
      [
        row("https://x.pl/blog/wpis", "a", { impressions: 100 }),
        row("https://x.pl/o-nas", "b", { impressions: 90 }),
      ],
      new Map([
        ["wpis", content({ kind: "post" })],
        ["o-nas", content({ kind: "page" })],
      ]),
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.includes("/admin/posts/wpis"))).toBe(true);
    expect(hrefs.some((h) => h?.includes("/admin/pages/o-nas"))).toBe(true);
  });

  it("pokazuje najwyżej pięć fraz na artykuł - karta ma prowadzić, nie zalewać", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row("https://x.pl/blog/raport", `fraza ${i}`, { impressions: 100 - i }),
    );
    renderTable(rows, new Map([["raport", content()]]));
    expect(screen.getAllByTestId("page-query")).toHaveLength(5);
  });

  it("pusty rejestr renderuje się bez wiersza i bez wywrotki", () => {
    renderTable([], new Map());
    expect(screen.queryByTestId("registry-page")).toBeNull();
  });
});

describe("QueryRegistryTable - ujęcie po frazie", () => {
  it("każda fraza dostaje własny wiersz ze ścieżką, metrykami i werdyktem", () => {
    renderTable(
      [
        row("https://x.pl/a", "pierwsza", { impressions: 500, clicks: 5, ctr: 0.01, position: 3 }),
        row("https://x.pl/b", "druga", { impressions: 50, clicks: 25, ctr: 0.5, position: 1 }),
      ],
      new Map(),
      "queries",
    );
    const rows = screen.getAllByTestId("query-row");
    expect(rows).toHaveLength(2);
    // Sortowanie po wyświetleniach: „pierwsza" ma ich dziesięć razy więcej.
    expect(rows[0].textContent).toContain("pierwsza");
    expect(rows[0].textContent).toContain("/a");
    expect(rows[0].textContent).toContain("1.00%");
    expect(rows[0].textContent).toContain("3.0");
    expect(rows[1].textContent).toContain("druga");
  });

  it("ta sama fraza na dwóch stronach to dwa wiersze, nie jeden", () => {
    renderTable(
      [
        row("https://x.pl/a", "wspólna", { impressions: 30 }),
        row("https://x.pl/b", "wspólna", { impressions: 20 }),
      ],
      new Map(),
      "queries",
    );
    expect(screen.getAllByTestId("query-row")).toHaveLength(2);
  });

  it("pusta lista fraz daje samą główkę tabeli", () => {
    renderTable([], new Map(), "queries");
    expect(screen.queryAllByTestId("query-row")).toHaveLength(0);
    expect(screen.getByText("adminSeoHub.queriesColQuery")).toBeTruthy();
  });
});

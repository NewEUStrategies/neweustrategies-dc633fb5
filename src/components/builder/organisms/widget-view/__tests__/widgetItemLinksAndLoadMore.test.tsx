// Linki pozycji w widgetach z repeaterem i paginacja „Pokaż więcej".
//
// Co udowadniamy i dlaczego:
//   * interactive-circle: pozycja z NIEBEZPIECZNYM adresem (javascript:) nie
//     staje się martwym <a href="#"> - zostaje przyciskiem, który wybiera
//     pozycję (aria-pressed). Wcześniej `safeUrl(it.href)` z domyślnym "#"
//     zamieniało ją w odnośnik bez celu (naprawione 2026-10-18).
//   * rated-list (ręczny): adres pozycji przechodzi przez safeUrl (wcześniej
//     surowy `asStr`), wpis `null` z importu jest pomijany zamiast wywracać
//     listę, a „Pokaż więcej" dokłada dokładnie `pageSize` pozycji i znika,
//     gdy lista się wyczerpie.
//   * author-profile-card: z linków społecznościowych odpadają niebezpieczne
//     adresy, e-mail daje `mailto:` tylko dla poprawnego adresu, a przełączniki
//     „pokaż social" / „link do profilu" faktycznie usuwają te elementy.
//
// Granice: klient Supabase -> pusty łańcuch (rated-list w trybie ręcznym nie
// pyta bazy, ale moduł zapytań go importuje), bramka ruchu koła -> brak punktu
// ciszy. Widoki, sanitizacja i AppLink są prawdziwe.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in", "order", "limit", "range"]) chain[m] = () => chain;
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({ data: [], error: null }).then(onF);
  return { supabase: chain };
});
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

import { InteractiveCircleWidget } from "../InteractiveCircleWidget";
import { RatedListView } from "../RatedListView";
import { AuthorProfileCardWidget } from "../AuthorProfileCardWidget";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function widget(type: WidgetNode["type"], content: Record<string, unknown>): WidgetNode {
  return { id: `${type}-t`, kind: "widget", type, content: content as WidgetContent };
}

afterEach(cleanup);

describe("interactive-circle: adres pozycji", () => {
  it("niebezpieczny adres zostawia przycisk wyboru zamiast martwego linku '#'", () => {
    const { container } = render(
      <InteractiveCircleWidget
        node={widget("interactive-circle", {
          trigger: "click",
          items: [
            { label_pl: "Energia", title_pl: "Sektor energii" },
            { label_pl: "Pułapka", title_pl: "Tytuł pułapki", href: "javascript:alert(1)" },
            { label_pl: "Raport", title_pl: "Raport roczny", href: "/raport" },
          ],
        })}
        lang="pl"
      />,
    );
    expect(container.querySelector('a[href="#"]')).toBeNull();
    const trap = screen.getByRole("button", { name: "Pułapka" });
    expect(trap.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(trap);
    expect(trap.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Tytuł pułapki")).toBeTruthy();
    // Bezpieczny adres nadal jest odnośnikiem.
    expect(screen.getByRole("link", { name: "Raport" }).getAttribute("href")).toBe("/raport");
  });
});

describe("rated-list (ręczny): wpisy, adresy i „Pokaż więcej”", () => {
  const items = [
    null,
    { title_pl: "Temat 1", href: "javascript:alert(1)" },
    { title_pl: "Temat 2", href: "/temat-2" },
    { title_pl: "Temat 3" },
    { title_pl: "Temat 4" },
    { title_pl: "Temat 5" },
  ];

  it("pomija wpis null i nie linkuje niebezpiecznego adresu", () => {
    wrap(<RatedListView c={{ source: "manual", items } as WidgetContent} lang="pl" />);
    expect(screen.getByText("Temat 1")).toBeTruthy();
    expect(screen.getByText("Temat 1").closest("a")).toBeNull();
    expect(screen.getByText("Temat 2").closest("a")?.getAttribute("href")).toBe("/temat-2");
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("„Pokaż więcej” dokłada pageSize pozycji i znika po wyczerpaniu listy", () => {
    wrap(
      <RatedListView
        c={{ source: "manual", scrollingMode: "loadmore", pageSize: 2, items } as WidgetContent}
        lang="en"
      />,
    );
    const visible = () =>
      ["Temat 1", "Temat 2", "Temat 3", "Temat 4", "Temat 5"].filter((t) => screen.queryByText(t));
    expect(visible()).toEqual(["Temat 1", "Temat 2"]);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(visible()).toEqual(["Temat 1", "Temat 2", "Temat 3", "Temat 4"]);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(visible()).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("author-profile-card: linki osoby", () => {
  it("odrzuca niebezpieczne social, linkuje poprawny e-mail i profil autora", () => {
    const { container } = render(
      <AuthorProfileCardWidget
        node={widget("author-profile-card", {
          name: "Ewa Nowak",
          authorSlug: "ewa",
          linkedin: "javascript:alert(1)",
          x: "https://x.com/ewa",
          email: "ewa@example.org",
        })}
        lang="pl"
      />,
    );
    // Karta ma układ desktop i mobile (przełączane CSS) - oba z tą samą treścią.
    for (const socials of screen.getAllByRole("list", { name: "Media społecznościowe" })) {
      expect(
        within(socials)
          .getAllByRole("link")
          .map((a) => a.getAttribute("href")),
      ).toEqual(["https://x.com/ewa", "mailto:ewa@example.org"]);
    }
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    for (const profile of screen.getAllByRole("link", { name: "Ewa Nowak" })) {
      expect(profile.getAttribute("href")).toBe("/author/ewa");
    }
  });

  it("niepoprawny e-mail nie daje linku; wyłączone social i profil znikają (EN)", () => {
    const { container } = render(
      <AuthorProfileCardWidget
        node={widget("author-profile-card", {
          authorSlug: "ewa",
          email: "to nie jest e-mail",
          showSocials: false,
          showProfileLink: false,
          x: "https://x.com/ewa",
        })}
        lang="en"
      />,
    );
    // Bez nazwiska widget pokazuje podpowiedź dla redaktora.
    expect(screen.getAllByText("Full name").length).toBeGreaterThan(0);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByRole("list", { name: "Social media" })).toBeNull();
  });

  it("niepoprawny e-mail przy włączonych social nie trafia do listy", () => {
    render(
      <AuthorProfileCardWidget
        node={widget("author-profile-card", {
          name: "Ewa",
          email: "ewa@",
          website: "https://ewa.example.org",
        })}
        lang="pl"
      />,
    );
    for (const list of screen.getAllByRole("list", { name: "Media społecznościowe" })) {
      const links = within(list).getAllByRole("link");
      expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://ewa.example.org"]);
    }
  });
});

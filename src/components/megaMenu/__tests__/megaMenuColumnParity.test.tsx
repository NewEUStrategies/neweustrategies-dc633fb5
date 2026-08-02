// Mega menu: naglowek kolumny jako link + parytet tresci mobile <-> desktop.
//
// Dwa bledy, ktore ten plik pilnuje:
//   1. Edytor od dawna pozwalal wskazac stronę dla naglowka kolumny (PagePicker),
//      ale zaden renderer nie czytal `href` - ustawienie bylo martwe.
//   2. Akordeon mobilny ignorowal `kind` (kolumna kategorii pokazywala sam
//      tytul), gubil karty featured i opisy linkow. Ustawienia desktopowe
//      znikaly bez sladu na telefonie i w podgladzie urzadzenia mobilnego.
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MegaMenu, type MegaMenuConfig } from "../MegaMenu";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to?: string;
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ state: { location: { pathname: "/" } } }),
}));

afterEach(cleanup);

/**
 * Na desktopie panel jest zwiniety do czasu interakcji, wiec kolumny nie
 * istnieja jeszcze w DOM. Testy desktopowe wymuszaja tryb "click" i otwieraja
 * menu - inaczej sprawdzalyby pusty kontener.
 */
function renderMenu(config: MegaMenuConfig, mobile: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <MegaMenu
        config={mobile ? config : { ...config, triggerOn: "click" }}
        lang="pl"
        mobile={mobile}
      />
    </QueryClientProvider>,
  );
  if (!mobile) {
    fireEvent.click(screen.getByText("Wiedza"));
  }
  return utils;
}

const LINKS_COLUMN = {
  kind: "links" as const,
  title_pl: "Analizy",
  href: "/analizy",
  links: [{ label_pl: "Raporty", href: "/raporty", desc_pl: "Cotygodniowy przeglad" }],
  featured: {
    image: "https://example.com/cover.jpg",
    title_pl: "Wyroznione",
    href: "/wyroznione",
  },
};

const CONFIG: MegaMenuConfig = {
  trigger_pl: "Wiedza",
  columns: [LINKS_COLUMN],
};

describe("naglowek kolumny prowadzi pod wskazany adres", () => {
  it("links the heading on desktop when href is set", () => {
    renderMenu(CONFIG, false);
    const heading = screen.getByRole("heading", { name: /Analizy/ });
    expect(within(heading).getByRole("link")).toHaveAttribute("href", "/analizy");
  });

  it("links the heading on mobile too", () => {
    renderMenu(CONFIG, true);
    const heading = screen.getByRole("heading", { name: /Analizy/ });
    expect(within(heading).getByRole("link")).toHaveAttribute("href", "/analizy");
  });

  it("renders a plain heading when no href is configured", () => {
    renderMenu({ ...CONFIG, columns: [{ ...LINKS_COLUMN, href: undefined }] }, false);
    const heading = screen.getByRole("heading", { name: /Analizy/ });
    expect(within(heading).queryByRole("link")).toBeNull();
  });

  it("does not linkify an empty href", () => {
    renderMenu({ ...CONFIG, columns: [{ ...LINKS_COLUMN, href: "   " }] }, true);
    const heading = screen.getByRole("heading", { name: /Analizy/ });
    expect(within(heading).queryByRole("link")).toBeNull();
  });
});

describe("mobile pokazuje ten sam ZESTAW tresci co desktop", () => {
  it("keeps link descriptions on mobile", () => {
    renderMenu(CONFIG, true);
    expect(screen.getByText("Cotygodniowy przeglad")).toBeTruthy();
  });

  it("keeps the featured card on mobile", () => {
    renderMenu(CONFIG, true);
    expect(screen.getByText("Wyroznione")).toBeTruthy();
  });

  it("routes a category column through the category renderer on mobile", () => {
    // Kolumna kategorii na mobile pokazywala wczesniej wylacznie tytul.
    // Renderer kategorii wystawia link "zobacz wszystkie" - jego obecnosc
    // dowodzi, ze `kind` nie jest juz ignorowany.
    renderMenu(
      {
        trigger_pl: "Wiedza",
        columns: [
          { kind: "category", title_pl: "Gospodarka", categorySlug: "gospodarka", postCount: 3 },
        ],
      },
      true,
    );
    const viewAll = screen
      .getAllByRole("link")
      .some((el) => el.getAttribute("href") === "/category/gospodarka");
    expect(viewAll).toBe(true);
  });
});

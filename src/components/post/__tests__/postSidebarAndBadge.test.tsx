// Dwie ostatnie powierzchnie wpisu bez ani jednej asercji.
//
// `SponsoredBadge` niesie OBOWIĄZEK PRAWNY: UPNPR art. 7 pkt 11a wymaga
// oznaczenia płatnych wyników już na LIŚCIE, bo tam czytelnik podejmuje decyzję
// „klikam / nie klikam". Test musi więc pilnować nie tylko tego, że etykieta
// jest, ale KTÓRA jest - sponsoring wyprzedza afiliację.
//
// `PostSidebarRenderer` jest kompozytorem: bierze układ z bazy i renderuje
// widgety. Testujemy REGUŁĘ KOMPOZYCJI (co jest pomijane, co degraduje do
// układu awaryjnego), nie wnętrza widgetów - te mają własne testy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  byId: null as unknown,
  byIdError: false,
  fallbackDefault: null as unknown,
}));

// Fabryka importuje `@/test/i18nStub` - moduł BEZ importów z produkcji.
// Sięgnięcie tu po fixture'y obszaru domyka cykl inicjalizacji (fixture'y ->
// warstwa ustawień -> lib/i18n -> react-i18next -> ta fabryka) i ZAWIESZA plik.
vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

vi.mock("@/lib/queries/sidebarLayouts", () => ({
  sidebarLayoutByIdQueryOptions: (id?: string | null) => ({
    queryKey: ["sidebar-layout", id ?? null],
    queryFn: async () => {
      if (h.byIdError) throw new Error("layout read failed");
      return h.byId;
    },
    retry: false,
  }),
  defaultSidebarLayoutQueryOptions: () => ({
    queryKey: ["sidebar-layout", "default"],
    queryFn: async () => h.fallbackDefault,
    retry: false,
  }),
  buildFallbackLayout: () => ({
    id: "fallback",
    widgets: [{ id: "w-fallback", type: "reading-panel", settings: {}, hidden: false }],
  }),
}));

// Widgety mają własne testy - tutaj liczy się WYŁĄCZNIE to, które z nich
// kompozytor wstawił i w jakiej kolejności.
vi.mock("@/components/share/FloatingShareBar", () => ({
  FloatingShareBar: ({ entityId }: { entityId: string }) => (
    <div data-testid={`reading-panel-${entityId}`} />
  ),
}));

import { SponsoredBadge } from "@/components/post/SponsoredBadge";
import { PostSidebarRenderer } from "@/components/post/PostSidebarRenderer";

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  h.byId = null;
  h.byIdError = false;
  h.fallbackDefault = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SponsoredBadge - oznaczenie komercyjne na liście", () => {
  it("materiał BEZ relacji komercyjnej nie dostaje etykiety", () => {
    const { container } = render(<SponsoredBadge post={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(container.querySelector("[data-sponsored-badge]")).toBeNull();
  });

  it("`is_sponsored` BEZ rodzaju relacji też nie daje etykiety (deklaracja niekompletna)", () => {
    const { container } = render(<SponsoredBadge post={{ is_sponsored: true }} />);
    expect(container).toBeEmptyDOMElement();
    expect(container.querySelector("[data-sponsored-badge]")).toBeNull();
  });

  it("reklama dostaje etykietę z rodzajem relacji w atrybucie danych", () => {
    const { container } = render(
      <SponsoredBadge post={{ is_sponsored: true, sponsored_kind: "advertisement" }} />,
    );
    expect(container.querySelector("[data-sponsored-badge]")).toHaveAttribute(
      "data-sponsored-badge",
      "advertisement",
    );
    expect(container.textContent).toContain("sponsored.badge.advertisement");
  });

  it("KAŻDY rodzaj relacji ma WŁASNY klucz etykiety (nie jedno wspólne słowo)", () => {
    const kinds = ["advertisement", "sponsored", "partner", "barter", "self_promo"] as const;
    const keys = kinds.map((kind) => {
      const { container, unmount } = render(
        <SponsoredBadge post={{ is_sponsored: true, sponsored_kind: kind }} />,
      );
      const text = container.textContent ?? "";
      unmount();
      return text;
    });
    expect(new Set(keys).size).toBe(kinds.length);
    expect(keys.every((k) => k.startsWith("sponsored.badge."))).toBe(true);
  });

  it("sama AFILIACJA dostaje etykietę afiliacyjną, oznaczoną jako `affiliate`", () => {
    const { container } = render(<SponsoredBadge post={{ sponsored_affiliate: true }} />);
    expect(container.querySelector("[data-sponsored-badge]")).toHaveAttribute(
      "data-sponsored-badge",
      "affiliate",
    );
    expect(container.textContent).toContain("sponsored.affiliate.label");
  });

  it("SPONSORING WYPRZEDZA AFILIACJĘ, gdy oba są włączone", () => {
    const { container } = render(
      <SponsoredBadge
        post={{ is_sponsored: true, sponsored_kind: "sponsored", sponsored_affiliate: true }}
      />,
    );
    expect(container.querySelector("[data-sponsored-badge]")).toHaveAttribute(
      "data-sponsored-badge",
      "sponsored",
    );
    expect(container.textContent).not.toContain("sponsored.affiliate.label");
  });

  it("nieznany rodzaj relacji NIE daje etykiety rodzajowej (odsiew śmieci z bazy)", () => {
    const { container } = render(
      <SponsoredBadge post={{ is_sponsored: true, sponsored_kind: "wymyslony" }} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(container.querySelector("[data-sponsored-badge]")).toBeNull();
  });

  it("JĘZYK MATERIAŁU przypina brzmienie oznaczenia (nie język interfejsu)", () => {
    const { container } = render(
      <SponsoredBadge post={{ is_sponsored: true, sponsored_kind: "partner" }} lang="en" />,
    );
    // Atrapa i18n echuje klucz z parametrami, więc widać JAWNE wymuszenie języka.
    expect(container.textContent).toContain("lng=en");
    expect(container.textContent).toContain("sponsored.badge.partner");
  });

  it("etykieta zachowuje wspólną klasę oznaczenia i przyjmuje własną", () => {
    const { container } = render(
      <SponsoredBadge post={{ sponsored_affiliate: true }} className="ml-2" />,
    );
    const badge = container.querySelector("[data-sponsored-badge]");
    expect(badge?.className).toContain("sponsor-label");
    expect(badge?.className).toContain("ml-2");
  });
});

describe("PostSidebarRenderer - kompozycja sidebara wpisu", () => {
  const props = { postId: "p1", postTitle: "Analiza", lang: "pl" as const };

  it("BRAK układu w bazie degraduje do układu AWARYJNEGO (sidebar nigdy nie jest pusty)", async () => {
    h.byId = null;
    h.fallbackDefault = null;
    renderWithQuery(<PostSidebarRenderer {...props} />);
    await waitFor(() => expect(screen.getByTestId("reading-panel-p1")).toBeInTheDocument());
    expect(screen.getAllByTestId(/reading-panel/)).toHaveLength(1);
  });

  it("układ per wpis WYGRYWA nad domyślnym", async () => {
    h.byId = {
      id: "override",
      widgets: [{ id: "w1", type: "reading-panel", settings: {}, hidden: false }],
    };
    h.fallbackDefault = { id: "default", widgets: [] };
    renderWithQuery(<PostSidebarRenderer {...props} layoutId="override" />);
    await waitFor(() => expect(screen.getByTestId("reading-panel-p1")).toBeInTheDocument());
    expect(screen.getAllByTestId(/reading-panel/)).toHaveLength(1);
  });

  it("WIDGETY UKRYTE są pomijane, widoczne renderowane", async () => {
    h.byId = {
      id: "override",
      widgets: [
        { id: "w1", type: "reading-panel", settings: {}, hidden: true },
        { id: "w2", type: "reading-panel", settings: {}, hidden: false },
      ],
    };
    renderWithQuery(<PostSidebarRenderer {...props} layoutId="override" />);
    await waitFor(() => expect(screen.getAllByTestId(/reading-panel/)).toHaveLength(1));
    expect(screen.getByTestId("reading-panel-p1")).toBeInTheDocument();
  });

  it("układ z PUSTĄ listą widgetów renderuje pusty kontener, nie wyjątek", async () => {
    h.byId = { id: "override", widgets: [] };
    const { container } = renderWithQuery(<PostSidebarRenderer {...props} layoutId="override" />);
    // Pierwszy render idzie na układzie AWARYJNYM (dane jeszcze nie przyszły),
    // więc czekamy aż pusty układ z bazy go wyprze - inaczej test sprawdzałby
    // stan przejściowy, nie regułę.
    await waitFor(() => expect(screen.queryByTestId("reading-panel-p1")).toBeNull());
    expect(container.firstElementChild).not.toBeNull();
  });

  it("NIEZNANY typ widgetu jest pomijany, znane obok renderują się dalej", async () => {
    h.byId = {
      id: "override",
      widgets: [
        { id: "w1", type: "widget-z-przyszlosci", settings: {}, hidden: false },
        { id: "w2", type: "reading-panel", settings: {}, hidden: false },
      ],
    };
    renderWithQuery(<PostSidebarRenderer {...props} layoutId="override" />);
    await waitFor(() => expect(screen.getByTestId("reading-panel-p1")).toBeInTheDocument());
    expect(screen.getAllByTestId(/reading-panel/)).toHaveLength(1);
  });

  it("BŁĄD odczytu układu per wpis degraduje do domyślnego, nie gasi sidebara", async () => {
    h.byIdError = true;
    h.fallbackDefault = {
      id: "default",
      widgets: [{ id: "w-default", type: "reading-panel", settings: {}, hidden: false }],
    };
    renderWithQuery(<PostSidebarRenderer {...props} layoutId="zepsuty" />);
    await waitFor(() => expect(screen.getByTestId("reading-panel-p1")).toBeInTheDocument());
    expect(screen.getAllByTestId(/reading-panel/)).toHaveLength(1);
  });

  it("kontener sidebara jest kolumną (kolejność widgetów = kolejność układu)", async () => {
    h.byId = {
      id: "override",
      widgets: [
        { id: "w1", type: "reading-panel", settings: {}, hidden: false },
        { id: "w2", type: "reading-panel", settings: {}, hidden: false },
      ],
    };
    const { container } = renderWithQuery(<PostSidebarRenderer {...props} layoutId="override" />);
    await waitFor(() => expect(screen.getAllByTestId(/reading-panel/)).toHaveLength(2));
    expect(container.firstElementChild?.className).toContain("flex-col");
  });
});

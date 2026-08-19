import { useState } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GroupTabs,
  TopicsDroplist,
  canToggleInterestSelection,
  useInterestGroups,
  type InterestGroup,
} from "@/components/interests/TopicsDroplist";
import type { InterestCatalog, InterestItem } from "@/hooks/useInterests";

const interestsFixture = vi.hoisted(() => ({
  catalog: { categories: [], tags: [] } as InterestCatalog,
}));

vi.mock("@/hooks/useInterests", () => ({
  useInterestCatalog: () => ({ data: interestsFixture.catalog, isLoading: false }),
}));

const root: InterestItem = {
  id: "root",
  type: "category",
  slug: "region",
  label: "Region",
  parentId: null,
};
const europe: InterestItem = {
  id: "europe",
  type: "category",
  slug: "europe",
  label: "Europa",
  parentId: "root",
  parentSlug: "region",
  parentLabel: "Region",
};
const diplomacy: InterestItem = {
  id: "diplomacy",
  type: "category",
  slug: "diplomacy",
  label: "Dyplomacja",
  parentId: null,
};
const risk: InterestItem = {
  id: "risk",
  type: "tag",
  slug: "risk",
  label: "Ryzyko",
  parentId: null,
};

const groups: InterestGroup[] = [
  { key: "areas", title: "Obszary", items: [europe, diplomacy], parentSlug: null },
  { key: "tags", title: "Tematy", items: [risk], parentSlug: null },
];
const allItems = [europe, diplomacy, risk];

class ObserverStub implements IntersectionObserver {
  static callbacks: IntersectionObserverCallback[] = [];
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  constructor(callback: IntersectionObserverCallback) {
    ObserverStub.callbacks.push(callback);
  }
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = () => [];
  unobserve = vi.fn();
}

function SelectionHarness({
  display = "droplist",
  initial = [],
  maxSelections,
}: {
  display?: "chips" | "droplist";
  initial?: string[];
  maxSelections?: number;
}) {
  const [picked, setPicked] = useState(new Set(initial));
  return (
    <TopicsDroplist
      lang="pl"
      allItems={allItems}
      groups={groups}
      picked={picked}
      maxSelections={maxSelections}
      onToggle={(id) =>
        setPicked((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      onClear={() => setPicked(new Set())}
      display={display}
    />
  );
}

describe("reguły wyboru zainteresowań", () => {
  it("pozwala usuwać zaznaczenie także po osiągnięciu limitu", () => {
    const picked = new Set(["europe", "risk"]);

    expect(canToggleInterestSelection(picked, "europe", 2)).toBe(true);
    expect(canToggleInterestSelection(picked, "diplomacy", 2)).toBe(false);
  });

  it("obsługuje brak limitu, limit zerowy i wartość ułamkową", () => {
    const picked = new Set(["europe"]);

    expect(canToggleInterestSelection(picked, "risk")).toBe(true);
    expect(canToggleInterestSelection(new Set(), "risk", 0)).toBe(false);
    expect(canToggleInterestSelection(picked, "risk", 1.9)).toBe(false);
  });
});

describe("useInterestGroups", () => {
  beforeEach(() => {
    interestsFixture.catalog = { categories: [root, europe, diplomacy], tags: [risk] };
  });

  it("grupuje kategorie potomne pod korzeniem i tagi osobno", () => {
    const { result } = renderHook(() => useInterestGroups("pl"));

    expect(result.current.allItems).toHaveLength(4);
    expect(result.current.groups.map((group) => group.title)).toEqual([
      "Obszary",
      "Region",
      "Tematy",
    ]);
    expect(result.current.groups[1]?.items).toEqual([europe]);
  });

  it("filtruje katalog po slugach bez względu na wielkość liter i spacje", () => {
    const { result } = renderHook(() => useInterestGroups("pl", [" EUROPE ", "RISK", ""]));

    expect(result.current.allItems.map((item) => item.id)).toEqual(["europe", "risk"]);
    expect(result.current.groups).toHaveLength(2);
    expect(result.current.groups[0]?.parentSlug).toBe("region");
  });

  it("zwraca puste grupy przy pustym katalogu", () => {
    interestsFixture.catalog = { categories: [], tags: [] };
    const { result } = renderHook(() => useInterestGroups("en", ["missing"]));

    expect(result.current.allItems).toEqual([]);
    expect(result.current.groups).toEqual([]);
  });
});

describe("TopicsDroplist", () => {
  beforeEach(() => {
    ObserverStub.callbacks = [];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollBy = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("nie renderuje sterowania dla pustego katalogu", () => {
    const { container } = render(
      <TopicsDroplist
        lang="pl"
        allItems={[]}
        groups={[]}
        picked={new Set()}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("przełącza wiele tematów w dropliście i blokuje trzeci po limicie", () => {
    render(<SelectionHarness maxSelections={2} />);
    const trigger = screen.getByRole("button", { name: "Wybierz tematy…" });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("option", { name: "Europa" }));
    fireEvent.click(screen.getByRole("option", { name: "Ryzyko" }));

    expect(screen.getByRole("option", { name: "Europa" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Ryzyko" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Dyplomacja" })).toBeDisabled();
    expect(screen.getAllByText("Wybrano: 2")).toHaveLength(2);
  });

  it("czyści wybór i zamyka droplistę przyciskiem Gotowe", () => {
    render(<SelectionHarness initial={["europe", "risk"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Wybrano: 2" }));

    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(screen.getByText("Brak wyboru")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wyczyść" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Gotowe" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wybierz tematy…" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("zamyka droplistę klawiszem Escape i kliknięciem poza nią", () => {
    render(<SelectionHarness />);
    const trigger = screen.getByRole("button", { name: "Wybierz tematy…" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("w trybie chips pozwala zwolnić limit i wybrać inną pozycję", () => {
    render(<SelectionHarness display="chips" initial={["europe", "risk"]} maxSelections={2} />);
    const europeButton = screen.getByRole("button", { name: "Europa" });
    const diplomacyButton = screen.getByRole("button", { name: "Dyplomacja" });

    expect(europeButton).toHaveAttribute("aria-pressed", "true");
    expect(diplomacyButton).toBeDisabled();

    fireEvent.click(europeButton);
    expect(diplomacyButton).not.toBeDisabled();
    fireEvent.click(diplomacyButton);
    expect(diplomacyButton).toHaveAttribute("aria-pressed", "true");
  });

  it("usuwa wybraną pigułkę bez otwierania listy", () => {
    render(<SelectionHarness initial={["europe"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Usuń Europa" }));

    expect(screen.queryByRole("button", { name: "Usuń Europa" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wybierz tematy…" })).toBeInTheDocument();
  });
});

describe("GroupTabs", () => {
  beforeEach(() => {
    ObserverStub.callbacks = [];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollBy = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderTabs() {
    return render(
      <div>
        <div id="topic-scroll">
          <section id="tour-drop-grp-areas" />
          <section id="tour-drop-grp-tags" />
        </div>
        <GroupTabs
          groups={groups}
          jusId="tour"
          scrollContainerId="topic-scroll"
          ariaLabel="Przejdź do grupy"
          pickedByGroup={{ areas: 1, tags: 0 }}
        />
      </div>,
    );
  }

  it("przełącza aktywną grupę i pokazuje licznik zaznaczeń", () => {
    renderTabs();
    const areasTab = screen.getByRole("tab", { name: /Obszary/ });
    const tagsTab = screen.getByRole("tab", { name: /Tematy/ });

    expect(areasTab).toHaveAttribute("aria-selected", "true");
    expect(areasTab).toHaveTextContent("1/2");
    fireEvent.click(tagsTab);
    expect(tagsTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("tour-drop-grp-tags")?.scrollIntoView).toHaveBeenCalled();
  });

  it("reaguje na widoczną sekcję raportowaną przez obserwator", () => {
    renderTabs();
    const callback = ObserverStub.callbacks[0];
    const target = document.getElementById("tour-drop-grp-tags")!;

    act(() => {
      callback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.8,
            target,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByRole("tab", { name: /Tematy/ })).toHaveAttribute("aria-selected", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("przewija pasek strzałką i gestem przeciągania", () => {
    renderTabs();
    const tablist = screen.getByRole("tablist", { name: "Przejdź do grupy" });
    Object.defineProperties(tablist, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 400 },
      scrollLeft: { configurable: true, writable: true, value: 10 },
    });
    fireEvent.scroll(tablist);

    fireEvent.click(screen.getByRole("button", { name: "scroll right" }));
    expect(tablist.scrollBy).toHaveBeenCalledWith({ left: 160, behavior: "smooth" });

    fireEvent.pointerDown(tablist, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(tablist, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(tablist, { pointerId: 1 });
    expect(tablist.scrollLeft).toBe(60);
  });
});

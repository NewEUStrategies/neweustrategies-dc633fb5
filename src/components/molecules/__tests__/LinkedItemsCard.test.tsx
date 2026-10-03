// KARTA „POWIĄZANE ELEMENTY” - jedna karta grafu `cross_references` dla
// wszystkich modułów panelu (lead CRM, edytory).
//
// CO DOWODZI TEN PLIK. Karta stała na zerze, a niesie trzy decyzje widoczne
// dla redakcji: (1) wiersz prowadzi gdzieś TYLKO wtedy, gdy encja ma adres
// w panelu - pozostałe są zwykłym tekstem, a nie martwym odnośnikiem;
// (2) typ i relacja spoza słownika nie wywracają wiersza (typ spada na
// „Element", nieznana relacja po prostu się nie pokazuje); (3) błąd odczytu,
// ładowanie i brak powiązań to trzy RÓŻNE komunikaty.
//
// GRANICA DOWODU. Hooki danych są atrapami (`useLinkedItems` to cienka
// obudowa RPC `get_linked_items`); `linkedItemHref` jest PRAWDZIWY, bo to on
// decyduje o odnośniku. Słownik `i18n-cohesion` jest prawdziwy (PL i EN).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { LinkedItem } from "@/lib/links/useLinkedItems";

const h = vi.hoisted(() => ({
  language: "pl",
  fixedT: null as null | typeof realT,
  query: { data: undefined as LinkedItem[] | undefined, isError: false, isLoading: false },
  calls: [] as Array<[string, string | null | undefined]>,
  realtime: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.fixedT?.(h.language.startsWith("en") ? "en" : "pl"),
    i18n: { language: h.language },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/components/atoms/AppLink", () => ({
  AppLink: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: unknown;
  }) => (
    <a href={href} className={className}>
      {children as never}
    </a>
  ),
}));

vi.mock("@/lib/links/useLinkedItems", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/links/useLinkedItems")>()),
  useLinkedItems: (itemType: string, itemId: string | null | undefined) => {
    h.calls.push([itemType, itemId]);
    return h.query;
  },
  useLinkedItemsRealtime: h.realtime,
}));

import { realT } from "@/test/i18nReal";
import { LinkedItemsCard } from "../LinkedItemsCard";

h.fixedT = realT;

function item(over: Partial<LinkedItem>): LinkedItem {
  return {
    referenceId: "ref-1",
    direction: "outgoing",
    itemType: "post",
    itemId: "00000000-aaaa-bbbb-cccc-000000000001",
    relation: "related",
    label: "Wpis o Europie",
    createdAt: "2026-03-01T10:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  h.language = "pl";
  h.query = { data: undefined, isError: false, isLoading: false };
  h.calls.length = 0;
  h.realtime.mockReset();
});

afterEach(cleanup);

describe("LinkedItemsCard - wiersze", () => {
  it("lead CRM prowadzi do swojej karty, wpis bez adresu panelu jest tekstem", () => {
    h.query.data = [
      item({
        referenceId: "a",
        itemType: "crm_lead",
        itemId: "lead-42",
        label: "Anna",
        relation: "mention",
      }),
      item({ referenceId: "b" }),
    ];
    render(<LinkedItemsCard itemType="crm_lead" itemId="lead-1" />);

    const region = screen.getByRole("region", { name: "Powiązane elementy" });
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    const link = within(rows[0] as HTMLElement).getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/crm?lead=lead-42");
    expect(link.textContent).toBe("Lead CRM: Annawzmianka");

    expect(within(rows[1] as HTMLElement).queryByRole("link")).toBeNull();
    expect(rows[1]?.textContent).toBe("Artykuł: Wpis o Europiepowiązane");
    // Licznik w nagłówku.
    expect(within(region).getByRole("heading").textContent).toContain("2");
  });

  it("subskrybent newslettera prowadzi do listy subskrybentów", () => {
    h.query.data = [item({ itemType: "newsletter_subscriber", relation: "belongs_to" })];
    render(<LinkedItemsCard itemType="crm_lead" itemId="lead-1" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/admin/newsletter/subscribers");
    expect(screen.getByText("należy do")).toBeTruthy();
  });

  it("typ spoza słownika to „Element”, nieznana relacja nie ma odznaki, brak etykiety to skrót id", () => {
    h.query.data = [
      item({
        itemType: "invoice",
        relation: "custom_edge",
        label: null,
        itemId: "abcdef1234567890",
      }),
    ];
    render(<LinkedItemsCard itemType="crm_lead" itemId="lead-1" />);
    const row = screen.getByRole("listitem");
    expect(row.textContent).toBe("Element: abcdef12");
  });

  it("limit tnie listę, a licznik pokazuje liczbę widocznych pozycji", () => {
    h.query.data = Array.from({ length: 5 }, (_, i) => item({ referenceId: `r${i}` }));
    render(<LinkedItemsCard itemType="post" itemId="p1" limit={3} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading").textContent).toBe("Powiązane elementy3");
  });

  it("po angielsku etykiety typów i relacji idą ze słownika EN", () => {
    h.language = "en";
    h.query.data = [item({ itemType: "crm_note", relation: "mention", label: "Call" })];
    render(<LinkedItemsCard itemType="crm_lead" itemId="lead-1" />);
    expect(screen.getByRole("region", { name: "Linked items" })).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toBe("CRM note: Callmention");
  });
});

describe("LinkedItemsCard - stany odczytu", () => {
  it("pyta o graf DLA podanej encji i podpina kanał na żywo", () => {
    render(<LinkedItemsCard itemType="post" itemId="p1" />);
    expect(h.calls.at(-1)).toEqual(["post", "p1"]);
    expect(h.realtime).toHaveBeenCalled();
  });

  it("w trakcie ładowania nie twierdzi, że powiązań nie ma", () => {
    h.query = { data: undefined, isError: false, isLoading: true };
    render(<LinkedItemsCard itemType="post" itemId="p1" />);
    expect(screen.queryByText("Brak powiązań z innymi modułami")).toBeNull();
    expect(screen.getByText("...")).toBeTruthy();
  });

  it("brak powiązań ma własny komunikat, bez licznika w nagłówku", () => {
    h.query = { data: [], isError: false, isLoading: false };
    render(<LinkedItemsCard itemType="post" itemId="p1" />);
    expect(screen.getByText("Brak powiązań z innymi modułami")).toBeTruthy();
    expect(screen.getByRole("heading").textContent).toBe("Powiązane elementy");
  });

  it("błąd odczytu to błąd, nie pusta lista", () => {
    h.query = { data: undefined, isError: true, isLoading: false };
    render(<LinkedItemsCard itemType="post" itemId="p1" />);
    expect(screen.getByText("Nie udało się wczytać powiązań")).toBeTruthy();
    expect(screen.queryByText("Brak powiązań z innymi modułami")).toBeNull();
  });
});

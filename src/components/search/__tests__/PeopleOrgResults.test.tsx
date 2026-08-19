import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { PeopleOrgItem } from "@/lib/queries/archives";
import { PeopleOrgResults, PeopleOrgStrip } from "../PeopleOrgResults";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const item = (p: Partial<PeopleOrgItem>): PeopleOrgItem => ({
  kind: "person",
  id: "p1",
  slug: "jan-kowalski",
  label_pl: "Jan Kowalski",
  label_en: "Jan Kowalski",
  sublabel_pl: "Analityk",
  sublabel_en: "Analyst",
  avatarUrl: null,
  logoUrl: null,
  verified: false,
  postCount: 3,
  ...p,
});

describe("PeopleOrgResults", () => {
  beforeEach(() => {
    cleanup();
  });

  it("dzieli wyniki na sekcje Osoby i Organizacje", () => {
    renderWithQueryClient(
      <PeopleOrgResults
        items={[
          item({}),
          item({
            kind: "organization",
            id: "o1",
            slug: "nato",
            label_pl: "NATO",
            label_en: "NATO",
          }),
        ]}
        lang="pl"
      />,
    );
    expect(screen.getByText("search.people.people_heading")).toBeTruthy();
    expect(screen.getByText("search.people.orgs_heading")).toBeTruthy();
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
    expect(screen.getByText("NATO")).toBeTruthy();
  });

  it("osoba linkuje do huba autora, organizacja filtruje /search po termie", () => {
    const { container } = renderWithQueryClient(
      <PeopleOrgResults
        items={[item({}), item({ kind: "organization", id: "o1", label_pl: "NATO" })]}
        lang="pl"
      />,
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/author/jan-kowalski");
    expect(hrefs).toContain("/search?org=o1");
  });

  it("znacznik weryfikacji ma etykietę dostępności", () => {
    renderWithQueryClient(<PeopleOrgResults items={[item({ verified: true })]} lang="pl" />);
    expect(screen.getByLabelText("search.people.verified")).toBeTruthy();
  });

  it("wyświetla logo organizacji, gdy jest dostępne", () => {
    const { container } = renderWithQueryClient(
      <PeopleOrgResults
        items={[
          item({
            kind: "organization",
            id: "o1",
            label_pl: "NATO",
            logoUrl: "https://example.com/nato.png",
          }),
        ]}
        lang="pl"
      />,
    );
    const img = container.querySelector('img[alt=""]');
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://example.com/nato.png");
  });

  it("pusta lista nie renderuje niczego", () => {
    const { container } = renderWithQueryClient(<PeopleOrgResults items={[]} lang="pl" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("PeopleOrgStrip", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renderuje pigułki i przycisk przejścia do pełnej sekcji", () => {
    const onSeeAll = vi.fn();
    renderWithQueryClient(<PeopleOrgStrip items={[item({})]} lang="pl" onSeeAll={onSeeAll} />);
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onSeeAll).toHaveBeenCalled();
  });

  it("wyświetla miniaturkę logo organizacji w pigułce", () => {
    const { container } = renderWithQueryClient(
      <PeopleOrgStrip
        items={[
          item({
            kind: "organization",
            id: "o1",
            label_pl: "NATO",
            logoUrl: "https://example.com/nato.png",
          }),
        ]}
        lang="pl"
        onSeeAll={vi.fn()}
      />,
    );
    const img = container.querySelector('img[alt=""]');
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://example.com/nato.png");
  });
});

// ---------------------------------------------------------------------------
// Ramiona etykiet i identyfikacji - dopisane 18.08.2026 przy domykaniu modułu.
//
// Ta sekcja celuje w rozgałęzienia, których nie widać w „szczęśliwym" wierszu:
// fallbacki językowe (wpis wprowadzony tylko po polsku ma się pokazać także
// na angielskiej wersji strony), brak sluga (adres musi mieć CZYM zastąpić) i
// inicjał w awatarze zastępczym. Każde z nich objawia się u użytkownika pustą
// nazwą albo martwym linkiem, czyli klasą defektu, której nie widać w logu.
// ---------------------------------------------------------------------------

describe("PeopleOrgResults - etykiety i identyfikacja", () => {
  beforeEach(() => cleanup());

  it("brak etykiety w wybranym języku spada na drugi - wiersz nie może być bezimienny", () => {
    renderWithQueryClient(
      <PeopleOrgResults items={[item({ label_en: "", sublabel_en: "" })]} lang="en" />,
    );
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
    expect(screen.getByText("Analityk")).toBeTruthy();
  });

  it("brak etykiety w OBU językach nie wywraca wiersza", () => {
    renderWithQueryClient(
      <PeopleOrgResults items={[item({ label_pl: "", label_en: "" })]} lang="pl" />,
    );
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });

  it("brak podpisu daje wiersz bez drugiej linii, a nie pusty akapit", () => {
    const { container } = renderWithQueryClient(
      <PeopleOrgResults items={[item({ sublabel_pl: null, sublabel_en: null })]} lang="pl" />,
    );
    expect(container.textContent).not.toContain("Analityk");
  });

  it("OSOBA BEZ SLUGA identyfikuje się ID - link nie może prowadzić do /author/undefined", () => {
    renderWithQueryClient(
      <PeopleOrgResults items={[item({ slug: null, id: "u-42" })]} lang="pl" />,
    );
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/author/u-42");
  });

  it("osoba bez awatara dostaje inicjał, nie pusty krążek", () => {
    renderWithQueryClient(
      <PeopleOrgResults items={[item({ avatarUrl: null, label_pl: "Zofia Nowak" })]} lang="pl" />,
    );
    expect(screen.getByText("Z")).toBeTruthy();
  });

  it("organizacja bez logo też dostaje inicjał", () => {
    renderWithQueryClient(
      <PeopleOrgResults
        items={[
          item({ kind: "organization", id: "o-1", label_pl: "NATO", logoUrl: null, slug: "nato" }),
        ]}
        lang="pl"
      />,
    );
    expect(screen.getByText("N")).toBeTruthy();
  });

  it("wpis bez nazwy nie próbuje wziąć inicjału z pustki", () => {
    const { container } = renderWithQueryClient(
      <PeopleOrgResults
        items={[item({ label_pl: "", label_en: "", avatarUrl: null })]}
        lang="pl"
      />,
    );
    // Zamiast inicjału - ikona zastępcza.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("osoba ZWERYFIKOWANA jest oznaczona, niezweryfikowana nie", () => {
    const { unmount } = renderWithQueryClient(
      <PeopleOrgResults items={[item({ verified: true })]} lang="pl" />,
    );
    expect(screen.getByLabelText("search.people.verified")).toBeTruthy();
    unmount();
    cleanup();
    renderWithQueryClient(<PeopleOrgResults items={[item({ verified: false })]} lang="pl" />);
    expect(screen.queryByLabelText("search.people.verified")).toBeNull();
  });
});

describe("PeopleOrgStrip - ramiona pigułki", () => {
  beforeEach(() => cleanup());

  it("pigułka osoby z awatarem pokazuje zdjęcie", () => {
    const { container } = renderWithQueryClient(
      <PeopleOrgStrip items={[item({ avatarUrl: "/av.webp" })]} lang="pl" onSeeAll={() => {}} />,
    );
    expect(container.querySelector('img[src="/av.webp"]')).not.toBeNull();
  });

  it("pigułka bez grafiki spada na ikonę rodzaju", () => {
    const { container } = renderWithQueryClient(
      <PeopleOrgStrip
        items={[
          item({ avatarUrl: null }),
          item({ kind: "organization", id: "o-1", logoUrl: null }),
        ]}
        lang="pl"
        onSeeAll={() => {}}
      />,
    );
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });

  it("znacznik weryfikacji pokazuje się także w pigułce", () => {
    renderWithQueryClient(
      <PeopleOrgStrip items={[item({ verified: true })]} lang="pl" onSeeAll={() => {}} />,
    );
    expect(screen.getByLabelText("search.people.verified")).toBeTruthy();
  });

  it("pigułka bierze etykietę w wybranym języku, z fallbackiem", () => {
    renderWithQueryClient(
      <PeopleOrgStrip
        items={[item({ label_en: "", label_pl: "Jan Kowalski" })]}
        lang="en"
        onSeeAll={() => {}}
      />,
    );
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    render(
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
    const { container } = render(
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
    render(<PeopleOrgResults items={[item({ verified: true })]} lang="pl" />);
    expect(screen.getByLabelText("search.people.verified")).toBeTruthy();
  });

  it("wyświetla logo organizacji, gdy jest dostępne", () => {
    const { container } = render(
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
    const { container } = render(<PeopleOrgResults items={[]} lang="pl" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("PeopleOrgStrip", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renderuje pigułki i przycisk przejścia do pełnej sekcji", () => {
    const onSeeAll = vi.fn();
    render(<PeopleOrgStrip items={[item({})]} lang="pl" onSeeAll={onSeeAll} />);
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onSeeAll).toHaveBeenCalled();
  });

  it("wyświetla miniaturkę logo organizacji w pigułce", () => {
    const { container } = render(
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

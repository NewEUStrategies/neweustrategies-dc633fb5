import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetValue } from "@/lib/queries/archives";
import { TermExplorer } from "../TermExplorer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const fv = (p: Partial<FacetValue>): FacetValue => ({
  dim: "topic",
  id: "t1",
  slug: "energia",
  label_pl: "Energia",
  label_en: "Energy",
  parentId: null,
  count: 4,
  ...p,
});

describe("TermExplorer", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renderuje tylko wymiary z tej zakładki, z licznikami", () => {
    render(
      <TermExplorer
        facets={[fv({}), fv({ dim: "pub_type", id: "pt1", slug: "raport", label_pl: "Raport" })]}
        dims={["topic", "region"]}
        lang="pl"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Energia")).toBeTruthy();
    expect(screen.queryByText("Raport")).toBeNull();
  });

  it("wybór termu taksonomii nakłada filtr po ID i wraca do sekcji Wszystko", () => {
    const onChange = vi.fn();
    render(<TermExplorer facets={[fv({})]} dims={["topic"]} lang="pl" onChange={onChange} />);
    fireEvent.click(screen.getByText("Energia"));
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, topic: "t1" });
  });

  it("wymiar wyliczany (format) filtruje po slugu", () => {
    const onChange = vi.fn();
    render(
      <TermExplorer
        facets={[fv({ dim: "format", id: null, slug: "video", label_pl: "Wideo" })]}
        dims={["format"]}
        lang="pl"
        onChange={onChange}
      />,
    );
    // facetLabel tłumaczy format przez i18n z defaultValue=slug (mock zwraca defaultValue).
    fireEvent.click(screen.getByText("video"));
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, format: "video" });
  });

  it("brak pasujących wymiarów pokazuje stan pusty", () => {
    render(<TermExplorer facets={[]} dims={["topic"]} lang="pl" onChange={() => {}} />);
    expect(screen.getByText("search.explore.empty")).toBeTruthy();
  });
});

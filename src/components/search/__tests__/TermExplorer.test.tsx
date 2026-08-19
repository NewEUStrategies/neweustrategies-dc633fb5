// Eksplorator wymiarów (zakładki „Rodzaje treści" i „Tematyka").
//
// Cały ciężar tego komponentu siedzi w `patchFor`: jedna wartość fasety musi
// zamienić się w ŁATKĘ URL-a właściwą dla swojego wymiaru, a wymiarów jest
// osiem i każdy identyfikuje wartość inaczej (taksonomia i autor po ID,
// format/język/dostępność/rok po slugu, rok dodatkowo czyści zakres dat).
// Pomyłka w tej mapie daje filtr, który wygląda na nałożony, a zawęża co
// innego albo nic - stąd test przechodzi po KAŻDYM ramieniu.
//
// UWAGA O i18n: ten plik używał atrapy `defaultValue ?? key`, przez co
// asercja `getByText("video")` mierzyła slug wpisany w fixture teście, a nie
// tłumaczenie ze słownika (dokładnie wzorzec opisany w nagłówku
// `src/test/i18nReal.ts`, po którym repo zdjęło 47 takich asercji). Teraz
// czyta prawdziwą instancję i18next.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetValue } from "@/lib/queries/archives";

import "@/test/i18nReal";
import "@/lib/i18n-search";
import { TermExplorer } from "../TermExplorer";

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

function renderExplorer(facets: FacetValue[], dims: readonly FacetValue["dim"][]) {
  const onChange = vi.fn();
  const utils = render(<TermExplorer facets={facets} dims={dims} lang="pl" onChange={onChange} />);
  return { onChange, ...utils };
}

afterEach(() => cleanup());

describe("TermExplorer - zakres zakładki", () => {
  it("renderuje tylko wymiary z tej zakładki", () => {
    renderExplorer(
      [fv({}), fv({ dim: "pub_type", id: "pt1", slug: "raport", label_pl: "Raport" })],
      ["topic", "region"],
    );
    expect(screen.getByText("Energia")).toBeInTheDocument();
    expect(screen.queryByText("Raport")).not.toBeInTheDocument();
  });

  it("pokazuje licznik trafień przy wartości, zdaniem ze słownika", () => {
    renderExplorer([fv({ count: 12 })], ["topic"]);
    expect(screen.getByText("Wyników: 12")).toBeInTheDocument();
  });

  it("brak pasujących wymiarów pokazuje stan pusty ze SŁOWNIKA", () => {
    renderExplorer([], ["topic"]);
    expect(screen.getByText("Brak pasujących kategorii dla tej frazy.")).toBeInTheDocument();
  });

  it("wymiar obecny w zakładce, ale bez wartości, nie tworzy pustej sekcji", () => {
    renderExplorer([fv({ dim: "topic" })], ["topic", "series"]);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("po angielsku bierze angielską etykietę", () => {
    render(<TermExplorer facets={[fv({})]} dims={["topic"]} lang="en" onChange={() => {}} />);
    expect(screen.getByText("Energy")).toBeInTheDocument();
  });
});

describe("TermExplorer - łatka per wymiar", () => {
  const click = (label: string) => fireEvent.click(screen.getByText(label));

  it("TAKSONOMIA filtruje po ID i wraca do sekcji „Wszystko”", () => {
    const { onChange } = renderExplorer([fv({})], ["topic"]);
    click("Energia");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, topic: "t1" });
  });

  it("term taksonomii BEZ ID spada na slug - wiersz zostaje klikalny", () => {
    const { onChange } = renderExplorer([fv({ id: null, slug: "energia" })], ["topic"]);
    click("Energia");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, topic: "energia" });
  });

  it("każdy wymiar taksonomii trafia we WŁASNY parametr", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "category", id: "c1", label_pl: "Geopolityka" })],
      ["category"],
    );
    click("Geopolityka");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, spec: "c1" });
  });

  it("AUTOR filtruje po ID", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" })],
      ["author"],
    );
    click("Jan Kowalski");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, author: "a1" });
  });

  it("autor bez ID spada na slug", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "author", id: null, slug: "jan", label_pl: "Jan Kowalski" })],
      ["author"],
    );
    click("Jan Kowalski");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, author: "jan" });
  });

  it("FORMAT filtruje po slugu, a etykieta idzie ze słownika", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "format", id: null, slug: "video", label_pl: "video" })],
      ["format"],
    );
    click("Wideo");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, format: "video" });
  });

  it("JĘZYK filtruje po slugu", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "lang", id: null, slug: "pl", label_pl: "pl" })],
      ["lang"],
    );
    click("Polski");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, lang: "pl" });
  });

  it("DOSTĘPNOŚĆ filtruje po slugu", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "access", id: null, slug: "paid", label_pl: "paid" })],
      ["access"],
    );
    click("Płatna");
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, access: "paid" });
  });

  it("ROK filtruje po slugu i CZYŚCI jawny zakres dat", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "year", id: null, slug: "2026", label_pl: "2026" })],
      ["year"],
    );
    click("2026");
    // Bez czyszczenia dwa filtry czasu biłyby się w tym samym zapytaniu.
    expect(onChange).toHaveBeenCalledWith({
      tab: undefined,
      year: "2026",
      from: undefined,
      to: undefined,
    });
  });
});

describe("TermExplorer - hierarchia regionów", () => {
  it("państwo renderuje się pod swoim regionem", () => {
    renderExplorer(
      [
        fv({ dim: "region", id: "r1", slug: "cee", label_pl: "Europa Środkowa", count: 9 }),
        fv({ dim: "region", id: "r2", slug: "pl", label_pl: "Polska", parentId: "r1", count: 4 }),
      ],
      ["region"],
    );
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels[0]).toContain("Europa Środkowa");
    expect(labels[1]).toContain("Polska");
  });

  it("wybór regionu filtruje po ID", () => {
    const { onChange } = renderExplorer(
      [fv({ dim: "region", id: "r1", slug: "cee", label_pl: "Europa Środkowa" })],
      ["region"],
    );
    fireEvent.click(screen.getByText("Europa Środkowa"));
    expect(onChange).toHaveBeenCalledWith({ tab: undefined, region: "r1" });
  });
});

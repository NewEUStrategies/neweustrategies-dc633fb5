// Panel fasetowy /search. Model (`facetModel.ts`) stoi na 93,7% i ma własny
// test; ta warstwa - PREZENTACJA - stała na 0 z 10 funkcji.
//
// Podział odpowiedzialności jest tu ostry i to on wyznacza zakres testu: panel
// nie trzyma stanu, tylko emituje ŁATKI URL-a. Sprawdzamy więc dwie rzeczy,
// których model nie widzi: co użytkownik WIDZI (afordancja pojedynczego vs
// wielokrotnego wyboru, hierarchia regionów, liczniki) i jaką ŁATKĘ emituje
// klik - bo to ona decyduje, czy filtr się dołoży, czy wywali resztę wyboru.
//
// CZEGO TU NIE MA: zwijania i rozwijania facetu. Panel takiego stanu nie ma -
// test „zwiń facet" na komponencie bez zwijania dowodziłby wyłącznie tego, że
// nic się nie dzieje. Nie ma też „wyczyść wszystko": ten przycisk mieszka
// w `routes/search.tsx`, nie tutaj.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { FacetValue } from "@/lib/queries/archives";
import type { SearchUrl } from "@/lib/search/facetModel";

import "@/test/i18nReal";
import "@/lib/i18n-search";
import { SearchFacetPanel } from "../SearchFacetPanel";

const fv = (p: Partial<FacetValue>): FacetValue => ({
  dim: "topic",
  id: "t-1",
  slug: "energia",
  label_pl: "Energia",
  label_en: "Energy",
  parentId: null,
  count: 5,
  ...p,
});

function renderPanel(facets: FacetValue[], url: SearchUrl = { q: "" }) {
  const onChange = vi.fn();
  const utils = render(
    <SearchFacetPanel facets={facets} url={url} lang="pl" onChange={onChange} />,
  );
  return { onChange, ...utils };
}

afterEach(() => cleanup());

describe("SearchFacetPanel - stan pusty", () => {
  it("brak faset nie renderuje pustej ramki panelu", () => {
    const { container } = renderPanel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("wymiar bez wartości nie dostaje nagłówka", () => {
    renderPanel([fv({ dim: "topic" })]);
    expect(screen.getByText("Temat")).toBeInTheDocument();
    expect(screen.queryByText("Rok")).not.toBeInTheDocument();
  });
});

describe("SearchFacetPanel - afordancja wyboru", () => {
  it("wymiar TAKSONOMII dostaje checkboxy - wybór jest wielokrotny", () => {
    renderPanel([fv({ dim: "topic", id: "t-1" }), fv({ dim: "topic", id: "t-2", slug: "gaz" })]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryAllByRole("button", { pressed: false })).toHaveLength(0);
  });

  it("wymiar POJEDYNCZEGO wyboru dostaje przełącznik, nie checkbox", () => {
    renderPanel([fv({ dim: "year", id: null, slug: "2026", label_pl: "2026" })]);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /2026/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("zaznaczenie widać w aria-checked, nie tylko w kolorze", () => {
    renderPanel([fv({ dim: "topic", id: "t-1" })], { q: "", topic: "t-1" });
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("pokazuje licznik trafień przy każdej wartości", () => {
    renderPanel([fv({ count: 12 })]);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("licznik ZERO też jest pokazany - „0” to informacja, nie brak wiersza", () => {
    renderPanel([fv({ count: 0 })]);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("bierze etykietę we właściwym języku", () => {
    render(<SearchFacetPanel facets={[fv({})]} url={{ q: "" }} lang="en" onChange={() => {}} />);
    expect(screen.getByText("Energy")).toBeInTheDocument();
  });

  it("wymiary tłumaczone biorą nazwę ze SŁOWNIKA, nie ze sluga", () => {
    renderPanel([
      fv({ dim: "format", id: null, slug: "video", label_pl: "video", label_en: "video" }),
      fv({ dim: "access", id: null, slug: "paid", label_pl: "paid", label_en: "paid" }),
    ]);
    expect(screen.getByText("Wideo")).toBeInTheDocument();
    expect(screen.getByText("Płatna")).toBeInTheDocument();
  });
});

describe("SearchFacetPanel - łatki wielokrotnego wyboru", () => {
  it("pierwszy klik DOKŁADA wartość do pustego wymiaru", () => {
    const { onChange } = renderPanel([fv({ dim: "topic", id: "t-1" })]);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ topic: "t-1" });
  });

  it("drugi klik DOKŁADA obok istniejącej wartości, a nie ją zastępuje", () => {
    const { onChange } = renderPanel(
      [fv({ dim: "topic", id: "t-1" }), fv({ dim: "topic", id: "t-2", slug: "gaz" })],
      { q: "", topic: "t-1" },
    );
    const rows = screen.getAllByRole("checkbox");
    fireEvent.click(rows[1]);
    expect(onChange).toHaveBeenCalledWith({ topic: "t-1,t-2" });
  });

  it("klik w zaznaczoną wartość ZDEJMUJE tylko ją", () => {
    const { onChange } = renderPanel(
      [fv({ dim: "topic", id: "t-1" }), fv({ dim: "topic", id: "t-2", slug: "gaz" })],
      { q: "", topic: "t-1,t-2" },
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledWith({ topic: "t-2" });
  });

  it("zdjęcie OSTATNIEJ wartości czyści parametr z URL-a (undefined, nie pusty napis)", () => {
    const { onChange } = renderPanel([fv({ dim: "topic", id: "t-1" })], { q: "", topic: "t-1" });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ topic: undefined });
  });

  it("term taksonomii bez id identyfikuje się slugiem - inaczej wiersz byłby nieklikalny", () => {
    const { onChange } = renderPanel([fv({ dim: "topic", id: null, slug: "energia" })]);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ topic: "energia" });
  });

  it("każdy wymiar taksonomii ma WŁASNY parametr - wybory się nie mieszają", () => {
    const { onChange } = renderPanel([
      fv({ dim: "topic", id: "t-1" }),
      fv({ dim: "pub_type", id: "pt-1", slug: "raport", label_pl: "Raport" }),
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Raport/ }));
    expect(onChange).toHaveBeenCalledWith({ type: "pt-1" });
  });
});

describe("SearchFacetPanel - łatki pojedynczego wyboru", () => {
  const single = (dim: FacetValue["dim"], slug: string, label: string) =>
    fv({ dim, id: null, slug, label_pl: label, label_en: label });

  it("autor identyfikuje się ID, nie slugiem", () => {
    const { onChange } = renderPanel([
      fv({ dim: "author", id: "a-1", slug: "jan", label_pl: "Jan Kowalski" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    expect(onChange).toHaveBeenCalledWith({ author: "a-1" });
  });

  it("format, język i dostępność identyfikują się slugiem", () => {
    const { onChange } = renderPanel([
      single("format", "video", "video"),
      single("lang", "pl", "pl"),
      single("access", "paid", "paid"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Wideo/ }));
    expect(onChange).toHaveBeenCalledWith({ format: "video" });
    fireEvent.click(screen.getByRole("button", { name: /Polski/ }));
    expect(onChange).toHaveBeenCalledWith({ lang: "pl" });
    fireEvent.click(screen.getByRole("button", { name: /Płatna/ }));
    expect(onChange).toHaveBeenCalledWith({ access: "paid" });
  });

  it("wybór roku CZYŚCI jawny zakres dat - inaczej filtry by się biły", () => {
    const { onChange } = renderPanel([single("year", "2026", "2026")]);
    fireEvent.click(screen.getByRole("button", { name: /2026/ }));
    expect(onChange).toHaveBeenCalledWith({ year: "2026", from: undefined, to: undefined });
  });

  it("ponowny klik w aktywny wybór go ZDEJMUJE", () => {
    const { onChange } = renderPanel([single("format", "video", "video")], {
      q: "",
      format: "video",
    });
    fireEvent.click(screen.getByRole("button", { name: /Wideo/ }));
    expect(onChange).toHaveBeenCalledWith({ format: undefined });
  });

  it("zdjęcie roku także czyści zakres dat", () => {
    const { onChange } = renderPanel([single("year", "2026", "2026")], { q: "", year: "2026" });
    fireEvent.click(screen.getByRole("button", { name: /2026/ }));
    expect(onChange).toHaveBeenCalledWith({ year: undefined, from: undefined, to: undefined });
  });
});

describe("SearchFacetPanel - hierarchia regionów", () => {
  it("państwo renderuje się POD swoim regionem i z wcięciem", () => {
    renderPanel([
      fv({ dim: "region", id: "r-1", slug: "cee", label_pl: "Europa Środkowa", count: 10 }),
      fv({ dim: "region", id: "r-2", slug: "pl", label_pl: "Polska", parentId: "r-1", count: 4 }),
    ]);
    const rows = screen.getAllByRole("checkbox");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Europa Środkowa"),
      expect.stringContaining("Polska"),
    ]);
    expect(rows[0].style.paddingLeft).toBe("");
    expect(rows[1].style.paddingLeft).not.toBe("");
  });

  it("państwo bez WIDOCZNEGO rodzica ląduje na poziomie korzenia", () => {
    // Rodzic odfiltrowany przez bieżące zapytanie - dziecko nie może zniknąć.
    renderPanel([
      fv({ dim: "region", id: "r-2", slug: "pl", label_pl: "Polska", parentId: "r-nieobecny" }),
    ]);
    expect(screen.getByRole("checkbox").style.paddingLeft).toBe("");
  });

  it("pozostałe wymiary NIE są drzewem - rodzic nie wcina dziecka", () => {
    renderPanel([
      fv({ dim: "topic", id: "t-1", label_pl: "Nadrzędny" }),
      fv({ dim: "topic", id: "t-2", slug: "gaz", label_pl: "Podrzędny", parentId: "t-1" }),
    ]);
    for (const row of screen.getAllByRole("checkbox")) expect(row.style.paddingLeft).toBe("");
  });
});

describe("SearchFacetPanel - kolejność", () => {
  it("wymiary idą w kolejności panelu, nie w kolejności danych z bazy", () => {
    const { container } = renderPanel([
      fv({ dim: "year", id: null, slug: "2026", label_pl: "2026" }),
      fv({ dim: "pub_type", id: "pt-1", slug: "raport", label_pl: "Raport" }),
      fv({ dim: "topic", id: "t-1" }),
    ]);
    const headings = within(container)
      .getAllByRole("heading")
      .map((h) => h.textContent);
    // FACET_ORDER: pub_type → ... → topic → ... → year
    expect(headings).toEqual(["Typ publikacji", "Temat", "Rok"]);
  });

  it("wartości wewnątrz wymiaru idą od najliczniejszej", () => {
    renderPanel([
      fv({ dim: "topic", id: "t-1", label_pl: "Rzadki", count: 2 }),
      fv({ dim: "topic", id: "t-2", slug: "gaz", label_pl: "Częsty", count: 20 }),
    ]);
    expect(screen.getAllByRole("checkbox").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Częsty"),
      expect.stringContaining("Rzadki"),
    ]);
  });
});

// Chipy aktywnych filtrów. Jedyne miejsce, w którym użytkownik WIDZI, co
// właściwie zawęża jego wyniki - i jedyne, z którego może to zdjąć pojedynczo.
//
// Ryzyko tej warstwy nie leży w logice (ta jest w `activeSelections`, 93,7%
// pokrycia), tylko w ROZWIĄZYWANIU ETYKIET. Chip identyfikuje term przez UUID;
// jeśli etykieta się nie rozwiąże, użytkownik zobaczy chip o treści
// „a3f9e1c2-..." i nie będzie wiedział, co zdejmuje. Dlatego ścieżka
// faseta → cache → wartość surowa ma tu osobny test dla każdego ogniwa.
//
// „Wyczyść wszystko" NIE jest częścią tego komponentu - ten przycisk mieszka
// w `routes/search.tsx` (l. 434) i nie da się go stąd przetestować.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetValue } from "@/lib/queries/archives";
import type { SearchUrl } from "@/lib/search/facetModel";

import "@/test/i18nReal";
import "@/lib/i18n-search";
import { ActiveFilterChips } from "../ActiveFilterChips";

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

function renderChips(
  url: SearchUrl,
  opts: { facets?: FacetValue[]; labelCache?: Record<string, string>; lang?: "pl" | "en" } = {},
) {
  const onChange = vi.fn();
  const utils = render(
    <ActiveFilterChips
      url={url}
      facets={opts.facets ?? []}
      labelCache={opts.labelCache ?? {}}
      lang={opts.lang ?? "pl"}
      onChange={onChange}
    />,
  );
  return { onChange, ...utils };
}

const chips = () => screen.getAllByRole("button");

afterEach(() => cleanup());

describe("ActiveFilterChips - kiedy w ogóle się pokazuje", () => {
  it("bez filtrów nie renderuje NICZEGO - sama fraza to nie filtr", () => {
    const { container } = renderChips({ q: "energia" });
    expect(container).toBeEmptyDOMElement();
  });

  it("wartości domyślne trybów zaawansowanych nie tworzą chipa", () => {
    // „Wszystkie słowa" i „Wszędzie" to stan domyślny - chip sugerowałby
    // zawężenie, którego nie ma.
    const { container } = renderChips({ q: "x", match: "all", scope: "all" });
    expect(container).toBeEmptyDOMElement();
  });

  it("opisuje grupę chipów dla czytnika ekranu", () => {
    renderChips({ q: "", topic: "t-1" }, { facets: [fv({})] });
    expect(screen.getByLabelText("Aktywne filtry")).toBeInTheDocument();
  });
});

describe("ActiveFilterChips - rozwiązywanie etykiety termu", () => {
  it("bierze etykietę z BIEŻĄCYCH faset, gdy term tam jest", () => {
    renderChips({ q: "", topic: "t-1" }, { facets: [fv({ id: "t-1", label_pl: "Energia" })] });
    expect(chips()[0].textContent).toContain("Energia");
  });

  it("spada na CACHE etykiet, gdy faseta ma zerową liczność w bieżącym zbiorze", () => {
    // To jest powód istnienia cache'u: zawężenie zapytania może wyrzucić term
    // z faset, a chip nadal musi mieć nazwę.
    renderChips({ q: "", topic: "t-1" }, { labelCache: { "t-1": "Energia (z cache)" } });
    expect(chips()[0].textContent).toContain("Energia (z cache)");
  });

  it("faseta ma PIERWSZEŃSTWO przed cache'em (świeższa)", () => {
    renderChips(
      { q: "", topic: "t-1" },
      { facets: [fv({ id: "t-1", label_pl: "Świeża" })], labelCache: { "t-1": "Nieświeża" } },
    );
    expect(chips()[0].textContent).toContain("Świeża");
  });

  it("bez fasety i bez cache’u pokazuje surową wartość - chip zostaje USUWALNY", () => {
    // Brzydkie, ale lepsze niż chip bez treści albo brak chipa przy aktywnym
    // filtrze: użytkownik musi mieć jak zdjąć zawężenie, którego nie rozumie.
    renderChips({ q: "", topic: "a3f9e1c2" });
    expect(chips()[0].textContent).toContain("a3f9e1c2");
  });

  it("etykieta termu idzie za językiem", () => {
    renderChips(
      { q: "", topic: "t-1" },
      { facets: [fv({ id: "t-1", label_pl: "Energia", label_en: "Energy" })], lang: "en" },
    );
    expect(chips()[0].textContent).toContain("Energy");
  });
});

describe("ActiveFilterChips - etykiety wymiarów tłumaczonych", () => {
  it("format, język i dostępność biorą nazwę ze słownika", () => {
    renderChips({ q: "", format: "video", lang: "pl", access: "paid" });
    const text = chips()
      .map((c) => c.textContent)
      .join(" | ");
    expect(text).toContain("Wideo");
    expect(text).toContain("Polski");
    expect(text).toContain("Płatna");
  });

  it("nieznana wartość wymiaru spada na surowy slug, a nie na pusty chip", () => {
    renderChips({ q: "", format: "hologram" });
    expect(chips()[0].textContent).toContain("hologram");
  });

  it("tryby zaawansowane mają własne etykiety i prefiksy", () => {
    renderChips({ q: "", match: "phrase", scope: "title" });
    const text = chips()
      .map((c) => c.textContent)
      .join(" | ");
    expect(text).toContain("Dopasowanie");
    expect(text).toContain("Dokładna fraza");
    expect(text).toContain("Zakres");
    expect(text).toContain("Tylko tytuły");
  });

  it("rok pokazuje się dosłownie", () => {
    renderChips({ q: "", year: "2026" });
    expect(chips()[0].textContent).toContain("2026");
  });

  it("zakres dat pokazuje się jako JEDEN chip z obiema granicami", () => {
    renderChips({ q: "", from: "2024-01-01", to: "2024-12-31" });
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("2024-01-01");
    expect(chips()[0].textContent).toContain("2024-12-31");
  });

  it("otwarty zakres dat pokazuje wielokropek zamiast pustki", () => {
    renderChips({ q: "", from: "2024-01-01" });
    expect(chips()[0].textContent).toContain("…");
  });
});

describe("ActiveFilterChips - zdejmowanie", () => {
  it("zdjęcie chipa taksonomii usuwa TYLKO tę wartość, resztę wymiaru zostawia", () => {
    const { onChange } = renderChips({ q: "", topic: "t-1,t-2" });
    fireEvent.click(chips()[0]);
    expect(onChange).toHaveBeenCalledWith({ topic: "t-2" });
  });

  it("zdjęcie OSTATNIEJ wartości czyści parametr", () => {
    const { onChange } = renderChips({ q: "", topic: "t-1" });
    fireEvent.click(chips()[0]);
    expect(onChange).toHaveBeenCalledWith({ topic: undefined });
  });

  it("zdjęcie chipa zakresu dat czyści OBA klucze naraz", () => {
    const { onChange } = renderChips({ q: "", from: "2024-01-01", to: "2024-12-31" });
    fireEvent.click(chips()[0]);
    expect(onChange).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });

  it("zdjęcie chipa trybu wraca do wartości domyślnej", () => {
    const { onChange } = renderChips({ q: "", match: "phrase" });
    fireEvent.click(chips()[0]);
    expect(onChange).toHaveBeenCalledWith({ match: undefined });
  });

  it("zdjęcie autora czyści autora", () => {
    const { onChange } = renderChips({ q: "", author: "a-1" });
    fireEvent.click(chips()[0]);
    expect(onChange).toHaveBeenCalledWith({ author: undefined });
  });

  it("każdy chip ma OPISOWĄ etykietę dla czytnika - „usuń filtr: wymiar wartość”", () => {
    renderChips({ q: "", topic: "t-1" }, { facets: [fv({ id: "t-1", label_pl: "Energia" })] });
    expect(screen.getByRole("button", { name: "Usuń filtr: Temat Energia" })).toBeInTheDocument();
  });

  it("wiele filtrów daje wiele niezależnych chipów", () => {
    const { onChange } = renderChips({ q: "", topic: "t-1", format: "video", year: "2026" });
    expect(chips()).toHaveLength(3);
    fireEvent.click(chips()[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ format: undefined });
  });
});

describe("ActiveFilterChips - odtworzenie z URL-a", () => {
  it("ten sam URL daje ten sam zestaw chipów niezależnie od kolejności kluczy", () => {
    const a = renderChips({ q: "x", year: "2026", topic: "t-1" });
    const first = chips().map((c) => c.getAttribute("aria-label"));
    a.unmount();
    renderChips({ q: "x", topic: "t-1", year: "2026" });
    expect(chips().map((c) => c.getAttribute("aria-label"))).toEqual(first);
  });

  it("rok WYGRYWA z zakresem dat - nie ma dwóch chipów o tym samym", () => {
    renderChips({ q: "", year: "2026", from: "2024-01-01", to: "2024-12-31" });
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("2026");
  });
});

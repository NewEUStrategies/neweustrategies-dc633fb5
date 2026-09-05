// Wartości pól własnych wpisu - `CustomMetaValuesEditor`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Ten edytor jest cienką warstwą nad
// kolumną jsonb `posts.custom_meta`, a cała jego logika mieści się w jednej
// funkcji `setKey`. Ta funkcja decyduje o tym, co zostanie w bazie, więc:
//   1. PUSTA WARTOŚĆ USUWA KLUCZ, a nie zapisuje pustego napisu. Klucz z `""`
//      przechodzi do renderera publicznego jako pole ISTNIEJĄCE i wypisuje
//      pustą etykietę pod wpisem. Tak samo traktowane są SAME BIAŁE ZNAKI -
//      redaktor, który wyczyścił pole spacją, ma dostać usunięcie klucza.
//   2. WARTOŚĆ JEST ZAPISYWANA BEZ OBCINANIA. `trim()` jest w tym kodzie
//      TYLKO testem "czy coś zostało", a nie normalizacją - do bazy idzie
//      dokładnie to, co redaktor wpisał. To jest zachowanie, nie przeoczenie,
//      więc jest przypięte (zmiana na `next[key] = v.trim()` zerwie ten test
//      świadomie, a nie przypadkiem).
//   3. EDYCJA JEDNEGO POLA NIE GUBI POZOSTAŁYCH - `setKey` kopiuje mapę
//      wartości; podmiana obiektu skasowałaby resztę pól przy każdym
//      naciśnięciu klawisza.
//   4. `null`/`undefined` W PROPIE `values` DZIAŁA JAK PUSTA MAPA (nowy wpis
//      nie ma jeszcze kolumny) - bez tego edytor sypałby się na `of null`.
//   5. BRAK DEFINICJI TO NIE JEST PUSTY EKRAN: redakcja dostaje odnośnik do
//      globalnej konfiguracji pól, po polsku albo po angielsku.
//   6. ETYKIETA IDZIE ZA JĘZYKIEM (`metaLabel`), a `title` pola zawsze pokazuje
//      KLUCZ techniczny - to jedyny sposób, żeby redaktor wiedział, co
//      naprawdę wyląduje w jsonb.
//
// Odczyt definicji leci PRAWDZIWYM `listCustomMetaDefs` przez atrapę klienta
// PostgREST - dzięki temu przypięte jest też to, że lista jest zawężona do
// tenanta (bez tego jeden serwis widziałby pola drugiego).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ok, supabaseFromStub } from "@/test/supabase";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { CustomMetaDef, CustomMetaValues } from "@/lib/customMeta";

// Atrapa klienta jest zbudowana PRZED pierwszym importem modułu produkcyjnego
// (komponent wchodzi przez `await import` niżej), więc fabryka mocka widzi
// gotowy obiekt - żaden statyczny import w tym pliku nie dotyka klienta.
const baza = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => baza.from(table) },
}));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const { CustomMetaValuesEditor } = await import("@/components/admin/CustomMetaValuesEditor");

/** Wiersz definicji pola własnego w kształcie, w jakim czyta go warstwa danych. */
function definicja(over: Partial<CustomMetaDef> = {}): CustomMetaDef {
  return {
    id: "def-1",
    tenant_id: "tenant-1",
    key: "zrodlo",
    label_pl: "Źródło",
    label_en: "Source",
    icon: "link",
    position: 1,
    ...over,
  };
}

function renderuj(opcje: {
  defs: CustomMetaDef[];
  values?: CustomMetaValues | null;
  lang?: "pl" | "en";
}) {
  baza.reset();
  baza.setResponse("post_custom_meta_defs", ok(opcje.defs));
  const onChange = vi.fn<(next: CustomMetaValues) => void>();
  const utils = renderWithQueryClient(
    <CustomMetaValuesEditor
      tenantId="tenant-1"
      lang={opcje.lang ?? "pl"}
      values={opcje.values === undefined ? {} : opcje.values}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

describe("CustomMetaValuesEditor - stany ładowania i pustki", () => {
  it("pokazuje wielokropek, dopóki definicje się ładują", () => {
    renderuj({ defs: [definicja()] });

    expect(screen.getByText("...")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("bez definicji kieruje redakcję do globalnej konfiguracji pól (PL)", async () => {
    renderuj({ defs: [] });

    const odnosnik = await screen.findByRole("link", { name: "Zdefiniuj globalne pola" });
    expect(odnosnik).toHaveAttribute("href", "/admin/custom-meta");
    expect(screen.getByText(/Brak zdefiniowanych pól/)).toBeInTheDocument();
  });

  it("bez definicji kieruje redakcję do globalnej konfiguracji pól (EN)", async () => {
    renderuj({ defs: [], lang: "en" });

    expect(await screen.findByRole("link", { name: "Define global fields" })).toHaveAttribute(
      "href",
      "/admin/custom-meta",
    );
    expect(screen.getByText(/No fields defined yet/)).toBeInTheDocument();
  });

  it("czyta definicje ZAWĘŻONE do tenanta, w kolejności pozycji i klucza", async () => {
    renderuj({ defs: [definicja()] });

    await screen.findByRole("textbox");
    const lancuch = baza.lastChain("post_custom_meta_defs");
    expect(lancuch?.argsOf("eq")).toEqual(["tenant_id", "tenant-1"]);
    expect(lancuch?.calls.filter((c) => c.method === "order")).toHaveLength(2);
  });
});

describe("CustomMetaValuesEditor - etykiety pól", () => {
  it("po polsku bierze `label_pl`, po angielsku `label_en`", async () => {
    const { unmount } = renderuj({ defs: [definicja()] });
    expect(await screen.findByText("Źródło")).toBeInTheDocument();
    unmount();

    renderuj({ defs: [definicja()], lang: "en" });
    expect(await screen.findByText("Source")).toBeInTheDocument();
  });

  it("brak tłumaczenia spada na drugi język, a przy jego braku na klucz", async () => {
    renderuj({
      defs: [
        definicja({ id: "d1", key: "a", label_en: "" }),
        definicja({ id: "d2", key: "techniczny", label_pl: "", label_en: "" }),
      ],
      lang: "en",
    });

    // `label_en` puste -> polska etykieta; obie puste -> klucz techniczny.
    expect(await screen.findByText("Źródło")).toBeInTheDocument();
    expect(screen.getByText("techniczny")).toBeInTheDocument();
  });

  it("`title` pola zawsze pokazuje KLUCZ techniczny, niezależnie od etykiety", async () => {
    renderuj({ defs: [definicja()] });

    const etykieta = await screen.findByText("Źródło");
    expect(etykieta).toHaveAttribute("title", "zrodlo");
    // Klucz jest też podpowiedzią w polu - redaktor widzi, co idzie do jsonb.
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "zrodlo");
  });
});

describe("CustomMetaValuesEditor - zapis wartości do mapy jsonb", () => {
  it("wpisana wartość ląduje pod kluczem definicji", async () => {
    const { onChange } = renderuj({ defs: [definicja()] });

    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "PAP" } });

    expect(onChange).toHaveBeenCalledWith({ zrodlo: "PAP" });
  });

  it("wartość idzie do bazy BEZ obcinania białych znaków", async () => {
    const { onChange } = renderuj({ defs: [definicja()] });

    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "  PAP  " } });

    expect(onChange).toHaveBeenCalledWith({ zrodlo: "  PAP  " });
  });

  it.each([
    ["puste pole", ""],
    ["same spacje", "   "],
  ])("%s USUWA klucz zamiast zapisywać pusty napis", async (_opis, wpisane) => {
    const { onChange } = renderuj({ defs: [definicja()], values: { zrodlo: "PAP" } });

    fireEvent.change(await screen.findByRole("textbox"), { target: { value: wpisane } });

    expect(onChange).toHaveBeenCalledWith({});
  });

  it("edycja jednego pola nie gubi wartości pozostałych", async () => {
    const { onChange } = renderuj({
      defs: [definicja({ id: "d1", key: "zrodlo" }), definicja({ id: "d2", key: "sygnatura" })],
      values: { zrodlo: "PAP", sygnatura: "ABC/1" },
    });

    const pola = await screen.findAllByRole("textbox");
    fireEvent.change(pola[1], { target: { value: "ABC/2" } });

    expect(onChange).toHaveBeenCalledWith({ zrodlo: "PAP", sygnatura: "ABC/2" });
  });

  it("pola pokazują wartości z propa, a brak klucza zostawia pole puste", async () => {
    renderuj({
      defs: [definicja({ id: "d1", key: "zrodlo" }), definicja({ id: "d2", key: "sygnatura" })],
      values: { zrodlo: "PAP" },
    });

    const pola = await screen.findAllByRole("textbox");
    expect(pola[0]).toHaveValue("PAP");
    expect(pola[1]).toHaveValue("");
  });

  it("`values: null` (nowy wpis bez kolumny) działa jak pusta mapa", async () => {
    const { onChange } = renderuj({ defs: [definicja()], values: null });

    const pole = await screen.findByRole("textbox");
    expect(pole).toHaveValue("");

    fireEvent.change(pole, { target: { value: "Reuters" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ zrodlo: "Reuters" }));
  });
});

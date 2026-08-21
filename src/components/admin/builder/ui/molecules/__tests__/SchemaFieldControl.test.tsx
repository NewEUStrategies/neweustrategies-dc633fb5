// Kontrolka pojedynczego pola deklaratywnego. To ONA rysuje większość paneli
// widgetów - `WIDGET_SCHEMAS` opisuje pola, a ten plik zamienia opis na
// kontrolkę i na ZAPIS. Stąd trzy rzeczy, które muszą być przypięte tabelą po
// wszystkich czternastu typach pól:
//
//  1. KLUCZ ZAPISU. Pola językowe zapisują `${key}_${lang}`, pozostałe `key`.
//     Pomyłka tutaj zapisuje polską treść pod klucz angielski i redakcja
//     traci tekst przy przełączeniu języka panelu.
//  2. KLUCZE HISTORYCZNE. Panel CZYTA aliasy (żeby nie pokazywać pustego pola
//     nad działającym ustawieniem), ale ZAPISUJE wyłącznie klucz kanoniczny.
//  3. TYP WARTOŚCI. Przełącznik zapisuje prawdziwy `boolean`, nie "0"/"1"
//     (napis "0" jest prawdziwy w JS - tak właśnie kilku przełączników nie
//     dało się wyłączyć), a pole liczbowe czyści się przez `null`, nie przez 0.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Json } from "@/lib/builder/types";
import type { SchemaField } from "@/lib/builder/schemas";
import { selectWithOption, optionValues } from "@/test/builder/panels";
import { SchemaFieldControl } from "../SchemaFieldControl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});

// Dzieci kontrolki mają WŁASNE testy (biblioteka ikon, podpowiedzi adresów,
// pole HTML, arkusz danych wykresu, slot obrazka, biblioteka mediów). Tutaj
// interesuje wyłącznie to, CZY kontrolka wpina je pod właściwy klucz i czy
// przekazuje im wartość - dlatego stoją tu jako minimalne atrapy. Bez tego
// każdy przypadek tabeli ciągnąłby zapytania o listę stron i mediów.
vi.mock("../PageUrlAutocomplete", () => ({
  PageUrlAutocomplete: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label="adres"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("../RichHtmlField", () => ({
  RichHtmlField: ({
    value,
    onChange,
    ariaLabel,
    rows,
  }: {
    value: string;
    onChange: (v: string) => void;
    ariaLabel?: string;
    rows?: number;
  }) => (
    <textarea
      aria-label={ariaLabel}
      data-rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("../LucideIconPicker", () => ({
  LucideIconPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <input
      aria-label="ikona"
      value={value}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  ),
}));
vi.mock("../ChartDataSpreadsheetDialog", () => ({
  ChartDataSpreadsheetDialog: ({
    value,
    onChange,
    kind,
    unit,
    title,
  }: {
    value: string;
    onChange: (v: string) => void;
    kind: string;
    unit: string;
    title: string;
  }) => (
    <button
      type="button"
      data-kind={kind}
      data-unit={unit}
      data-title={title}
      onClick={() => onChange(`${value}!`)}
    >
      arkusz
    </button>
  ),
}));
vi.mock("../../organisms/widget-properties/ImageSlot", () => ({
  ImageSlot: ({
    label,
    value,
    onChange,
    hint,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    hint?: string;
  }) => (
    <div>
      <span>{label}</span>
      {hint ? <em>{hint}</em> : null}
      <input aria-label="obrazek" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  ),
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({
    open,
    onPick,
  }: {
    open: boolean;
    onPick: (url: string) => void;
    onOpenChange: (o: boolean) => void;
    title: string;
  }) =>
    open ? (
      <button type="button" onClick={() => onPick("https://cdn.test/z-biblioteki.png")}>
        biblioteka
      </button>
    ) : null,
}));

type Written = Array<[string, Json]>;

function renderField(
  field: SchemaField,
  content: Record<string, unknown> = {},
  lang: "pl" | "en" = "pl",
) {
  const written: Written = [];
  const view = render(
    <SchemaFieldControl
      field={field}
      lang={lang}
      content={content}
      setContent={(key, value) => written.push([key, value])}
    />,
  );
  return { ...view, written, last: () => written.at(-1) };
}

describe("SchemaFieldControl - widoczność warunkowa", () => {
  it("pole ukryte przez predykat nie renderuje się wcale", () => {
    const { container } = renderField(
      { key: "cols", type: "number", label: "Kolumny", visibleWhen: (c) => c.layout === "grid" },
      { layout: "list" },
    );
    expect(container.firstChild).toBeNull();
  });

  it("pole widoczne przez predykat renderuje się", () => {
    renderField(
      { key: "cols", type: "number", label: "Kolumny", visibleWhen: (c) => c.layout === "grid" },
      { layout: "grid" },
    );
    expect(screen.getByText("Kolumny")).toBeInTheDocument();
  });
});

describe("SchemaFieldControl - pola tekstowe", () => {
  it("pole tekstowe czyta i zapisuje klucz kanoniczny", () => {
    const { last } = renderField(
      { key: "badge", type: "text", label: "Plakietka", placeholder: "np. NOWE", hint: "krótko" },
      { badge: "PROMO" },
    );
    const input = screen.getByDisplayValue("PROMO") as HTMLInputElement;
    expect(input.placeholder).toBe("np. NOWE");
    expect(screen.getByText("krótko")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "NOWE" } });
    expect(last()).toEqual(["badge", "NOWE"]);
  });

  it.each([
    ["pl", "Tytuł (PL)", "title_pl"],
    ["en", "Tytuł (EN)", "title_en"],
  ] as const)("pole językowe (%s) nosi sufiks w etykiecie i w kluczu", (lang, label, key) => {
    const { last } = renderField({ key: "title", type: "i18nText", label: "Tytuł" }, {}, lang);
    expect(screen.getByText(label)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    expect(last()).toEqual([key, "X"]);
  });

  it("pole HTML dostaje etykietę z językiem i liczbę wierszy", () => {
    const { last } = renderField(
      { key: "body", type: "i18nHtml", label: "Treść", rows: 8 },
      { body_pl: "<p>a</p>" },
    );
    const area = screen.getByLabelText("Treść (PL)") as HTMLTextAreaElement;
    expect(area.value).toBe("<p>a</p>");
    expect(area.dataset.rows).toBe("8");
    fireEvent.change(area, { target: { value: "<p>b</p>" } });
    expect(last()).toEqual(["body_pl", "<p>b</p>"]);
  });

  it("pole HTML bez podanej liczby wierszy ma cztery", () => {
    renderField({ key: "body", type: "i18nHtml", label: "Treść" });
    expect((screen.getByLabelText("Treść (PL)") as HTMLTextAreaElement).dataset.rows).toBe("4");
  });

  it("pole wieloliniowe zapisuje surowy tekst", () => {
    const { last } = renderField({ key: "note", type: "textarea", label: "Notka", rows: 2 }, {});
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(String(area.rows)).toBe("2");
    fireEvent.change(area, { target: { value: "linia 1\nlinia 2" } });
    expect(last()).toEqual(["note", "linia 1\nlinia 2"]);
  });

  it("pole wieloliniowe bez podanej liczby wierszy ma cztery", () => {
    renderField({ key: "note", type: "textarea", label: "Notka" });
    expect(String((screen.getByRole("textbox") as HTMLTextAreaElement).rows)).toBe("4");
  });
});

describe("SchemaFieldControl - klucze historyczne", () => {
  it("czyta wartość z aliasu, gdy klucz kanoniczny jest pusty", () => {
    renderField(
      { key: "heading", type: "text", label: "Nagłówek", legacyKeys: ["title"] },
      { title: "Stara wartość" },
    );
    expect(screen.getByDisplayValue("Stara wartość")).toBeInTheDocument();
  });

  it("zapisuje ZAWSZE klucz kanoniczny, nawet czytając alias", () => {
    const { last } = renderField(
      { key: "heading", type: "text", label: "Nagłówek", legacyKeys: ["title"] },
      { title: "Stara wartość" },
    );
    fireEvent.change(screen.getByDisplayValue("Stara wartość"), { target: { value: "Nowa" } });
    // Treść migruje sama przy pierwszej edycji - alias zostaje w dokumencie,
    // ale przestaje być czytany, bo klucz kanoniczny nie jest już pusty.
    expect(last()).toEqual(["heading", "Nowa"]);
  });

  it("klucz kanoniczny wygrywa z aliasem", () => {
    renderField(
      { key: "heading", type: "text", label: "Nagłówek", legacyKeys: ["title"] },
      { heading: "Nowa", title: "Stara" },
    );
    expect(screen.getByDisplayValue("Nowa")).toBeInTheDocument();
  });

  it.each([
    ["pusty napis", ""],
    ["null", null],
    ["undefined", undefined],
  ])("alias wchodzi w grę, gdy klucz kanoniczny to %s", (_label, primary) => {
    renderField(
      { key: "heading", type: "text", label: "Nagłówek", legacyKeys: ["title"] },
      { heading: primary, title: "Stara" },
    );
    expect(screen.getByDisplayValue("Stara")).toBeInTheDocument();
  });

  it("alias pola językowego dostaje ten sam sufiks języka", () => {
    renderField(
      { key: "lead", type: "i18nText", label: "Zajawka", legacyKeys: ["intro"] },
      { intro_pl: "Zajawka PL", intro_en: "Lead EN" },
    );
    expect(screen.getByDisplayValue("Zajawka PL")).toBeInTheDocument();
  });

  it("pusty alias nie zasłania kolejnego aliasu", () => {
    renderField(
      { key: "heading", type: "text", label: "Nagłówek", legacyKeys: ["a", "b"] },
      { a: "", b: "z drugiego aliasu" },
    );
    expect(screen.getByDisplayValue("z drugiego aliasu")).toBeInTheDocument();
  });

  it("brak wartości w kluczu i w aliasach daje puste pole", () => {
    renderField({ key: "heading", type: "text", label: "Nagłówek", legacyKeys: ["title"] }, {});
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });
});

describe("SchemaFieldControl - pola liczbowe", () => {
  it("czyta liczbę i przekazuje zakres", () => {
    renderField(
      { key: "cols", type: "number", label: "Kolumny", min: 1, max: 6, step: 1 },
      { cols: 3 },
    );
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("3");
    expect(input.min).toBe("1");
    expect(input.max).toBe("6");
    expect(input.step).toBe("1");
  });

  it("bez wartości pokazuje domyślną ze schematu", () => {
    renderField({ key: "cols", type: "number", label: "Kolumny", default: 4 }, {});
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("4");
    expect(input.placeholder).toBe("4");
  });

  it("bez wartości i bez domyślnej pokazuje pustkę", () => {
    renderField({ key: "cols", type: "number", label: "Kolumny" }, {});
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("");
  });

  it("wartość nieliczbowa w dokumencie spada na domyślną", () => {
    renderField({ key: "cols", type: "number", label: "Kolumny", default: 2 }, { cols: "trzy" });
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("2");
  });

  it("zero jest wartością, nie brakiem wartości", () => {
    renderField({ key: "gap", type: "number", label: "Odstęp", default: 16 }, { gap: 0 });
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
  });

  it("zapisuje liczbę i czyści przez null", () => {
    const { last } = renderField({ key: "cols", type: "number", label: "Kolumny" }, { cols: 3 });
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5" } });
    expect(last()).toEqual(["cols", 5]);
    fireEvent.change(input, { target: { value: "" } });
    // `null` USUWA ustawienie (widget wraca do domyślnej), zero by je ustawiło
    // na zero - to dwie różne rzeczy i dwie różne strony w podglądzie.
    expect(last()).toEqual(["cols", null]);
  });

  it("wpis nieliczbowy nie trafia do dokumentu jako liczba", () => {
    const { last } = renderField({ key: "cols", type: "number", label: "Kolumny" }, { cols: 3 });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "abc" } });
    // Kontrolka jest typu `number`, więc tekst nie przechodzi już przez DOM -
    // do obsługi trafia pusta wartość, czyli wyczyszczenie ustawienia. Zapis
    // `NaN` (i CSS `NaNpx`) jest w ten sposób niemożliwy z dwóch stron.
    expect(last()).toEqual(["cols", null]);
  });
});

describe("SchemaFieldControl - listy wyboru", () => {
  const OPTIONS = [
    { value: "", label: "Domyślnie" },
    { value: "grid", label: "Siatka" },
    { value: "list", label: "Lista" },
  ];

  it("pusta wartość to opcja domyślna", () => {
    renderField({ key: "layout", type: "select", label: "Układ", options: OPTIONS }, {});
    const select = selectWithOption("grid");
    expect(select.value).toBe("__default__");
    expect(optionValues(select)).toEqual(["__default__", "grid", "list"]);
  });

  it("zapisuje wybraną opcję", () => {
    const { last } = renderField(
      { key: "layout", type: "select", label: "Układ", options: OPTIONS },
      { layout: "grid" },
    );
    fireEvent.change(selectWithOption("grid"), { target: { value: "list" } });
    expect(last()).toEqual(["layout", "list"]);
  });

  it("powrót na opcję domyślną zapisuje pusty napis", () => {
    const { last } = renderField(
      { key: "layout", type: "select", label: "Układ", options: OPTIONS },
      { layout: "grid" },
    );
    fireEvent.change(selectWithOption("grid"), { target: { value: "__default__" } });
    // Pusty napis, nie `null` - schemat opisuje „brak nadpisania” właśnie tak,
    // a renderer czyta puste pole jako „użyj wartości motywu”.
    expect(last()).toEqual(["layout", ""]);
  });

  it("lista bez opcji nie wywala kontrolki", () => {
    renderField({ key: "layout", type: "select", label: "Układ" }, {});
    expect(screen.getByText("Układ")).toBeInTheDocument();
  });

  it("opcja bez etykiety pokazuje swoją wartość", () => {
    renderField(
      { key: "layout", type: "select", label: "Układ", options: [{ value: "grid" }] },
      { layout: "grid" },
    );
    expect(screen.getByRole("option", { name: "grid" })).toBeInTheDocument();
  });
});

describe("SchemaFieldControl - przełącznik", () => {
  it("zapisuje prawdziwy boolean w obie strony", () => {
    const { last, written } = renderField(
      { key: "showDate", type: "bool", label: "Pokaż datę" },
      { showDate: true },
    );
    const box = screen.getByRole("switch", { name: "Pokaż datę" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(last()).toEqual(["showDate", false]);
    expect(typeof written[0][1]).toBe("boolean");
  });

  it("domyślna wartość ze schematu działa, gdy dokument nic nie ma", () => {
    renderField({ key: "showDate", type: "bool", label: "Pokaż datę", default: true }, {});
    expect(screen.getByRole("switch", { name: "Pokaż datę" })).toBeChecked();
  });

  it.each([
    ["napis 1", "1", true],
    ["napis 0", "0", false],
    ["napis true", "true", true],
    ["napis false", "false", false],
    ["liczba 1", 1, true],
    ["liczba 0", 0, false],
  ])("czyta treść historyczną: %s", (_label, stored, expected) => {
    renderField({ key: "showDate", type: "bool", label: "Pokaż datę" }, { showDate: stored });
    const box = screen.getByRole("switch", { name: "Pokaż datę" });
    // Napis "0" jest w JS PRAWDZIWY - właśnie dlatego czytamy przez `asBool`,
    // a nie przez samo `!!`. Bez tego przełącznika nie dało się wyłączyć.
    if (expected) expect(box).toBeChecked();
    else expect(box).not.toBeChecked();
  });
});

describe("SchemaFieldControl - kolor", () => {
  it("czyta kolor i zapisuje pusty napis przy zdjęciu nadpisania", () => {
    const { last } = renderField(
      { key: "bg", type: "color", label: "Tło", inheritedValue: "#01112f" },
      { bg: "#ff0000" },
    );
    const field = document.querySelector<HTMLInputElement>("input.font-mono");
    if (!field) throw new Error("test: brak pola koloru");
    expect(field.value).toBe("#ff0000");
    fireEvent.change(field, { target: { value: "" } });
    // Pusty napis zamiast `undefined`: dokument trzyma „brak nadpisania” jako
    // pustą wartość, a nie jako brak klucza.
    expect(last()).toEqual(["bg", ""]);
  });

  it("bez nadpisania podpowiada wartość dziedziczoną", () => {
    renderField({ key: "bg", type: "color", label: "Tło", inheritedValue: "#01112f" }, {});
    const field = document.querySelector<HTMLInputElement>("input.font-mono");
    expect(field?.placeholder).toBe("dziedziczy: #01112f");
  });

  it("bez dziedziczenia i bez podpowiedzi używa podpowiedzi słownikowej", () => {
    renderField({ key: "bg", type: "color", label: "Tło" }, {});
    const field = document.querySelector<HTMLInputElement>("input.font-mono");
    expect(field?.placeholder).toBe("builder.schemaField.colorInherits");
  });
});

describe("SchemaFieldControl - listy tekstowe", () => {
  it("lista jedna-linia-jedna-pozycja czyta i zapisuje tablicę", () => {
    const { last } = renderField(
      { key: "tags", type: "stringArray", label: "Tagi" },
      { tags: ["a", "b"] },
    );
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(area.value).toBe("a\nb");
    fireEvent.change(area, { target: { value: " x \n\n y \n" } });
    // Puste linie i spacje wypadają - inaczej lista rośnie o pozycje, których
    // redaktor nie wpisał, a renderer rysuje puste elementy.
    expect(last()).toEqual(["tags", ["x", "y"]]);
  });

  it("lista odsiewa wartości nietekstowe z dokumentu", () => {
    renderField({ key: "tags", type: "stringArray", label: "Tagi" }, { tags: ["a", 7, null, "b"] });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("a\nb");
  });

  it("lista z wartości, która nie jest tablicą, pokazuje pustkę", () => {
    renderField({ key: "tags", type: "stringArray", label: "Tagi" }, { tags: "a,b" });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("lista językowa zapisuje pod klucz z sufiksem", () => {
    const { last } = renderField(
      { key: "items", type: "i18nStringArray", label: "Punkty", rows: 6 },
      { items_pl: ["raz"] },
      "pl",
    );
    const area = screen.getByLabelText("Punkty (PL)") as HTMLTextAreaElement;
    expect(area.value).toBe("raz");
    expect(String(area.rows)).toBe("6");
    fireEvent.change(area, { target: { value: "raz\ndwa" } });
    expect(last()).toEqual(["items_pl", ["raz", "dwa"]]);
  });

  it("listy bez podanej liczby wierszy mają cztery", () => {
    renderField({ key: "tags", type: "stringArray", label: "Tagi" }, {});
    expect(String((screen.getByRole("textbox") as HTMLTextAreaElement).rows)).toBe("4");
    renderField({ key: "items", type: "i18nStringArray", label: "Punkty" }, {});
    expect(String((screen.getByLabelText("Punkty (PL)") as HTMLTextAreaElement).rows)).toBe("4");
  });
});

describe("SchemaFieldControl - pola delegujące do dzieci", () => {
  it("pole adresu: podpowiedzi stron i wybór z biblioteki mediów", () => {
    const { last } = renderField(
      { key: "href", type: "url", label: "Adres", placeholder: "/o-nas" },
      { href: "/kontakt" },
    );
    const input = screen.getByLabelText("adres") as HTMLInputElement;
    expect(input.value).toBe("/kontakt");
    expect(input.placeholder).toBe("/o-nas");
    fireEvent.change(input, { target: { value: "/nowy" } });
    expect(last()).toEqual(["href", "/nowy"]);

    fireEvent.click(screen.getByLabelText("builder.imageSlot.pickFromLibrary"));
    fireEvent.click(screen.getByRole("button", { name: "biblioteka" }));
    expect(last()).toEqual(["href", "https://cdn.test/z-biblioteki.png"]);
    // Dialog zamyka się po wyborze - inaczej zostaje nad panelem.
    expect(screen.queryByRole("button", { name: "biblioteka" })).toBeNull();
  });

  it("pole ikony zapisuje pustą nazwę przy wyczyszczeniu", () => {
    const { last } = renderField({ key: "icon", type: "icon", label: "Ikona" }, { icon: "star" });
    const input = screen.getByLabelText("ikona") as HTMLInputElement;
    expect(input.value).toBe("star");
    fireEvent.change(input, { target: { value: "" } });
    expect(last()).toEqual(["icon", ""]);
  });

  it("pole obrazka dostaje etykietę, podpowiedź i wartość", () => {
    const { last } = renderField(
      { key: "image", type: "image", label: "Zdjęcie", hint: "16:9" },
      { image: "https://cdn.test/a.jpg" },
    );
    expect(screen.getByText("Zdjęcie")).toBeInTheDocument();
    expect(screen.getByText("16:9")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("obrazek"), {
      target: { value: "https://cdn.test/b.jpg" },
    });
    expect(last()).toEqual(["image", "https://cdn.test/b.jpg"]);
  });

  it("pole danych wykresu ma tekst CSV i arkusz z kontekstem widgetu", () => {
    const { last } = renderField(
      { key: "csv", type: "chartData", label: "Dane", rows: 8 },
      { csv: "a,1", kind: "bar", unit: "%", title_pl: "Tytuł" },
    );
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(String(area.rows)).toBe("8");
    expect(area.placeholder).toBe("builder.schemaField.chartDataPlaceholder");
    fireEvent.change(area, { target: { value: "a,2" } });
    expect(last()).toEqual(["csv", "a,2"]);

    const sheet = screen.getByRole("button", { name: "arkusz" });
    // Arkusz musi znać rodzaj wykresu, jednostkę i tytuł - inaczej podgląd
    // w arkuszu rysuje coś innego niż strona.
    expect(sheet.dataset.kind).toBe("bar");
    expect(sheet.dataset.unit).toBe("%");
    expect(sheet.dataset.title).toBe("Tytuł");
    fireEvent.click(sheet);
    expect(last()).toEqual(["csv", "a,1!"]);
  });

  it("arkusz wykresu spada na tytuł polski, gdy nie ma tytułu w języku panelu", () => {
    renderField(
      { key: "csv", type: "chartData", label: "Dane" },
      { csv: "", title_pl: "Polski" },
      "en",
    );
    expect(screen.getByRole("button", { name: "arkusz" }).dataset.title).toBe("Polski");
  });

  it("pole danych wykresu bez podanej liczby wierszy ma sześć", () => {
    renderField({ key: "csv", type: "chartData", label: "Dane" }, {});
    expect(String((screen.getByRole("textbox") as HTMLTextAreaElement).rows)).toBe("6");
  });
});

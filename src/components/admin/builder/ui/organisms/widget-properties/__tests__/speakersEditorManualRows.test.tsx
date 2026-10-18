// SpeakersEditor: wiersz prelegenta wpisanego RĘCZNIE i ustawienia listy.
//
// Plik-brat `speakersEditor.test.tsx` pilnuje afiliacji, przeciągania i trybów
// CRM. Tutaj stoi reszta wiersza ręcznego - to, co redakcja wypełnia przy
// każdym prelegencie:
//  1. walidacja jest WIDOCZNA przy polu (komunikat + `aria-invalid`), a podgląd
//     zdjęcia pojawia się tylko dla poprawnego adresu obrazu - podgląd
//     zepsutego URL-a pokazywałby ikonę błędu zamiast twarzy,
//  2. pola liczbowe nie zapisują NaN (śmieci -> 0),
//  3. duplikat ląduje TUŻ ZA oryginałem z nowym identyfikatorem (wspólny
//     identyfikator skleiłby oba wiersze w liście przeciągania),
//  4. podpowiedzi kategorii zbierają wartości z całej listy, bez duplikatów
//     i osobno dla każdej wersji językowej - od spójności nazw zależą filtry
//     widoku publicznego.
//
// Atrapy jak w pliku-bracie: słownik-echo (`i18nStub`), Radix Select/Switch
// jako natywne kontrolki. dnd-kit zostaje prawdziwy - bez przeciągania nie
// mierzy układu, więc w happy-dom tylko montuje wiersze.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Json, WidgetContent } from "@/lib/builder/types";
import { SpeakersEditor } from "../SpeakersEditor";

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
// Panel importuje `EventPicker` (tryb „prelegenci wydarzenia"), który sięga do
// bazy - w trybie ręcznym nie montuje się, ale moduł klienta nie może ruszyć.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

type Row = Record<string, Json>;

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Array<[string, Json]> = [];
  render(<SpeakersEditor c={content} lang={lang} setContent={(k, v) => void calls.push([k, v])} />);
  const last = (key: string): Json | undefined => calls.filter(([k]) => k === key).at(-1)?.[1];
  const speakers = (): Row[] => (last("speakers") ?? []) as Row[];
  return { calls, last, speakers };
}

/** Kontener pola: etykieta `PropField` i kontrolka są rodzeństwem. */
function boxUnder(label: string, index = 0): HTMLElement {
  const node = screen.getAllByText(label, { selector: "label" })[index];
  if (!node?.parentElement) throw new Error(`test: brak pola „${label}" (#${index})`);
  return node.parentElement;
}
const fieldUnder = (label: string, index = 0): HTMLInputElement & HTMLSelectElement => {
  const field = boxUnder(label, index).querySelector("input, textarea, select");
  if (!field) throw new Error(`test: brak kontrolki pod „${label}"`);
  return field as HTMLInputElement & HTMLSelectElement;
};

const speaker = (over: Row = {}): Row => ({
  id: "sp-1",
  photo: "",
  name: "Anna Nowak",
  organization: "",
  role_pl: "",
  role_en: "",
  category_pl: "",
  category_en: "",
  gigs: 0,
  rating: 0,
  reviews: 0,
  description_pl: "",
  description_en: "",
  href: "",
  ...over,
});

afterEach(cleanup);

describe("SpeakersEditor - walidacja wiersza", () => {
  it.each([
    ["ftp://cdn.test/a.png", "Nieprawidłowy URL (http(s)://… lub /…)"],
    ["https://cdn.test/plik.pdf", "URL nie wygląda na obraz (jpg/png/webp/avif/gif/svg)"],
  ])("zdjęcie %s: komunikat przy polu, pole oznaczone, bez podglądu", (photo, message) => {
    renderEditor({ speakers: [speaker({ photo })] });
    const box = boxUnder("Zdjęcie (URL)");
    expect(within(box).getByText(message)).toBeTruthy();
    expect(within(box).getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("img")).toBeNull();
  });

  it("poprawny adres obrazu (także z parametrami) daje podgląd i brak błędu", () => {
    renderEditor({ speakers: [speaker({ photo: "/media/anna.webp?v=2" })] });
    const box = boxUnder("Zdjęcie (URL)");
    expect(within(box).getByRole("textbox").hasAttribute("aria-invalid")).toBe(false);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/media/anna.webp?v=2");
  });

  it("link musi zaczynać się od / lub http(s)://", () => {
    renderEditor({
      speakers: [
        speaker({ id: "a", href: "www.example.com" }),
        speaker({ id: "b", href: "/author/anna" }),
      ],
    });
    const bad = boxUnder("Link (opcjonalny)", 0);
    expect(within(bad).getByText("Link musi zaczynać się od / lub http(s)://")).toBeTruthy();
    expect(within(bad).getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    const good = boxUnder("Link (opcjonalny)", 1);
    expect(within(good).queryByText(/Link musi/)).toBeNull();
    expect(within(good).getByRole("textbox").hasAttribute("aria-invalid")).toBe(false);
  });

  it("ocena spoza 0-5 i ujemne liczniki pokazują komunikaty, poprawne wartości - nie", () => {
    renderEditor({
      speakers: [
        speaker({ id: "a", rating: 7, gigs: -1, reviews: -2 }),
        speaker({ id: "b", rating: 4.5, gigs: 3, reviews: 10 }),
      ],
    });
    expect(screen.getAllByText("Ocena musi mieścić się w zakresie 0-5")).toHaveLength(1);
    expect(screen.getAllByText("Wartość nie może być ujemna")).toHaveLength(2);
    expect(within(boxUnder("Ocena (0-5)", 1)).queryByText(/Ocena musi/)).toBeNull();
  });

  it("panel angielski pokazuje komunikaty po angielsku", () => {
    renderEditor({ speakers: [speaker({ photo: "nope", rating: 9 })] }, "en");
    expect(screen.getByText("Invalid URL (http(s)://… or /…)")).toBeTruthy();
    expect(screen.getByText("The rating must be between 0 and 5")).toBeTruthy();
  });

  it("liczby zapisane napisem są czytane, śmieci pokazują zero", () => {
    renderEditor({ speakers: [speaker({ gigs: "12", rating: "abc", reviews: null })] });
    expect(fieldUnder("Wystąpienia").value).toBe("12");
    expect(fieldUnder("Ocena (0-5)").value).toBe("0");
    expect(fieldUnder("Opinie").value).toBe("0");
  });
});

describe("SpeakersEditor - pola wiersza", () => {
  it.each([
    ["Zdjęcie (URL)", "photo", "https://cdn.test/anna.jpg"],
    ["Imię i nazwisko", "name", "Anna Kowalska"],
    ["Rola PL", "role_pl", "Moderatorka"],
    ["Rola EN", "role_en", "Moderator"],
    ["Kategoria PL", "category_pl", "Energetyka"],
    ["Kategoria EN", "category_en", "Energy"],
    ["Opis PL", "description_pl", "Ekspertka rynku energii."],
    ["Opis EN", "description_en", "Energy market expert."],
    ["Link (opcjonalny)", "href", "/author/anna"],
  ])("pole „%s” zapisuje się pod kluczem %s, nie ruszając reszty wiersza", (label, key, value) => {
    const { speakers } = renderEditor({ speakers: [speaker()] });
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(speakers()).toEqual([speaker({ [key]: value })]);
  });

  it.each([
    ["Wystąpienia", "gigs", "14", 14],
    ["Ocena (0-5)", "rating", "4.7", 4.7],
    ["Opinie", "reviews", "30", 30],
  ])("pole liczbowe „%s” zapisuje liczbę, a pustkę jako zero", (label, key, typed, expected) => {
    const { speakers } = renderEditor({ speakers: [speaker({ [key]: 2 })] });
    const field = fieldUnder(label);
    fireEvent.change(field, { target: { value: typed } });
    expect(speakers()[0]?.[key]).toBe(expected);
    fireEvent.change(field, { target: { value: "" } });
    expect(speakers()[0]?.[key]).toBe(0);
  });

  it("edycja drugiego prelegenta nie rusza pierwszego", () => {
    const { speakers } = renderEditor({
      speakers: [speaker({ id: "a", name: "A" }), speaker({ id: "b", name: "B" })],
    });
    fireEvent.change(fieldUnder("Imię i nazwisko", 1), { target: { value: "B2" } });
    expect(speakers().map((s) => [s.id, s.name])).toEqual([
      ["a", "A"],
      ["b", "B2"],
    ]);
  });

  it("tytuł ramki to imię i nazwisko, a bez niego numer wiersza", () => {
    renderEditor({ speakers: [speaker({ id: "a" }), speaker({ id: "b", name: "" })] });
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
  });
});

describe("SpeakersEditor - duplikowanie i usuwanie", () => {
  it("duplikat ląduje tuż za oryginałem, z nowym identyfikatorem", () => {
    const { speakers } = renderEditor({
      speakers: [speaker({ id: "a", name: "A" }), speaker({ id: "b", name: "B" })],
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Duplikuj prelegenta" })[0]!);
    const list = speakers();
    expect(list.map((s) => s.name)).toEqual(["A", "A", "B"]);
    expect(list[1]).toEqual({ ...speaker({ id: "a", name: "A" }), id: list[1]?.id });
    expect(new Set(list.map((s) => s.id)).size).toBe(3);
  });

  it("usunięcie wiersza zostawia pozostałe", () => {
    const { speakers } = renderEditor({
      speakers: [speaker({ id: "a", name: "A" }), speaker({ id: "b", name: "B" })],
    });
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[0]!);
    expect(speakers().map((s) => s.id)).toEqual(["b"]);
  });
});

describe("SpeakersEditor - podpowiedzi kategorii", () => {
  it("zbierają przycięte kategorie całej listy bez duplikatów, osobno PL i EN", () => {
    renderEditor({
      speakers: [
        speaker({ id: "a", category_pl: " Energetyka ", category_en: "Energy" }),
        speaker({ id: "b", category_pl: "Energetyka", category_en: "" }),
        speaker({ id: "c", category_pl: "Finanse", category_en: "Finance" }),
      ],
    });
    const optionsOf = (input: HTMLInputElement) => {
      const list = document.getElementById(input.getAttribute("list") ?? "");
      return Array.from(list?.querySelectorAll("option") ?? []).map((o) => o.value);
    };
    // Każdy wiersz dostaje tę samą listę podpowiedzi, przypiętą przez `list`.
    expect(optionsOf(fieldUnder("Kategoria PL", 2))).toEqual(["Energetyka", "Finanse"]);
    expect(optionsOf(fieldUnder("Kategoria EN", 1))).toEqual(["Energy", "Finance"]);
  });
});

describe("SpeakersEditor - ustawienia listy", () => {
  it("nagłówek zapisuje się pod kluczem edytowanej wersji językowej", () => {
    const { last } = renderEditor({ heading_pl: "Prelegenci" }, "en");
    fireEvent.change(fieldUnder("Heading (EN)"), { target: { value: "Speakers" } });
    expect(last("heading_en")).toBe("Speakers");
  });

  it("wybór źródła danych zapisuje się w dokumencie", () => {
    const { last } = renderEditor({});
    const source = fieldUnder("Źródło danych");
    expect(source.value).toBe("manual");
    fireEvent.change(source, { target: { value: "directory" } });
    expect(last("source")).toBe("directory");
  });

  it("liczba kolumn zapisuje się jako liczba, brak klucza pokazuje 3", () => {
    const { last } = renderEditor({});
    const columns = fieldUnder("Liczba kolumn");
    expect(columns.value).toBe("3");
    fireEvent.change(columns, { target: { value: "4" } });
    expect(last("columns")).toBe(4);
  });

  it("kolor akcentu zapisuje się, a wyczyszczony daje PUSTY napis", () => {
    const { last } = renderEditor({ accentColor: "#123123" });
    const field = fieldUnder("Kolor akcentu");
    fireEvent.change(field, { target: { value: "#ff0000" } });
    expect(last("accentColor")).toBe("#ff0000");
    fireEvent.change(field, { target: { value: "" } });
    expect(last("accentColor")).toBe("");
  });

  it.each([
    ["Wyszukiwarka", "enableSearch"],
    ["Sortowanie", "enableSort"],
  ])("„%s” jest domyślnie włączone i zapisuje wyłączenie", (label, key) => {
    const { last } = renderEditor({});
    const toggle = fieldUnder(label);
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(last(key)).toBe(false);
  });
});

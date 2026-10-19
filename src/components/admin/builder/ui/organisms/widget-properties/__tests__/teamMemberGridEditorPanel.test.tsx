// TeamMemberGridEditor: panel widgetu „Zespół (siatka)" (`team-member-grid`).
//
// Panel jest JEDYNYM miejscem, w którym redakcja wpisuje kartotekę osoby, więc
// dowodzimy tego, co zapisuje do dokumentu - klucze i wartości oddane przez
// `setContent` - a nie wyglądu formularza:
//  * pola dwujęzyczne piszą WYŁĄCZNIE bliźniaka języka panelu (`role_en`),
//    drugi język zostaje nietknięty;
//  * każda edycja wiersza zmienia tylko swoją osobę, a `id` przeżywa każdy
//    zapis (od `id` zależy klucz kafelka i kolejność przeciągania);
//  * dodanie, duplikat, usunięcie i przeciągnięcie mają semantykę listy;
//  * układ (kolumny, zaokrąglenie) panel czyta TĄ SAMĄ funkcją co renderer -
//    lista kolumn ma zawsze zaznaczoną opcję ze swojego zbioru, a pole
//    zaokrąglenia nie zapisuje zera w trakcie pisania (NAPRAWIONE 2026-10-18,
//    patrz opisy przypadków niżej);
//  * sam render niczego nie zapisuje.
//
// Granice i atrapy: słownik (`i18nStub` - etykieta to klucz), Radix Select
// i Switch (natywne odpowiedniki z `@/test/reactStubs`), dnd-kit (pomiar
// układu nie działa pod happy-dom, więc kontekst oddaje testowi `onDragEnd` -
// wzorzec z `speakersEditor.test.tsx`) oraz `ImageSlot`, który ciągnie upload
// i bibliotekę mediów i ma własne testy (`deepEditors`). Tu liczy się tylko
// kontrakt edytor <-> slot: wartość `avatar` wchodzi, zmiana zapisuje `avatar`.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Json, WidgetContent } from "@/lib/builder/types";
import { TeamMemberGridEditor } from "../TeamMemberGridEditor";

const harness = vi.hoisted(() => ({
  onDragEnd: null as ((event: unknown) => void) | null,
}));

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
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import("react");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children?: unknown;
      onDragEnd?: (event: unknown) => void;
    }) => {
      harness.onDragEnd = onDragEnd ?? null;
      return React.createElement("div", null, children as never);
    },
    useSensor: (sensor: unknown) => sensor,
    useSensors: (...sensors: unknown[]) => sensors,
  };
});
vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import("react");
  return {
    ...actual,
    SortableContext: ({ children }: { children?: unknown }) =>
      React.createElement(React.Fragment, null, children as never),
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});
vi.mock("../ImageSlot", () => ({
  ImageSlot: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

type Call = [string, Json];
// Członek zespołu jako obiekt JSON treści widgetu - ten sam typ, który panel
// zapisuje, więc fikstury trafiają do `members` bez rzutowania.
type Member = { [key: string]: Json };

/**
 * Gospodarz ze stanem: zapis wraca do panelu jako nowa treść, tak jak w
 * builderze - dzięki temu ciąg działań (dodaj, wpisz, przeciągnij) widzi
 * własne poprzednie zapisy.
 */
function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Call[] = [];
  function Host() {
    const [c, setC] = useState<WidgetContent>(content);
    return (
      <TeamMemberGridEditor
        c={c}
        lang={lang}
        setContent={(key, value) => {
          calls.push([key, value]);
          setC((prev) => ({ ...prev, [key]: value }));
        }}
      />
    );
  }
  render(<Host />);
  return { calls };
}

function lastMembers(calls: Call[]): Member[] {
  const last = calls.filter(([key]) => key === "members").at(-1);
  if (!last) throw new Error("test: panel nie zapisał listy osób");
  return last[1] as Member[];
}

/** Pole po etykiecie `PropField` (etykieta nie jest powiązana z kontrolką). */
function field(label: string, scope: HTMLElement = document.body): HTMLElement {
  const node = within(scope).getByText(label, { selector: "label" });
  const root = node.parentElement;
  if (!root) throw new Error(`test: brak pola ${label}`);
  return root;
}

function textIn(label: string, scope?: HTMLElement): HTMLInputElement | HTMLTextAreaElement {
  return within(field(label, scope)).getByRole("textbox") as HTMLInputElement;
}

/** Wiersze osób - każdy ItemFrame ma własny przycisk usunięcia. */
function rows(): HTMLElement[] {
  return screen
    .getAllByRole("button", { name: "builder.common.delete" })
    .map((button) => button.parentElement?.parentElement as HTMLElement);
}

const K = (key: string) => `builder.teamGridEditor.${key}`;

const ANNA: Member = {
  id: "m-anna",
  name: "Anna Kowalska",
  role_pl: "Dyrektorka",
  role_en: "Director",
  linkedin: "https://linkedin.com/in/anna",
};
const JAN: Member = { id: "m-jan", name: "Jan Nowak", role_pl: "Analityk" };
const EWA: Member = { id: "m-ewa", name: "Ewa Zielińska" };

beforeEach(() => {
  harness.onDragEnd = null;
});

describe("TeamMemberGridEditor - nagłówek sekcji", () => {
  it("pokazuje i zapisuje bliźniaka języka panelu, drugiego nie dotyka", () => {
    const { calls } = renderEditor(
      { badge_pl: "POZNAJ ZESPÓŁ", badge_en: "MEET THE TEAM", heading_en: "Our team" },
      "en",
    );
    const badge = textIn(`${K("badge")} (EN)`);
    expect(badge.value).toBe("MEET THE TEAM");
    expect(textIn(`${K("heading")} (EN)`).value).toBe("Our team");

    fireEvent.change(badge, { target: { value: "THE PEOPLE" } });
    fireEvent.change(textIn(`${K("heading")} (EN)`), { target: { value: "Meet us" } });
    fireEvent.change(textIn(`${K("intro")} (EN)`), { target: { value: "Who we are." } });
    expect(calls).toEqual([
      ["badge_en", "THE PEOPLE"],
      ["heading_en", "Meet us"],
      ["intro_en", "Who we are."],
    ]);
  });

  it("sam render pełnej treści niczego nie zapisuje", () => {
    const { calls } = renderEditor({
      badge_pl: "Zespół",
      columns: 4,
      radius: 12,
      accentColor: "#123456",
      grayscale: false,
      openPopup: false,
      members: [ANNA, JAN],
    });
    expect(calls).toEqual([]);
  });
});

describe("TeamMemberGridEditor - układ", () => {
  it("lista kolumn oferuje 2, 3 i 4, a wybór zapisuje LICZBĘ", () => {
    const { calls } = renderEditor({});
    const select = within(field(K("columns"))).getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["2", "3", "4"]);
    expect(select.value).toBe("3");
    fireEvent.change(select, { target: { value: "4" } });
    expect(calls).toEqual([["columns", 4]]);
  });

  // NAPRAWIONE 2026-10-18: panel czytał kolumny po swojemu (`Number(v)` bez
  // zakresu), renderer - `number` z klampem 2-4. Dla `columns: 5` z importu
  // lista nie miała zaznaczonej opcji, a strona rysowała 4 kolumny; napis "4"
  // panel pokazywał jako 4, a strona rysowała domyślne 3. Teraz obie strony
  // czytają `teamGridColumns`, więc panel pokazuje to, co widzi czytelnik.
  it.each([
    ["poza zakresem w górę", 5, "4"],
    ["poza zakresem w dół", 1, "2"],
    ["ułamek zaokrąglony jak w rendererze", 2.6, "3"],
    ["napis z importu (renderer go nie czyta)", "4", "3"],
    ["brak wartości", undefined, "3"],
  ] as const)("kolumny: %s", (_label, columns, shown) => {
    renderEditor(columns === undefined ? {} : { columns });
    const select = within(field(K("columns"))).getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe(shown);
  });

  it.each([
    ["brak wartości = domyślne 6 px", undefined, "6"],
    ["ponad limit = 48 px, jak rysuje siatka", 100, "48"],
    ["ujemne = 0 px", -4, "0"],
  ] as const)("zaokrąglenie: %s", (_label, radius, shown) => {
    renderEditor(radius === undefined ? {} : { radius });
    expect((screen.getByLabelText(K("radius")) as HTMLInputElement).value).toBe(shown);
  });

  // NAPRAWIONE 2026-10-18: pole zaokrąglenia zapisywało
  // `Number(e.target.value) || 0` przy KAŻDEJ zmianie, więc wyczyszczenie pola
  // przed wpisaniem nowej liczby zapisywało do dokumentu 0 px (ostre rogi
  // w podglądzie i zbędny krok historii). Teraz to wspólny atom
  // `ClampedNumberInput`: pusty szkic nie jest zapisem, a liczba spoza zakresu
  // klampuje się przy zatwierdzeniu.
  it("wyczyszczenie pola w trakcie pisania nie zapisuje zera", () => {
    const { calls } = renderEditor({ radius: 12 });
    const input = screen.getByLabelText(K("radius")) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(calls).toEqual([]);
    fireEvent.change(input, { target: { value: "20" } });
    expect(calls).toEqual([["radius", 20]]);
  });

  it("puste pole po wyjściu wraca do wartości dokumentu bez zapisu", () => {
    const { calls } = renderEditor({ radius: 12 });
    const input = screen.getByLabelText(K("radius")) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(calls).toEqual([]);
    expect(input.value).toBe("12");
  });

  it("liczba ponad limit klampuje się do 48 przy zatwierdzeniu", () => {
    const { calls } = renderEditor({});
    const input = screen.getByLabelText(K("radius")) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "90" } });
    expect(calls).toEqual([]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([["radius", 48]]);
  });

  it("samo wejście i wyjście z pola nie jest zmianą", () => {
    const { calls } = renderEditor({});
    const input = screen.getByLabelText(K("radius"));
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(calls).toEqual([]);
  });

  it("kolor akcentu: wpis zapisuje kolor, wyczyszczenie - pusty napis (kolor brand)", () => {
    const { calls } = renderEditor({ accentColor: "#123456" });
    const input = within(field(K("accent"))).getByDisplayValue("#123456");
    fireEvent.change(input, { target: { value: "#ff0000" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(calls).toEqual([
      ["accentColor", "#ff0000"],
      ["accentColor", ""],
    ]);
  });

  it("przełączniki są domyślnie włączone i zapisują wartość logiczną", () => {
    const { calls } = renderEditor({});
    const grayscale = within(field(K("grayscale"))).getByRole("switch") as HTMLInputElement;
    const popup = within(field(K("openPopup"))).getByRole("switch") as HTMLInputElement;
    expect(grayscale.checked).toBe(true);
    expect(popup.checked).toBe(true);
    fireEvent.click(grayscale);
    fireEvent.click(popup);
    expect(calls).toEqual([
      ["grayscale", false],
      ["openPopup", false],
    ]);
  });

  it("jawne `false` w treści wyłącza przełącznik", () => {
    renderEditor({ grayscale: false, openPopup: false });
    expect(within(field(K("grayscale"))).getByRole("switch")).toHaveProperty("checked", false);
    expect(within(field(K("openPopup"))).getByRole("switch")).toHaveProperty("checked", false);
  });
});

describe("TeamMemberGridEditor - lista osób", () => {
  it("pusta lista pokazuje stan pusty, a dodanie zapisuje osobę z kompletem pustych pól", () => {
    const { calls } = renderEditor({});
    expect(screen.getByText("builder.listShell.empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /common\.add/ }));
    const [member] = lastMembers(calls);
    expect(member.id).toMatch(/^tmg-/);
    // Zero danych przykładowych: każdy klucz kartoteki istnieje i jest pusty,
    // więc renderer nie ma czego pokazać, a fallback językowy działa na
    // kształcie, który panel naprawdę zapisuje.
    const { id: _id, ...rest } = member;
    expect(Object.values(rest).every((v) => v === "")).toBe(true);
    expect(Object.keys(rest)).toEqual(
      expect.arrayContaining(["name", "role_pl", "role_en", "fullBio_en", "linkedin", "website"]),
    );
  });

  it("dodanie dopisuje osobę na końcu, istniejących nie zmienia", () => {
    const { calls } = renderEditor({ members: [ANNA, JAN] });
    fireEvent.click(screen.getByRole("button", { name: /common\.add/ }));
    const members = lastMembers(calls);
    expect(members).toHaveLength(3);
    expect(members.slice(0, 2)).toEqual([ANNA, JAN]);
  });

  it("edycja imienia zmienia tylko swoją osobę i zachowuje jej id", () => {
    const { calls } = renderEditor({ members: [ANNA, JAN] });
    fireEvent.change(textIn(K("name"), rows()[1]), { target: { value: "Jan Kowal" } });
    expect(lastMembers(calls)).toEqual([ANNA, { ...JAN, name: "Jan Kowal" }]);
  });

  it("pola dwujęzyczne wiersza piszą bliźniaka języka panelu", () => {
    const { calls } = renderEditor({ members: [ANNA] }, "en");
    const row = rows()[0];
    expect(textIn(`${K("role")} (EN)`, row).value).toBe("Director");
    fireEvent.change(textIn(`${K("role")} (EN)`, row), { target: { value: "Head" } });
    fireEvent.change(textIn(`${K("projects")} (EN)`, row), {
      target: { value: "Balkans, Energy" },
    });
    fireEvent.change(textIn(`${K("bio")} (EN)`, row), { target: { value: "Short bio." } });
    fireEvent.change(textIn(`${K("fullBio")} (EN)`, row), { target: { value: "<p>Bio</p>" } });
    expect(lastMembers(calls)).toEqual([
      {
        ...ANNA,
        role_en: "Head",
        projects_en: "Balkans, Energy",
        bio_en: "Short bio.",
        fullBio_en: "<p>Bio</p>",
      },
    ]);
    // Wersja polska nie została nadpisana ani wyczyszczona.
    expect(lastMembers(calls)[0].role_pl).toBe("Dyrektorka");
  });

  it("kontakt, social media i zdjęcie zapisują własne klucze", () => {
    const { calls } = renderEditor({ members: [ANNA] });
    const row = rows()[0];
    fireEvent.change(textIn(K("email"), row), { target: { value: "anna@example.org" } });
    fireEvent.change(textIn(K("phone"), row), { target: { value: "+48 600 000 000" } });
    fireEvent.change(textIn(K("profileHref"), row), { target: { value: "/author/anna" } });
    fireEvent.change(textIn("YouTube", row), { target: { value: "https://youtube.com/@anna" } });
    fireEvent.change(within(row).getByLabelText(K("avatar")), {
      target: { value: "https://cdn.example.org/anna.jpg" },
    });
    expect(lastMembers(calls)).toEqual([
      {
        ...ANNA,
        email: "anna@example.org",
        phone: "+48 600 000 000",
        profileHref: "/author/anna",
        youtube: "https://youtube.com/@anna",
        avatar: "https://cdn.example.org/anna.jpg",
      },
    ]);
  });

  it("usunięcie zabiera wskazaną osobę", () => {
    const { calls } = renderEditor({ members: [ANNA, JAN, EWA] });
    fireEvent.click(within(rows()[1]).getByRole("button", { name: "builder.common.delete" }));
    expect(lastMembers(calls)).toEqual([ANNA, EWA]);
  });

  it("duplikat ląduje tuż za oryginałem, z nowym id i tą samą kartoteką", () => {
    const { calls } = renderEditor({ members: [ANNA, JAN] });
    fireEvent.click(within(rows()[0]).getByRole("button", { name: K("duplicate") }));
    const members = lastMembers(calls);
    expect(members).toHaveLength(3);
    const { id: copyId, ...copy } = members[1];
    const { id: _annaId, ...anna } = ANNA;
    expect(copy).toEqual(anna);
    expect(copyId).not.toBe(ANNA.id);
    expect(copyId).toMatch(/^tmg-/);
    expect(members[0]).toEqual(ANNA);
    expect(members[2]).toEqual(JAN);
  });

  it("przeciągnięcie przenosi osobę na miejsce celu", () => {
    const { calls } = renderEditor({ members: [ANNA, JAN, EWA] });
    harness.onDragEnd?.({ active: { id: "m-anna" }, over: { id: "m-ewa" } });
    expect(lastMembers(calls)).toEqual([JAN, EWA, ANNA]);
  });

  it.each([
    ["upuszczenie poza listą", { active: { id: "m-anna" }, over: null }],
    ["upuszczenie na siebie", { active: { id: "m-anna" }, over: { id: "m-anna" } }],
    ["nieznany cel", { active: { id: "m-anna" }, over: { id: "obcy" } }],
  ])("%s niczego nie zapisuje", (_label, event) => {
    const { calls } = renderEditor({ members: [ANNA, JAN] });
    harness.onDragEnd?.(event);
    expect(calls).toEqual([]);
  });

  it("osoby bez id da się przeciągać (id zastępcze z pozycji) i nie dostają id po drodze", () => {
    const a = { name: "A" };
    const b = { name: "B" };
    const { calls } = renderEditor({ members: [a, b] });
    harness.onDragEnd?.({ active: { id: "tmg-idx-0" }, over: { id: "tmg-idx-1" } });
    expect(lastMembers(calls)).toEqual([b, a]);
  });

  it("wpis, który nie jest osobą, nie przesuwa indeksów: edycja trafia we właściwą osobę", () => {
    // Renderer pomija takie wpisy (`teamGridMembers`), panel też - a łatka
    // liczy indeks po liście, którą redakcja widzi. Pierwszy zapis odsiewa
    // śmieci, zamiast utrwalić je obok osób.
    const { calls } = renderEditor({ members: [null, "x", ANNA, JAN] });
    expect(rows()).toHaveLength(2);
    fireEvent.change(textIn(K("name"), rows()[1]), { target: { value: "Jan N." } });
    expect(lastMembers(calls)).toEqual([ANNA, { ...JAN, name: "Jan N." }]);
  });

  it("osoba bez imienia ma tytuł z numeru i ostrzeżenie, że nie pojawi się w siatce", () => {
    renderEditor({ members: [ANNA, { id: "m-x", name: "" }] });
    const [named, unnamed] = rows();
    expect(within(named).queryByText(K("unnamed"))).toBeNull();
    expect(within(named).getByText("Anna Kowalska")).toBeTruthy();
    expect(within(unnamed).getByText("#2")).toBeTruthy();
    expect(within(unnamed).getByText(K("unnamed"))).toBeTruthy();
  });

  it.each([
    ["ścieżka w serwisie", "/author/anna", false],
    ["adres https", "https://example.org/anna", false],
    ["schemat javascript:", "javascript:alert(1)", true],
    ["adres ze spacją", "https://example.org/a b", true],
  ])("link do profilu: %s", (_label, href, invalid) => {
    renderEditor({ members: [{ ...ANNA, profileHref: href }] });
    const input = textIn(K("profileHref"), rows()[0]);
    expect(input.getAttribute("aria-invalid")).toBe(invalid ? "true" : null);
    expect(within(rows()[0]).queryByText(K("invalidUrl")) !== null).toBe(invalid);
  });
});

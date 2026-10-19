// Edytory widgetów wydarzeniowych: odliczanie, karta odliczania, umawianie
// spotkań 1-1 i sponsorzy.
//
// Wspólna reguła: PANEL POKAZUJE TO, CO RYSUJE STRONA. Widoki czytają treść
// przez `getBool` / `getNum` / `asOneOf` i klamry (np. horyzont 1-90 dni), a
// panele czytały ją po swojemu (`!== false`, surowa liczba). Na treści
// z importu („false" jako napis, 500 dni, rozmiar „xl") panel pokazywał więc
// stan, którego strona nie rysuje (NAPRAWIONE 2026-10-18). Do tego:
//  - odliczanie: pole daty pracuje w czasie LOKALNYM i zapisuje ISO bez
//    przesunięcia; tryb „wydarzenie" podmienia datę na picker wydarzenia;
//  - karta: liczba uczestników bez ułamków i wartości ujemnych, pola znikają
//    razem z wyłączonym przełącznikiem;
//  - spotkania: tryb hosta i tryb wydarzenia mają własne pickery;
//  - sponsorzy: „Dodaj sponsora" dokładał pusty wiersz, który parser widoku
//    (słusznie) odrzuca - panel czytał tym samym parserem, więc nowy wiersz
//    znikał od razu, a wyczyszczenie nazwy sponsora bez logo kasowało wiersz
//    w trakcie pisania (NAPRAWIONE 2026-10-18).
//
// Granice: Supabase (łańcuch z `@/test/supabaseChain`), atrapy Radix
// Select/Switch, i18n jako echo klucza, sesja/tenant i server fny jak
// w sąsiednich testach, biblioteka mediów (osobny test) jako pusta atrapa.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState, type ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { EventCountdownEditor } from "../EventCountdownEditor";
import { EventCountdownCardEditor } from "../EventCountdownCardEditor";
import { MeetingBookingEditor } from "../MeetingBookingEditor";
import { SponsorsEditor } from "../SponsorsEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

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
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({ MediaPickerDialog: () => null }));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});

type Editor = (props: {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) => ReactNode;

function renderStateful(Editor: Editor, initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <Editor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  const last = (key: string) => written.filter(([k]) => k === key).at(-1)?.[1];
  return { ...view, written, last };
}

/** `PropField` nie wiąże etykiety z kontrolką - szukamy w jej opakowaniu. */
function fieldOf(label: string, index = 0): HTMLInputElement {
  const wrapper = screen.getAllByText(label, { selector: "label" })[index]?.parentElement;
  const field = wrapper?.querySelector<HTMLInputElement>("input, textarea, select");
  if (!field) throw new Error(`test: brak kontrolki „${label}"`);
  return field;
}
const hasLabel = (label: string): boolean =>
  screen.queryAllByText(label, { selector: "label" }).length > 0;

const selectWith = (value: string): HTMLSelectElement => {
  const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
    s.querySelector(`option[value="${value}"]`),
  );
  if (!found) throw new Error(`test: brak listy z opcją „${value}"`);
  return found;
};

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse(
    "events",
    ok([
      {
        id: "ev-1",
        slug: "szczyt",
        title_pl: "Szczyt",
        title_en: "Summit",
        starts_at: "2026-11-05T08:00:00Z",
        status: "published",
      },
    ]),
  );
  db.current.setResponse("profiles_public", (chain) =>
    chain.has("maybeSingle")
      ? ok({ id: "u-1", display_name: "Anna Nowak", avatar_url: null })
      : ok([{ id: "u-1", display_name: "Anna Nowak", avatar_url: null }]),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("EventCountdownEditor - data celu w czasie lokalnym", () => {
  const dateField = () => fieldOf("Data i godzina celu");

  it("ISO z dokumentu pokazuje się jako lokalna data i godzina", () => {
    const local = new Date(2026, 10, 5, 18, 30);
    renderStateful(EventCountdownEditor, { targetAt: local.toISOString() });
    expect(dateField().value).toBe("2026-11-05T18:30");
  });

  it("wpisana lokalna godzina wraca do pola bez przesunięcia strefy", () => {
    const { last } = renderStateful(EventCountdownEditor, {});
    fireEvent.change(dateField(), { target: { value: "2026-11-05T18:30" } });
    expect(last("targetAt")).toBe(new Date(2026, 10, 5, 18, 30).toISOString());
    expect(dateField().value).toBe("2026-11-05T18:30");
  });

  it('wyczyszczenie daty zapisuje pusty napis, nie „Invalid Date"', () => {
    const { written } = renderStateful(EventCountdownEditor, {
      targetAt: new Date(2026, 0, 1, 9, 0).toISOString(),
    });
    fireEvent.change(dateField(), { target: { value: "" } });
    expect(written).toEqual([["targetAt", ""]]);
  });

  it("uszkodzona data w dokumencie daje puste pole", () => {
    renderStateful(EventCountdownEditor, { targetAt: "jutro rano" });
    expect(dateField().value).toBe("");
  });
});

describe("EventCountdownEditor - tryb, teksty i wygląd", () => {
  it('tryb „wydarzenie" podmienia pole daty na picker i zapisuje identyfikator', async () => {
    const { written } = renderStateful(EventCountdownEditor, {});
    fireEvent.change(selectWith("event"), { target: { value: "event" } });
    expect(hasLabel("Data i godzina celu")).toBe(false);
    const picker = await waitFor(() => selectWith("ev-1"));
    fireEvent.change(picker, { target: { value: "ev-1" } });
    expect(written).toEqual([
      ["mode", "event"],
      ["eventId", "ev-1"],
    ]);
  });

  it("tytuł, tekst końca i etykieta CTA piszą klucze języka panelu", () => {
    const { written } = renderStateful(EventCountdownEditor, {}, "en");
    fireEvent.change(fieldOf("Title (EN)"), { target: { value: "Starts in" } });
    fireEvent.change(fieldOf("Finished text (EN)"), { target: { value: "Live!" } });
    fireEvent.change(fieldOf("CTA link (optional)"), { target: { value: "/events/x" } });
    fireEvent.change(fieldOf("CTA label (EN)"), { target: { value: "Join" } });
    expect(written).toEqual([
      ["title_en", "Starts in"],
      ["doneText_en", "Live!"],
      ["href", "/events/x"],
      ["ctaLabel_en", "Join"],
    ]);
  });

  it('rozmiar spoza listy pokazuje „md" - ten, który rysuje widok', () => {
    const { written } = renderStateful(EventCountdownEditor, { size: "xl" });
    const size = selectWith("lg");
    expect(size.value).toBe("md");
    fireEvent.change(size, { target: { value: "lg" } });
    expect(written).toEqual([["size", "lg"]]);
  });

  it.each([
    ['napis „false"', "false", false],
    ["zero", 0, false],
    ["brak wartości", undefined, true],
  ] as const)("sekundy: %s czyta się jak w widoku", (_l, raw, checked) => {
    renderStateful(EventCountdownEditor, raw === undefined ? {} : { showSeconds: raw });
    expect(screen.getByRole("switch")).toHaveProperty("checked", checked);
  });

  it("zdjęcie koloru akcentu zapisuje pusty napis (kolor z motywu), nie `undefined`", () => {
    const { written } = renderStateful(EventCountdownEditor, { accentColor: "#ff8800" });
    fireEvent.change(fieldOf("Kolor akcentu"), { target: { value: "" } });
    expect(written).toEqual([["accentColor", ""]]);
  });

  it("przełącznik sekund zapisuje boolean", () => {
    const { written } = renderStateful(EventCountdownEditor, {});
    fireEvent.click(screen.getByRole("switch"));
    expect(written).toEqual([["showSeconds", false]]);
  });
});

describe("EventCountdownCardEditor - pola karty", () => {
  const attendees = () => fieldOf("Liczba uczestników");

  it.each([
    ["ułamek", 12.6, "13"],
    ["ujemna", -4, ""],
    ["napis (widok go nie liczy)", "12", ""],
    ["brak", undefined, ""],
  ] as const)("liczba uczestników: %s pokazuje to, co karta", (_l, raw, shown) => {
    renderStateful(EventCountdownCardEditor, raw === undefined ? {} : { attendees: raw });
    expect(attendees().value).toBe(shown);
  });

  it.each([
    ["-5", 0],
    ["7.4", 7],
    ["", 0],
  ] as const)('wpisanie „%s" zapisuje %d', (typed, saved) => {
    const { written } = renderStateful(EventCountdownCardEditor, { attendees: 3 });
    fireEvent.change(attendees(), { target: { value: typed } });
    expect(written).toEqual([["attendees", saved]]);
  });

  it('wyłączeni uczestnicy (napis „0" z importu) chowają pole liczby', () => {
    const { written } = renderStateful(EventCountdownCardEditor, { showAttendees: "0" });
    expect(hasLabel("Liczba uczestników")).toBe(false);
    const toggle = fieldOf("Pokaż uczestników");
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(written).toEqual([["showAttendees", true]]);
    expect(hasLabel("Liczba uczestników")).toBe(true);
  });

  it("lokalizacja zapisuje klucz języka i znika z przełącznikiem", () => {
    const { written } = renderStateful(EventCountdownCardEditor, {}, "en");
    fireEvent.change(fieldOf("Location (EN)"), { target: { value: "Brussels" } });
    fireEvent.click(fieldOf("Show location"));
    expect(written).toEqual([
      ["location_en", "Brussels"],
      ["showLocation", false],
    ]);
    expect(hasLabel("Location (EN)")).toBe(false);
  });

  it("odliczanie, animacje i tekst pod komunikatem końca zapisują swoje klucze", () => {
    const { written } = renderStateful(EventCountdownCardEditor, { enableAnimations: "false" });
    expect(fieldOf("Animacje").checked).toBe(false);
    fireEvent.click(fieldOf("Pokaż odliczanie"));
    fireEvent.click(fieldOf("Animacje"));
    fireEvent.change(fieldOf("Tekst pod komunikatem końca (PL)"), {
      target: { value: "Dołącz" },
    });
    expect(written).toEqual([
      ["showCountdown", false],
      ["enableAnimations", true],
      ["doneHint_pl", "Dołącz"],
    ]);
  });

  it("adres okładki zapisuje się pod kluczem `image`", () => {
    const { written } = renderStateful(EventCountdownCardEditor, {});
    fireEvent.change(screen.getByPlaceholderText("builder.imageSlot.urlPlaceholder"), {
      target: { value: "https://cdn.test/okladka.jpg" },
    });
    expect(written).toEqual([["image", "https://cdn.test/okladka.jpg"]]);
  });

  it("w trybie wydarzenia puste pola opisują zapas z wydarzenia", () => {
    renderStateful(EventCountdownCardEditor, { mode: "event" });
    expect(screen.getByText("Puste = okładka wybranego wydarzenia.")).toBeInTheDocument();
    expect(screen.getByText("Puste = lokalizacja wybranego wydarzenia.")).toBeInTheDocument();
  });
});

describe("MeetingBookingEditor", () => {
  const days = () => screen.getByRole("textbox", { name: "Horyzont (dni)" }) as HTMLInputElement;

  it.each([
    ["za duży", 500, "90"],
    ["zero", 0, "1"],
    ["ułamek", 7.6, "8"],
    ["nie-liczba", "abc", "14"],
    ["brak", undefined, "14"],
  ] as const)("horyzont %s pokazuje tyle dni, o ile widok zapyta bazę", (_l, raw, shown) => {
    renderStateful(MeetingBookingEditor, raw === undefined ? {} : { daysAhead: raw });
    expect(days().value).toBe(shown);
  });

  it("horyzont w zakresie zapisuje się od razu, wyczyszczenie - wcale", () => {
    const { written } = renderStateful(MeetingBookingEditor, { daysAhead: 14 });
    fireEvent.focus(days());
    fireEvent.change(days(), { target: { value: "" } });
    fireEvent.blur(days());
    expect(written).toEqual([]);
    expect(days().value).toBe("14");
    fireEvent.focus(days());
    fireEvent.change(days(), { target: { value: "30" } });
    expect(written).toEqual([["daysAhead", 30]]);
  });

  it("nagłówek i wstęp piszą klucze języka panelu", () => {
    const { written } = renderStateful(MeetingBookingEditor, {}, "en");
    fireEvent.change(fieldOf("Heading (EN)"), { target: { value: "Book" } });
    fireEvent.change(fieldOf("Intro (EN)"), { target: { value: "Pick a slot" } });
    expect(written).toEqual([
      ["heading_en", "Book"],
      ["intro_en", "Pick a slot"],
    ]);
  });

  it("tryb hosta: wybór profilu zapisuje identyfikator, odpięcie - pusty napis", async () => {
    const { last } = renderStateful(MeetingBookingEditor, {});
    const search = screen.getByPlaceholderText("Szukaj profilu…");
    fireEvent.focus(search);
    fireEvent.click(await screen.findByText("Anna Nowak"));
    await waitFor(() => expect(last("hostUserId")).toBe("u-1"));
    fireEvent.click(await screen.findByLabelText("Odepnij profil"));
    expect(last("hostUserId")).toBe("");
  });

  it("tryb wydarzenia: picker wydarzenia zamiast hosta i przełącznik hosta przy slocie", async () => {
    const { written } = renderStateful(MeetingBookingEditor, { mode: "event", showHost: "false" });
    expect(screen.queryByPlaceholderText("Szukaj profilu…")).toBeNull();
    const picker = await waitFor(() => selectWith("ev-1"));
    fireEvent.change(picker, { target: { value: "ev-1" } });
    const showHost = fieldOf("Pokazuj hosta przy slocie");
    expect(showHost.checked).toBe(false);
    fireEvent.click(showHost);
    expect(written).toEqual([
      ["eventId", "ev-1"],
      ["showHost", true],
    ]);
  });

  it("przełącznik hosta przy slocie istnieje tylko w trybie wydarzenia", () => {
    renderStateful(MeetingBookingEditor, {});
    expect(hasLabel("Pokazuj hosta przy slocie")).toBe(false);
  });

  it('panel hosta: „false" z importu jest wyłączony, klik zapisuje true', () => {
    const { written } = renderStateful(MeetingBookingEditor, { allowHostManage: "false" });
    const toggle = fieldOf("Panel hosta (dodawanie slotów)");
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(written).toEqual([["allowHostManage", true]]);
  });

  it("zdjęcie koloru akcentu zapisuje pusty napis", () => {
    const { written } = renderStateful(MeetingBookingEditor, { accentColor: "#123456" });
    fireEvent.change(fieldOf("Kolor akcentu"), { target: { value: "" } });
    expect(written).toEqual([["accentColor", ""]]);
  });

  it("zmiana źródła slotów zapisuje tryb", () => {
    const { written } = renderStateful(MeetingBookingEditor, {});
    fireEvent.change(selectWith("event"), { target: { value: "event" } });
    expect(written).toEqual([["mode", "event"]]);
  });
});

describe("SponsorsEditor - nowy sponsor zostaje w panelu", () => {
  const TIER = {
    id: "tier-1",
    name_pl: "Główni",
    name_en: "Main",
    size: "lg",
    sponsors: [
      {
        id: "s-1",
        name: "Alfa",
        logo: "",
        url: "",
        description_pl: "",
        description_en: "",
      },
    ],
  };
  const tiersOf = (value: Json | undefined) =>
    value as Array<{ sponsors: Array<Record<string, unknown>> }>;
  const nameFields = () => fieldsLabelled("Nazwa");
  function fieldsLabelled(label: string): HTMLInputElement[] {
    return screen
      .getAllByText(label, { selector: "label" })
      .map((el) => el.parentElement?.querySelector<HTMLInputElement>("input"))
      .filter((el): el is HTMLInputElement => !!el);
  }

  it('„Dodaj sponsora" dokłada pusty wiersz, który NIE znika po zapisie', () => {
    const { last } = renderStateful(SponsorsEditor, { tiers: [TIER] });
    fireEvent.click(screen.getByRole("button", { name: /Dodaj sponsora/ }));
    const sponsors = tiersOf(last("tiers"))[0]!.sponsors;
    expect(sponsors).toHaveLength(2);
    expect(sponsors[1]).toMatchObject({
      name: "",
      logo: "",
      url: "",
      description_pl: "",
      description_en: "",
    });
    expect(String(sponsors[1]!.id)).toMatch(/^spo-/);
    // Wiersz jest w panelu - redakcja ma gdzie wpisać nazwę.
    expect(nameFields()).toHaveLength(2);
    expect(screen.getByText("Sponsorzy (2)")).toBeInTheDocument();
  });

  it("nazwa wpisana w nowy wiersz trafia do tego sponsora", () => {
    const { last } = renderStateful(SponsorsEditor, { tiers: [TIER] });
    fireEvent.click(screen.getByRole("button", { name: /Dodaj sponsora/ }));
    fireEvent.change(nameFields()[1]!, { target: { value: "Beta" } });
    const sponsors = tiersOf(last("tiers"))[0]!.sponsors;
    expect(sponsors.map((s) => s.name)).toEqual(["Alfa", "Beta"]);
  });

  it("wyczyszczenie nazwy sponsora bez logo nie kasuje wiersza w trakcie pisania", () => {
    const { last } = renderStateful(SponsorsEditor, { tiers: [TIER] });
    fireEvent.change(nameFields()[0]!, { target: { value: "" } });
    expect(tiersOf(last("tiers"))[0]!.sponsors).toHaveLength(1);
    expect(nameFields()).toHaveLength(1);
    fireEvent.change(nameFields()[0]!, { target: { value: "Gamma" } });
    expect(tiersOf(last("tiers"))[0]!.sponsors[0]).toMatchObject({ id: "s-1", name: "Gamma" });
  });

  it("logo, link i opisy zapisują się w edytowanym sponsorze", () => {
    const { last } = renderStateful(SponsorsEditor, { tiers: [TIER] });
    fireEvent.change(fieldOf("Logo (URL)"), { target: { value: "https://cdn.test/a.png" } });
    fireEvent.change(fieldOf("Link"), { target: { value: "https://alfa.test" } });
    fireEvent.change(fieldOf("Opis PL"), { target: { value: "Partner główny" } });
    fireEvent.change(fieldOf("Opis EN"), { target: { value: "Main partner" } });
    expect(tiersOf(last("tiers"))[0]!.sponsors[0]).toEqual({
      id: "s-1",
      name: "Alfa",
      logo: "https://cdn.test/a.png",
      url: "https://alfa.test",
      description_pl: "Partner główny",
      description_en: "Main partner",
    });
  });

  it("usunięcie sponsora zabiera wskazany wiersz", () => {
    const { last } = renderStateful(SponsorsEditor, {
      tiers: [
        {
          ...TIER,
          sponsors: [TIER.sponsors[0]!, { ...TIER.sponsors[0]!, id: "s-2", name: "Beta" }],
        },
      ],
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń" })[0]!);
    expect(tiersOf(last("tiers"))[0]!.sponsors.map((s) => s.id)).toEqual(["s-2"]);
  });

  it("nazwy poziomu zapisują się w obu językach niezależnie od języka panelu", () => {
    const { last } = renderStateful(SponsorsEditor, { tiers: [TIER] }, "en");
    fireEvent.change(fieldOf("Tier name PL"), { target: { value: "Strategiczni" } });
    fireEvent.change(fieldOf("Tier name EN"), { target: { value: "Strategic" } });
    expect(last("tiers")).toEqual([
      expect.objectContaining({ id: "tier-1", name_pl: "Strategiczni", name_en: "Strategic" }),
    ]);
  });

  it("usunięcie poziomu zabiera wskazany poziom razem z jego sponsorami", () => {
    const second = { ...TIER, id: "tier-2", name_pl: "Medialni", sponsors: [] };
    const { last } = renderStateful(SponsorsEditor, { tiers: [TIER, second] });
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[0]!);
    expect(last("tiers")).toEqual([expect.objectContaining({ id: "tier-2", sponsors: [] })]);
  });

  it('wyszarzenie zapisane napisem „false" jest w panelu wyłączone', () => {
    renderStateful(SponsorsEditor, { grayscale: "false" });
    expect(screen.getByRole("switch")).toHaveProperty("checked", false);
  });

  it("śmieci w liście sponsorów (nie-obiekty) nie robią pustych wierszy", () => {
    renderStateful(SponsorsEditor, {
      tiers: [{ ...TIER, sponsors: ["x", null, TIER.sponsors[0]!] }],
    });
    expect(nameFields()).toHaveLength(1);
  });
});
